"""Backup job lifecycle: queue agent commands and finalize results."""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.backup_job import BackupJob
from app.models.backup_schedule import BackupSchedule
from app.models.pot import Pot
from app.models.pot_command import PotCommand
from app.models.snapshot import Snapshot
from app.services.backup_artifacts import refresh_job_storage_location, upsert_artifact
from app.services.pot_infra import serialize_command_params


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:48] or "backup"


async def queue_backup_job(
    db: AsyncSession,
    *,
    name: str,
    backup_type: str,
    pot_id: UUID,
    container: str | None,
    user_id: UUID | None,
    schedule_id: UUID | None = None,
    export_tar: bool = True,
) -> BackupJob:
    btype = backup_type.strip().lower()
    if btype not in ("container", "pot"):
        raise ValueError(f"Unsupported backup_type: {backup_type}")
    if btype == "container" and not (container or "").strip():
        raise ValueError("container is required for container backups")

    action = "backup_container" if btype == "container" else "backup_pot"
    params = {
        "backup_name": name,
        "export_tar": export_tar,
        "job_slug": _slug(name),
    }

    cmd = PotCommand(
        pot_id=pot_id,
        action=action,
        container=container.strip() if container else None,
        params=serialize_command_params(200, None, params),
        status="pending",
        requested_by_user_id=user_id,
    )
    db.add(cmd)
    await db.flush()

    job = BackupJob(
        name=name,
        backup_type=btype,
        pot_id=pot_id,
        container=container.strip() if container else None,
        status="pending",
        command_id=cmd.id,
        schedule_id=schedule_id,
        requested_by_user_id=user_id,
    )
    db.add(job)
    await db.flush()
    return job


def _parse_agent_output(raw: str | None) -> dict | None:
    if not raw:
        return None
    text = raw.strip()
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        return None


async def _register_snapshot(
    db: AsyncSession,
    *,
    job: BackupJob,
    name: str,
    image_reference: str,
    image_id: str | None,
    artifact_path: str | None,
    artifact_size: int | None,
    container: str | None,
    user_id: UUID | None,
) -> Snapshot:
    labels = {
        "source": "backup",
        "backup_job_id": str(job.id),
        "backup_type": job.backup_type,
        "container": container,
        "artifact_path": artifact_path,
        "artifact_size": artifact_size,
        "storage_location": job.storage_location,
        "artifact_sha256": job.artifact_sha256,
        "artifact_format": job.artifact_format,
    }
    snap = Snapshot(
        name=name,
        description=f"Auto-registered from backup job {job.name}",
        image_reference=image_reference,
        image_id=image_id,
        pot_id=job.pot_id,
        created_by_user_id=user_id,
        labels=labels,
    )
    db.add(snap)
    await db.flush()
    return snap


async def _backfill_artifacts_from_detail(db: AsyncSession, job: BackupJob) -> None:
    if not job.detail_json:
        return
    from app.services.backup_artifacts import list_artifacts

    if await list_artifacts(db, job.id):
        return
    try:
        payload = json.loads(job.detail_json)
    except json.JSONDecodeError:
        return
    if not isinstance(payload, dict):
        return

    if job.backup_type == "container":
        apath = str(payload.get("artifact_path") or "") or None
        if apath:
            await upsert_artifact(
                db,
                job_id=job.id,
                container=job.container,
                image_reference=str(payload.get("image_reference") or "") or None,
                agent_path=apath,
                size_bytes=int(payload["artifact_size"]) if isinstance(payload.get("artifact_size"), (int, float)) else None,
                sha256=str(payload.get("artifact_sha256") or "") or None,
                artifact_format=str(payload.get("artifact_format") or "tar"),
            )
    elif job.backup_type == "pot":
        containers = payload.get("containers")
        if isinstance(containers, list):
            for entry in containers:
                if not isinstance(entry, dict):
                    continue
                apath = str(entry.get("artifact_path") or "") or None
                if not apath:
                    continue
                await upsert_artifact(
                    db,
                    job_id=job.id,
                    container=str(entry.get("container") or "") or None,
                    image_reference=str(entry.get("image_reference") or "") or None,
                    agent_path=apath,
                    size_bytes=int(entry["artifact_size"]) if isinstance(entry.get("artifact_size"), (int, float)) else None,
                    sha256=str(entry.get("artifact_sha256") or "") or None,
                    artifact_format=str(entry.get("artifact_format") or "tar"),
                )
    job.storage_location = str(payload.get("storage_location") or job.storage_location or "agent")
    job.artifact_sha256 = job.artifact_sha256 or str(payload.get("artifact_sha256") or "") or None
    job.artifact_format = job.artifact_format or str(payload.get("artifact_format") or "") or None


async def sync_backup_job_from_command(db: AsyncSession, job: BackupJob) -> BackupJob:
    if job.status in ("completed", "failed"):
        await _backfill_artifacts_from_detail(db, job)
        await refresh_job_storage_location(db, job)
        return job
    if not job.command_id:
        return job

    result = await db.execute(select(PotCommand).where(PotCommand.id == job.command_id))
    cmd = result.scalar_one_or_none()
    if cmd is None:
        job.status = "failed"
        job.error = "Linked agent command missing"
        job.completed_at = datetime.now(timezone.utc)
        return job

    if cmd.status == "pending":
        job.status = "running"
        return job

    if cmd.status not in ("completed", "failed"):
        return job

    now = datetime.now(timezone.utc)
    job.completed_at = now

    if cmd.status == "failed":
        job.status = "failed"
        job.error = (cmd.error or cmd.output or "Agent reported failure")[:4000]
        return job

    payload = _parse_agent_output(cmd.output)
    if not payload:
        job.status = "failed"
        job.error = "Agent completed but returned no backup metadata"
        return job

    job.status = "completed"
    job.detail_json = json.dumps(payload)[:500_000]
    job.storage_location = str(payload.get("storage_location") or "agent")

    if job.backup_type == "container":
        job.image_reference = str(payload.get("image_reference") or "") or None
        job.image_id = str(payload.get("image_id") or "") or None
        job.artifact_path = str(payload.get("artifact_path") or "") or None
        job.artifact_format = str(payload.get("artifact_format") or "") or None
        job.artifact_sha256 = str(payload.get("artifact_sha256") or "") or None
        size = payload.get("artifact_size")
        job.artifact_size = int(size) if isinstance(size, (int, float)) else None
        if job.artifact_path:
            await upsert_artifact(
                db,
                job_id=job.id,
                container=job.container,
                image_reference=job.image_reference,
                agent_path=job.artifact_path,
                size_bytes=job.artifact_size,
                sha256=job.artifact_sha256,
                artifact_format=job.artifact_format or "tar",
            )
        if job.image_reference:
            await _register_snapshot(
                db,
                job=job,
                name=f"{job.name} · {job.container or 'container'}",
                image_reference=job.image_reference,
                image_id=job.image_id,
                artifact_path=job.artifact_path,
                artifact_size=job.artifact_size,
                container=job.container,
                user_id=job.requested_by_user_id,
            )
    elif job.backup_type == "pot":
        total = payload.get("total_size")
        job.artifact_size = int(total) if isinstance(total, (int, float)) else None
        containers = payload.get("containers")
        if isinstance(containers, list):
            for entry in containers:
                if not isinstance(entry, dict):
                    continue
                ref = str(entry.get("image_reference") or "").strip()
                if not ref:
                    continue
                cname = str(entry.get("container") or "container")
                apath = str(entry.get("artifact_path") or "") or None
                asha = str(entry.get("artifact_sha256") or "") or None
                aformat = str(entry.get("artifact_format") or "tar")
                asize = int(entry["artifact_size"]) if isinstance(entry.get("artifact_size"), (int, float)) else None
                if apath:
                    await upsert_artifact(
                        db,
                        job_id=job.id,
                        container=cname,
                        image_reference=ref,
                        agent_path=apath,
                        size_bytes=asize,
                        sha256=asha,
                        artifact_format=aformat,
                    )
                await _register_snapshot(
                    db,
                    job=job,
                    name=f"{job.name} · {cname}",
                    image_reference=ref,
                    image_id=str(entry.get("image_id") or "") or None,
                    artifact_path=apath,
                    artifact_size=asize,
                    container=cname,
                    user_id=job.requested_by_user_id,
                )

    await refresh_job_storage_location(db, job)
    return job


async def sync_ingest_from_command(db: AsyncSession, job: BackupJob) -> BackupJob:
    if not job.ingest_command_id or job.ingest_status in ("verified", "failed"):
        return job
    result = await db.execute(select(PotCommand).where(PotCommand.id == job.ingest_command_id))
    cmd = result.scalar_one_or_none()
    if cmd is None:
        job.ingest_status = "failed"
        return job
    if cmd.status == "pending":
        job.ingest_status = "transferring"
        return job
    if cmd.status == "failed":
        job.ingest_status = "failed"
        job.error = (cmd.error or cmd.output or job.error or "Ingest failed")[:4000]
        return job
    if cmd.status == "completed":
        job.ingest_status = "verified"
        await refresh_job_storage_location(db, job)
    return job


async def queue_ingest_to_server(db: AsyncSession, job: BackupJob, user_id: UUID | None) -> BackupJob:
    from app.services.backup_artifacts import list_artifacts

    artifacts = await list_artifacts(db, job.id)
    on_agent = [a for a in artifacts if a.storage_location == "agent" and a.agent_path and a.sha256]
    if not on_agent:
        raise ValueError("No agent-stored artifacts with hashes available to ingest")

    payload_artifacts = [
        {"artifact_id": str(a.id), "path": a.agent_path, "sha256": a.sha256}
        for a in on_agent
    ]
    params = {"job_id": str(job.id), "artifacts": payload_artifacts}
    cmd = PotCommand(
        pot_id=job.pot_id,
        action="backup_ingest",
        params=serialize_command_params(200, None, params),
        status="pending",
        requested_by_user_id=user_id,
    )
    db.add(cmd)
    await db.flush()
    job.ingest_status = "pending"
    job.ingest_command_id = cmd.id
    return job


async def apply_retention(db: AsyncSession, schedule: BackupSchedule) -> None:
    """Delete oldest completed jobs beyond retention_count for this schedule."""
    result = await db.execute(
        select(BackupJob)
        .where(BackupJob.schedule_id == schedule.id, BackupJob.status == "completed")
        .order_by(BackupJob.created_at.desc())
    )
    jobs = list(result.scalars().all())
    for old in jobs[schedule.retention_count :]:
        await db.delete(old)


async def run_due_schedules(db: AsyncSession) -> int:
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(BackupSchedule).where(
            BackupSchedule.enabled.is_(True),
            BackupSchedule.backup_type.in_(("container", "pot")),
            BackupSchedule.next_run_at.is_not(None),
            BackupSchedule.next_run_at <= now,
        )
    )
    schedules = list(result.scalars().all())
    queued = 0
    for sched in schedules:
        await queue_backup_job(
            db,
            name=f"{sched.name} (scheduled)",
            backup_type=sched.backup_type,
            pot_id=sched.pot_id,
            container=sched.container,
            user_id=sched.created_by_user_id,
            schedule_id=sched.id,
            export_tar=True,
        )
        sched.last_run_at = now
        sched.next_run_at = now + timedelta(hours=sched.interval_hours)
        await apply_retention(db, sched)
        queued += 1
    return queued


def schedule_next_run(interval_hours: int, *, from_time: datetime | None = None) -> datetime:
    base = from_time or datetime.now(timezone.utc)
    return base + timedelta(hours=interval_hours)
