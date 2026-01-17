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
    this.expandedRows = new Set(); // Track which rows are expanded
    
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
      changeLeagueBtn: document.getElementById('changeLeagueBtn'),
      
      // Controls
      monthFilter: document.getElementById('monthFilter'),
      
      // Gameweek
      gwNumber: document.getElementById('gwNumber'),
      gwStatus: document.getElementById('gwStatus'),
      
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
    
    // Month filter
    this.el.monthFilter.addEventListener('change', (e) => {
      this.currentMonth = e.target.value;
      this.renderLeaderboard();
    });
  }

  loadStoredLeague() {
    // Use default league ID if configured, otherwise check localStorage
    const defaultId = CONFIG.DEFAULT_LEAGUE_ID;
    const storedId = localStorage.getItem('fpl_league_id');
    
    if (defaultId) {
      this.el.leagueIdInput.value = defaultId;
      this.loadLeague();
    } else if (storedId) {
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
      this.fixtures = fixtures;
      
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
    
    // Populate dropdown (month name only, no year)
    this.el.monthFilter.innerHTML = '';
    this.availableMonths.forEach(key => {
      const [year, month] = key.split('-').map(Number);
      const label = new Date(year, month).toLocaleDateString('en-GB', { 
        month: 'long'
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
          maxPlayers: 11,
          captain: null,
          captainPlayed: false,
          activeChip: null,
          livePoints: 0,
          picks: null,
        };
      }
      
      // Calculate live score (includes bonus points)
      const liveInfo = this.calculateLiveInfo(data.picks);
      
      // Use live calculated points for current gameweek (more accurate during live matches)
      const gameweekPoints = liveInfo.livePoints;
      
      // Monthly points: sum historical GWs in month (excluding current) + current live points
      let monthlyPoints = 0;
      if (data.history?.current) {
        data.history.current.forEach(h => {
          // Only add historical points for GWs in this month that aren't the current one
          if (monthGameweeks.includes(h.event) && h.event !== this.currentGameweek) {
            monthlyPoints += h.points;
          }
        });
      }
      // Add current GW live points if it's in the selected month
      if (monthGameweeks.includes(this.currentGameweek)) {
        monthlyPoints += gameweekPoints;
      }
      
      return {
        ...manager,
        gameweekPoints,
        monthlyPoints,
        playedPlayers: liveInfo.played,
        maxPlayers: liveInfo.maxPlayers || 11,
        captain: liveInfo.captainName,
        captainPlayed: liveInfo.captainPlayed,
        activeChip: liveInfo.activeChip,
        livePoints: liveInfo.livePoints,
        picks: data.picks, // Store picks for player detail view
      };
    });
  }

  // Calculate provisional bonus from BPS scores for each fixture
  calculateProvisionalBonus() {
    if (!this.fixtures || !this.liveData?.elements || !this.players) {
      return new Map();
    }
    
    const bonusMap = new Map(); // playerId -> provisional bonus points
    
    // Get current GW fixtures that have started
    const gwFixtures = this.fixtures.filter(f => 
      f.event === this.currentGameweek && f.started
    );
    
    gwFixtures.forEach(fixture => {
      // Find all players in this fixture (by team)
      const playersInFixture = [];
      
      this.liveData.elements.forEach(element => {
        const player = this.players.get(element.id);
        if (player && (player.team === fixture.team_h || player.team === fixture.team_a)) {
          // Only include players who have played (minutes > 0)
          if (element.stats?.minutes > 0) {
            playersInFixture.push({
              id: element.id,
              bps: element.stats?.bps || 0,
              name: player.web_name
            });
          }
        }
      });
      
      // Sort by BPS descending
      playersInFixture.sort((a, b) => b.bps - a.bps);
      
      // Award bonus points (3, 2, 1) with tie handling
      // FPL rules: tied players share same bonus, next position(s) skipped
      // - Two tied 1st: both get 3, next gets 1
      // - Two tied 2nd: 1st gets 3, both get 2, no 3rd
      // - Two tied 3rd: 1st gets 3, 2nd gets 2, BOTH get 1 (4 players can get bonus)
      if (playersInFixture.length > 0) {
        let position = 1; // Track position (1st, 2nd, 3rd)
        let i = 0;
        
        while (i < playersInFixture.length && position <= 3) {
          const currentBps = playersInFixture[i].bps;
          
          // Find all players tied at this BPS
          const tiedPlayers = [];
          while (i < playersInFixture.length && playersInFixture[i].bps === currentBps) {
            tiedPlayers.push(playersInFixture[i]);
            i++;
          }
          
          // Calculate bonus for this position (3 for 1st, 2 for 2nd, 1 for 3rd)
          const bonus = 4 - position; // position 1 = 3pts, position 2 = 2pts, position 3 = 1pt
          
          // All tied players get the same bonus
          tiedPlayers.forEach(p => {
            bonusMap.set(p.id, bonus);
          });
          
          // Move position forward by number of tied players
          position += tiedPlayers.length;
        }
      }
    });
    
    return bonusMap;
  }

  calculateLiveInfo(picks) {
    if (!picks?.picks || !this.liveData?.elements) {
      return { played: 0, captainName: null, captainPlayed: false, bonusPoints: 0, activeChip: null, livePoints: 0 };
    }
    
    // Calculate provisional bonus from BPS
    const provisionalBonus = this.calculateProvisionalBonus();
    
    let played = 0;
    let captainName = null;
    let captainPlayed = false;
    let livePoints = 0;
    
    // Check for active chip
    const activeChip = picks.active_chip; // 'bboost', '3xc', 'freehit', 'wildcard'
    const isBenchBoost = activeChip === 'bboost';
    
    // Process automatic substitutions
    const autoSubs = picks.automatic_subs || [];
    const subbedOut = new Set(autoSubs.map(sub => sub.element_out));
    const subbedIn = new Set(autoSubs.map(sub => sub.element_in));
    
    // Determine which players are actually playing (accounting for auto-subs)
    const activePicks = picks.picks.map((pick, index) => {
      const isStarting = index < 11;
      const wasSubbedOut = subbedOut.has(pick.element);
      const wasSubbedIn = subbedIn.has(pick.element);
      
      // Player is active if:
      // - They're in starting 11 and NOT subbed out, OR
      // - They're on bench and were subbed in, OR
      // - Bench Boost is active and they're on bench
      const isActive = (isStarting && !wasSubbedOut) || 
                       wasSubbedIn || 
                       (isBenchBoost && index >= 11);
      
      return { ...pick, isActive, wasSubbedIn, wasSubbedOut };
    });
    
    // Calculate points and played count
    activePicks.forEach(pick => {
      if (!pick.isActive) return;
      
      const liveElement = this.liveData.elements.find(e => e.id === pick.element);
      const hasPlayed = liveElement?.stats?.minutes > 0;
      
      // Get base points from API
      const basePoints = liveElement?.stats?.total_points || 0;
      
      // Use API bonus if available, otherwise use our calculated provisional bonus
      const apiBonus = liveElement?.stats?.bonus || 0;
      const calcBonus = provisionalBonus.get(pick.element) || 0;
      const bonusPoints = apiBonus > 0 ? apiBonus : calcBonus;
      
      const points = basePoints + bonusPoints;
      
      if (hasPlayed) {
        played++;
        // Apply multiplier (1 for normal, 2 for captain, 3 for triple captain)
        livePoints += points * pick.multiplier;
      }
      
      // Check if captain
      if (pick.is_captain) {
        const player = this.players.get(pick.element);
        captainName = player?.web_name || 'Unknown';
        captainPlayed = hasPlayed;
      }
    });
    
    // For bench boost, count all 15 potential players
    const maxPlayers = isBenchBoost ? 15 : 11;
    
    return { 
      played, 
      maxPlayers,
      captainName, 
      captainPlayed, 
      bonusPoints: 0, 
      activeChip,
      livePoints,
    };
  }

  // Get detailed player info for a manager's picks
  getPlayerDetails(picks) {
    if (!picks?.picks) return { starting: [], bench: [], activeChip: null };
    
    const activeChip = picks.active_chip;
    const isBenchBoost = activeChip === 'bboost';
    
    // Calculate provisional bonus from BPS
    const provisionalBonus = this.calculateProvisionalBonus();
    
    // Process automatic substitutions
    const autoSubs = picks.automatic_subs || [];
    const subbedOutMap = new Map(autoSubs.map(sub => [sub.element_out, sub.element_in]));
    const subbedInSet = new Set(autoSubs.map(sub => sub.element_in));
    
    const getPlayerInfo = (pick, index) => {
      const player = this.players.get(pick.element);
      const team = player ? this.teams.get(player.team) : null;
      const liveElement = this.liveData?.elements?.find(e => e.id === pick.element);
      
      // Get base points from API
      const basePoints = liveElement?.stats?.total_points || 0;
      
      // Use API bonus if available, otherwise use our calculated provisional bonus
      const apiBonus = liveElement?.stats?.bonus || 0;
      const calcBonus = provisionalBonus.get(pick.element) || 0;
      const bonusPoints = apiBonus > 0 ? apiBonus : calcBonus;
      
      const points = basePoints + bonusPoints;
      const minutes = liveElement?.stats?.minutes || 0;
      const hasPlayed = minutes > 0;
      
      // Check auto-sub status
      const wasSubbedOut = subbedOutMap.has(pick.element);
      const wasSubbedIn = subbedInSet.has(pick.element);
      const isStarting = index < 11;
      
      // Determine if player's points count
      const pointsCount = (isStarting && !wasSubbedOut) || 
                          wasSubbedIn || 
                          (isBenchBoost && index >= 11);
      
      // Calculate effective points (captain gets 2x, triple captain 3x)
      let effectivePoints = pointsCount ? points * pick.multiplier : 0;
      
      return {
        id: pick.element,
        name: player?.web_name || 'Unknown',
        teamName: team?.short_name || '???',
        teamCode: team?.code || 0,
        position: player?.element_type || 0, // 1=GK, 2=DEF, 3=MID, 4=FWD
        points: points,
        bonusPoints: bonusPoints,
        effectivePoints: effectivePoints,
        multiplier: pick.multiplier,
        isCaptain: pick.is_captain,
        isViceCaptain: pick.is_vice_captain,
        hasPlayed: hasPlayed,
        minutes: minutes,
        isBench: index >= 11,
        wasSubbedOut: wasSubbedOut,
        wasSubbedIn: wasSubbedIn,
        pointsCount: pointsCount,
      };
    };
    
    const allPlayers = picks.picks.map((pick, index) => getPlayerInfo(pick, index));
    
    return {
      starting: allPlayers.slice(0, 11),
      bench: allPlayers.slice(11),
      activeChip: activeChip,
    };
  }

  // ============================================
  // Rendering
  // ============================================

  updateLeagueInfo(standings) {
    this.el.leagueName.textContent = standings.league.name;
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
      
      // Add expanded player details row if this row is expanded
      if (this.expandedRows.has(manager.entry)) {
        const detailsRow = this.createPlayerDetailsRow(manager);
        this.el.leaderboardBody.appendChild(detailsRow);
      }
    });
    
    // Hide loading
    this.hideLoading();
  }

  updateStats(scores) {
    // Update gameweek number
    this.el.gwNumber.textContent = this.currentGameweek;
    
    // Determine if gameweek is live or finished
    const currentEvent = this.events?.find(e => e.id === this.currentGameweek);
    const isFinished = currentEvent?.finished || false;
    
    // Check if any fixtures are currently in progress
    const isLive = !isFinished && this.fixtures?.some(f => 
      f.event === this.currentGameweek && f.started && !f.finished
    );
    
    // Update status badge
    if (isFinished) {
      this.el.gwStatus.innerHTML = '<span class="status-done">DONE</span>';
    } else if (isLive) {
      this.el.gwStatus.innerHTML = '<span class="status-live">LIVE</span>';
    } else {
      // Upcoming or between fixtures
      this.el.gwStatus.innerHTML = '';
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
    row.className = 'manager-row';
    row.dataset.managerId = manager.entry;
    
    // Check if expanded
    const isExpanded = this.expandedRows.has(manager.entry);
    if (isExpanded) row.classList.add('expanded');
    
    // Rank badge - only rank 1 gets special treatment (winner takes all)
    const rankClass = rank === 1 ? 'rank-winner' : 'rank-other';
    const rankContent = rank === 1 ? '💰' : rank;
    
    // Score field based on view
    const mainScore = this.currentView === 'monthly' ? manager.monthlyPoints : manager.gameweekPoints;
    
    // Chip badge
    const chipBadge = manager.activeChip ? this.getChipBadge(manager.activeChip) : '';
    
    row.innerHTML = `
      <td class="col-rank">
        <span class="rank-badge ${rankClass}">${rankContent}</span>
      </td>
      <td class="col-manager">
        <div class="manager-cell">
          <span class="expand-btn">${isExpanded ? '▼' : '▶'}</span>
          <div class="manager-info">
            <span class="manager-name">${this.escapeHtml(manager.player_name || 'Unknown')}</span>
            <span class="team-name">${this.escapeHtml(manager.entry_name)}</span>
          </div>
          ${chipBadge}
        </div>
      </td>
      <td class="col-gw">
        <span class="points-gw">${manager.gameweekPoints}</span>
      </td>
      <td class="col-score">
        <span class="points-main">${mainScore}</span>
      </td>
      <td class="col-played hide-mobile">
        <span class="played-display">
          <span class="count">${manager.playedPlayers}</span><span class="total">/${manager.maxPlayers}</span>
        </span>
      </td>
      <td class="col-captain hide-mobile">
        <span class="captain-display">
          <span class="captain-name">${this.escapeHtml(manager.captain || '--')}</span>
          <span class="captain-status">${manager.captain ? (manager.captainPlayed ? '✅' : '⏳') : ''}</span>
        </span>
      </td>
    `;
    
    // Add click handler to toggle expansion
    row.addEventListener('click', () => this.toggleRowExpansion(manager));
    
    return row;
  }

  createPlayerDetailsRow(manager) {
    const row = document.createElement('tr');
    row.className = 'player-details-row';
    row.dataset.managerId = manager.entry;
    
    const details = this.getPlayerDetails(manager.picks);
    
    // Group starting players by position
    const positions = {
      1: { name: 'GK', players: [] },
      2: { name: 'DEF', players: [] },
      3: { name: 'MID', players: [] },
      4: { name: 'FWD', players: [] },
    };
    
    details.starting.forEach(player => {
      if (positions[player.position]) {
        positions[player.position].players.push(player);
      }
    });
    
    row.innerHTML = `
      <td colspan="7">
        <div class="player-grid-container">
          <div class="player-grid">
            ${Object.values(positions).map(pos => `
              <div class="position-group">
                <div class="position-label">${pos.name}</div>
                <div class="position-players">
                  ${pos.players.map(p => this.createPlayerCard(p)).join('')}
                </div>
              </div>
            `).join('')}
          </div>
          <div class="bench-section">
            <div class="bench-label">BENCH</div>
            <div class="bench-players">
              ${details.bench.map(p => this.createPlayerCard(p, true)).join('')}
            </div>
          </div>
        </div>
      </td>
    `;
    
    return row;
  }

  createPlayerCard(player, isBench = false) {
    const captainBadge = player.isCaptain ? '<span class="captain-badge">C</span>' : 
                         player.isViceCaptain ? '<span class="vc-badge">V</span>' : '';
    
    // Determine points display class
    let pointsClass = 'points-pending';
    if (player.hasPlayed && player.pointsCount) {
      pointsClass = player.effectivePoints >= 6 ? 'points-high' : 
                    player.effectivePoints >= 4 ? 'points-mid' : 'points-low';
    } else if (player.wasSubbedOut) {
      pointsClass = 'points-subbed-out';
    }
    
    const multiplierBadge = player.multiplier > 1 && player.pointsCount ? 
      `<span class="multiplier-badge">×${player.multiplier}</span>` : '';
    
    // Bonus points indicator
    const bonusBadge = player.bonusPoints > 0 && player.pointsCount ? 
      `<span class="bonus-badge">+${player.bonusPoints}</span>` : '';
    
    // Auto-sub indicator
    const subBadge = player.wasSubbedOut ? '<span class="sub-badge sub-out">↓</span>' :
                     player.wasSubbedIn ? '<span class="sub-badge sub-in">↑</span>' : '';
    
    // Card classes
    const cardClasses = [
      'player-card',
      isBench ? 'bench' : '',
      player.hasPlayed ? 'played' : 'not-played',
      player.wasSubbedOut ? 'subbed-out' : '',
      player.wasSubbedIn ? 'subbed-in' : '',
      !player.pointsCount ? 'no-points' : '',
    ].filter(Boolean).join(' ');
    
    // Points display
    let pointsDisplay = '-';
    if (player.hasPlayed) {
      pointsDisplay = player.pointsCount ? player.effectivePoints : `<s>${player.points}</s>`;
    }
    
    return `
      <div class="${cardClasses}">
        <div class="player-team-badge" style="background-color: ${this.getTeamColor(player.teamCode)}">
          ${player.teamName}
        </div>
        ${captainBadge}
        ${subBadge}
        <div class="player-name">${player.name}</div>
        <div class="player-points ${pointsClass}">
          ${pointsDisplay}
          ${multiplierBadge}
          ${bonusBadge}
        </div>
      </div>
    `;
  }

  getChipBadge(chip) {
    const chips = {
      'bboost': { label: 'BB', title: 'Bench Boost', color: '#10b981' },
      '3xc': { label: 'TC', title: 'Triple Captain', color: '#f59e0b' },
      'freehit': { label: 'FH', title: 'Free Hit', color: '#3b82f6' },
      'wildcard': { label: 'WC', title: 'Wildcard', color: '#8b5cf6' },
    };
    
    const chipInfo = chips[chip];
    if (!chipInfo) return '';
    
    return `<span class="chip-badge" style="background: ${chipInfo.color}" title="${chipInfo.title}">${chipInfo.label}</span>`;
  }

  getTeamColor(teamCode) {
    // Premier League team colors by code
    const teamColors = {
      3: '#EF0107',   // Arsenal
      7: '#670E36',   // Aston Villa
      91: '#e30613',  // Bournemouth
      94: '#0057B8',  // Brentford
      36: '#0057B8',  // Brighton
      8: '#034694',   // Chelsea
      31: '#1B458F',  // Crystal Palace
      11: '#003399',  // Everton
      54: '#FFFFFF',  // Fulham
      40: '#C8102E',  // Ipswich
      2: '#003090',   // Leicester
      14: '#C8102E',  // Liverpool
      43: '#6CABDD',  // Man City
      1: '#DA291C',   // Man Utd
      4: '#241F20',   // Newcastle
      17: '#DD0000',  // Nottingham Forest
      20: '#D71920',  // Southampton
      6: '#132257',   // Spurs
      21: '#7A263A',  // West Ham
      39: '#FDB913',  // Wolves
    };
    return teamColors[teamCode] || '#333';
  }

  toggleRowExpansion(manager) {
    if (this.expandedRows.has(manager.entry)) {
      this.expandedRows.delete(manager.entry);
    } else {
      this.expandedRows.add(manager.entry);
    }
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
