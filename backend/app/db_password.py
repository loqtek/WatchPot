"""Generate and store the local Postgres/MySQL password.

Well-known defaults (watchpot, change-me-now) are replaced. The value lives in
the repo-root .env, which compose interpolates into POSTGRES_PASSWORD.
"""

from __future__ import annotations

import os
import secrets
import string
from pathlib import Path

WEAK_DB_PASSWORDS = frozenset(
    {
        "",
        "watchpot",
        "change-me-now",
        "watchpot_root_setup_only",
        "replace-me",
    }
)


def generate_db_password(length: int = 32) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _read_lines(path: Path) -> list[str]:
    if not path.is_file():
        return []
    return path.read_text(encoding="utf-8").splitlines()


def env_get(lines: list[str], key: str) -> str | None:
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        name, _, value = stripped.partition("=")
        if name.strip() == key:
            return value.strip().strip('"').strip("'")
    return None


def env_set(lines: list[str], key: str, value: str) -> list[str]:
    out: list[str] = []
    found = False
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            name = stripped.partition("=")[0].strip()
            if name == key:
                out.append(f"{key}={value}")
                found = True
                continue
        out.append(line)
    if not found:
        if out and out[-1].strip():
            out.append("")
        out.append(f"{key}={value}")
    return out


def write_private_env(path: Path, lines: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = "\n".join(lines).rstrip() + "\n"
    path.write_text(text, encoding="utf-8")
    os.chmod(path, 0o600)


def ensure_db_password(env_path: Path) -> str:
    """Return a strong POSTGRES_PASSWORD, writing it when missing or well-known."""
    lines = _read_lines(env_path)
    current = env_get(lines, "POSTGRES_PASSWORD") or ""
    if current not in WEAK_DB_PASSWORDS and len(current) >= 16:
        write_private_env(env_path, lines)
        return current
    password = generate_db_password()
    write_private_env(env_path, env_set(lines, "POSTGRES_PASSWORD", password))
    return password


def replace_url_password(url: str, password: str) -> str:
    """Replace the userinfo password in a SQLAlchemy URL. Password is unreserved."""
    scheme, sep, rest = url.partition("://")
    if not sep or "@" not in rest:
        return url
    userinfo, at, host = rest.partition("@")
    if ":" not in userinfo:
        return url
    user, _, _old = userinfo.partition(":")
    return f"{scheme}://{user}:{password}@{host}"
