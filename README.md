# Trading Journal

A local-first options trading journal built to reduce overtrading and track repeated mistakes.

## Stack

- **Backend:** Python · FastAPI · SQLite
- **Frontend:** React · Vite · Tailwind CSS · TanStack Query

## Features

- **Dashboard** — P&L, win rate, avg win/loss, trade count, color-coded calendar heatmap, overtrade alert
- **Trade Log** — parent trade + partial exit structure, exit pills with individual P&L, filter by open/closed/winners/losers
- **Analytics** — equity curve, Kelly % position sizing calculator
- **Chart Viewer** — upload TradingView CSV exports, view candles with VWAP, MAs, MACD, RSI, CCI, divergence signals, and option contract overlay
- **Journal** — daily pre-market notes, mood tracking, image attachments
- **Accounts** — separate 0DTE and Swing accounts with independent P&L tracking
- **Data** — full JSON export/import, soft-delete trash with restore
- **Dark / Light mode** with persistent preference

## Setup

### Prerequisites

- Python 3.10+
- Node.js 18+

### 1. Clone

```bash
git clone https://github.com/JohannTin/trading-journal.git
cd trading-journal
```

### 2. Backend

```bash
pip install -r requirements.txt
python -m backend.main
```

Backend runs at `http://localhost:8000`. The SQLite database (`backend/trading_journal.db`) is created automatically on first run.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at `http://localhost:5173`.

### Mac — one-click start

Double-click `start.command`. It installs dependencies on first run and opens the browser automatically.

### Mac — demo mode

Double-click `start-demo.command`. It loads a pre-seeded demo database (no setup required) and opens the browser automatically. Your real data is unaffected — the demo runs against `demo/trading_journal.db`.

## Database

The SQLite database is created and migrated automatically on startup — no manual schema management needed. New columns are added via `ALTER TABLE` migrations in `database.py`, so existing databases upgrade safely when you pull a new version.

> **Your data stays local.** The database file is excluded from git by `.gitignore`.

## Project Structure

```
trading-journal/
├── backend/
│   ├── main.py          # FastAPI app entry point
│   ├── database.py      # SQLite setup, auto-migration, indices
│   ├── models.py        # Pydantic request/response models
│   ├── compute.py       # Shared P&L, MACD, MAE/MFE helpers
│   └── routes/
│       ├── trades.py    # Trade CRUD + soft delete
│       ├── exits.py     # Exit creation + P&L calculation
│       ├── stats.py     # Dashboard metrics + overtrade detection
│       ├── charts.py    # CSV upload + candle storage
│       ├── journal.py   # Daily journal + image uploads
│       ├── accounts.py  # Account management
│       ├── admin.py     # Admin utilities
│       └── data.py      # Export / import
├── demo/
│   ├── seed_demo.py     # Demo data seeder
│   └── trading_journal.db  # Pre-seeded demo database
├── frontend/
│   ├── vite.config.js   # Proxies /api → localhost:8000
│   └── src/
│       ├── api.js        # All fetch calls (single source of truth)
│       ├── App.jsx       # Routing + sidebar + theme toggle
│       ├── AccountContext.jsx
│       ├── appSettings.js
│       ├── chartSettings.js
│       ├── timezone.js
│       └── components/
│           ├── Dashboard.jsx
│           ├── TradeLog.jsx
│           ├── TradeModal.jsx
│           ├── TradeChart.jsx
│           ├── Analytics.jsx
│           ├── EquityCurve.jsx
│           ├── KellyCalculator.jsx
│           ├── Calendar.jsx
│           ├── Journal.jsx
│           └── Settings.jsx
├── requirements.txt
├── package.json
├── start.command        # Mac one-click launcher
└── start-demo.command   # Mac demo launcher
```

## P&L Calculation

Exit P&L is computed server-side on every exit:

```
pnl = (exitPrice − fillPrice) × qty × 100
pct = ((exitPrice − fillPrice) / fillPrice) × 100
```

Put trades use the same formula — you buy the put at fill price and sell at exit price.

## Overtrade Detection

A day is flagged as high-frequency when its trade count exceeds **1.5× the daily average**. Flagged days appear with a yellow ring on the calendar and trigger the alert banner on the dashboard.
