from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, JSON, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ThreatIp(Base):
    """Observed attacker/source IPs extracted from honeypot events."""

    __tablename__ = "threat_ips"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ip_address: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="observed", index=True)
    hit_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    match_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    pot_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    attack_types: Mapped[list | None] = mapped_column(JSON, nullable=True)
    cve_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    tools: Mapped[list | None] = mapped_column(JSON, nullable=True)
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True)
    user_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    geo: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    abuse_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_tor: Mapped[bool | None] = mapped_column(nullable=True)
    is_hosting: Mapped[bool | None] = mapped_column(nullable=True)
    lookup_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    last_lookup_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
