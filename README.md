# FPL Live Table ⚽

A live Fantasy Premier League leaderboard app with real-time updates. Track your mini-league standings, see who's winning the month, and watch captains go green.

**Live Demo:** *(Add your Render URL here after deployment)*

![FPL Live Table](https://img.shields.io/badge/FPL-2024%2F25-37003c?style=for-the-badge)

## ✨ Features

- 🏆 **Live Gameweek Scores** - Real-time point updates
- 📅 **Monthly Leaderboard** - Track monthly competitions
- 👨‍✈️ **Captain Tracking** - See who's captained who (✅ played / ⏳ waiting)
- 📊 **Players Played** - X/11 progress indicator
- 🔄 **Auto-Refresh** - Updates every 2 minutes
- 📱 **Mobile Responsive** - Works on all devices
- 🌙 **Dark Theme** - Premier League inspired design

## 🚀 Quick Start

### Run Locally

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/fpl-live-table.git
cd fpl-live-table

# Install dependencies
npm install

# Start the server
npm start

# Open http://localhost:3000
```

### Deploy to Render (Free)

1. **Push to GitHub**
   ```bash
   cd fpl-live-table
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/fpl-live-table.git
   git push -u origin main
   ```

2. **Deploy on Render**
   - Go to [render.com](https://render.com) and sign in with GitHub
   - Click **New → Web Service**
   - Connect your `fpl-live-table` repository
   - Render will auto-detect settings from `render.yaml`
   - Click **Create Web Service**

3. **Done!** 🎉
   - Your app will be live at `https://fpl-live-table.onrender.com`
   - Share the URL with your friends!

> **Note:** Render's free tier may spin down after 15 minutes of inactivity. First load after spin-down takes ~30 seconds.

## 🏗️ How It Works

### The CORS Problem (Solved!)

The FPL API doesn't allow browser requests from other domains (CORS). This app runs a Node.js server that:

1. Serves the static frontend
2. Proxies API requests to `fantasy.premierleague.com`

```
Your Browser → fpl-live-table.onrender.com/api/...
                         ↓ (server-side proxy)
              fantasy.premierleague.com/api/...
```

### FPL API Endpoints Used

| Endpoint | Description |
|----------|-------------|
| `/bootstrap-static/` | All players, teams, gameweeks |
| `/fixtures/` | Match fixtures with dates |
| `/event-status/` | Current gameweek status |
| `/event/{gw}/live/` | Live points for gameweek |
| `/leagues-classic/{id}/standings/` | League standings |
| `/entry/{id}/history/` | Manager's history |
| `/entry/{id}/event/{gw}/picks/` | Manager's team picks |

## 📁 Project Structure

```
fpl-live-table/
├── app/                    # Frontend (static files)
│   ├── index.html          # Main HTML
│   ├── styles.css          # Styles (dark theme)
│   ├── app.js              # Application logic
│   └── config.js           # Configuration
├── server.js               # Express server + API proxy
├── package.json            # Dependencies
├── render.yaml             # Render deployment config
└── README.md
```

## ⚙️ Configuration

Edit `app/config.js` to customize:

```javascript
const CONFIG = {
  API_BASE: '/api',              // API proxy path
  REFRESH_INTERVAL: 2 * 60 * 1000, // Auto-refresh (2 min)
  CACHE: {
    BOOTSTRAP: 5 * 60 * 1000,    // Player data cache
    LIVE_DATA: 30 * 1000,        // Live scores cache
    // ...
  },
};
```

## 🎨 Customization

The design uses CSS variables for easy theming:

```css
:root {
  --color-primary: #e90052;      /* PL Magenta */
  --color-accent: #04f5ed;       /* Cyan accent */
  --color-bg: #0a0a0f;           /* Dark background */
  /* ... */
}
```

## 📝 How to Find Your League ID

1. Log in to [fantasy.premierleague.com](https://fantasy.premierleague.com)
2. Go to **Leagues & Cups**
3. Click on your league
4. Copy the number from the URL:
   ```
   fantasy.premierleague.com/leagues/123456/standings/c
                                      ^^^^^^
   ```

## 🤝 Contributing

PRs welcome! Feel free to:
- Add new features (H2H leagues, chip tracking, etc.)
- Improve the design
- Fix bugs

## 📄 License

MIT - Use it, modify it, share it!

---

Built with ❤️ for FPL managers everywhere
