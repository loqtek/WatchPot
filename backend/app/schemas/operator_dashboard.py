from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class DashboardWidgetIn(BaseModel):
    widget_type: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=255)
    config: dict | None = None
    x: int = Field(ge=0, default=0)
    y: int = Field(ge=0, default=0)
    w: int = Field(ge=1, le=24, default=4)
    h: int = Field(ge=1, le=48, default=4)
    order_index: int = 0


class DashboardWidgetOut(BaseModel):
    id: UUID
    widget_type: str
    title: str
    config: dict | None
    x: int
    y: int
    w: int
    h: int
    order_index: int

    model_config = {"from_attributes": True}


class DashboardOut(BaseModel):
    id: UUID
    user_id: UUID
    name: str
    grid_cols: int
    is_default: bool
    created_at: datetime
    updated_at: datetime
    widgets: list[DashboardWidgetOut]

    model_config = {"from_attributes": True}


class DashboardCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    template_key: str | None = Field(
        default=None,
        description="Optional preset: siem, honeypot, minimal, network",
    )
    grid_cols: int = Field(default=12, ge=4, le=24)


class DashboardUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    grid_cols: int | None = Field(default=None, ge=4, le=24)
    widgets: list[DashboardWidgetIn] | None = None
