from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class EnvSettings(BaseSettings):
    """
    Environment-only configuration. Database location and process role live here;
    JWT, CORS, log paths, and other app config are stored in the database.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        env_nested_delimiter="__",
    )

    app_name: str = "watchPot API"
    debug: bool = False
    database_url: str = "postgresql+asyncpg://watchpot:watchpot@127.0.0.1:5433/watchpot"
    watchpot_api_role: str = Field(
        default="control",
        description="control = operator + agent APIs; agent = agent endpoints only",
    )
    watchpot_stack_mode: str = Field(
        default="full",
        validation_alias="WATCHPOT_STACK_MODE",
        description="full | api_only | ui_only | local_dev — local_dev enables auto local agent by default",
    )
    watchpot_auto_local_agent: bool | None = Field(
        default=None,
        validation_alias="WATCHPOT_AUTO_LOCAL_AGENT",
        description="If set, overrides default (on for local_dev). Set false to disable.",
    )

    def auto_local_agent_enabled(self) -> bool:
        if self.watchpot_auto_local_agent is not None:
            return self.watchpot_auto_local_agent
        return self.watchpot_stack_mode == "local_dev"
    expose_openapi: bool = Field(
        default=False,
        validation_alias="EXPOSE_OPENAPI",
        description="If true, /docs, /redoc, and /openapi.json are enabled (dev/lab only).",
    )
    allow_loopback_cors: bool | None = Field(
        default=None,
        validation_alias="WATCHPOT_ALLOW_LOOPBACK_CORS",
        description="Allow any localhost/127.0.0.1 origin. Default: on for local_dev, off otherwise.",
    )
    log_bootstrap_password: bool | None = Field(
        default=None,
        validation_alias="WATCHPOT_LOG_BOOTSTRAP_PASSWORD",
        description="Log one-time admin password at startup. Default: on for local_dev only.",
    )
    metrics_token: str = Field(
        default="",
        validation_alias="WATCHPOT_METRICS_TOKEN",
        description="If set, /metrics requires Authorization: Bearer <token>.",
    )
    max_backup_upload_bytes: int = Field(
        default=512 * 1024 * 1024,
        validation_alias="WATCHPOT_MAX_BACKUP_UPLOAD_BYTES",
        description="Max agent backup upload size in bytes.",
    )
    enable_test_endpoints: bool = Field(
        default=False,
        validation_alias="WATCHPOT_ENABLE_TEST_ENDPOINTS",
        description="Enable dev-only operator endpoints (e.g. simulate heartbeat).",
    )
    trust_proxy: bool = Field(
        default=True,
        validation_alias="WATCHPOT_TRUST_PROXY",
        description="Trust X-Forwarded-For / X-Forwarded-Proto from the TLS proxy.",
    )
    auth_login_rate_limit: int = Field(
        default=8,
        validation_alias="WATCHPOT_AUTH_LOGIN_RATE_LIMIT",
        description="Max login attempts per IP per window.",
    )
    auth_register_rate_limit: int = Field(
        default=5,
        validation_alias="WATCHPOT_AUTH_REGISTER_RATE_LIMIT",
        description="Max register attempts per IP per window.",
    )
    auth_rate_window_seconds: int = Field(
        default=900,
        validation_alias="WATCHPOT_AUTH_RATE_WINDOW_SECONDS",
        description="Sliding window for login/register rate limits.",
    )
    public_agent_open: bool | None = Field(
        default=None,
        validation_alias="WATCHPOT_PUBLIC_AGENT_OPEN",
        description="If true, /api/public/agent/* needs no enrollment token. Default: on for local_dev only.",
    )
    agent_enrollment_token: str = Field(
        default="",
        validation_alias="WATCHPOT_AGENT_ENROLLMENT_TOKEN",
        description="Optional static enrollment token accepted in addition to short-lived JWTs.",
    )
    agent_enrollment_ttl_minutes: int = Field(
        default=45,
        validation_alias="WATCHPOT_AGENT_ENROLLMENT_TTL_MINUTES",
        description="Lifetime of minted enrollment JWTs.",
    )
    integration_allow_loopback: bool | None = Field(
        default=None,
        validation_alias="WATCHPOT_INTEGRATION_ALLOW_LOOPBACK",
        description="Allow integration URLs that resolve to loopback. Default: on for local_dev only.",
    )

    def allow_loopback_cors_enabled(self) -> bool:
        if self.allow_loopback_cors is not None:
            return self.allow_loopback_cors
        return self.watchpot_stack_mode == "local_dev"

    def log_bootstrap_password_enabled(self) -> bool:
        if self.log_bootstrap_password is not None:
            return self.log_bootstrap_password
        return self.watchpot_stack_mode == "local_dev"

    def public_agent_open_enabled(self) -> bool:
        if self.public_agent_open is not None:
            return self.public_agent_open
        return self.watchpot_stack_mode == "local_dev"

    def integration_allow_loopback_enabled(self) -> bool:
        if self.integration_allow_loopback is not None:
            return self.integration_allow_loopback
        return self.watchpot_stack_mode == "local_dev"


@lru_cache
def get_env_settings() -> EnvSettings:
    return EnvSettings()


def get_settings() -> EnvSettings:
    """Alias for older imports."""
    return get_env_settings()
