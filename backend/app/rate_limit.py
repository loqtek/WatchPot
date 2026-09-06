"""In-process sliding-window rate limiter (login / register)."""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

from app.config import get_env_settings

_lock = threading.Lock()
_hits: dict[str, deque[float]] = defaultdict(deque)


def client_ip(request: Request) -> str:
    env = get_env_settings()
    if env.trust_proxy:
        forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
        if forwarded:
            return forwarded[:64]
        real = (request.headers.get("x-real-ip") or "").strip()
        if real:
            return real[:64]
    if request.client and request.client.host:
        return request.client.host
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
    else:
        check_rate_limit(f"{action}:{ip}", limit=10, window_seconds=env.auth_rate_window_seconds)


def reset_rate_limits_for_tests() -> None:
    with _lock:
        _hits.clear()
