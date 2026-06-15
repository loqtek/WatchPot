from __future__ import annotations

import ssl
from pathlib import Path
from urllib.parse import urlparse

from watchpot_agent.config import AgentSettings


def _is_ipv4(host: str) -> bool:
    parts = host.split(".")
    if len(parts) != 4:
        return False
    try:
        return all(0 <= int(part) <= 255 for part in parts)
    except ValueError:
        return False


def httpx_verify(settings: AgentSettings) -> str | bool | ssl.SSLContext:
    """Custom CA file when set; otherwise system trust (or disabled via WATCHPOT_TLS_VERIFY=false).

    IP-based API URLs with watchPot self-signed TLS skip hostname verification while still
    requiring a cert signed by the configured CA (lab/VPS without SAN on the server cert).
    """
    if settings.tls_ca_file:
        path = Path(settings.tls_ca_file).expanduser()
        if path.is_file():
            host = urlparse(settings.api_base_url).hostname or ""
            if _is_ipv4(host):
                ctx = ssl.create_default_context(cafile=str(path))
                ctx.check_hostname = False
                return ctx
            return str(path)
    if not settings.tls_verify:
        return False
    return True
