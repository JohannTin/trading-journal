"""
Shared computation helpers used by both routes and the DB migration backfill.
No imports from backend.database or backend.routes to avoid circular deps.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

EASTERN = ZoneInfo("America/New_York")
DEFAULT_SESSION_END = "15:30"


def option_ticker(trade: dict) -> str:
    side = "C" if trade["option_type"] == "Call" else "P"
    strike = trade["strike"]
    strike_str = f"{int(strike)}" if strike == int(strike) else f"{strike:g}"
    return f"{trade['ticker']}_{side}_{strike_str}_{trade['expiry']}"


def entry_ts(date_str: str, time_str: str) -> int:
    raw = time_str if ":" in time_str else f"{time_str[:2]}:{time_str[2:]}"
    hh, mm = raw.split(":")[:2]
    dt = datetime.strptime(f"{date_str} {hh}:{mm}", "%Y-%m-%d %H:%M").replace(tzinfo=EASTERN)
    return int(dt.timestamp())


def day_bounds(date_str: str) -> tuple[int, int]:
    dt = datetime.strptime(date_str, "%Y-%m-%d").replace(
        tzinfo=EASTERN, hour=0, minute=0, second=0, microsecond=0
    )
    start_ts = int(dt.timestamp())
    end_ts = int(dt.replace(hour=23, minute=59, second=59).timestamp())
    return start_ts, end_ts


def nearest_macd(conn, ticker: str, target_ts: int, start_ts: int, end_ts: int) -> dict:
    row = conn.execute(
        """SELECT macd, macd_signal, macd_hist
           FROM chart_data
           WHERE ticker = ? AND ts BETWEEN ? AND ?
           ORDER BY ABS(ts - ?) ASC
           LIMIT 1""",
        (ticker.upper(), start_ts, end_ts, target_ts),
    ).fetchone()
    return dict(row) if row else {"macd": None, "macd_signal": None, "macd_hist": None}


def compute_mae_mfe(
    conn,
    opt_ticker: str,
    underlying: str,
    entry_ts_val: int,
    exit_ts_val: int,
    fill: float,
    session_end_ts: int,
    option_type: str = "Call",
) -> tuple[float | None, float | None, float | None]:
    """
    Returns (mae, mfe, post_exit_mfe) as percentages relative to entry price.
    Tries option-level chart data first, falls back to underlying.
    When using underlying data, direction is flipped for Puts since the underlying
    moving up is adverse for a long put (and favorable for a long call).
    """
    opt_check = conn.execute(
        "SELECT 1 FROM chart_data WHERE ticker = ? LIMIT 1", (opt_ticker,)
    ).fetchone()

    if opt_check:
        ticker_key = opt_ticker
        ref_price = fill
        use_underlying = False
    else:
        ticker_key = underlying
        ref_row = conn.execute(
            "SELECT close FROM chart_data WHERE ticker = ? AND ts <= ? ORDER BY ts DESC LIMIT 1",
            (underlying, entry_ts_val),
        ).fetchone()
        if not ref_row or not ref_row["close"]:
            return None, None, None
        ref_price = ref_row["close"]
        use_underlying = True

    if ref_price <= 0:
        return None, None, None

    # MAE/MFE calculation during holding period
    hold = conn.execute(
        "SELECT low, high FROM chart_data WHERE ticker = ? AND ts > ? AND ts <= ?",
        (ticker_key, entry_ts_val, exit_ts_val),
    ).fetchall()

    if not hold:
        mae = mfe = None
    else:
        # When using underlying data for a Put, direction is inverted:
        # adverse excursion = underlying going UP (use high), favorable = underlying going DOWN (use low)
        if use_underlying and option_type == "Put":
            adverse_price = max(r["high"] for r in hold)
            favorable_price = min(r["low"] for r in hold)
        else:
            adverse_price = min(r["low"] for r in hold)
            favorable_price = max(r["high"] for r in hold)
        mae = round((adverse_price - ref_price) / ref_price * 100, 2)
        mfe = round((favorable_price - ref_price) / ref_price * 100, 2)

    # Post-exit MFE calculation
    post = conn.execute(
        "SELECT low, high FROM chart_data WHERE ticker = ? AND ts > ? AND ts <= ?",
        (ticker_key, exit_ts_val, session_end_ts),
    ).fetchall()

    post_exit_mfe = None
    if post:
        if use_underlying and option_type == "Put":
            best_after = min(r["low"] for r in post)
        else:
            best_after = max(r["high"] for r in post)
        post_exit_mfe = round((best_after - ref_price) / ref_price * 100, 2)

    return mae, mfe, post_exit_mfe
