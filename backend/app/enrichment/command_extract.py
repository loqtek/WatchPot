"""Pull attacker inputs out of honeypot container logs.

Cowrie/Kippo shell lines, file downloads, login attempts, and HTTP requests
from web honeypots (including HellPot-style access lines) are kept so an
operator can read what was tried. Passwords are not stored.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, replace
from datetime import datetime

_DOCKER_TS = re.compile(
    r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))\s+(.*)$"
)
_CMD = re.compile(r"(?i)\bCMD:\s*(.+)$")
_COMMAND_FOUND = re.compile(r"(?i)\bCommand found:\s*(.+)$")
_HTTP = re.compile(r"^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH)\s+(\S+)")
_KV_HTTP = re.compile(
    r"(?i)\bmethod=(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH)\b.*?\b(?:path|uri|url)=(\S+)"
)
_HTTP_METHODS = {"GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS", "PATCH"}
_HELLPOT = re.compile(
    r"(?i)\b(?:request|hit|path|url)\b.*?((?:GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH)\s+/\S+)"
)
_IPV4 = re.compile(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b")
_COWRIE_PEER = re.compile(r"\[HoneyPotSSHTransport,[^\]]*?,\s*(\d+\.\d+\.\d+\.\d+)\]")
_PASSWORD_FIELD = re.compile(r'(?i)("(?:password|passwd|pwd)"\s*:\s*")[^"]*(")')
_PASSWORD_ASSIGN = re.compile(r"(?i)\b(password|passwd|pwd|pass|secret|token)(\s*[:=]\s*)(\S+)")

# Long enough for a full shell one-liner. Agent log events are already capped.
_MAX_COMMAND = 16000
_EXCERPT_RADIUS = 8
_EXCERPT_MAX = 16000

# Control-plane containers. Their access logs are not honeypot activity.
_CONTROL_PLANE = {"api", "web", "proxy", "postgres", "agent", "grafana", "setup-wizard"}

# HTTP paths that are platform traffic or telemetry, not an attack.
_NOISE_HTTP_EXACT = {"/bot/statistic"}
_NOISE_HTTP_PREFIXES = ("/api/agent",)


@dataclass(frozen=True)
class ExtractedCommand:
    kind: str
    command: str
    src_ip: str | None
    session_id: str | None
    username: str | None
    observed_at: datetime | None
    fingerprint: str
    excerpt: str = ""


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    text = value.strip().replace("Z", "+00:00")
    if "." in text:
        head, rest = text.split(".", 1)
        frac = rest
        tz = ""
        for mark in ("+", "-"):
            if mark in rest[1:]:
                idx = rest.find(mark, 1)
                frac, tz = rest[:idx], rest[idx:]
                break
        text = f"{head}.{frac[:6]}{tz}"
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _redact(text: str) -> str:
    cleaned = _PASSWORD_FIELD.sub(r"\1***\2", text)
    return _PASSWORD_ASSIGN.sub(r"\1\2***", cleaned)


def _clip(text: str) -> str:
    cleaned = _redact(" ".join(text.split()))
    if len(cleaned) > _MAX_COMMAND:
        return cleaned[:_MAX_COMMAND]
    return cleaned


def is_control_plane_container(name: str | None) -> bool:
    """True for watchPot's own api, web, proxy, database, and agent containers."""
    if not name:
        return False
    base = name.strip().lstrip("/").lower()
    base = re.sub(r"[-_]?\d+$", "", base)
    if base.startswith("watchpot-"):
        base = base[len("watchpot-") :]
        base = re.sub(r"[-_]?\d+$", "", base)
    return base in _CONTROL_PLANE


def _request_path(command: str) -> str | None:
    parts = command.split(None, 1)
    if len(parts) != 2 or parts[0] not in _HTTP_METHODS:
        return None
    path = parts[1].split("?", 1)[0]
    if not path.startswith("/"):
        return None
    if len(path) > 1:
        path = path.rstrip("/")
    return path.lower()


def is_noise_http(command: str) -> bool:
    """Platform ingest and telemetry requests are not attacker commands."""
    path = _request_path(command)
    if path is None:
        return False
    if path in _NOISE_HTTP_EXACT:
        return True
    return any(path == prefix or path.startswith(prefix + "/") for prefix in _NOISE_HTTP_PREFIXES)


def surrounding_lines(lines: list[str], index: int, radius: int = _EXCERPT_RADIUS) -> str:
    start = max(0, index - radius)
    end = min(len(lines), index + radius + 1)
    body = "\n".join(_redact(lines[i].rstrip()) for i in range(start, end))
    if len(body) > _EXCERPT_MAX:
        return body[:_EXCERPT_MAX]
    return body


def excerpt_around(raw_log: str, command: str, radius: int = _EXCERPT_RADIUS) -> str | None:
    """Find the stored command in a log blob and return the lines around it."""
    needle = " ".join(command.split())[:180]
    if not needle:
        return None
    lines = raw_log.splitlines()
    for index, line in enumerate(lines):
        if needle in " ".join(line.split()):
            return surrounding_lines(lines, index, radius)
    return None


def normalize_command(kind: str, command: str) -> str:
    """One spelling for the same command, so repeats group together."""
    text = " ".join(command.split()).strip()
    if kind != "http":
        return text
    parts = text.split(None, 1)
    if len(parts) != 2 or parts[0].upper() not in _HTTP_METHODS:
        return text
    path, _, query = parts[1].partition("?")
    if len(path) > 1:
        path = path.rstrip("/")
    suffix = f"?{query}" if query else ""
    return f"{parts[0].upper()} {path}{suffix}"


def command_identity(kind: str, command: str, src_ip: str | None) -> tuple[str, str, str]:
    """Identity ignores time and session. The same command from the same IP is one row."""
    return (kind, normalize_command(kind, command), (src_ip or "").strip())


def duplicate_group_indexes(rows: list[dict]) -> list[list[int]]:
    """Group row indexes that are the same command. A 1024-character prefix joins the full text."""
    exact: dict[tuple, list[int]] = {}
    for index, row in enumerate(rows):
        kind = str(row.get("kind") or "")
        command = normalize_command(kind, str(row.get("command") or ""))
        key = (
            str(row.get("pot_id") or ""),
            str(row.get("container") or "").strip(),
            kind,
            command,
            str(row.get("src_ip") or "").strip(),
        )
        exact.setdefault(key, []).append(index)

    scopes: dict[tuple, list[tuple[str, tuple]]] = {}
    for key in exact:
        scope = (key[0], key[1], key[2], key[4])
        scopes.setdefault(scope, []).append((key[3], key))

    redirect: dict[tuple, tuple] = {}
    for items in scopes.values():
        items.sort(key=lambda item: len(item[0]), reverse=True)
        longer: list[tuple[str, tuple]] = []
        for command, key in items:
            target = key
            if len(command) == 1024:
                for full, full_key in longer:
                    if full.startswith(command):
                        target = full_key
                        break
            else:
                longer.append((command, key))
            redirect[key] = target

    merged: dict[tuple, list[int]] = {}
    for key, indexes in exact.items():
        merged.setdefault(redirect.get(key, key), []).extend(indexes)
    return list(merged.values())


def _fingerprint(*parts: str) -> str:
    raw = "\n".join(parts)
    return hashlib.sha256(raw.encode("utf-8", errors="replace")).hexdigest()


def _public_ip(value: str | None) -> str | None:
    if not value:
        return None
    ip = value.strip()
    if ip.startswith("127.") or ip.startswith("0.") or ip in {"255.255.255.255"}:
        return None
    octets = ip.split(".")
    if len(octets) != 4:
        return ip if ":" in ip else None
    try:
        nums = [int(part) for part in octets]
    except ValueError:
        return None
    if any(n < 0 or n > 255 for n in nums):
        return None
    if nums[0] in {10, 127} or (nums[0] == 192 and nums[1] == 168) or (nums[0] == 172 and 16 <= nums[1] <= 31):
        return None
    return ip


def _line_ip(line: str, explicit: str | None = None) -> str | None:
    found = _public_ip(explicit)
    if found:
        return found
    peer = _COWRIE_PEER.search(line)
    if peer:
        return _public_ip(peer.group(1))
    match = _IPV4.search(line)
    return _public_ip(match.group(1) if match else None)


def _from_json(payload: dict, *, observed_at: datetime | None, line: str) -> ExtractedCommand | None:
    event = str(payload.get("eventid") or "")
    src = _line_ip(
        line,
        str(payload.get("src_ip") or payload.get("peer_ip") or payload.get("ip") or payload.get("remote") or "")
        or None,
    )
    session = str(payload.get("session") or "") or None
    username = str(payload.get("username") or "") or None
    stamp = _parse_time(str(payload.get("timestamp") or "")) or observed_at
    stamp_key = stamp.isoformat() if stamp else ""

    if event == "cowrie.command.input":
        command = _clip(str(payload.get("input") or ""))
        if not command:
            return None
        return ExtractedCommand(
            kind="shell",
            command=command,
            src_ip=src,
            session_id=session,
            username=username,
            observed_at=stamp,
            fingerprint=_fingerprint("shell", command, src or "", session or "", stamp_key),
        )

    if event == "cowrie.session.file_download":
        url = _clip(str(payload.get("url") or payload.get("outfile") or "download"))
        return ExtractedCommand(
            kind="download",
            command=url,
            src_ip=src,
            session_id=session,
            username=username,
            observed_at=stamp,
            fingerprint=_fingerprint("download", url, src or "", session or "", stamp_key),
        )

    if event in {"cowrie.login.success", "cowrie.login.failed"}:
        outcome = "succeeded" if event.endswith("success") else "failed"
        user = username or "unknown"
        command = f"login {outcome} as {user}"
        return ExtractedCommand(
            kind="login",
            command=command,
            src_ip=src,
            session_id=session,
            username=username,
            observed_at=stamp,
            fingerprint=_fingerprint("login", command, src or "", session or "", stamp_key),
        )

    method = str(payload.get("method") or payload.get("http_method") or "").upper()
    path = str(payload.get("path") or payload.get("uri") or payload.get("url") or "")
    if method in _HTTP_METHODS and path.startswith("/"):
        command = normalize_command("http", _clip(f"{method} {path}"))
        return ExtractedCommand(
            kind="http",
            command=command,
            src_ip=src,
            session_id=session,
            username=username,
            observed_at=stamp,
            fingerprint=_fingerprint("http", command, src or "", stamp_key),
        )
    return None


def _from_text(message: str, *, observed_at: datetime | None) -> ExtractedCommand | None:
    stamp_key = observed_at.isoformat() if observed_at else message
    src = _line_ip(message)

    cmd = _CMD.search(message) or _COMMAND_FOUND.search(message)
    if cmd:
        command = _clip(cmd.group(1))
        if command:
            return ExtractedCommand(
                kind="shell",
                command=command,
                src_ip=src,
                session_id=None,
                username=None,
                observed_at=observed_at,
                fingerprint=_fingerprint("shell", command, src or "", stamp_key),
            )

    http = _HTTP.match(message.strip())
    if not http:
        kv = _KV_HTTP.search(message)
        if kv:
            command = normalize_command("http", _clip(f"{kv.group(1).upper()} {kv.group(2)}"))
            return ExtractedCommand(
                kind="http",
                command=command,
                src_ip=src,
                session_id=None,
                username=None,
                observed_at=observed_at,
                fingerprint=_fingerprint("http", command, src or "", stamp_key),
            )
    if not http:
        loose = _HELLPOT.search(message)
        if loose:
            http = _HTTP.match(loose.group(1).strip())
    if http:
        command = normalize_command("http", _clip(f"{http.group(1).upper()} {http.group(2)}"))
        return ExtractedCommand(
            kind="http",
            command=command,
            src_ip=src,
            session_id=None,
            username=None,
            observed_at=observed_at,
            fingerprint=_fingerprint("http", command, src or "", stamp_key),
        )
    return None


def extract_commands(raw_log: str | None) -> list[ExtractedCommand]:
    if not raw_log:
        return []
    found: list[ExtractedCommand] = []
    seen: set[str] = set()
    raw_lines = raw_log.splitlines()
    for index, raw_line in enumerate(raw_lines):
        line = raw_line.strip()
        if not line:
            continue
        observed_at = None
        message = line
        stamped = _DOCKER_TS.match(line)
        if stamped:
            observed_at = _parse_time(stamped.group(1))
            message = stamped.group(2).strip()
        brace = message.find("{")
        parsed = None
        if brace >= 0 and message.rstrip().endswith("}"):
            try:
                payload = json.loads(message[brace:])
            except json.JSONDecodeError:
                payload = None
            if isinstance(payload, dict):
                parsed = _from_json(payload, observed_at=observed_at, line=message)
        if parsed is None:
            parsed = _from_text(message, observed_at=observed_at)
        if parsed is None or parsed.fingerprint in seen:
            continue
        if parsed.kind == "http" and is_noise_http(parsed.command):
            continue
        parsed = replace(parsed, excerpt=surrounding_lines(raw_lines, index))
        seen.add(parsed.fingerprint)
        found.append(parsed)
        if len(found) >= 80:
            break
    return found
