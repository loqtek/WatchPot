"""Public agent enrollment assets (install script + source bundle). No auth required."""

from __future__ import annotations

import io
import tarfile
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse

from app.local_agent import agent_dir

router = APIRouter(prefix="/public/agent", tags=["public-agent"])

_BUNDLE_SKIP_DIRS = {".venv", "__pycache__", "data", ".git"}
_BUNDLE_SKIP_FILES = {".env"}


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


@router.get("/install.sh")
async def get_install_script() -> Response:
    path = _install_script_path()
    if not path.is_file():
        raise HTTPException(status_code=503, detail="Install script unavailable on this server")
    return Response(
        content=path.read_bytes(),
        media_type="text/x-shellscript; charset=utf-8",
        headers={"Cache-Control": "public, max-age=300"},
    )


@router.get("/bundle.tar.gz")
async def get_agent_bundle() -> StreamingResponse:
    data = _build_bundle_bytes()
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/gzip",
        headers={
            "Content-Disposition": 'attachment; filename="watchpot-agent-bundle.tar.gz"',
            "Cache-Control": "public, max-age=300",
        },
    )
