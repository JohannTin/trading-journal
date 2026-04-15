import json
import uuid
from pathlib import Path
from fastapi import APIRouter, Query, UploadFile, File, HTTPException
from typing import Optional, List
from backend.database import get_db, UPLOADS_DIR
from backend.models import JournalUpsert, JournalOut


def _parse_tags(row: dict) -> dict:
    """Deserialize the JSON tags column into a Python list."""
    raw = row.get("tags")
    if not raw:
        row["tags"] = []
    else:
        try:
            row["tags"] = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            row["tags"] = []
    return row

JOURNAL_UPLOADS = UPLOADS_DIR / "journal"
ALLOWED_MIME = {"image/jpeg", "image/png", "image/gif", "image/webp"}
MIME_TO_EXT  = {"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp"}

router = APIRouter(prefix="/api/journal", tags=["journal"])


@router.get("", response_model=Optional[JournalOut])
def get_entry(date: str = Query(...)):
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT * FROM journal_entries WHERE date = ? AND deleted_at IS NULL ORDER BY id LIMIT 1",
            (date,),
        ).fetchone()
        return _parse_tags(dict(row)) if row else None
    finally:
        conn.close()


@router.get("/dates", response_model=list[str])
def get_dates_with_entries():
    """Return all dates that have a journal entry (for calendar dot indicators)."""
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT DISTINCT date FROM journal_entries WHERE deleted_at IS NULL ORDER BY date"
        ).fetchall()
        return [r["date"] for r in rows]
    finally:
        conn.close()


@router.get("/tags", response_model=List[str])
def get_all_tags():
    """Return all unique tags used across journal entries for autocomplete."""
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT tags FROM journal_entries WHERE deleted_at IS NULL AND tags IS NOT NULL AND tags != '[]'"
        ).fetchall()
        seen = set()
        for r in rows:
            try:
                for tag in json.loads(r["tags"]):
                    seen.add(tag)
            except (json.JSONDecodeError, TypeError):
                pass
        return sorted(seen)
    finally:
        conn.close()


@router.get("/search", response_model=List[JournalOut])
def search_entries(
    q: Optional[str] = Query(None),
    mood: Optional[str] = Query(None),
    tag: Optional[str] = Query(None),
    flagged: Optional[bool] = Query(None),
):
    conn = get_db()
    try:
        conditions = []
        params = []
        if mood:
            conditions.append("mood = ?")
            params.append(mood)
        if flagged is not None:
            conditions.append("flagged = ?")
            params.append(1 if flagged else 0)
        if tag:
            conditions.append('tags LIKE ?')
            params.append(f'%"{tag}"%')
        if q:
            conditions.append("(pre_market LIKE ? OR went_well LIKE ? OR to_improve LIKE ? OR tags LIKE ?)")
            like = f"%{q}%"
            params.extend([like, like, like, like])
        conditions.append("deleted_at IS NULL")
        where = "WHERE " + " AND ".join(conditions)
        rows = conn.execute(
            f"SELECT * FROM journal_entries {where} ORDER BY date DESC LIMIT 50",
            params,
        ).fetchall()
        return [_parse_tags(dict(r)) for r in rows]
    finally:
        conn.close()


@router.put("", response_model=JournalOut)
def upsert_entry(body: JournalUpsert):
    conn = get_db()
    try:
        tags_json = json.dumps(body.tags)
        vals = (body.pre_market, body.went_well, body.to_improve, body.mood, int(body.flagged), tags_json)

        existing = conn.execute(
            "SELECT id FROM journal_entries WHERE date = ? AND deleted_at IS NULL ORDER BY id LIMIT 1",
            (body.date,),
        ).fetchone()
        if existing:
            conn.execute(
                """UPDATE journal_entries
                   SET pre_market = ?, went_well = ?, to_improve = ?, mood = ?,
                       flagged = ?, tags = ?, account_id = NULL, updated_at = datetime('now')
                   WHERE id = ?""",
                (*vals, existing["id"]),
            )
        else:
            conn.execute(
                """INSERT INTO journal_entries (date, account_id, pre_market, went_well, to_improve, mood, flagged, tags, updated_at)
                   VALUES (?, NULL, ?, ?, ?, ?, ?, ?, datetime('now'))""",
                (body.date, *vals),
            )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM journal_entries WHERE date = ? AND deleted_at IS NULL ORDER BY id LIMIT 1",
            (body.date,),
        ).fetchone()
        return _parse_tags(dict(row))
    finally:
        conn.close()


# ── Journal Soft Delete ────────────────────────────────────────────────────────

@router.get("/deleted", response_model=List[JournalOut])
def list_deleted_entries():
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT * FROM journal_entries WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC"
        ).fetchall()
        return [_parse_tags(dict(r)) for r in rows]
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
def list_images(date: str = Query(...)):
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT * FROM journal_images WHERE date = ? ORDER BY order_index, id",
            (date,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@router.post("/images")
async def upload_image(
    file: UploadFile = File(...),
    date: str = Query(...),
):
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(400, "Only JPEG, PNG, GIF and WEBP images are allowed")

    ext = MIME_TO_EXT[file.content_type]
    filename = uuid.uuid4().hex + ext
    dest = JOURNAL_UPLOADS / filename
    dest.write_bytes(await file.read())

    conn = get_db()
    try:
        max_order = conn.execute(
            "SELECT COALESCE(MAX(order_index), -1) FROM journal_images WHERE date = ?",
            (date,),
        ).fetchone()[0]

        conn.execute(
            "INSERT INTO journal_images (date, account_id, filename, order_index) VALUES (?, NULL, ?, ?)",
            (date, filename, max_order + 1),
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
