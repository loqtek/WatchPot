"""In-process sliding-window rate limiter (login / register / TOTP)."""

from __future__ import annotations

import ipaddress
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

from app.config import get_env_settings

_lock = threading.Lock()
_hits: dict[str, deque[float]] = defaultdict(deque)


def _valid_ip(value: str) -> str | None:
    raw = (value or "").strip()
    if not raw:
        return None
    try:
        return str(ipaddress.ip_address(raw))[:64]
    except ValueError:
        return None


def client_ip(request: Request) -> str:
    """Client address for rate limits.

    When the TLS proxy is trusted, nginx overwrites X-Real-IP with the TCP peer
    and appends that peer to X-Forwarded-For. Earlier forwarded hops are whatever
    the caller sent, so they are not used.
    """
    env = get_env_settings()
    if env.trust_proxy:
        real = _valid_ip(request.headers.get("x-real-ip") or "")
        if real:
            return real
        forwarded = [part.strip() for part in (request.headers.get("x-forwarded-for") or "").split(",")]
        for part in reversed(forwarded):
            parsed = _valid_ip(part)
            if parsed:
                return parsed
    if request.client and request.client.host:
        direct = _valid_ip(request.client.host)
        if direct:
            return direct
        return request.client.host[:64]
    return "unknown"


def check_rate_limit(key: str, *, limit: int, window_seconds: int) -> None:
    now = time.monotonic()
    cutoff = now - window_seconds
    with _lock:
        bucket = _hits[key]
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= limit:
            retry = int(bucket[0] + window_seconds - now) + 1
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many attempts. Try again later.",
                headers={"Retry-After": str(max(retry, 1))},
            )
        bucket.append(now)


def enforce_auth_rate_limit(request: Request, action: str) -> None:
    env = get_env_settings()
    ip = client_ip(request)
    if action == "login":
        check_rate_limit(f"login:{ip}", limit=env.auth_login_rate_limit, window_seconds=env.auth_rate_window_seconds)
    elif action == "register":
        check_rate_limit(
            f"register:{ip}",
            limit=env.auth_register_rate_limit,
            window_seconds=env.auth_rate_window_seconds,
        )
    elif action == "totp":
        check_rate_limit(f"totp:{ip}", limit=env.auth_login_rate_limit, window_seconds=env.auth_rate_window_seconds)
    else:
        check_rate_limit(f"{action}:{ip}", limit=10, window_seconds=env.auth_rate_window_seconds)


def reset_rate_limits_for_tests() -> None:
    with _lock:
        _hits.clear()
