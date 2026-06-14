from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.integrations.config import (
    IntegrationConfig,
    IntegrationsDocument,
    config_to_json,
    get_integrations,
    merge_secrets,
    parse_integrations_json,
    redact_integration,
    reload_integrations_from_rows,
)
from app.integrations.dispatcher import forward_to_integration
from app.models.app_setting import AppSetting
from app.models.user import User
from app.schemas.integrations import (
    IntegrationOut,
    IntegrationTestBody,
    IntegrationTestOut,
    IntegrationTestResult,
    IntegrationsOut,
    IntegrationsUpdate,
)
from app.settings_keys import SIEM_INTEGRATIONS

import httpx

router = APIRouter(prefix="/integrations", tags=["integrations"])

TEST_EVENT = {
    "event_type": "watchpot.integration.test",
    "severity": "info",
    "source": "watchpot.control",
    "channel": "control",
    "pot_id": None,
    "stack_id": None,
    "service_name": "integrations",
    "payload": {"message": "WatchPot integration connectivity test"},
    "raw_log": "WatchPot integration connectivity test",
    "received_at": None,
}


def _to_out(doc: IntegrationsDocument, *, redact: bool) -> IntegrationsOut:
    items = [
        IntegrationOut.model_validate(redact_integration(i) if redact else i.model_dump())
        for i in doc.integrations
    ]
    return IntegrationsOut(version=doc.version, integrations=items)


@router.get("", response_model=IntegrationsOut)
async def list_integrations(_: Annotated[User, Depends(get_current_user)]) -> IntegrationsOut:
    return _to_out(get_integrations(), redact=True)


@router.put("", response_model=IntegrationsOut)
async def update_integrations(
    body: IntegrationsUpdate,
    _: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> IntegrationsOut:
    existing = get_integrations()
    by_id = {i.id: i for i in existing.integrations}

    merged: list[IntegrationConfig] = []
    for raw in body.integrations:
        inc = IntegrationConfig.model_validate(raw.model_dump())
        merged.append(merge_secrets(inc, by_id.get(inc.id)))

    doc = IntegrationsDocument(version=body.version, integrations=merged)
    result = await db.execute(select(AppSetting).where(AppSetting.key == SIEM_INTEGRATIONS))
    row = result.scalar_one_or_none()
    payload = config_to_json(doc)
    if row is None:
        db.add(AppSetting(key=SIEM_INTEGRATIONS, value=payload))
    else:
        row.value = payload
    await db.commit()

    reload_integrations_from_rows({SIEM_INTEGRATIONS: payload})
    return _to_out(get_integrations(), redact=True)


def _apply_test_config(target: IntegrationConfig, body: IntegrationTestBody | None) -> IntegrationConfig:
    if body is None or not body.config:
        return target
    merged = dict(target.config)
    for key, val in body.config.items():
        if val in (None, "", "••••••••"):
            continue
        merged[key] = val
    return target.model_copy(update={"config": merged})


def _resolve_integration(
    integration_id: str,
    provider: str | None,
) -> IntegrationConfig | None:
    doc = get_integrations()
    target = next((i for i in doc.integrations if i.id == integration_id), None)
    if target is not None:
        return target
    if provider:
        p = provider.strip().lower()
        return next((i for i in doc.integrations if i.provider == p), None)
    return None


@router.post("/test/{integration_id}", response_model=IntegrationTestOut)
async def test_integration(
    integration_id: str,
    _: Annotated[User, Depends(get_current_user)],
    provider: Annotated[str | None, Query(description="Fallback lookup by provider, e.g. zabbix")] = None,
    body: IntegrationTestBody | None = None,
) -> IntegrationTestOut:
    target = _resolve_integration(integration_id, provider)
    if target is None:
        raise HTTPException(
            status_code=404,
            detail="Integration not found — reload the page and Save changes once to sync IDs.",
        )

    target = _apply_test_config(target, body)

    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        ok, msg = await forward_to_integration(client, target, TEST_EVENT)

    return IntegrationTestOut(
        results=[
            IntegrationTestResult(integration_id=target.id, ok=ok, message=msg),
        ]
    )
