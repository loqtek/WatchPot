"""Non-blocking hook from emit_event into outbound integrations."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.integrations.dispatcher import forward_event_to_all

log = logging.getLogger("watchpot.integrations.forwarder")


def schedule_event_forward(event: dict[str, Any]) -> None:
    """Fire-and-forget forward; failures are logged only."""

    async def _run() -> None:
        try:
            await forward_event_to_all(event)
        except Exception:
            log.exception("event forward batch failed")

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_run())
    except RuntimeError:
        pass
