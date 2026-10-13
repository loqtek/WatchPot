"""Assemble a writeup-ready report from retained honeypot activity."""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.enrichment.command_extract import excerpt_around
from app.enrichment.ip_gather import gather_ips_from_event
from app.models.cve_entry import CveEntry
from app.models.event import Event
from app.models.pot import Pot
from app.models.stack import Stack
from app.models.threat_command import ThreatCommand
from app.models.threat_ip import ThreatIp
from app.schemas.incident_report import (
    CountItem,
    IncidentReport,
    IncidentReportRequest,
    ReportAttacker,
    ReportCommand,
    ReportCounts,
    ReportCve,
    ReportCveDetail,
    ReportEvent,
    ReportGeo,
    ReportPot,
    ReportScope,
)
from app.services.analytics_events import parse_range
from app.services.incident_report_format import (
    FOCUS_LABELS,
    event_title,
    format_ts,
    label_attack,
    n_things,
    severity_rank,
)
from app.time_utils import ensure_utc

EVENT_SCAN = 1500
RAW_LOG_CAP = 12000
CONTEXT_CAP = 12000
PAYLOAD_JSON_CAP = 12000
STRING_CAP = 2000

_INFRA_SNAPSHOT = "watchpot.agent.infra_snapshot"
_NOISE_IPS = frozenset({"0.0.0.0", "127.0.0.1", "255.255.255.255"})
_SECRET_KEY = re.compile(
    r"(password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie|session)",
    re.IGNORECASE,
)
_PASSWORD_FIELD = re.compile(r'(?i)("(?:password|passwd|pwd)"\s*:\s*")[^"]*(")')
_PASSWORD_ASSIGN = re.compile(r"(?i)\b(password|passwd|pwd|pass|secret|token)(\s*[:=]\s*)(\S+)")


def redact_text(text: str) -> str:
    """Hide credential-shaped values before they are copied into a writeup."""
    cleaned = _PASSWORD_FIELD.sub(r"\1***\2", text)
    return _PASSWORD_ASSIGN.sub(r"\1\2***", cleaned)


class ReportError(Exception):
    def __init__(self, detail: str, status_code: int = 400) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


def resolve_window(
    range_key: str | None,
    since: datetime | None,
    until: datetime | None,
) -> tuple[datetime, datetime, str]:
    now = datetime.now(UTC)
    if since is not None or until is not None:
        if since is None or until is None:
            raise ReportError("Provide both a start and an end, or choose a preset window.")
        start = ensure_utc(since)
        end = ensure_utc(until)
        if start is None or end is None or start >= end:
            raise ReportError("The report window must start before it ends.")
        if end - start > timedelta(days=366):
            raise ReportError("The report window cannot be longer than 366 days.")
        return start, end, "custom"
    key = (range_key or "7d").strip().lower()
    if key == "90d":
        return now - timedelta(days=90), now, key
    if key == "all":
        return now - timedelta(days=3650), now, key
    if key not in {"1h", "1d", "7d", "14d", "30d"}:
        raise ReportError("Unknown time window.")
    start, end = parse_range(key)
    return start, end, key


def _str_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, str):
            continue
        text = item.strip()
        if not text or text in seen:
            continue
        seen.add(text)
        out.append(text)
    return out


def _as_float(value: object) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _plain(value: object) -> str | None:
    if isinstance(value, str):
        text = value.strip()
        return text or None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    return None


def enrichment_of(payload: dict | None) -> dict[str, Any] | None:
    if not payload:
        return None
    raw = payload.get("enrichment")
    if isinstance(raw, dict):
        return raw
    return None


def event_source_ips(
    *,
    payload: dict | None,
    raw_log: str | None,
    service_name: str | None,
    event_type: str | None,
) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()

    def add(value: object) -> None:
        if not isinstance(value, str):
            return
        text = value.strip()
        if not text or text in seen or text in _NOISE_IPS:
            return
        seen.add(text)
        found.append(text)

    enr = enrichment_of(payload)
    if enr:
        for ip in _str_list(enr.get("source_ips")):
            add(ip)
    for obs in gather_ips_from_event(
        raw_log=raw_log,
        payload=payload,
        service_name=service_name,
        event_type=event_type,
    ):
        add(obs.ip)
    return found


def is_matched(payload: dict | None) -> bool:
    enr = enrichment_of(payload)
    if not enr:
        return False
    return str(enr.get("status") or "") in {"matched", "low_confidence"}


def include_event(
    *,
    focus: str,
    channel: str,
    event_type: str,
    event_id: str,
    matched: bool,
    source_ips: set[str],
    command_event_ids: set[str],
    src_ip: str | None,
) -> bool:
    """Decide whether an event belongs in the report body.

    Activity reports keep threat matches and the events behind captured commands.
    Threat reports keep fingerprint matches. Command reports keep only the events
    those commands came from. The sensor stream keeps runtime and infra events.
    """
    if channel == "control":
        return False
    linked = event_id in command_event_ids
    ip_hit = bool(src_ip) and src_ip in source_ips
    if src_ip and not (ip_hit or linked):
        return False
    if focus == "stream":
        return channel in {"runtime", "infra"}
    if focus == "commands":
        return linked
    if focus == "threats":
        return channel == "runtime" and (matched or linked)
    if channel != "runtime" or event_type == _INFRA_SNAPSHOT:
        return False
    return matched or linked or ip_hit


def _clip(text: str | None, cap: int) -> tuple[str | None, bool]:
    if text is None:
        return None, False
    cleaned = redact_text(text)
    if len(cleaned) <= cap:
        return cleaned, False
    return cleaned[:cap] + "\n… [truncated]", True


def _redact_value(key: str, value: Any, depth: int) -> Any:
    if _SECRET_KEY.search(key):
        return "***"
    if isinstance(value, dict):
        if depth >= 5:
            return {"_omitted": "nested object"}
        items = list(value.items())
        omitted = len(items) > 80
        slim = {str(k): _redact_value(str(k), v, depth + 1) for k, v in items[:80]}
        if omitted:
            slim["_omitted_keys"] = len(items) - 80
        return slim
    if isinstance(value, list):
        if len(value) > 40:
            return {"_omitted": f"list of {len(value)} items"}
        return [_redact_value(key, item, depth + 1) for item in value]
    if isinstance(value, str):
        cleaned = redact_text(value)
        if len(cleaned) > STRING_CAP:
            return cleaned[:STRING_CAP] + "… [truncated]"
        return cleaned
    return value


def prepare_payload(payload: dict | None) -> tuple[dict | None, bool]:
    if not payload:
        return None, False
    slim = _redact_value("payload", payload, 0)
    if not isinstance(slim, dict):
        return None, False
    encoded = json.dumps(slim, default=str, ensure_ascii=False)
    if len(encoded) <= PAYLOAD_JSON_CAP:
        return slim, False
    return {"_truncated": True, "preview": encoded[:PAYLOAD_JSON_CAP] + "…"}, True


def event_summary(event_type: str, service_name: str | None, payload: dict | None) -> str | None:
    body = payload or {}
    if event_type == "watchpot.agent.container_logs":
        parts = [
            service_name or _plain(body.get("container")),
            _plain(body.get("image")),
            _plain(body.get("compose_project")),
        ]
        text = " · ".join(part for part in parts if part)
        return text or None
    if event_type == _INFRA_SNAPSHOT:
        host = _plain(body.get("hostname"))
        containers = body.get("containers")
        count = f"{len(containers)} containers" if isinstance(containers, list) else None
        text = " · ".join(part for part in (host, count) if part)
        return text or None
    enr = enrichment_of(body)
    if enr and str(enr.get("status") or "") in {"matched", "low_confidence"}:
        bits = [label_attack(item) for item in _str_list(enr.get("attack_types"))]
        bits.extend(_str_list(enr.get("tools")))
        bits.extend(_str_list(enr.get("cve_ids")))
        if bits:
            return " · ".join(bits)
    for key in ("message", "action", "name", "status", "error", "reason", "container"):
        text = _plain(body.get(key))
        if text:
            return text[:300]
    return service_name


def _cve_details(enr: dict[str, Any] | None) -> list[ReportCveDetail]:
    if not enr or not isinstance(enr.get("cve_details"), list):
        return []
    details: list[ReportCveDetail] = []
    for item in enr["cve_details"]:
        if not isinstance(item, dict):
            continue
        cve_id = _plain(item.get("cve_id"))
        if not cve_id:
            continue
        details.append(
            ReportCveDetail(
                cve_id=cve_id.upper(),
                summary=_plain(item.get("summary")),
                severity=_plain(item.get("severity")),
                cvss_score=_as_float(item.get("cvss_score")),
            )
        )
    return details


def _join_phrases(parts: list[str]) -> str:
    cleaned = [part for part in parts if part]
    if not cleaned:
        return ""
    if len(cleaned) == 1:
        return cleaned[0]
    if len(cleaned) == 2:
        return f"{cleaned[0]} and {cleaned[1]}"
    return ", ".join(cleaned[:-1]) + f", and {cleaned[-1]}"


def write_paragraphs(
    scope: ReportScope,
    counts: ReportCounts,
    attackers: list[ReportAttacker],
    by_attack_type: list[CountItem],
    by_tool: list[CountItem],
    cves: list[ReportCve],
) -> list[str]:
    window = f"{format_ts(scope.since)} and {format_ts(scope.until)}"
    if scope.range_key == "all":
        window_lead = (
            f"This report documents honeypot activity retained by watchPot, "
            f"covering {window}."
        )
    else:
        window_lead = f"This report documents honeypot activity observed by watchPot between {window}."

    where: list[str] = []
    if scope.pot_name:
        where.append(f"pot {scope.pot_name}")
    elif scope.pot_id:
        where.append(f"pot {scope.pot_id}")
    else:
        where.append("every pot")
    if scope.src_ip:
        where.append(f"source {scope.src_ip}")
    scope_sentence = f"The scope is {scope.focus_label.lower()} across {_join_phrases(where)}."
    credit = (
        f"It was exported by {scope.generated_by} on {format_ts(scope.generated_at)} "
        "so the record can be turned into an incident writeup. All timestamps in the file are UTC."
    )
    paragraphs = [" ".join(part for part in (window_lead, scope_sentence, credit) if part)]

    if counts.events == 0 and counts.commands == 0:
        paragraphs.append(
            "Nothing in the retained data matched this scope. Widen the time window, "
            "clear the source filter, or switch the focus to the full sensor stream."
        )
        return paragraphs

    inventory: list[str] = []
    if counts.events:
        inventory.append(n_things(counts.events, "event"))
    if counts.matched_events:
        inventory.append(f"{counts.matched_events} matched a threat fingerprint")
    if counts.commands:
        kinds: list[str] = []
        if counts.shell:
            kinds.append(n_things(counts.shell, "shell command"))
        if counts.http:
            kinds.append(n_things(counts.http, "HTTP request"))
        if counts.login:
            kinds.append(n_things(counts.login, "login attempt"))
        if counts.download:
            kinds.append(n_things(counts.download, "download"))
        if counts.other_commands:
            kinds.append(n_things(counts.other_commands, "other captured action"))
        command_bit = n_things(counts.commands, "captured command or request")
        if kinds:
            command_bit += f" ({_join_phrases(kinds)})"
        inventory.append(command_bit)
    if counts.source_ips:
        inventory.append(n_things(counts.source_ips, "source address", "source addresses"))
    if counts.sessions:
        inventory.append(n_things(counts.sessions, "session id"))
    lead = "This export includes " + _join_phrases(inventory) + "."
    paragraphs.append(lead)

    attribution: list[str] = []
    if by_attack_type:
        top = ", ".join(f"{item.label.lower()} ({item.count})" for item in by_attack_type[:4])
        attribution.append(f"The attributed activity was mainly {top}.")
    if by_tool:
        tools = ", ".join(item.label for item in by_tool[:6])
        attribution.append(f"Tools recorded with that activity: {tools}.")
    if cves:
        names = ", ".join(item.cve_id for item in cves[:8])
        extra = f" and {len(cves) - 8} more" if len(cves) > 8 else ""
        attribution.append(f"Correlated vulnerabilities: {names}{extra}.")
    if attribution:
        paragraphs.append(" ".join(attribution))

    if attackers:
        top = attackers[0]
        place = []
        if top.geo:
            bits = [part for part in (top.geo.city, top.geo.region, top.geo.country) if part]
            if bits:
                place.append(", ".join(bits))
            if top.geo.asn_label:
                place.append(top.geo.asn_label)
            elif top.geo.org or top.geo.isp:
                place.append(top.geo.org or top.geo.isp or "")
        located = f" ({'; '.join(part for part in place if part)})" if any(place) else ""
        abuse = f" AbuseIPDB score {top.abuse_score}." if top.abuse_score is not None else ""
        span = ""
        if top.first_seen_at or top.last_seen_at:
            span = f" Seen from {format_ts(top.first_seen_at)} to {format_ts(top.last_seen_at)}."
        paragraphs.append(
            f"The busiest source in this export is {top.ip_address}{located}, "
            f"marked {top.status}, with {n_things(top.command_count, 'captured command')} "
            f"and {n_things(top.event_count, 'related event')}.{abuse}{span}"
        )

    if scope.truncation_notes:
        paragraphs.append(" ".join(scope.truncation_notes))

    paragraphs.append(
        "The sections that follow are ordered for a writeup: scope, indicators, attacker profiles, "
        "a chronological timeline, the commands and requests that were captured, vulnerability notes, "
        "and the evidence behind each included event."
    )
    return paragraphs


def _geo(value: object) -> ReportGeo | None:
    if not isinstance(value, dict) or not value:
        return None
    geo = ReportGeo.model_validate(value)
    if not any(
        (
            geo.country,
            geo.country_code,
            geo.region,
            geo.city,
            geo.isp,
            geo.org,
            geo.asn,
            geo.asn_label,
            geo.is_hosting,
            geo.is_proxy,
        )
    ):
        return None
    return geo


async def build_incident_report(
    session: AsyncSession,
    request: IncidentReportRequest,
    *,
    exported_by: str,
) -> IncidentReport:
    since, until, range_key = resolve_window(request.range, request.since, request.until)
    title = " ".join(request.title.split()) or "Honeypot activity report"
    src_ip = (request.src_ip or "").strip() or None
    if src_ip and any(char.isspace() for char in src_ip):
        raise ReportError("Source address must be a single IP, without spaces.")
    notes = request.analyst_notes.strip()
    focus = request.focus
    limit = request.limit

    pot_name: str | None = None
    if request.pot_id is not None:
        pot = await session.get(Pot, request.pot_id)
        if pot is None:
            raise ReportError("No pot exists with that id.", status_code=404)
        pot_name = pot.name

    event_filters = [Event.received_at >= since, Event.received_at <= until]
    if focus == "stream":
        event_filters.append(Event.channel.in_(("runtime", "infra")))
    else:
        event_filters.append(Event.channel == "runtime")
    if request.pot_id is not None:
        event_filters.append(Event.pot_id == request.pot_id)

    event_total = int(
        (await session.execute(select(func.count()).select_from(Event).where(*event_filters))).scalar_one()
    )
    fetched_events = list(
        (
            await session.execute(
                select(Event).where(*event_filters).order_by(Event.received_at.desc()).limit(EVENT_SCAN)
            )
        ).scalars().all()
    )
    scan_capped = event_total > len(fetched_events)

    def _prepare(ev: Event) -> tuple[Event, list[str], bool]:
        payload = ev.payload if isinstance(ev.payload, dict) else None
        ips = event_source_ips(
            payload=payload,
            raw_log=ev.raw_log,
            service_name=ev.service_name,
            event_type=ev.event_type,
        )
        return ev, ips, is_matched(payload)

    prepared: list[tuple[Event, list[str], bool]] = [_prepare(ev) for ev in fetched_events]
    matched_ids = {str(ev.id) for ev, _, matched in prepared if matched}
    matched_ips = {ip for _, ips, matched in prepared if matched for ip in ips}

    command_filters = [
        ThreatCommand.last_seen_at >= since,
        ThreatCommand.first_seen_at <= until,
    ]
    if request.pot_id is not None:
        command_filters.append(ThreatCommand.pot_id == request.pot_id)
    if src_ip:
        command_filters.append(ThreatCommand.src_ip == src_ip)
    if focus == "threats":
        threat_clauses = []
        if matched_ids:
            threat_clauses.append(ThreatCommand.event_id.in_([UUID(item) for item in matched_ids]))
        if matched_ips:
            threat_clauses.append(ThreatCommand.src_ip.in_(sorted(matched_ips)))
        if threat_clauses:
            command_filters.append(or_(*threat_clauses))
        else:
            command_filters.append(ThreatCommand.id.is_(None))

    command_total = int(
        (await session.execute(select(func.count()).select_from(ThreatCommand).where(*command_filters))).scalar_one()
    )
    kept_commands = list(
        (
            await session.execute(
                select(ThreatCommand)
                .where(*command_filters)
                .order_by(ThreatCommand.observed_at.desc())
                .limit(limit)
            )
        ).scalars().all()
    )
    commands_truncated = command_total > len(kept_commands)

    known_event_ids = {str(ev.id) for ev, _, _ in prepared}
    missing_ids = [row.event_id for row in kept_commands if row.event_id and str(row.event_id) not in known_event_ids]
    if missing_ids:
        extra = list((await session.execute(select(Event).where(Event.id.in_(missing_ids)))).scalars().all())
        prepared.extend(_prepare(ev) for ev in extra)

    command_event_ids = {str(row.event_id) for row in kept_commands if row.event_id}

    selected: list[tuple[Event, list[str], bool]] = []
    for ev, ips, matched in prepared:
        if include_event(
            focus=focus,
            channel=ev.channel,
            event_type=ev.event_type,
            event_id=str(ev.id),
            matched=matched,
            source_ips=set(ips),
            command_event_ids=command_event_ids,
            src_ip=src_ip,
        ):
            selected.append((ev, ips, matched))

    linked = [item for item in selected if str(item[0].id) in command_event_ids]
    others = [item for item in selected if str(item[0].id) not in command_event_ids]
    # Linked evidence is kept even when the scan is the newest slice; fill the rest
    # with the newest remaining matches up to the requested cap.
    room = max(limit - len(linked), 0)
    chosen = linked + others[:room]
    events_truncated = len(others) > room
    chosen.sort(key=lambda item: ensure_utc(item[0].received_at) or datetime.min.replace(tzinfo=UTC))
    kept_commands.sort(key=lambda row: ensure_utc(row.observed_at) or datetime.min.replace(tzinfo=UTC))

    pot_ids = {ev.pot_id for ev, _, _ in chosen} | {row.pot_id for row in kept_commands}
    if request.pot_id is not None:
        pot_ids.add(request.pot_id)
    pots_by_id: dict[UUID, Pot] = {}
    if pot_ids:
        for pot in (await session.execute(select(Pot).where(Pot.id.in_(pot_ids)))).scalars().all():
            pots_by_id[pot.id] = pot

    stack_ids = {ev.stack_id for ev, _, _ in chosen if ev.stack_id}
    stack_names: dict[UUID, str] = {}
    if stack_ids:
        for stack_id, name in (await session.execute(select(Stack.id, Stack.name).where(Stack.id.in_(stack_ids)))).all():
            stack_names[stack_id] = name

    events_by_id = {ev.id: (ev, ips) for ev, ips, _ in prepared}

    report_events: list[ReportEvent] = []
    for ev, ips, matched in chosen:
        payload = ev.payload if isinstance(ev.payload, dict) else None
        enr = enrichment_of(payload)
        slim, payload_truncated = prepare_payload(payload)
        raw_log = None
        raw_truncated = False
        if request.include_raw:
            raw_log, raw_truncated = _clip(ev.raw_log, RAW_LOG_CAP)
        report_events.append(
            ReportEvent(
                id=str(ev.id),
                received_at=ensure_utc(ev.received_at) or ev.received_at,
                pot_id=str(ev.pot_id),
                pot_name=pots_by_id[ev.pot_id].name if ev.pot_id in pots_by_id else None,
                stack_id=str(ev.stack_id) if ev.stack_id else None,
                stack_name=stack_names.get(ev.stack_id) if ev.stack_id else None,
                service_name=ev.service_name,
                event_type=ev.event_type,
                event_title=event_title(ev.event_type),
                summary=event_summary(ev.event_type, ev.service_name, payload),
                severity=ev.severity,
                channel=ev.channel,
                source=ev.source,
                source_ips=ips,
                attack_types=_str_list(enr.get("attack_types")) if enr else [],
                tools=_str_list(enr.get("tools")) if enr else [],
                techniques=_str_list(enr.get("techniques")) if enr else [],
                cve_ids=[item.upper() for item in _str_list(enr.get("cve_ids"))] if enr else [],
                rule_names=_str_list(enr.get("rule_names")) if enr else [],
                confidence=_as_float(enr.get("confidence")) if enr else None,
                enrichment_status=_plain(enr.get("status")) if enr else None,
                cve_details=_cve_details(enr),
                payload=slim,
                payload_truncated=payload_truncated,
                raw_log=raw_log,
                raw_log_truncated=raw_truncated,
            )
        )

    report_commands: list[ReportCommand] = []
    for row in kept_commands:
        context = row.context
        if not context and row.event_id and row.event_id in events_by_id:
            ev, _ips = events_by_id[row.event_id]
            if ev.raw_log:
                context = excerpt_around(ev.raw_log, row.command)
        context, context_truncated = _clip(context, CONTEXT_CAP)
        report_commands.append(
            ReportCommand(
                id=str(row.id),
                pot_id=str(row.pot_id),
                pot_name=pots_by_id[row.pot_id].name if row.pot_id in pots_by_id else None,
                container=row.container,
                kind=row.kind,
                command=redact_text(row.command),
                src_ip=row.src_ip,
                session_id=row.session_id,
                username=row.username,
                hit_count=row.hit_count,
                observed_at=ensure_utc(row.observed_at) or row.observed_at,
                first_seen_at=ensure_utc(row.first_seen_at) or row.first_seen_at,
                last_seen_at=ensure_utc(row.last_seen_at) or row.last_seen_at,
                event_id=str(row.event_id) if row.event_id else None,
                context=context,
                context_truncated=context_truncated,
            )
        )

    ip_events: dict[str, set[str]] = defaultdict(set)
    ip_commands: dict[str, int] = defaultdict(int)
    ip_users: dict[str, set[str]] = defaultdict(set)
    ip_attacks: dict[str, set[str]] = defaultdict(set)
    ip_tools: dict[str, set[str]] = defaultdict(set)
    ip_cves: dict[str, set[str]] = defaultdict(set)
    addresses: set[str] = set()
    for event in report_events:
        for ip in event.source_ips:
            if ip in _NOISE_IPS:
                continue
            addresses.add(ip)
            ip_events[ip].add(event.id)
            ip_attacks[ip].update(event.attack_types)
            ip_tools[ip].update(event.tools)
            ip_cves[ip].update(event.cve_ids)
    for command in report_commands:
        if not command.src_ip or command.src_ip in _NOISE_IPS:
            continue
        addresses.add(command.src_ip)
        ip_commands[command.src_ip] += 1
        if command.username:
            ip_users[command.src_ip].add(command.username)

    tracked: dict[str, ThreatIp] = {}
    if addresses:
        rows = (
            await session.execute(select(ThreatIp).where(ThreatIp.ip_address.in_(sorted(addresses))))
        ).scalars().all()
        tracked = {row.ip_address: row for row in rows}

    attackers: list[ReportAttacker] = []
    for ip in addresses:
        row = tracked.get(ip)
        geo = _geo(row.geo) if row is not None else None
        hosting = row.is_hosting if row is not None else None
        if hosting is None and geo is not None:
            hosting = geo.is_hosting
        attacks = set(ip_attacks[ip])
        tools = set(ip_tools[ip])
        cves = set(ip_cves[ip])
        if row is not None:
            attacks.update(_str_list(row.attack_types))
            tools.update(_str_list(row.tools))
            cves.update(item.upper() for item in _str_list(row.cve_ids))
        attackers.append(
            ReportAttacker(
                ip_address=ip,
                status=row.status if row is not None else "observed",
                tracked=row is not None,
                hit_count=row.hit_count if row is not None else None,
                match_count=row.match_count if row is not None else None,
                abuse_score=row.abuse_score if row is not None else None,
                is_tor=row.is_tor if row is not None else None,
                is_hosting=hosting,
                geo=geo,
                attack_types=sorted(attacks),
                tools=sorted(tools, key=str.lower),
                cve_ids=sorted(cves),
                tags=_str_list(row.tags) if row is not None else [],
                user_notes=((row.user_notes or "").strip() or None) if row is not None else None,
                first_seen_at=ensure_utc(row.first_seen_at) if row is not None else None,
                last_seen_at=ensure_utc(row.last_seen_at) if row is not None else None,
                command_count=ip_commands[ip],
                event_count=len(ip_events[ip]),
                usernames=sorted(ip_users[ip], key=str.lower),
            )
        )
    attackers.sort(
        key=lambda item: (
            -(item.command_count + item.event_count),
            -(item.hit_count or 0),
            item.ip_address,
        )
    )

    attack_counts: Counter[str] = Counter()
    tool_counts: Counter[str] = Counter()
    technique_counts: Counter[str] = Counter()
    severity_counts: Counter[str] = Counter()
    cve_events: dict[str, set[str]] = defaultdict(set)
    cve_ips: dict[str, set[str]] = defaultdict(set)
    cve_hint: dict[str, ReportCveDetail] = {}
    services: set[str] = set()
    for event in report_events:
        severity_counts[event.severity or "unknown"] += 1
        if event.service_name:
            services.add(event.service_name)
        for key in event.attack_types:
            attack_counts[key] += 1
        for key in event.tools:
            tool_counts[key] += 1
        for key in event.techniques:
            technique_counts[key] += 1
        for cve_id in event.cve_ids:
            cve_events[cve_id].add(event.id)
            cve_ips[cve_id].update(event.source_ips)
        for detail in event.cve_details:
            cve_events[detail.cve_id].add(event.id)
            cve_ips[detail.cve_id].update(event.source_ips)
            cve_hint.setdefault(detail.cve_id, detail)
    for command in report_commands:
        if command.container:
            services.add(command.container)

    for attacker in attackers:
        for cve_id in attacker.cve_ids:
            cve_ips[cve_id].add(attacker.ip_address)

    cache: dict[str, CveEntry] = {}
    if cve_events or cve_ips:
        ids = set(cve_events) | set(cve_ips)
        for entry in (await session.execute(select(CveEntry).where(CveEntry.cve_id.in_(ids)))).scalars().all():
            cache[entry.cve_id.upper()] = entry

    cves: list[ReportCve] = []
    for cve_id in sorted(set(cve_events) | set(cve_ips)):
        entry = cache.get(cve_id.upper())
        hint = cve_hint.get(cve_id.upper()) or cve_hint.get(cve_id)
        references = _str_list(entry.references) if entry is not None else []
        cves.append(
            ReportCve(
                cve_id=cve_id.upper(),
                summary=(entry.summary if entry is not None else None) or (hint.summary if hint else None),
                severity=(entry.severity if entry is not None else None) or (hint.severity if hint else None),
                cvss_score=(entry.cvss_score if entry is not None else None) or (hint.cvss_score if hint else None),
                category=entry.category if entry is not None else None,
                vendor=entry.vendor if entry is not None else None,
                product=entry.product if entry is not None else None,
                references=references,
                notes=(entry.notes or "").strip() or None if entry is not None else None,
                event_count=len(cve_events.get(cve_id, set()) | cve_events.get(cve_id.upper(), set())),
                source_ips=sorted(cve_ips.get(cve_id, set()) | cve_ips.get(cve_id.upper(), set())),
                in_cache=entry is not None,
            )
        )
    cves.sort(key=lambda item: (severity_rank(item.severity), item.cve_id))

    usernames = sorted({command.username for command in report_commands if command.username}, key=str.lower)
    sessions = {command.session_id for command in report_commands if command.session_id}
    kind_counts = Counter(command.kind for command in report_commands)

    pot_event_counts: Counter[str] = Counter(event.pot_id for event in report_events)
    pot_command_counts: Counter[str] = Counter(command.pot_id for command in report_commands)
    report_pots: list[ReportPot] = []
    for pot_id in sorted(pot_ids, key=lambda item: pots_by_id[item].name.lower() if item in pots_by_id else str(item)):
        pot = pots_by_id.get(pot_id)
        key = str(pot_id)
        report_pots.append(
            ReportPot(
                id=key,
                name=pot.name if pot is not None else key,
                description=pot.description if pot is not None else None,
                last_ip=pot.last_ip if pot is not None else None,
                event_count=pot_event_counts[key],
                command_count=pot_command_counts[key],
            )
        )

    notes_out: list[str] = []
    if events_truncated:
        notes_out.append(
            f"Event evidence is capped at the {limit} most relevant records in this window "
            "(command evidence is kept first)."
        )
    if commands_truncated:
        notes_out.append(f"Captured commands are capped at the {limit} most recent rows in this window.")
    if scan_capped:
        notes_out.append(
            f"The builder read the newest {EVENT_SCAN} runtime events in the window "
            f"out of {event_total}. Older matches can be reached with a shorter window."
        )
    if any(event.raw_log_truncated for event in report_events):
        notes_out.append(f"Raw logs longer than {RAW_LOG_CAP} characters are truncated in the evidence section.")
    if not request.include_raw:
        notes_out.append("Raw log bodies were left out of this export. Turn them on to include sensor excerpts.")

    counts = ReportCounts(
        events=len(report_events),
        matched_events=sum(1 for event in report_events if event.enrichment_status in {"matched", "low_confidence"}),
        commands=len(report_commands),
        shell=kind_counts.get("shell", 0),
        http=kind_counts.get("http", 0),
        login=kind_counts.get("login", 0),
        download=kind_counts.get("download", 0),
        other_commands=sum(count for kind, count in kind_counts.items() if kind not in {"shell", "http", "login", "download"}),
        source_ips=len(attackers),
        usernames=len(usernames),
        cves=len(cves),
        pots=len(report_pots),
        sessions=len(sessions),
        services=len(services),
    )
    scope = ReportScope(
        title=title,
        focus=focus,
        focus_label=FOCUS_LABELS.get(focus, focus),
        range_key=range_key,
        since=since,
        until=until,
        pot_id=str(request.pot_id) if request.pot_id else None,
        pot_name=pot_name,
        src_ip=src_ip,
        include_raw=request.include_raw,
        analyst_notes=notes,
        generated_at=datetime.now(UTC),
        generated_by=exported_by,
        events_truncated=events_truncated,
        commands_truncated=commands_truncated,
        scan_capped=scan_capped,
        truncation_notes=notes_out,
    )
    attack_items = _count_items(attack_counts, label_attack)
    tool_items = _count_items(tool_counts, lambda key: key)
    return IncidentReport(
        scope=scope,
        paragraphs=write_paragraphs(scope, counts, attackers, attack_items, tool_items, cves),
        counts=counts,
        pots=report_pots,
        services=sorted(services, key=str.lower),
        attackers=attackers,
        by_attack_type=attack_items,
        by_tool=tool_items,
        by_severity=_count_items(severity_counts, lambda key: key),
        by_technique=_count_items(technique_counts, lambda key: key),
        usernames=usernames,
        timeline=report_events,
        commands=report_commands,
        cves=cves,
    )


def _count_items(counter: Counter[str], labeler) -> list[CountItem]:
    return [
        CountItem(key=key, label=labeler(key), count=count)
        for key, count in counter.most_common()
    ]

