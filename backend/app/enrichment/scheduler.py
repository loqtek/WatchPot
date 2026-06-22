"""Background scheduler for enrichment jobs (CVE sync, batch re-enrichment)."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session_factory, commit_session
from app.enrichment.cve import sync_cve_cache
from app.enrichment.ip_intel import scan_events_for_ips
from app.enrichment.worker import batch_reenrich
from app.models.enrichment_schedule import EnrichmentSchedule

log = logging.getLogger("watchpot.enrichment.scheduler")

POLL_INTERVAL_SEC = 60


def schedule_next_run(sched: EnrichmentSchedule, *, from_time: datetime | None = None) -> datetime:
    base = from_time or datetime.now(UTC)
    return base + timedelta(hours=max(1, sched.interval_hours))


async def run_schedule(session: AsyncSession, sched: EnrichmentSchedule) -> str:
    now = datetime.now(UTC)
    cfg = sched.config if isinstance(sched.config, dict) else {}
    try:
        if sched.job_type == "cve_sync":
            fetch_remote = bool(cfg.get("fetch_remote", True))
            _, msg = await sync_cve_cache(session, fetch_remote=fetch_remote)
            sched.last_status = "completed"
            sched.last_message = msg
        elif sched.job_type == "ip_scan":
            lookback = int(cfg.get("lookback_hours") or 168)
            limit = int(cfg.get("limit") or 500)
            events, ips = await scan_events_for_ips(session, lookback_hours=lookback, limit=limit)
            sched.last_status = "completed"
            sched.last_message = f"scanned {events} events, {ips} IP hits"
        elif sched.job_type == "batch_reenrich":
            lookback = int(cfg.get("lookback_hours") or 24)
            limit = int(cfg.get("limit") or 200)
            pot_raw = cfg.get("pot_id")
            pot_id = UUID(str(pot_raw)) if pot_raw else None
            force = bool(cfg.get("force", False))
            processed, matched = await batch_reenrich(
                session,
                lookback_hours=lookback,
                limit=limit,
                pot_id=pot_id,
                force=force,
            )
            sched.last_status = "completed"
            sched.last_message = f"processed {processed}, matched {matched}"
        else:
            sched.last_status = "failed"
            sched.last_message = f"unknown job_type: {sched.job_type}"
    except Exception as e:
        sched.last_status = "failed"
        sched.last_message = str(e)[:2000]
        log.exception("enrichment schedule %s failed", sched.id)
        raise e
    finally:
        sched.last_run_at = now
        sched.next_run_at = schedule_next_run(sched, from_time=now)
    return sched.last_message or ""


async def run_due_schedules(session: AsyncSession) -> int:
    now = datetime.now(UTC)
    result = await session.execute(
        select(EnrichmentSchedule).where(
            EnrichmentSchedule.enabled.is_(True),
            EnrichmentSchedule.next_run_at.is_not(None),
            EnrichmentSchedule.next_run_at <= now,
        )
    )
    schedules = list(result.scalars().all())
    for sched in schedules:
        await run_schedule(session, sched)
    return len(schedules)


async def enrichment_scheduler_loop() -> None:
    # Offset from backup_scheduler_loop so both do not write on the same tick.
    await asyncio.sleep(POLL_INTERVAL_SEC // 2)
    while True:
        try:
            await asyncio.sleep(POLL_INTERVAL_SEC)
            async with async_session_factory() as session:
                n = await run_due_schedules(session)
                await commit_session(session)
                if n:
                    log.info("ran %s enrichment schedule(s)", n)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("enrichment scheduler tick failed")
