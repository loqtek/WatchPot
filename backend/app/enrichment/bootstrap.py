"""Seed built-in enrichment rules and default schedules."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.enrichment.default_rules import BUILTIN_RULES
from app.models.enrichment_rule import EnrichmentRule
from app.models.enrichment_schedule import EnrichmentSchedule

log = logging.getLogger("watchpot.enrichment.bootstrap")


async def ensure_builtin_rules(session: AsyncSession) -> int:
    """Seed built-in rules; add any new catalog rules missing from existing DBs."""
    result = await session.execute(select(EnrichmentRule.name))
    existing = {str(r[0]) for r in result.all()}
    added = 0
    for item in BUILTIN_RULES:
        if item["name"] in existing:
            continue
        session.add(
            EnrichmentRule(
                name=item["name"],
                description=item.get("description"),
                pattern=item["pattern"],
                pattern_type=item.get("pattern_type") or "regex",
                match_field=item.get("match_field") or "both",
                attack_type=item.get("attack_type"),
                tool=item.get("tool"),
                technique=item.get("technique"),
                cve_ids=item.get("cve_ids") or [],
                severity=item.get("severity"),
                enabled=True,
                priority=int(item.get("priority") or 50),
                is_builtin=True,
            )
        )
        added += 1
    if added:
        await session.flush()
        log.info("Seeded %s enrichment rules", added)
    return added


async def ensure_default_schedules(session: AsyncSession) -> int:
    result = await session.execute(select(EnrichmentSchedule.name, EnrichmentSchedule.job_type))
    existing = {(str(r[0]), str(r[1])) for r in result.all()}
    now = datetime.now(UTC)
    defaults = [
        ("Daily CVE cache sync", "cve_sync", 24, {"fetch_remote": True}),
        ("Hourly batch re-enrichment", "batch_reenrich", 1, {"lookback_hours": 2, "limit": 200, "force": False}),
        ("IP intelligence scan", "ip_scan", 6, {"lookback_hours": 24, "limit": 500}),
    ]
    added = 0
    for name, job_type, hours, cfg in defaults:
        if any(jt == job_type for _, jt in existing):
            continue
        sched = EnrichmentSchedule(
            name=name,
            job_type=job_type,
            interval_hours=hours,
            enabled=True,
            config=cfg,
            next_run_at=now + timedelta(hours=hours),
        )
        session.add(sched)
        added += 1
    if added:
        await session.flush()
        log.info("Seeded %s enrichment schedules", added)
    return added
