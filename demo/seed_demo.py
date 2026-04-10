"""
Seed the database with realistic demo data.

Usage:
    python -m backend.seed_demo            # populates trading_journal.db
    python -m backend.seed_demo --reset    # wipes existing data first

Two profitable strategies (MACD Momentum, VWAP Bounce) and one losing
strategy (Earnings Play) across 0DTE and Swing accounts.
"""

import argparse
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "trading_journal.db"


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def reset(conn: sqlite3.Connection):
    conn.executescript("""
        DELETE FROM exits;
        DELETE FROM trades;
        DELETE FROM journal_entries;
    """)
    print("Existing trade/exit/journal data cleared.")


def seed(conn: sqlite3.Connection):
    cur = conn.cursor()

    # ── Accounts ────────────────────────────────────────────────────────────
    # Ensure the two default accounts exist (created by database.py on init)
    cur.execute("SELECT id FROM accounts WHERE name = '0DTE'")
    acc_0dte = cur.fetchone()
    if acc_0dte is None:
        cur.execute("INSERT INTO accounts (name) VALUES ('0DTE')")
        acc_0dte_id = cur.lastrowid
    else:
        acc_0dte_id = acc_0dte["id"]

    cur.execute("SELECT id FROM accounts WHERE name = 'Swing'")
    acc_swing = cur.fetchone()
    if acc_swing is None:
        cur.execute("INSERT INTO accounts (name) VALUES ('Swing')")
        acc_swing_id = cur.lastrowid
    else:
        acc_swing_id = acc_swing["id"]

    # ── Trades helper ────────────────────────────────────────────────────────
    def add_trade(date, time, dte, ticker, option_type, strike, expiry,
                  qty, fill, strategy, status, account_id, notes=""):
        total_cost = round(fill * qty * 100, 2)
        cur.execute("""
            INSERT INTO trades
                (date, time, dte, ticker, option_type, strike, expiry,
                 qty, fill, total_cost, strategy, status, account_id,
                 notes, flagged, total_pnl, deleted_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,NULL)
        """, (date, time, dte, ticker, option_type, strike, expiry,
              qty, fill, total_cost, strategy, status, account_id, notes))
        return cur.lastrowid

    def add_exit(trade_id, time, qty, price, fill, notes=""):
        pnl = round((price - fill) * qty * 100, 2)
        pct = round((price - fill) / fill * 100, 2)
        cur.execute("""
            INSERT INTO exits (trade_id, time, qty, price, pnl, pct, notes, deleted_at)
            VALUES (?,?,?,?,?,?,?,NULL)
        """, (trade_id, time, qty, price, pnl, pct, notes))
        return pnl

    def set_total_pnl(trade_id):
        total = cur.execute(
            "SELECT COALESCE(SUM(pnl),0) FROM exits WHERE trade_id=? AND deleted_at IS NULL",
            (trade_id,)
        ).fetchone()[0]
        cur.execute("UPDATE trades SET total_pnl=? WHERE id=?", (total, trade_id))

    # ════════════════════════════════════════════════════════════════════════
    # Strategy 1 — MACD Momentum (profitable, 0DTE calls)
    # Buy calls when MACD histogram crosses above zero at open
    # ════════════════════════════════════════════════════════════════════════

    # Trade 1: NVDA 900C — strong momentum day
    t1 = add_trade("2026-01-15", "09:45", 0, "NVDA", "Call", 900, "2026-01-15",
                   2, 4.50, "MACD Momentum", "closed", acc_0dte_id,
                   "Clean MACD cross on the 3m. Held through first pullback.")
    add_exit(t1, "10:32", 2, 8.20, 4.50, "Target hit at 2R. MACD starting to curl.")
    set_total_pnl(t1)

    # Trade 2: AAPL 230C — gap and go
    t2 = add_trade("2026-01-22", "10:15", 0, "AAPL", "Call", 230, "2026-01-22",
                   3, 2.10, "MACD Momentum", "closed", acc_0dte_id,
                   "Gapped up. MACD hist expanding on 5m. Entered after 10am.")
    add_exit(t2, "11:48", 3, 3.85, 2.10)
    set_total_pnl(t2)

    # Trade 3: SPY 585C — scaled out in two pieces
    t3 = add_trade("2026-02-03", "09:35", 0, "SPY", "Call", 585, "2026-02-03",
                   5, 1.20, "MACD Momentum", "closed", acc_0dte_id,
                   "Pre-market strength. Took half off at 1R, runner to 2R.")
    add_exit(t3, "10:02", 3, 2.10, 1.20, "Half off at 1R")
    add_exit(t3, "10:47", 2, 2.45, 1.20, "Runner. MACD divergence on 1m, exited.")
    set_total_pnl(t3)

    # ════════════════════════════════════════════════════════════════════════
    # Strategy 2 — VWAP Bounce (profitable, 0DTE puts)
    # Buy puts when price rejects VWAP on low volume after a failed breakout
    # ════════════════════════════════════════════════════════════════════════

    # Trade 4: QQQ 510P — textbook VWAP rejection
    t4 = add_trade("2026-01-29", "10:30", 0, "QQQ", "Put", 510, "2026-01-29",
                   4, 1.60, "VWAP Bounce", "closed", acc_0dte_id,
                   "Third test of VWAP. Volume dried up on the push. Clean entry.")
    add_exit(t4, "11:18", 4, 2.90, 1.60)
    set_total_pnl(t4)

    # Trade 5: SPY 580P — trend day down after VWAP fail
    t5 = add_trade("2026-02-12", "09:40", 0, "SPY", "Put", 580, "2026-02-12",
                   5, 2.20, "VWAP Bounce", "closed", acc_0dte_id,
                   "Opened below VWAP. Failed reclaim attempt at 9:35. Rode the trend.")
    add_exit(t5, "10:22", 5, 3.80, 2.20)
    set_total_pnl(t5)

    # ════════════════════════════════════════════════════════════════════════
    # Strategy 3 — Earnings Play (losing)
    # Buying directional options into earnings — IV crush and wrong direction
    # ════════════════════════════════════════════════════════════════════════

    # Trade 6: META 615C — earnings miss, IV crush
    t6 = add_trade("2026-01-28", "09:45", 0, "META", "Call", 615, "2026-01-28",
                   2, 5.80, "Earnings Play", "closed", acc_0dte_id,
                   "Thought META would beat. Missed on ad revenue. Held too long.")
    add_exit(t6, "14:28", 2, 1.20, 5.80,
             "Stopped out. Should have cut at 50%. Lesson: don't fight earnings IV crush.")
    set_total_pnl(t6)

    # Trade 7: TSLA 350P — wrong direction, scaled out in panic
    t7 = add_trade("2026-02-05", "09:50", 0, "TSLA", "Put", 350, "2026-02-05",
                   3, 3.40, "Earnings Play", "closed", acc_0dte_id,
                   "Expected delivery miss. Stock ripped. Panic-scaled out.")
    add_exit(t7, "11:03", 2, 1.80, 3.40, "Panic exit on 2 of 3")
    add_exit(t7, "13:31", 1, 1.20, 3.40, "Last contract. Should have closed all at once.")
    set_total_pnl(t7)

    # Trade 8: AMZN 225C — gapped against, held and lost more
    t8 = add_trade("2026-02-06", "10:00", 0, "AMZN", "Call", 225, "2026-02-06",
                   3, 2.80, "Earnings Play", "closed", acc_0dte_id,
                   "Followed TSLA play. Same mistake. AWS miss not priced in.")
    add_exit(t8, "12:33", 3, 1.05, 2.80, "Cut it. Not letting another one go to zero.")
    set_total_pnl(t8)

    # ════════════════════════════════════════════════════════════════════════
    # Swing account — multi-day positions
    # ════════════════════════════════════════════════════════════════════════

    # Trade 9: MSFT swing call (profitable)
    t9 = add_trade("2026-02-18", "10:15", 14, "MSFT", "Call", 450, "2026-03-06",
                   1, 8.50, "MACD Momentum", "closed", acc_swing_id,
                   "Weekly trend trade. MACD crossed on daily. Held 4 days.")
    add_exit(t9, "10:40", 1, 14.20, 8.50, "Exited into resistance. Clean 67% gain.")
    set_total_pnl(t9)

    # Trade 10: GOOGL swing put (losing)
    t10 = add_trade("2026-02-26", "14:30", 7, "GOOGL", "Put", 185, "2026-03-06",
                    2, 4.20, "Earnings Play", "closed", acc_swing_id,
                    "Anticipated weakness before earnings. Stock held up. Cut for 50%.")
    add_exit(t10, "11:00", 2, 2.10, 4.20, "Thesis broke. Cut it clean.")
    set_total_pnl(t10)

    # ════════════════════════════════════════════════════════════════════════
    # Open trades (recent)
    # ════════════════════════════════════════════════════════════════════════

    add_trade("2026-03-25", "09:35", 0, "NVDA", "Call", 870, "2026-03-25",
              2, 3.20, "MACD Momentum", "open", acc_0dte_id,
              "Strong open. Watching for confirmation above VWAP.")

    add_trade("2026-03-26", "10:15", 0, "SPY", "Put", 560, "2026-03-26",
              4, 1.85, "VWAP Bounce", "open", acc_0dte_id,
              "Failed VWAP reclaim. Entered on second rejection.")

    # ════════════════════════════════════════════════════════════════════════
    # Journal entries
    # ════════════════════════════════════════════════════════════════════════

    entries = [
        ("2026-01-15", acc_0dte_id,
         "NVDA gap up pre-market. MACD looking good on 5m. Plan: calls above VWAP.",
         "Stayed patient, waited for confirmation. Hit target without chasing.",
         None, "great"),
        ("2026-01-28", acc_0dte_id,
         "META earnings tonight. Expecting beat on ad revenue.",
         None,
         "Held too long after the initial drop. Need a hard 50% stop rule on earnings plays.",
         "bad"),
        ("2026-02-05", acc_0dte_id,
         "TSLA earnings. Expecting delivery miss to push it down.",
         None,
         "Wrong direction. Panic-exited in two pieces instead of one clean cut. Costly.",
         "bad"),
        ("2026-02-12", acc_0dte_id,
         "Market feels heavy. VWAP setups in focus today.",
         "Executed the plan. Let the trade breathe after entry.",
         None, "good"),
        ("2026-03-25", acc_0dte_id,
         "NVDA strong. Looking for MACD momentum plays on the open.",
         None, None, "neutral"),
    ]

    for date, acc_id, pre, well, improve, mood in entries:
        cur.execute("""
            INSERT OR IGNORE INTO journal_entries
                (date, account_id, pre_market, went_well, to_improve, mood)
            VALUES (?,?,?,?,?,?)
        """, (date, acc_id, pre, well, improve, mood))

    conn.commit()
    print("Demo data seeded successfully.")
    print()

    # Summary
    trade_count = cur.execute("SELECT COUNT(*) FROM trades").fetchone()[0]
    exit_count  = cur.execute("SELECT COUNT(*) FROM exits").fetchone()[0]
    total_pnl   = cur.execute("SELECT ROUND(SUM(total_pnl),2) FROM trades WHERE status='closed'").fetchone()[0]
    print(f"  Trades:    {trade_count}")
    print(f"  Exits:     {exit_count}")
    print(f"  Total P&L: ${total_pnl:,.2f}")


def main():
    parser = argparse.ArgumentParser(description="Seed demo trading data")
    parser.add_argument("--reset", action="store_true",
                        help="Clear existing trades, exits, and journal entries first")
    args = parser.parse_args()

    # Run the full DB initialisation first so all columns/indices exist
    from backend.database import init_db
    init_db()

    conn = get_conn()
    try:
        if args.reset:
            reset(conn)
        seed(conn)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
