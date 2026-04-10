from fastapi import APIRouter, HTTPException, Query
from backend.database import get_db
from backend.models import AccountCreate, AccountRename, AccountOut

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


@router.get("", response_model=list[AccountOut])
def list_accounts():
    conn = get_db()
    try:
        rows = conn.execute("SELECT id, name FROM accounts ORDER BY name").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@router.post("", response_model=AccountOut, status_code=201)
def create_account(body: AccountCreate):
    conn = get_db()
    try:
        cur = conn.execute("INSERT INTO accounts (name) VALUES (?)", (body.name,))
        conn.commit()
        row = conn.execute("SELECT id, name FROM accounts WHERE id = ?", (cur.lastrowid,)).fetchone()
        return dict(row)
    except Exception as e:
        if "UNIQUE" in str(e).upper():
            raise HTTPException(400, "Account name already exists")
        raise
    finally:
        conn.close()


@router.patch("/{account_id}", response_model=AccountOut)
def rename_account(account_id: int, body: AccountRename):
    conn = get_db()
    try:
        conn.execute("UPDATE accounts SET name = ? WHERE id = ?", (body.name, account_id))
        conn.commit()
        row = conn.execute("SELECT id, name FROM accounts WHERE id = ?", (account_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Account not found")
        return dict(row)
    except HTTPException:
        raise
    except Exception as e:
        if "UNIQUE" in str(e).upper():
            raise HTTPException(400, "Account name already exists")
        raise
    finally:
        conn.close()


@router.delete("/{account_id}", status_code=204)
def delete_account(
    account_id: int,
    action: str = Query(..., description="'reassign' or 'delete_trades'"),
    to: int = Query(None, description="Target account id when action=reassign"),
):
    conn = get_db()
    try:
        total = conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
        if total <= 1:
            raise HTTPException(400, "Cannot delete the last account")

        if action == "reassign":
            if to is None:
                raise HTTPException(400, "Must provide 'to' when action=reassign")
            target = conn.execute("SELECT id FROM accounts WHERE id = ?", (to,)).fetchone()
            if not target:
                raise HTTPException(404, "Target account not found")
            conn.execute("UPDATE trades SET account_id = ? WHERE account_id = ?", (to, account_id))
        elif action == "delete_trades":
            conn.execute("DELETE FROM trades WHERE account_id = ?", (account_id,))
        else:
            raise HTTPException(400, "action must be 'reassign' or 'delete_trades'")

        conn.execute("DELETE FROM accounts WHERE id = ?", (account_id,))
        conn.commit()
    finally:
        conn.close()
