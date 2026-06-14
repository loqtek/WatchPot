"""Server-side backup artifact storage with SHA-256 verification."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from uuid import UUID

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKUP_ROOT = REPO_ROOT / "data" / "backups"


def ensure_backup_root() -> Path:
    BACKUP_ROOT.mkdir(parents=True, exist_ok=True)
    return BACKUP_ROOT


def _safe_filename(name: str) -> str:
    base = Path(name).name
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", base).strip("-")
    return cleaned or "backup.tar"


def server_artifact_path(pot_id: UUID, job_id: UUID, filename: str) -> Path:
    ensure_backup_root()
    dest_dir = BACKUP_ROOT / str(pot_id) / str(job_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    return dest_dir / _safe_filename(filename)


def resolve_artifact_download_path(server_path: str) -> Path:
    """Resolve a stored artifact path and ensure it stays under BACKUP_ROOT."""
    root = ensure_backup_root().resolve()
    path = Path(server_path).resolve()
    if not path.is_file():
        raise FileNotFoundError("artifact file missing")
    try:
        path.relative_to(root)
    except ValueError as e:
        raise PermissionError("artifact path outside backup root") from e
    return path


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def write_verified_upload(dest: Path, data: bytes, expected_sha256: str) -> tuple[bool, str]:
    """Write bytes and verify SHA-256. Deletes file on mismatch."""
    digest = hashlib.sha256(data).hexdigest()
    expected = expected_sha256.strip().lower()
    if digest != expected:
        return False, f"SHA-256 mismatch: expected {expected}, got {digest}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return True, digest


def write_verified_stream(dest: Path, chunks: list[bytes], expected_sha256: str) -> tuple[bool, str]:
    h = hashlib.sha256()
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("wb") as f:
        for chunk in chunks:
            h.update(chunk)
            f.write(chunk)
    digest = h.hexdigest()
    expected = expected_sha256.strip().lower()
    if digest != expected:
        dest.unlink(missing_ok=True)
        return False, f"SHA-256 mismatch: expected {expected}, got {digest}"
    return True, digest
