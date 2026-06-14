"""Execute operator-queued Docker commands from the control plane."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any
from uuid import UUID

from watchpot_agent.backup_transfer import run_backup_ingest
from watchpot_agent.docker_ops import (
    compose_action,
    compose_down_project,
    docker_backup_container,
    docker_backup_pot,
    docker_container_action,
    docker_exec,
    docker_logs,
    docker_ps_snapshot,
    stack_project_name,
)
from watchpot_agent.reporter import build_infra_events

log = logging.getLogger("watchpot.agent.commands")

COMPOSE_ACTIONS = frozenset({"compose_start", "compose_stop", "compose_restart", "compose_down"})
INFRA_REFRESH_ACTIONS = frozenset(
    {"rm", "kill", "stop", "compose_down", "compose_stop", "infra_refresh", "compose_start", "compose_restart", "start"}
)
# Run interactive / log commands before heavy compose work in the same batch.
_ACTION_ORDER = {
    "logs": 0,
    "exec": 1,
    "infra_refresh": 2,
    "start": 3,
    "stop": 4,
    "restart": 5,
    "kill": 6,
    "compose_start": 7,
    "compose_stop": 8,
    "compose_restart": 9,
    "compose_down": 10,
    "backup_container": 11,
    "backup_pot": 12,
    "backup_ingest": 13,
}


def _sort_pending(pending: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(pending, key=lambda i: _ACTION_ORDER.get((i.get("action") or "").lower(), 99))


def _parse_params(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


async def run_command(
    item: dict[str, Any],
    *,
    work_dir: Path,
    compose_prefix: str,
    desired_by_stack: dict[str, dict[str, Any]],
    api_base_url: str | None = None,
    api_headers: dict[str, str] | None = None,
) -> tuple[str, str | None, str | None]:
    """Returns (status, output, error)."""
    action = (item.get("action") or "").strip().lower()
    params = _parse_params(item.get("params"))
    container = item.get("container")

    if action == "infra_refresh":
        ok, data = docker_ps_snapshot()
        if ok:
            return "completed", json.dumps({"containers": len(data) if isinstance(data, list) else 0}), None
        return "failed", None, str(data)[:4000]

    if action == "logs":
        tail = int(params.get("tail") or 200)
        ok, out = docker_logs(str(container), tail=tail)
        return ("completed" if ok else "failed"), out, None if ok else out

    if action in ("start", "stop", "restart", "kill", "rm"):
        ok, out = docker_container_action(str(container), action)
        return ("completed" if ok else "failed"), out, None if ok else out

    if action == "exec":
        command = params.get("command") or "id && uname -a"
        ok, out = docker_exec(str(container), str(command))
        return ("completed" if ok else "failed"), out, None if ok else out

    if action in ("compose_start", "compose_stop", "compose_restart", "compose_down"):
        stack_id = item.get("stack_id")
        if not stack_id:
            return "failed", None, "missing stack_id"
        project = stack_project_name(compose_prefix, UUID(str(stack_id)))
        desired = desired_by_stack.get(str(stack_id))
        if action == "compose_down" and not desired:
            ok, out = compose_down_project(project, work_dir)
            return ("completed" if ok else "failed"), out, None if ok else out
        if not desired:
            return "failed", None, "stack not in desired state"
        yaml_text = desired.get("compose_yaml") or ""
        ok, out = compose_action(yaml_text, project, work_dir, action)
        return ("completed" if ok else "failed"), out, None if ok else out

    if action == "backup_container":
        if not container:
            return "failed", None, "container required"
        backup_name = str(params.get("backup_name") or container)
        export_tar = bool(params.get("export_tar", True))
        ok, out = docker_backup_container(
            str(container),
            backup_name=backup_name,
            work_root=work_dir,
            export_tar=export_tar,
        )
        return ("completed" if ok else "failed"), out, None if ok else out

    if action == "backup_pot":
        backup_name = str(params.get("backup_name") or "pot-backup")
        export_tar = bool(params.get("export_tar", True))
        ok, out = docker_backup_pot(
            backup_name=backup_name,
            work_root=work_dir,
            export_tar=export_tar,
        )
        return ("completed" if ok else "failed"), out, None if ok else out

    if action == "backup_ingest":
        if not api_base_url or not api_headers:
            return "failed", None, "backup ingest requires API client context"
        ok, out = await run_backup_ingest(
            api_base_url=api_base_url,
            headers=api_headers,
            params=params,
        )
        return ("completed" if ok else "failed"), out, None if ok else out

    return "failed", None, f"unknown action: {action}"


async def process_pending_commands(
    client: Any,
    *,
    work_dir: Path,
    compose_prefix: str,
    desired: list[dict[str, Any]] | None = None,
) -> None:
    try:
        pending = _sort_pending(await client.pending_commands())
    except Exception as e:
        log.warning("pending-commands failed: %s", e)
        return
    if not pending:
        return

    desired_list = desired
    if desired_list is None:
        need_desired = any((item.get("action") or "").lower() in COMPOSE_ACTIONS for item in pending)
        if need_desired:
            try:
                desired_list = await client.desired_state()
            except Exception as e:
                log.warning("desired-state for commands failed: %s", e)
                desired_list = []
        else:
            desired_list = []

    desired_map = {str(d["stack_id"]): d for d in desired_list}
    for item in pending:
        cmd_id = item.get("id")
        if not cmd_id:
            continue
        status, output, error = await run_command(
            item,
            work_dir=work_dir,
            compose_prefix=compose_prefix,
            desired_by_stack=desired_map,
            api_base_url=getattr(client, "_settings", None) and client._settings.api_base_url,
            api_headers=getattr(client, "_headers", None),
        )
        try:
            await client.complete_command(cmd_id, status=status, output=output, error=error)
            log.info("command %s %s -> %s", cmd_id, item.get("action"), status)
        except Exception as e:
            log.warning("complete command %s failed: %s", cmd_id, e)

    if any(((i.get("action") or "").lower() in INFRA_REFRESH_ACTIONS for i in pending)):
        try:
            batch = build_infra_events()
            if batch:
                await client.post_events(batch)
        except Exception as e:
            log.warning("infra refresh post failed: %s", e)
