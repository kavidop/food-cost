from datetime import date, datetime
from typing import Literal
from pydantic import BaseModel, field_validator


class SupplierIn(BaseModel):
    name: str
    trade_name: str | None = None
    vat_number: str | None = None
    phone: str | None = None
    address: str | None = None


class LineItemIn(BaseModel):
    supplier_sku: str | None = None
    description: str
    quantity: float
    unit: str = "pcs"
    unit_price: float
    discount_percent: float = 0.0
    line_net_amount: float
    vat_rate: float = 0.0
    excise_duty_per_unit: float = 0.0
    line_gross_amount: float
    location_id: int = 1


class InvoiceIn(BaseModel):
    invoice_type: Literal["invoice", "credit_note"] = "invoice"
    invoice_number: str
    invoice_date: str
    supplier: SupplierIn
    net_amount: float
    vat_amount: float
    excise_duty_amount: float = 0.0
    gross_amount: float
    line_items: list[LineItemIn] = []

    @field_validator("invoice_date")
    @classmethod
    def validate_date(cls, v: str) -> str:
        import re
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", v):
            raise ValueError("invoice_date must be YYYY-MM-DD")
        return v


class ImportRequest(BaseModel):
    invoices: list[InvoiceIn]


class ImportWarning(BaseModel):
    sku: str | None = None
    existing_name: str
    invoice_name: str
    message: str


class ImportResponse(BaseModel):
    success: bool
    invoice_ids: list[int]
    warnings: list[ImportWarning]


class DuplicateExisting(BaseModel):
    id: int
    invoice_date: date
    supplier_name: str


class DuplicateCheckResponse(BaseModel):
    duplicate: bool
    existing: DuplicateExisting | None = None


class InvoiceLineOut(BaseModel):
    id: int
    supplier_product_id: int | None = None
    product_id: int | None = None
    line_description: str | None = None
    quantity: float
    unit: str | None = None
    unit_price: float
    discount_percent: float
    line_net_amount: float
    vat_rate: float
    excise_duty_per_unit: float
    line_gross_amount: float
    supplier_sku: str | None = None
    product_name: str | None = None


class InvoiceListItem(BaseModel):
    id: int
    invoice_number: str
    invoice_date: date
    invoice_type: str
    status: str
    net_amount: float
    vat_amount: float
    excise_duty_amount: float
    gross_amount: float
    supplier_name: str
    line_count: int


class InvoiceDetail(InvoiceListItem):
    delivery_date: date | None = None
    notes: str | None = None
    pdf_path: str | None = None
    lines: list[InvoiceLineOut]


class InvoiceUpdate(BaseModel):
    invoice_date:   str
    invoice_number: str
    invoice_type:   Literal["invoice", "credit_note"] = "invoice"
    delivery_date:  str | None = None
    notes:          str | None = None

    @field_validator("invoice_date")
    @classmethod
    def validate_invoice_date(cls, v: str) -> str:
        import re
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", v):
            raise ValueError("invoice_date must be YYYY-MM-DD")
        return v

    @field_validator("delivery_date")
    @classmethod
    def validate_delivery_date(cls, v: str | None) -> str | None:
        import re
        if v and not re.match(r"^\d{4}-\d{2}-\d{2}$", v):
            raise ValueError("delivery_date must be YYYY-MM-DD")
        return v or None


class DeleteInvoiceResponse(BaseModel):
    success: bool
    lines_deleted: int
    products_deleted: int
