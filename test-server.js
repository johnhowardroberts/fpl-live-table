/**
 * FPL Live Table - Simulation Test Server
 * 
 * Simulates a live GW22 gameweek with:
 * - Randomized live scores that change every 5 seconds
 * - Players finishing with 0 minutes (triggers auto-subs)
 * - Various chip activations
 * 
 * Run: node test-server.js
 * Open: http://localhost:5000
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// ============================================
// SIMULATION STATE
// ============================================

const SIMULATION_DURATION = 60 * 1000; // 1 minute
const UPDATE_INTERVAL = 5 * 1000; // Update every 5 seconds
let simulationStartTime = Date.now();
let updateCount = 0;

// GW22 Fixtures (example - adjust dates as needed)
const GW22_FIXTURES = [
  { id: 221, event: 22, team_h: 1, team_a: 14, team_h_score: 0, team_a_score: 0, started: true, finished: false, kickoff_time: '2025-01-18T12:30:00Z' }, // Man Utd vs Liverpool
  { id: 222, event: 22, team_h: 43, team_a: 3, team_h_score: 0, team_a_score: 0, started: true, finished: false, kickoff_time: '2025-01-18T15:00:00Z' },  // Man City vs Arsenal
  { id: 223, event: 22, team_h: 6, team_a: 8, team_h_score: 0, team_a_score: 0, started: true, finished: false, kickoff_time: '2025-01-18T15:00:00Z' },   // Spurs vs Chelsea
  { id: 224, event: 22, team_h: 7, team_a: 21, team_h_score: 0, team_a_score: 0, started: false, finished: false, kickoff_time: '2025-01-18T17:30:00Z' }, // Aston Villa vs West Ham
  { id: 225, event: 22, team_h: 36, team_a: 4, team_h_score: 0, team_a_score: 0, started: false, finished: false, kickoff_time: '2025-01-19T14:00:00Z' },  // Brighton vs Newcastle
];

// Mock Teams
const TEAMS = [
  { id: 1, name: 'Man Utd', short_name: 'MUN', code: 1 },
  { id: 3, name: 'Arsenal', short_name: 'ARS', code: 3 },
  { id: 4, name: 'Newcastle', short_name: 'NEW', code: 4 },
  { id: 6, name: 'Spurs', short_name: 'TOT', code: 6 },
  { id: 7, name: 'Aston Villa', short_name: 'AVL', code: 7 },
  { id: 8, name: 'Chelsea', short_name: 'CHE', code: 8 },
  { id: 14, name: 'Liverpool', short_name: 'LIV', code: 14 },
  { id: 21, name: 'West Ham', short_name: 'WHU', code: 21 },
  { id: 36, name: 'Brighton', short_name: 'BHA', code: 36 },
  { id: 43, name: 'Man City', short_name: 'MCI', code: 43 },
];

// Mock Players (id, name, team, position: 1=GK, 2=DEF, 3=MID, 4=FWD)
const PLAYERS = [
  // Goalkeepers
  { id: 1, web_name: 'Onana', team: 1, element_type: 1 },
  { id: 2, web_name: 'Raya', team: 3, element_type: 1 },
  { id: 3, web_name: 'Alisson', team: 14, element_type: 1 },
  { id: 4, web_name: 'Ederson', team: 43, element_type: 1 },
  { id: 5, web_name: 'Vicario', team: 6, element_type: 1 },
  
  // Defenders
  { id: 10, web_name: 'Saliba', team: 3, element_type: 2 },
  { id: 11, web_name: 'Gabriel', team: 3, element_type: 2 },
  { id: 12, web_name: 'Van Dijk', team: 14, element_type: 2 },
  { id: 13, web_name: 'Alexander-Arnold', team: 14, element_type: 2 },
  { id: 14, web_name: 'Dias', team: 43, element_type: 2 },
  { id: 15, web_name: 'Walker', team: 43, element_type: 2 },
  { id: 16, web_name: 'Dalot', team: 1, element_type: 2 },
  { id: 17, web_name: 'Martinez', team: 1, element_type: 2 },
  { id: 18, web_name: 'Van de Ven', team: 6, element_type: 2 },
  { id: 19, web_name: 'Udogie', team: 6, element_type: 2 },
  
  // Midfielders
  { id: 30, web_name: 'Salah', team: 14, element_type: 3 },
  { id: 31, web_name: 'Saka', team: 3, element_type: 3 },
  { id: 32, web_name: 'Palmer', team: 8, element_type: 3 },
  { id: 33, web_name: 'Foden', team: 43, element_type: 3 },
  { id: 34, web_name: 'Bruno Fernandes', team: 1, element_type: 3 },
  { id: 35, web_name: 'Odegaard', team: 3, element_type: 3 },
  { id: 36, web_name: 'Son', team: 6, element_type: 3 },
  { id: 37, web_name: 'Maddison', team: 6, element_type: 3 },
  { id: 38, web_name: 'Gordon', team: 4, element_type: 3 },
  { id: 39, web_name: 'Rice', team: 3, element_type: 3 },
  
  // Forwards
  { id: 50, web_name: 'Haaland', team: 43, element_type: 4 },
  { id: 51, web_name: 'Isak', team: 4, element_type: 4 },
  { id: 52, web_name: 'Watkins', team: 7, element_type: 4 },
  { id: 53, web_name: 'Solanke', team: 6, element_type: 4 },
  { id: 54, web_name: 'Havertz', team: 3, element_type: 4 },
  { id: 55, web_name: 'Cunha', team: 39, element_type: 4 },
  { id: 56, web_name: 'Jackson', team: 8, element_type: 4 },
  { id: 57, web_name: 'Nunez', team: 14, element_type: 4 },
];

// Mock League Members (your league ID 539861)
const LEAGUE_MEMBERS = [
  { entry: 1001, player_name: 'Steven King', entry_name: 'if not me, then who?' },
  { entry: 1002, player_name: 'Stephen Kattou', entry_name: 'The Hill Dickies' },
  { entry: 1003, player_name: 'John Roberts', entry_name: 'Fantasy Men' },
  { entry: 1004, player_name: 'Mike Thompson', entry_name: 'Thompson Terrors' },
  { entry: 1005, player_name: 'Sarah Wilson', entry_name: 'Wilson Wonders' },
  { entry: 1006, player_name: 'Dave Brown', entry_name: 'Brown Bears FC' },
  { entry: 1007, player_name: 'Emma Davis', entry_name: 'Davis Dynamos' },
];

// Live player stats - will be updated during simulation
let livePlayerStats = new Map();
let matchProgress = new Map(); // Track which matches have finished

// Manager picks with various chips
const MANAGER_PICKS = {
  1001: {
    active_chip: '3xc', // Triple Captain!
    picks: [
      { element: 3, position: 1, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 12, position: 2, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 13, position: 3, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 10, position: 4, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 14, position: 5, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 30, position: 6, multiplier: 3, is_captain: true, is_vice_captain: false }, // TC Salah
      { element: 31, position: 7, multiplier: 1, is_captain: false, is_vice_captain: true },
      { element: 32, position: 8, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 33, position: 9, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 50, position: 10, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 51, position: 11, multiplier: 1, is_captain: false, is_vice_captain: false },
      // Bench
      { element: 4, position: 12, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 15, position: 13, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 39, position: 14, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 52, position: 15, multiplier: 1, is_captain: false, is_vice_captain: false },
    ],
    automatic_subs: [],
  },
  1002: {
    active_chip: null,
    picks: [
      { element: 4, position: 1, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 10, position: 2, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 11, position: 3, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 14, position: 4, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 16, position: 5, multiplier: 1, is_captain: false, is_vice_captain: false }, // Will get 0 mins - trigger auto-sub
      { element: 30, position: 6, multiplier: 2, is_captain: true, is_vice_captain: false },
      { element: 32, position: 7, multiplier: 1, is_captain: false, is_vice_captain: true },
      { element: 34, position: 8, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 36, position: 9, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 50, position: 10, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 52, position: 11, multiplier: 1, is_captain: false, is_vice_captain: false },
      // Bench
      { element: 2, position: 12, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 18, position: 13, multiplier: 1, is_captain: false, is_vice_captain: false }, // First bench outfield - will sub in
      { element: 38, position: 14, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 53, position: 15, multiplier: 1, is_captain: false, is_vice_captain: false },
    ],
    automatic_subs: [],
  },
  1003: {
    active_chip: 'bboost', // Bench Boost!
    picks: [
      { element: 2, position: 1, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 12, position: 2, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 10, position: 3, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 18, position: 4, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 19, position: 5, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 30, position: 6, multiplier: 2, is_captain: true, is_vice_captain: false },
      { element: 31, position: 7, multiplier: 1, is_captain: false, is_vice_captain: true },
      { element: 35, position: 8, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 37, position: 9, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 50, position: 10, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 54, position: 11, multiplier: 1, is_captain: false, is_vice_captain: false },
      // Bench (all count with BB!)
      { element: 5, position: 12, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 13, position: 13, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 32, position: 14, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 51, position: 15, multiplier: 1, is_captain: false, is_vice_captain: false },
    ],
    automatic_subs: [],
  },
  1004: {
    active_chip: null,
    picks: [
      { element: 5, position: 1, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 11, position: 2, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 14, position: 3, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 17, position: 4, multiplier: 1, is_captain: false, is_vice_captain: false }, // 0 mins
      { element: 19, position: 5, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 32, position: 6, multiplier: 2, is_captain: true, is_vice_captain: false },
      { element: 33, position: 7, multiplier: 1, is_captain: false, is_vice_captain: true },
      { element: 34, position: 8, multiplier: 1, is_captain: false, is_vice_captain: false }, // 0 mins
      { element: 36, position: 9, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 50, position: 10, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 53, position: 11, multiplier: 1, is_captain: false, is_vice_captain: false },
      // Bench
      { element: 1, position: 12, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 15, position: 13, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 38, position: 14, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 55, position: 15, multiplier: 1, is_captain: false, is_vice_captain: false },
    ],
    automatic_subs: [],
  },
  1005: {
    active_chip: null,
    picks: [
      { element: 4, position: 1, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 10, position: 2, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 12, position: 3, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 13, position: 4, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 15, position: 5, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 30, position: 6, multiplier: 2, is_captain: true, is_vice_captain: false },
      { element: 31, position: 7, multiplier: 1, is_captain: false, is_vice_captain: true },
      { element: 33, position: 8, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 35, position: 9, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 50, position: 10, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 52, position: 11, multiplier: 1, is_captain: false, is_vice_captain: false },
      // Bench
      { element: 3, position: 12, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 16, position: 13, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 37, position: 14, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 54, position: 15, multiplier: 1, is_captain: false, is_vice_captain: false },
    ],
    automatic_subs: [],
  },
  1006: {
    active_chip: null,
    picks: [
      { element: 2, position: 1, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 11, position: 2, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 12, position: 3, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 14, position: 4, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 18, position: 5, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 30, position: 6, multiplier: 1, is_captain: false, is_vice_captain: true },
      { element: 32, position: 7, multiplier: 2, is_captain: true, is_vice_captain: false },
      { element: 36, position: 8, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 38, position: 9, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 50, position: 10, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 51, position: 11, multiplier: 1, is_captain: false, is_vice_captain: false },
      // Bench
      { element: 5, position: 12, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 17, position: 13, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 39, position: 14, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 53, position: 15, multiplier: 1, is_captain: false, is_vice_captain: false },
    ],
    automatic_subs: [],
  },
  1007: {
    active_chip: 'freehit', // Free Hit!
    picks: [
      { element: 3, position: 1, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 10, position: 2, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 11, position: 3, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 12, position: 4, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 13, position: 5, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 30, position: 6, multiplier: 2, is_captain: true, is_vice_captain: false },
      { element: 31, position: 7, multiplier: 1, is_captain: false, is_vice_captain: true },
      { element: 32, position: 8, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 33, position: 9, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 50, position: 10, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 54, position: 11, multiplier: 1, is_captain: false, is_vice_captain: false },
      // Bench
      { element: 4, position: 12, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 14, position: 13, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 35, position: 14, multiplier: 1, is_captain: false, is_vice_captain: false },
      { element: 51, position: 15, multiplier: 1, is_captain: false, is_vice_captain: false },
    ],
    automatic_subs: [],
  },
};

// Players who will get 0 minutes (to trigger auto-subs)
const PLAYERS_WITH_ZERO_MINS = [16, 17, 34]; // Dalot, Martinez, Bruno (example - some players benched)

// ============================================
// SIMULATION FUNCTIONS
// ============================================

function initializePlayerStats() {
  PLAYERS.forEach(player => {
    livePlayerStats.set(player.id, {
      id: player.id,
      stats: {
        minutes: 0,
        goals_scored: 0,
        assists: 0,
        clean_sheets: 0,
        goals_conceded: 0,
        bonus: 0,
        total_points: 0,
      },
    });
  });
}

function updateSimulation() {
  updateCount++;
  const elapsed = Date.now() - simulationStartTime;
  const progress = Math.min(elapsed / SIMULATION_DURATION, 1);
  
  console.log(`\n[Simulation] Update #${updateCount} - ${Math.round(progress * 100)}% complete`);
  
  // Update match progress (some matches finish earlier)
  GW22_FIXTURES.forEach((fixture, index) => {
    if (!fixture.started) {
      // Start match after 20% progress
      if (progress > 0.2 + (index * 0.1)) {
        fixture.started = true;
        console.log(`  ⚽ Match started: ${TEAMS.find(t => t.id === fixture.team_h)?.short_name} vs ${TEAMS.find(t => t.id === fixture.team_a)?.short_name}`);
      }
    } else if (!fixture.finished) {
      // Finish match after certain progress
      if (progress > 0.5 + (index * 0.1)) {
        fixture.finished = true;
        matchProgress.set(fixture.id, 'finished');
        console.log(`  🏁 Match finished: ${TEAMS.find(t => t.id === fixture.team_h)?.short_name} ${fixture.team_h_score}-${fixture.team_a_score} ${TEAMS.find(t => t.id === fixture.team_a)?.short_name}`);
        
        // Trigger auto-subs for players with 0 minutes when their match finishes
        triggerAutoSubs(fixture);
      }
    }
  });
  
  // Update player stats
  PLAYERS.forEach(player => {
    const playerTeam = player.team;
    const fixture = GW22_FIXTURES.find(f => 
      (f.team_h === playerTeam || f.team_a === playerTeam) && f.started
    );
    
    if (!fixture) return; // Match not started
    
    const stats = livePlayerStats.get(player.id);
    if (!stats) return;
    
    // Check if player gets 0 minutes
    if (PLAYERS_WITH_ZERO_MINS.includes(player.id)) {
      stats.stats.minutes = 0;
      stats.stats.total_points = 0;
      return;
    }
    
    // Random minutes (45-90 for most, 0 for some)
    if (stats.stats.minutes === 0 && fixture.started) {
      stats.stats.minutes = fixture.finished ? 90 : Math.floor(Math.random() * 45) + 45;
    }
    
    // Random points based on position
    const basePoints = 2; // Appearance
    let points = basePoints;
    
    // Random goals/assists
    if (Math.random() < 0.15 && player.element_type >= 3) { // Mids/Fwds more likely to score
      const goals = Math.floor(Math.random() * 2) + 1;
      stats.stats.goals_scored = goals;
      points += goals * (player.element_type === 4 ? 4 : 5); // 4 for fwd, 5 for mid
      console.log(`  ⚽ GOAL! ${player.web_name} (${goals})`);
    }
    
    if (Math.random() < 0.2) {
      stats.stats.assists = 1;
      points += 3;
      console.log(`  🅰️ ASSIST! ${player.web_name}`);
    }
    
    // Clean sheet for defenders/GKs
    if (player.element_type <= 2 && Math.random() < 0.3) {
      stats.stats.clean_sheets = 1;
      points += player.element_type === 1 ? 4 : 4;
    }
    
    // Star players get more consistent base points
    if ([30, 50, 32].includes(player.id)) { // Salah, Haaland, Palmer
      points = Math.max(points, Math.floor(Math.random() * 8) + 5);
    }
    
    // Set base points (WITHOUT bonus - matches real FPL API during live matches)
    stats.stats.total_points = points;
    
    // Bonus points stored separately (like real FPL API)
    // Top scorers get bonus: 3 for 1st, 2 for 2nd, 1 for 3rd
    if (Math.random() < 0.3) {
      const bonus = Math.floor(Math.random() * 3) + 1;
      stats.stats.bonus = bonus;
    } else {
      stats.stats.bonus = 0;
    }
  });
  
  // Update fixture scores
  GW22_FIXTURES.forEach(fixture => {
    if (fixture.started && !fixture.finished) {
      // Random score changes
      if (Math.random() < 0.3) {
        fixture.team_h_score = Math.floor(Math.random() * 4);
        fixture.team_a_score = Math.floor(Math.random() * 4);
      }
    }
  });
}

function triggerAutoSubs(fixture) {
  // FPL Formation Rules:
  // - Min 3 DEF, Max 5 DEF
  // - Min 2 MID, Max 5 MID
  // - Min 1 FWD, Max 3 FWD
  // - Exactly 1 GK
  
  const FORMATION_RULES = {
    1: { min: 1, max: 1 },  // GK
    2: { min: 3, max: 5 },  // DEF
    3: { min: 2, max: 5 },  // MID
    4: { min: 1, max: 3 },  // FWD
  };
  
  // For each manager, check if any starting player has 0 mins
  Object.keys(MANAGER_PICKS).forEach(managerId => {
    const picks = MANAGER_PICKS[managerId];
    if (picks.active_chip === 'bboost') return; // No auto-subs with bench boost
    
    const starting11 = picks.picks.slice(0, 11);
    const bench = picks.picks.slice(11);
    
    // Track which bench players have already been subbed in
    const usedBenchPlayers = new Set(picks.automatic_subs.map(s => s.element_in));
    
    // Calculate current formation (accounting for existing auto-subs and who has played)
    const getCurrentFormation = () => {
      const formation = { 1: 0, 2: 0, 3: 0, 4: 0 };
      const subbedOut = new Set(picks.automatic_subs.map(s => s.element_out));
      const subbedIn = new Set(picks.automatic_subs.map(s => s.element_in));
      
      // Count starting players who are playing (not subbed out, have minutes)
      starting11.forEach(pick => {
        if (subbedOut.has(pick.element)) return;
        const player = PLAYERS.find(p => p.id === pick.element);
        const stats = livePlayerStats.get(pick.element);
        if (player && stats && stats.stats.minutes > 0) {
          formation[player.element_type]++;
        }
      });
      
      // Add subbed-in players
      bench.forEach(pick => {
        if (!subbedIn.has(pick.element)) return;
        const player = PLAYERS.find(p => p.id === pick.element);
        const stats = livePlayerStats.get(pick.element);
        if (player && stats && stats.stats.minutes > 0) {
          formation[player.element_type]++;
        }
      });
      
      return formation;
    };
    
    // Check if subbing in a player would create a valid formation
    const isValidSub = (playerOut, playerIn) => {
      const outPos = playerOut.element_type;
      const inPos = playerIn.element_type;
      
      // GK for GK only
      if (outPos === 1 || inPos === 1) {
        return outPos === 1 && inPos === 1;
      }
      
      // Get current playing formation
      const formation = getCurrentFormation();
      
      // Simulate the sub
      const newFormation = { ...formation };
      // Player out is already not counted (has 0 mins), so just add player in
      newFormation[inPos]++;
      
      // Check if new formation is valid
      for (const pos of [2, 3, 4]) {
        const rules = FORMATION_RULES[pos];
        if (newFormation[pos] < rules.min || newFormation[pos] > rules.max) {
          return false;
        }
      }
      
      return true;
    };
    
    starting11.forEach((pick, index) => {
      const player = PLAYERS.find(p => p.id === pick.element);
      if (!player) return;
      
      // Check if player's team played in this fixture
      if (player.team !== fixture.team_h && player.team !== fixture.team_a) return;
      
      // Already subbed out?
      if (picks.automatic_subs.find(s => s.element_out === pick.element)) return;
      
      const stats = livePlayerStats.get(pick.element);
      if (stats && stats.stats.minutes === 0) {
        // Find first VALID bench player (respecting ALL formation rules)
        // Bench order: position 12 = GK, positions 13-15 = outfield
        
        const benchPlayer = bench.find(bp => {
          // Already used?
          if (usedBenchPlayers.has(bp.element)) return false;
          
          const bpPlayer = PLAYERS.find(p => p.id === bp.element);
          const bpStats = livePlayerStats.get(bp.element);
          
          // Must have played
          if (!bpStats || bpStats.stats.minutes === 0) return false;
          
          // Check formation validity
          if (!isValidSub(player, bpPlayer)) return false;
          
          return true;
        });
        
        if (benchPlayer) {
          picks.automatic_subs.push({
            element_in: benchPlayer.element,
            element_out: pick.element,
            entry: parseInt(managerId),
            event: 22,
          });
          usedBenchPlayers.add(benchPlayer.element);
          
          const playerOut = PLAYERS.find(p => p.id === pick.element);
          const playerIn = PLAYERS.find(p => p.id === benchPlayer.element);
          const inPlayer = PLAYERS.find(p => p.id === benchPlayer.element);
          const posNames = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
          console.log(`  🔄 AUTO-SUB: ${playerOut?.web_name} (${posNames[playerOut?.element_type]}) → ${playerIn?.web_name} (${posNames[inPlayer?.element_type]}) (Manager ${managerId})`);
        } else {
          const posNames = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
          console.log(`  ❌ NO VALID SUB for ${player.web_name} (${posNames[player.element_type]}) - formation rules prevent it (Manager ${managerId})`);
        }
      }
    });
  });
}

// ============================================
// API ENDPOINTS
// ============================================

app.use(cors());
app.use(express.static(path.join(__dirname, 'app')));

// Logging
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    console.log(`[API] ${req.method} ${req.path}`);
  }
  next();
});

// Bootstrap Static
app.get('/api/bootstrap-static/', (req, res) => {
  res.json({
    elements: PLAYERS,
    teams: TEAMS,
    events: [
      { id: 21, name: 'Gameweek 21', is_current: false, is_next: false, finished: true, deadline_time: '2025-01-11T11:30:00Z' },
      { id: 22, name: 'Gameweek 22', is_current: true, is_next: false, finished: false, deadline_time: '2025-01-18T11:30:00Z' },
      { id: 23, name: 'Gameweek 23', is_current: false, is_next: true, finished: false, deadline_time: '2025-01-25T11:30:00Z' },
    ],
  });
});

// Event Status
app.get('/api/event-status/', (req, res) => {
  res.json({
    status: [{ event: 22 }],
    leagues: 'Updated',
  });
});

// Fixtures
app.get('/api/fixtures/', (req, res) => {
  res.json(GW22_FIXTURES);
});

// Live Data
app.get('/api/event/:gw/live/', (req, res) => {
  res.json({
    elements: Array.from(livePlayerStats.values()),
  });
});

// League Standings
app.get('/api/leagues-classic/:leagueId/standings/', (req, res) => {
  const standings = LEAGUE_MEMBERS.map((member, index) => {
    // Calculate total from history
    const historyPoints = 1000 + Math.floor(Math.random() * 200);
    return {
      ...member,
      rank: index + 1,
      last_rank: index + 1,
      rank_sort: index + 1,
      total: historyPoints,
      event_total: 0,
    };
  });
  
  res.json({
    league: {
      id: parseInt(req.params.leagueId),
      name: 'FPL Simulation Test League',
      created: '2024-07-01T00:00:00Z',
    },
    standings: {
      results: standings,
    },
  });
});

// Manager History
app.get('/api/entry/:managerId/history/', (req, res) => {
  const managerId = parseInt(req.params.managerId);
  const picks = MANAGER_PICKS[managerId];
  
  // Calculate live GW points for this manager
  let gwPoints = 0;
  if (picks) {
    const isBenchBoost = picks.active_chip === 'bboost';
    const subbedOut = new Set(picks.automatic_subs.map(s => s.element_out));
    const subbedIn = new Set(picks.automatic_subs.map(s => s.element_in));
    
    picks.picks.forEach((pick, index) => {
      const isStarting = index < 11;
      const wasSubbedOut = subbedOut.has(pick.element);
      const wasSubbedIn = subbedIn.has(pick.element);
      
      // Points count if: starting and not subbed out, OR subbed in, OR bench boost active
      const pointsCount = (isStarting && !wasSubbedOut) || wasSubbedIn || (isBenchBoost && index >= 11);
      
      if (pointsCount) {
        const stats = livePlayerStats.get(pick.element);
        if (stats && stats.stats.minutes > 0) {
          // Include bonus points in GW total
          const basePoints = stats.stats.total_points || 0;
          const bonusPoints = stats.stats.bonus || 0;
          gwPoints += (basePoints + bonusPoints) * pick.multiplier;
        }
      }
    });
  }
  
  // Previous GW points (randomized but consistent per manager)
  const prevGwPoints = 45 + (managerId % 30);
  
  res.json({
    current: [
      { event: 21, points: prevGwPoints, total_points: 950, rank: 500000 },
      { event: 22, points: gwPoints, total_points: 950 + gwPoints, rank: 500000 },
    ],
    past: [],
    chips: [],
  });
});

// Manager Picks
app.get('/api/entry/:managerId/event/:gw/picks/', (req, res) => {
  const managerId = parseInt(req.params.managerId);
  const picks = MANAGER_PICKS[managerId];
  
  if (!picks) {
    // Generate default picks
    res.json({
      active_chip: null,
      automatic_subs: [],
      picks: PLAYERS.slice(0, 15).map((p, i) => ({
        element: p.id,
        position: i + 1,
        multiplier: i === 5 ? 2 : 1,
        is_captain: i === 5,
        is_vice_captain: i === 6,
      })),
    });
    return;
  }
  
  res.json(picks);
});

// Health check
app.get('/health', (req, res) => {
  const elapsed = Date.now() - simulationStartTime;
  res.json({
    status: 'simulation',
    elapsed_ms: elapsed,
    updates: updateCount,
    progress: `${Math.round((elapsed / SIMULATION_DURATION) * 100)}%`,
  });
});

// Catch-all for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'app', 'index.html'));
});

// ============================================
// START SERVER & SIMULATION
// ============================================

initializePlayerStats();

// Update simulation periodically
const simulationInterval = setInterval(() => {
  updateSimulation();
  
  // Stop after duration
  if (Date.now() - simulationStartTime > SIMULATION_DURATION) {
    console.log('\n🏁 Simulation complete!');
    console.log('Server will continue running - refresh the page to see final state.');
    clearInterval(simulationInterval);
  }
}, UPDATE_INTERVAL);

app.listen(PORT, () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                                                           ║');
  console.log('║   🧪 FPL SIMULATION TEST SERVER                           ║');
  console.log('║                                                           ║');
  console.log(`║   🌐 Open: http://localhost:${PORT}                          ║`);
  console.log('║                                                           ║');
  console.log('║   📊 Simulating GW22 with:                                ║');
  console.log('║      - Triple Captain (Steven King)                       ║');
  console.log('║      - Bench Boost (John Roberts)                         ║');
  console.log('║      - Free Hit (Emma Davis)                              ║');
  console.log('║      - Auto-subs (Dalot, Martinez, Bruno = 0 mins)        ║');
  console.log('║                                                           ║');
  console.log('║   ⏱️  Simulation runs for 60 seconds                       ║');
  console.log('║   🔄 Updates every 5 seconds                              ║');
  console.log('║                                                           ║');
  console.log('║   Press Ctrl+C to stop                                    ║');
  console.log('║                                                           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('🚀 Simulation started!\n');
});
