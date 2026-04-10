#!/bin/bash
cd "$(dirname "$0")"

# Install dependencies on first run
if [ ! -d "node_modules/concurrently" ]; then
  echo "Installing dependencies for the first time..."
  npm install
fi

# Open browser after a short delay to let the server start
sleep 3 && open http://localhost:5173 &

TRADING_JOURNAL_DB=demo/trading_journal.db npm run start
