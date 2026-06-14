import asyncio
import logging

from contextlib import asynccontextmanager
import os

from fastapi import FastAPI, HTTPException, Request
from prometheus_fastapi_instrumentator import Instrumentator
from starlette.responses import Response

from app.config import get_env_settings
from app.bootstrap import run_bootstrap
from app.database import async_session_factory, init_db
from app.local_agent import reconcile_auto_local_agent
from app.middleware.dynamic_cors import DynamicCORSMiddleware
from app.runtime_config import get_cors_origins
from app.routers import (
    agent_api,
    analytics,
    audit_logs,
    auth,
    backups,
    events,
    enrichment,
    operator_dashboards,
    integrations,
    operator_settings,
    pot_ops,
    pots,
    public_agent,
    snapshots,
    stacks,
    users,
)
from app.enrichment.scheduler import enrichment_scheduler_loop
from app.services.backup_scheduler import backup_scheduler_loop

log = logging.getLogger("watchpot.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    async with async_session_factory() as session:
        await run_bootstrap(session)
        local_agent = await reconcile_auto_local_agent(session, reason="startup")
        await session.commit()
        if local_agent is not None:
            if local_agent.credentials_written:
                log.info(
                    "Auto local agent ready — pot %s (credentials written to agent/.env)",
                    local_agent.pot_id,
                )
            else:
                log.info("Auto local agent already configured for pot %s", local_agent.pot_id)
    app.state.cors_origins = get_cors_origins()
    scheduler_task = asyncio.create_task(backup_scheduler_loop())
    enrichment_task = asyncio.create_task(enrichment_scheduler_loop())
    try:
        yield
    finally:
        enrichment_task.cancel()
        scheduler_task.cancel()
        try:
            await enrichment_task
        except asyncio.CancelledError:
            pass
        try:
            await scheduler_task
        except asyncio.CancelledError:
            pass


_env = get_env_settings()
_docs = "/docs" if _env.expose_openapi else None
app = FastAPI(
    title=_env.app_name,
    lifespan=lifespan,
    docs_url=_docs,
    redoc_url="/redoc" if _env.expose_openapi else None,
    openapi_url="/openapi.json" if _env.expose_openapi else None,
)

app.add_middleware(DynamicCORSMiddleware)

_api_role = os.environ.get("WATCHPOT_API_ROLE", _env.watchpot_api_role).lower()
if _api_role == "agent":
    app.include_router(agent_api.router, prefix="/api")
else:
    app.include_router(auth.router, prefix="/api")
    app.include_router(analytics.router, prefix="/api")
    app.include_router(operator_dashboards.router, prefix="/api")
    app.include_router(operator_settings.router, prefix="/api")
    app.include_router(users.router, prefix="/api")
    app.include_router(integrations.router, prefix="/api")
    app.include_router(enrichment.router, prefix="/api")
    app.include_router(pots.router, prefix="/api")
    app.include_router(pot_ops.router, prefix="/api")
    app.include_router(snapshots.router, prefix="/api")
    app.include_router(backups.router, prefix="/api")
    app.include_router(stacks.router, prefix="/api")
    app.include_router(events.router, prefix="/api")
    app.include_router(audit_logs.router, prefix="/api")
    app.include_router(public_agent.router, prefix="/api")
    app.include_router(agent_api.router, prefix="/api")


def _patch_instrumentator_routing() -> None:
    """FastAPI >=0.137 lists _IncludedRouter in app.routes; instrumentator expects Route.path."""
    try:
        from fastapi.routing import _iter_included_route_candidates
    except ImportError:
        return

    from prometheus_fastapi_instrumentator import routing as prom_routing

    original_get_route_name = prom_routing._get_route_name

    def get_route_name(scope, routes, route_name=None):
        flat_routes = list(_iter_included_route_candidates(routes))
        return original_get_route_name(scope, flat_routes, route_name)

    prom_routing._get_route_name = get_route_name


_patch_instrumentator_routing()
Instrumentator().instrument(app)


def _metrics_auth_ok(request: Request) -> bool:
    token = (_env.metrics_token or "").strip()
    if not token:
        return True
    auth = request.headers.get("authorization") or ""
    if not auth.lower().startswith("bearer "):
        return False
    return auth.split(" ", 1)[1].strip() == token


@app.get("/metrics", include_in_schema=False)
async def metrics(request: Request):
    if not _metrics_auth_ok(request):
        raise HTTPException(status_code=401, detail="Metrics token required")
    from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "api_role": _api_role}


@app.get("/api")
async def api_root() -> dict:
    return {
        "name": _env.app_name,
        "docs": "/docs" if _env.expose_openapi else None,
        "agent": "/api/agent/v1",
        "api_role": _api_role,
    }
