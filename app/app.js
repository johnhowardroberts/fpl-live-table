/**
 * FPL Live Table Application
 * 
 * A real-time Fantasy Premier League leaderboard tracker.
 * Supports both local development (proxy server) and hosted deployment (Cloudflare Worker).
 */

class FPLLiveTable {
  constructor() {
    // State
    this.leagueId = null;
    this.currentView = 'monthly';
    this.currentMonth = null;
    this.availableMonths = [];
    this.currentGameweek = 1;
    this.gameweekDates = new Map();
    
    // Cache
    this.cache = new Map();
    
    // Auto-refresh
    this.refreshInterval = null;
    
    // Initialize
    this.initElements();
    this.bindEvents();
    this.loadStoredLeague();
  }

  // ============================================
  // Initialization
  // ============================================

  initElements() {
    this.el = {
      // Setup
      setupSection: document.getElementById('setupSection'),
      leagueIdInput: document.getElementById('leagueIdInput'),
      loadLeagueBtn: document.getElementById('loadLeagueBtn'),
      
      // Leaderboard
      leaderboardSection: document.getElementById('leaderboardSection'),
      leagueName: document.getElementById('leagueName'),
      leagueDetails: document.getElementById('leagueDetails'),
      changeLeagueBtn: document.getElementById('changeLeagueBtn'),
      
      // Controls
      viewButtons: document.querySelectorAll('.toggle-btn'),
      monthControls: document.getElementById('monthControls'),
      monthFilter: document.getElementById('monthFilter'),
      scoreHeader: document.getElementById('scoreHeader'),
      
      // Stats
      statGameweek: document.getElementById('statGameweek'),
      statTeams: document.getElementById('statTeams'),
      statHighest: document.getElementById('statHighest'),
      statAverage: document.getElementById('statAverage'),
      
      // Table
      leaderboardBody: document.getElementById('leaderboardBody'),
      
      // Header
      refreshBtn: document.getElementById('refreshBtn'),
      lastUpdated: document.getElementById('lastUpdated'),
      
      // States
      loadingIndicator: document.getElementById('loadingIndicator'),
      errorMessage: document.getElementById('errorMessage'),
    };
  }

  bindEvents() {
    // Load league
    this.el.loadLeagueBtn.addEventListener('click', () => this.loadLeague());
    this.el.leagueIdInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.loadLeague();
    });
    
    // Change league
    this.el.changeLeagueBtn.addEventListener('click', () => this.showSetup());
    
    // Refresh
    this.el.refreshBtn.addEventListener('click', () => this.refresh());
    
    // View toggle
    this.el.viewButtons.forEach(btn => {
      btn.addEventListener('click', (e) => this.switchView(e.target.dataset.view));
    });
    
    // Month filter
    this.el.monthFilter.addEventListener('change', (e) => {
      this.currentMonth = e.target.value;
      this.renderLeaderboard();
    });
  }

  loadStoredLeague() {
    const storedId = localStorage.getItem('fpl_league_id');
    if (storedId) {
      this.el.leagueIdInput.value = storedId;
      this.loadLeague();
    }
  }

  // ============================================
  // API Methods
  // ============================================

  async fetchAPI(endpoint) {
    const url = `${CONFIG.API_BASE}${endpoint}`;
    
    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error(`[FPL API] Failed to fetch ${endpoint}:`, error);
      throw error;
    }
  }

  async fetchWithCache(endpoint, cacheKey, ttl) {
    const cached = this.cache.get(cacheKey);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < ttl) {
      return cached.data;
    }
    
    const data = await this.fetchAPI(endpoint);
    this.cache.set(cacheKey, { data, timestamp: now });
    
    return data;
  }

  // ============================================
  // Data Fetching
  // ============================================

  async fetchBootstrap() {
    return this.fetchWithCache(
      '/bootstrap-static/',
      'bootstrap',
      CONFIG.CACHE.BOOTSTRAP
    );
  }

  async fetchFixtures() {
    return this.fetchWithCache(
      '/fixtures/',
      'fixtures',
      CONFIG.CACHE.FIXTURES
    );
  }

  async fetchEventStatus() {
    return this.fetchWithCache(
      '/event-status/',
      'event-status',
      CONFIG.CACHE.LIVE_DATA
    );
  }

  async fetchLiveData(gameweek) {
    return this.fetchWithCache(
      `/event/${gameweek}/live/`,
      `live-${gameweek}`,
      CONFIG.CACHE.LIVE_DATA
    );
  }

  async fetchLeagueStandings(leagueId) {
    return this.fetchWithCache(
      `/leagues-classic/${leagueId}/standings/`,
      `standings-${leagueId}`,
      CONFIG.CACHE.STANDINGS
    );
  }

  async fetchManagerHistory(managerId) {
    return this.fetchWithCache(
      `/entry/${managerId}/history/`,
      `history-${managerId}`,
      CONFIG.CACHE.MANAGER_DATA
    );
  }

  async fetchManagerPicks(managerId, gameweek) {
    return this.fetchWithCache(
      `/entry/${managerId}/event/${gameweek}/picks/`,
      `picks-${managerId}-${gameweek}`,
      CONFIG.CACHE.LIVE_DATA
    );
  }

  // ============================================
  // Main Actions
  // ============================================

  async loadLeague() {
    const leagueId = this.el.leagueIdInput.value.trim();
    
    if (!leagueId) {
      this.showError('Please enter a League ID');
      return;
    }
    
    this.leagueId = leagueId;
    localStorage.setItem('fpl_league_id', leagueId);
    
    this.showLoading();
    
    try {
      // Fetch all required data in parallel
      const [bootstrap, fixtures, eventStatus, standings] = await Promise.all([
        this.fetchBootstrap(),
        this.fetchFixtures(),
        this.fetchEventStatus(),
        this.fetchLeagueStandings(leagueId),
      ]);
      
      // Store player data for lookups
      this.players = new Map(bootstrap.elements.map(p => [p.id, p]));
      this.teams = new Map(bootstrap.teams.map(t => [t.id, t]));
      this.events = bootstrap.events;
      
      // Determine current gameweek
      this.currentGameweek = this.getCurrentGameweek(eventStatus, bootstrap.events);
      
      // Build gameweek → date mapping
      this.buildGameweekDates(fixtures);
      
      // Build month options
      this.buildMonthOptions();
      
      // Fetch live data for current gameweek
      const liveData = await this.fetchLiveData(this.currentGameweek);
      this.liveData = liveData;
      
      // Fetch manager data
      await this.fetchManagerData(standings.standings.results);
      
      // Store standings
      this.standings = standings;
      
      // Update UI
      this.updateLeagueInfo(standings);
      this.renderLeaderboard();
      
      // Show leaderboard
      this.el.setupSection.style.display = 'none';
      this.el.leaderboardSection.style.display = 'block';
      
      // Start auto-refresh
      this.startAutoRefresh();
      
      // Update timestamp
      this.updateTimestamp();
      
    } catch (error) {
      console.error('Failed to load league:', error);
      this.showError('Failed to load league. Please check the League ID and try again.');
    }
  }

  async refresh() {
    if (!this.leagueId) return;
    
    // Add spinning animation to refresh button
    this.el.refreshBtn.classList.add('refreshing');
    
    try {
      // Clear cache for live data
      this.cache.delete(`live-${this.currentGameweek}`);
      this.cache.delete(`standings-${this.leagueId}`);
      this.cache.delete('event-status');
      
      // Clear manager picks cache
      if (this.standings?.standings?.results) {
        this.standings.standings.results.forEach(m => {
          this.cache.delete(`picks-${m.entry}-${this.currentGameweek}`);
        });
      }
      
      // Re-fetch live data
      const [eventStatus, standings, liveData] = await Promise.all([
        this.fetchEventStatus(),
        this.fetchLeagueStandings(this.leagueId),
        this.fetchLiveData(this.currentGameweek),
      ]);
      
      this.currentGameweek = this.getCurrentGameweek(eventStatus, this.events);
      this.liveData = liveData;
      this.standings = standings;
      
      // Re-fetch manager data
      await this.fetchManagerData(standings.standings.results);
      
      // Re-render
      this.renderLeaderboard();
      this.updateTimestamp();
      
    } catch (error) {
      console.error('Refresh failed:', error);
    } finally {
      this.el.refreshBtn.classList.remove('refreshing');
    }
  }

  async fetchManagerData(managers) {
    const batchSize = CONFIG.MAX_CONCURRENT_REQUESTS || 10;
    this.managerData = new Map();
    
    // Fetch in batches to avoid overwhelming the API
    for (let i = 0; i < managers.length; i += batchSize) {
      const batch = managers.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (manager) => {
        try {
          const [history, picks] = await Promise.all([
            this.fetchManagerHistory(manager.entry),
            this.fetchManagerPicks(manager.entry, this.currentGameweek),
          ]);
          
          this.managerData.set(manager.entry, { history, picks });
        } catch (error) {
          console.warn(`Failed to fetch data for manager ${manager.entry}:`, error);
        }
      }));
    }
  }

  // ============================================
  // Data Processing
  // ============================================

  getCurrentGameweek(eventStatus, events) {
    // Try to find active gameweek from status
    const active = eventStatus?.status?.find(s => s.event);
    if (active) return active.event;
    
    // Fallback: find current gameweek from events
    const now = new Date();
    const currentEvent = events?.find(e => {
      const deadline = new Date(e.deadline_time);
      return e.is_current || (deadline > now && e.is_next);
    });
    
    return currentEvent?.id || 1;
  }

  buildGameweekDates(fixtures) {
    this.gameweekDates.clear();
    
    fixtures.forEach(fixture => {
      if (fixture.event && fixture.kickoff_time) {
        const gw = fixture.event;
        const date = new Date(fixture.kickoff_time);
        
        // Store earliest kickoff for each gameweek
        if (!this.gameweekDates.has(gw) || date < this.gameweekDates.get(gw)) {
          this.gameweekDates.set(gw, date);
        }
      }
    });
  }

  buildMonthOptions() {
    const months = new Map();
    const now = new Date();
    
    // Add months from gameweeks
    this.gameweekDates.forEach((date, gw) => {
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      if (!months.has(key)) {
        months.set(key, date);
      }
    });
    
    // Sort chronologically
    this.availableMonths = Array.from(months.keys()).sort();
    
    // Set current month as default
    const currentKey = `${now.getFullYear()}-${now.getMonth()}`;
    this.currentMonth = this.availableMonths.includes(currentKey) 
      ? currentKey 
      : this.availableMonths[this.availableMonths.length - 1];
    
    // Populate dropdown
    this.el.monthFilter.innerHTML = '';
    this.availableMonths.forEach(key => {
      const [year, month] = key.split('-').map(Number);
      const label = new Date(year, month).toLocaleDateString('en-GB', { 
        month: 'long', 
        year: 'numeric' 
      });
      
      const option = document.createElement('option');
      option.value = key;
      option.textContent = label;
      option.selected = key === this.currentMonth;
      
      this.el.monthFilter.appendChild(option);
    });
  }

  getGameweeksForMonth(monthKey) {
    const [year, month] = monthKey.split('-').map(Number);
    const gameweeks = [];
    
    this.gameweekDates.forEach((date, gw) => {
      if (date.getFullYear() === year && date.getMonth() === month) {
        gameweeks.push(gw);
      }
    });
    
    return gameweeks.sort((a, b) => a - b);
  }

  calculateScores() {
    if (!this.standings?.standings?.results) return [];
    
    const monthGameweeks = this.getGameweeksForMonth(this.currentMonth);
    
    return this.standings.standings.results.map(manager => {
      const data = this.managerData.get(manager.entry);
      if (!data) {
        return {
          ...manager,
          gameweekPoints: 0,
          monthlyPoints: 0,
          playedPlayers: 0,
          captain: null,
          captainPlayed: false,
        };
      }
      
      // Gameweek points from history
      const gwData = data.history?.current?.find(h => h.event === this.currentGameweek);
      const gameweekPoints = gwData?.points || 0;
      
      // Monthly points (sum of gameweeks in selected month)
      let monthlyPoints = 0;
      if (data.history?.current) {
        data.history.current.forEach(h => {
          if (monthGameweeks.includes(h.event)) {
            monthlyPoints += h.points;
          }
        });
      }
      
      // Calculate live score adjustments
      const liveInfo = this.calculateLiveInfo(data.picks);
      
      return {
        ...manager,
        gameweekPoints: gameweekPoints + liveInfo.bonusPoints,
        monthlyPoints,
        playedPlayers: liveInfo.played,
        captain: liveInfo.captainName,
        captainPlayed: liveInfo.captainPlayed,
      };
    });
  }

  calculateLiveInfo(picks) {
    if (!picks?.picks || !this.liveData?.elements) {
      return { played: 0, captainName: null, captainPlayed: false, bonusPoints: 0 };
    }
    
    let played = 0;
    let captainName = null;
    let captainPlayed = false;
    
    // Only count first 11 (not bench)
    const starting11 = picks.picks.slice(0, 11);
    
    starting11.forEach(pick => {
      const liveElement = this.liveData.elements.find(e => e.id === pick.element);
      const hasPlayed = liveElement?.stats?.minutes > 0;
      
      if (hasPlayed) played++;
      
      // Check if captain
      if (pick.is_captain) {
        const player = this.players.get(pick.element);
        captainName = player?.web_name || 'Unknown';
        captainPlayed = hasPlayed;
      }
    });
    
    return { played, captainName, captainPlayed, bonusPoints: 0 };
  }

  // ============================================
  // Rendering
  // ============================================

  updateLeagueInfo(standings) {
    this.el.leagueName.textContent = standings.league.name;
    this.el.leagueDetails.textContent = `${standings.standings.results.length} teams`;
  }

  renderLeaderboard() {
    // Calculate scores
    const scores = this.calculateScores();
    
    // Sort by the current view
    const sorted = this.sortScores(scores);
    
    // Update stats
    this.updateStats(sorted);
    
    // Render table
    this.el.leaderboardBody.innerHTML = '';
    
    sorted.forEach((manager, index) => {
      const row = this.createRow(manager, index + 1);
      this.el.leaderboardBody.appendChild(row);
    });
    
    // Hide loading
    this.hideLoading();
  }

  updateStats(scores) {
    this.el.statGameweek.textContent = `GW${this.currentGameweek}`;
    this.el.statTeams.textContent = scores.length;
    
    if (scores.length > 0) {
      const scoreField = this.currentView === 'monthly' ? 'monthlyPoints' : 'gameweekPoints';
      const values = scores.map(s => s[scoreField]);
      
      this.el.statHighest.textContent = Math.max(...values);
      this.el.statAverage.textContent = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    }
  }

  sortScores(scores) {
    const field = this.currentView === 'monthly' ? 'monthlyPoints' : 'gameweekPoints';
    
    return [...scores].sort((a, b) => {
      // Primary sort by selected field
      if (b[field] !== a[field]) {
        return b[field] - a[field];
      }
      // Secondary sort by gameweek points
      if (b.gameweekPoints !== a.gameweekPoints) {
        return b.gameweekPoints - a.gameweekPoints;
      }
      // Tertiary sort by total points
      return b.total - a.total;
    });
  }

  createRow(manager, rank) {
    const row = document.createElement('tr');
    
    // Rank badge
    const rankClass = rank <= 3 ? `rank-${rank}` : 'rank-other';
    
    // Score field based on view
    const mainScore = this.currentView === 'monthly' ? manager.monthlyPoints : manager.gameweekPoints;
    
    row.innerHTML = `
      <td class="col-rank">
        <span class="rank-badge ${rankClass}">${rank}</span>
      </td>
      <td class="col-manager">
        <span class="manager-name">${this.escapeHtml(manager.player_name || 'Unknown')}</span>
      </td>
      <td class="col-team">
        <span class="team-name">${this.escapeHtml(manager.entry_name)}</span>
      </td>
      <td class="col-gw">
        <span class="points-gw">${manager.gameweekPoints}</span>
      </td>
      <td class="col-score">
        <span class="points-main">${mainScore}</span>
      </td>
      <td class="col-played">
        <span class="played-display">
          <span class="count">${manager.playedPlayers}</span><span class="total">/11</span>
        </span>
      </td>
      <td class="col-captain">
        <span class="captain-display">
          <span class="captain-name">${this.escapeHtml(manager.captain || '--')}</span>
          <span class="captain-status">${manager.captain ? (manager.captainPlayed ? '✅' : '⏳') : ''}</span>
        </span>
      </td>
    `;
    
    return row;
  }

  switchView(view) {
    this.currentView = view;
    
    // Update button states
    this.el.viewButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
    
    // Update header
    this.el.scoreHeader.textContent = view === 'monthly' ? 'Monthly' : 'GW';
    
    // Re-render
    this.renderLeaderboard();
  }

  // ============================================
  // UI Helpers
  // ============================================

  showSetup() {
    this.el.leaderboardSection.style.display = 'none';
    this.el.setupSection.style.display = 'flex';
    this.stopAutoRefresh();
  }

  showLoading() {
    this.el.loadingIndicator.style.display = 'flex';
    this.el.errorMessage.style.display = 'none';
  }

  hideLoading() {
    this.el.loadingIndicator.style.display = 'none';
  }

  showError(message) {
    this.el.errorMessage.querySelector('p').textContent = message;
    this.el.errorMessage.style.display = 'flex';
    this.hideLoading();
  }

  updateTimestamp() {
    const now = new Date();
    this.el.lastUpdated.textContent = now.toLocaleTimeString('en-GB', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  }

  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ============================================
  // Auto-refresh
  // ============================================

  startAutoRefresh() {
    this.stopAutoRefresh();
    this.refreshInterval = setInterval(() => {
      this.refresh();
    }, CONFIG.REFRESH_INTERVAL);
  }

  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.fplApp = new FPLLiveTable();
});
