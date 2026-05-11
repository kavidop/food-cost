from datetime import datetime
from pydantic import BaseModel


class MovementWithBalance(BaseModel):
    id: int
    product_id: int
    product_name: str
    movement_type: str
    quantity: float
    unit: str | None = None
    location_id: int | None = None
    location_name: str | None = None
    reason: str | None = None
    reference_id: int | None = None
    reference_type: str | None = None
    notes: str | None = None
    moved_at: datetime
    invoice_number: str | None = None
    invoice_id: int | None = None
    balance_before: float
    balance_after: float
    is_voided: bool = False


class GlobalMovementListResponse(BaseModel):
    movements: list[MovementWithBalance]
    total: int
    limit: int
    offset: int


class ReceiveStockRequest(BaseModel):
    product_id: int
    location_id: int
    quantity: float
    notes: str | None = None


class GlobalAdjustmentRequest(BaseModel):
    product_id: int
    location_id: int
    direction: str           # "up" | "down"
    quantity: float
    reason: str | None = None
    notes: str | None = None
    allow_negative: bool = False


class AdjustmentResult(BaseModel):
    success: bool
    warning: str | None = None
    current_stock: float | None = None
    resulting_stock: float | None = None


class VoidMovementResponse(BaseModel):
    success: bool
    error: str | None = None


class ReceivePendingRequest(BaseModel):
    product_id: int
    location_id: int
    quantity: float
    notes: str | None = None


class PendingReceiptOut(BaseModel):
    id: int
    product_id: int
    product_name: str
    location_id: int | None
    location_name: str | None
    quantity: float
    unit: str | None = None
    notes: str | None = None
    moved_at: datetime


class LinkReceiptRequest(BaseModel):
    invoice_line_id: int
