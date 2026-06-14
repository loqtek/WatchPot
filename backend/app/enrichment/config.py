"""Enrichment configuration stored in app_settings."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_setting import AppSetting
from app.settings_keys import ENRICHMENT_CONFIG

DEFAULT_ENRICHMENT_CONFIG: dict[str, Any] = {
    "enabled": True,
    "auto_enrich_on_ingest": True,
    "cve_lookup_enabled": True,
    "elevate_severity": True,
    "min_confidence": 0.3,
    "max_events_per_batch": 100,
    "enrich_channels": ["runtime"],
    "skip_event_types": [
        "watchpot.agent.infra_snapshot",
        "watchpot.pot.created",
        "watchpot.pot.updated",
        "watchpot.stack.created",
        "watchpot.stack.updated",
        "watchpot.stack.deleted",
    ],
    "version": 2,
    "ip_tracking_enabled": True,
    "ip_track_channels": ["runtime", "infra"],
    "ip_lookup_enabled": True,
    "ip_lookup_cooldown_hours": 24,
    "abuseipdb_api_key": "",
}


def config_to_json(cfg: dict[str, Any]) -> str:
    return json.dumps(cfg, separators=(",", ":"))


def parse_config_json(raw: str | None) -> dict[str, Any]:
    if not raw:
        return dict(DEFAULT_ENRICHMENT_CONFIG)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return dict(DEFAULT_ENRICHMENT_CONFIG)
    if not isinstance(data, dict):
        return dict(DEFAULT_ENRICHMENT_CONFIG)
    merged = dict(DEFAULT_ENRICHMENT_CONFIG)
    merged.update(data)
    return merged


async def load_config(session: AsyncSession) -> dict[str, Any]:
    r = await session.execute(select(AppSetting).where(AppSetting.key == ENRICHMENT_CONFIG))
    row = r.scalar_one_or_none()
    return parse_config_json(row.value if row else None)


async def save_config(session: AsyncSession, cfg: dict[str, Any]) -> dict[str, Any]:
    merged = dict(DEFAULT_ENRICHMENT_CONFIG)
    merged.update(cfg)
    merged["version"] = int(merged.get("version") or 1)
    r = await session.execute(select(AppSetting).where(AppSetting.key == ENRICHMENT_CONFIG))
    row = r.scalar_one_or_none()
    payload = config_to_json(merged)
    if row is None:
        session.add(AppSetting(key=ENRICHMENT_CONFIG, value=payload))
    else:
        row.value = payload
    await session.flush()
    return merged
