"""Background poller for due backup schedules."""

from __future__ import annotations

import asyncio
import logging

from app.database import async_session_factory
from app.services.backup_jobs import run_due_schedules

log = logging.getLogger("watchpot.backup_scheduler")

POLL_INTERVAL_SEC = 60


async def backup_scheduler_loop() -> None:
    while True:
        try:
            await asyncio.sleep(POLL_INTERVAL_SEC)
            async with async_session_factory() as session:
                n = await run_due_schedules(session)
                await session.commit()
                if n:
                    log.info("queued %s scheduled backup(s)", n)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("backup scheduler tick failed")
