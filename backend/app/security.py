import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from jose import JWTError, jwt

from app.runtime_config import get_access_token_expire_minutes, get_jwt_algorithm, get_jwt_secret


def hash_secret(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_secret(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def generate_agent_key() -> str:
    return f"wp_{secrets.token_urlsafe(32)}"


def create_access_token(
    subject: str,
    extra: dict[str, Any] | None = None,
    *,
    session_version: int,
    expire_minutes: int | None = None,
) -> str:
    minutes = expire_minutes if expire_minutes is not None else get_access_token_expire_minutes()
    expire = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    to_encode: dict[str, Any] = {
        "sub": subject,
        "exp": expire,
        "sv": int(session_version),
        "typ": "access",
    }
    if extra:
        to_encode.update(extra)
    return jwt.encode(to_encode, get_jwt_secret(), algorithm=get_jwt_algorithm())


def create_preauth_token(subject: str, *, session_version: int) -> str:
    """Short-lived token that only allows completing a TOTP challenge."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=5)
    to_encode: dict[str, Any] = {
        "sub": subject,
        "exp": expire,
        "sv": int(session_version),
        "typ": "preauth",
    }
    return jwt.encode(to_encode, get_jwt_secret(), algorithm=get_jwt_algorithm())


def access_token_matches_user(payload: dict[str, Any], *, session_version: int) -> bool:
    """True only for access tokens issued at the user's current session version."""
    if payload.get("typ") != "access":
        return False
    try:
        return int(payload.get("sv")) == int(session_version)
    except (TypeError, ValueError):
        return False


def decode_access_token(token: str) -> dict[str, Any] | None:
    try:
        return jwt.decode(token, get_jwt_secret(), algorithms=[get_jwt_algorithm()])
    except JWTError:
        return None
