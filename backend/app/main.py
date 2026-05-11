import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

logger = logging.getLogger("perf")

# Make sure the migrations package is importable regardless of CWD
sys.path.insert(0, str(Path(__file__).parent.parent))

from migrations.runner import run_migrations
from .config import settings
from .database import close_pool
from .routes import providers, invoices, products, suppliers, recipes, dashboard, browser, inventory, movements, stock_count, waste, transfers


def create_app() -> FastAPI:
    if not settings.database_url:
        run_migrations(settings.db_path)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        yield
        close_pool()

    app = FastAPI(
        title="Zubro Food Cost API",
        version="2.0.0",
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    @app.middleware("http")
    async def log_request_time(request: Request, call_next):
        t0 = time.perf_counter()
        response = await call_next(request)
        ms = (time.perf_counter() - t0) * 1000
        path = request.url.path
        if path.startswith("/api"):
            level = logging.WARNING if ms > 500 else logging.INFO
            logger.log(level, "%s %s  %.0fms", request.method, path, ms)
        return response

    default_origins = ["http://localhost:5173", "http://localhost:3000"]
    extra = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=default_origins + extra,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    for router in [
        providers.router,
        invoices.router,
        products.router,
        suppliers.router,
        recipes.router,
        dashboard.router,
        browser.router,
        inventory.router,
        movements.router,
        stock_count.router,
        waste.router,
        transfers.router,
    ]:
        app.include_router(router, prefix="/api")

    dist_dir = Path(__file__).parent.parent.parent / "frontend" / "dist"
    if dist_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(dist_dir / "assets")), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def serve_spa(full_path: str):
            return FileResponse(str(dist_dir / "index.html"))

    return app


app = create_app()
