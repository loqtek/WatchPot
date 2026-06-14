"""Parse agent infra snapshots and map containers to watchPot stacks."""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.pot import Pot
from app.models.stack import Stack
from app.schemas.pot_ops import PotContainerOut, PotInfraOut

_INFRA_EVENT = "watchpot.agent.infra_snapshot"


def _stack_project_suffix(stack_id: UUID) -> str:
    return str(stack_id).replace("-", "")[:12]


def _container_row(raw: dict[str, Any], stacks: list[Stack]) -> PotContainerOut:
    cid = str(raw.get("ID") or raw.get("Id") or "")
    name = str(raw.get("Names") or raw.get("Name") or "").lstrip("/")
    image = str(raw.get("Image") or "")
    status = str(raw.get("Status") or "")
    state = str(raw.get("State") or "")
    ports = str(raw.get("Ports") or "")
    labels = raw.get("Labels") or ""
    project = None
    if isinstance(labels, str) and "com.docker.compose.project" in labels:
        m = re.search(r"com\.docker\.compose\.project=([^,]+)", labels)
        if m:
            project = m.group(1)
    stack_id: str | None = None
    stack_name: str | None = None
    for s in stacks:
        suffix = _stack_project_suffix(s.id)
        if project and suffix in project:
            stack_id = str(s.id)
            stack_name = s.name
            break
    return PotContainerOut(
        id=cid[:12] if cid else name,
        name=name,
        image=image,
        status=status,
        state=state,
        ports=ports,
        stack_id=stack_id,
        stack_name=stack_name,
        project=project,
        created=str(raw.get("CreatedAt") or raw.get("Created") or "") or None,
    )


def infra_from_pot_meta(meta: dict | None, stacks: list[Stack]) -> PotInfraOut:
    if not meta:
        return PotInfraOut(
            snapshot_at=None,
            docker_ps_ok=None,
            docker_info_ok=None,
            hostname=None,
            system=None,
            containers=[],
        )
    snap = meta.get("infra_snapshot")
    if not isinstance(snap, dict):
        return PotInfraOut(
            snapshot_at=None,
            docker_ps_ok=None,
            docker_info_ok=None,
            hostname=None,
            system=None,
            containers=[],
        )
    at_raw = snap.get("at")
    snapshot_at = None
    if at_raw:
        try:
            snapshot_at = datetime.fromisoformat(str(at_raw).replace("Z", "+00:00"))
        except ValueError:
            pass
    containers_raw = snap.get("containers") if isinstance(snap.get("containers"), list) else []
    rows = [_container_row(c, stacks) for c in containers_raw if isinstance(c, dict)]
    return PotInfraOut(
        snapshot_at=snapshot_at,
        docker_ps_ok=snap.get("docker_ps_ok"),
        docker_info_ok=snap.get("docker_info_ok"),
        hostname=snap.get("hostname"),
        system=snap.get("system"),
        containers=rows,
    )


async def latest_infra_from_events(
    session: AsyncSession, pot_id: UUID, stacks: list[Stack]
) -> PotInfraOut | None:
    from app.models.event import Event

    result = await session.execute(
        select(Event)
        .where(Event.pot_id == pot_id, Event.event_type == _INFRA_EVENT, Event.channel == "infra")
        .order_by(Event.received_at.desc())
        .limit(1)
    )
    ev = result.scalar_one_or_none()
    if ev is None or not ev.payload:
        return None
    payload = ev.payload
    containers_raw = payload.get("containers") if isinstance(payload.get("containers"), list) else []
    rows = [_container_row(c, stacks) for c in containers_raw if isinstance(c, dict)]
    return PotInfraOut(
        snapshot_at=ev.received_at,
        docker_ps_ok=payload.get("docker_ps_ok"),
        docker_info_ok=payload.get("docker_info_ok"),
        hostname=payload.get("hostname"),
        system=payload.get("system"),
        containers=rows,
    )


async def load_pot_stacks(session: AsyncSession, pot_id: UUID) -> list[Stack]:
    result = await session.execute(select(Stack).where(Stack.pot_id == pot_id))
    return list(result.scalars().all())


def merge_infra_into_meta(meta: dict | None, payload: dict, received_at: datetime) -> dict:
    base = dict(meta or {})
    base["infra_snapshot"] = {
        "at": received_at.isoformat(),
        "docker_ps_ok": payload.get("docker_ps_ok"),
        "docker_info_ok": payload.get("docker_info_ok"),
        "hostname": payload.get("hostname"),
        "system": payload.get("system"),
        "containers": payload.get("containers") or [],
    }
    return base


def serialize_command_params(create_tail: int, command: str | None, extra: dict | None) -> str | None:
    data: dict[str, Any] = {}
    if create_tail != 200:
        data["tail"] = create_tail
    if command:
        data["command"] = command
    if extra:
        data.update(extra)
    return json.dumps(data) if data else None


def parse_command_params(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}
