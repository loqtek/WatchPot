"""Queue Docker teardown commands before control-plane deletes."""

from __future__ import annotations

import asyncio
import time
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.pot import Pot
from app.models.pot_command import PotCommand
from app.models.stack import Stack, StackRevision


async def queue_stack_teardown(
    session: AsyncSession,
    *,
    pot_id: UUID,
    stack_id: UUID,
    actor_user_id: UUID | None = None,
) -> UUID | None:
    """Queue compose_down when a stack has been deployed (has at least one revision)."""
    rev_result = await session.execute(
        select(func.max(StackRevision.revision)).where(StackRevision.stack_id == stack_id)
    )
    latest_rev = rev_result.scalar_one_or_none()
    if latest_rev is None:
        return None
    cmd = PotCommand(
        pot_id=pot_id,
        stack_id=stack_id,
        action="compose_down",
        status="pending",
        requested_by_user_id=actor_user_id,
    )
    session.add(cmd)
    await session.flush()
    return cmd.id


async def queue_pot_teardown(
    session: AsyncSession,
    *,
    pot_id: UUID,
    actor_user_id: UUID | None = None,
) -> list[UUID]:
    """Queue compose_down for every deployed stack on a pot (best-effort before pot delete)."""
    result = await session.execute(
        select(Stack)
        .options(selectinload(Stack.revisions))
        .where(Stack.pot_id == pot_id)
    )
    command_ids: list[UUID] = []
    for stack in result.scalars().unique().all():
        if not stack.revisions:
            continue
        cmd_id = await queue_stack_teardown(
            session,
            pot_id=pot_id,
            stack_id=stack.id,
            actor_user_id=actor_user_id,
        )
        if cmd_id is not None:
            command_ids.append(cmd_id)
    return command_ids


async def pot_agent_online(session: AsyncSession, pot_id: UUID) -> bool:
    result = await session.execute(select(Pot.last_heartbeat_at).where(Pot.id == pot_id))
    return result.scalar_one_or_none() is not None


async def wait_for_commands(
    session: AsyncSession,
    command_ids: list[UUID],
    *,
    timeout_sec: float = 45.0,
    poll_sec: float = 0.75,
) -> bool:
    """Poll until all commands finish or timeout. Returns True when all are terminal."""
    if not command_ids:
        return True
    deadline = time.monotonic() + timeout_sec
    pending = set(command_ids)
    while pending and time.monotonic() < deadline:
        result = await session.execute(select(PotCommand).where(PotCommand.id.in_(pending)))
        pending = {
            cmd.id
            for cmd in result.scalars().all()
            if cmd.status not in ("completed", "failed")
        }
        if pending:
            await asyncio.sleep(poll_sec)
    return not pending
