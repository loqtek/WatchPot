from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class BackupArtifact(Base):
    """Single backup file (tar/zip) with storage location and integrity hash."""

    __tablename__ = "backup_artifacts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("backup_jobs.id", ondelete="CASCADE"), index=True
    )
    container: Mapped[str | None] = mapped_column(String(255), nullable=True)
    image_reference: Mapped[str | None] = mapped_column(String(512), nullable=True)
    artifact_format: Mapped[str] = mapped_column(String(16), nullable=False, default="tar", server_default="tar")
    storage_location: Mapped[str] = mapped_column(
        String(16), nullable=False, default="agent", server_default="agent"
    )  # agent | server | external
    agent_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    server_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    external_uri: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    transfer_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    transfer_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
