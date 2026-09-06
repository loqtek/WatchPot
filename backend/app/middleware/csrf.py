import secrets

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.session_cookies import CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE

_SAFE = frozenset({"GET", "HEAD", "OPTIONS"})
_EXEMPT_PREFIXES = (
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/csrf",
    "/api/public/agent",
    "/api/agent/v1",
    "/health",
    "/metrics",
    "/docs",
    "/redoc",
    "/openapi.json",
)


def _exempt(path: str) -> bool:
    if path == "/api":
        return True
    return any(path == p or path.startswith(p + "/") or path.startswith(p + "?") for p in _EXEMPT_PREFIXES)


class CsrfMiddleware(BaseHTTPMiddleware):
    """Require X-CSRF-Token to match the CSRF cookie when a session cookie is present."""

    async def dispatch(self, request: Request, call_next) -> Response:
        if request.method in _SAFE or _exempt(request.url.path):
            return await call_next(request)

        auth = request.headers.get("authorization") or ""
        if auth.lower().startswith("bearer "):
            return await call_next(request)

        if not request.cookies.get(SESSION_COOKIE):
            return await call_next(request)

        cookie = (request.cookies.get(CSRF_COOKIE) or "").strip()
        header = (request.headers.get(CSRF_HEADER) or "").strip()
        try:
            matched = bool(cookie) and bool(header) and secrets.compare_digest(cookie, header)
        except ValueError:
            matched = False
        if not matched:
            return JSONResponse({"detail": "CSRF token missing or invalid"}, status_code=403)
        return await call_next(request)
