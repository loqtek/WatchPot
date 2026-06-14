from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class SnapshotCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    image_reference: str = Field(min_length=1, max_length=512)
    image_id: str | None = Field(None, max_length=128)
    pot_id: UUID | None = None
    labels: dict | None = None


class SnapshotOut(BaseModel):
    id: UUID
    name: str
    description: str | None
    image_reference: str
    image_id: str | None
    pot_id: UUID | None
    created_by_user_id: UUID | None
    labels: dict | None
    created_at: datetime

    model_config = {"from_attributes": True}
