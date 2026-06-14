from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models.event import Event
from app.models.user import User

router = APIRouter(prefix="/events", tags=["events"])

DEFAULT_POT_CHANNELS = frozenset({"runtime", "infra"})


@router.get("")
async def list_events(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    pot_id: UUID | None = None,
    channels: str | None = Query(
        default=None,
        description="Comma-separated: runtime, infra, control. Omit for default (runtime+infra). Use 'all' for no filter.",
    ),
    event_type_prefix: str | None = Query(default=None, description="Filter event_type startswith"),
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
    include_raw: bool = Query(default=False, description="Include raw_log (truncated)"),
    enriched_only: bool = Query(default=False, description="Only events with threat enrichment matches"),
    attack_type: str | None = Query(default=None, description="Filter by enrichment attack_type"),
) -> list[dict]:
    q = select(Event).order_by(Event.received_at.desc()).limit(limit).offset(offset)
    if pot_id:
        q = q.where(Event.pot_id == pot_id)

    ch_raw = (channels or "").strip().lower()
    if ch_raw and ch_raw != "all":
        parts = {p.strip() for p in ch_raw.split(",") if p.strip()}
        if parts:
            q = q.where(Event.channel.in_(parts))
    elif not ch_raw:
        q = q.where(Event.channel.in_(DEFAULT_POT_CHANNELS))

    if event_type_prefix:
        q = q.where(Event.event_type.startswith(event_type_prefix))

    result = await db.execute(q)
    events = result.scalars().all()
    out: list[dict] = []
    for e in events:
        if enriched_only or attack_type:
            enr = (e.payload or {}).get("enrichment") if isinstance(e.payload, dict) else None
            if enriched_only:
                if not isinstance(enr, dict) or enr.get("status") not in ("matched", "low_confidence"):
                    continue
            if attack_type:
                types = enr.get("attack_types") if isinstance(enr, dict) else []
                if attack_type not in (types or []):
                    continue
        row: dict = {
            "id": str(e.id),
            "pot_id": str(e.pot_id),
            "stack_id": str(e.stack_id) if e.stack_id else None,
            "service_name": e.service_name,
            "event_type": e.event_type,
            "severity": e.severity,
            "channel": e.channel,
            "source": e.source,
            "payload": e.payload,
            "received_at": e.received_at.isoformat(),
        }
        if include_raw and e.raw_log:
            row["raw_log"] = e.raw_log[:4000] + ("…" if len(e.raw_log) > 4000 else "")
        elif include_raw:
            row["raw_log"] = None
        out.append(row)
    return out
