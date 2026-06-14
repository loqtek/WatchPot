from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit_service import write_audit
from app.database import get_db
from app.deps import get_current_user
from app.models.pot import Pot
from app.models.stack import Stack, StackRevision
from app.models.user import User
from app.event_logging import CHANNEL_CONTROL, SOURCE_CONTROL, emit_event
from app.schemas.stack import StackCreate, StackDeleteOut, StackOut, StackRevisionCreate, StackRevisionOut, StackUpdate
from app.services.pot_teardown import pot_agent_online, queue_stack_teardown

router = APIRouter(prefix="/pots/{pot_id}/stacks", tags=["stacks"])


async def _get_pot(db: AsyncSession, pot_id: UUID) -> Pot:
    result = await db.execute(select(Pot).where(Pot.id == pot_id))
    pot = result.scalar_one_or_none()
    if pot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pot not found")
    return pot


@router.get("", response_model=list[StackOut])
async def list_stacks(
    pot_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
) -> list[StackOut]:
    await _get_pot(db, pot_id)
    subq = (
        select(StackRevision.stack_id, func.max(StackRevision.revision).label("max_rev"))
        .group_by(StackRevision.stack_id)
        .subquery()
    )
    q = (
        select(Stack, subq.c.max_rev)
        .outerjoin(subq, Stack.id == subq.c.stack_id)
        .where(Stack.pot_id == pot_id)
        .order_by(Stack.created_at.desc())
    )
    result = await db.execute(q)
    rows = result.all()
    out: list[StackOut] = []
    for stack, max_rev in rows:
        so = StackOut.model_validate(stack)
        so.latest_revision = int(max_rev) if max_rev is not None else None
        out.append(so)
    return out


@router.post("", response_model=StackOut, status_code=status.HTTP_201_CREATED)
async def create_stack(
    request: Request,
    pot_id: UUID,
    body: StackCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> StackOut:
    await _get_pot(db, pot_id)
    stack = Stack(pot_id=pot_id, name=body.name, description=body.description)
    db.add(stack)
    await db.flush()
    await write_audit(
        db,
        action="stack.create",
        actor_user_id=user.id,
        resource_type="stack",
        resource_id=str(stack.id),
        detail={"pot_id": str(pot_id), "name": body.name},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await emit_event(
        db,
        pot_id=pot_id,
        stack_id=stack.id,
        event_type="watchpot.stack.created",
        severity="info",
        source=SOURCE_CONTROL,
        channel=CHANNEL_CONTROL,
        payload={"name": body.name, "stack_id": str(stack.id)},
    )
    out = StackOut.model_validate(stack)
    out.latest_revision = None
    return out


@router.post("/{stack_id}/revisions", response_model=StackRevisionOut, status_code=status.HTTP_201_CREATED)
async def add_revision(
    request: Request,
    pot_id: UUID,
    stack_id: UUID,
    body: StackRevisionCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> StackRevision:
    await _get_pot(db, pot_id)
    result = await db.execute(select(Stack).where(Stack.id == stack_id, Stack.pot_id == pot_id))
    stack = result.scalar_one_or_none()
    if stack is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stack not found")
    rev_result = await db.execute(select(func.coalesce(func.max(StackRevision.revision), 0)).where(StackRevision.stack_id == stack_id))
    max_rev = int(rev_result.scalar_one())
    rev = StackRevision(
        stack_id=stack_id,
        revision=max_rev + 1,
        compose_yaml=body.compose_yaml,
        note=body.note,
        created_by_user_id=user.id,
    )
    db.add(rev)
    await db.flush()
    await write_audit(
        db,
        action="stack.revision.create",
        actor_user_id=user.id,
        resource_type="stack",
        resource_id=str(stack_id),
        detail={"revision": rev.revision},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await emit_event(
        db,
        pot_id=pot_id,
        stack_id=stack_id,
        event_type="watchpot.stack.revision_pushed",
        severity="info",
        source=SOURCE_CONTROL,
        channel=CHANNEL_CONTROL,
        payload={"revision": rev.revision, "note": rev.note},
    )
    return rev


@router.patch("/{stack_id}", response_model=StackOut)
async def update_stack(
    request: Request,
    pot_id: UUID,
    stack_id: UUID,
    body: StackUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> StackOut:
    await _get_pot(db, pot_id)
    result = await db.execute(select(Stack).where(Stack.id == stack_id, Stack.pot_id == pot_id))
    stack = result.scalar_one_or_none()
    if stack is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stack not found")
    if body.name is not None:
        stack.name = body.name
    if body.description is not None:
        stack.description = body.description
    await db.flush()
    await write_audit(
        db,
        action="stack.update",
        actor_user_id=user.id,
        resource_type="stack",
        resource_id=str(stack_id),
        detail={"name": stack.name},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await emit_event(
        db,
        pot_id=pot_id,
        stack_id=stack_id,
        event_type="watchpot.stack.updated",
        severity="info",
        source=SOURCE_CONTROL,
        channel=CHANNEL_CONTROL,
        payload={"name": stack.name},
    )
    rev_result = await db.execute(select(func.max(StackRevision.revision)).where(StackRevision.stack_id == stack_id))
    mr = rev_result.scalar_one()
    out = StackOut.model_validate(stack)
    out.latest_revision = int(mr) if mr is not None else None
    return out


@router.delete("/{stack_id}", response_model=StackDeleteOut)
async def delete_stack(
    request: Request,
    pot_id: UUID,
    stack_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> StackDeleteOut:
    await _get_pot(db, pot_id)
    result = await db.execute(select(Stack).where(Stack.id == stack_id, Stack.pot_id == pot_id))
    stack = result.scalar_one_or_none()
    if stack is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stack not found")
    snap = {"name": stack.name, "stack_id": str(stack_id)}
    teardown_command_id: UUID | None = None
    if await pot_agent_online(db, pot_id):
        teardown_command_id = await queue_stack_teardown(
            db,
            pot_id=pot_id,
            stack_id=stack_id,
            actor_user_id=user.id,
        )
    await write_audit(
        db,
        action="stack.delete",
        actor_user_id=user.id,
        resource_type="stack",
        resource_id=str(stack_id),
        detail={**snap, "teardown_command_id": str(teardown_command_id) if teardown_command_id else None},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await emit_event(
        db,
        pot_id=pot_id,
        stack_id=stack_id,
        event_type="watchpot.stack.deleted",
        severity="warning",
        source=SOURCE_CONTROL,
        channel=CHANNEL_CONTROL,
        payload=snap,
    )
    await db.delete(stack)
    return StackDeleteOut(teardown_command_id=teardown_command_id)


@router.post("/{stack_id}/restart", response_model=StackOut)
async def restart_stack(
    request: Request,
    pot_id: UUID,
    stack_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> StackOut:
    await _get_pot(db, pot_id)
    result = await db.execute(select(Stack).where(Stack.id == stack_id, Stack.pot_id == pot_id))
    stack = result.scalar_one_or_none()
    if stack is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stack not found")
    stack.restart_generation = (stack.restart_generation or 0) + 1
    await db.flush()
    await write_audit(
        db,
        action="stack.restart",
        actor_user_id=user.id,
        resource_type="stack",
        resource_id=str(stack_id),
        detail={"restart_generation": stack.restart_generation},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await emit_event(
        db,
        pot_id=pot_id,
        stack_id=stack_id,
        event_type="watchpot.stack.restart_requested",
        severity="info",
        source=SOURCE_CONTROL,
        channel=CHANNEL_CONTROL,
        payload={"restart_generation": stack.restart_generation},
    )
    rev_result = await db.execute(select(func.max(StackRevision.revision)).where(StackRevision.stack_id == stack_id))
    mr = rev_result.scalar_one()
    out = StackOut.model_validate(stack)
    out.latest_revision = int(mr) if mr is not None else None
    return out


@router.get("/{stack_id}/revisions", response_model=list[StackRevisionOut])
async def list_revisions(
    pot_id: UUID,
    stack_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
) -> list[StackRevision]:
    await _get_pot(db, pot_id)
    result = await db.execute(
        select(StackRevision)
        .where(StackRevision.stack_id == stack_id)
        .join(Stack, Stack.id == StackRevision.stack_id)
        .where(Stack.pot_id == pot_id)
        .order_by(StackRevision.revision.desc())
    )
    return list(result.scalars().all())


@router.get("/{stack_id}/revisions/{revision}", response_model=StackRevisionOut)
async def get_revision(
    pot_id: UUID,
    stack_id: UUID,
    revision: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
) -> StackRevision:
    await _get_pot(db, pot_id)
    result = await db.execute(
        select(StackRevision)
        .join(Stack, Stack.id == StackRevision.stack_id)
        .where(
            StackRevision.stack_id == stack_id,
            StackRevision.revision == revision,
            Stack.pot_id == pot_id,
        )
    )
    rev = result.scalar_one_or_none()
    if rev is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Revision not found")
    return rev
