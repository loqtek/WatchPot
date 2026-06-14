from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, JSON, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class EnrichmentRule(Base):
    """Passive fingerprint rule — matches event text and tags attack metadata."""

    __tablename__ = "enrichment_rules"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    pattern: Mapped[str] = mapped_column(Text, nullable=False)
    pattern_type: Mapped[str] = mapped_column(String(32), nullable=False, default="regex")
    match_field: Mapped[str] = mapped_column(String(32), nullable=False, default="both")
    attack_type: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    tool: Mapped[str | None] = mapped_column(String(128), nullable=True)
    technique: Mapped[str | None] = mapped_column(String(128), nullable=True)
    cve_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    severity: Mapped[str | None] = mapped_column(String(32), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=50, server_default="50")
    is_builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
