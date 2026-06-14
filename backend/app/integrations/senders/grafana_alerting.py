"""Grafana Alerting / universal webhook contact point."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import httpx


def build_grafana_alert_payload(event: dict[str, Any], cfg: dict[str, Any]) -> dict[str, Any]:
    """Shape compatible with Grafana unified alerting webhook contact points."""
    title = f"watchPot: {event.get('event_type', 'event')}"
    return {
        "receiver": "watchpot",
        "status": "firing" if str(event.get("severity", "")).lower() in ("error", "critical", "high") else "resolved",
        "alerts": [
            {
                "status": "firing",
                "labels": {
                    "alertname": str(event.get("event_type") or "watchpot.event"),
                    "severity": str(event.get("severity") or "info"),
                    "channel": str(event.get("channel") or "runtime"),
                    "pot_id": str(event.get("pot_id") or ""),
                    "source": str(event.get("source") or "watchpot"),
                },
                "annotations": {
                    "summary": title,
                    "description": (event.get("raw_log") or json.dumps(event.get("payload") or {}, default=str))[:4000],
                },
                "startsAt": event.get("received_at") or datetime.now(timezone.utc).isoformat(),
            }
        ],
        "groupLabels": {"alertname": "watchpot"},
        "commonLabels": {"integration": "watchpot"},
        "externalURL": "",
        "version": "1",
        "groupKey": f"watchpot-{event.get('pot_id', 'global')}",
        "truncatedAlerts": 0,
        "orgId": 1,
        "title": title,
        "state": "alerting",
        "message": title,
    }


async def send_grafana_alerting(
    client: httpx.AsyncClient,
    event: dict[str, Any],
    cfg: dict[str, Any],
) -> tuple[bool, str]:
    url = (cfg.get("webhook_url") or "").strip()
    if not url:
        return False, "webhook_url is required"

    headers = {"Content-Type": "application/json"}
    token = (cfg.get("bearer_token") or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"

    body = build_grafana_alert_payload(event, cfg)
    r = await client.post(url, json=body, headers=headers)
    if r.status_code >= 400:
        return False, f"Grafana webhook HTTP {r.status_code}: {r.text[:500]}"
    return True, f"Grafana webhook HTTP {r.status_code}"
