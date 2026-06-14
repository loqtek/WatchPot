"""In-memory cache of DB-backed settings (refreshed on each app startup)."""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_setting import AppSetting
from app.integrations.config import reload_integrations_from_rows
from app.settings_keys import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    ALLOW_PUBLIC_REGISTRATION,
    CORS_ORIGINS,
    DEPLOYMENT_STACK_MODE,
    EXTERNAL_LOG_PATHS,
    HEARTBEAT_STALE_MINUTES,
    JWT_ALGORITHM,
    JWT_SECRET,
)

_jwt_secret: str | None = None
_jwt_algorithm: str = "HS256"
_access_token_expire_minutes: int = 60 * 24
_cors_origins_list: list[str] = []
_external_log_paths: list[str] = []
_deployment_stack_mode: str = "full"
_allow_public_registration: bool = False
_heartbeat_stale_minutes: int = 10


def get_jwt_secret() -> str:
    if not _jwt_secret:
        raise RuntimeError("JWT secret not loaded — database bootstrap incomplete")
    return _jwt_secret


def get_jwt_algorithm() -> str:
    return _jwt_algorithm


def get_access_token_expire_minutes() -> int:
    return _access_token_expire_minutes


def get_cors_origins() -> list[str]:
    return list(_cors_origins_list)


def get_external_log_paths() -> list[str]:
    return list(_external_log_paths)


def get_deployment_stack_mode() -> str:
    return _deployment_stack_mode


def is_public_registration_allowed() -> bool:
    return _allow_public_registration


def get_heartbeat_stale_minutes() -> int:
    """Pots with last_heartbeat_at older than this are treated as offline."""
    return _heartbeat_stale_minutes


def _parse_origins(s: str) -> list[str]:
    return [x.strip() for x in s.split(",") if x.strip()]


async def load_settings_from_db(session: AsyncSession) -> dict[str, str]:
    global \
        _jwt_secret, \
        _jwt_algorithm, \
        _access_token_expire_minutes, \
        _cors_origins_list, \
        _external_log_paths, \
        _deployment_stack_mode, \
        _allow_public_registration, \
        _heartbeat_stale_minutes

    result = await session.execute(select(AppSetting))
    rows: dict[str, str] = {r.key: r.value for r in result.scalars().all()}

    _jwt_secret = rows.get(JWT_SECRET)
    _jwt_algorithm = rows.get(JWT_ALGORITHM) or "HS256"
    try:
        _access_token_expire_minutes = int(rows.get(ACCESS_TOKEN_EXPIRE_MINUTES) or str(60 * 24))
    except ValueError:
        _access_token_expire_minutes = 60 * 24
    _cors_origins_list = _parse_origins(rows.get(CORS_ORIGINS) or "https://localhost,https://127.0.0.1")
    try:
        raw_paths = rows.get(EXTERNAL_LOG_PATHS) or "[]"
        parsed = json.loads(raw_paths)
        _external_log_paths = list(parsed) if isinstance(parsed, list) else []
    except (json.JSONDecodeError, TypeError):
        _external_log_paths = []
    _deployment_stack_mode = rows.get(DEPLOYMENT_STACK_MODE) or "full"
    _allow_public_registration = (rows.get(ALLOW_PUBLIC_REGISTRATION) or "false").lower() in (
        "1",
        "true",
        "yes",
    )
    try:
        _heartbeat_stale_minutes = int(rows.get(HEARTBEAT_STALE_MINUTES) or "10")
        if _heartbeat_stale_minutes < 1:
            _heartbeat_stale_minutes = 10
    except ValueError:
        _heartbeat_stale_minutes = 10

    reload_integrations_from_rows(rows)
    return rows
