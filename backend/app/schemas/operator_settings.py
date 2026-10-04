from pydantic import BaseModel, Field


class OperatorSettingsOut(BaseModel):
    """Non-secret control-plane settings exposed to signed-in operators."""

    cors_origins: list[str]
    deployment_stack_mode: str
    allow_public_registration: bool
    access_token_expire_minutes: int
    external_log_paths: list[str]
    jwt_algorithm: str
    heartbeat_stale_minutes: int
    event_retention_max: int
    public_agent_enrollment_required: bool


class OperatorSettingsUpdate(BaseModel):
    allow_public_registration: bool | None = None
    heartbeat_stale_minutes: int | None = Field(default=None, ge=1, le=1440)
    access_token_expire_minutes: int | None = Field(default=None, ge=15, le=60 * 24 * 7)
    event_retention_max: int | None = Field(default=None, ge=1_000, le=2_000_000)
