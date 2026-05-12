from datetime import date
from pydantic import BaseModel


class ProductCatalogStats(BaseModel):
    total_active: int
    missing_cost: int
    low_stock: int
    out_of_stock: int
    stock_value: float
    pending_receipts: int = 0


class MainCategoryBreakdownItem(BaseModel):
    id: int
    name: str
    product_count: int
    stock_value: float
    total_spend: float
    low_stock: int
    out_of_stock: int


class ProductCreate(BaseModel):
    name: str
    description: str | None = None
    category_id: int | None = None
    unit_id: int | None = None
    volume_ml: float | None = None
    abv_percent: float | None = None
    units_per_pack: float | None = None
    pack_unit_id: int | None = None
    pack_unit_size_ml: float | None = None
    supplier_id: int | None = None
    supplier_sku: str | None = None
    current_price: float | None = None


class ProductUpdate(BaseModel):
    name: str
    description: str | None = None
    category_id: int | None = None
    unit_id: int | None = None
    volume_ml: float | None = None
    abv_percent: float | None = None
    units_per_pack: float | None = None
    pack_unit_id: int | None = None
    pack_unit_size_ml: float | None = None
    supplier_product_id: int | None = None
    supplier_sku: str | None = None


class ProductListItem(BaseModel):
    id: int
    name: str
    description: str | None = None
    category_id: int | None = None
    category: str | None = None
    unit_id: int | None = None
    unit: str | None = None
    volume_ml: float | None = None
    abv_percent: float | None = None
    units_per_pack: float | None = None
    pack_unit_id: int | None = None
    pack_unit: str | None = None
    pack_unit_size_ml: float | None = None
    supplier: str | None = None
    supplier_product_id: int | None = None
    supplier_sku: str | None = None
    current_price: float | None = None
    total_quantity_ordered: float | None = None


class ProductSearchResponse(BaseModel):
    products: list[ProductListItem]
    total: int
    page: int
    per_page: int
    sort_by: str
    sort_dir: str


class ProductPickerItem(BaseModel):
    id: int
    name: str
    units_per_pack: float
    unit: str | None = None
    current_price: float
    supplier: str | None = None
    supplier_sku: str | None = None


class ProductInvoiceLine(BaseModel):
    id: int
    invoice_number: str
    invoice_date: date
    supplier_name: str
    quantity: float
    unit: str | None = None
    unit_price: float
    discount_percent: float
    line_net_amount: float
    line_gross_amount: float


class ProductMergeRequest(BaseModel):
    target_product_id: int


class CategoryOut(BaseModel):
    id: int
    name: str
    parent_id: int | None = None
    is_service: bool = False


class CategoryCreate(BaseModel):
    name: str
    parent_id: int | None = None
    is_service: bool = False


class ServiceLineOut(BaseModel):
    invoice_line_id: int
    invoice_date: date
    invoice_number: str
    invoice_type: str
    supplier_name: str
    service_name: str
    category_id: int
    category_name: str
    quantity: float
    unit_price: float
    line_net_amount: float
    line_gross_amount: float


class UnitOut(BaseModel):
    id: int
    name: str
    abbreviation: str


class ProductReferenceData(BaseModel):
    categories: list[CategoryOut]
    units: list[UnitOut]
    suppliers: list
    stats: ProductCatalogStats
    locations: list
    breakdown: list[MainCategoryBreakdownItem] = []


class SupplierVariantOut(BaseModel):
    supplier_product_id: int
    supplier_id: int
    supplier_name: str
    supplier_sku: str | None = None
    supplier_product_name: str | None = None
    current_price: float | None = None
    is_preferred_supplier: int
    total_quantity_ordered: float | None = None


class SupplierVariantUpdate(BaseModel):
    supplier_sku: str | None = None
    supplier_product_name: str | None = None
    is_preferred_supplier: int | None = None
