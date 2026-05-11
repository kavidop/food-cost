from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from ..repositories.product import ProductRepository, get_product_repo
from ..repositories.supplier import SupplierRepository, get_supplier_repo
from ..repositories.inventory import InventoryRepository, get_inventory_repo
from ..schemas import (
    ProductCreate, ProductUpdate, ProductMergeRequest, ProductSearchResponse, ProductListItem,
    ProductPickerItem, ProductInvoiceLine,
    CategoryOut, CategoryCreate, UnitOut,
    ProductCatalogStats, ProductReferenceData,
)

router = APIRouter(tags=["products"])

ProdRepo = Annotated[ProductRepository, Depends(get_product_repo)]
SupRepo  = Annotated[SupplierRepository,  Depends(get_supplier_repo)]
InvRepo  = Annotated[InventoryRepository, Depends(get_inventory_repo)]


@router.get("/products/reference-data", response_model=ProductReferenceData)
def get_reference_data(prod: ProdRepo, sup: SupRepo, inv: InvRepo):
    return {
        "categories": prod.list_categories(),
        "units":      prod.list_units(),
        "suppliers":  sup.list_suppliers(),
        "stats":      prod.get_catalog_stats(),
        "locations":  inv.get_locations(),
        "breakdown":  prod.get_main_category_breakdown(),
    }


@router.get("/products/stats", response_model=ProductCatalogStats)
def get_product_stats(repo: ProdRepo):
    return repo.get_catalog_stats()


@router.post("/products", status_code=201)
def create_product(data: ProductCreate, repo: ProdRepo):
    if not data.name.strip():
        raise HTTPException(400, "Name is required")
    product_id = repo.create_product(
        name=data.name.strip(),
        description=data.description,
        category_id=data.category_id,
        unit_id=data.unit_id,
        volume_ml=data.volume_ml,
        abv_percent=data.abv_percent,
        units_per_pack=data.units_per_pack,
        pack_unit_id=data.pack_unit_id,
        pack_unit_size_ml=data.pack_unit_size_ml,
        supplier_id=data.supplier_id,
        supplier_sku=data.supplier_sku,
        current_price=data.current_price,
    )
    return {"id": product_id}


@router.get("/products/all", response_model=list[ProductPickerItem])
def all_products(repo: ProdRepo, exclude_category_id: int | None = Query(None)):
    return repo.list_all(exclude_category_id=exclude_category_id)


@router.get("/products/search", response_model=ProductSearchResponse)
def search_products(
    repo: ProdRepo,
    q:           str = Query(""),
    category_id: str = Query(""),
    supplier_id: str = Query(""),
    page:        int = Query(1, ge=1),
    sort_by:     str = Query("name"),
    sort_dir:    str = Query("asc"),
):
    result = repo.search(
        q=q, category_id=category_id, supplier_id=supplier_id,
        page=page, sort_by=sort_by, sort_dir=sort_dir,
    )
    return ProductSearchResponse(
        products=[ProductListItem(**r) for r in result["products"]],
        **{k: result[k] for k in ("total", "page", "per_page", "sort_by", "sort_dir")},
    )


@router.get("/products/{product_id}", response_model=ProductListItem)
def get_product(product_id: int, repo: ProdRepo):
    product = repo.get_product(product_id)
    if not product:
        raise HTTPException(404, "Product not found")
    return product


@router.get("/products/{product_id}/invoices", response_model=list[ProductInvoiceLine])
def product_invoices(product_id: int, repo: ProdRepo):
    return repo.get_product_invoices(product_id)


@router.get("/products/{product_id}/cost-history")
def product_cost_history(product_id: int, repo: ProdRepo):
    return repo.get_product_cost_history(product_id)


@router.post("/products/{product_id}/merge")
def merge_product(product_id: int, data: ProductMergeRequest, repo: ProdRepo):
    if data.target_product_id == product_id:
        raise HTTPException(400, "Cannot merge a product with itself")
    try:
        repo.merge_products(product_id, data.target_product_id)
    except ValueError as e:
        raise HTTPException(404, str(e))
    return {"ok": True}


@router.put("/products/{product_id}")
def update_product(product_id: int, data: ProductUpdate, repo: ProdRepo):
    repo.update_product(
        product_id,
        data.name, data.description, data.category_id, data.unit_id,
        data.volume_ml, data.abv_percent, data.units_per_pack,
        data.pack_unit_id, data.pack_unit_size_ml,
        data.supplier_product_id, data.supplier_sku,
    )
    return {"success": True}


@router.get("/categories", response_model=list[CategoryOut])
def get_categories(repo: ProdRepo):
    return repo.list_categories()


@router.post("/categories", response_model=CategoryOut, status_code=201)
def create_category(data: CategoryCreate, repo: ProdRepo):
    if not data.name.strip():
        raise HTTPException(400, "Name is required")
    try:
        return repo.create_category(data.name.strip(), data.parent_id)
    except ValueError as e:
        raise HTTPException(409, str(e))


@router.put("/categories/{cat_id}", response_model=CategoryOut)
def update_category(cat_id: int, data: CategoryCreate, repo: ProdRepo):
    if not data.name.strip():
        raise HTTPException(400, "Name is required")
    if data.parent_id == cat_id:
        raise HTTPException(400, "A category cannot be its own parent")
    try:
        repo.update_category(cat_id, data.name.strip(), data.parent_id)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return CategoryOut(id=cat_id, name=data.name.strip(), parent_id=data.parent_id)


@router.delete("/categories/{cat_id}")
def delete_category(cat_id: int, repo: ProdRepo):
    try:
        repo.delete_category(cat_id)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"success": True}


@router.get("/units", response_model=list[UnitOut])
def get_units(repo: ProdRepo):
    return repo.list_units()
