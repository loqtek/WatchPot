from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Event(Base):
    """Normalized sensor / honeypot / IDS event."""

    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pot_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("pots.id", ondelete="CASCADE"), index=True)
    stack_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("stacks.id", ondelete="SET NULL"), nullable=True, index=True)
    service_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    event_type: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(32), default="info", nullable=False)
    # runtime = honeypot/workload logs; infra = agent docker/host snapshots; control = API/UI actions
    channel: Mapped[str] = mapped_column(String(32), default="runtime", nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(64), nullable=False)  # agent, suricata, syslog, etc.
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    raw_log: Mapped[str | None] = mapped_column(Text, nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    pot: Mapped["Pot"] = relationship(back_populates="events")
