import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..config import settings
from ..repositories.import_ import ImportRepository, get_import_repo
from ..repositories.invoice import InvoiceRepository, get_invoice_repo
from ..schemas import (
    ImportRequest, ImportResponse, ImportWarning,
    DuplicateCheckResponse, DuplicateExisting,
    InvoiceListItem, InvoiceDetail, InvoiceLineOut, DeleteInvoiceResponse, InvoiceUpdate,
)
from ..services.ai_service import extract_pdf, ExtractionError

router = APIRouter(tags=["invoices"])

InvoiceRepo = Annotated[InvoiceRepository, Depends(get_invoice_repo)]
ImportRepo  = Annotated[ImportRepository,  Depends(get_import_repo)]


def _pdf_dir() -> Path:
    return Path(settings.pdf_dir)


@router.post("/extract")
async def extract(
    file: UploadFile = File(...),
    provider: str    = Form("anthropic"),
    model: str       = Form("claude-sonnet-4-6"),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted")
    pdf_bytes = await file.read()
    try:
        data = extract_pdf(pdf_bytes, provider, model)
        return {"success": True, "invoices": data.get("invoices", []),
                "provider": provider, "model": model}
    except ExtractionError as e:
        raise HTTPException(500, str(e))
    except RuntimeError as e:
        raise HTTPException(400, str(e))


@router.post("/import-invoice", response_model=ImportResponse)
def import_invoices(body: ImportRequest, repo: ImportRepo):
    try:
        ids, all_warnings = repo.import_invoices([inv.model_dump() for inv in body.invoices])
    except Exception as e:
        raise HTTPException(409, f"Duplicate invoice or constraint violation: {e}")
    return ImportResponse(
        success=True,
        invoice_ids=ids,
        warnings=[ImportWarning(**w) for w in all_warnings],
    )


class _LocationSuggestRequest(BaseModel):
    descriptions: list[str]


@router.post("/import/suggest-locations")
def suggest_locations(body: _LocationSuggestRequest, repo: ImportRepo):
    return {"suggestions": repo.suggest_locations(body.descriptions)}


@router.get("/invoices/check-duplicate", response_model=DuplicateCheckResponse)
def check_duplicate(vat: str = "", invoice_number: str = "", repo: InvoiceRepo = None):
    vat, invoice_number = vat.strip(), invoice_number.strip()
    if not vat or not invoice_number:
        return DuplicateCheckResponse(duplicate=False)
    is_dup, existing = repo.check_duplicate(vat, invoice_number)
    if is_dup:
        return DuplicateCheckResponse(duplicate=True, existing=DuplicateExisting(**existing))
    return DuplicateCheckResponse(duplicate=False)


@router.post("/invoices/attach-pdf")
async def attach_pdf(
    file: UploadFile = File(...),
    invoice_ids: str = Form(...),
    repo: InvoiceRepo = None,
):
    ids = [int(x.strip()) for x in invoice_ids.split(",") if x.strip()]
    if not ids:
        raise HTTPException(400, "No invoice IDs provided")
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted")

    pdf_dir = _pdf_dir()
    pdf_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4()}.pdf"
    (pdf_dir / filename).write_bytes(await file.read())

    for inv_id in ids:
        repo.set_pdf_path(inv_id, filename)
    repo.db.commit()
    return {"pdf_path": filename}


@router.get("/invoices/{invoice_id}/pdf")
def get_invoice_pdf(invoice_id: int, repo: InvoiceRepo):
    inv = repo.get_invoice(invoice_id)
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if not inv.get("pdf_path"):
        raise HTTPException(404, "No PDF attached to this invoice")
    file_path = _pdf_dir() / inv["pdf_path"]
    if not file_path.exists():
        raise HTTPException(404, "PDF file not found on storage")
    return FileResponse(str(file_path), media_type="application/pdf",
                        filename=f"invoice-{invoice_id}.pdf")


@router.get("/invoices", response_model=list[InvoiceListItem])
def list_invoices(
    repo: InvoiceRepo,
    supplier_id: int | None = Query(None),
    date_from:   str | None = Query(None),
    date_to:     str | None = Query(None),
    sort_by:     str        = Query("invoice_date"),
    sort_dir:    str        = Query("desc"),
):
    return repo.list_invoices(
        supplier_id=supplier_id,
        date_from=date_from,
        date_to=date_to,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )


@router.get("/invoices/{invoice_id}", response_model=InvoiceDetail)
def get_invoice(invoice_id: int, repo: InvoiceRepo):
    inv = repo.get_invoice(invoice_id)
    if not inv:
        raise HTTPException(404, "Invoice not found")
    inv["lines"] = [InvoiceLineOut(**l) for l in inv["lines"]]
    return InvoiceDetail(**inv)


@router.patch("/invoices/{invoice_id}")
def update_invoice(invoice_id: int, body: InvoiceUpdate, repo: InvoiceRepo):
    found = repo.update_invoice(
        invoice_id,
        body.invoice_date,
        body.invoice_number,
        body.invoice_type,
        body.delivery_date,
        body.notes,
    )
    if not found:
        raise HTTPException(404, "Invoice not found")
    return {"success": True}


@router.delete("/invoices/{invoice_id}", response_model=DeleteInvoiceResponse)
def delete_invoice(invoice_id: int, repo: InvoiceRepo):
    result = repo.delete_invoice(invoice_id)
    if not result:
        raise HTTPException(404, "Invoice not found")
    return DeleteInvoiceResponse(**result)
