from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class AuditLogOut(BaseModel):
    id: UUID
    actor_user_id: UUID | None
    action: str
    resource_type: str | None
    resource_id: str | None
    detail: dict | None
    ip_address: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
