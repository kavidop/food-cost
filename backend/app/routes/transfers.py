from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from ..repositories.transfers import TransfersRepository, get_transfers_repo
from ..schemas.transfers import (
    TransferCreate, TransferDetail, TransferListResponse,
)

router = APIRouter(tags=["transfers"])

TrfRepo = Annotated[TransfersRepository, Depends(get_transfers_repo)]


@router.get("/transfers", response_model=TransferListResponse)
def list_transfers(
    repo: TrfRepo,
    from_location_id: int | None = Query(None),
    to_location_id:   int | None = Query(None),
    status:           str | None = Query(None),
    limit:            int        = Query(50, ge=1, le=200),
    offset:           int        = Query(0,  ge=0),
):
    return repo.list_transfers(
        from_location_id=from_location_id,
        to_location_id=to_location_id,
        status=status,
        limit=limit,
        offset=offset,
    )


@router.post("/transfers", response_model=TransferDetail, status_code=201)
def create_transfer(body: TransferCreate, repo: TrfRepo):
    if body.from_location_id == body.to_location_id:
        raise HTTPException(400, "Source and destination locations must differ")
    if not body.lines:
        raise HTTPException(400, "Transfer must have at least one line")
    for ln in body.lines:
        if ln.quantity <= 0:
            raise HTTPException(400, "All quantities must be positive")
    return repo.create_transfer(
        body.from_location_id,
        body.to_location_id,
        body.notes,
        [ln.model_dump() for ln in body.lines],
    )


@router.get("/transfers/{transfer_id}", response_model=TransferDetail)
def get_transfer(transfer_id: int, repo: TrfRepo):
    t = repo.get_transfer(transfer_id)
    if not t:
        raise HTTPException(404, "Transfer not found")
    return t


@router.post("/transfers/{transfer_id}/confirm", response_model=TransferDetail)
def confirm_transfer(transfer_id: int, repo: TrfRepo):
    t = repo.confirm_transfer(transfer_id)
    if t is None:
        raise HTTPException(400, "Transfer not found or not in draft status")
    return t


@router.post("/transfers/{transfer_id}/cancel", response_model=TransferDetail)
def cancel_transfer(transfer_id: int, repo: TrfRepo):
    t = repo.cancel_transfer(transfer_id)
    if t is None:
        raise HTTPException(400, "Transfer not found or not in draft status")
    return t
