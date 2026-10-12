"""Store commands extracted from ingested honeypot logs."""

from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import timedelta
from uuid import UUID

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.enrichment.command_extract import extract_commands, is_control_plane_container
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


async def record_commands_for_events(session: AsyncSession, event_ids: list[UUID]) -> int:
    if not event_ids:
        return 0
    await purge_noise_commands(session)
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
            fingerprint = hashlib.sha256(
                f"{ev.pot_id}|{container or ''}|{item.fingerprint}".encode()
            ).hexdigest()
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
                    command=item.command,
                )
                if clipped is not None:
                    clipped.fingerprint = fingerprint
                    clipped.command = item.command
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
                    command=item.command,
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
