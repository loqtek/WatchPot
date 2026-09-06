"""Public agent enrollment assets (install script + source bundle)."""

from __future__ import annotations

import io
import os
import tarfile
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import Response, StreamingResponse

from app.enrollment import enrollment_token_valid, public_agent_open
from app.local_agent import agent_dir

router = APIRouter(prefix="/public/agent", tags=["public-agent"])

_BUNDLE_SKIP_DIRS = {".venv", "__pycache__", "data", ".git"}
_BUNDLE_SKIP_FILES = {".env"}


def _require_enrollment(
    enrollment: str | None,
    x_watchpot_enrollment: str | None,
) -> None:
    if public_agent_open():
        return
    token = (x_watchpot_enrollment or enrollment or "").strip()
    if enrollment_token_valid(token):
        return
    raise HTTPException(
        status_code=401,
        detail=(
            "Enrollment token required. Pass ?enrollment= or X-WatchPot-Enrollment "
            "from a short-lived token minted in the UI, or set WATCHPOT_PUBLIC_AGENT_OPEN=true for lab use."
        ),
    )


def _ca_cert_paths() -> list[Path]:
    paths: list[Path] = []
    if raw := os.environ.get("WATCHPOT_TLS_CA_FILE"):
        paths.append(Path(raw))
    paths.extend(
        [
            Path("/etc/watchpot/tls/ca.crt"),
            Path("/etc/nginx/tls/ca.crt"),
        ]
    )
    return paths


def _read_ca_cert() -> bytes:
    for path in _ca_cert_paths():
        if path.is_file():
            return path.read_bytes()
    raise HTTPException(status_code=503, detail="TLS CA certificate unavailable on this server")


def _install_script_path() -> Path:
    return agent_dir() / "install.sh"


def _bundle_member(path: Path, root: Path) -> str | None:
    rel = path.relative_to(root)
    parts = rel.parts
    if parts and parts[0] in _BUNDLE_SKIP_DIRS:
        return None
    if path.name in _BUNDLE_SKIP_FILES:
        return None
    if path.suffix == ".pyc":
        return None
    return rel.as_posix()


def _iter_bundle_files(root: Path) -> list[tuple[Path, str]]:
    if not root.is_dir():
        return []
    out: list[tuple[Path, str]] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        arc = _bundle_member(path, root)
        if arc is not None:
            out.append((path, arc))
    return out


def _build_bundle_bytes() -> bytes:
    root = agent_dir()
    files = _iter_bundle_files(root)
    if not files:
        raise HTTPException(status_code=503, detail="Agent bundle unavailable on this server")
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for path, arcname in files:
            tar.add(path, arcname=arcname)
    return buf.getvalue()


@router.get("/ca.crt")
async def get_ca_cert(
    enrollment: str | None = Query(default=None),
    x_watchpot_enrollment: str | None = Header(default=None),
) -> Response:
    _require_enrollment(enrollment, x_watchpot_enrollment)
    return Response(
        content=_read_ca_cert(),
        media_type="application/x-pem-file",
        headers={"Cache-Control": "private, max-age=60"},
    )


@router.get("/install.sh")
async def get_install_script(
    enrollment: str | None = Query(default=None),
    x_watchpot_enrollment: str | None = Header(default=None),
) -> Response:
    _require_enrollment(enrollment, x_watchpot_enrollment)
    path = _install_script_path()
    if not path.is_file():
        raise HTTPException(status_code=503, detail="Install script unavailable on this server")
    return Response(
        content=path.read_bytes(),
        media_type="text/x-shellscript; charset=utf-8",
        headers={"Cache-Control": "private, max-age=60"},
    )


@router.get("/bundle.tar.gz")
async def get_agent_bundle(
    enrollment: str | None = Query(default=None),
    x_watchpot_enrollment: str | None = Header(default=None),
) -> StreamingResponse:
    _require_enrollment(enrollment, x_watchpot_enrollment)
    data = _build_bundle_bytes()
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/gzip",
        headers={
            "Content-Disposition": 'attachment; filename="watchpot-agent-bundle.tar.gz"',
            "Cache-Control": "private, max-age=60",
        },
    )
