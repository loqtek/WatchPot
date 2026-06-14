from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, Uuid, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Stack(Base):
    """Logical deploy unit: one Docker Compose stack on one pot (honeypot host)."""

    __tablename__ = "stacks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pot_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("pots.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    restart_generation: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    pot: Mapped["Pot"] = relationship(back_populates="stacks")
    revisions: Mapped[list["StackRevision"]] = relationship(
        back_populates="stack",
        order_by="StackRevision.revision",
        cascade="all, delete-orphan",
    )


class StackRevision(Base):
    """Versioned compose YAML stored in DB for rework / rollback."""

    __tablename__ = "stack_revisions"
    __table_args__ = (UniqueConstraint("stack_id", "revision", name="uq_stack_revision"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    stack_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("stacks.id", ondelete="CASCADE"), index=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    compose_yaml: Mapped[str] = mapped_column(Text, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    stack: Mapped["Stack"] = relationship(back_populates="revisions")
