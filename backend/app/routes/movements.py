from typing import Annotated

from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import StreamingResponse

from ..repositories.movements import MovementsRepository, get_movements_repo
from ..schemas.movements import (
    GlobalMovementListResponse, ReceiveStockRequest,
    GlobalAdjustmentRequest, AdjustmentResult, VoidMovementResponse,
    ReceivePendingRequest, PendingReceiptOut, LinkReceiptRequest,
)

router = APIRouter(tags=["movements"])

MovRepo = Annotated[MovementsRepository, Depends(get_movements_repo)]


@router.get("/movements", response_model=GlobalMovementListResponse)
def list_movements(
    repo: MovRepo,
    date_from:     str | None = Query(None),
    date_to:       str | None = Query(None),
    movement_type: str | None = Query(None),
    location_id:   int | None = Query(None),
    product_id:    int | None = Query(None),
    limit:         int        = Query(50, ge=1, le=200),
    offset:        int        = Query(0, ge=0),
):
    return repo.list_movements(
        date_from=date_from,
        date_to=date_to,
        movement_type=movement_type,
        location_id=location_id,
        product_id=product_id,
        limit=limit,
        offset=offset,
    )


@router.get("/movements/export")
def export_movements(
    repo: MovRepo,
    date_from:     str | None = Query(None),
    date_to:       str | None = Query(None),
    movement_type: str | None = Query(None),
    location_id:   int | None = Query(None),
    product_id:    int | None = Query(None),
):
    result = repo.list_movements(
        date_from=date_from,
        date_to=date_to,
        movement_type=movement_type,
        location_id=location_id,
        product_id=product_id,
        limit=10000,
        offset=0,
    )
    csv_content = MovementsRepository.movements_to_csv(result["movements"])
    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=stock_movements.csv"},
    )


@router.post("/movements/adjustment", response_model=AdjustmentResult)
def create_adjustment(body: GlobalAdjustmentRequest, repo: MovRepo):
    if body.direction not in ("up", "down"):
        raise HTTPException(400, "direction must be 'up' or 'down'")
    if body.quantity <= 0:
        raise HTTPException(400, "quantity must be positive")
    return repo.create_adjustment(
        product_id=body.product_id,
        location_id=body.location_id,
        direction=body.direction,
        quantity=body.quantity,
        reason=body.reason,
        notes=body.notes,
        allow_negative=body.allow_negative,
    )


@router.post("/movements/receive", status_code=204)
def receive_stock(body: ReceiveStockRequest, repo: MovRepo):
    if body.quantity <= 0:
        raise HTTPException(400, "quantity must be positive")
    repo.receive_stock(
        product_id=body.product_id,
        location_id=body.location_id,
        quantity=body.quantity,
        notes=body.notes,
    )


@router.post("/movements/receive-pending", status_code=204)
def receive_pending(body: ReceivePendingRequest, repo: MovRepo):
    if body.quantity <= 0:
        raise HTTPException(400, "quantity must be positive")
    repo.receive_pending(
        product_id=body.product_id,
        location_id=body.location_id,
        quantity=body.quantity,
        notes=body.notes,
    )


@router.get("/movements/pending-receipts", response_model=list[PendingReceiptOut])
def list_pending_receipts(
    repo: MovRepo,
    product_id: int | None = Query(None),
):
    return repo.get_pending_receipts(product_id=product_id)


@router.post("/movements/{movement_id}/link-invoice-line", status_code=204)
def link_invoice_line(movement_id: int, body: LinkReceiptRequest, repo: MovRepo):
    result = repo.link_to_invoice_line(movement_id, body.invoice_line_id)
    if not result["success"]:
        err = result.get("error", "unknown")
        if err == "not_found":
            raise HTTPException(404, "Movement not found")
        raise HTTPException(400, err)


@router.post("/movements/{movement_id}/void", response_model=VoidMovementResponse)
def void_movement(movement_id: int, repo: MovRepo):
    result = repo.void_movement(movement_id)
    if not result["success"] and result.get("error") == "not_found":
        raise HTTPException(404, "Movement not found")
    return result
