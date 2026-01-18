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
    this.expandedFixtures = new Set(); // Track which fixtures are expanded
    
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
      
      // Fixtures
      fixturesGrid: document.getElementById('fixturesGrid'),
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
      this.renderFixtures();
      
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
      this.renderFixtures();
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
    
    // First pass: calculate all scores
    const scores = this.standings.standings.results.map(manager => {
      const data = this.managerData.get(manager.entry);
      if (!data) {
        return {
          ...manager,
          gameweekPoints: 0,
          monthlyPoints: 0,
          previousMonthlyPoints: 0,
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
      let monthlyPointsBeforeCurrentGW = 0;
      if (data.history?.current) {
        data.history.current.forEach(h => {
          // Only add historical points for GWs in this month that aren't the current one
          if (monthGameweeks.includes(h.event) && h.event !== this.currentGameweek) {
            monthlyPointsBeforeCurrentGW += h.points;
          }
        });
      }
      
      // Calculate current monthly total
      let monthlyPoints = monthlyPointsBeforeCurrentGW;
      if (monthGameweeks.includes(this.currentGameweek)) {
        monthlyPoints += gameweekPoints;
      }
      
      return {
        ...manager,
        gameweekPoints,
        monthlyPoints,
        previousMonthlyPoints: monthlyPointsBeforeCurrentGW, // Points before current GW
        playedPlayers: liveInfo.played,
        maxPlayers: liveInfo.maxPlayers || 11,
        captain: liveInfo.captainName,
        captainPlayed: liveInfo.captainPlayed,
        activeChip: liveInfo.activeChip,
        livePoints: liveInfo.livePoints,
        picks: data.picks, // Store picks for player detail view
      };
    });
    
    return scores;
  }

  calculatePositionChanges(scores) {
    // Sort by current monthly points to get current positions
    const currentSorted = [...scores].sort((a, b) => {
      if (b.monthlyPoints !== a.monthlyPoints) return b.monthlyPoints - a.monthlyPoints;
      if (b.gameweekPoints !== a.gameweekPoints) return b.gameweekPoints - a.gameweekPoints;
      return b.total - a.total;
    });
    
    // Sort by previous monthly points (before current GW) to get previous positions
    const previousSorted = [...scores].sort((a, b) => {
      if (b.previousMonthlyPoints !== a.previousMonthlyPoints) return b.previousMonthlyPoints - a.previousMonthlyPoints;
      return b.total - a.total;
    });
    
    // Create position maps
    const currentPositions = new Map();
    currentSorted.forEach((m, idx) => currentPositions.set(m.entry, idx + 1));
    
    const previousPositions = new Map();
    previousSorted.forEach((m, idx) => previousPositions.set(m.entry, idx + 1));
    
    // Calculate position change for each manager
    return scores.map(manager => {
      const currentPos = currentPositions.get(manager.entry);
      const previousPos = previousPositions.get(manager.entry);
      const positionChange = previousPos - currentPos; // Positive = moved up, Negative = moved down
      
      return {
        ...manager,
        currentPosition: currentPos,
        previousPosition: previousPos,
        positionChange: positionChange,
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

  // Calculate auto-subs locally when FPL API hasn't processed them yet
  calculateLocalAutoSubs(picks) {
    if (!picks?.picks || !this.liveData?.elements || !this.fixtures || !this.players) {
      return [];
    }
    
    // If FPL has already processed auto-subs, use those
    if (picks.automatic_subs && picks.automatic_subs.length > 0) {
      return picks.automatic_subs;
    }
    
    const autoSubs = [];
    const starting = picks.picks.slice(0, 11);
    const bench = picks.picks.slice(11); // Positions 12-15 (indices 0-3 in bench array)
    
    // Track which bench players have been used
    const usedBenchPlayers = new Set();
    
    // Track current formation counts (after subs)
    // Position: 1=GK, 2=DEF, 3=MID, 4=FWD
    const formationCount = { 1: 0, 2: 0, 3: 0, 4: 0 };
    
    // Count current playing formation (players with minutes > 0 or fixture not finished)
    starting.forEach(pick => {
      const player = this.players.get(pick.element);
      const liveElement = this.liveData.elements.find(e => e.id === pick.element);
      const minutes = liveElement?.stats?.minutes || 0;
      
      // Check if fixture is finished
      const playerFixture = this.fixtures.find(f => 
        f.event === this.currentGameweek && 
        player && (f.team_h === player.team || f.team_a === player.team)
      );
      const fixtureFinished = playerFixture?.finished || playerFixture?.finished_provisional;
      
      // Player needs sub if: 0 minutes AND fixture finished
      const needsSub = minutes === 0 && fixtureFinished;
      
      if (!needsSub && player) {
        formationCount[player.element_type] = (formationCount[player.element_type] || 0) + 1;
      }
    });
    
    // Process each starting player that needs a sub
    for (const pick of starting) {
      const player = this.players.get(pick.element);
      if (!player) continue;
      
      const liveElement = this.liveData.elements.find(e => e.id === pick.element);
      const minutes = liveElement?.stats?.minutes || 0;
      
      // Check if fixture is finished
      const playerFixture = this.fixtures.find(f => 
        f.event === this.currentGameweek && 
        (f.team_h === player.team || f.team_a === player.team)
      );
      const fixtureFinished = playerFixture?.finished || playerFixture?.finished_provisional;
      
      // Skip if player doesn't need a sub
      if (minutes > 0 || !fixtureFinished) continue;
      
      // Find a valid bench replacement
      for (let i = 0; i < bench.length; i++) {
        const benchPick = bench[i];
        if (usedBenchPlayers.has(benchPick.element)) continue;
        
        const benchPlayer = this.players.get(benchPick.element);
        if (!benchPlayer) continue;
        
        // Check if bench player's fixture has started (they need to have data)
        const benchFixture = this.fixtures.find(f => 
          f.event === this.currentGameweek && 
          (f.team_h === benchPlayer.team || f.team_a === benchPlayer.team)
        );
        const benchFixtureStarted = benchFixture?.started;
        
        // Bench player must have their fixture started to be eligible
        if (!benchFixtureStarted) continue;
        
        // GK Rule: GK can only be replaced by GK (and vice versa)
        const isStartingGK = player.element_type === 1;
        const isBenchGK = benchPlayer.element_type === 1;
        
        if (isStartingGK && !isBenchGK) continue; // Starting GK needs bench GK
        if (!isStartingGK && isBenchGK) continue; // Outfield can't use bench GK
        
        // Formation check for outfield players
        if (!isStartingGK) {
          // Check if adding this bench player would result in a valid formation
          // Current formationCount = players who ARE playing (not needing subs)
          // We need to check: after adding benchPlayer, do we meet minimums?
          
          const newFormation = { ...formationCount };
          newFormation[benchPlayer.element_type] = (newFormation[benchPlayer.element_type] || 0) + 1;
          
          // Minimum requirements: 3 DEF, (no explicit min MID/FWD but implied 1 each)
          // The key rule: If we're below 3 DEF, we can ONLY accept a DEF
          if (formationCount[2] < 3 && benchPlayer.element_type !== 2) {
            continue; // Need a DEF to reach minimum, this isn't one
          }
          
          // Also check we don't exceed maximums (5 MID, 3 FWD typically)
          // These are rarely hit but let's be safe
          if (newFormation[3] > 5) continue; // Max 5 MID
          if (newFormation[4] > 3) continue; // Max 3 FWD
        }
        
        // Valid sub found!
        const subOut = this.players.get(pick.element);
        const subIn = benchPlayer;
        console.log(`[Auto-Sub] ${subOut?.web_name || 'Unknown'} (0 mins) → ${subIn?.web_name || 'Unknown'}`);
        
        autoSubs.push({
          element_in: benchPick.element,
          element_out: pick.element,
          entry: picks.entry,
          event: this.currentGameweek
        });
        
        // Update tracking
        usedBenchPlayers.add(benchPick.element);
        
        // Update formation count with the new player
        formationCount[benchPlayer.element_type] = (formationCount[benchPlayer.element_type] || 0) + 1;
        
        break; // Move to next starting player that needs sub
      }
    }
    
    if (autoSubs.length > 0) {
      console.log(`[Auto-Sub] Calculated ${autoSubs.length} local auto-sub(s) for entry ${picks.entry}`);
    }
    
    return autoSubs;
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
    
    // Process automatic substitutions - use local calculation if API hasn't processed yet
    const autoSubs = this.calculateLocalAutoSubs(picks);
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
      const apiBonus = liveElement?.stats?.bonus || 0;
      
      // IMPORTANT: Once FPL confirms bonus, total_points ALREADY includes it
      // So we only add our provisional calculation when API bonus is still 0
      const calcBonus = provisionalBonus.get(pick.element) || 0;
      const bonusToAdd = apiBonus > 0 ? 0 : calcBonus; // Don't double-count official bonus
      
      const points = basePoints + bonusToAdd;
      
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
    
    // Process automatic substitutions - use local calculation if API hasn't processed yet
    const autoSubs = this.calculateLocalAutoSubs(picks);
    const subbedOutMap = new Map(autoSubs.map(sub => [sub.element_out, sub.element_in]));
    const subbedInSet = new Set(autoSubs.map(sub => sub.element_in));
    
    const getPlayerInfo = (pick, index) => {
      const player = this.players.get(pick.element);
      const team = player ? this.teams.get(player.team) : null;
      const liveElement = this.liveData?.elements?.find(e => e.id === pick.element);
      
      // Get base points from API
      const basePoints = liveElement?.stats?.total_points || 0;
      const apiBonus = liveElement?.stats?.bonus || 0;
      
      // IMPORTANT: Once FPL confirms bonus, total_points ALREADY includes it
      // So we only add our provisional calculation when API bonus is still 0
      const calcBonus = provisionalBonus.get(pick.element) || 0;
      const bonusToAdd = apiBonus > 0 ? 0 : calcBonus; // Don't double-count official bonus
      
      // For display: show apiBonus if confirmed, otherwise show calculated
      const bonusPoints = apiBonus > 0 ? apiBonus : calcBonus;
      
      const points = basePoints + bonusToAdd;
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
      
      // Get fixture status for this player's team
      let fixtureStatus = 'upcoming'; // 'upcoming', 'playing', 'finished'
      if (player && this.fixtures) {
        const playerFixture = this.fixtures.find(f => 
          f.event === this.currentGameweek && 
          (f.team_h === player.team || f.team_a === player.team)
        );
        if (playerFixture) {
          if (playerFixture.finished || playerFixture.finished_provisional) {
            fixtureStatus = 'finished';
          } else if (playerFixture.started) {
            fixtureStatus = 'playing';
          }
        }
      }
      
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
        fixtureStatus: fixtureStatus,
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
    
    // Calculate position changes
    const scoresWithChanges = this.calculatePositionChanges(scores);
    
    // Sort by the current view
    const sorted = this.sortScores(scoresWithChanges);
    
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
    
    // Position change indicator
    const posChange = manager.positionChange || 0;
    let moveClass = 'same';
    let moveContent = '';
    if (posChange > 0) {
      moveClass = 'up';
      moveContent = posChange;
    } else if (posChange < 0) {
      moveClass = 'down';
      moveContent = Math.abs(posChange);
    }
    
    row.innerHTML = `
      <td class="col-rank">
        <span class="rank-badge ${rankClass}">${rankContent}</span>
      </td>
      <td class="col-move">
        <span class="move-indicator ${moveClass}">
          <span class="move-arrow"></span>
          ${moveContent}
        </span>
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
      <td class="col-played">
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
      <td colspan="8">
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
    
    // Fixture status indicator
    let statusIndicator = '';
    if (player.fixtureStatus === 'playing') {
      statusIndicator = '<span class="fixture-status playing" title="In Play">●</span>';
    } else if (player.fixtureStatus === 'finished') {
      statusIndicator = '<span class="fixture-status finished" title="Finished">✓</span>';
    }
    
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
        <div class="player-team-badge" style="background-color: ${this.getTeamColor(player.teamCode)}; color: ${this.getTeamTextColor(player.teamCode)}">
          ${player.teamName}
        </div>
        ${captainBadge}
        ${subBadge}
        <div class="player-name">${player.name}${statusIndicator}</div>
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
      90: '#7A263A',  // Burnley (claret - same as West Ham)
      8: '#034694',   // Chelsea
      31: '#1B458F',  // Crystal Palace
      11: '#003399',  // Everton
      54: '#FFFFFF',  // Fulham
      40: '#C8102E',  // Ipswich
      9: '#FFFFFF',   // Leeds (white background)
      2: '#003090',   // Leicester
      14: '#C8102E',  // Liverpool
      43: '#6CABDD',  // Man City
      1: '#DA291C',   // Man Utd
      4: '#241F20',   // Newcastle
      17: '#DD0000',  // Nottingham Forest
      20: '#D71920',  // Southampton
      6: '#132257',   // Spurs
      56: '#C8102E',  // Sunderland (red - same as Liverpool)
      21: '#7A263A',  // West Ham
      39: '#FDB913',  // Wolves
    };
    return teamColors[teamCode] || '#333';
  }

  getTeamTextColor(teamCode) {
    // Teams with light backgrounds need dark text
    const darkTextTeams = {
      54: '#000000',  // Fulham - black text on white
      9: '#0033A0',   // Leeds - royal blue text on white
      39: '#000000',  // Wolves - black text on gold
    };
    return darkTextTeams[teamCode] || '#FFFFFF';
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
  // Fixtures Rendering
  // ============================================

  renderFixtures() {
    if (!this.fixtures || !this.el.fixturesGrid) return;
    
    // Get current gameweek fixtures
    const gwFixtures = this.fixtures
      .filter(f => f.event === this.currentGameweek)
      .sort((a, b) => new Date(a.kickoff_time) - new Date(b.kickoff_time));
    
    this.el.fixturesGrid.innerHTML = '';
    
    gwFixtures.forEach(fixture => {
      const card = this.createFixtureCard(fixture);
      this.el.fixturesGrid.appendChild(card);
    });
  }

  createFixtureCard(fixture) {
    const card = document.createElement('div');
    card.className = 'fixture-card';
    card.dataset.fixtureId = fixture.id;
    
    const isExpanded = this.expandedFixtures.has(fixture.id);
    if (isExpanded) card.classList.add('expanded');
    
    const homeTeam = this.teams.get(fixture.team_h);
    const awayTeam = this.teams.get(fixture.team_a);
    
    // Determine fixture status
    const isLive = fixture.started && !fixture.finished && !fixture.finished_provisional;
    const isFinished = fixture.finished || fixture.finished_provisional;
    
    // Format kickoff time
    const kickoff = fixture.kickoff_time ? new Date(fixture.kickoff_time) : null;
    const kickoffStr = kickoff ? kickoff.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '--:--';
    
    // Get score or time
    let scoreContent;
    let statusIndicator = '<div class="fixture-status-indicator"></div>'; // Empty placeholder for alignment
    
    if (fixture.started) {
      scoreContent = `
        <div class="score-display">
          <span class="home-score">${fixture.team_h_score ?? 0}</span>
          <span class="score-separator">-</span>
          <span class="away-score">${fixture.team_a_score ?? 0}</span>
        </div>
      `;
      
      if (isLive) {
        statusIndicator = '<div class="fixture-status-indicator"><span class="status-live">LIVE</span></div>';
      } else if (isFinished) {
        statusIndicator = '<div class="fixture-status-indicator"><span class="status-ft">FT</span></div>';
      }
    } else {
      scoreContent = `<span class="kickoff-time">${kickoffStr}</span>`;
    }
    
    // Get fixture events (goals, assists, bonus)
    const events = this.getFixtureEvents(fixture);
    
    card.innerHTML = `
      <div class="fixture-header">
        ${statusIndicator}
        
        <div class="fixture-team home">
          <span class="team-name-fixture">${homeTeam?.short_name || 'HOME'}</span>
          <span class="team-badge" style="background-color: ${this.getTeamColor(homeTeam?.code)}; color: ${this.getTeamTextColor(homeTeam?.code)}">
            ${homeTeam?.short_name?.substring(0, 3) || 'HOM'}
          </span>
        </div>
        
        <div class="fixture-score-wrapper">
          <div class="fixture-score">
            ${scoreContent}
          </div>
        </div>
        
        <div class="fixture-team away">
          <span class="team-badge" style="background-color: ${this.getTeamColor(awayTeam?.code)}; color: ${this.getTeamTextColor(awayTeam?.code)}">
            ${awayTeam?.short_name?.substring(0, 3) || 'AWY'}
          </span>
          <span class="team-name-fixture">${awayTeam?.short_name || 'AWAY'}</span>
        </div>
        
        <span class="fixture-expand">▼</span>
      </div>
      
      <div class="fixture-details">
        <div class="details-grid">
          <div class="details-column">
            <div class="details-column-title">⚽ Goals</div>
            <div class="details-list">
              ${events.goals.length > 0 ? events.goals.map(g => `
                <div class="details-item">
                  <span class="team-indicator" style="background-color: ${this.getTeamColor(g.teamCode)}; color: ${this.getTeamTextColor(g.teamCode)}">${g.teamName}</span>
                  <span class="player-name-detail">${g.name}</span>
                  <span class="event-icon">${g.count > 1 ? `×${g.count}` : ''}</span>
                </div>
              `).join('') : '<div class="no-events">No goals</div>'}
            </div>
          </div>
          
          <div class="details-column">
            <div class="details-column-title">🅰️ Assists</div>
            <div class="details-list">
              ${events.assists.length > 0 ? events.assists.map(a => `
                <div class="details-item">
                  <span class="team-indicator" style="background-color: ${this.getTeamColor(a.teamCode)}; color: ${this.getTeamTextColor(a.teamCode)}">${a.teamName}</span>
                  <span class="player-name-detail">${a.name}</span>
                  <span class="event-icon">${a.count > 1 ? `×${a.count}` : ''}</span>
                </div>
              `).join('') : '<div class="no-events">No assists</div>'}
            </div>
          </div>
          
          <div class="details-column">
            <div class="details-column-title">🟨 Cards</div>
            <div class="details-list">
              ${events.cards.length > 0 ? events.cards.map(c => `
                <div class="details-item">
                  <span class="team-indicator" style="background-color: ${this.getTeamColor(c.teamCode)}; color: ${this.getTeamTextColor(c.teamCode)}">${c.teamName}</span>
                  <span class="player-name-detail">${c.name}</span>
                  <span class="card-icon ${c.cardType}"></span>
                </div>
              `).join('') : '<div class="no-events">No cards</div>'}
            </div>
          </div>
          
          <div class="details-column">
            <div class="details-column-title">⭐ Bonus${events.bonusConfirmed ? '' : ' (Proj)'}</div>
            <div class="details-list">
              ${events.bonus.length > 0 ? events.bonus.map(b => `
                <div class="details-item">
                  <span class="team-indicator" style="background-color: ${this.getTeamColor(b.teamCode)}; color: ${this.getTeamTextColor(b.teamCode)}">${b.teamName}</span>
                  <span class="player-name-detail">${b.name}</span>
                  <span class="bonus-value">+${b.bonus}</span>
                </div>
              `).join('') : '<div class="no-events">No bonus</div>'}
            </div>
          </div>
        </div>
      </div>
    `;
    
    // Add click handler to toggle expansion
    const header = card.querySelector('.fixture-header');
    header.addEventListener('click', () => this.toggleFixtureExpansion(fixture.id));
    
    return card;
  }

  getFixtureEvents(fixture) {
    const events = {
      goals: [],
      assists: [],
      cards: [],
      bonus: [],
      bonusConfirmed: false
    };
    
    if (!this.liveData?.elements || !fixture.started) return events;
    
    // Find all players in this fixture
    const homeTeam = this.teams.get(fixture.team_h);
    const awayTeam = this.teams.get(fixture.team_a);
    
    const playersInFixture = [];
    
    this.liveData.elements.forEach(element => {
      const player = this.players.get(element.id);
      if (!player) return;
      
      if (player.team === fixture.team_h || player.team === fixture.team_a) {
        const team = player.team === fixture.team_h ? homeTeam : awayTeam;
        const stats = element.stats || {};
        
        // Goals scored
        if (stats.goals_scored > 0) {
          events.goals.push({
            id: player.id,
            name: player.web_name,
            teamName: team?.short_name || '???',
            teamCode: team?.code,
            count: stats.goals_scored
          });
        }
        
        // Assists
        if (stats.assists > 0) {
          events.assists.push({
            id: player.id,
            name: player.web_name,
            teamName: team?.short_name || '???',
            teamCode: team?.code,
            count: stats.assists
          });
        }
        
        // Yellow cards
        if (stats.yellow_cards > 0) {
          events.cards.push({
            id: player.id,
            name: player.web_name,
            teamName: team?.short_name || '???',
            teamCode: team?.code,
            cardType: 'yellow',
            count: stats.yellow_cards
          });
        }
        
        // Red cards
        if (stats.red_cards > 0) {
          events.cards.push({
            id: player.id,
            name: player.web_name,
            teamName: team?.short_name || '???',
            teamCode: team?.code,
            cardType: 'red',
            count: stats.red_cards
          });
        }
        
        // Collect BPS for bonus calculation
        if (stats.minutes > 0) {
          playersInFixture.push({
            id: player.id,
            name: player.web_name,
            teamName: team?.short_name || '???',
            teamCode: team?.code,
            bps: stats.bps || 0,
            apiBonus: stats.bonus || 0
          });
        }
      }
    });
    
    // Calculate bonus points
    // Check if any player has official bonus confirmed
    const hasOfficialBonus = playersInFixture.some(p => p.apiBonus > 0);
    events.bonusConfirmed = hasOfficialBonus;
    
    if (hasOfficialBonus) {
      // Use official bonus
      events.bonus = playersInFixture
        .filter(p => p.apiBonus > 0)
        .sort((a, b) => b.apiBonus - a.apiBonus)
        .map(p => ({ ...p, bonus: p.apiBonus }));
    } else if (playersInFixture.length > 0) {
      // Calculate provisional from BPS
      playersInFixture.sort((a, b) => b.bps - a.bps);
      
      let position = 1;
      let i = 0;
      
      while (i < playersInFixture.length && position <= 3) {
        const currentBps = playersInFixture[i].bps;
        const tiedPlayers = [];
        
        while (i < playersInFixture.length && playersInFixture[i].bps === currentBps) {
          tiedPlayers.push(playersInFixture[i]);
          i++;
        }
        
        const bonus = 4 - position;
        tiedPlayers.forEach(p => {
          events.bonus.push({ ...p, bonus });
        });
        
        position += tiedPlayers.length;
      }
    }
    
    // Sort events
    events.goals.sort((a, b) => b.count - a.count);
    events.assists.sort((a, b) => b.count - a.count);
    // Sort cards: yellow cards first, then red
    events.cards.sort((a, b) => {
      if (a.cardType === 'yellow' && b.cardType === 'red') return -1;
      if (a.cardType === 'red' && b.cardType === 'yellow') return 1;
      return 0;
    });
    events.bonus.sort((a, b) => b.bonus - a.bonus);
    
    return events;
  }

  toggleFixtureExpansion(fixtureId) {
    if (this.expandedFixtures.has(fixtureId)) {
      this.expandedFixtures.delete(fixtureId);
    } else {
      this.expandedFixtures.add(fixtureId);
    }
    this.renderFixtures();
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
