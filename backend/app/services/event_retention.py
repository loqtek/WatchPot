"""Drop the oldest events once the stored count exceeds the operator cap."""

from __future__ import annotations

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event
from app.runtime_config import get_event_retention_max

_BATCH = 5_000
_MAX_BATCHES = 20


def rows_to_drop(total: int, cap: int, *, batch: int = _BATCH) -> int:
    if total <= cap:
        return 0
    return min(total - cap, batch)


async def enforce_event_retention(session: AsyncSession) -> int:
    """Delete oldest events until the table is within the cap. Returns rows removed."""
    cap = get_event_retention_max()
    deleted = 0
    for _ in range(_MAX_BATCHES):
        total = int(await session.scalar(select(func.count()).select_from(Event)) or 0)
        batch = rows_to_drop(total, cap)
        if batch <= 0:
            break
        oldest = (
            select(Event.id)
            .order_by(Event.received_at.asc(), Event.id.asc())
            .limit(batch)
            .subquery()
        )
        result = await session.execute(delete(Event).where(Event.id.in_(select(oldest.c.id))))
        removed = int(result.rowcount or 0)
        deleted += removed
        if removed == 0:
            break
    return deleted
