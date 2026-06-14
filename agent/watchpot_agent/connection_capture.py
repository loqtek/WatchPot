"""Capture live TCP connections to published honeypot ports on the pot host."""

from __future__ import annotations

import re
import subprocess
from typing import Any

_PORT_MAP_RE = re.compile(r":(\d+)->\d+/(?:tcp|udp)")


def _parse_published_ports(ports_field: str) -> set[int]:
    if not ports_field or ports_field in ("", "—"):
        return set()
    found: set[int] = set()
    for m in _PORT_MAP_RE.finditer(str(ports_field)):
        try:
            found.add(int(m.group(1)))
        except ValueError:
            continue
    return found


def _is_public_ipv4(ip: str) -> bool:
    parts = ip.split(".")
    if len(parts) != 4:
        return False
    try:
        octets = [int(p) for p in parts]
    except ValueError:
        return False
    if any(o < 0 or o > 255 for o in octets):
        return False
    if octets[0] == 10:
        return False
    if octets[0] == 127:
        return False
    if octets[0] == 192 and octets[1] == 168:
        return False
    if octets[0] == 172 and 16 <= octets[1] <= 31:
        return False
    if octets[0] >= 224:
        return False
    return True


def _ss_connections() -> list[tuple[str, int, str, int]]:
    """Return list of (local_ip, local_port, peer_ip, peer_port) for established TCP."""
    try:
        proc = subprocess.run(
            ["ss", "-H", "-tn", "state", "established", "state", "syn-recv", "state", "time-wait"],
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    if proc.returncode != 0:
        return []
    rows: list[tuple[str, int, str, int]] = []
    for line in (proc.stdout or "").splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        local = parts[2]
        peer = parts[3]
        try:
            _, lport = local.rsplit(":", 1)
            peer_host, pport = peer.rsplit(":", 1)
            peer_host = peer_host.strip("[]")
            rows.append(("0.0.0.0", int(lport), peer_host, int(pport)))
        except (ValueError, IndexError):
            continue
    return rows


def _netstat_fallback() -> list[tuple[str, int, str, int]]:
    try:
        proc = subprocess.run(
            ["netstat", "-tn"],
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    if proc.returncode != 0:
        return []
    rows: list[tuple[str, int, str, int]] = []
    for line in (proc.stdout or "").splitlines():
        if "ESTABLISHED" not in line:
            continue
        parts = line.split()
        if len(parts) < 5:
            continue
        local, peer = parts[3], parts[4]
        try:
            _, lport = local.rsplit(":", 1)
            peer_host, pport = peer.rsplit(":", 1)
            rows.append(("0.0.0.0", int(lport), peer_host, int(pport)))
        except (ValueError, IndexError):
            continue
    return rows


def snapshot_honeypot_connections(containers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Map established connections on published ports → container + peer IP."""
    port_to_container: dict[int, str] = {}
    for row in containers:
        state = str(row.get("State") or "").lower()
        status = str(row.get("Status") or "").lower()
        if "running" not in state and not status.startswith("up "):
            continue
        name = str(row.get("Names") or row.get("Name") or "").strip().lstrip("/")
        if not name:
            continue
        for port in _parse_published_ports(str(row.get("Ports") or "")):
            port_to_container.setdefault(port, name)

    if not port_to_container:
        return []

    conns = _ss_connections() or _netstat_fallback()
    seen: set[tuple[str, int, str]] = set()
    out: list[dict[str, Any]] = []

    for _local_ip, lport, peer_ip, _pport in conns:
        container = port_to_container.get(lport)
        if not container:
            continue
        if not _is_public_ipv4(peer_ip):
            continue
        key = (peer_ip, lport, container)
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "ip": peer_ip,
                "port": lport,
                "container": container,
                "proto": "tcp",
            }
        )
    return out
