"""Health and public API smoke tests."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health(client: AsyncClient) -> None:
    r = await client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"


@pytest.mark.asyncio
async def test_api_root(client: AsyncClient) -> None:
    r = await client.get("/api")
    assert r.status_code == 200
    assert "name" in r.json()


@pytest.mark.asyncio
async def test_protected_route_requires_auth(client: AsyncClient) -> None:
    r = await client.get("/api/pots")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_public_agent_requires_enrollment(client: AsyncClient) -> None:
    r = await client.get("/api/public/agent/ca.crt")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_csrf_endpoint(client: AsyncClient) -> None:
    r = await client.get("/api/auth/csrf")
    assert r.status_code == 200
    assert r.json().get("csrf_token")
    assert "wp_csrf" in r.cookies
