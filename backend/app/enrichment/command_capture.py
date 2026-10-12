"""Store commands extracted from ingested honeypot logs."""

from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import timedelta
from uuid import UUID

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.enrichment.command_extract import (
    command_identity,
    duplicate_group_indexes,
    extract_commands,
    is_control_plane_container,
    normalize_command,
)
from app.models.event import Event
from app.models.threat_command import ThreatCommand
from app.time_utils import utc_now

log = logging.getLogger("watchpot.enrichment.commands")


def _container_name(ev: Event) -> str | None:
    payload = ev.payload if isinstance(ev.payload, dict) else None
    if payload:
        raw = payload.get("container") or payload.get("container_name")
        if isinstance(raw, str) and raw.strip():
            return raw.strip().lstrip("/")
    if ev.service_name:
        return ev.service_name
    return None


_HTTP_METHODS = ("GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS", "PATCH")
_NOISE_EXACT_PATHS = ("/bot/statistic",)
_CONTROL_PLANE_CONTAINERS = (
    "watchpot-api%",
    "watchpot-web%",
    "watchpot-proxy%",
    "watchpot-postgres%",
    "watchpot-agent%",
    "watchpot-grafana%",
    "watchpot-setup-wizard%",
)


def _noise_delete_filter():
    clauses = []
    for method in _HTTP_METHODS:
        clauses.append(ThreatCommand.command.ilike(f"{method} /api/agent%"))
        clauses.append(ThreatCommand.command.ilike(f"{method} /bot/statistic%"))
        for path in _NOISE_EXACT_PATHS:
            clauses.append(ThreatCommand.command == f"{method} {path}")
            clauses.append(ThreatCommand.command.ilike(f"{method} {path}?%"))
    for pattern in _CONTROL_PLANE_CONTAINERS:
        clauses.append(ThreatCommand.container.ilike(pattern))
    return or_(*clauses)


def stored_fingerprint(pot_id: UUID | str, container: str | None, kind: str, command: str, src_ip: str | None) -> str:
    kind_key, command_key, ip_key = command_identity(kind, command, src_ip)
    inner = hashlib.sha256(f"{kind_key}\n{command_key}\n{ip_key}".encode()).hexdigest()
    return hashlib.sha256(f"{pot_id}|{container or ''}|{inner}".encode()).hexdigest()


async def purge_noise_commands(session: AsyncSession) -> int:
    """Drop platform traffic and telemetry that should never have been stored."""
    result = await session.execute(delete(ThreatCommand).where(_noise_delete_filter()))
    return int(result.rowcount or 0)


async def _expand_clipped(
    session: AsyncSession,
    *,
    pot_id: UUID,
    container: str | None,
    kind: str,
    src_ip: str | None,
    command: str,
) -> ThreatCommand | None:
    """Replace a row saved under the old 1024-character cutoff with the full command."""
    if len(command) <= 1024:
        return None
    stmt = select(ThreatCommand).where(
        ThreatCommand.pot_id == pot_id,
        ThreatCommand.kind == kind,
        ThreatCommand.command == command[:1024],
    )
    if container:
        stmt = stmt.where(ThreatCommand.container == container)
    else:
        stmt = stmt.where(ThreatCommand.container.is_(None))
    if src_ip:
        stmt = stmt.where(ThreatCommand.src_ip == src_ip)
    rows = list((await session.execute(stmt)).scalars().all())
    if len(rows) != 1:
        return None
    return rows[0]


async def delete_commands(session: AsyncSession, command_ids: list[UUID]) -> int:
    if not command_ids:
        return 0
    result = await session.execute(delete(ThreatCommand).where(ThreatCommand.id.in_(command_ids)))
    return int(result.rowcount or 0)


async def dedupe_commands(session: AsyncSession) -> int:
    """Collapse repeat sightings of the same command into one row and sum their counts."""
    rows = list((await session.execute(select(ThreatCommand))).scalars().all())
    if not rows:
        return 0
    payload = [
        {
            "pot_id": str(row.pot_id),
            "container": row.container or "",
            "kind": row.kind,
            "command": row.command,
            "src_ip": row.src_ip or "",
        }
        for row in rows
    ]
    removed = 0
    dirty = False
    for indexes in duplicate_group_indexes(payload):
        group = [rows[index] for index in indexes]
        longest = max(group, key=lambda row: len(normalize_command(row.kind, row.command)))
        command = normalize_command(longest.kind, longest.command)
        keeper = max(
            group,
            key=lambda row: (
                len(row.command or ""),
                len(row.context or ""),
                row.last_seen_at,
            ),
        )
        fingerprint = stored_fingerprint(keeper.pot_id, keeper.container, keeper.kind, command, keeper.src_ip)
        losers = [row for row in group if row.id != keeper.id]
        hits = sum(int(row.hit_count or 0) for row in group)
        first_seen = min(row.first_seen_at for row in group)
        last_seen = max(row.last_seen_at for row in group)
        observed = min(row.observed_at for row in group)
        context = max((row.context or "" for row in group), key=len)
        latest = max(group, key=lambda row: row.last_seen_at)
        unchanged = (
            not losers
            and keeper.fingerprint == fingerprint
            and keeper.command == command
            and int(keeper.hit_count or 0) == hits
        )
        if unchanged:
            continue
        dirty = True
        if losers:
            await session.execute(delete(ThreatCommand).where(ThreatCommand.id.in_([row.id for row in losers])))
            removed += len(losers)
        keeper.command = command
        keeper.fingerprint = fingerprint
        keeper.hit_count = hits
        keeper.first_seen_at = first_seen
        keeper.last_seen_at = last_seen
        keeper.observed_at = observed
        if context:
            keeper.context = context
        if latest.username:
            keeper.username = latest.username
        if latest.session_id:
            keeper.session_id = latest.session_id
        if longest.event_id:
            keeper.event_id = longest.event_id
    if dirty:
        await session.flush()
    return removed


async def record_commands_for_events(session: AsyncSession, event_ids: list[UUID]) -> int:
    if not event_ids:
        return 0
    await purge_noise_commands(session)
    await dedupe_commands(session)
    result = await session.execute(select(Event).where(Event.id.in_(event_ids)))
    events = list(result.scalars().all())
    stored = 0
    now = utc_now()
    pending: dict[str, ThreatCommand] = {}
    for ev in events:
        if not ev.raw_log:
            continue
        if ev.event_type != "watchpot.agent.container_logs" and ev.channel != "runtime":
            continue
        container = _container_name(ev)
        if is_control_plane_container(container):
            continue
        for item in extract_commands(ev.raw_log):
            command = normalize_command(item.kind, item.command)
            fingerprint = stored_fingerprint(ev.pot_id, container, item.kind, command, item.src_ip)
            observed = item.observed_at or ev.received_at or now
            staged = pending.get(fingerprint)
            if staged is not None:
                staged.hit_count += 1
                staged.last_seen_at = now
                continue
            existing = (
                await session.execute(select(ThreatCommand).where(ThreatCommand.fingerprint == fingerprint))
            ).scalar_one_or_none()
            if existing is None:
                clipped = await _expand_clipped(
                    session,
                    pot_id=ev.pot_id,
                    container=container,
                    kind=item.kind,
                    src_ip=item.src_ip,
                    command=command,
                )
                if clipped is not None:
                    clipped.fingerprint = fingerprint
                    clipped.command = command
                    clipped.event_id = ev.id
                    if item.excerpt:
                        clipped.context = item.excerpt
                    clipped.hit_count += 1
                    clipped.last_seen_at = now
                    pending[fingerprint] = clipped
                    continue
                row = ThreatCommand(
                    fingerprint=fingerprint,
                    pot_id=ev.pot_id,
                    event_id=ev.id,
                    container=container,
                    kind=item.kind,
                    command=command,
                    src_ip=item.src_ip,
                    session_id=item.session_id,
                    username=item.username,
                    hit_count=1,
                    observed_at=observed,
                    first_seen_at=now,
                    last_seen_at=now,
                    context=item.excerpt or None,
                )
                session.add(row)
                pending[fingerprint] = row
                stored += 1
            else:
                existing.hit_count += 1
                existing.last_seen_at = now
                if container and not existing.container:
                    existing.container = container
                if item.src_ip and not existing.src_ip:
                    existing.src_ip = item.src_ip
                if item.excerpt and not existing.context:
                    existing.context = item.excerpt
                    existing.event_id = ev.id
                pending[fingerprint] = existing
    if pending:
        await session.flush()
    return stored


async def scan_events_for_commands(
    session: AsyncSession,
    *,
    lookback_hours: int = 168,
    limit: int = 500,
) -> tuple[int, int]:
    since = utc_now() - timedelta(hours=lookback_hours)
    rows = list(
        (
            await session.execute(
                select(Event)
                .where(Event.received_at >= since, Event.raw_log.is_not(None), Event.channel == "runtime")
                .order_by(Event.received_at.desc())
                .limit(limit)
            )
        ).scalars().all()
    )
    found = await record_commands_for_events(session, [row.id for row in rows])
    return len(rows), found


async def command_stats(session: AsyncSession) -> dict[str, int]:
    total = int((await session.execute(select(func.count()).select_from(ThreatCommand))).scalar_one())

    async def kind_count(kind: str) -> int:
        return int(
            (
                await session.execute(
                    select(func.count()).select_from(ThreatCommand).where(ThreatCommand.kind == kind)
                )
            ).scalar_one()
        )

    unique_ips = int(
        (
            await session.execute(
                select(func.count(func.distinct(ThreatCommand.src_ip))).where(ThreatCommand.src_ip.is_not(None))
            )
        ).scalar_one()
    )
    return {
        "total": total,
        "shell": await kind_count("shell"),
        "http": await kind_count("http"),
        "login": await kind_count("login"),
        "download": await kind_count("download"),
        "unique_ips": unique_ips,
    }


def schedule_command_capture(event_ids: list[UUID]) -> None:
    async def _run() -> None:
        try:
            from app.database import async_session_factory, commit_session

            async with async_session_factory() as session:
                n = await record_commands_for_events(session, event_ids)
                await commit_session(session)
                if n:
                    log.debug("captured %s command(s)", n)
        except Exception:
            log.exception("background command capture failed")

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_run())
    except RuntimeError:
        pass
