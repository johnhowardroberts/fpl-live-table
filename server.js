/**
 * FPL Live Table - Production Server
 * 
 * This server:
 * 1. Serves the static frontend files from /app
 * 2. Proxies API requests to the FPL API (bypasses CORS)
 * 
 * Deploy to Render, Railway, or any Node.js hosting platform.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS for all routes
app.use(cors());

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// Serve static files from the app directory
app.use(express.static(path.join(__dirname, 'app')));

// Proxy endpoint for FPL API
app.get('/api/*', async (req, res) => {
  try {
    // Build the FPL API URL
    const fplPath = req.url.replace('/api', '');
    const fplUrl = `https://fantasy.premierleague.com/api${fplPath}`;
    
    console.log(`[Proxy] -> ${fplUrl}`);
    
    // Use native fetch (Node 18+)
    const response = await fetch(fplUrl, {
      headers: {
        'User-Agent': 'FPL-Live-Table/1.0',
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      throw new Error(`FPL API returned ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Set cache headers (1 minute for live data)
    res.set('Cache-Control', 'public, max-age=60');
    res.json(data);
    
  } catch (error) {
    console.error(`[Proxy Error] ${error.message}`);
    res.status(500).json({ 
      error: 'Failed to fetch data from FPL API',
      message: error.message,
    });
  }
});

// Health check endpoint (useful for Render)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Serve index.html for all other routes (SPA support)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'app', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                                                           ║');
  console.log('║   🏆 FPL Live Table                                       ║');
  console.log('║                                                           ║');
  console.log(`║   🌐 Running on port ${PORT}                                 ║`);
  console.log('║   📡 API Proxy: /api/* → fantasy.premierleague.com       ║');
  console.log('║                                                           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');
});
