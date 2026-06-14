from uuid import UUID

from pydantic import BaseModel, Field


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


class AgentEventBatchIn(BaseModel):
    events: list[AgentEventItem] = Field(default_factory=list, max_length=500)
