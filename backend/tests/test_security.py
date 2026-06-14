"""Security helper tests."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest

from app.enrichment.ip_gather import gather_ips_from_event, observation_ips
from app.enrichment.ip_utils import is_public_ip
from app.services.backup_store import _safe_filename, resolve_artifact_download_path, server_artifact_path


def test_is_public_ip_filters_private_and_documentation() -> None:
    assert is_public_ip("8.8.8.8") is True
    assert is_public_ip("192.168.1.1") is False
    assert is_public_ip("127.0.0.1") is False
    assert is_public_ip("203.0.113.1") is False  # TEST-NET-3


def test_gather_ips_from_ssh_log() -> None:
    obs = gather_ips_from_event(
        raw_log="Failed password for root from 8.8.4.4 port 22 ssh2",
        payload=None,
    )
    assert observation_ips(obs) == ["8.8.4.4"]


def test_gather_ips_from_agent_connections() -> None:
    obs = gather_ips_from_event(
        raw_log=None,
        payload={"connections": [{"ip": "1.2.3.4", "port": 2222, "container": "cowrie"}]},
        event_type="watchpot.agent.connections",
    )
    assert observation_ips(obs) == ["1.2.3.4"]


def test_safe_filename_strips_path_traversal() -> None:
    assert _safe_filename("../../etc/passwd") == "passwd"
    assert "/" not in _safe_filename("..\\..\\evil.tar")


def test_resolve_artifact_download_path_rejects_escape(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import app.services.backup_store as store

    root = tmp_path / "backups"
    root.mkdir()
    allowed = root / "ok.tar"
    allowed.write_bytes(b"ok")
    outside = tmp_path / "outside.tar"
    outside.write_bytes(b"no")

    monkeypatch.setattr(store, "BACKUP_ROOT", root)
    assert resolve_artifact_download_path(str(allowed)) == allowed.resolve()
    with pytest.raises(PermissionError):
        resolve_artifact_download_path(str(outside))


def test_server_artifact_path_stays_under_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import app.services.backup_store as store

    monkeypatch.setattr(store, "BACKUP_ROOT", tmp_path)
    pot_id = uuid4()
    job_id = uuid4()
    path = server_artifact_path(pot_id, job_id, "../escape.tar")
    assert path.resolve().is_relative_to(tmp_path.resolve())
