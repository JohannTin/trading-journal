import uuid
from pathlib import Path
from fastapi import APIRouter, Query, UploadFile, File, HTTPException
from typing import Optional, List
from backend.database import get_db, UPLOADS_DIR
from backend.models import JournalUpsert, JournalOut

JOURNAL_UPLOADS = UPLOADS_DIR / "journal"
ALLOWED_MIME = {"image/jpeg", "image/png", "image/gif", "image/webp"}
MIME_TO_EXT  = {"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp"}

router = APIRouter(prefix="/api/journal", tags=["journal"])


@router.get("", response_model=Optional[JournalOut])
def get_entry(date: str = Query(...), account_id: Optional[int] = Query(None)):
    conn = get_db()
    try:
        if account_id is not None:
            row = conn.execute(
                "SELECT * FROM journal_entries WHERE date = ? AND account_id = ? AND deleted_at IS NULL",
                (date, account_id),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM journal_entries WHERE date = ? AND account_id IS NULL AND deleted_at IS NULL",
                (date,),
            ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


@router.get("/dates", response_model=list[str])
def get_dates_with_entries(account_id: Optional[int] = Query(None)):
    """Return all dates that have a journal entry (for calendar dot indicators)."""
    conn = get_db()
    try:
        if account_id is not None:
            rows = conn.execute(
                "SELECT date FROM journal_entries WHERE account_id = ? AND deleted_at IS NULL ORDER BY date",
                (account_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT date FROM journal_entries WHERE deleted_at IS NULL ORDER BY date"
            ).fetchall()
        return [r["date"] for r in rows]
    finally:
        conn.close()


@router.get("/search", response_model=List[JournalOut])
def search_entries(
    q: Optional[str] = Query(None),
    mood: Optional[str] = Query(None),
    flagged: Optional[bool] = Query(None),
    account_id: Optional[int] = Query(None),
):
    conn = get_db()
    try:
        conditions = []
        params = []
        if account_id is not None:
            conditions.append("account_id = ?")
            params.append(account_id)
        if mood:
            conditions.append("mood = ?")
            params.append(mood)
        if flagged is not None:
            conditions.append("flagged = ?")
            params.append(1 if flagged else 0)
        if q:
            conditions.append("(pre_market LIKE ? OR went_well LIKE ? OR to_improve LIKE ?)")
            like = f"%{q}%"
            params.extend([like, like, like])
        conditions.append("deleted_at IS NULL")
        where = "WHERE " + " AND ".join(conditions)
        rows = conn.execute(
            f"SELECT * FROM journal_entries {where} ORDER BY date DESC LIMIT 50",
            params,
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@router.put("", response_model=JournalOut)
def upsert_entry(body: JournalUpsert):
    conn = get_db()
    try:
        conn.execute(
            """INSERT INTO journal_entries (date, account_id, pre_market, went_well, to_improve, mood, flagged, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
               ON CONFLICT(date, account_id) DO UPDATE SET
                 pre_market = excluded.pre_market,
                 went_well  = excluded.went_well,
                 to_improve = excluded.to_improve,
                 mood       = excluded.mood,
                 flagged    = excluded.flagged,
                 updated_at = datetime('now')""",
            (body.date, body.account_id, body.pre_market, body.went_well, body.to_improve, body.mood, int(body.flagged)),
        )
        conn.commit()
        if body.account_id is not None:
            row = conn.execute(
                "SELECT * FROM journal_entries WHERE date = ? AND account_id = ?",
                (body.date, body.account_id),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM journal_entries WHERE date = ? AND account_id IS NULL",
                (body.date,),
            ).fetchone()
        return dict(row)
    finally:
        conn.close()


# ── Journal Soft Delete ────────────────────────────────────────────────────────

@router.get("/deleted", response_model=List[JournalOut])
def list_deleted_entries(account_id: Optional[int] = Query(None)):
    conn = get_db()
    try:
        if account_id is not None:
            rows = conn.execute(
                "SELECT * FROM journal_entries WHERE account_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC",
                (account_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM journal_entries WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC"
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@router.delete("/{entry_id}", status_code=204)
def delete_entry(entry_id: int):
    conn = get_db()
    try:
        conn.execute(
            "UPDATE journal_entries SET deleted_at = datetime('now') WHERE id = ?",
            (entry_id,),
        )
        conn.commit()
    finally:
        conn.close()


@router.patch("/{entry_id}/restore", status_code=204)
def restore_entry(entry_id: int):
    conn = get_db()
    try:
        conn.execute(
            "UPDATE journal_entries SET deleted_at = NULL WHERE id = ?",
            (entry_id,),
        )
        conn.commit()
    finally:
        conn.close()


@router.delete("/{entry_id}/permanent", status_code=204)
def permanent_delete_entry(entry_id: int):
    conn = get_db()
    try:
        conn.execute("DELETE FROM journal_entries WHERE id = ?", (entry_id,))
        conn.commit()
    finally:
        conn.close()


# ── Journal Images ─────────────────────────────────────────────────────────────

@router.get("/images")
def list_images(date: str = Query(...), account_id: Optional[int] = Query(None)):
    conn = get_db()
    try:
        if account_id is not None:
            rows = conn.execute(
                "SELECT * FROM journal_images WHERE date = ? AND account_id = ? ORDER BY order_index, id",
                (date, account_id),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM journal_images WHERE date = ? AND account_id IS NULL ORDER BY order_index, id",
                (date,),
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@router.post("/images")
async def upload_image(
    file: UploadFile = File(...),
    date: str = Query(...),
    account_id: Optional[int] = Query(None),
):
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(400, "Only JPEG, PNG, GIF and WEBP images are allowed")

    ext = MIME_TO_EXT[file.content_type]
    filename = uuid.uuid4().hex + ext
    dest = JOURNAL_UPLOADS / filename
    dest.write_bytes(await file.read())

    conn = get_db()
    try:
        if account_id is not None:
            max_order = conn.execute(
                "SELECT COALESCE(MAX(order_index), -1) FROM journal_images WHERE date = ? AND account_id = ?",
                (date, account_id),
            ).fetchone()[0]
        else:
            max_order = conn.execute(
                "SELECT COALESCE(MAX(order_index), -1) FROM journal_images WHERE date = ? AND account_id IS NULL",
                (date,),
            ).fetchone()[0]

        conn.execute(
            "INSERT INTO journal_images (date, account_id, filename, order_index) VALUES (?, ?, ?, ?)",
            (date, account_id, filename, max_order + 1),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM journal_images WHERE filename = ?", (filename,)).fetchone()
        return dict(row)
    finally:
        conn.close()


@router.delete("/images/{image_id}")
def delete_image(image_id: int):
    conn = get_db()
    try:
        row = conn.execute("SELECT filename FROM journal_images WHERE id = ?", (image_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Image not found")
        path = JOURNAL_UPLOADS / row["filename"]
        if path.exists():
            path.unlink()
        conn.execute("DELETE FROM journal_images WHERE id = ?", (image_id,))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()
