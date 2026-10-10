"""Pull attacker inputs out of honeypot container logs.

Cowrie/Kippo shell lines, file downloads, login attempts, and HTTP requests
from web honeypots (including HellPot-style access lines) are kept so an
operator can read what was tried. Passwords are not stored.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
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

_MAX_COMMAND = 1024


@dataclass(frozen=True)
class ExtractedCommand:
    kind: str
    command: str
    src_ip: str | None
    session_id: str | None
    username: str | None
    observed_at: datetime | None
    fingerprint: str


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
        command = _clip(f"{method} {path}")
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
            command = _clip(f"{kv.group(1).upper()} {kv.group(2)}")
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
        command = _clip(f"{http.group(1).upper()} {http.group(2)}")
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
    for raw_line in raw_log.splitlines():
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
        seen.add(parsed.fingerprint)
        found.append(parsed)
        if len(found) >= 80:
            break
    return found
