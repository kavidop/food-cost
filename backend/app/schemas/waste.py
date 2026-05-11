from datetime import date, datetime
from pydantic import BaseModel

REASON_CODES = ['expired', 'damaged', 'overproduction', 'preparation_loss', 'breakage']


class WasteCreate(BaseModel):
    product_id: int
    location_id: int
    quantity: float
    reason: str | None = None
    notes: str | None = None


class WasteReasonUpdate(BaseModel):
    reason: str | None = None
    notes: str | None = None


class WasteEntry(BaseModel):
    id: int
    product_id: int
    product_name: str
    category: str | None
    location_id: int
    location_name: str
    unit: str | None
    quantity: float
    reason: str | None
    notes: str | None
    moved_at: datetime
    estimated_value: float


class WasteListResponse(BaseModel):
    entries: list[WasteEntry]
    total: int
    limit: int
    offset: int


class WasteByReason(BaseModel):
    reason: str | None
    count: int
    total_quantity: float
    total_value: float


class WasteTopProduct(BaseModel):
    product_id: int
    product_name: str
    category: str | None
    unit: str | None
    event_count: int
    total_quantity: float
    total_value: float


class WasteTrendDay(BaseModel):
    date: date
    event_count: int
    total_value: float


class WasteAnalytics(BaseModel):
    total_events: int
    total_value: float
    by_reason: list[WasteByReason]
    top_products: list[WasteTopProduct]
    trend: list[WasteTrendDay]
