import re

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.config import get_env_settings

# Browsers talking to a local API may use any loopback port (Next, Vite, Bun, etc.).
_LOOPBACK_ORIGIN = re.compile(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?/?$")


def _expand_localhost_variants(origins: list[str]) -> frozenset[str]:
    """Treat localhost and 127.0.0.1 as interchangeable for the same port."""
    out: set[str] = set(origins)
    for o in list(origins):
        if "://localhost" in o:
            out.add(o.replace("://localhost", "://127.0.0.1", 1))
        if "://127.0.0.1" in o:
            out.add(o.replace("://127.0.0.1", "://localhost", 1))
    return frozenset(out)


def _origin_allowed(origin: str, allowed: frozenset[str], *, allow_loopback: bool) -> bool:
    if origin in allowed:
        return True
    if allow_loopback:
        return bool(_LOOPBACK_ORIGIN.match(origin.rstrip("/")))
    return False


class DynamicCORSMiddleware(BaseHTTPMiddleware):
    """CORS: DB allow-list; optional loopback wildcard for local dev only."""

    async def dispatch(self, request: Request, call_next):
        allow_loopback = get_env_settings().allow_loopback_cors_enabled()
        raw: list[str] = getattr(request.app.state, "cors_origins", None) or [
            "http://localhost:3020",
            "http://127.0.0.1:3020",
        ]
        allowed = _expand_localhost_variants(raw)
        origin = request.headers.get("origin")
        acrh = request.headers.get("access-control-request-headers")

        if request.method == "OPTIONS":
            # Never forward OPTIONS to route handlers (POST-only routes return 405).
            if origin and _origin_allowed(origin, allowed, allow_loopback=allow_loopback):
                return Response(
                    status_code=200,
                    headers={
                        "Access-Control-Allow-Origin": origin,
                        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
                        "Access-Control-Allow-Headers": acrh
                        or "authorization,content-type,x-watchpot-pot-id,x-watchpot-node-id",
                        "Access-Control-Allow-Credentials": "true",
                        "Access-Control-Max-Age": "600",
                    },
                )
            if origin:
                return Response(status_code=403)
            return Response(status_code=200)

        response = await call_next(request)
        if origin and _origin_allowed(origin, allowed, allow_loopback=allow_loopback):
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
        return response
