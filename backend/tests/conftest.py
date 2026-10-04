"""Shared pytest fixtures."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

# Set test env before app modules load settings/engine.
# Override with DATABASE_URL when pointing at a different Postgres/MySQL instance.
# Do not override DATABASE_URL: backend/.env supplies the local helper password.
# Force production-like gates so a developer's local_dev .env cannot open public routes.
os.environ["WATCHPOT_STACK_MODE"] = "full"
os.environ["WATCHPOT_PUBLIC_AGENT_OPEN"] = "false"
os.environ["WATCHPOT_AUTO_LOCAL_AGENT"] = "false"
os.environ["WATCHPOT_ALLOW_LOOPBACK_CORS"] = "true"
os.environ["EXPOSE_OPENAPI"] = "true"
os.environ["WATCHPOT_LOG_BOOTSTRAP_PASSWORD"] = "false"
os.environ["WATCHPOT_TRUST_PROXY"] = "true"

from app.config import get_env_settings  # noqa: E402

get_env_settings.cache_clear()


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
