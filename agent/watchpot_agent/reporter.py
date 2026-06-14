"""Build infra events for the control-plane event stream (Docker + host context)."""

from __future__ import annotations

import json
import platform
import re
from typing import Any

from watchpot_agent.connection_capture import snapshot_honeypot_connections
from watchpot_agent.docker_ops import docker_logs, docker_ping, docker_ps_snapshot

CONTAINER_LOG_TAIL = 100
CONTAINER_LOG_MAX = 20


def _container_name(row: dict[str, Any]) -> str:
    name = str(row.get("Names") or row.get("Name") or "").strip()
    return name.lstrip("/")


def _is_running(row: dict[str, Any]) -> bool:
    state = str(row.get("State") or "").lower()
    status = str(row.get("Status") or "").lower()
    return "running" in state or status.startswith("up ")


def build_container_log_events(containers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Tail docker logs for running stack containers — ingested as runtime events."""
    events: list[dict[str, Any]] = []
    n = 0
    for row in containers:
        if n >= CONTAINER_LOG_MAX:
            break
        if not _is_running(row):
            continue
        name = _container_name(row)
        if not name:
            continue
        ok, out = docker_logs(name, tail=CONTAINER_LOG_TAIL)
        if not ok or not out.strip():
            continue
        labels = str(row.get("Labels") or "")
        project = ""
        if "com.docker.compose.project" in labels:
            m = re.search(r"com\.docker\.compose\.project=([^,]+)", labels)
            if m:
                project = m.group(1)
        events.append(
            {
                "event_type": "watchpot.agent.container_logs",
                "severity": "info",
                "source": "watchpot.agent",
                "channel": "runtime",
                "service_name": name,
                "payload": {
                    "container": name,
                    "image": row.get("Image"),
                    "compose_project": project or None,
                    "tail": CONTAINER_LOG_TAIL,
                },
                "raw_log": out[:12000],
            }
        )
        n += 1
    return events


def build_connection_events(containers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Live TCP peers on published honeypot ports — strongest IP signal."""
    connections = snapshot_honeypot_connections(containers)
    if not connections:
        return []
    return [
        {
            "event_type": "watchpot.agent.connections",
            "severity": "info",
            "source": "watchpot.agent",
            "channel": "runtime",
            "payload": {
                "connections": connections,
                "count": len(connections),
            },
            "raw_log": None,
        }
    ]


def build_infra_events() -> list[dict[str, Any]]:
    """Single batched snapshot suitable for POST /agent/v1/events."""
    ok_ps, data = docker_ps_snapshot()
    ok_dk, dk_msg = docker_ping()
    payload: dict[str, Any] = {
        "hostname": platform.node(),
        "system": platform.platform(),
        "docker_info_ok": ok_dk,
        "docker_ps_ok": ok_ps,
        "docker_hint": (dk_msg or "")[:2000] if ok_dk else (dk_msg or "")[:2000],
    }
    if ok_ps and isinstance(data, list):
        payload["containers"] = data[:120]
        raw_preview = json.dumps(data[:30], indent=2)[:12000]
    else:
        payload["containers"] = []
        raw_preview = str(data)[:8000] if isinstance(data, str) else ""

    out: list[dict[str, Any]] = [
        {
            "event_type": "watchpot.agent.infra_snapshot",
            "severity": "info",
            "source": "watchpot.agent",
            "channel": "infra",
            "payload": payload,
            "raw_log": raw_preview or None,
        }
    ]
    if ok_ps and isinstance(data, list):
        out.extend(build_connection_events(data))
        out.extend(build_container_log_events(data))
    return out
