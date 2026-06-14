"""Analytics over the event ingested layer — dialect-aware time bucketing."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import engine
from app.models.event import Event
from app.models.pot import Pot
from app.models.stack import Stack, StackRevision
from app.runtime_config import get_heartbeat_stale_minutes
from app.schemas.pot import build_pot_out

# Exclude control-plane audit stream from SIEM-style charts (runtime + agent infra only).
_CHART_CHANNELS = Event.channel.in_(("runtime", "infra"))


ALLOWED_RANGE_KEYS = frozenset({"1h", "1d", "24h", "7d", "14d", "30d", "31d"})


def parse_range(range_key: str) -> tuple[datetime, datetime]:
    now = datetime.now(UTC)
    key = range_key.strip().lower()
    if key == "1h":
        return now - timedelta(hours=1), now
    if key in ("1d", "24h"):
        return now - timedelta(days=1), now
    if key == "7d":
        return now - timedelta(days=7), now
    if key == "14d":
        return now - timedelta(days=14), now
    if key in ("30d", "31d"):
        return now - timedelta(days=31 if key == "31d" else 30), now
    return now - timedelta(days=1), now


def timeseries_bucket_for_range(range_key: str) -> str:
    key = range_key.strip().lower()
    if key in ("1h", "1d", "24h"):
        return "hour"
    return "day"


def _container_running(row: dict[str, Any]) -> bool:
    state = str(row.get("State") or "").lower()
    status = str(row.get("Status") or "").lower()
    return "running" in state or status.startswith("up ") or " up" in status


def _bucket_hour_expr(col: Any) -> Any:
    d = engine.sync_engine.dialect.name
    if d == "postgresql":
        return func.date_trunc("hour", col)
    return func.strftime("%Y-%m-%d %H:00:00", col)


def _bucket_day_expr(col: Any) -> Any:
    d = engine.sync_engine.dialect.name
    if d == "postgresql":
        return func.date_trunc("day", col)
    return func.strftime("%Y-%m-%d %H:00:00", col)


async def summary(
    session: AsyncSession,
    *,
    range_key: str,
    pot_id: UUID | None,
) -> dict[str, Any]:
    since, until = parse_range(range_key)
    q = select(func.count()).select_from(Event).where(
        Event.received_at >= since, Event.received_at <= until, _CHART_CHANNELS
    )
    if pot_id is not None:
        q = q.where(Event.pot_id == pot_id)
    total = (await session.execute(q)).scalar_one()

    by_sev = await _group_count(session, "severity", since, until, pot_id, limit=32)
    by_type = await _group_count(session, "event_type", since, until, pot_id, limit=32)
    by_src = await _group_count(session, "source", since, until, pot_id, limit=32)

    hours = max((until - since).total_seconds() / 3600, 1e-6)
    rate_per_hour = round(total / hours, 2)

    return {
        "total": int(total),
        "rate_per_hour": rate_per_hour,
        "since": since.isoformat(),
        "until": until.isoformat(),
        "by_severity": by_sev,
        "by_event_type": by_type,
        "by_source": by_src,
    }


async def _group_count(
    session: AsyncSession,
    column: str,
    since: datetime,
    until: datetime,
    pot_id: UUID | None,
    *,
    limit: int,
) -> list[dict[str, Any]]:
    col = getattr(Event, column)
    q = (
        select(col, func.count().label("c"))
        .where(Event.received_at >= since, Event.received_at <= until, _CHART_CHANNELS)
        .group_by(col)
        .order_by(func.count().desc())
        .limit(limit)
    )
    if pot_id is not None:
        q = q.where(Event.pot_id == pot_id)
    rows = (await session.execute(q)).all()
    out: list[dict[str, Any]] = []
    for r in rows:
        if r[0] is None:
            continue
        out.append({"key": str(r[0]), "count": int(r[1])})
    return out


async def timeseries(
    session: AsyncSession,
    *,
    range_key: str,
    bucket: str,
    pot_id: UUID | None,
) -> dict[str, Any]:
    since, until = parse_range(range_key)
    b = _bucket_hour_expr(Event.received_at) if bucket == "hour" else _bucket_day_expr(Event.received_at)
    q = (
        select(b.label("bucket"), func.count().label("c"))
        .select_from(Event)
        .where(Event.received_at >= since, Event.received_at <= until, _CHART_CHANNELS)
        .group_by(b)
        .order_by(b)
    )
    if pot_id is not None:
        q = q.where(Event.pot_id == pot_id)
    rows = (await session.execute(q)).all()
    return {
        "points": [{"t": str(r[0]), "count": int(r[1])} for r in rows],
        "since": since.isoformat(),
        "until": until.isoformat(),
    }


async def timeseries_by_severity(
    session: AsyncSession,
    *,
    range_key: str,
    pot_id: UUID | None,
) -> dict[str, Any]:
    since, until = parse_range(range_key)
    b = _bucket_hour_expr(Event.received_at)
    q = (
        select(b.label("bucket"), Event.severity, func.count().label("c"))
        .select_from(Event)
        .where(Event.received_at >= since, Event.received_at <= until, _CHART_CHANNELS)
        .group_by(b, Event.severity)
        .order_by(b)
    )
    if pot_id is not None:
        q = q.where(Event.pot_id == pot_id)
    rows = (await session.execute(q)).all()
    buckets: dict[str, dict[str, int]] = {}
    severities: set[str] = set()
    for row in rows:
        bucket, sev, c = row[0], row[1], int(row[2])
        ts = str(bucket)
        if ts not in buckets:
            buckets[ts] = {}
        buckets[ts][sev] = c
        severities.add(sev)
    ordered_bucket_keys = sorted(buckets.keys())
    sev_list = sorted(severities)
    return {
        "buckets": ordered_bucket_keys,
        "severities": sev_list,
        "series": {s: [buckets.get(t, {}).get(s, 0) for t in ordered_bucket_keys] for s in sev_list},
    }


async def top_pots(
    session: AsyncSession,
    *,
    range_key: str,
    limit: int,
) -> list[dict[str, Any]]:
    since, until = parse_range(range_key)
    q = (
        select(Event.pot_id, Pot.name, func.count().label("c"))
        .join(Pot, Pot.id == Event.pot_id)
        .where(Event.received_at >= since, Event.received_at <= until, _CHART_CHANNELS)
        .group_by(Event.pot_id, Pot.name)
        .order_by(func.count().desc())
        .limit(limit)
    )
    rows = (await session.execute(q)).all()
    return [{"pot_id": str(r[0]), "name": r[1], "count": int(r[2])} for r in rows]


async def heatmap_hour_of_day(
    session: AsyncSession,
    *,
    range_key: str,
    pot_id: UUID | None,
) -> dict[str, Any]:
    since, until = parse_range(range_key)
    q = select(Event.received_at).where(Event.received_at >= since, Event.received_at <= until, _CHART_CHANNELS)
    if pot_id is not None:
        q = q.where(Event.pot_id == pot_id)
    rows = (await session.execute(q)).scalars().all()
    counts = [0] * 24
    for r in rows:
        if r is None:
            continue
        counts[r.hour % 24] += 1
    return {"hours": list(range(24)), "counts": counts}


async def recent_events(
    session: AsyncSession,
    *,
    limit: int,
    pot_id: UUID | None,
) -> list[dict[str, Any]]:
    q = select(Event).where(_CHART_CHANNELS)
    if pot_id is not None:
        q = q.where(Event.pot_id == pot_id)
    q = q.order_by(Event.received_at.desc()).limit(limit)
    rows = (await session.execute(q)).scalars().all()
    return [
        {
            "id": str(e.id),
            "pot_id": str(e.pot_id),
            "event_type": e.event_type,
            "severity": e.severity,
            "source": e.source,
            "received_at": e.received_at.isoformat(),
        }
        for e in rows
    ]


async def comparison_periods(
    session: AsyncSession,
    *,
    range_key: str = "1d",
    pot_id: UUID | None,
) -> dict[str, Any]:
    cur_s, cur_e = parse_range(range_key)
    span = cur_e - cur_s
    prev_s, prev_e = cur_s - span, cur_s

    async def cnt(s: datetime, e: datetime) -> int:
        q = select(func.count()).select_from(Event).where(
            Event.received_at >= s, Event.received_at <= e, _CHART_CHANNELS
        )
        if pot_id is not None:
            q = q.where(Event.pot_id == pot_id)
        return int((await session.execute(q)).scalar_one())

    c_cur = await cnt(cur_s, cur_e)
    c_prev = await cnt(prev_s, prev_e)
    delta = c_cur - c_prev
    pct = round((delta / c_prev * 100), 1) if c_prev else None
    return {
        "current_total": c_cur,
        "previous_total": c_prev,
        "delta": delta,
        "delta_percent": pct,
    }


async def stack_by_service(
    session: AsyncSession,
    *,
    range_key: str,
    pot_id: UUID | None,
) -> dict[str, Any]:
    since, until = parse_range(range_key)
    q = (
        select(Event.service_name, func.count().label("c"))
        .where(Event.received_at >= since, Event.received_at <= until, _CHART_CHANNELS)
        .group_by(Event.service_name)
        .order_by(func.count().desc())
        .limit(12)
    )
    if pot_id is not None:
        q = q.where(Event.pot_id == pot_id)
    rows = (await session.execute(q)).all()
    return {
        "items": [
            {"name": (r[0] or "(none)"), "count": int(r[1])}
            for r in rows
        ],
    }


async def events_by_stack(
    session: AsyncSession,
    *,
    range_key: str,
    limit: int,
) -> list[dict[str, Any]]:
    since, until = parse_range(range_key)
    q = (
        select(Event.stack_id, Stack.name, func.count().label("c"))
        .join(Stack, Stack.id == Event.stack_id, isouter=True)
        .where(Event.received_at >= since, Event.received_at <= until, _CHART_CHANNELS)
        .group_by(Event.stack_id, Stack.name)
        .order_by(func.count().desc())
        .limit(limit)
    )
    rows = (await session.execute(q)).all()
    out = []
    for r in rows:
        sid, name, c = r[0], r[1], int(r[2])
        out.append({
            "stack_id": str(sid) if sid else None,
            "name": name or "(no stack)",
            "count": c,
        })
    return out


async def radar_event_types(
    session: AsyncSession,
    *,
    range_key: str,
    pot_id: UUID | None,
) -> dict[str, Any]:
    """Top event types normalized to 0–100 for radar-style charts."""
    since, until = parse_range(range_key)
    q = (
        select(Event.event_type, func.count().label("c"))
        .where(Event.received_at >= since, Event.received_at <= until, _CHART_CHANNELS)
        .group_by(Event.event_type)
        .order_by(func.count().desc())
        .limit(8)
    )
    if pot_id is not None:
        q = q.where(Event.pot_id == pot_id)
    rows = (await session.execute(q)).all()
    items = [{"name": str(r[0]), "count": int(r[1])} for r in rows if r[0]]
    if not items:
        return {"axes": [], "values": []}
    m = max(i["count"] for i in items)
    return {
        "axes": [i["name"] for i in items],
        "values": [round(i["count"] / m * 100, 1) for i in items],
    }


async def dashboard_overview(
    session: AsyncSession,
    *,
    range_key: str,
) -> dict[str, Any]:
    rk = range_key if range_key in ALLOWED_RANGE_KEYS else "1d"
    ev = await summary(session, range_key=rk, pot_id=None)
    ts = await timeseries(
        session,
        range_key=rk,
        bucket=timeseries_bucket_for_range(rk),
        pot_id=None,
    )
    cmp = await comparison_periods(session, range_key=rk, pot_id=None)
    top = await top_pots(session, range_key=rk, limit=8)
    recent = await recent_events(session, limit=12, pot_id=None)

    pots_result = await session.execute(select(Pot).order_by(Pot.name.asc()))
    pots = list(pots_result.scalars().all())

    live = offline = awaiting = 0
    containers_total = running = 0
    pot_rows: list[dict[str, Any]] = []

    for p in pots:
        out = build_pot_out(p)
        if out.heartbeat_online:
            live += 1
        elif out.last_heartbeat_at:
            offline += 1
        else:
            awaiting += 1

        pot_containers = 0
        pot_running = 0
        meta = p.meta if isinstance(p.meta, dict) else {}
        snap = meta.get("infra_snapshot")
        if isinstance(snap, dict):
            for c in snap.get("containers") or []:
                if not isinstance(c, dict):
                    continue
                pot_containers += 1
                containers_total += 1
                if _container_running(c):
                    pot_running += 1
                    running += 1

        pot_rows.append(
            {
                "id": str(p.id),
                "name": p.name,
                "heartbeat_online": out.heartbeat_online,
                "last_heartbeat_at": out.last_heartbeat_at.isoformat() if out.last_heartbeat_at else None,
                "containers_total": pot_containers,
                "containers_running": pot_running,
            }
        )

    pot_rows.sort(key=lambda r: (not r["heartbeat_online"], r["name"].lower()))

    stacks_total = int((await session.execute(select(func.count()).select_from(Stack))).scalar_one())
    stacks_with_compose = int(
        (
            await session.execute(
                select(func.count(distinct(StackRevision.stack_id))).select_from(StackRevision)
            )
        ).scalar_one()
    )

    return {
        "range": rk,
        "since": ev["since"],
        "until": ev["until"],
        "heartbeat_stale_minutes": get_heartbeat_stale_minutes(),
        "events": {
            "total": ev["total"],
            "rate_per_hour": ev["rate_per_hour"],
            "by_severity": ev["by_severity"],
            "by_event_type": ev["by_event_type"][:10],
        },
        "comparison": cmp,
        "timeseries": ts,
        "pots": {
            "total": len(pots),
            "live": live,
            "offline": offline,
            "awaiting": awaiting,
            "rows": pot_rows,
        },
        "stacks": {
            "total": stacks_total,
            "with_compose": stacks_with_compose,
            "without_compose": max(0, stacks_total - stacks_with_compose),
        },
        "containers": {
            "total": containers_total,
            "running": running,
            "stopped": max(0, containers_total - running),
        },
        "top_pots": top,
        "recent_events": recent,
    }
