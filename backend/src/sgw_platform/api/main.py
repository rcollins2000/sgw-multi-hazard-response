"""FastAPI app factory + health/ready/metrics endpoints."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from sqlalchemy import text

from sgw_platform import __version__
from sgw_platform.api.routes import router as api_router
from sgw_platform.api.state import train_or_load
from sgw_platform.db.session import dispose_engine, session_scope
from sgw_platform.observability.logging import configure_logging, get_logger
from sgw_platform.observability.metrics import REGISTRY
from sgw_platform.polling import start_pollers
from sgw_platform.settings import get_settings

log = get_logger(__name__)


_background_tasks: set = set()


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
    import asyncio

    configure_logging()
    log.info("sgw.startup", version=__version__)
    # Train models + load graph in background so /health responds immediately.
    # Retain reference to prevent premature GC of the task.
    task = asyncio.create_task(train_or_load(session_scope))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    # Live NOAA pollers — NWS alerts every 60s, CO-OPS water levels every 6min.
    # Same set-retention pattern to keep tasks alive.
    for poller in start_pollers(session_scope):
        _background_tasks.add(poller)
        poller.add_done_callback(_background_tasks.discard)
    yield
    log.info("sgw.shutdown")
    # Snapshot the set — cancelling a task triggers its done-callback which
    # removes it from `_background_tasks`, so we can't iterate the live set.
    for pending in _background_tasks.copy():
        pending.cancel()
    await dispose_engine()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="SGW Platform",
        version=__version__,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health() -> dict[str, Any]:
        db_status = "unknown"
        try:
            async with session_scope() as session:
                await session.execute(text("SELECT 1"))
            db_status = "connected"
        except Exception as exc:
            log.warning("health.db_check_failed", error=str(exc))
            db_status = "unreachable"

        return {
            "status": "ok",
            "version": __version__,
            "db": db_status,
        }

    @app.get("/ready")
    async def ready() -> dict[str, Any]:
        postgis_version: str | None = None
        try:
            async with session_scope() as session:
                result = await session.execute(text("SELECT postgis_version()"))
                row = result.first()
                if row is not None:
                    postgis_version = row[0]
        except Exception as exc:
            log.error("ready.postgis_check_failed", error=str(exc))
            return {"status": "not_ready", "reason": "postgis_unavailable"}

        return {
            "status": "ready",
            "version": __version__,
            "postgis": postgis_version,
        }

    @app.get("/metrics")
    async def metrics() -> Response:
        return Response(
            content=generate_latest(REGISTRY),
            media_type=CONTENT_TYPE_LATEST,
        )

    app.include_router(api_router)
    return app


app = create_app()
