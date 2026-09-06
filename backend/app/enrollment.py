"""Short-lived enrollment tokens for public agent assets."""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from jose import JWTError, jwt

from app.config import get_env_settings
from app.runtime_config import get_jwt_algorithm, get_jwt_secret

ENROLL_TYP = "enroll"


def public_agent_open() -> bool:
    return get_env_settings().public_agent_open_enabled()


def enrollment_ttl_minutes() -> int:
    return max(5, min(get_env_settings().agent_enrollment_ttl_minutes, 24 * 60))


def create_enrollment_token(*, pot_id: UUID | str | None = None) -> str:
    minutes = enrollment_ttl_minutes()
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "typ": ENROLL_TYP,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=minutes)).timestamp()),
        "jti": secrets.token_urlsafe(16),
    }
    if pot_id is not None:
        payload["pot"] = str(pot_id)
    return jwt.encode(payload, get_jwt_secret(), algorithm=get_jwt_algorithm())


def enrollment_token_valid(token: str) -> bool:
    raw = (token or "").strip()
    if not raw:
        return False
    static = (get_env_settings().agent_enrollment_token or "").strip()
    if static and len(raw) == len(static) and secrets.compare_digest(raw, static):
        return True
    try:
        secret = get_jwt_secret()
    except RuntimeError:
        return False
    try:
        payload = jwt.decode(raw, secret, algorithms=[get_jwt_algorithm()])
    except JWTError:
        return False
    return payload.get("typ") == ENROLL_TYP
