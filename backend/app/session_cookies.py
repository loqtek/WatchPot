"""HttpOnly session cookie + readable CSRF cookie helpers."""

from __future__ import annotations

import secrets

from fastapi import Request, Response

from app.runtime_config import get_access_token_expire_minutes

SESSION_COOKIE = "wp_session"
PREAUTH_COOKIE = "wp_preauth"
CSRF_COOKIE = "wp_csrf"
CSRF_HEADER = "X-CSRF-Token"
PREAUTH_MAX_AGE = 5 * 60


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


def set_preauth_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(
        PREAUTH_COOKIE,
        token,
        max_age=PREAUTH_MAX_AGE,
        path="/",
        httponly=True,
        secure=cookie_secure(request),
        samesite="lax",
    )


def clear_preauth_cookie(response: Response, request: Request) -> None:
    response.delete_cookie(
        PREAUTH_COOKIE,
        path="/",
        secure=cookie_secure(request),
        httponly=True,
        samesite="lax",
    )


def preauth_token_from_request(request: Request) -> str | None:
    raw = request.cookies.get(PREAUTH_COOKIE)
    if raw and raw.strip():
        return raw.strip()
    return None


def clear_auth_cookies(response: Response, request: Request) -> None:
    secure = cookie_secure(request)
    for name, httponly in (
        (SESSION_COOKIE, True),
        (PREAUTH_COOKIE, True),
        (CSRF_COOKIE, False),
    ):
        response.delete_cookie(name, path="/", secure=secure, httponly=httponly, samesite="lax")


def session_token_from_request(request: Request) -> str | None:
    raw = request.cookies.get(SESSION_COOKIE)
    if raw and raw.strip():
        return raw.strip()
    return None
