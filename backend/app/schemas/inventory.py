from datetime import date, datetime
from pydantic import BaseModel


class StockLocation(BaseModel):
    id: int
    name: str
    sort_order: int
    is_active: int


class LocationCreateRequest(BaseModel):
    name: str
    sort_order: int = 0


class LocationUpdateRequest(BaseModel):
    name: str | None = None
    sort_order: int | None = None
    is_active: int | None = None


class InventoryOverviewItem(BaseModel):
    product_id: int
    product_name: str
    category: str | None = None
    category_id: int | None = None
    on_hand_qty: float
    unit: str | None = None
    unit_id: int | None = None
    min_stock_level: float | None = None
    is_active: int
    latest_cost: float | None = None
    weighted_avg_cost: float | None = None
    stock_value: float
    preferred_supplier: str | None = None
    preferred_supplier_id: int | None = None
    stock_status: str
    missing_cost: bool
    missing_conversion: bool
    has_pending_receipt: bool = False


# ── Product detail ─────────────────────────────────────────────────────────────

class ProductBalance(BaseModel):
    location_id: int
    location_name: str
    quantity: float
    unit: str | None = None


class ProductCostMetrics(BaseModel):
    last_purchase_cost: float | None = None
    last_purchase_date: date | None = None
    average_cost: float | None = None
    min_cost_90d: float | None = None
    max_cost_90d: float | None = None
    total_purchased: float = 0.0


class ProductSupplierLink(BaseModel):
    supplier_product_id: int
    supplier_id: int
    supplier_name: str
    supplier_sku: str | None = None
    current_price: float | None = None
    is_preferred: int
    total_ordered: float
    last_invoice_date: date | None = None


class ProductRecipeLink(BaseModel):
    recipe_id: int
    recipe_name: str
    selling_price: float | None = None
    quantity_needed: float
    unit: str | None = None
    can_produce: int


class ProductInventoryDetail(BaseModel):
    id: int
    name: str
    description: str | None = None
    category_id: int | None = None
    category: str | None = None
    unit_id: int | None = None
    unit: str | None = None
    is_active: int
    min_stock_level: float | None = None
    units_per_pack: float | None = None
    pack_unit_id: int | None = None
    pack_unit: str | None = None
    total_on_hand: float
    stock_value: float
    stock_status: str
    missing_cost: bool
    cost: ProductCostMetrics
    balances: list[ProductBalance]
    suppliers: list[ProductSupplierLink]
    recipes: list[ProductRecipeLink]


# ── Movement history ───────────────────────────────────────────────────────────

class MovementHistoryItem(BaseModel):
    id: int
    movement_type: str
    quantity: float
    unit: str | None = None
    location_id: int
    location_name: str
    reason: str | None = None
    reference_id: int | None = None
    reference_type: str | None = None
    notes: str | None = None
    moved_at: datetime
    invoice_number: str | None = None
    invoice_id: int | None = None


class MovementHistoryResponse(BaseModel):
    movements: list[MovementHistoryItem]
    total: int
    limit: int
    offset: int


# ── Action requests ────────────────────────────────────────────────────────────

class AdjustStockRequest(BaseModel):
    location_id: int
    direction: str        # 'up' | 'down'
    quantity: float
    reason: str | None = None
    notes: str | None = None


class RecordWasteRequest(BaseModel):
    location_id: int
    quantity: float
    reason: str | None = None
    notes: str | None = None


class TransferStockRequest(BaseModel):
    from_location_id: int
    to_location_id: int
    quantity: float
    notes: str | None = None


class SetThresholdRequest(BaseModel):
    min_stock_level: float | None = None
