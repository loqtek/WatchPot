"""Grafana Loki push API — POST /loki/api/v1/push (application/json)."""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any

import httpx


def _ns_timestamp(iso_or_none: str | None) -> str:
    if iso_or_none:
        try:
            dt = datetime.fromisoformat(iso_or_none.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return str(int(dt.timestamp() * 1_000_000_000))
        except ValueError:
            pass
    return str(int(time.time() * 1_000_000_000))


def build_loki_payload(event: dict[str, Any], cfg: dict[str, Any]) -> dict[str, Any]:
    labels = dict(cfg.get("extra_labels") or {})
    labels.setdefault("job", "watchpot")
    labels["event_type"] = str(event.get("event_type") or "unknown")
    labels["severity"] = str(event.get("severity") or "info")
    labels["channel"] = str(event.get("channel") or "runtime")
    if event.get("pot_id"):
        labels["pot_id"] = str(event["pot_id"])

    line_obj = {
        "message": event.get("raw_log") or json.dumps(event.get("payload") or event, default=str),
        "event_type": event.get("event_type"),
        "severity": event.get("severity"),
        "source": event.get("source"),
        "pot_id": event.get("pot_id"),
        "stack_id": event.get("stack_id"),
        "service_name": event.get("service_name"),
        "channel": event.get("channel"),
    }
    line = json.dumps(line_obj, default=str)
    ts = _ns_timestamp(event.get("received_at"))

    return {
        "streams": [
            {
                "stream": labels,
                "values": [[ts, line]],
            }
        ]
    }


async def send_loki(
    client: httpx.AsyncClient,
    event: dict[str, Any],
    cfg: dict[str, Any],
) -> tuple[bool, str]:
    url = (cfg.get("push_url") or "").strip()
    if not url:
        return False, "push_url is required"

    headers = {"Content-Type": "application/json"}
    tenant = (cfg.get("tenant_id") or "").strip()
    if tenant:
        headers["X-Scope-OrgID"] = tenant
    user = (cfg.get("username") or "").strip()
    password = cfg.get("password") or ""
    auth = (user, password) if user else None

    body = build_loki_payload(event, cfg)
    r = await client.post(url, json=body, headers=headers, auth=auth)
    if r.status_code >= 400:
        return False, f"Loki HTTP {r.status_code}: {r.text[:500]}"
    return True, f"Loki HTTP {r.status_code}"
