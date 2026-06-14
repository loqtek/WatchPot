from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.pot import Pot
from app.runtime_config import get_heartbeat_stale_minutes
from app.time_utils import ensure_utc, utc_now


def _heartbeat_is_recent(last_at: datetime | None, *, stale_minutes: int, now: datetime) -> bool:
    last = ensure_utc(last_at)
    if last is None:
        return False
    return (now - last).total_seconds() <= stale_minutes * 60


def build_pot_out(pot: Pot) -> "PotOut":
    """Serialize a pot; heartbeat_online uses server time and heartbeat_stale_minutes from app_settings."""
    now = utc_now()
    stale = get_heartbeat_stale_minutes()
    online = _heartbeat_is_recent(pot.last_heartbeat_at, stale_minutes=stale, now=now)
    base = PotOut.model_validate(pot)
    return base.model_copy(update={"heartbeat_online": online})


class PotCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None


class PotUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None


class PotOut(BaseModel):
    id: UUID
    name: str
    description: str | None
    last_heartbeat_at: datetime | None
    last_ip: str | None
    agent_version: str | None
    meta: dict | None = None
    created_at: datetime
    heartbeat_online: bool = False

    model_config = {"from_attributes": True}


class PotWithKey(PotOut):
    """Returned once at registration — store agent key securely."""

    agent_key: str
