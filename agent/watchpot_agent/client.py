from typing import Any

import httpx

from watchpot_agent.config import AgentSettings
from watchpot_agent.tls import httpx_verify


class ControlClient:
    def __init__(self, settings: AgentSettings) -> None:
        self._settings = settings
        self._verify = httpx_verify(settings)
        pid = settings.pot_id.strip()
        self._headers = {
            "Authorization": f"Bearer {settings.agent_token}",
            "X-WatchPot-Pot-Id": pid,
            # Legacy name — some proxies/docs only allow this header; mirrors pot UUID.
            "X-WatchPot-Node-Id": pid,
        }

    async def me(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=30.0, verify=self._verify) as client:
            r = await client.get(
                f"{self._settings.api_base_url.rstrip('/')}/agent/v1/me",
                headers=self._headers,
            )
            r.raise_for_status()
            return r.json()

    async def heartbeat(self, meta: dict[str, Any] | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if meta:
            body["meta"] = meta
        async with httpx.AsyncClient(timeout=60.0, verify=self._verify) as client:
            r = await client.post(
                f"{self._settings.api_base_url.rstrip('/')}/agent/v1/heartbeat",
                headers=self._headers,
                json=body,
            )
            r.raise_for_status()
            return r.json()

    async def desired_state(self) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=120.0, verify=self._verify) as client:
            r = await client.get(
                f"{self._settings.api_base_url.rstrip('/')}/agent/v1/desired-state",
                headers=self._headers,
            )
            r.raise_for_status()
            return r.json()

    async def post_events(self, events: list[dict[str, Any]]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=120.0, verify=self._verify) as client:
            r = await client.post(
                f"{self._settings.api_base_url.rstrip('/')}/agent/v1/events",
                headers=self._headers,
                json={"events": events},
            )
            r.raise_for_status()
            return r.json()

    async def pending_commands(self) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=60.0, verify=self._verify) as client:
            r = await client.get(
                f"{self._settings.api_base_url.rstrip('/')}/agent/v1/pending-commands",
                headers=self._headers,
            )
            r.raise_for_status()
            return r.json()

    async def complete_command(
        self,
        command_id: str,
        *,
        status: str,
        output: str | None = None,
        error: str | None = None,
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=120.0, verify=self._verify) as client:
            r = await client.post(
                f"{self._settings.api_base_url.rstrip('/')}/agent/v1/commands/{command_id}/complete",
                headers=self._headers,
                json={"status": status, "output": output, "error": error},
            )
            r.raise_for_status()
            return r.json()
