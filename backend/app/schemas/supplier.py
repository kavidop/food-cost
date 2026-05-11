from datetime import date
from pydantic import BaseModel


class SupplierBase(BaseModel):
    name: str
    trade_name: str | None = None
    vat_number: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None


class SupplierUpdate(SupplierBase):
    pass


class MergeRequest(BaseModel):
    target_id: int


class SupplierListItem(SupplierBase):
    id: int
    is_active: bool
    invoice_count: int = 0
    total_spend: float = 0.0
    product_count: int = 0
    primary_category: str | None = None


class SupplierStats(BaseModel):
    invoice_count: int
    total_spend: float
    total_net: float
    total_vat: float
    product_count: int


class SupplierInvoiceSummary(BaseModel):
    id: int
    invoice_number: str
    invoice_date: date
    status: str
    net_amount: float
    vat_amount: float
    gross_amount: float
    line_count: int


class SupplierProductSummary(BaseModel):
    id: int
    name: str
    supplier_product_id: int
    supplier_sku: str | None = None
    current_price: float | None = None
    total_quantity_ordered: float | None = None
    category: str | None = None
    unit: str | None = None


class SupplierDetail(SupplierBase):
    id: int
    is_active: bool
    stats: SupplierStats
    invoices: list[SupplierInvoiceSummary]
    products: list[SupplierProductSummary]
