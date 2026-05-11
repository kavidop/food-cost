from typing import Annotated

from fastapi import APIRouter, Depends, Query

from ..repositories.dashboard import DashboardRepository, get_dashboard_repo

router = APIRouter(tags=["dashboard"])

DashRepo = Annotated[DashboardRepository, Depends(get_dashboard_repo)]


@router.get("/dashboard")
def dashboard(repo: DashRepo):
    return repo.get_dashboard_data()


@router.get("/purchases/analytics")
def purchases_analytics(
    repo: DashRepo,
    granularity: str = Query("month"),
    months: int = Query(12, ge=0, le=36),
):
    return repo.get_purchases_analytics(granularity, months)


@router.get("/purchases/unmatched-lines")
def unmatched_lines(repo: DashRepo):
    return repo.get_unmatched_lines()
