import asyncio
import logging
import os
import sys
from pathlib import Path
from uuid import UUID

import httpx

from watchpot_agent.client import ControlClient
from watchpot_agent.config import AgentSettings
from watchpot_agent.tls import httpx_verify
from watchpot_agent.docker_ops import compose_down_project, compose_up, docker_ping, stack_project_name
from watchpot_agent.commands import process_pending_commands
from watchpot_agent.reporter import build_infra_events
from watchpot_agent.state import load_state, save_state

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("watchpot.agent")


def _health_url(api_base_url: str) -> str:
    base = api_base_url.rstrip("/")
    if base.endswith("/api"):
        return f"{base[:-4]}/health"
    return f"{base}/health"


async def ensure_connected(
    settings: AgentSettings,
    *,
    wait_for_registration: bool,
) -> tuple[AgentSettings, ControlClient]:
    """Wait for API readiness, optional registration credentials, and successful auth."""
    health_url = _health_url(settings.api_base_url)
    logged_waiting_creds = False
    logged_waiting_api = False
    logged_waiting_auth = False

    while True:
        settings = AgentSettings()
        if wait_for_registration and (not settings.pot_id.strip() or not settings.agent_token.strip()):
            if not logged_waiting_creds:
                log.info(
                    "Waiting for local agent registration (sign in to the UI with WATCHPOT_AUTO_LOCAL_AGENT enabled)…"
                )
                logged_waiting_creds = True
            await asyncio.sleep(2)
            continue

        if not settings.pot_id.strip() or not settings.agent_token.strip():
            log.error("Set WATCHPOT_POT_ID and WATCHPOT_AGENT_TOKEN (legacy WATCHPOT_NODE_ID still works)")
            sys.exit(1)
        try:
            UUID(settings.pot_id.strip())
        except ValueError:
            log.error(
                "WATCHPOT_POT_ID must be the pot UUID from the control plane UI, not the agent key. "
                "Copy it from Pots → All pots (or the env snippet after you create a pot)."
            )
            sys.exit(1)

        try:
            verify = httpx_verify(settings)
            async with httpx.AsyncClient(timeout=5.0, verify=verify) as http:
                health = await http.get(health_url)
                health.raise_for_status()
        except httpx.ConnectError:
            if not logged_waiting_api:
                log.info("Waiting for control plane API at %s …", health_url)
                logged_waiting_api = True
            await asyncio.sleep(2)
            continue
        except httpx.HTTPError as e:
            if not logged_waiting_api:
                log.info("Waiting for control plane API at %s (%s) …", health_url, e)
                logged_waiting_api = True
            await asyncio.sleep(2)
            continue

        client = ControlClient(settings)
        try:
            me = await client.me()
            log.info("Authenticated as pot %s (%s)", me.get("name"), me.get("pot_id"))
            return settings, client
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 401:
                detail = ""
                try:
                    body = e.response.json()
                    if isinstance(body.get("detail"), str):
                        detail = body["detail"]
                except Exception:
                    pass
                if wait_for_registration:
                    if not logged_waiting_auth:
                        log.warning(
                            "Agent credentials rejected (%s) — waiting for API to refresh agent/.env …",
                            detail or "401 Unauthorized",
                        )
                        logged_waiting_auth = True
                    await asyncio.sleep(2)
                    continue
                log.error(
                    "Agent authentication failed. WATCHPOT_POT_ID and WATCHPOT_AGENT_TOKEN must come from "
                    "the same pot registration — each pot has its own UUID and one-time key. "
                    "If you created multiple pots, update .env with a matching pair or rotate the key in the UI.",
                )
                if detail:
                    log.error("API: %s", detail)
                sys.exit(1)
            log.warning("Auth check failed (%s), retrying…", e)
            await asyncio.sleep(2)
        except httpx.ConnectError:
            await asyncio.sleep(2)


async def run_loop(settings: AgentSettings, *, wait_for_registration: bool) -> None:
    settings, client = await ensure_connected(settings, wait_for_registration=wait_for_registration)
    work = Path(settings.work_dir).expanduser().resolve()
    state_path = work / "state.json"
    state = load_state(state_path)
    ok, msg = docker_ping()
    if not ok:
        log.warning("Docker not reachable: %s", msg)

    hb_task: asyncio.Task | None = None
    infra_task: asyncio.Task | None = None
    cmd_task: asyncio.Task | None = None

    async def heartbeat_loop() -> None:
        while True:
            try:
                dv = ""
                ok_d, dmsg = docker_ping()
                if ok_d:
                    dv = dmsg.splitlines()[0][:200] if dmsg else ""
                await client.heartbeat(
                    meta={"docker_ok": ok_d, "docker_hint": dv[:120] if dv else None},
                )
                log.debug("heartbeat ok")
            except Exception as e:
                log.warning("heartbeat failed: %s", e)
            await asyncio.sleep(settings.heartbeat_interval_sec)

    async def infra_loop() -> None:
        while True:
            try:
                batch = build_infra_events()
                if batch:
                    await client.post_events(batch)
                    log.debug("infra snapshot posted (%s events)", len(batch))
            except Exception as e:
                log.warning("infra report failed: %s", e)
            await asyncio.sleep(max(30, settings.infra_report_interval_sec))

    async def command_loop() -> None:
        interval = max(1, settings.command_poll_interval_sec)
        while True:
            try:
                await process_pending_commands(
                    client,
                    work_dir=work,
                    compose_prefix=settings.compose_project_prefix,
                )
            except Exception as e:
                log.warning("command loop error: %s", e)
            await asyncio.sleep(interval)

    hb_task = asyncio.create_task(heartbeat_loop())
    infra_task = asyncio.create_task(infra_loop())
    cmd_task = asyncio.create_task(command_loop())

    try:
        while True:
            try:
                desired = await client.desired_state()
            except Exception as e:
                log.warning("desired-state failed: %s", e)
                await asyncio.sleep(settings.poll_interval_sec)
                continue

            stacks_state = state.get("stacks", {})
            desired_ids = {str(item["stack_id"]) for item in desired}
            removed_any = False
            for key in list(stacks_state.keys()):
                if key in desired_ids:
                    continue
                try:
                    project = stack_project_name(settings.compose_project_prefix, UUID(key))
                    ok, out = compose_down_project(project, work)
                    if ok:
                        log.info("tore down removed stack %s", key)
                    else:
                        log.warning("teardown failed for removed stack %s: %s", key, out[:500])
                except Exception as e:
                    log.warning("teardown error for removed stack %s: %s", key, e)
                stacks_state.pop(key, None)
                removed_any = True
            if removed_any:
                state["stacks"] = stacks_state
                save_state(state_path, state)
            for item in desired:
                sid = item["stack_id"]
                rev = item["revision"]
                rg = int(item.get("restart_generation", 0) or 0)
                key = str(sid)
                prev = stacks_state.get(key, {})
                same_rev = prev.get("revision") == rev
                same_rg = int(prev.get("restart_gen", 0) or 0) == rg
                if same_rev and same_rg and prev.get("ok"):
                    continue
                project = stack_project_name(settings.compose_project_prefix, UUID(sid))
                yaml_text = item["compose_yaml"]
                success, out = compose_up(yaml_text, project, work)
                stacks_state[key] = {
                    "revision": rev,
                    "restart_gen": rg,
                    "ok": success,
                    "last_output": out[-4000:],
                }
                state["stacks"] = stacks_state
                save_state(state_path, state)
                if success:
                    log.info("applied stack %s rev %s restart_gen %s", sid, rev, rg)
                else:
                    log.error("compose failed %s: %s", sid, out[:1000])
            await asyncio.sleep(settings.poll_interval_sec)
    finally:
        for t in (hb_task, infra_task, cmd_task):
            if t:
                t.cancel()
                try:
                    await t
                except asyncio.CancelledError:
                    pass


def main() -> None:
    settings = AgentSettings()
    wait = os.environ.get("WATCHPOT_WAIT_FOR_REGISTRATION", "").lower() in ("1", "true", "yes")
    asyncio.run(run_loop(settings, wait_for_registration=wait))


if __name__ == "__main__":
    main()
