"""Shared wording for incident reports."""

from __future__ import annotations

import re
from datetime import datetime

from app.time_utils import ensure_utc

ATTACK_TYPE_LABELS: dict[str, str] = {
    "brute_force": "Brute force",
    "injection": "Injection",
    "path_traversal": "Path traversal",
    "rce_probe": "RCE probe",
    "webshell": "Web shell",
    "reconnaissance": "Reconnaissance",
    "botnet": "Botnet / IoT",
    "reverse_shell": "Reverse shell",
    "auth_bypass": "Auth bypass",
    "network_exploit": "Network exploit",
    "deserialization": "Deserialization",
}

FOCUS_LABELS: dict[str, str] = {
    "activity": "Incident writeup",
    "threats": "Threat matches",
    "commands": "Commands and requests",
    "stream": "Full sensor stream",
}

KIND_LABELS: dict[str, str] = {
    "shell": "Shell commands",
    "http": "HTTP requests",
    "login": "Login attempts",
    "download": "Downloads",
}

KIND_ORDER = ("shell", "http", "login", "download")

EVENT_TITLES: dict[str, str] = {
    "watchpot.agent.container_logs": "Container logs",
    "watchpot.agent.infra_snapshot": "Infra snapshot",
    "watchpot.agent.connections": "Connection snapshot",
    "watchpot.pot.created": "Pot created",
    "watchpot.pot.updated": "Pot updated",
    "watchpot.pot.agent_key_rotated": "Agent key rotated",
    "watchpot.stack.created": "Stack created",
    "watchpot.stack.updated": "Stack updated",
    "watchpot.stack.deleted": "Stack deleted",
    "watchpot.stack.revision_pushed": "Stack revision pushed",
    "watchpot.stack.restart_requested": "Stack restart requested",
}

_SEVERITY_RANK = {
    "critical": 0,
    "high": 1,
    "error": 1,
    "medium": 2,
    "warning": 2,
    "low": 3,
    "info": 4,
    "unknown": 5,
}


def label_attack(key: str) -> str:
    if key in ATTACK_TYPE_LABELS:
        return ATTACK_TYPE_LABELS[key]
    return key.replace("_", " ").strip().capitalize() or key


def label_kind(kind: str) -> str:
    return KIND_LABELS.get(kind, kind.replace("_", " ").strip().capitalize() or kind)


def event_title(event_type: str) -> str:
    known = EVENT_TITLES.get(event_type)
    if known:
        return known
    stripped = re.sub(r"^watchpot\.(agent|pot|stack|control)\.", "", event_type)
    parts = [part for part in re.split(r"[._]", stripped) if part]
    if not parts:
        return event_type
    return " ".join(part[:1].upper() + part[1:] for part in parts)


def format_ts(value: datetime | None) -> str:
    if value is None:
        return "—"
    aware = ensure_utc(value)
    if aware is None:
        return "—"
    return aware.strftime("%Y-%m-%d %H:%M:%S UTC")


def severity_rank(value: str | None) -> int:
    if not value:
        return 9
    return _SEVERITY_RANK.get(value.strip().lower(), 8)


def n_things(count: int, singular: str, plural: str | None = None) -> str:
    word = singular if count == 1 else (plural or f"{singular}s")
    return f"{count} {word}"


def report_filename(title: str, generated_at: datetime, ext: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    slug = slug[:40] or "incident-report"
    stamp = format_ts(generated_at)
    # format_ts returns "YYYY-MM-DD HH:MM:SS UTC"
    compact = stamp[:16].replace("-", "").replace(":", "").replace(" ", "-")
    safe_ext = re.sub(r"[^a-z0-9]", "", ext.lower()) or "txt"
    return f"watchpot-{slug}-{compact}.{safe_ext}"


def md_cell(value: str | None) -> str:
    text = (value or "").replace("\r\n", "\n").replace("\n", " ").replace("|", "\\|").strip()
    return text or "—"


def md_fence(text: str, lang: str = "") -> str:
    body = text.replace("\r\n", "\n").strip("\n")
    if not body:
        body = ""
    ticks = "```"
    while ticks in body:
        ticks += "`"
    language = lang if ticks == "```" else ""
    return f"{ticks}{language}\n{body}\n{ticks}"


def md_quote(text: str) -> str:
    lines = text.replace("\r\n", "\n").split("\n")
    return "\n".join(f"> {line}" if line else ">" for line in lines)


def describe_place(city: str | None, region: str | None, country: str | None) -> str | None:
    parts = [part for part in (city, region, country) if part]
    if not parts:
        return None
    return ", ".join(parts)


def yes_no(value: bool | None) -> str:
    if value is None:
        return "—"
    return "Yes" if value else "No"


def md_table(headers: list[str], rows: list[list[str]]) -> str:
    head = "| " + " | ".join(md_cell(header) for header in headers) + " |"
    rule = "| " + " | ".join("---" for _ in headers) + " |"
    body = ["| " + " | ".join(md_cell(cell) for cell in row) + " |" for row in rows]
    return "\n".join([head, rule, *body])
