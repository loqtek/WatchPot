"""Persist and query per-file backup artifacts."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.backup_artifact import BackupArtifact
from app.models.backup_job import BackupJob


async def upsert_artifact(
    db: AsyncSession,
    *,
    job_id: UUID,
    container: str | None,
    image_reference: str | None,
    agent_path: str | None,
    size_bytes: int | None,
    sha256: str | None,
    artifact_format: str = "tar",
) -> BackupArtifact:
    result = await db.execute(
        select(BackupArtifact).where(
            BackupArtifact.job_id == job_id,
            BackupArtifact.agent_path == agent_path,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = BackupArtifact(
            job_id=job_id,
            container=container,
            image_reference=image_reference,
            agent_path=agent_path,
            size_bytes=size_bytes,
            sha256=sha256,
            artifact_format=artifact_format,
            storage_location="agent",
        )
        db.add(row)
    else:
        row.container = container
        row.image_reference = image_reference
        row.size_bytes = size_bytes
        row.sha256 = sha256
        row.artifact_format = artifact_format
    await db.flush()
    return row


async def list_artifacts(db: AsyncSession, job_id: UUID) -> list[BackupArtifact]:
    result = await db.execute(
        select(BackupArtifact).where(BackupArtifact.job_id == job_id).order_by(BackupArtifact.created_at.asc())
    )
    return list(result.scalars().all())


async def refresh_job_storage_location(db: AsyncSession, job: BackupJob) -> None:
    artifacts = await list_artifacts(db, job.id)
    if not artifacts:
        return
    locations = {a.storage_location for a in artifacts}
    if locations == {"server"}:
        job.storage_location = "server"
    elif "server" in locations:
        job.storage_location = "mixed"
    elif locations == {"external"}:
        job.storage_location = "external"
    else:
        job.storage_location = "agent"
