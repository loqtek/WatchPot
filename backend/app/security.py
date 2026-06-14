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


def create_access_token(subject: str, extra: dict[str, Any] | None = None) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=get_access_token_expire_minutes())
    to_encode: dict[str, Any] = {"sub": subject, "exp": expire}
    if extra:
        to_encode.update(extra)
    return jwt.encode(to_encode, get_jwt_secret(), algorithm=get_jwt_algorithm())


def decode_access_token(token: str) -> dict[str, Any] | None:
    try:
        return jwt.decode(token, get_jwt_secret(), algorithms=[get_jwt_algorithm()])
    except JWTError:
        return None
