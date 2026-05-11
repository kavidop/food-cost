from datetime import datetime, date
from pydantic import BaseModel


class CountSessionCreate(BaseModel):
    location_id: int
    notes: str | None = None


class UpdateCountDateRequest(BaseModel):
    count_date: date


class CountLineUpdate(BaseModel):
    product_id: int
    counted_qty: float | None
    notes: str | None = None


class BulkLineUpdate(BaseModel):
    lines: list[CountLineUpdate]


class CountLineOut(BaseModel):
    id: int
    product_id: int
    product_name: str
    unit: str | None
    system_qty: float | None
    counted_qty: float | None
    variance: float | None
    notes: str | None


class CountSessionOut(BaseModel):
    id: int
    location_id: int
    location_name: str
    count_date: date | None = None
    counted_at: datetime
    frozen_at: datetime | None
    notes: str | None
    status: str
    line_count: int
    counted_lines: int
    total_variance_items: int


class CountSessionDetail(CountSessionOut):
    lines: list[CountLineOut]


class PostResult(BaseModel):
    success: bool
    movements_created: int
    session_id: int
