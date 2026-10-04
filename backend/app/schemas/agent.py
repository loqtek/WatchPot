import json
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

RAW_LOG_MAX = 65_536
PAYLOAD_JSON_MAX = 262_144


class AgentHeartbeatIn(BaseModel):
    agent_version: str | None = None
    docker_version: str | None = None
    meta: dict | None = None


class AgentDesiredStack(BaseModel):
    stack_id: UUID
    name: str
    revision: int
    restart_generation: int = 0
    compose_yaml: str


class AgentEventItem(BaseModel):
    stack_id: UUID | None = None
    service_name: str | None = None
    event_type: str = Field(min_length=1, max_length=128)
    severity: str = "info"
    source: str = "agent"
    channel: str | None = Field(default=None, max_length=32)
    payload: dict | None = None
    raw_log: str | None = None

    @field_validator("raw_log")
    @classmethod
    def cap_raw_log(cls, value: str | None) -> str | None:
        if value is not None and len(value) > RAW_LOG_MAX:
            return value[:RAW_LOG_MAX]
        return value

    @field_validator("payload")
    @classmethod
    def cap_payload(cls, value: dict | None) -> dict | None:
        if value is None:
            return None
        try:
            encoded = json.dumps(value)
        except (TypeError, ValueError):
            return {"truncated": True}
        if len(encoded) > PAYLOAD_JSON_MAX:
            return {"truncated": True}
        return value


class AgentEventBatchIn(BaseModel):
    events: list[AgentEventItem] = Field(default_factory=list, max_length=500)
