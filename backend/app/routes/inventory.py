from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from fastapi import HTTPException

from ..repositories.inventory import InventoryRepository, get_inventory_repo
from ..schemas import (
    StockLocation, InventoryOverviewItem,
    ProductInventoryDetail, MovementHistoryResponse,
    AdjustStockRequest, RecordWasteRequest, TransferStockRequest, SetThresholdRequest,
    LocationCreateRequest, LocationUpdateRequest,
)

router = APIRouter(tags=["inventory"])

InvRepo = Annotated[InventoryRepository, Depends(get_inventory_repo)]


@router.get("/inventory/locations", response_model=list[StockLocation])
def get_locations(repo: InvRepo):
    return repo.get_locations()


@router.post("/inventory/locations", response_model=StockLocation, status_code=201)
def create_location(body: LocationCreateRequest, repo: InvRepo):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Location name cannot be empty")
    existing = repo.db.execute(
        "SELECT id FROM stock_locations WHERE LOWER(name) = LOWER(%s)", (name,)
    ).fetchone()
    if existing:
        raise HTTPException(409, "A location with that name already exists")
    return repo.create_location(name, body.sort_order)


@router.put("/inventory/locations/{location_id}", response_model=StockLocation)
def update_location(location_id: int, body: LocationUpdateRequest, repo: InvRepo):
    if body.name is not None and not body.name.strip():
        raise HTTPException(400, "Location name cannot be empty")
    loc = repo.update_location(location_id, body.name, body.sort_order, body.is_active)
    if not loc:
        raise HTTPException(404, "Location not found")
    return loc


@router.get("/inventory/overview", response_model=list[InventoryOverviewItem])
def get_overview(
    repo: InvRepo,
    location_id:      int  | None = Query(None),
    category_id:      int  | None = Query(None),
    supplier_id:      int  | None = Query(None),
    low_stock_only:   bool        = Query(False),
    include_inactive: bool        = Query(False),
):
    return repo.get_overview(
        location_id=location_id,
        category_id=category_id,
        supplier_id=supplier_id,
        low_stock_only=low_stock_only,
        include_inactive=include_inactive,
    )


@router.get("/inventory/overview/export")
def export_overview(
    repo: InvRepo,
    location_id:      int  | None = Query(None),
    category_id:      int  | None = Query(None),
    supplier_id:      int  | None = Query(None),
    low_stock_only:   bool        = Query(False),
    include_inactive: bool        = Query(False),
):
    rows = repo.get_overview(
        location_id=location_id,
        category_id=category_id,
        supplier_id=supplier_id,
        low_stock_only=low_stock_only,
        include_inactive=include_inactive,
    )
    csv_content = InventoryRepository.overview_to_csv(rows)
    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=inventory_overview.csv"},
    )


@router.get("/inventory/{product_id}", response_model=ProductInventoryDetail)
def get_product_detail(product_id: int, repo: InvRepo):
    detail = repo.get_product_detail(product_id)
    if not detail:
        raise HTTPException(404, "Product not found")
    return detail


@router.get("/inventory/{product_id}/movements", response_model=MovementHistoryResponse)
def get_movements(
    product_id: int,
    repo: InvRepo,
    location_id:   int  | None = Query(None),
    movement_type: str  | None = Query(None),
    limit:         int         = Query(50, ge=1, le=200),
    offset:        int         = Query(0,  ge=0),
):
    return repo.get_product_movements(
        product_id,
        location_id=location_id,
        movement_type=movement_type,
        limit=limit,
        offset=offset,
    )


@router.post("/inventory/{product_id}/adjust", status_code=204)
def adjust_stock(product_id: int, body: AdjustStockRequest, repo: InvRepo):
    if body.direction not in ("up", "down"):
        raise HTTPException(400, "direction must be 'up' or 'down'")
    if body.quantity <= 0:
        raise HTTPException(400, "quantity must be positive")
    try:
        repo.adjust_stock(
            product_id, body.location_id, body.direction,
            body.quantity, body.reason, body.notes,
        )
    except ValueError as e:
        raise HTTPException(409, str(e)) from e


@router.post("/inventory/{product_id}/waste", status_code=204)
def record_waste(product_id: int, body: RecordWasteRequest, repo: InvRepo):
    if body.quantity <= 0:
        raise HTTPException(400, "quantity must be positive")
    try:
        repo.record_waste(
            product_id, body.location_id, body.quantity, body.reason, body.notes,
        )
    except ValueError as e:
        raise HTTPException(409, str(e)) from e


@router.post("/inventory/{product_id}/transfer", status_code=204)
def transfer_stock(product_id: int, body: TransferStockRequest, repo: InvRepo):
    if body.from_location_id == body.to_location_id:
        raise HTTPException(400, "Source and destination locations must differ")
    if body.quantity <= 0:
        raise HTTPException(400, "quantity must be positive")
    try:
        repo.transfer_stock(
            product_id, body.from_location_id, body.to_location_id,
            body.quantity, body.notes,
        )
    except ValueError as e:
        raise HTTPException(409, str(e)) from e


@router.put("/inventory/{product_id}/threshold", status_code=204)
def set_threshold(product_id: int, body: SetThresholdRequest, repo: InvRepo):
    repo.set_threshold(product_id, body.min_stock_level)
