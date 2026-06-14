from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class OperatorDashboard(Base):
    """User-owned monitoring dashboard layout (Grafana / T-Pot style)."""

    __tablename__ = "operator_dashboards"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    grid_cols: Mapped[int] = mapped_column(Integer, default=12, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    widgets: Mapped[list["OperatorDashboardWidget"]] = relationship(
        back_populates="dashboard",
        cascade="all, delete-orphan",
        order_by="OperatorDashboardWidget.order_index",
    )


class OperatorDashboardWidget(Base):
    __tablename__ = "operator_dashboard_widgets"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dashboard_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("operator_dashboards.id", ondelete="CASCADE"), index=True
    )
    widget_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    config: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    x: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    y: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    w: Mapped[int] = mapped_column(Integer, default=4, nullable=False)
    h: Mapped[int] = mapped_column(Integer, default=4, nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    dashboard: Mapped["OperatorDashboard"] = relationship(back_populates="widgets")
