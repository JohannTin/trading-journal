from fastapi import APIRouter, Query
from typing import Optional
from backend.database import run_backfill, run_force_recompute

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.post("/recompute", status_code=200)
def recompute():
    """
    Recompute and store denormalized MACD / MAE / MFE for all NULL rows.
    Run this once after upgrading from an older version, or after re-uploading
    chart data. Safe to call multiple times — only touches NULL rows.
    """
    run_backfill()
    return {"status": "ok"}


@router.post("/recompute-all", status_code=200)
def recompute_all(date: Optional[str] = Query(None)):
    """Force-recompute MACD / MAE / MFE for every exit, overwriting existing values.
    If date (YYYY-MM-DD) is provided, only recomputes exits for trades on that date."""
    count = run_force_recompute(date=date)
    return {"status": "ok", "recomputed": count}
