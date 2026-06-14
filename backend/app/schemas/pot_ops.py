from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class PotStatsOut(BaseModel):
    range: str
    events_total: int
    events_per_hour: float
    stacks_total: int
    stacks_with_revision: int
    containers_running: int
    containers_total: int
    docker_ok: bool | None
    hostname: str | None
    infra_at: datetime | None
    by_severity: list[dict]
    by_event_type: list[dict]
    events_by_stack: list[dict]


class PotContainerOut(BaseModel):
    id: str
    name: str
    image: str
    status: str
    state: str
    ports: str
    stack_id: str | None = None
    stack_name: str | None = None
    project: str | None = None
    created: str | None = None


class PotInfraOut(BaseModel):
    snapshot_at: datetime | None
    docker_ps_ok: bool | None
    docker_info_ok: bool | None
    hostname: str | None
    system: str | None
    containers: list[PotContainerOut]


class PotCommandCreate(BaseModel):
    action: str = Field(
        description="logs | start | stop | restart | kill | rm | exec | compose_start | compose_stop | compose_restart | compose_down"
    )
    container: str | None = None
    stack_id: UUID | None = None
    tail: int = Field(default=200, ge=1, le=5000)
    command: str | None = Field(default=None, description="Shell command for exec action")
    params: dict | None = None


class PotCommandOut(BaseModel):
    id: UUID
    pot_id: UUID
    stack_id: UUID | None
    action: str
    container: str | None
    params: str | None = None
    status: str
    output: str | None
    error: str | None
    created_at: datetime
    completed_at: datetime | None

    model_config = {"from_attributes": True}


class AgentCommandComplete(BaseModel):
    status: str = Field(description="completed | failed")
    output: str | None = None
    error: str | None = None


class PotDeleteOut(BaseModel):
    teardown_command_ids: list[UUID] = Field(default_factory=list)
