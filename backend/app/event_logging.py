"""Emit rows into the unified `events` stream (agent payloads + control-plane actions)."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.forwarder import schedule_event_forward
from app.models.event import Event

CHANNEL_RUNTIME = "runtime"
CHANNEL_INFRA = "infra"
CHANNEL_CONTROL = "control"

SOURCE_CONTROL = "watchpot.control"
SOURCE_AGENT = "watchpot.agent"


async def emit_event(
    db: AsyncSession,
    *,
    pot_id: UUID,
    event_type: str,
    source: str,
    channel: str = CHANNEL_RUNTIME,
    severity: str = "info",
    stack_id: UUID | None = None,
    service_name: str | None = None,
    payload: dict | None = None,
    raw_log: str | None = None,
) -> None:
    db.add(
        Event(
            pot_id=pot_id,
            stack_id=stack_id,
            service_name=service_name,
            event_type=event_type,
            severity=severity,
            source=source,
            channel=channel,
            payload=payload,
            raw_log=raw_log,
        )
    )
    schedule_event_forward(
        {
            "event_type": event_type,
            "severity": severity,
            "source": source,
            "channel": channel,
            "pot_id": str(pot_id),
            "stack_id": str(stack_id) if stack_id else None,
            "service_name": service_name,
            "payload": payload,
            "raw_log": (raw_log or "")[:4000] if raw_log else None,
            "received_at": datetime.now(timezone.utc).isoformat(),
        }
    )
