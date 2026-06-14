import os
from pathlib import Path

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_AGENT_DIR = Path(__file__).resolve().parent.parent
_REPO_ROOT = _AGENT_DIR.parent


def _agent_env_files() -> tuple[str, ...]:
    files: list[str] = []
    if extra := os.environ.get("WATCHPOT_AGENT_ENV_FILE"):
        files.append(extra)
    files.extend((str(_REPO_ROOT / ".env"), str(_AGENT_DIR / ".env")))
    return tuple(files)


class AgentSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_agent_env_files(),
        env_file_encoding="utf-8",
        env_ignore_empty=True,
        extra="ignore",
    )

    # README / env.example use WATCHPOT_*; without an alias pydantic only reads API_BASE_URL for this field.
    api_base_url: str = Field(
        default="http://127.0.0.1:6040/api",
        validation_alias=AliasChoices("WATCHPOT_API_URL", "API_BASE_URL"),
    )
    pot_id: str = Field(default="", validation_alias="WATCHPOT_POT_ID")
    agent_token: str = Field(default="", validation_alias="WATCHPOT_AGENT_TOKEN")
    poll_interval_sec: int = Field(default=45, validation_alias="WATCHPOT_POLL_INTERVAL_SEC")
    command_poll_interval_sec: int = Field(
        default=2,
        validation_alias="WATCHPOT_COMMAND_POLL_INTERVAL_SEC",
    )
    heartbeat_interval_sec: int = Field(default=30, validation_alias="WATCHPOT_HEARTBEAT_INTERVAL_SEC")
    infra_report_interval_sec: int = Field(default=90, validation_alias="WATCHPOT_INFRA_REPORT_INTERVAL_SEC")
    work_dir: str = Field(default="/var/lib/watchpot", validation_alias="WATCHPOT_WORK_DIR")
    compose_project_prefix: str = Field(
        default="wp",
        validation_alias=AliasChoices("WATCHPOT_COMPOSE_PROJECT_PREFIX", "COMPOSE_PROJECT_PREFIX"),
    )

    @model_validator(mode="before")
    @classmethod
    def _legacy_node_env(cls, data: object) -> object:
        if not isinstance(data, dict):
            return data
        d = dict(data)
        if not d.get("WATCHPOT_POT_ID") and not d.get("pot_id"):
            legacy = os.environ.get("WATCHPOT_NODE_ID")
            if legacy:
                d["WATCHPOT_POT_ID"] = legacy
        return d
