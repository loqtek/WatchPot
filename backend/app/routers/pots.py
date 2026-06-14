from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit_service import write_audit
from app.config import get_env_settings
from app.database import get_db
from app.deps import get_current_user
from app.models.pot import Pot
from app.models.stack import Stack
from app.models.user import User
from app.event_logging import CHANNEL_CONTROL, SOURCE_CONTROL, emit_event
from app.schemas.pot import PotCreate, PotOut, PotUpdate, PotWithKey, build_pot_out
from app.schemas.pot_ops import PotDeleteOut
from app.security import generate_agent_key, hash_secret
from app.services.pot_teardown import pot_agent_online, queue_pot_teardown, wait_for_commands

router = APIRouter(prefix="/pots", tags=["pots"])


@router.get("", response_model=list[PotOut])
async def list_pots(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
) -> list[PotOut]:
    result = await db.execute(select(Pot).order_by(Pot.created_at.desc()))
    return [build_pot_out(p) for p in result.scalars().all()]


@router.post("", response_model=PotWithKey, status_code=status.HTTP_201_CREATED)
async def create_pot(
    request: Request,
    body: PotCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> PotWithKey:
    agent_key = generate_agent_key()
    pot = Pot(
        name=body.name,
        description=body.description,
        agent_key_hash=hash_secret(agent_key),
    )
    db.add(pot)
    await db.flush()
    await write_audit(
        db,
        action="pot.create",
        actor_user_id=user.id,
        resource_type="pot",
        resource_id=str(pot.id),
        detail={"name": body.name},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await emit_event(
        db,
        pot_id=pot.id,
        event_type="watchpot.pot.created",
        severity="info",
        source=SOURCE_CONTROL,
        channel=CHANNEL_CONTROL,
        payload={"name": body.name},
    )
    await db.refresh(pot)
    base = build_pot_out(pot)
    return PotWithKey(**base.model_dump(), agent_key=agent_key)


@router.get("/{pot_id}", response_model=PotOut)
async def get_pot(
    pot_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
) -> PotOut:
    result = await db.execute(select(Pot).where(Pot.id == pot_id))
    pot = result.scalar_one_or_none()
    if pot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pot not found")
    return build_pot_out(pot)


@router.patch("/{pot_id}", response_model=PotOut)
async def update_pot(
    request: Request,
    pot_id: UUID,
    body: PotUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> PotOut:
    result = await db.execute(select(Pot).where(Pot.id == pot_id))
    pot = result.scalar_one_or_none()
    if pot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pot not found")
    if body.name is not None:
        pot.name = body.name
    if body.description is not None:
        pot.description = body.description
    await db.flush()
    await write_audit(
        db,
        action="pot.update",
        actor_user_id=user.id,
        resource_type="pot",
        resource_id=str(pot_id),
        detail={"name": pot.name},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await emit_event(
        db,
        pot_id=pot_id,
        event_type="watchpot.pot.updated",
        severity="info",
        source=SOURCE_CONTROL,
        channel=CHANNEL_CONTROL,
        payload={"name": pot.name, "description": pot.description},
    )
    return build_pot_out(pot)


@router.post("/{pot_id}/rotate-agent-key", response_model=PotWithKey)
async def rotate_agent_key(
    request: Request,
    pot_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> PotWithKey:
    result = await db.execute(select(Pot).where(Pot.id == pot_id))
    pot = result.scalar_one_or_none()
    if pot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pot not found")
    agent_key = generate_agent_key()
    pot.agent_key_hash = hash_secret(agent_key)
    await db.flush()
    await write_audit(
        db,
        action="pot.rotate_agent_key",
        actor_user_id=user.id,
        resource_type="pot",
        resource_id=str(pot_id),
        detail={"name": pot.name},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await emit_event(
        db,
        pot_id=pot_id,
        event_type="watchpot.pot.agent_key_rotated",
        severity="info",
        source=SOURCE_CONTROL,
        channel=CHANNEL_CONTROL,
        payload={"name": pot.name},
    )
    return PotWithKey(**build_pot_out(pot).model_dump(), agent_key=agent_key)


@router.delete("/{pot_id}", response_model=PotDeleteOut)
async def delete_pot(
    request: Request,
    pot_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> PotDeleteOut:
    result = await db.execute(select(Pot).where(Pot.id == pot_id))
    pot = result.scalar_one_or_none()
    if pot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pot not found")
    snap = {"name": pot.name, "id": str(pot.id)}
    teardown_command_ids: list[UUID] = []
    if await pot_agent_online(db, pot_id):
        teardown_command_ids = await queue_pot_teardown(
            db,
            pot_id=pot_id,
            actor_user_id=user.id,
        )
        if teardown_command_ids:
            await db.commit()
            await wait_for_commands(db, teardown_command_ids)
    stacks_result = await db.execute(select(Stack).where(Stack.pot_id == pot_id))
    for stack in stacks_result.scalars().all():
        await db.delete(stack)
    await write_audit(
        db,
        action="pot.delete",
        actor_user_id=user.id,
        resource_type="pot",
        resource_id=str(pot_id),
        detail={**snap, "teardown_command_ids": [str(x) for x in teardown_command_ids]},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.delete(pot)
    return PotDeleteOut(teardown_command_ids=teardown_command_ids)


@router.post("/{pot_id}/heartbeat", response_model=PotOut)
async def simulate_heartbeat(
    pot_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
) -> PotOut:
    """Dev-only — real heartbeats come from the agent."""
    if not get_env_settings().enable_test_endpoints:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Not found",
        )
    result = await db.execute(select(Pot).where(Pot.id == pot_id))
    pot = result.scalar_one_or_none()
    if pot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pot not found")
    pot.last_heartbeat_at = datetime.now(timezone.utc)
    return build_pot_out(pot)
