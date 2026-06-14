import hashlib
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID


def resolve_work_root(work_root: Path) -> Path:
    """Absolute work dir — relative WATCHPOT_WORK_DIR (e.g. ./data) breaks compose -f paths."""
    return work_root.expanduser().resolve()


def compose_up(compose_yaml: str, project_name: str, work_root: Path) -> tuple[bool, str]:
    root = resolve_work_root(work_root)
    stack_dir = root / "stacks" / project_name
    stack_dir.mkdir(parents=True, exist_ok=True)
    compose_path = stack_dir / "docker-compose.yml"
    compose_path.write_text(compose_yaml, encoding="utf-8")
    env = os.environ.copy()
    try:
        proc = subprocess.run(
            ["docker", "compose", "-f", str(compose_path), "-p", project_name, "up", "-d", "--remove-orphans"],
            cwd=str(stack_dir),
            env=env,
            capture_output=True,
            text=True,
            timeout=600,
        )
        out = (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else "")
        return proc.returncode == 0, out.strip() or f"exit {proc.returncode}"
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, str(e)


def docker_ps_snapshot() -> tuple[bool, list[dict[str, str]] | str]:
    """Return parsed `docker ps -a` rows (JSON lines) or error text."""
    try:
        proc = subprocess.run(
            ["docker", "ps", "-a", "--no-trunc", "--format", "{{json .}}"],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if proc.returncode != 0:
            return False, (proc.stderr or proc.stdout or f"exit {proc.returncode}")[:4000]
        rows: list[dict[str, str]] = []
        for line in (proc.stdout or "").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return True, rows
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, str(e)


def docker_ping() -> tuple[bool, str]:
    try:
        proc = subprocess.run(
            ["docker", "info"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        return proc.returncode == 0, (proc.stderr or proc.stdout or "")[:500]
    except OSError as e:
        return False, str(e)


def stack_project_name(prefix: str, stack_id: UUID) -> str:
    safe = str(stack_id).replace("-", "")[:12]
    return f"{prefix}_{safe}"


def docker_logs(container: str, *, tail: int = 200) -> tuple[bool, str]:
    tail = max(1, min(int(tail), 5000))
    try:
        proc = subprocess.run(
            ["docker", "logs", "--tail", str(tail), container],
            capture_output=True,
            text=True,
            timeout=45,
        )
        out = (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else "")
        return proc.returncode == 0, out.strip() or f"exit {proc.returncode}"
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, str(e)


def docker_container_action(container: str, action: str) -> tuple[bool, str]:
    allowed = {"start", "stop", "restart", "kill", "rm"}
    if action not in allowed:
        return False, f"unsupported action: {action}"
    cmd = ["docker", "rm", "-f", container] if action == "rm" else ["docker", action, container]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120,
        )
        out = (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else "")
        return proc.returncode == 0, out.strip() or f"exit {proc.returncode}"
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, str(e)


def docker_exec(container: str, command: str) -> tuple[bool, str]:
    cmd = ["docker", "exec", container, "sh", "-c", command]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        out = (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else "")
        return proc.returncode == 0, out.strip() or f"exit {proc.returncode}"
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, str(e)


def compose_down_project(project_name: str, work_root: Path) -> tuple[bool, str]:
    """Tear down a stack from on-disk compose (used when control plane no longer lists it)."""
    root = resolve_work_root(work_root)
    stack_dir = root / "stacks" / project_name
    compose_path = stack_dir / "docker-compose.yml"
    if not compose_path.is_file():
        return True, "no compose file on disk"
    try:
        proc = subprocess.run(
            ["docker", "compose", "-f", str(compose_path), "-p", project_name, "down", "--remove-orphans"],
            cwd=str(stack_dir),
            capture_output=True,
            text=True,
            timeout=600,
        )
        out = (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else "")
        return proc.returncode == 0, out.strip() or f"exit {proc.returncode}"
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, str(e)


def compose_action(
    compose_yaml: str,
    project_name: str,
    work_root: Path,
    action: str,
) -> tuple[bool, str]:
    """action: start | stop | restart | down"""
    root = resolve_work_root(work_root)
    stack_dir = root / "stacks" / project_name
    compose_path = stack_dir / "docker-compose.yml"
    if not compose_path.is_file():
        compose_path.parent.mkdir(parents=True, exist_ok=True)
        compose_path.write_text(compose_yaml, encoding="utf-8")
    subcmd = {
        "compose_start": ["up", "-d"],
        "compose_stop": ["stop"],
        "compose_restart": ["restart"],
        "compose_down": ["down", "--remove-orphans"],
    }.get(action)
    if not subcmd:
        return False, f"unknown compose action: {action}"
    try:
        proc = subprocess.run(
            ["docker", "compose", "-f", str(compose_path), "-p", project_name, *subcmd],
            cwd=str(stack_dir),
            capture_output=True,
            text=True,
            timeout=600,
        )
        out = (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else "")
        return proc.returncode == 0, out.strip() or f"exit {proc.returncode}"
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, str(e)


def _safe_slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:48] or "backup"


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def _write_manifest(backups_dir: Path, manifest_name: str, payload: dict) -> str:
    manifest_path = backups_dir / manifest_name
    manifest_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return str(manifest_path)


def _image_id_from_inspect(image_ref: str) -> str | None:
    try:
        proc = subprocess.run(
            ["docker", "image", "inspect", image_ref, "--format", "{{.Id}}"],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if proc.returncode != 0:
            return None
        return (proc.stdout or "").strip() or None
    except (OSError, subprocess.TimeoutExpired):
        return None


def docker_backup_container(
    container: str,
    *,
    backup_name: str,
    work_root: Path,
    export_tar: bool = True,
) -> tuple[bool, str]:
    """Commit a container to an image and optionally export a portable tar."""
    root = resolve_work_root(work_root)
    backups_dir = root / "backups"
    backups_dir.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    slug = _safe_slug(backup_name or container)
    image_ref = f"watchpot/backup-{slug}:{stamp}"

    try:
        commit = subprocess.run(
            ["docker", "commit", container, image_ref],
            capture_output=True,
            text=True,
            timeout=600,
        )
        if commit.returncode != 0:
            err = (commit.stderr or commit.stdout or f"exit {commit.returncode}")[:4000]
            return False, err

        image_id = _image_id_from_inspect(image_ref)
        artifact_path: str | None = None
        artifact_size: int | None = None
        artifact_sha256: str | None = None
        artifact_format: str | None = None

        if export_tar:
            tar_name = f"{slug}-{stamp}.tar"
            tar_path = backups_dir / tar_name
            save = subprocess.run(
                ["docker", "save", "-o", str(tar_path), image_ref],
                capture_output=True,
                text=True,
                timeout=1800,
            )
            if save.returncode != 0:
                err = (save.stderr or save.stdout or f"exit {save.returncode}")[:4000]
                return False, err
            artifact_path = str(tar_path.resolve())
            artifact_format = "tar"
            try:
                artifact_size = tar_path.stat().st_size
                artifact_sha256 = _sha256_file(tar_path)
            except OSError:
                artifact_size = None

        payload = {
            "backup_type": "container",
            "container": container,
            "image_reference": image_ref,
            "image_id": image_id,
            "artifact_path": artifact_path,
            "artifact_size": artifact_size,
            "artifact_format": artifact_format,
            "artifact_sha256": artifact_sha256,
            "storage_location": "agent",
            "work_dir": str(root),
        }
        if artifact_path and artifact_sha256:
            payload["manifest_path"] = _write_manifest(
                backups_dir,
                f"{slug}-{stamp}.manifest.json",
                payload,
            )
        return True, json.dumps(payload)
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, str(e)


def docker_backup_pot(
    *,
    backup_name: str,
    work_root: Path,
    export_tar: bool = True,
) -> tuple[bool, str]:
    """Backup all containers on this Docker host."""
    ok, data = docker_ps_snapshot()
    if not ok:
        return False, str(data)[:4000]
    if not isinstance(data, list) or not data:
        return False, "No containers found on this pot"

    entries: list[dict[str, str | int | None]] = []
    total_size = 0
    errors: list[str] = []

    for row in data:
        name = str(row.get("Names") or row.get("Name") or "").lstrip("/")
        if not name:
            continue
        child_name = f"{backup_name}-{name}"
        ok_one, out = docker_backup_container(
            name,
            backup_name=child_name,
            work_root=work_root,
            export_tar=export_tar,
        )
        if not ok_one:
            errors.append(f"{name}: {out[:200]}")
            continue
        try:
            entry = json.loads(out)
        except json.JSONDecodeError:
            errors.append(f"{name}: invalid backup metadata")
            continue
        if isinstance(entry, dict):
            entries.append(entry)
            size = entry.get("artifact_size")
            if isinstance(size, int):
                total_size += size

    if not entries:
        return False, "; ".join(errors)[:4000] or "All container backups failed"

    root = resolve_work_root(work_root)
    backups_dir = root / "backups"
    payload = {
        "backup_type": "pot",
        "containers": entries,
        "total_size": total_size,
        "failed": errors,
        "storage_location": "agent",
        "work_dir": str(root),
    }
    if entries:
        payload["manifest_path"] = _write_manifest(
            backups_dir,
            f"{_safe_slug(backup_name)}-pot.manifest.json",
            payload,
        )
    return True, json.dumps(payload)
