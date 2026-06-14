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


class OperatorSettingsUpdate(BaseModel):
    allow_public_registration: bool | None = None
    heartbeat_stale_minutes: int | None = Field(default=None, ge=1, le=1440)
