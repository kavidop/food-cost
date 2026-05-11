from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from ..repositories.supplier import SupplierRepository, get_supplier_repo
from ..schemas import (
    SupplierUpdate, SupplierListItem, SupplierDetail, MergeRequest,
    SupplierStats, SupplierInvoiceSummary, SupplierProductSummary,
)

router = APIRouter(tags=["suppliers"])

SupRepo = Annotated[SupplierRepository, Depends(get_supplier_repo)]


@router.get("/suppliers", response_model=list[SupplierListItem])
def list_suppliers(repo: SupRepo):
    return repo.list_suppliers()


@router.get("/suppliers/{supplier_id}", response_model=SupplierDetail)
def get_supplier(supplier_id: int, repo: SupRepo):
    supplier = repo.get_supplier(supplier_id)
    if not supplier:
        raise HTTPException(404, "Supplier not found")
    supplier["stats"]    = SupplierStats(**supplier["stats"])
    supplier["invoices"] = [SupplierInvoiceSummary(**r) for r in supplier["invoices"]]
    supplier["products"] = [SupplierProductSummary(**r) for r in supplier["products"]]
    return SupplierDetail(**supplier)


@router.put("/suppliers/{supplier_id}")
def update_supplier(supplier_id: int, data: SupplierUpdate, repo: SupRepo):
    repo.update_supplier(
        supplier_id,
        data.name, data.trade_name, data.vat_number,
        data.phone, data.email, data.address,
    )
    return {"ok": True}


@router.delete("/suppliers/{supplier_id}")
def delete_supplier(supplier_id: int, repo: SupRepo):
    try:
        repo.delete_supplier(supplier_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


@router.post("/suppliers/{supplier_id}/merge")
def merge_supplier(supplier_id: int, data: MergeRequest, repo: SupRepo):
    if not data.target_id or data.target_id == supplier_id:
        raise HTTPException(400, "Invalid target supplier")
    repo.merge_suppliers(supplier_id, data.target_id)
    return {"ok": True}
