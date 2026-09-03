"""Shared pytest fixtures."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

# Set test env before app modules load settings/engine.
# Override with DATABASE_URL when pointing at a different Postgres/MySQL instance.
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://watchpot:watchpot@127.0.0.1:5433/watchpot",
)
os.environ.setdefault("WATCHPOT_AUTO_LOCAL_AGENT", "false")
os.environ.setdefault("WATCHPOT_ALLOW_LOOPBACK_CORS", "true")
os.environ.setdefault("EXPOSE_OPENAPI", "true")
os.environ.setdefault("WATCHPOT_LOG_BOOTSTRAP_PASSWORD", "false")

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
