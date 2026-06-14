"""Analytics over enrichment metadata stored in event payloads."""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.enrichment.config import load_config
from app.models.cve_entry import CveEntry
from app.models.enrichment_rule import EnrichmentRule
from app.models.enrichment_schedule import EnrichmentSchedule
from app.models.event import Event
from app.services.analytics_events import parse_range

_CHART_CHANNELS = Event.channel.in_(("runtime", "infra"))


def _enrichment_from_payload(payload: dict | None) -> dict[str, Any] | None:
    if not payload or not isinstance(payload.get("enrichment"), dict):
        return None
    return payload["enrichment"]


async def enrichment_stats(
    session: AsyncSession,
    *,
    range_key: str = "1d",
    pot_id: UUID | None = None,
    limit: int = 12,
) -> dict[str, Any]:
    since, until = parse_range(range_key)
    cfg = await load_config(session)

    q = select(Event).where(Event.received_at >= since, Event.received_at <= until, _CHART_CHANNELS)
    if pot_id is not None:
        q = q.where(Event.pot_id == pot_id)
    result = await session.execute(q)
    events = list(result.scalars().all())

    attack_counter: Counter[str] = Counter()
    tool_counter: Counter[str] = Counter()
    cve_counter: Counter[str] = Counter()
    enriched = matched = 0
    recent_matches: list[dict[str, Any]] = []

    for ev in events:
        enr = _enrichment_from_payload(ev.payload)
        if not enr:
            continue
        enriched += 1
        status = str(enr.get("status") or "")
        if status not in ("matched", "low_confidence"):
            continue
        matched += 1
        for at in enr.get("attack_types") or []:
            if at:
                attack_counter[str(at)] += 1
        for tool in enr.get("tools") or []:
            if tool:
                tool_counter[str(tool)] += 1
        for cve in enr.get("cve_ids") or []:
            if cve:
                cve_counter[str(cve).upper()] += 1

        if len(recent_matches) < limit:
            recent_matches.append(
                {
                    "event_id": str(ev.id),
                    "pot_id": str(ev.pot_id),
                    "event_type": ev.event_type,
                    "severity": ev.severity,
                    "service_name": ev.service_name,
                    "received_at": ev.received_at.isoformat(),
                    "attack_types": enr.get("attack_types") or [],
                    "tools": enr.get("tools") or [],
                    "cve_ids": enr.get("cve_ids") or [],
                    "confidence": enr.get("confidence"),
                }
            )

    total = len(events)
    rules_total = int((await session.execute(select(func.count()).select_from(EnrichmentRule))).scalar_one())
    rules_enabled = int(
        (
            await session.execute(
                select(func.count()).select_from(EnrichmentRule).where(EnrichmentRule.enabled.is_(True))
            )
        ).scalar_one()
    )
    cve_cache_size = int((await session.execute(select(func.count()).select_from(CveEntry))).scalar_one())
    schedules_enabled = int(
        (
            await session.execute(
                select(func.count())
                .select_from(EnrichmentSchedule)
                .where(EnrichmentSchedule.enabled.is_(True))
            )
        ).scalar_one()
    )

    def _top(counter: Counter[str], n: int) -> list[dict[str, Any]]:
        return [{"key": k, "count": v} for k, v in counter.most_common(n)]

    return {
        "range": range_key,
        "since": since.isoformat(),
        "until": until.isoformat(),
        "total_events": total,
        "enriched_events": enriched,
        "matched_events": matched,
        "enrichment_rate": round(matched / total * 100, 1) if total else 0.0,
        "by_attack_type": _top(attack_counter, limit),
        "by_tool": _top(tool_counter, limit),
        "by_cve": _top(cve_counter, limit),
        "recent_matches": recent_matches,
        "rules_total": rules_total,
        "rules_enabled": rules_enabled,
        "cve_cache_size": cve_cache_size,
        "schedules_enabled": schedules_enabled,
        "config": cfg,
    }


async def enrichment_breakdown(
    session: AsyncSession,
    *,
    range_key: str,
    dimension: str,
    pot_id: UUID | None = None,
    limit: int = 10,
) -> dict[str, Any]:
    stats = await enrichment_stats(session, range_key=range_key, pot_id=pot_id, limit=limit)
    key_map = {
        "attack_type": "by_attack_type",
        "tool": "by_tool",
        "cve": "by_cve",
    }
    items = stats.get(key_map.get(dimension, "by_attack_type"), [])
    return {"kind": f"bar_{dimension}", "items": items}
