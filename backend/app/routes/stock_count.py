from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from ..repositories.stock_count import StockCountRepository, get_stock_count_repo
from ..schemas.stock_count import (
    CountSessionCreate, BulkLineUpdate, UpdateCountDateRequest,
    CountSessionOut, CountSessionDetail, PostResult,
    CountCategoryNodeOut, SetCountCategoriesRequest,
)

router = APIRouter(tags=["stock-count"])

SCRepo = Annotated[StockCountRepository, Depends(get_stock_count_repo)]


@router.get("/stock-count/sessions")
def list_sessions(repo: SCRepo, location_id: int | None = Query(None)):
    return repo.list_sessions(location_id=location_id)


@router.post("/stock-count/sessions", response_model=CountSessionDetail, status_code=201)
def create_session(body: CountSessionCreate, repo: SCRepo):
    loc = repo.db.execute(
        "SELECT id FROM stock_locations WHERE id = %s", (body.location_id,)
    ).fetchone()
    if not loc:
        raise HTTPException(404, "Location not found")
    return repo.create_session(body.location_id, body.notes)


@router.get("/stock-count/sessions/{session_id}", response_model=CountSessionDetail)
def get_session(session_id: int, repo: SCRepo):
    session = repo.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    return session


@router.patch("/stock-count/sessions/{session_id}/date", status_code=204)
def update_count_date(session_id: int, body: UpdateCountDateRequest, repo: SCRepo):
    session = repo._get_session_row(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    if session["status"] == "committed":
        raise HTTPException(409, "Cannot edit a committed session")
    repo.update_count_date(session_id, body.count_date)


@router.put("/stock-count/sessions/{session_id}/lines", status_code=204)
def update_lines(session_id: int, body: BulkLineUpdate, repo: SCRepo):
    session = repo.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    if session["status"] == "committed":
        raise HTTPException(409, "Cannot edit a committed session")
    repo.update_lines(session_id, [l.model_dump() for l in body.lines])


@router.post("/stock-count/sessions/{session_id}/refresh", response_model=CountSessionDetail)
def refresh_lines(session_id: int, repo: SCRepo):
    result = repo.refresh_lines(session_id)
    if not result:
        raise HTTPException(409, "Session not found or not in draft status")
    return result


@router.post("/stock-count/sessions/{session_id}/submit", response_model=CountSessionDetail)
def submit_session(session_id: int, repo: SCRepo):
    result = repo.submit_for_approval(session_id)
    if not result:
        raise HTTPException(409, "Session not found or not in draft status")
    return repo.get_session(session_id)


@router.post("/stock-count/sessions/{session_id}/approve", response_model=PostResult)
def approve_session(session_id: int, repo: SCRepo):
    result = repo.approve_and_post(session_id)
    if not result:
        raise HTTPException(409, "Session not found or not in pending_approval status")
    return result


@router.delete("/stock-count/sessions/{session_id}/lines/{product_id}", status_code=204)
def delete_line(session_id: int, product_id: int, repo: SCRepo):
    err = repo.delete_line(session_id, product_id)
    if err:
        raise HTTPException(409, err)


@router.get("/stock-count/sessions/{session_id}/categories", response_model=list[CountCategoryNodeOut])
def get_count_categories(session_id: int, repo: SCRepo):
    if not repo._get_session_row(session_id):
        raise HTTPException(404, "Session not found")
    return repo.get_count_categories(session_id)


@router.put("/stock-count/sessions/{session_id}/categories", response_model=list[CountCategoryNodeOut])
def set_count_categories(session_id: int, body: SetCountCategoriesRequest, repo: SCRepo):
    session = repo._get_session_row(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    if session["status"] == "committed":
        raise HTTPException(409, "Cannot edit a committed session")
    repo.set_count_categories(session_id, body.category_ids)
    return repo.get_count_categories(session_id)


@router.get("/stock-count/sessions/{session_id}/export")
def export_session(session_id: int, repo: SCRepo):
    session = repo._get_session_row(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    csv_content = repo.export_session_csv(session_id)
    counted_at = str(session["counted_at"])[:10]
    filename = f"stock_count_{session_id}_{counted_at}.csv"
    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
