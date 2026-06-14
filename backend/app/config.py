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
    database_url: str = "sqlite+aiosqlite:///./data/watchpot.db"
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
        description="If set, overrides default (on for local_dev / SQLite dev). Set false to disable.",
    )

    def auto_local_agent_enabled(self) -> bool:
        if self.watchpot_auto_local_agent is not None:
            return self.watchpot_auto_local_agent
        if self.watchpot_stack_mode == "local_dev":
            return True
        return self.database_url.split(":", 1)[0].endswith("sqlite")
    expose_openapi: bool = Field(
        default=False,
        validation_alias="EXPOSE_OPENAPI",
        description="If true, /docs, /redoc, and /openapi.json are enabled (dev/lab only).",
    )
    allow_loopback_cors: bool | None = Field(
        default=None,
        validation_alias="WATCHPOT_ALLOW_LOOPBACK_CORS",
        description="Allow any localhost/127.0.0.1 origin. Default: on for local_dev/SQLite, off otherwise.",
    )
    log_bootstrap_password: bool | None = Field(
        default=None,
        validation_alias="WATCHPOT_LOG_BOOTSTRAP_PASSWORD",
        description="Log one-time admin password at startup. Default: on for local_dev/SQLite only.",
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

    def allow_loopback_cors_enabled(self) -> bool:
        if self.allow_loopback_cors is not None:
            return self.allow_loopback_cors
        if self.watchpot_stack_mode == "local_dev":
            return True
        return self.database_url.split(":", 1)[0].endswith("sqlite")

    def log_bootstrap_password_enabled(self) -> bool:
        if self.log_bootstrap_password is not None:
            return self.log_bootstrap_password
        if self.watchpot_stack_mode == "local_dev":
            return True
        return self.database_url.split(":", 1)[0].endswith("sqlite")


@lru_cache
def get_env_settings() -> EnvSettings:
    return EnvSettings()


def get_settings() -> EnvSettings:
    """Alias for older imports."""
    return get_env_settings()
