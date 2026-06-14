from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class BackupSchedule(Base):
    """Recurring backup schedule for a pot or specific container."""

    __tablename__ = "backup_schedules"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    backup_type: Mapped[str] = mapped_column(String(32), nullable=False)  # container | pot | host
    pot_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("pots.id", ondelete="CASCADE"), index=True)
    container: Mapped[str | None] = mapped_column(String(255), nullable=True)
    interval_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=24, server_default="24")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    retention_count: Mapped[int] = mapped_column(Integer, nullable=False, default=5, server_default="5")
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
