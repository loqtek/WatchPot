from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit_service import write_audit
from app.database import get_db
from app.deps import get_current_user
from app.models.backup_artifact import BackupArtifact
from app.models.backup_job import BackupJob
from app.models.backup_schedule import BackupSchedule
from app.models.pot import Pot
from app.models.user import User
from app.schemas.backup import (
    BackupArtifactOut,
    BackupJobCreate,
    BackupJobOut,
    BackupScheduleCreate,
    BackupScheduleOut,
    BackupScheduleUpdate,
)
from app.services.backup_artifacts import list_artifacts
from app.services.backup_jobs import (
    queue_backup_job,
    queue_ingest_to_server,
    schedule_next_run,
    sync_backup_job_from_command,
    sync_ingest_from_command,
)
from app.services.backup_store import resolve_artifact_download_path

router = APIRouter(prefix="/backups", tags=["backups"])


async def _pot_map(db: AsyncSession) -> dict[UUID, str]:
    result = await db.execute(select(Pot.id, Pot.name))
    return {row[0]: row[1] for row in result.all()}


async def _job_out(db: AsyncSession, job: BackupJob, pot_names: dict[UUID, str]) -> BackupJobOut:
    artifacts = await list_artifacts(db, job.id)
    data = BackupJobOut.model_validate(job)
    return data.model_copy(
        update={
            "pot_name": pot_names.get(job.pot_id),
            "artifacts": [BackupArtifactOut.model_validate(a) for a in artifacts],
        }
    )


def _sched_out(sched: BackupSchedule, pot_names: dict[UUID, str]) -> BackupScheduleOut:
    data = BackupScheduleOut.model_validate(sched)
    return data.model_copy(update={"pot_name": pot_names.get(sched.pot_id)})


@router.get("/jobs", response_model=list[BackupJobOut])
async def list_backup_jobs(
    _: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    pot_id: UUID | None = None,
    limit: int = Query(100, ge=1, le=500),
) -> list[BackupJobOut]:
    q = select(BackupJob).order_by(BackupJob.created_at.desc()).limit(limit)
    if pot_id is not None:
        q = q.where(BackupJob.pot_id == pot_id)
    result = await db.execute(q)
    jobs = list(result.scalars().all())
    pot_names = await _pot_map(db)
    synced: list[BackupJob] = []
    for job in jobs:
        synced.append(await sync_backup_job_from_command(db, job))
        synced[-1] = await sync_ingest_from_command(db, synced[-1])
    out: list[BackupJobOut] = []
    for j in synced:
        out.append(await _job_out(db, j, pot_names))
    return out


@router.post("/jobs", response_model=BackupJobOut, status_code=status.HTTP_201_CREATED)
async def create_backup_job(
    request: Request,
    body: BackupJobCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> BackupJobOut:
    btype = body.backup_type.strip().lower()
    if btype not in ("container", "pot"):
        raise HTTPException(status_code=400, detail="backup_type must be container or pot")
    if btype == "container" and not (body.container or "").strip():
        raise HTTPException(status_code=400, detail="container is required for container backups")

    pot = await db.execute(select(Pot).where(Pot.id == body.pot_id))
    if pot.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Pot not found")

    try:
        job = await queue_backup_job(
            db,
            name=body.name.strip(),
            backup_type=btype,
            pot_id=body.pot_id,
            container=body.container,
            user_id=user.id,
            export_tar=body.export_tar,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    await write_audit(
        db,
        action="backup.queue",
        actor_user_id=user.id,
        resource_type="backup_job",
        resource_id=str(job.id),
        detail={"pot_id": str(body.pot_id), "backup_type": btype, "container": body.container},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    pot_names = await _pot_map(db)
    return await _job_out(db, job, pot_names)


@router.get("/jobs/{job_id}", response_model=BackupJobOut)
async def get_backup_job(
    job_id: UUID,
    _: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> BackupJobOut:
    result = await db.execute(select(BackupJob).where(BackupJob.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Backup job not found")
    job = await sync_backup_job_from_command(db, job)
    job = await sync_ingest_from_command(db, job)
    pot_names = await _pot_map(db)
    return await _job_out(db, job, pot_names)


@router.post("/jobs/{job_id}/ingest", response_model=BackupJobOut)
async def ingest_job_to_server(
    job_id: UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> BackupJobOut:
    result = await db.execute(select(BackupJob).where(BackupJob.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Backup job not found")
    job = await sync_backup_job_from_command(db, job)
    if job.status != "completed":
        raise HTTPException(status_code=409, detail="Backup must complete before copying to server")
    try:
        job = await queue_ingest_to_server(db, job, user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    pot_names = await _pot_map(db)
    return await _job_out(db, job, pot_names)


@router.get("/artifacts/{artifact_id}/download")
async def download_artifact(
    artifact_id: UUID,
    _: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> FileResponse:
    result = await db.execute(select(BackupArtifact).where(BackupArtifact.id == artifact_id))
    artifact = result.scalar_one_or_none()
    if artifact is None:
        raise HTTPException(status_code=404, detail="Artifact not found")
    if artifact.storage_location != "server" or not artifact.server_path:
        raise HTTPException(
            status_code=409,
            detail="Artifact is not on the server yet — use Copy to server first",
        )
    try:
        path = resolve_artifact_download_path(artifact.server_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Server artifact file missing") from None
    except PermissionError:
        raise HTTPException(status_code=403, detail="Invalid artifact path") from None
    return FileResponse(
        path,
        media_type="application/octet-stream",
        filename=path.name,
        headers={"X-Sha256": artifact.transfer_sha256 or artifact.sha256 or ""},
    )


@router.delete("/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_backup_job(
    job_id: UUID,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    result = await db.execute(select(BackupJob).where(BackupJob.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Backup job not found")
    await db.delete(job)
    await write_audit(
        db,
        action="backup.delete",
        actor_user_id=user.id,
        resource_type="backup_job",
        resource_id=str(job_id),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )


@router.get("/schedules", response_model=list[BackupScheduleOut])
async def list_schedules(
    _: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[BackupScheduleOut]:
    result = await db.execute(select(BackupSchedule).order_by(BackupSchedule.created_at.desc()))
    pot_names = await _pot_map(db)
    return [_sched_out(s, pot_names) for s in result.scalars().all()]


@router.post("/schedules", response_model=BackupScheduleOut, status_code=status.HTTP_201_CREATED)
async def create_schedule(
    request: Request,
    body: BackupScheduleCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> BackupScheduleOut:
    btype = body.backup_type.strip().lower()
    if btype not in ("container", "pot"):
        raise HTTPException(status_code=400, detail="backup_type must be container or pot")
    if btype == "container" and not (body.container or "").strip():
        raise HTTPException(status_code=400, detail="container is required for container schedules")

    pot = await db.execute(select(Pot).where(Pot.id == body.pot_id))
    if pot.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Pot not found")

    sched = BackupSchedule(
        name=body.name.strip(),
        backup_type=btype,
        pot_id=body.pot_id,
        container=body.container.strip() if body.container else None,
        interval_hours=body.interval_hours,
        enabled=body.enabled,
        retention_count=body.retention_count,
        next_run_at=schedule_next_run(body.interval_hours) if body.enabled else None,
        created_by_user_id=user.id,
    )
    db.add(sched)
    await db.flush()
    await write_audit(
        db,
        action="backup.schedule.create",
        actor_user_id=user.id,
        resource_type="backup_schedule",
        resource_id=str(sched.id),
        detail={"pot_id": str(body.pot_id), "interval_hours": body.interval_hours},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    pot_names = await _pot_map(db)
    return _sched_out(sched, pot_names)


@router.patch("/schedules/{schedule_id}", response_model=BackupScheduleOut)
async def update_schedule(
    schedule_id: UUID,
    body: BackupScheduleUpdate,
    _: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> BackupScheduleOut:
    result = await db.execute(select(BackupSchedule).where(BackupSchedule.id == schedule_id))
    sched = result.scalar_one_or_none()
    if sched is None:
        raise HTTPException(status_code=404, detail="Schedule not found")

    if body.name is not None:
        sched.name = body.name.strip()
    if body.interval_hours is not None:
        sched.interval_hours = body.interval_hours
        if sched.enabled:
            sched.next_run_at = schedule_next_run(sched.interval_hours)
    if body.enabled is not None:
        sched.enabled = body.enabled
        sched.next_run_at = schedule_next_run(sched.interval_hours) if body.enabled else None
    if body.retention_count is not None:
        sched.retention_count = body.retention_count

    pot_names = await _pot_map(db)
    return _sched_out(sched, pot_names)


@router.delete("/schedules/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_schedule(
    schedule_id: UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    result = await db.execute(select(BackupSchedule).where(BackupSchedule.id == schedule_id))
    sched = result.scalar_one_or_none()
    if sched is None:
        raise HTTPException(status_code=404, detail="Schedule not found")
    await db.delete(sched)
