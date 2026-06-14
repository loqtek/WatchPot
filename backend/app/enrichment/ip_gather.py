"""Unified IP extraction from events — logs, JSON, payloads, and agent connection snapshots."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from app.enrichment.ip_utils import is_public_ip

# --- Structured payload paths ---
_PAYLOAD_IP_KEYS = (
    "src_ip",
    "peer_ip",
    "source_ip",
    "remote_addr",
    "remote_ip",
    "client_ip",
    "ip",
    "address",
    "host",
)

# --- Text / log patterns (honeypot + web + ssh) ---
_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("cowrie_json", re.compile(r'"(?:src_ip|peer_ip|session\.ip)"\s*:\s*"([^"]+)"')),
    ("cowrie_connect", re.compile(r"(?i)New connection:\s*(?:[\d.]+:)?(\d+\.\d+\.\d+\.\d+)")),
    ("cowrie_login", re.compile(r"(?i)(?:login attempt|authentication|auth)\s+\[.*?/\s*(\d+\.\d+\.\d+\.\d+)")),
    ("ssh_failed", re.compile(r"(?i)(?:Failed password|Invalid user|Accepted \w+).*?\sfrom\s+(\d+\.\d+\.\d+\.\d+)\s")),
    ("ssh_preauth", re.compile(r"(?i)Connection from\s+(\d+\.\d+\.\d+\.\d+)")),
    ("http_clf", re.compile(r"^(\d+\.\d+\.\d+\.\d+)\s+-\s+-?\s*\[")),  # common log format
    ("x_forwarded", re.compile(r"(?i)(?:X-Forwarded-For|X-Real-IP|Client-IP)[:\s]+(\d+\.\d+\.\d+\.\d+)")),
    ("generic_from", re.compile(r"(?i)(?:from|client|remote|peer|source)[:\s=]+(\d+\.\d+\.\d+\.\d+)")),
    ("generic_src", re.compile(r"(?i)(?:src_ip|source_ip|peer_ip|remote_addr)[:\s=]+(\d+\.\d+\.\d+\.\d+)")),
]

_IPV4_ANY = re.compile(r"\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b")

# Noise IPs commonly seen in logs that are not attackers
_NOISE_IPS = frozenset(
    {
        "0.0.0.0",
        "127.0.0.1",
        "255.255.255.255",
    }
)


@dataclass
class IpObservation:
    ip: str
    source: str
    port: int | None = None
    container: str | None = None
    service: str | None = None


def _add_ip(out: dict[str, IpObservation], ip: str, *, source: str, port: int | None = None, container: str | None = None, service: str | None = None) -> None:
    ip = ip.strip()
    if ip in _NOISE_IPS or not is_public_ip(ip):
        return
    if ip not in out:
        out[ip] = IpObservation(ip=ip, source=source, port=port, container=container, service=service)


def _walk_json(obj: Any, out: dict[str, IpObservation], *, depth: int = 0) -> None:
    if depth > 8:
        return
    if isinstance(obj, dict):
        for key, val in obj.items():
            kl = str(key).lower()
            if kl in _PAYLOAD_IP_KEYS and isinstance(val, str):
                _add_ip(out, val, source="payload_field")
            elif kl == "connections" and isinstance(val, list):
                for item in val:
                    if isinstance(item, dict):
                        rip = item.get("ip") or item.get("peer_ip") or item.get("src_ip")
                        if isinstance(rip, str):
                            port = item.get("port")
                            _add_ip(
                                out,
                                rip,
                                source="agent_connections",
                                port=int(port) if isinstance(port, int) else None,
                                container=str(item["container"]) if item.get("container") else None,
                            )
            else:
                _walk_json(val, out, depth=depth + 1)
    elif isinstance(obj, list):
        for item in obj[:200]:
            _walk_json(item, out, depth=depth + 1)


def _parse_json_lines(text: str, out: dict[str, IpObservation]) -> None:
    for line in text.splitlines():
        line = line.strip()
        if not line or line[0] not in "{[":
            # docker log prefix: 2024-01-01T... stdout F {json}
            brace = line.find("{")
            if brace > 0:
                line = line[brace:]
        if not line.startswith("{"):
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            continue
        _walk_json(data, out)


def gather_ips_from_text(text: str | None, *, service: str | None = None) -> list[IpObservation]:
    if not text:
        return []
    out: dict[str, IpObservation] = {}

    _parse_json_lines(text, out)

    for name, pat in _PATTERNS:
        for m in pat.finditer(text):
            _add_ip(out, m.group(1), source=f"log_{name}", service=service)

    # Last resort: any public IPv4 in line (skip if already found via structured parse)
    if not out:
        for m in _IPV4_ANY.finditer(text):
            _add_ip(out, m.group(1), source="log_heuristic", service=service)

    return list(out.values())


def gather_ips_from_event(
    *,
    raw_log: str | None,
    payload: dict | None,
    service_name: str | None = None,
    event_type: str | None = None,
) -> list[IpObservation]:
    out: dict[str, IpObservation] = {}

    if event_type == "watchpot.agent.connections" and payload:
        for item in payload.get("connections") or []:
            if not isinstance(item, dict):
                continue
            rip = item.get("ip") or item.get("peer_ip") or item.get("src_ip")
            if isinstance(rip, str):
                port = item.get("port")
                _add_ip(
                    out,
                    rip,
                    source="agent_connections",
                    port=int(port) if isinstance(port, int) else None,
                    container=str(item["container"]) if item.get("container") else None,
                    service=service_name,
                )

    if payload:
        _walk_json(payload, out)
        for key in _PAYLOAD_IP_KEYS:
            val = payload.get(key)
            if isinstance(val, str):
                _add_ip(out, val, source="payload_field", service=service_name)

    for obs in gather_ips_from_text(raw_log, service=service_name):
        if obs.ip not in out:
            out[obs.ip] = obs

    return list(out.values())


def observation_ips(observations: list[IpObservation]) -> list[str]:
    return sorted({o.ip for o in observations})
