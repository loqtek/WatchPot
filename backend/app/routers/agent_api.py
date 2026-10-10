from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_env_settings
from app.database import get_db
from app.deps import get_agent_pot
from app.models.backup_artifact import BackupArtifact
from app.models.backup_job import BackupJob
from app.models.event import Event
from app.models.pot import Pot
from app.models.pot_command import PotCommand
from app.services.backup_artifacts import refresh_job_storage_location
from app.services.backup_store import server_artifact_path, write_verified_stream
from app.models.stack import Stack, StackRevision
from app.schemas.agent import AgentDesiredStack, AgentEventBatchIn, AgentHeartbeatIn
from app.schemas.pot_ops import AgentCommandComplete, AgentCommandProgress, PotCommandOut
from app.enrichment.command_capture import schedule_command_capture
from app.enrichment.ip_intel import schedule_ip_tracking
from app.enrichment.worker import schedule_enrichment
from app.services.pot_infra import merge_infra_into_meta

router = APIRouter(prefix="/agent/v1", tags=["agent"])


@router.get("/me")
async def agent_me(pot: Annotated[Pot, Depends(get_agent_pot)]) -> dict:
    return {"pot_id": str(pot.id), "name": pot.name}


@router.post("/heartbeat")
async def agent_heartbeat(
    request: Request,
    body: AgentHeartbeatIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    pot: Annotated[Pot, Depends(get_agent_pot)],
) -> dict:
    pot.last_heartbeat_at = datetime.now(timezone.utc)
    if request.client:
        pot.last_ip = request.client.host
    pot.agent_version = body.agent_version
    if body.meta:
        pot.meta = {**(pot.meta or {}), **body.meta}
    if body.docker_version:
        m = dict(pot.meta or {})
        m["docker_version"] = body.docker_version
        pot.meta = m
    return {"ok": True, "server_time": datetime.now(timezone.utc).isoformat()}


@router.get("/desired-state", response_model=list[AgentDesiredStack])
async def desired_state(
    db: Annotated[AsyncSession, Depends(get_db)],
    pot: Annotated[Pot, Depends(get_agent_pot)],
) -> list[AgentDesiredStack]:
    result = await db.execute(
        select(Stack)
        .options(selectinload(Stack.revisions))
        .where(Stack.pot_id == pot.id)
        .order_by(Stack.created_at.asc())
    )
    stacks = result.scalars().unique().all()
    desired: list[AgentDesiredStack] = []
    for stack in stacks:
        if not stack.revisions:
            continue
        latest = max(stack.revisions, key=lambda r: r.revision)
        desired.append(
            AgentDesiredStack(
                stack_id=stack.id,
                name=stack.name,
                revision=latest.revision,
                restart_generation=stack.restart_generation,
                compose_yaml=latest.compose_yaml,
            )
        )
    return desired


@router.post("/events")
async def ingest_events(
    body: AgentEventBatchIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    pot: Annotated[Pot, Depends(get_agent_pot)],
) -> dict:
    now = datetime.now(timezone.utc)
    new_ids: list[UUID] = []
    for item in body.events:
        ch = (item.channel or "").strip().lower() or "runtime"
        if ch not in ("runtime", "infra"):
            ch = "runtime"
        ev = Event(
            pot_id=pot.id,
            stack_id=item.stack_id,
            service_name=item.service_name,
            event_type=item.event_type,
            severity=item.severity,
            source=item.source,
            channel=ch,
            payload=item.payload,
            raw_log=item.raw_log,
        )
        db.add(ev)
        await db.flush()
        new_ids.append(ev.id)
        if item.event_type == "watchpot.agent.infra_snapshot" and item.payload:
            pot.meta = merge_infra_into_meta(pot.meta, item.payload, now)
    if new_ids:
        schedule_ip_tracking(new_ids)
        schedule_command_capture(new_ids)
        schedule_enrichment(new_ids)
    return {"ingested": len(body.events)}


@router.get("/pending-commands", response_model=list[PotCommandOut])
async def pending_commands(
    db: Annotated[AsyncSession, Depends(get_db)],
    pot: Annotated[Pot, Depends(get_agent_pot)],
) -> list[PotCommandOut]:
    result = await db.execute(
        select(PotCommand)
        .where(PotCommand.pot_id == pot.id, PotCommand.status == "pending")
        .order_by(PotCommand.created_at.asc())
        .limit(20)
    )
    return [PotCommandOut.model_validate(c) for c in result.scalars().all()]


@router.post("/commands/{command_id}/progress", response_model=PotCommandOut)
async def progress_command(
    command_id: UUID,
    body: AgentCommandProgress,
    db: Annotated[AsyncSession, Depends(get_db)],
    pot: Annotated[Pot, Depends(get_agent_pot)],
) -> PotCommandOut:
    """Append live output while a command is still running (used by long backups)."""
    result = await db.execute(
        select(PotCommand).where(PotCommand.id == command_id, PotCommand.pot_id == pot.id)
    )
    cmd = result.scalar_one_or_none()
    if cmd is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Command not found")
    if cmd.status in ("completed", "failed"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Command already finished")
    cmd.status = "running"
    cmd.output = (body.output or "")[:100_000] or None
    return PotCommandOut.model_validate(cmd)


@router.post("/commands/{command_id}/complete", response_model=PotCommandOut)
async def complete_command(
    command_id: UUID,
    body: AgentCommandComplete,
    db: Annotated[AsyncSession, Depends(get_db)],
    pot: Annotated[Pot, Depends(get_agent_pot)],
) -> PotCommandOut:
    result = await db.execute(
        select(PotCommand).where(PotCommand.id == command_id, PotCommand.pot_id == pot.id)
    )
    cmd = result.scalar_one_or_none()
    if cmd is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Command not found")
    cmd.status = body.status if body.status in ("completed", "failed") else "failed"
    cmd.output = (body.output or "")[:500_000] or None
    cmd.error = (body.error or "")[:8000] or None
    cmd.completed_at = datetime.now(timezone.utc)
    return PotCommandOut.model_validate(cmd)


@router.post("/backups/upload")
async def upload_backup_artifact(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    pot: Annotated[Pot, Depends(get_agent_pot)],
    file: UploadFile = File(...),
) -> dict:
    job_id_raw = request.headers.get("X-Backup-Job-Id", "").strip()
    artifact_id_raw = request.headers.get("X-Backup-Artifact-Id", "").strip()
    expected_sha = request.headers.get("X-Sha256", "").strip().lower()
    if not job_id_raw or not artifact_id_raw or not expected_sha:
        raise HTTPException(status_code=400, detail="X-Backup-Job-Id, X-Backup-Artifact-Id, and X-Sha256 required")

    try:
        job_id = UUID(job_id_raw)
        artifact_id = UUID(artifact_id_raw)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Invalid UUID in headers") from e

    job_result = await db.execute(select(BackupJob).where(BackupJob.id == job_id, BackupJob.pot_id == pot.id))
    job = job_result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Backup job not found for this pot")

    art_result = await db.execute(
        select(BackupArtifact).where(BackupArtifact.id == artifact_id, BackupArtifact.job_id == job_id)
    )
    artifact = art_result.scalar_one_or_none()
    if artifact is None:
        raise HTTPException(status_code=404, detail="Backup artifact not found")

    max_bytes = get_env_settings().max_backup_upload_bytes
    filename = file.filename or Path(artifact.agent_path or "backup.tar").name
    dest = server_artifact_path(pot.id, job_id, filename)
    size_bytes = 0

    async def iter_chunks():
        nonlocal size_bytes
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size_bytes += len(chunk)
            if size_bytes > max_bytes:
                dest.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=413,
                    detail=f"Upload exceeds maximum size ({max_bytes} bytes)",
                )
            yield chunk

    try:
        ok, msg = await write_verified_stream(dest, iter_chunks(), expected_sha)
    except HTTPException:
        raise
    if size_bytes == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Empty upload")
    if not ok:
        raise HTTPException(status_code=400, detail=msg)

    artifact.server_path = str(dest)
    artifact.transfer_sha256 = msg
    artifact.transfer_verified_at = datetime.now(timezone.utc)
    artifact.storage_location = "server"
    artifact.size_bytes = size_bytes
    job.server_artifact_path = str(dest)
    job.ingest_status = "verified"
    await refresh_job_storage_location(db, job)

    return {
        "ok": True,
        "artifact_id": str(artifact.id),
        "server_path": str(dest),
        "sha256": msg,
        "size_bytes": size_bytes,
        "storage_location": "server",
    }
