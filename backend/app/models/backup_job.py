from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class BackupJob(Base):
    """Queued or completed backup of a container or whole pot."""

    __tablename__ = "backup_jobs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    backup_type: Mapped[str] = mapped_column(String(32), nullable=False)  # container | pot | host
    pot_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("pots.id", ondelete="CASCADE"), index=True)
    container: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", server_default="pending")
    command_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("pot_commands.id", ondelete="SET NULL"), nullable=True
    )
    ingest_command_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("pot_commands.id", ondelete="SET NULL"), nullable=True
    )
    schedule_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("backup_schedules.id", ondelete="SET NULL"), nullable=True
    )
    storage_location: Mapped[str] = mapped_column(
        String(16), nullable=False, default="agent", server_default="agent"
    )  # agent | server | external
    artifact_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    artifact_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    artifact_format: Mapped[str | None] = mapped_column(String(16), nullable=True)
    artifact_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    server_artifact_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    image_reference: Mapped[str | None] = mapped_column(String(512), nullable=True)
    image_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    ingest_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    detail_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
