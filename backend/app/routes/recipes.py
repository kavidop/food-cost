from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from ..repositories.recipe import RecipeRepository, get_recipe_repo
from ..schemas import (
    RecipeCreate, RecipeUpdate, RecipeListItem, RecipeDetail, ComponentOut, ArchiveRequest,
    ProductionBatchCreate, ProductionBatchOut, ProductionBatchResult,
)

router = APIRouter(tags=["recipes"])

RecRepo = Annotated[RecipeRepository, Depends(get_recipe_repo)]


@router.get("/composite-products", response_model=list[RecipeListItem])
def list_recipes(
    repo: RecRepo,
    include_archived: bool = Query(False),
    product_type: str | None = Query(None),
):
    return repo.list_recipes(include_archived=include_archived, product_type=product_type)


@router.get("/composite-products/{cp_id}", response_model=RecipeDetail)
def get_recipe(cp_id: int, repo: RecRepo):
    recipe = repo.get_recipe(cp_id)
    if not recipe:
        raise HTTPException(404, "Recipe not found")
    recipe["components"] = [ComponentOut(**c) for c in recipe["components"]]
    return RecipeDetail(**recipe)


@router.post("/composite-products", status_code=201)
def create_recipe(data: RecipeCreate, repo: RecRepo):
    return {"id": repo.create_recipe(data)}


@router.put("/composite-products/{cp_id}")
def update_recipe(cp_id: int, data: RecipeUpdate, repo: RecRepo):
    repo.update_recipe(cp_id, data)
    return {"ok": True}


@router.post("/composite-products/{cp_id}/duplicate", status_code=201)
def duplicate_recipe(cp_id: int, repo: RecRepo):
    new_id = repo.duplicate_recipe(cp_id)
    if new_id is None:
        raise HTTPException(404, "Recipe not found")
    return {"id": new_id}


@router.patch("/composite-products/{cp_id}/archive")
def archive_recipe(cp_id: int, body: ArchiveRequest, repo: RecRepo):
    if not repo.set_archived(cp_id, body.is_archived):
        raise HTTPException(404, "Recipe not found")
    return {"ok": True}


@router.delete("/composite-products/{cp_id}")
def delete_recipe(cp_id: int, repo: RecRepo):
    repo.delete_recipe(cp_id)
    return {"ok": True}


@router.post("/composite-products/{cp_id}/produce", response_model=ProductionBatchResult, status_code=201)
def produce_batch(cp_id: int, data: ProductionBatchCreate, repo: RecRepo):
    try:
        result = repo.create_production_batch(cp_id, data)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return result


@router.get("/composite-products/{cp_id}/batches", response_model=list[ProductionBatchOut])
def list_batches(cp_id: int, repo: RecRepo):
    return repo.list_production_batches(cp_id)
