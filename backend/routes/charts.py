import csv
import io
import json
import re
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

EASTERN = ZoneInfo("America/New_York")
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from backend.database import get_db, _backfill_computed

router = APIRouter(prefix="/api/charts", tags=["charts"])

# ── Column map builder ─────────────────────────────────────────────────────────
# Detects column positions from a TradingView CSV header row.
# Falls back to hardcoded legacy positions when no header is present.

_LEGACY_COL = {
    "time": 0, "open": 1, "high": 2, "low": 3, "close": 4,
    "vwap": 11, "ma1": 12, "ma2": 13, "ma3": 14, "ma4": 15,
    "buy": 16, "sell": 17, "volume": 19,
    "macd_hist": 20, "macd": 21, "macd_signal": 22, "rsi": 23,
    "div_reg_bull": 24, "div_hid_bull": 26, "div_reg_bear": 28, "div_hid_bear": 30,
    "cci": 32, "cci_ma": 33,
}


def _build_col_map(header: list[str]) -> dict:
    """
    Build a {key: column_index} map from a TradingView CSV header row.
    Handles any layout regardless of which indicators are included.
    """
    col: dict = {}
    lo = [c.strip().lower() for c in header]

    def first(pred):
        for i, c in enumerate(lo):
            if pred(c):
                return i
        return None

    # OHLCV — always present
    for k in ("time", "open", "high", "low", "close"):
        idx = first(lambda c, k=k: c == k)
        if idx is not None:
            col[k] = idx

    # Volume — several label variants
    idx = first(lambda c: c in ("volume", "vol"))
    if idx is not None:
        col["volume"] = idx

    # VWAP — first column whose name contains "vwap"
    idx = first(lambda c: "vwap" in c)
    if idx is not None:
        col["vwap"] = idx

    # Moving averages — "MA #1", "EMA #1", "SMA #1", "MA1", etc.
    ma_found: dict[int, int] = {}
    for i, c in enumerate(lo):
        m = re.search(r'\b(?:ema|sma|ma)\s*#?\s*(\d)', c)
        if m:
            n = int(m.group(1))
            if n not in ma_found:
                ma_found[n] = i
    for n in sorted(ma_found):
        col[f"ma{n}"] = ma_found[n]

    # Buy / Sell signals
    idx = first(lambda c: c in ("buy", "buy signal"))
    if idx is not None:
        col["buy"] = idx
    idx = first(lambda c: c in ("sell", "sell signal"))
    if idx is not None:
        col["sell"] = idx

    # MACD cluster
    idx = first(lambda c: c == "macd")
    if idx is not None:
        col["macd"] = idx
    idx = first(lambda c: "histogram" in c)
    if idx is not None:
        col["macd_hist"] = idx
    idx = first(lambda c: "signal" in c and "line" in c)
    if idx is not None:
        col["macd_signal"] = idx

    # RSI — first exact match
    idx = first(lambda c: c == "rsi")
    if idx is not None:
        col["rsi"] = idx

    # CCI
    idx = first(lambda c: c == "cci")
    if idx is not None:
        col["cci"] = idx
    idx = first(lambda c: "cci" in c and "ma" in c)
    if idx is not None:
        col["cci_ma"] = idx

    # Divergence shapes — positional labels used by common divergence scripts
    # "regular bullish", "hidden bullish", "regular bearish", "hidden bearish"
    for key, patterns in [
        ("div_reg_bull", ("regular bullish",)),
        ("div_hid_bull", ("hidden bullish",)),
        ("div_reg_bear", ("regular bearish",)),
        ("div_hid_bear", ("hidden bearish",)),
    ]:
        idx = first(lambda c, pats=patterns: any(p in c for p in pats))
        if idx is not None:
            col[key] = idx

    return col


_MARKET_OPEN_H,  _MARKET_OPEN_M  = 9,  30
_MARKET_CLOSE_H, _MARKET_CLOSE_M = 16,  0

def _in_market_hours(ts: int) -> bool:
    """Return True if the Unix timestamp falls within 9:30–16:00 ET (inclusive)."""
    dt = datetime.fromtimestamp(ts, tz=EASTERN)
    minutes = dt.hour * 60 + dt.minute
    return (_MARKET_OPEN_H * 60 + _MARKET_OPEN_M) <= minutes <= (_MARKET_CLOSE_H * 60 + _MARKET_CLOSE_M)


def _float(val: str) -> Optional[float]:
    """Convert CSV cell to float, returning None for empty / non-numeric."""
    v = val.strip()
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _parse_ts(val: str) -> int:
    """Accept Unix seconds (int/float string) or ISO datetime string."""
    v = val.strip()
    # Unix timestamp
    try:
        f = float(v)
        if f > 1_000_000_000:          # sanity: anything < ~2001 is probably wrong
            return int(f)
    except ValueError:
        pass
    # ISO formats: "2026-03-22 09:30:00", "2026-03-22T09:30:00", etc.
    # TradingView exports in the exchange's local time (Eastern for US stocks).
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%d %H:%M",    "%Y-%m-%dT%H:%M"):
        try:
            dt = datetime.strptime(v, fmt)
            return int(dt.replace(tzinfo=EASTERN).timestamp())
        except ValueError:
            pass
    raise ValueError(f"Cannot parse timestamp: {v!r}")


def _ticker_from_filename(name: str) -> Optional[str]:
    """
    Try to extract the ticker symbol from a TradingView export filename.
    Examples:
      BATS_SPY, 1_d2d5b.csv  →  SPY
      SPY, 1_abc.csv          →  SPY
      NASDAQ_AAPL, 5_xyz.csv  →  AAPL
    """
    # Pattern: optional EXCHANGE_ then TICKER followed by comma/space
    m = re.search(r'(?:[A-Z]+_)?([A-Z]{1,6})[, ]', name.upper())
    return m.group(1) if m else None


def _parse_csv(content: bytes, ticker: str, market_hours_only: bool = False) -> list[dict]:
    text = content.decode("utf-8", errors="replace")
    reader = csv.reader(io.StringIO(text))
    rows = [r for r in reader if r]

    if not rows:
        raise ValueError("Empty CSV file")

    # Detect header row: first row whose first cell is NOT a parseable timestamp
    col_map = None
    header_idx = None
    for i, row in enumerate(rows):
        try:
            _parse_ts(row[0])
            break  # first data row — header is everything before this
        except (ValueError, IndexError):
            if header_idx is None:
                header_idx = i
                col_map = _build_col_map(row)

    if col_map is None or "open" not in col_map:
        # No recognisable header found — fall back to legacy fixed positions
        col_map = _LEGACY_COL.copy()

    data_rows = []
    for row in rows:
        if not row:
            continue
        try:
            _parse_ts(row[0])
            data_rows.append(row)
        except (ValueError, IndexError):
            continue

    if not data_rows:
        raise ValueError("No valid data rows found in CSV")

    def gcol(key, row, default=None):
        idx = col_map.get(key)
        if idx is None or idx >= len(row):
            return default
        return row[idx]

    records = []
    for row in data_rows:
        try:
            ts = _parse_ts(gcol("time", row, ""))
        except ValueError:
            continue

        if market_hours_only and not _in_market_hours(ts):
            continue

        o = _float(gcol("open",  row, ""))
        h = _float(gcol("high",  row, ""))
        l = _float(gcol("low",   row, ""))
        c = _float(gcol("close", row, ""))
        if None in (o, h, l, c):
            continue

        buy_val  = _float(gcol("buy",  row, "")) or 0
        sell_val = _float(gcol("sell", row, "")) or 0

        records.append({
            "ticker":       ticker.upper(),
            "ts":           ts,
            "open":         o,
            "high":         h,
            "low":          l,
            "close":        c,
            "volume":       int(_float(gcol("volume",  row, "")) or 0),
            "vwap":         _float(gcol("vwap",       row, "")),
            "ma1":          _float(gcol("ma1",        row, "")),
            "ma2":          _float(gcol("ma2",        row, "")),
            "ma3":          _float(gcol("ma3",        row, "")),
            "ma4":          _float(gcol("ma4",        row, "")),
            "buy_signal":   1 if buy_val  != 0 else 0,
            "sell_signal":  1 if sell_val != 0 else 0,
            "macd_hist":    _float(gcol("macd_hist",   row, "")),
            "macd":         _float(gcol("macd",        row, "")),
            "macd_signal":  _float(gcol("macd_signal", row, "")),
            "rsi":          _float(gcol("rsi",         row, "")),
            "cci":          _float(gcol("cci",         row, "")),
            "cci_ma":       _float(gcol("cci_ma",      row, "")),
            "div_reg_bull": _float(gcol("div_reg_bull",row, "")),
            "div_hid_bull": _float(gcol("div_hid_bull",row, "")),
            "div_reg_bear": _float(gcol("div_reg_bear",row, "")),
            "div_hid_bear": _float(gcol("div_hid_bear",row, "")),
        })

    return records


# ── Upload ────────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_chart_data(
    file: UploadFile = File(...),
    ticker: Optional[str] = Form(None),
):
    """
    Accept a TradingView CSV export.
    ticker can be passed explicitly; otherwise extracted from the filename.
    """
    detected = ticker or _ticker_from_filename(file.filename or "")
    if not detected:
        raise HTTPException(
            status_code=400,
            detail="Could not determine ticker from filename. Pass ticker= explicitly.",
        )

    content = await file.read()
    # Option tickers contain underscores (e.g. SPY_C_450_2026-03-26).
    # Filter their data to regular market hours only (9:30–16:00 ET).
    is_option = '_' in detected
    try:
        records = _parse_csv(content, detected, market_hours_only=is_option)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    if not records:
        raise HTTPException(status_code=422, detail="No parseable candle rows in file.")

    conn = get_db()
    try:
        conn.executemany(
            """INSERT INTO chart_data
               (ticker, ts, open, high, low, close, volume,
                vwap, ma1, ma2, ma3, ma4,
                buy_signal, sell_signal,
                macd_hist, macd, macd_signal,
                rsi, cci, cci_ma,
                div_reg_bull, div_hid_bull, div_reg_bear, div_hid_bear)
               VALUES
               (:ticker,:ts,:open,:high,:low,:close,:volume,
                :vwap,:ma1,:ma2,:ma3,:ma4,
                :buy_signal,:sell_signal,
                :macd_hist,:macd,:macd_signal,
                :rsi,:cci,:cci_ma,
                :div_reg_bull,:div_hid_bull,:div_reg_bear,:div_hid_bear)
               ON CONFLICT(ticker, ts) DO UPDATE SET
                 open=excluded.open, high=excluded.high,
                 low=excluded.low,  close=excluded.close,
                 volume=excluded.volume, vwap=excluded.vwap,
                 ma1=excluded.ma1, ma2=excluded.ma2,
                 ma3=excluded.ma3, ma4=excluded.ma4,
                 buy_signal=excluded.buy_signal, sell_signal=excluded.sell_signal,
                 macd_hist=excluded.macd_hist, macd=excluded.macd,
                 macd_signal=excluded.macd_signal,
                 rsi=excluded.rsi, cci=excluded.cci, cci_ma=excluded.cci_ma,
                 div_reg_bull=excluded.div_reg_bull,
                 div_hid_bull=excluded.div_hid_bull,
                 div_reg_bear=excluded.div_reg_bear,
                 div_hid_bear=excluded.div_hid_bear""",
            records,
        )
        conn.commit()
        _backfill_computed(conn)
        conn.commit()
    finally:
        conn.close()

    return {"ticker": detected.upper(), "rows": len(records)}


# ── Query chart data ──────────────────────────────────────────────────────────

@router.get("/data")
def get_chart_data(ticker: str, start: int, end: int):
    """
    Return stored 1-min candles for ticker between Unix timestamps start..end.
    """
    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT ts, open, high, low, close, volume,
                      vwap, ma1, ma2, ma3, ma4,
                      buy_signal, sell_signal,
                      macd_hist, macd, macd_signal,
                      rsi, cci, cci_ma,
                      div_reg_bull, div_hid_bull, div_reg_bear, div_hid_bear
               FROM chart_data
               WHERE ticker = ? AND ts BETWEEN ? AND ?
               ORDER BY ts""",
            (ticker.upper(), start, end),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ── Delete chart data for a day ────────────────────────────────────────────────

@router.delete("/data/day")
def delete_chart_day(ticker: str, date: str):
    """
    Delete stored candles for ticker on the given ET day (YYYY-MM-DD).
    """
    try:
        day_start = datetime.strptime(date, "%Y-%m-%d").replace(
            tzinfo=EASTERN, hour=0, minute=0, second=0, microsecond=0
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    start_ts = int(day_start.timestamp())
    end_ts = int(day_start.replace(hour=23, minute=59, second=59).timestamp())

    conn = get_db()
    try:
        cur = conn.execute(
            "DELETE FROM chart_data WHERE ticker = ? AND ts BETWEEN ? AND ?",
            (ticker.upper(), start_ts, end_ts),
        )
        conn.commit()
        return {"ticker": ticker.upper(), "date": date, "deleted": cur.rowcount}
    finally:
        conn.close()


# ── Available uploads ─────────────────────────────────────────────────────────

@router.get("/available")
def available_chart_data():
    """List which ticker/date ranges have been uploaded."""
    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT ticker,
                      date(ts, 'unixepoch') AS date,
                      COUNT(*) AS bars,
                      MIN(ts) AS ts_start,
                      MAX(ts) AS ts_end
               FROM chart_data
               GROUP BY ticker, date(ts, 'unixepoch')
               ORDER BY ticker, date DESC"""
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ── Yahoo Finance fallback ────────────────────────────────────────────────────

@router.get("/yahoo/{ticker}")
def yahoo_fallback(ticker: str, start: int, end: int):
    """
    Proxy 1-min OHLCV from Yahoo Finance for the given Unix timestamp window.
    Returns the same shape as /data so the frontend can use it transparently.
    """
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker.upper()}"
        f"?interval=1m&period1={start}&period2={end}"
    )
    return _fetch_yahoo_candles(url)


def _fetch_yahoo_candles(url: str) -> list[dict]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Yahoo Finance error: {e}")

    try:
        result = data["chart"]["result"][0]
        timestamps = result["timestamp"]
        quote = result["indicators"]["quote"][0]
        opens = quote.get("open", [])
        highs = quote.get("high", [])
        lows = quote.get("low", [])
        closes = quote.get("close", [])
        volumes = quote.get("volume", [])
    except (KeyError, IndexError, TypeError):
        raise HTTPException(status_code=502, detail="Unexpected Yahoo Finance response format")

    candles = []
    for i, ts in enumerate(timestamps):
        o = opens[i] if i < len(opens) else None
        h = highs[i] if i < len(highs) else None
        l = lows[i] if i < len(lows) else None
        c = closes[i] if i < len(closes) else None
        v = volumes[i] if i < len(volumes) else 0
        if None in (o, h, l, c):
            continue
        candles.append({
            "ts": ts, "open": o, "high": h, "low": l, "close": c,
            "volume": v or 0,
            "vwap": None, "ma1": None, "ma2": None, "ma3": None, "ma4": None,
            "buy_signal": 0, "sell_signal": 0,
            "macd_hist": None, "macd": None, "macd_signal": None,
            "rsi": None, "cci": None, "cci_ma": None,
            "div_reg_bull": None, "div_hid_bull": None,
            "div_reg_bear": None, "div_hid_bear": None,
        })
    return candles


@router.post("/yahoo/save-day")
def save_yahoo_day(ticker: str, date: str):
    """Fetch Yahoo 1m candles for ET day and store in chart_data."""
    try:
        day_start = datetime.strptime(date, "%Y-%m-%d").replace(
            tzinfo=EASTERN, hour=0, minute=0, second=0, microsecond=0
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    start_ts = int(day_start.timestamp())
    end_ts = int(day_start.replace(hour=23, minute=59, second=59).timestamp())
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker.upper()}"
        f"?interval=1m&period1={start_ts}&period2={end_ts}"
    )
    candles = _fetch_yahoo_candles(url)
    if not candles:
        raise HTTPException(status_code=422, detail="No Yahoo candles returned for this day.")

    records = [
        {
            "ticker": ticker.upper(),
            "ts": c["ts"],
            "open": c["open"],
            "high": c["high"],
            "low": c["low"],
            "close": c["close"],
            "volume": int(c["volume"] or 0),
        }
        for c in candles
    ]

    conn = get_db()
    try:
        conn.executemany(
            """INSERT INTO chart_data
               (ticker, ts, open, high, low, close, volume,
                vwap, ma1, ma2, ma3, ma4,
                buy_signal, sell_signal,
                macd_hist, macd, macd_signal,
                rsi, cci, cci_ma,
                div_reg_bull, div_hid_bull, div_reg_bear, div_hid_bear)
               VALUES
               (:ticker,:ts,:open,:high,:low,:close,:volume,
                NULL,NULL,NULL,NULL,NULL,
                0,0,
                NULL,NULL,NULL,
                NULL,NULL,NULL,
                NULL,NULL,NULL,NULL)
               ON CONFLICT(ticker, ts) DO UPDATE SET
                 open=excluded.open, high=excluded.high,
                 low=excluded.low, close=excluded.close,
                 volume=excluded.volume""",
            records,
        )
        conn.commit()
        _backfill_computed(conn)
        conn.commit()
    finally:
        conn.close()

    return {"ticker": ticker.upper(), "date": date, "rows": len(records)}
