from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from ..repositories.waste import WasteRepository, get_waste_repo
from ..schemas.waste import (
    WasteCreate, WasteReasonUpdate,
    WasteListResponse, WasteAnalytics, REASON_CODES,
)

router = APIRouter(tags=["waste"])

WasteRepo = Annotated[WasteRepository, Depends(get_waste_repo)]


@router.get("/waste/reason-codes")
def list_reason_codes():
    return {"codes": REASON_CODES}


@router.get("/waste", response_model=WasteListResponse)
def list_waste(
    repo: WasteRepo,
    date_from:   str | None = Query(None),
    date_to:     str | None = Query(None),
    location_id: int | None = Query(None),
    category_id: int | None = Query(None),
    reason:      str | None = Query(None),
    limit:       int        = Query(50, ge=1, le=200),
    offset:      int        = Query(0, ge=0),
):
    return repo.list_waste(
        date_from=date_from,
        date_to=date_to,
        location_id=location_id,
        category_id=category_id,
        reason=reason,
        limit=limit,
        offset=offset,
    )


@router.post("/waste", status_code=201)
def create_waste(body: WasteCreate, repo: WasteRepo):
    if body.quantity <= 0:
        raise HTTPException(400, "quantity must be positive")
    if body.reason and body.reason not in REASON_CODES:
        raise HTTPException(400, f"reason must be one of: {', '.join(REASON_CODES)}")
    product = repo.db.execute("SELECT id FROM products WHERE id = %s", (body.product_id,)).fetchone()
    if not product:
        raise HTTPException(404, "Product not found")
    try:
        return repo.create_waste(
            product_id=body.product_id,
            location_id=body.location_id,
            quantity=body.quantity,
            reason=body.reason,
            notes=body.notes,
        )
    except ValueError as e:
        raise HTTPException(409, str(e)) from e


@router.patch("/waste/{movement_id}/reason", status_code=204)
def update_reason(movement_id: int, body: WasteReasonUpdate, repo: WasteRepo):
    if body.reason and body.reason not in REASON_CODES:
        raise HTTPException(400, f"reason must be one of: {', '.join(REASON_CODES)}")
    ok = repo.update_reason(movement_id, body.reason, body.notes)
    if not ok:
        raise HTTPException(404, "Waste movement not found")


@router.get("/waste/analytics", response_model=WasteAnalytics)
def get_analytics(
    repo: WasteRepo,
    date_from:   str | None = Query(None),
    date_to:     str | None = Query(None),
    location_id: int | None = Query(None),
):
    return repo.get_analytics(
        date_from=date_from, date_to=date_to, location_id=location_id,
    )


@router.get("/waste/export")
def export_waste(
    repo: WasteRepo,
    date_from:   str | None = Query(None),
    date_to:     str | None = Query(None),
    location_id: int | None = Query(None),
    category_id: int | None = Query(None),
    reason:      str | None = Query(None),
):
    result = repo.list_waste(
        date_from=date_from, date_to=date_to,
        location_id=location_id, category_id=category_id,
        reason=reason, limit=10000, offset=0,
    )
    csv_content = WasteRepository.waste_to_csv(result["entries"])
    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=waste_log.csv"},
    )
