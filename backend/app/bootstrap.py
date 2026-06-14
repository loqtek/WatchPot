"""First-run defaults: app_settings rows and initial admin user."""

from __future__ import annotations

import json
import logging
import os
import secrets
import string

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_env_settings
from app.models.app_setting import AppSetting
from app.models.user import User
from app.runtime_config import load_settings_from_db
from app.security import hash_secret
from app.settings_keys import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    ALLOW_PUBLIC_REGISTRATION,
    BOOTSTRAP_VERSION,
    CORS_ORIGINS,
    DEFAULT_ADMIN_EMAIL,
    DEFAULT_ADMIN_USERNAME_HINT,
    DEPLOYMENT_STACK_MODE,
    ENRICHMENT_CONFIG,
    EXTERNAL_LOG_PATHS,
    HEARTBEAT_STALE_MINUTES,
    JWT_ALGORITHM,
    JWT_SECRET,
    SIEM_INTEGRATIONS,
)
from app.integrations.config import (
    DEFAULT_INTEGRATIONS,
    config_to_json,
    needs_integrations_migration,
    parse_integrations_json,
)
from app.enrichment.bootstrap import ensure_builtin_rules, ensure_default_schedules
from app.enrichment.config import DEFAULT_ENRICHMENT_CONFIG, config_to_json as enrichment_config_to_json
from app.enrichment.cve import ensure_catalog_cves, seed_cve_cache

log = logging.getLogger("watchpot.bootstrap")


def _generate_admin_password(length: int = 20) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


async def _has_setting(session: AsyncSession, key: str) -> bool:
    r = await session.execute(select(AppSetting).where(AppSetting.key == key))
    return r.scalar_one_or_none() is not None


async def ensure_app_settings(
    session: AsyncSession,
    *,
    deployment_stack_mode: str = "full",
    cors_origins: str | None = None,
    external_log_paths_json: str | None = None,
) -> None:
    if not await _has_setting(session, JWT_SECRET):
        paths = external_log_paths_json if external_log_paths_json is not None else "[]"
        cors = cors_origins or "http://localhost:3020,http://127.0.0.1:3020"
        defaults: list[tuple[str, str]] = [
            (JWT_SECRET, secrets.token_hex(32)),
            (JWT_ALGORITHM, "HS256"),
            (ACCESS_TOKEN_EXPIRE_MINUTES, str(60 * 24)),
            (CORS_ORIGINS, cors),
            (EXTERNAL_LOG_PATHS, paths),
            (DEPLOYMENT_STACK_MODE, deployment_stack_mode),
            (ALLOW_PUBLIC_REGISTRATION, "false"),
            (BOOTSTRAP_VERSION, "1"),
            (HEARTBEAT_STALE_MINUTES, "10"),
            (SIEM_INTEGRATIONS, config_to_json(DEFAULT_INTEGRATIONS)),
            (ENRICHMENT_CONFIG, enrichment_config_to_json(DEFAULT_ENRICHMENT_CONFIG)),
        ]
        for key, value in defaults:
            session.add(AppSetting(key=key, value=value))
        await session.flush()
        log.info("Initialized app_settings with generated JWT secret and defaults")


async def ensure_post_bootstrap_settings(session: AsyncSession) -> None:
    """Insert newer app_settings keys on existing databases (first install gets these via ensure_app_settings)."""
    if not await _has_setting(session, HEARTBEAT_STALE_MINUTES):
        session.add(AppSetting(key=HEARTBEAT_STALE_MINUTES, value="10"))
    if not await _has_setting(session, SIEM_INTEGRATIONS):
        session.add(AppSetting(key=SIEM_INTEGRATIONS, value=config_to_json(DEFAULT_INTEGRATIONS)))
    else:
        r = await session.execute(select(AppSetting).where(AppSetting.key == SIEM_INTEGRATIONS))
        row = r.scalar_one_or_none()
        if row is not None and needs_integrations_migration(row.value):
            row.value = config_to_json(parse_integrations_json(row.value))
            log.info("Migrated siem_integrations to current schema (stable integration IDs)")
    if not await _has_setting(session, ENRICHMENT_CONFIG):
        session.add(AppSetting(key=ENRICHMENT_CONFIG, value=enrichment_config_to_json(DEFAULT_ENRICHMENT_CONFIG)))
    await ensure_builtin_rules(session)
    await ensure_default_schedules(session)
    await ensure_catalog_cves(session)
    await seed_cve_cache(session)
    await session.flush()


async def ensure_admin_user(session: AsyncSession) -> None:
    r = await session.execute(select(User).where(User.email == DEFAULT_ADMIN_EMAIL))
    if r.scalar_one_or_none() is not None:
        return

    password = _generate_admin_password()
    user = User(
        email=DEFAULT_ADMIN_EMAIL,
        username=DEFAULT_ADMIN_USERNAME_HINT,
        hashed_password=hash_secret(password),
        is_active=True,
    )
    session.add(user)
    await session.flush()

    if get_env_settings().log_bootstrap_password_enabled():
        border = "=" * 72
        log.warning(border)
        log.warning("watchPot INITIAL ADMIN — sign in with this account once, then change the password.")
        log.warning("  Username / email: %s  (you may also type: wpadmin)", DEFAULT_ADMIN_EMAIL)
        log.warning("  Password: %s", password)
        log.warning(border)
    else:
        log.warning(
            "watchPot INITIAL ADMIN created (%s). Password not logged — reset via setup or DB if needed.",
            DEFAULT_ADMIN_EMAIL,
        )


async def run_bootstrap(
    session: AsyncSession,
    *,
    deployment_stack_mode: str | None = None,
    cors_origins: str | None = None,
    external_log_paths: list[str] | None = None,
) -> None:
    dmode = (
        deployment_stack_mode
        or os.environ.get("WATCHPOT_STACK_MODE")
        or "full"
    )
    cors = cors_origins or os.environ.get("WATCHPOT_CORS_ORIGINS")
    paths_json: str | None = None
    if external_log_paths is not None:
        paths_json = json.dumps(external_log_paths)
    elif raw := os.environ.get("WATCHPOT_EXTERNAL_LOG_PATHS_JSON"):
        paths_json = raw
    await ensure_app_settings(
        session,
        deployment_stack_mode=dmode,
        cors_origins=cors,
        external_log_paths_json=paths_json,
    )
    await ensure_post_bootstrap_settings(session)
    await ensure_admin_user(session)
    await load_settings_from_db(session)
