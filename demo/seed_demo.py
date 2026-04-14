"""
Seed the database with realistic demo data.

Usage:
    python -m demo.seed_demo            # populates demo/trading_journal.db
    python -m demo.seed_demo --reset    # wipes existing data first

All trades are attributed to a single "Demo" account so seed data never
touches real user accounts. Three strategies: MACD Momentum (profitable),
VWAP Bounce (profitable), Earnings Play (losing).

Dates are anchored to the current month so the demo always looks fresh.
"""

import argparse
import calendar
import sqlite3
from datetime import date, timedelta
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


# ── Date helpers ──────────────────────────────────────────────────────────────

def _to_weekday(d: date) -> date:
    """Push Saturday → Monday, Sunday → Monday."""
    if d.weekday() == 5:
        return d + timedelta(days=2)
    if d.weekday() == 6:
        return d + timedelta(days=1)
    return d


def months_ago(n: int, day: int) -> str:
    """
    ISO date string for `day` of the month `n` months before today.
    Clamped to the last day of that month, then nudged to the nearest weekday.
    """
    today = date.today()
    month = today.month - n
    year = today.year
    while month <= 0:
        month += 12
        year -= 1
    max_day = calendar.monthrange(year, month)[1]
    d = date(year, month, min(day, max_day))
    return _to_weekday(d).isoformat()


def trading_days_ago(n: int) -> str:
    """ISO date string exactly n trading days (Mon–Fri) before today."""
    d = date.today()
    count = 0
    while count < n:
        d -= timedelta(days=1)
        if d.weekday() < 5:
            count += 1
    return d.isoformat()


# ─────────────────────────────────────────────────────────────────────────────

def seed(conn: sqlite3.Connection):
    cur = conn.cursor()

    # ── Demo account ─────────────────────────────────────────────────────────
    cur.execute("SELECT id FROM accounts WHERE name = 'Demo'")
    acc = cur.fetchone()
    if acc is None:
        cur.execute("INSERT INTO accounts (name) VALUES ('Demo')")
        acc_id = cur.lastrowid
    else:
        acc_id = acc["id"]

    # ── Helpers ───────────────────────────────────────────────────────────────
    def add_trade(date, time, dte, ticker, option_type, strike, expiry,
                  qty, fill, strategy, status, notes=""):
        total_cost = round(fill * qty * 100, 2)
        cur.execute("""
            INSERT INTO trades
                (date, time, dte, ticker, option_type, strike, expiry,
                 qty, fill, total_cost, strategy, status, account_id,
                 notes, flagged, total_pnl, deleted_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,NULL)
        """, (date, time, dte, ticker, option_type, strike, expiry,
              qty, fill, total_cost, strategy, status, acc_id, notes))
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

    # ── Dates anchored to current month ───────────────────────────────────────

    # 3 months ago
    d3_08 = months_ago(3,  8)
    d3_10 = months_ago(3, 10)
    d3_15 = months_ago(3, 15)
    d3_17 = months_ago(3, 17)
    d3_22 = months_ago(3, 22)
    d3_24 = months_ago(3, 24)
    d3_28 = months_ago(3, 28)
    d3_29 = months_ago(3, 29)
    d3_30 = months_ago(3, 30)

    # 2 months ago
    d2_03 = months_ago(2,  3)
    d2_05 = months_ago(2,  5)
    d2_06 = months_ago(2,  6)
    d2_09 = months_ago(2,  9)
    d2_12 = months_ago(2, 12)
    d2_14 = months_ago(2, 14)
    d2_18 = months_ago(2, 18)
    d2_20 = months_ago(2, 20)
    d2_24 = months_ago(2, 24)
    d2_26 = months_ago(2, 26)
    d2_27 = months_ago(2, 27)

    # 1 month ago
    d1_05 = months_ago(1,  5)
    d1_06 = months_ago(1,  6)   # used as swing expiry
    d1_08 = months_ago(1,  8)
    d1_12 = months_ago(1, 12)
    d1_15 = months_ago(1, 15)
    d1_18 = months_ago(1, 18)
    d1_21 = months_ago(1, 21)
    d1_22 = months_ago(1, 22)
    d1_25 = months_ago(1, 25)
    d1_28 = months_ago(1, 28)
    d1_exp = months_ago(1, 20)  # swing expiry for last-month entries

    # This month
    d0_02 = months_ago(0,  2)
    d0_03 = months_ago(0,  3)
    d0_04 = months_ago(0,  4)
    d0_07 = months_ago(0,  7)
    d0_08 = months_ago(0,  8)
    d0_10 = months_ago(0, 10)

    # Open trades (this week)
    d_open1 = trading_days_ago(3)
    d_open2 = trading_days_ago(1)

    # ════════════════════════════════════════════════════════════════════════
    # 3 MONTHS AGO
    # ════════════════════════════════════════════════════════════════════════

    # SPY Call — MACD, gap and go (win)
    t = add_trade(d3_08, "09:40", 0, "SPY", "Call", 575, d3_08,
                  4, 1.35, "MACD Momentum", "closed",
                  "Futures green all morning. MACD hist expanding at the open.")
    add_exit(t, "10:50", 4, 2.20, 1.35, "Hit 1.6R. Closed before lunch drift.")
    set_total_pnl(t)

    # TSLA Call — MACD, stopped out (loss)
    t = add_trade(d3_10, "10:05", 0, "TSLA", "Call", 340, d3_10,
                  2, 3.80, "MACD Momentum", "closed",
                  "MACD cross looked clean on 5m. Faded immediately after entry.")
    add_exit(t, "10:38", 2, 2.00, 3.80, "Stopped at 50%. No follow-through on the cross.")
    set_total_pnl(t)

    # NVDA Call — MACD momentum (win)
    t = add_trade(d3_15, "09:45", 0, "NVDA", "Call", 900, d3_15,
                  2, 4.50, "MACD Momentum", "closed",
                  "Clean MACD cross on the 3m. Held through first pullback.")
    add_exit(t, "10:32", 2, 8.20, 4.50, "Target hit at 2R. MACD starting to curl.")
    set_total_pnl(t)

    # QQQ Call — MACD, scaled out (win)
    t = add_trade(d3_17, "09:35", 0, "QQQ", "Call", 505, d3_17,
                  5, 1.10, "MACD Momentum", "closed",
                  "Strong open across the board. QQQ leading. MACD hist expanding on 3m.")
    add_exit(t, "10:15", 3, 1.90, 1.10, "Half off at 1.7R")
    add_exit(t, "11:02", 2, 2.30, 1.10, "Runner closed. Trend stalled at HOD.")
    set_total_pnl(t)

    # AAPL Call — MACD (win)
    t = add_trade(d3_22, "10:15", 0, "AAPL", "Call", 230, d3_22,
                  3, 2.10, "MACD Momentum", "closed",
                  "Gapped up. MACD hist expanding on 5m. Entered after 10am.")
    add_exit(t, "11:48", 3, 3.85, 2.10)
    set_total_pnl(t)

    # MSFT Put — VWAP bounce (win)
    t = add_trade(d3_24, "10:45", 0, "MSFT", "Put", 415, d3_24,
                  3, 1.75, "VWAP Bounce", "closed",
                  "Rejected VWAP twice. Volume light on upside pushes. Clear distribution.")
    add_exit(t, "12:00", 3, 3.05, 1.75, "Trend day down. Let it run to 1.7R.")
    set_total_pnl(t)

    # META Call — Earnings (loss)
    t = add_trade(d3_28, "09:45", 0, "META", "Call", 615, d3_28,
                  2, 5.80, "Earnings Play", "closed",
                  "Thought META would beat. Missed on ad revenue. Held too long.")
    add_exit(t, "14:28", 2, 1.20, 5.80,
             "Stopped out. Should have cut at 50%. Lesson: don't fight earnings IV crush.")
    set_total_pnl(t)

    # QQQ Put — VWAP bounce (win)
    t = add_trade(d3_29, "10:30", 0, "QQQ", "Put", 510, d3_29,
                  4, 1.60, "VWAP Bounce", "closed",
                  "Third test of VWAP. Volume dried up on the push. Clean entry.")
    add_exit(t, "11:18", 4, 2.90, 1.60)
    set_total_pnl(t)

    # IWM Put — VWAP, loss (bad timing)
    t = add_trade(d3_30, "11:15", 0, "IWM", "Put", 225, d3_30,
                  3, 1.40, "VWAP Bounce", "closed",
                  "Late entry on a VWAP setup. Should have waited for a cleaner rejection.")
    add_exit(t, "12:30", 3, 0.80, 1.40, "Choppy action. Exited before it got worse.")
    set_total_pnl(t)

    # ════════════════════════════════════════════════════════════════════════
    # 2 MONTHS AGO
    # ════════════════════════════════════════════════════════════════════════

    # SPY Call — MACD, scaled (win)
    t = add_trade(d2_03, "09:35", 0, "SPY", "Call", 585, d2_03,
                  5, 1.20, "MACD Momentum", "closed",
                  "Pre-market strength. Took half off at 1R, runner to 2R.")
    add_exit(t, "10:02", 3, 2.10, 1.20, "Half off at 1R")
    add_exit(t, "10:47", 2, 2.45, 1.20, "Runner. MACD divergence on 1m, exited.")
    set_total_pnl(t)

    # TSLA Put — Earnings, panic exit (loss)
    t = add_trade(d2_05, "09:50", 0, "TSLA", "Put", 350, d2_05,
                  3, 3.40, "Earnings Play", "closed",
                  "Expected delivery miss. Stock ripped. Panic-scaled out.")
    add_exit(t, "11:03", 2, 1.80, 3.40, "Panic exit on 2 of 3")
    add_exit(t, "13:31", 1, 1.20, 3.40, "Last contract. Should have closed all at once.")
    set_total_pnl(t)

    # AMZN Call — Earnings (loss)
    t = add_trade(d2_06, "10:00", 0, "AMZN", "Call", 225, d2_06,
                  3, 2.80, "Earnings Play", "closed",
                  "Followed TSLA play. Same mistake. AWS miss not priced in.")
    add_exit(t, "12:33", 3, 1.05, 2.80, "Cut it. Not letting another one go to zero.")
    set_total_pnl(t)

    # AAPL Put — VWAP (win)
    t = add_trade(d2_09, "10:20", 0, "AAPL", "Put", 228, d2_09,
                  4, 1.45, "VWAP Bounce", "closed",
                  "Failed breakout above VWAP. Sellers absorbed every push.")
    add_exit(t, "11:45", 4, 2.55, 1.45, "Clean trend. Exited at 1.75R when momentum slowed.")
    set_total_pnl(t)

    # SPY Put — VWAP trend day (win)
    t = add_trade(d2_12, "09:40", 0, "SPY", "Put", 580, d2_12,
                  5, 2.20, "VWAP Bounce", "closed",
                  "Opened below VWAP. Failed reclaim attempt at 9:35. Rode the trend.")
    add_exit(t, "10:22", 5, 3.80, 2.20)
    set_total_pnl(t)

    # NVDA Call — MACD, scaled (win)
    t = add_trade(d2_14, "09:50", 0, "NVDA", "Call", 870, d2_14,
                  3, 5.20, "MACD Momentum", "closed",
                  "NVDA leading semis. MACD crossed on 3m right after open. High conviction.")
    add_exit(t, "10:30", 2, 8.90, 5.20, "First target at 1.7R")
    add_exit(t, "11:15", 1, 11.40, 5.20, "Runner. Closed into volume fade.")
    set_total_pnl(t)

    # MSFT Call — Swing, MACD (win)
    t = add_trade(d2_18, "10:15", 14, "MSFT", "Call", 450, d1_06,
                  1, 8.50, "MACD Momentum", "closed",
                  "Weekly trend trade. MACD crossed on daily. Held 4 days.")
    add_exit(t, "10:40", 1, 14.20, 8.50, "Exited into resistance. Clean 67% gain.")
    set_total_pnl(t)

    # NFLX Call — Earnings, IV crush (loss)
    t = add_trade(d2_20, "09:45", 0, "NFLX", "Call", 1000, d2_20,
                  1, 12.50, "Earnings Play", "closed",
                  "Subscriber numbers expected to beat. Missed on guidance.")
    add_exit(t, "11:20", 1, 4.80, 12.50, "IV crush + wrong direction. Cut it clean.")
    set_total_pnl(t)

    # QQQ Call — MACD, small loss (choppy)
    t = add_trade(d2_24, "10:00", 0, "QQQ", "Call", 508, d2_24,
                  4, 1.50, "MACD Momentum", "closed",
                  "MACD cross on 5m but market internals weak. Fought the tape.")
    add_exit(t, "11:10", 4, 0.90, 1.50, "Choppy day. Cut at 40% loss. No conviction.")
    set_total_pnl(t)

    # GOOGL Put — Swing, Earnings (loss)
    t = add_trade(d2_26, "14:30", 7, "GOOGL", "Put", 185, d1_06,
                  2, 4.20, "Earnings Play", "closed",
                  "Anticipated weakness before earnings. Stock held up. Cut for 50%.")
    add_exit(t, "11:00", 2, 2.10, 4.20, "Thesis broke. Cut it clean.")
    set_total_pnl(t)

    # AMZN Call — Swing, MACD (win)
    t = add_trade(d2_27, "11:00", 10, "AMZN", "Call", 220, d1_06,
                  2, 5.60, "MACD Momentum", "closed",
                  "Daily MACD cross. AWS re-rating thesis. Entered on pullback.")
    add_exit(t, "10:20", 2, 9.10, 5.60, "Hit weekly resistance. Took the 62% gain.")
    set_total_pnl(t)

    # ════════════════════════════════════════════════════════════════════════
    # 1 MONTH AGO
    # ════════════════════════════════════════════════════════════════════════

    # SPY Call — MACD (win)
    t = add_trade(d1_05, "09:40", 0, "SPY", "Call", 570, d1_05,
                  4, 1.55, "MACD Momentum", "closed",
                  "Strong gap up. MACD hist expanding from the first candle.")
    add_exit(t, "10:55", 4, 2.70, 1.55, "Took it at 1.7R. Trend continued but good enough.")
    set_total_pnl(t)

    # SPY Call — MACD (win)
    t = add_trade(d1_08, "09:38", 0, "SPY", "Call", 572, d1_08,
                  5, 1.30, "MACD Momentum", "closed",
                  "Continuation from Monday. MACD still expanding. Easy setup.")
    add_exit(t, "10:45", 5, 2.15, 1.30, "Clean 1.65R. Closed before the 11am chop.")
    set_total_pnl(t)

    # TSLA Put — VWAP (win)
    t = add_trade(d1_12, "10:10", 0, "TSLA", "Put", 270, d1_12,
                  3, 2.40, "VWAP Bounce", "closed",
                  "TSLA struggling at VWAP all morning. Third rejection was the entry.")
    add_exit(t, "11:35", 3, 4.10, 2.40, "Momentum carried it. 1.7R, closed cleanly.")
    set_total_pnl(t)

    # AAPL Call — Earnings (win, for once)
    t = add_trade(d1_15, "09:45", 0, "AAPL", "Call", 218, d1_15,
                  2, 4.20, "Earnings Play", "closed",
                  "Services revenue expected to beat. Had a clear catalyst and tight stop plan.")
    add_exit(t, "11:00", 2, 7.80, 4.20, "Beat on all lines. Had a stop plan this time. Worked.")
    set_total_pnl(t)

    # NVDA Call — Earnings (loss, guidance light)
    t = add_trade(d1_18, "09:45", 0, "NVDA", "Call", 890, d1_18,
                  2, 6.20, "Earnings Play", "closed",
                  "Beat on data center revenue but guidance light. Stock sold off hard.")
    add_exit(t, "13:10", 2, 2.40, 6.20, "Cut losses. Guidance risk not priced in.")
    set_total_pnl(t)

    # QQQ Put — VWAP (loss, no follow-through)
    t = add_trade(d1_21, "10:30", 0, "QQQ", "Put", 482, d1_21,
                  3, 1.70, "VWAP Bounce", "closed",
                  "Setup looked right but market bounced hard off lows. Bad timing.")
    add_exit(t, "11:50", 3, 0.95, 1.70, "Stopped out at 44% loss. Market reversed on me.")
    set_total_pnl(t)

    # SPY Call — MACD small win
    t = add_trade(d1_22, "09:42", 0, "SPY", "Call", 574, d1_22,
                  3, 1.40, "MACD Momentum", "closed",
                  "Thin setup, low conviction but the cross was clean.")
    add_exit(t, "10:20", 3, 2.00, 1.40, "Took 1.4R. Small size, small win. Fine.")
    set_total_pnl(t)

    # QQQ Put — VWAP (win)
    t = add_trade(d1_25, "10:05", 0, "QQQ", "Put", 480, d1_25,
                  3, 1.90, "VWAP Bounce", "closed",
                  "Clean rejection at VWAP. Low volume on the push, high volume on the drop.")
    add_exit(t, "11:30", 3, 3.40, 1.90, "Trended all morning. Let it run to 1.8R.")
    set_total_pnl(t)

    # NVDA Call — Swing, MACD (win)
    t = add_trade(d1_28, "10:30", 7, "NVDA", "Call", 860, d1_exp,
                  1, 9.80, "MACD Momentum", "closed",
                  "Daily MACD cross. Held through a one-day pullback. Conviction held.")
    add_exit(t, "11:00", 1, 15.60, 9.80, "59% gain in 5 days. Exited into resistance.")
    set_total_pnl(t)

    # ════════════════════════════════════════════════════════════════════════
    # THIS MONTH — closed before open positions
    # ════════════════════════════════════════════════════════════════════════

    # AAPL Call — MACD (win)
    t = add_trade(d0_02, "09:50", 0, "AAPL", "Call", 215, d0_02,
                  3, 1.80, "MACD Momentum", "closed",
                  "iPhone supply data positive pre-market. MACD crossed clean on open.")
    add_exit(t, "11:15", 3, 3.10, 1.80, "Hit 2R target. Closed into the pop.")
    set_total_pnl(t)

    # SPY Call — MACD (win)
    t = add_trade(d0_03, "09:38", 0, "SPY", "Call", 556, d0_03,
                  4, 1.25, "MACD Momentum", "closed",
                  "Gap continuation. MACD hist strong. Entered on first pullback to VWAP.")
    add_exit(t, "10:40", 4, 2.10, 1.25, "Clean 1.7R. Exited as momentum slowed.")
    set_total_pnl(t)

    # QQQ Put — VWAP (win)
    t = add_trade(d0_04, "10:15", 0, "QQQ", "Put", 472, d0_04,
                  3, 1.65, "VWAP Bounce", "closed",
                  "QQQ lagging. Multiple VWAP tests with declining volume on pushes.")
    add_exit(t, "11:30", 3, 2.80, 1.65, "Textbook setup. Hit target, no hesitation.")
    set_total_pnl(t)

    # SPY Put — VWAP, stopped out (loss)
    t = add_trade(d0_07, "10:20", 0, "SPY", "Put", 555, d0_07,
                  4, 2.05, "VWAP Bounce", "closed",
                  "VWAP rejection looked clean but buyers stepped in hard.")
    add_exit(t, "11:40", 4, 1.10, 2.05, "Stopped out at 50%. Setup was right, market wrong.")
    set_total_pnl(t)

    # TSLA Call — MACD, chopped out (loss)
    t = add_trade(d0_08, "09:55", 0, "TSLA", "Call", 255, d0_08,
                  2, 3.10, "MACD Momentum", "closed",
                  "MACD cross but no volume behind it. Should have skipped this one.")
    add_exit(t, "10:45", 2, 1.70, 3.10, "Stopped out. Low-volume crosses are traps.")
    set_total_pnl(t)

    # META Put — VWAP (win)
    t = add_trade(d0_10, "10:35", 0, "META", "Put", 540, d0_10,
                  3, 2.20, "VWAP Bounce", "closed",
                  "META rejected VWAP for third time. Increasing sell volume on each push.")
    add_exit(t, "12:00", 3, 3.85, 2.20, "Strong trend down all morning. 1.75R.")
    set_total_pnl(t)

    # ════════════════════════════════════════════════════════════════════════
    # OPEN TRADES (this week)
    # ════════════════════════════════════════════════════════════════════════

    add_trade(d_open1, "09:35", 0, "NVDA", "Call", 870, d_open1,
              2, 3.20, "MACD Momentum", "open",
              "Strong open. Watching for confirmation above VWAP.")

    add_trade(d_open2, "10:15", 0, "SPY", "Put", 560, d_open2,
              4, 1.85, "VWAP Bounce", "open",
              "Failed VWAP reclaim. Entered on second rejection.")

    # ════════════════════════════════════════════════════════════════════════
    # JOURNAL ENTRIES
    # ════════════════════════════════════════════════════════════════════════

    entries = [
        (d3_15, "NVDA gap up pre-market. MACD looking good on 5m. Plan: calls above VWAP.",
         "Stayed patient, waited for confirmation. Hit target without chasing.", None, "great"),
        (d3_28, "META earnings tonight. Expecting beat on ad revenue.",
         None, "Held too long after the initial drop. Need a hard 50% stop rule on earnings plays.", "bad"),
        (d2_05, "TSLA earnings. Expecting delivery miss to push it down.",
         None, "Wrong direction. Panic-exited in two pieces instead of one clean cut. Costly.", "bad"),
        (d2_12, "Market feels heavy. VWAP setups in focus today.",
         "Executed the plan. Let the trade breathe after entry.", None, "good"),
        (d1_05, "Futures green. Looking for momentum continuation plays at open.",
         "Executed cleanly, didn't overstay.", None, "great"),
        (d1_18, "NVDA earnings after close yesterday. Expecting beat on data center.",
         None, "Guidance matters more than the beat. Need to check analyst expectations, not just consensus.", "bad"),
        (d1_25, "Market choppy. Watching VWAP levels on QQQ for rejection plays.",
         "Held conviction through the first bounce attempt. Paid off.", None, "good"),
        (d0_02, "AAPL supply news positive overnight. Gap up expected. Plan: MACD calls on open.",
         "Stuck to the plan, hit target, didn't get greedy.", None, "great"),
        (d0_07, "Expecting weakness. VWAP rejection setups on watch.",
         None, "Good setup, wrong day. Buyers were too strong. Accept it and move on.", "neutral"),
        (d_open1, "NVDA strong. Looking for MACD momentum plays on the open.",
         None, None, "neutral"),
    ]

    for d, pre, well, improve, mood in entries:
        cur.execute("""
            INSERT OR IGNORE INTO journal_entries
                (date, account_id, pre_market, went_well, to_improve, mood)
            VALUES (?,?,?,?,?,?)
        """, (d, acc_id, pre, well, improve, mood))

    conn.commit()
    print("Demo data seeded successfully.")
    print()

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
