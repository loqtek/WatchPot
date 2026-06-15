"""Upload backup artifacts from the pot agent to the control server with SHA-256."""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from typing import Any

import httpx

log = logging.getLogger("watchpot.agent.backup_transfer")


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


async def upload_artifact(
    *,
    api_base_url: str,
    headers: dict[str, str],
    job_id: str,
    artifact_id: str,
    artifact_path: str,
    expected_sha256: str,
    verify: str | bool = True,
) -> tuple[bool, str]:
    path = Path(artifact_path)
    if not path.is_file():
        return False, f"artifact not found: {artifact_path}"

    digest = _sha256_file(path)
    if digest != expected_sha256.strip().lower():
        return False, f"local SHA-256 mismatch before upload: expected {expected_sha256}, got {digest}"

    url = f"{api_base_url.rstrip('/')}/agent/v1/backups/upload"
    upload_headers = {
        **headers,
        "X-Backup-Job-Id": job_id,
        "X-Backup-Artifact-Id": artifact_id,
        "X-Sha256": digest,
        "X-Artifact-Format": path.suffix.lstrip(".") or "tar",
    }

    try:
        with path.open("rb") as f:
            files = {"file": (path.name, f, "application/octet-stream")}
            async with httpx.AsyncClient(timeout=httpx.Timeout(1800.0), verify=verify) as client:
                r = await client.post(url, headers=upload_headers, files=files)
        if r.status_code >= 400:
            return False, f"upload HTTP {r.status_code}: {r.text[:500]}"
        data = r.json()
        if not data.get("ok"):
            return False, str(data.get("message") or "upload rejected")
        return True, json.dumps(data)
    except Exception as e:
        log.warning("backup upload failed: %s", e)
        return False, str(e)[:4000]


async def run_backup_ingest(
    *,
    api_base_url: str,
    headers: dict[str, str],
    params: dict[str, Any],
    verify: str | bool = True,
) -> tuple[bool, str]:
    job_id = str(params.get("job_id") or "")
    artifacts = params.get("artifacts")
    if not job_id or not isinstance(artifacts, list) or not artifacts:
        return False, "job_id and artifacts required"

    results: list[dict[str, Any]] = []
    errors: list[str] = []
    for item in artifacts:
        if not isinstance(item, dict):
            continue
        aid = str(item.get("artifact_id") or "")
        path = str(item.get("path") or "")
        sha = str(item.get("sha256") or "")
        if not aid or not path or not sha:
            errors.append("invalid artifact entry")
            continue
        ok, msg = await upload_artifact(
            api_base_url=api_base_url,
            headers=headers,
            job_id=job_id,
            artifact_id=aid,
            artifact_path=path,
            expected_sha256=sha,
            verify=verify,
        )
        if ok:
            try:
                results.append(json.loads(msg))
            except json.JSONDecodeError:
                results.append({"ok": True})
        else:
            errors.append(msg)

    if not results:
        return False, "; ".join(errors)[:4000] or "no artifacts uploaded"

    payload = {"uploaded": len(results), "failed": len(errors), "results": results, "errors": errors}
    return True, json.dumps(payload)
