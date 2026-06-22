"""Event enrichment worker — passive, async, non-blocking."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.database import async_session_factory, commit_session
from app.enrichment.config import load_config
from app.enrichment.cve import lookup_cves
from app.enrichment.engine import aggregate_matches, match_rules
from app.integrations.forwarder import schedule_event_forward
from app.models.enrichment_rule import EnrichmentRule
from app.models.event import Event

log = logging.getLogger("watchpot.enrichment.worker")

_SEVERITY_RANK = {"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4, "warning": 2, "error": 3}


def _should_skip_event(ev: Event, cfg: dict[str, Any]) -> bool:
    if ev.channel not in set(cfg.get("enrich_channels") or ["runtime"]):
        return True
    skip = set(cfg.get("skip_event_types") or [])
    return ev.event_type in skip


def _existing_enrichment(payload: dict | None) -> dict[str, Any] | None:
    if not payload or not isinstance(payload.get("enrichment"), dict):
        return None
    return payload["enrichment"]


async def _load_rules(session: AsyncSession) -> list[EnrichmentRule]:
    result = await session.execute(
        select(EnrichmentRule)
        .where(EnrichmentRule.enabled.is_(True))
        .order_by(EnrichmentRule.priority.desc(), EnrichmentRule.name.asc())
    )
    return list(result.scalars().all())


def _elevate_severity(current: str, proposed: str | None) -> str:
    if not proposed:
        return current
    cur_rank = _SEVERITY_RANK.get(current.lower(), 0)
    new_rank = _SEVERITY_RANK.get(proposed.lower(), 0)
    return proposed.lower() if new_rank > cur_rank else current


async def enrich_event(
    session: AsyncSession,
    ev: Event,
    rules: list[EnrichmentRule],
    cfg: dict[str, Any],
    *,
    force: bool = False,
) -> bool:
    if not cfg.get("enabled", True):
        return False
    if _should_skip_event(ev, cfg):
        return False

    existing = _existing_enrichment(ev.payload)
    if existing and existing.get("status") == "matched" and not force:
        return False

    matches = match_rules(rules, raw_log=ev.raw_log, payload=ev.payload)
    enrichment = aggregate_matches(matches)
    enrichment["enriched_at"] = datetime.now(UTC).isoformat()

    min_conf = float(cfg.get("min_confidence") or 0.0)
    if enrichment["status"] == "matched" and enrichment["confidence"] < min_conf:
        enrichment["status"] = "low_confidence"

    if enrichment["status"] in ("matched", "low_confidence") and cfg.get("cve_lookup_enabled", True):
        cve_details = await lookup_cves(session, enrichment.get("cve_ids") or [])
        if cve_details:
            enrichment["cve_details"] = cve_details

    payload = dict(ev.payload or {})
    payload["enrichment"] = enrichment
    ev.payload = payload
    flag_modified(ev, "payload")

    if cfg.get("elevate_severity", True) and enrichment.get("max_severity"):
        ev.severity = _elevate_severity(ev.severity, enrichment["max_severity"])

    schedule_event_forward(
        {
            "event_type": ev.event_type,
            "severity": ev.severity,
            "source": ev.source,
            "channel": ev.channel,
            "pot_id": str(ev.pot_id),
            "stack_id": str(ev.stack_id) if ev.stack_id else None,
            "service_name": ev.service_name,
            "payload": ev.payload,
            "raw_log": (ev.raw_log or "")[:4000] if ev.raw_log else None,
            "received_at": ev.received_at.isoformat() if ev.received_at else datetime.now(UTC).isoformat(),
            "enriched": True,
        }
    )
    return enrichment["status"] == "matched"


async def enrich_events(session: AsyncSession, event_ids: list[UUID], *, force: bool = False) -> int:
    if not event_ids:
        return 0
    cfg = await load_config(session)
    if not cfg.get("enabled", True):
        return 0
    rules = await _load_rules(session)
    result = await session.execute(select(Event).where(Event.id.in_(event_ids)))
    events = list(result.scalars().all())
    matched = 0
    for ev in events:
        try:
            if await enrich_event(session, ev, rules, cfg, force=force):
                matched += 1
        except Exception:
            log.exception("enrichment failed for event %s", ev.id)
    return matched


async def batch_reenrich(
    session: AsyncSession,
    *,
    lookback_hours: int = 24,
    limit: int = 200,
    pot_id: UUID | None = None,
    force: bool = False,
) -> tuple[int, int]:
    cfg = await load_config(session)
    if not cfg.get("enabled", True):
        return 0, 0
    limit = min(limit, int(cfg.get("max_events_per_batch") or 100))
    since = datetime.now(UTC) - timedelta(hours=lookback_hours)
    q = (
        select(Event)
        .where(Event.received_at >= since, Event.channel.in_(cfg.get("enrich_channels") or ["runtime"]))
        .order_by(Event.received_at.desc())
        .limit(limit)
    )
    if pot_id is not None:
        q = q.where(Event.pot_id == pot_id)
    result = await session.execute(q)
    events = list(result.scalars().all())
    rules = await _load_rules(session)
    matched = 0
    processed = 0
    for ev in events:
        if _should_skip_event(ev, cfg):
            continue
        existing = _existing_enrichment(ev.payload)
        if existing and existing.get("status") == "matched" and not force:
            continue
        processed += 1
        try:
            if await enrich_event(session, ev, rules, cfg, force=force):
                matched += 1
        except Exception:
            log.exception("batch re-enrich failed for event %s", ev.id)
    return processed, matched


def schedule_enrichment(event_ids: list[UUID]) -> None:
    """Fire-and-forget enrichment after event ingest."""

    async def _run() -> None:
        try:
            async with async_session_factory() as session:
                cfg = await load_config(session)
                if not cfg.get("enabled", True) or not cfg.get("auto_enrich_on_ingest", True):
                    return
                n = await enrich_events(session, event_ids)
                await commit_session(session)
                if n:
                    log.debug("enriched %s event(s) with threat matches", n)
        except Exception:
            log.exception("background enrichment failed")

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_run())
    except RuntimeError:
        pass
