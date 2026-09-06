"""HttpOnly session cookie + readable CSRF cookie helpers."""

from __future__ import annotations

import secrets

from fastapi import Request, Response

from app.runtime_config import get_access_token_expire_minutes

SESSION_COOKIE = "wp_session"
CSRF_COOKIE = "wp_csrf"
CSRF_HEADER = "X-CSRF-Token"


def cookie_secure(request: Request) -> bool:
    proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
    if proto:
        return proto == "https"
    return request.url.scheme == "https"


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def set_auth_cookies(response: Response, request: Request, *, jwt: str, csrf: str) -> None:
    max_age = get_access_token_expire_minutes() * 60
    secure = cookie_secure(request)
    response.set_cookie(
        SESSION_COOKIE,
        jwt,
        max_age=max_age,
        path="/",
        httponly=True,
        secure=secure,
        samesite="lax",
    )
    response.set_cookie(
        CSRF_COOKIE,
        csrf,
        max_age=max_age,
        path="/",
        httponly=False,
        secure=secure,
        samesite="lax",
    )


def clear_auth_cookies(response: Response, request: Request) -> None:
    secure = cookie_secure(request)
    for name in (SESSION_COOKIE, CSRF_COOKIE):
        response.delete_cookie(name, path="/", secure=secure, httponly=name == SESSION_COOKIE, samesite="lax")


def session_token_from_request(request: Request) -> str | None:
    raw = request.cookies.get(SESSION_COOKIE)
    if raw and raw.strip():
        return raw.strip()
    return None
