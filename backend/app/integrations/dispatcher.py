"""Route events to configured integrations."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.integrations.config import IntegrationConfig, get_integrations
from app.integrations.senders.grafana_alerting import send_grafana_alerting
from app.integrations.senders.loki import send_loki
from app.integrations.senders.wazuh import send_wazuh
from app.integrations.senders.zabbix import send_zabbix

log = logging.getLogger("watchpot.integrations")


async def forward_to_integration(
    client: httpx.AsyncClient,
    integration: IntegrationConfig,
    event: dict[str, Any],
) -> tuple[bool, str]:
    cfg = integration.config
    provider = integration.provider
    if provider == "grafana_loki":
        return await send_loki(client, event, cfg)
    if provider == "grafana_alerting":
        return await send_grafana_alerting(client, event, cfg)
    if provider == "zabbix":
        return await send_zabbix(event, cfg, client=client)
    if provider == "wazuh":
        return await send_wazuh(client, event, cfg)
    return False, f"Unknown provider: {provider}"


async def forward_event_to_all(event: dict[str, Any]) -> list[dict[str, str]]:
    channel = (event.get("channel") or "runtime").strip().lower()
    doc = get_integrations()
    results: list[dict[str, str]] = []

    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        for integration in doc.integrations:
            if not integration.enabled:
                continue
            allowed = [c.strip().lower() for c in integration.channels]
            if channel not in allowed and "all" not in allowed:
                continue
            try:
                ok, msg = await forward_to_integration(client, integration, event)
                results.append(
                    {
                        "integration_id": integration.id,
                        "name": integration.name,
                        "provider": integration.provider,
                        "ok": ok,
                        "message": msg,
                    }
                )
                if not ok:
                    log.warning("integration %s (%s): %s", integration.name, integration.provider, msg)
            except Exception as e:
                log.exception("integration %s failed", integration.id)
                results.append(
                    {
                        "integration_id": integration.id,
                        "name": integration.name,
                        "provider": integration.provider,
                        "ok": False,
                        "message": str(e)[:500],
                    }
                )
    return results
