from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class StackRevisionCreate(BaseModel):
    compose_yaml: str = Field(min_length=1)
    note: str | None = None


class StackRevisionOut(BaseModel):
    id: UUID
    stack_id: UUID
    revision: int
    compose_yaml: str
    note: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class StackCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None


class StackUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None


class StackOut(BaseModel):
    id: UUID
    pot_id: UUID
    name: str
    description: str | None
    restart_generation: int = 0
    created_at: datetime
    latest_revision: int | None = None

    model_config = {"from_attributes": True}


class StackDeleteOut(BaseModel):
    teardown_command_id: UUID | None = None
