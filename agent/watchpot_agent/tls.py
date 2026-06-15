from __future__ import annotations

from pathlib import Path

from watchpot_agent.config import AgentSettings


def httpx_verify(settings: AgentSettings) -> str | bool:
    """Custom CA file when set; otherwise system trust (or disabled via WATCHPOT_TLS_VERIFY=false)."""
    if settings.tls_ca_file:
        path = Path(settings.tls_ca_file).expanduser()
        if path.is_file():
            return str(path)
    if not settings.tls_verify:
        return False
    return True
