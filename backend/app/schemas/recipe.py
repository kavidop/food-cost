from datetime import datetime
from pydantic import BaseModel, model_validator, field_validator


class ComponentIn(BaseModel):
    product_id:   int | None = None
    composite_id: int | None = None
    quantity: float
    unit: str | None = None

    @model_validator(mode="after")
    def exactly_one_source(self) -> "ComponentIn":
        has_prod = self.product_id is not None
        has_comp = self.composite_id is not None
        if has_prod == has_comp:
            raise ValueError("Exactly one of product_id or composite_id must be set")
        return self

    @field_validator("quantity")
    @classmethod
    def quantity_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("Quantity must be greater than 0")
        return v


class RecipeCreate(BaseModel):
    name: str
    category: str | None = None
    selling_price: float | None = None
    selling_price_takeaway: float | None = None
    selling_price_delivery: float | None = None
    servings: int = 1
    yield_quantity: float | None = None
    yield_unit: str | None = None
    prep_time_minutes: int | None = None
    notes: str | None = None
    product_type: str = "composite"
    components: list[ComponentIn] = []

    @field_validator("servings")
    @classmethod
    def servings_positive(cls, v: int) -> int:
        if v < 1:
            raise ValueError("Servings must be at least 1")
        return v

    @field_validator("product_type")
    @classmethod
    def valid_product_type(cls, v: str) -> str:
        if v not in ("composite", "intermediate"):
            raise ValueError("product_type must be 'composite' or 'intermediate'")
        return v


class RecipeUpdate(RecipeCreate):
    pass


class ArchiveRequest(BaseModel):
    is_archived: bool = True


class ComponentOut(BaseModel):
    id: int
    product_id:   int | None = None
    composite_id: int | None = None
    is_composite: bool = False
    product_name: str
    quantity: float
    unit: str | None = None
    product_unit: str | None = None
    unit_cost: float
    component_cost: float
    stock_retail: float
    can_produce: int


class RecipeLinkItem(BaseModel):
    id: int
    name: str
    selling_price: float | None = None
    quantity: float
    unit: str | None = None


class RecipeListItem(BaseModel):
    id: int
    name: str
    category: str | None = None
    selling_price: float | None = None
    selling_price_takeaway: float | None = None
    selling_price_delivery: float | None = None
    servings: int
    yield_quantity: float | None = None
    yield_unit: str | None = None
    prep_time_minutes: int | None = None
    notes: str | None = None
    is_archived: bool = False
    created_at: datetime
    product_type: str = "composite"
    total_food_cost: float
    component_count: int
    max_producible: int
    margin_pct: float | None = None
    current_stock: float = 0.0
    linked_product_id: int | None = None


class RecipeDetail(RecipeListItem):
    components: list[ComponentOut]
    bottleneck: str | None = None
    linked_in_recipes: list[RecipeLinkItem] = []


class ProductionBatchCreate(BaseModel):
    location_id: int
    batch_size: float = 1.0
    actual_yield: float | None = None
    notes: str | None = None

    @field_validator("batch_size")
    @classmethod
    def batch_size_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("Batch size must be greater than 0")
        return v


class ProductionBatchOut(BaseModel):
    id: int
    composite_product_id: int
    location_id: int
    location_name: str
    batch_size: float
    produced_at: datetime
    notes: str | None = None
    status: str
    total_food_cost: float
    cost_per_serving: float


class ProductionBatchResult(BaseModel):
    batch_id: int
    total_cost: float
    movements_created: int
    expected_yield: float | None = None
    actual_yield: float | None = None
