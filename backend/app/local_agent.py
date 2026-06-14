"""Dev-only: auto-register a local agent pot and keep agent/.env credentials in sync."""

from __future__ import annotations

import logging
import os
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit_service import write_audit
from app.config import get_env_settings
from app.event_logging import CHANNEL_CONTROL, SOURCE_CONTROL, emit_event
from app.models.pot import Pot
from app.security import generate_agent_key, hash_secret, verify_secret

log = logging.getLogger("watchpot.local_agent")

AUTO_LOCAL_POT_NAME = "local-dev"
REPO_ROOT = Path(__file__).resolve().parents[2]


def agent_dir() -> Path:
    """Agent tree on disk (repo agent/ locally; /agent when mounted in Docker)."""
    if raw := os.environ.get("WATCHPOT_AGENT_DIR"):
        return Path(raw)
    return REPO_ROOT / "agent"


def agent_env_path() -> Path:
    return agent_dir() / ".env"


def agent_env_example_path() -> Path:
    return agent_dir() / "env.example"


ROOT_ENV_PATH = REPO_ROOT / ".env"
_ENV_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


@dataclass
class LocalAgentResult:
    pot_id: str
    created: bool
    credentials_written: bool


def auto_local_agent_enabled() -> bool:
    return get_env_settings().auto_local_agent_enabled()


def _local_agent_api_url() -> str:
    return os.environ.get("WATCHPOT_LOCAL_AGENT_API_URL", "http://127.0.0.1:6040/api").rstrip("/")


def ensure_agent_env_file() -> None:
    """Create agent/.env from env.example when missing."""
    env_path = agent_env_path()
    example_path = agent_env_example_path()
    if env_path.is_file():
        return
    if not example_path.is_file():
        log.warning("Missing %s and env.example — cannot seed agent env", env_path)
        return
    shutil.copy2(example_path, env_path)
    try:
        rel = env_path.relative_to(REPO_ROOT)
    except ValueError:
        rel = env_path
    log.info("Created %s from env.example", rel)


def _read_env_file(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        if _ENV_KEY_RE.match(key):
            out[key] = val.strip()
    return out


def _merge_env_file(path: Path, updates: dict[str, str]) -> None:
    lines: list[str] = []
    if path.is_file():
        lines = path.read_text(encoding="utf-8").splitlines()
    written: set[str] = set()
    merged: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            merged.append(line)
            continue
        key = line.split("=", 1)[0].strip()
        if key in updates:
            merged.append(f"{key}={updates[key]}")
            written.add(key)
        else:
            merged.append(line)
    for key, val in updates.items():
        if key not in written:
            merged.append(f"{key}={val}")
    path.parent.mkdir(parents=True, exist_ok=True)
    text = "\n".join(merged)
    if text and not text.endswith("\n"):
        text += "\n"
    path.write_text(text, encoding="utf-8")


def _read_agent_env_credentials() -> tuple[UUID | None, str]:
    env = _read_env_file(agent_env_path())
    raw_id = env.get("WATCHPOT_POT_ID", "").strip()
    token = env.get("WATCHPOT_AGENT_TOKEN", "").strip()
    if not raw_id:
        return None, token
    try:
        return UUID(raw_id), token
    except ValueError:
        return None, token


async def _find_auto_local_pot(session: AsyncSession) -> Pot | None:
    result = await session.execute(select(Pot).order_by(Pot.created_at.asc()))
    for pot in result.scalars():
        if (pot.meta or {}).get("auto_local_agent"):
            return pot
    return None


async def _agent_env_matches_pot(session: AsyncSession, pot: Pot) -> bool:
    env_pot_id, token = _read_agent_env_credentials()
    if env_pot_id != pot.id or not token:
        return False
    return verify_secret(token, pot.agent_key_hash)


def write_agent_credentials(pot_id: UUID, agent_key: str) -> None:
    ensure_agent_env_file()
    env_path = agent_env_path()
    api_url = _local_agent_api_url()
    work_dir = os.environ.get("WATCHPOT_LOCAL_AGENT_WORK_DIR", "./data")
    updates = {
        "WATCHPOT_API_URL": api_url,
        "WATCHPOT_POT_ID": str(pot_id),
        "WATCHPOT_AGENT_TOKEN": agent_key,
        "WATCHPOT_WORK_DIR": work_dir,
    }
    _merge_env_file(env_path, updates)
    root_updates = {
        "WATCHPOT_POT_ID": str(pot_id),
        "WATCHPOT_AGENT_TOKEN": agent_key,
    }
    if ROOT_ENV_PATH.is_file():
        _merge_env_file(ROOT_ENV_PATH, root_updates)
    try:
        rel = env_path.relative_to(REPO_ROOT)
    except ValueError:
        rel = env_path
    log.info("Wrote local agent credentials for pot %s to %s", pot_id, rel)


async def reconcile_auto_local_agent(
    session: AsyncSession,
    *,
    actor_user_id: UUID | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    reason: str = "startup",
) -> LocalAgentResult | None:
    """Ensure local-dev pot exists and agent/.env has a matching key pair."""
    if not auto_local_agent_enabled():
        log.debug("Auto local agent disabled (WATCHPOT_AUTO_LOCAL_AGENT)")
        return None

    ensure_agent_env_file()
    pot = await _find_auto_local_pot(session)

    env_stale = False
    env_pot_id, _env_token = _read_agent_env_credentials()
    if env_pot_id is not None:
        known = await session.execute(select(Pot).where(Pot.id == env_pot_id))
        if known.scalar_one_or_none() is None:
            log.info(
                "agent/.env references unknown pot %s — will refresh auto local agent credentials",
                env_pot_id,
            )
            env_stale = True

    created = False
    agent_key: str | None = None

    if pot is not None and not env_stale and await _agent_env_matches_pot(session, pot):
        return LocalAgentResult(pot_id=str(pot.id), created=False, credentials_written=False)

    if pot is None:
        agent_key = generate_agent_key()
        pot = Pot(
            name=AUTO_LOCAL_POT_NAME,
            description="Auto-registered local development agent",
            agent_key_hash=hash_secret(agent_key),
            meta={"auto_local_agent": True},
        )
        session.add(pot)
        await session.flush()
        created = True
        await write_audit(
            session,
            action="pot.create",
            actor_user_id=actor_user_id,
            resource_type="pot",
            resource_id=str(pot.id),
            detail={"name": pot.name, "auto_local_agent": True, "reason": reason},
            ip_address=ip_address,
            user_agent=user_agent,
        )
        await emit_event(
            session,
            pot_id=pot.id,
            event_type="watchpot.pot.created",
            severity="info",
            source=SOURCE_CONTROL,
            channel=CHANNEL_CONTROL,
            payload={"name": pot.name, "auto_local_agent": True, "reason": reason},
        )
    else:
        agent_key = generate_agent_key()
        pot.agent_key_hash = hash_secret(agent_key)
        await session.flush()
        await write_audit(
            session,
            action="pot.rotate_agent_key",
            actor_user_id=actor_user_id,
            resource_type="pot",
            resource_id=str(pot.id),
            detail={"name": pot.name, "auto_local_agent": True, "reason": reason},
            ip_address=ip_address,
            user_agent=user_agent,
        )

    assert agent_key is not None
    write_agent_credentials(pot.id, agent_key)
    return LocalAgentResult(pot_id=str(pot.id), created=created, credentials_written=True)


async def ensure_auto_local_agent(
    session: AsyncSession,
    *,
    actor_user_id: UUID,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> LocalAgentResult | None:
    return await reconcile_auto_local_agent(
        session,
        actor_user_id=actor_user_id,
        ip_address=ip_address,
        user_agent=user_agent,
        reason="login",
    )
