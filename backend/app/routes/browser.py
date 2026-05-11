from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query

from ..database import get_db

router = APIRouter(tags=["browser"])

DB = Annotated[Any, Depends(get_db)]


@router.get("/tables")
def list_tables(db: DB):
    names = [r[0] for r in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()]
    return [
        {"name": n, "count": db.execute(f"SELECT COUNT(*) FROM [{n}]").fetchone()[0]}
        for n in names
    ]


@router.get("/table/{table_name}")
def browse_table(
    table_name: str,
    db:         DB,
    page:       int = Query(1, ge=1),
    per_page:   int = Query(50, ge=1, le=500),
):
    if not db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table_name,)
    ).fetchone():
        raise HTTPException(404, "Table not found")

    offset = (page - 1) * per_page
    total  = db.execute(f"SELECT COUNT(*) FROM [{table_name}]").fetchone()[0]
    rows   = db.execute(f"SELECT * FROM [{table_name}] LIMIT ? OFFSET ?", (per_page, offset)).fetchall()
    cols   = db.execute(f"PRAGMA table_info([{table_name}])").fetchall()

    return {
        "columns":  [{"name": c["name"], "type": c["type"]} for c in cols],
        "rows":     [dict(r) for r in rows],
        "total":    total,
        "page":     page,
        "per_page": per_page,
    }
