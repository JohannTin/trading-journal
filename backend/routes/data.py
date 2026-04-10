from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from backend.database import get_db

router = APIRouter(prefix="/api/data", tags=["data"])


@router.get("/export")
def export_data():
    conn = get_db()
    try:
        trades = [dict(r) for r in conn.execute(
            "SELECT * FROM trades WHERE deleted_at IS NULL ORDER BY date, time"
        ).fetchall()]
        exits = [dict(r) for r in conn.execute(
            "SELECT * FROM exits WHERE deleted_at IS NULL ORDER BY trade_id, time"
        ).fetchall()]
        return {
            "version": 1,
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "trades": trades,
            "exits": exits,
        }
    finally:
        conn.close()


@router.post("/import")
def import_data(payload: dict):
    trades = payload.get("trades", [])
    exits = payload.get("exits", [])
    clear = payload.get("clear_existing", False)

    conn = get_db()
    try:
        if clear:
            conn.execute("DELETE FROM exits")
            conn.execute("DELETE FROM trades")

        id_map: dict[int, int] = {}

        for t in trades:
            old_id = t.get("id")
            cur = conn.execute(
                """INSERT INTO trades
                   (date, time, dte, ticker, option_type, strike, expiry,
                    qty, fill, total_cost, source, notes, chart_link, strategy, status, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    t.get("date"), t.get("time"), t.get("dte", 0),
                    t.get("ticker"), t.get("option_type"), t.get("strike"),
                    t.get("expiry"), t.get("qty"), t.get("fill"),
                    t.get("total_cost"), t.get("source"), t.get("notes"),
                    t.get("chart_link"), t.get("strategy"),
                    t.get("status", "open"),
                    t.get("created_at", datetime.now(timezone.utc).isoformat()),
                ),
            )
            if old_id is not None:
                id_map[old_id] = cur.lastrowid

        imported_exits = 0
        for e in exits:
            new_trade_id = id_map.get(e.get("trade_id"))
            if new_trade_id is None:
                continue
            conn.execute(
                """INSERT INTO exits (trade_id, time, qty, price, pnl, pct, created_at)
                   VALUES (?,?,?,?,?,?,?)""",
                (
                    new_trade_id, e.get("time"), e.get("qty"),
                    e.get("price"), e.get("pnl"), e.get("pct"),
                    e.get("created_at", datetime.now(timezone.utc).isoformat()),
                ),
            )
            imported_exits += 1

        conn.commit()
        return {"imported_trades": len(id_map), "imported_exits": imported_exits}

    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    finally:
        conn.close()
