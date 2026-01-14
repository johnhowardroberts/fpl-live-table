/**
 * FPL Live Table Configuration
 * 
 * Switch API_BASE depending on your deployment environment.
 */

const CONFIG = {
  // ==================================================
  // DEPLOYMENT CONFIGURATION - Choose one:
  // ==================================================
  
  // Option 1: Cloudflare Worker (Production)
  // Replace with your actual worker URL after deployment
  // API_BASE: 'https://fpl-proxy.YOUR_SUBDOMAIN.workers.dev',
  
  // Option 2: Local Development (default)
  API_BASE: '/api',
  
  // Option 3: Vercel Functions
  // API_BASE: '/api/fpl',
  
  // ==================================================
  // APP SETTINGS
  // ==================================================
  
  // Auto-refresh interval in milliseconds (2 minutes)
  REFRESH_INTERVAL: 2 * 60 * 1000,
  
  // Cache timeout for different data types (milliseconds)
  CACHE: {
    BOOTSTRAP: 5 * 60 * 1000,      // 5 minutes - player/team data
    LIVE_DATA: 30 * 1000,          // 30 seconds - live scores
    FIXTURES: 5 * 60 * 1000,       // 5 minutes - fixture dates
    STANDINGS: 60 * 1000,          // 1 minute - league standings
    MANAGER_DATA: 60 * 1000,       // 1 minute - manager picks/history
  },
  
  // Maximum concurrent API requests
  MAX_CONCURRENT_REQUESTS: 10,
  
  // Default league ID - auto-loads on startup
  DEFAULT_LEAGUE_ID: 539861,
};

// Freeze config to prevent accidental modifications
Object.freeze(CONFIG);
Object.freeze(CONFIG.CACHE);

// Export for use in app
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
