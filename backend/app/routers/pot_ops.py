from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.audit_service import write_audit
from app.database import get_db
from app.deps import get_current_user
from app.models.pot import Pot
from app.models.pot_command import PotCommand
from app.models.stack import Stack
from app.models.user import User
from app.schemas.pot_ops import (
    PotCommandCreate,
    PotCommandOut,
    PotContainerOut,
    PotInfraOut,
    PotStatsOut,
)
from app.services import analytics_events as ax
from app.services.pot_infra import (
    infra_from_pot_meta,
    latest_infra_from_events,
    load_pot_stacks,
    parse_command_params,
    serialize_command_params,
)

router = APIRouter(prefix="/pots/{pot_id}", tags=["pot-ops"])

ALLOWED_ACTIONS = frozenset(
    {
        "logs",
        "start",
        "stop",
        "restart",
        "kill",
        "rm",
        "exec",
        "compose_start",
        "compose_stop",
        "compose_restart",
        "compose_down",
    }
)

COMPOSE_ACTIONS = frozenset({"compose_start", "compose_stop", "compose_restart", "compose_down"})


async def _get_pot(db: AsyncSession, pot_id: UUID) -> Pot:
    result = await db.execute(select(Pot).where(Pot.id == pot_id))
    pot = result.scalar_one_or_none()
    if pot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pot not found")
    return pot


@router.get("/stats", response_model=PotStatsOut)
async def pot_stats(
    pot_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    range_key: str = Query("24h", alias="range"),
) -> PotStatsOut:
    await _get_pot(db, pot_id)
    if range_key not in ("1h", "24h", "7d", "30d"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid range")

    summary = await ax.summary(db, range_key=range_key, pot_id=pot_id)
    stacks_result = await db.execute(
        select(Stack).options(selectinload(Stack.revisions)).where(Stack.pot_id == pot_id)
    )
    stacks = list(stacks_result.scalars().unique().all())
    with_rev = sum(1 for s in stacks if s.revisions)

    pot_row = await db.execute(select(Pot).where(Pot.id == pot_id))
    pot = pot_row.scalar_one()
    infra = infra_from_pot_meta(pot.meta, stacks)
    running = sum(1 for c in infra.containers if "up" in c.state.lower() or "running" in c.status.lower())
    docker_ok = None
    hostname = infra.hostname
    if pot.meta and isinstance(pot.meta.get("docker_ok"), bool):
        docker_ok = pot.meta["docker_ok"]
    elif infra.docker_info_ok is not None:
        docker_ok = infra.docker_info_ok

    by_stack = await ax.events_by_stack(db, range_key=range_key, limit=20)
    pot_stacks = {str(s.id): s.name for s in stacks}
    events_by_stack = [
        {
            "stack_id": row["stack_id"],
            "stack_name": row.get("name") or pot_stacks.get(row["stack_id"], "—"),
            "count": row["count"],
        }
        for row in by_stack
        if row.get("stack_id")
    ]

    return PotStatsOut(
        range=range_key,
        events_total=summary["total"],
        events_per_hour=summary["rate_per_hour"],
        stacks_total=len(stacks),
        stacks_with_revision=with_rev,
        containers_running=running,
        containers_total=len(infra.containers),
        docker_ok=docker_ok,
        hostname=hostname,
        infra_at=infra.snapshot_at,
        by_severity=summary["by_severity"],
        by_event_type=summary["by_event_type"][:12],
        events_by_stack=events_by_stack,
    )


@router.get("/infra", response_model=PotInfraOut)
async def pot_infra(
    pot_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
) -> PotInfraOut:
    pot = await _get_pot(db, pot_id)
    stacks = await load_pot_stacks(db, pot_id)
    infra = infra_from_pot_meta(pot.meta, stacks)
    if infra.containers or infra.snapshot_at:
        return infra
    fallback = await latest_infra_from_events(db, pot_id, stacks)
    return fallback or PotInfraOut(
        snapshot_at=None,
        docker_ps_ok=None,
        docker_info_ok=None,
        hostname=None,
        system=None,
        containers=[],
    )


@router.get("/containers/{container_name}/logs/cached")
async def cached_container_logs(
    pot_id: UUID,
    container_name: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
) -> dict:
    """Return the latest agent-ingested log tail for a container (no round-trip to the pot)."""
    from app.models.event import Event

    await _get_pot(db, pot_id)
    name = container_name.strip().lstrip("/")
    result = await db.execute(
        select(Event)
        .where(
            Event.pot_id == pot_id,
            Event.event_type == "watchpot.agent.container_logs",
            Event.channel == "runtime",
        )
        .order_by(Event.received_at.desc())
        .limit(50)
    )
    for ev in result.scalars().all():
        svc = (ev.service_name or "").lstrip("/")
        payload = ev.payload if isinstance(ev.payload, dict) else {}
        pc = str(payload.get("container") or "").lstrip("/")
        if name in (svc, pc) or svc.endswith(name) or name.endswith(svc):
            return {
                "container": name,
                "raw_log": (ev.raw_log or "")[:12000],
                "received_at": ev.received_at.isoformat(),
                "cached": True,
            }
    return {"container": name, "raw_log": None, "received_at": None, "cached": False}


@router.get("/containers", response_model=list[PotContainerOut])
async def list_containers(
    pot_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[PotContainerOut]:
    pot = await _get_pot(db, pot_id)
    stacks = await load_pot_stacks(db, pot_id)
    infra = infra_from_pot_meta(pot.meta, stacks)
    if not infra.containers and not infra.snapshot_at:
        fallback = await latest_infra_from_events(db, pot_id, stacks)
        if fallback:
            infra = fallback
    return infra.containers


@router.get("/commands", response_model=list[PotCommandOut])
async def list_commands(
    pot_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    limit: int = Query(30, le=100),
) -> list[PotCommandOut]:
    await _get_pot(db, pot_id)
    result = await db.execute(
        select(PotCommand)
        .where(PotCommand.pot_id == pot_id)
        .order_by(PotCommand.created_at.desc())
        .limit(limit)
    )
    return [PotCommandOut.model_validate(c) for c in result.scalars().all()]


@router.get("/commands/{command_id}", response_model=PotCommandOut)
async def get_command(
    pot_id: UUID,
    command_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
) -> PotCommandOut:
    result = await db.execute(
        select(PotCommand).where(PotCommand.id == command_id, PotCommand.pot_id == pot_id)
    )
    cmd = result.scalar_one_or_none()
    if cmd is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Command not found")
    return PotCommandOut.model_validate(cmd)


@router.post("/commands", response_model=PotCommandOut, status_code=status.HTTP_201_CREATED)
async def create_command(
    pot_id: UUID,
    body: PotCommandCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> PotCommandOut:
    action = body.action.strip().lower()
    if action not in ALLOWED_ACTIONS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown action: {action}")

    pot = await _get_pot(db, pot_id)

    if action in COMPOSE_ACTIONS:
        if body.stack_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="stack_id required for compose actions")
        stack_result = await db.execute(
            select(Stack).where(Stack.id == body.stack_id, Stack.pot_id == pot_id)
        )
        if stack_result.scalar_one_or_none() is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stack not found on this pot")
    elif action in ("logs", "start", "stop", "restart", "kill", "rm", "exec"):
        if not body.container:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="container required")

    cmd = PotCommand(
        pot_id=pot_id,
        stack_id=body.stack_id,
        action=action,
        container=body.container,
        params=serialize_command_params(body.tail, body.command, body.params),
        status="pending",
        requested_by_user_id=user.id,
    )
    db.add(cmd)
    await db.flush()
    await write_audit(
        db,
        action="pot.command",
        actor_user_id=user.id,
        resource_type="pot_command",
        resource_id=str(cmd.id),
        detail={"pot_id": str(pot_id), "action": action, "container": body.container},
    )
    return PotCommandOut.model_validate(cmd)


@router.post("/refresh-infra", status_code=status.HTTP_202_ACCEPTED)
async def request_infra_refresh(
    pot_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    """Queue a lightweight ps snapshot — agent picks it up as a command."""
    pot = await _get_pot(db, pot_id)
    if not pot.last_heartbeat_at:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Pot has never sent a heartbeat")
    cmd = PotCommand(
        pot_id=pot_id,
        action="infra_refresh",
        status="pending",
        requested_by_user_id=user.id,
    )
    db.add(cmd)
    await db.flush()
    return {"command_id": str(cmd.id), "status": "pending"}
