"""Security helper tests."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest

from fastapi import HTTPException

from app.config import get_env_settings
from app.deps import require_admin_user
from app.models.user import User
from app.enrichment.ip_gather import gather_ips_from_event, observation_ips
from app.enrichment.ip_utils import is_public_ip
from app.rate_limit import check_rate_limit, reset_rate_limits_for_tests
from app.services.backup_store import (
    _safe_filename,
    resolve_artifact_download_path,
    server_artifact_path,
    write_verified_stream,
)
from app.ssrf import UnsafeTargetError, assert_safe_host, assert_safe_url


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


@pytest.mark.asyncio
async def test_require_admin_user_rejects_non_admin() -> None:
    user = User(email="user@example.com", hashed_password="x", is_active=True, is_admin=False)
    with pytest.raises(HTTPException) as exc:
        await require_admin_user(user)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_write_verified_stream_writes_and_hashes(tmp_path: Path) -> None:
    payload = [b"watch", b"pot", b"-", b"backup"]
    expected = "84f0b5f7c640e5c3eaf93191b2744a2f25f6e927c72e4a647ab06605a9ef1294"
    dest = tmp_path / "artifact.tar"

    async def chunks():
        for chunk in payload:
            yield chunk

    ok, digest = await write_verified_stream(dest, chunks(), expected)
    assert ok is True
    assert digest == expected
    assert dest.read_bytes() == b"".join(payload)


def test_ssrf_blocks_loopback_and_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WATCHPOT_STACK_MODE", "full")
    monkeypatch.setenv("WATCHPOT_INTEGRATION_ALLOW_LOOPBACK", "false")
    get_env_settings.cache_clear()
    try:
        with pytest.raises(UnsafeTargetError):
            assert_safe_url("http://127.0.0.1:9200/")
        with pytest.raises(UnsafeTargetError):
            assert_safe_url("http://169.254.169.254/latest/meta-data")
        with pytest.raises(UnsafeTargetError):
            assert_safe_url("http://metadata.google.internal/")
        with pytest.raises(UnsafeTargetError):
            assert_safe_url("file:///etc/passwd")
        with pytest.raises(UnsafeTargetError):
            assert_safe_host("169.254.169.254")
        assert_safe_url("https://8.8.8.8/health")
    finally:
        get_env_settings.cache_clear()


def test_ssrf_allows_loopback_when_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WATCHPOT_INTEGRATION_ALLOW_LOOPBACK", "true")
    get_env_settings.cache_clear()
    try:
        assert_safe_url("http://127.0.0.1:3100/loki/api/v1/push")
    finally:
        get_env_settings.cache_clear()


def test_rate_limit_trips_after_window() -> None:
    reset_rate_limits_for_tests()
    for _ in range(3):
        check_rate_limit("unit-test", limit=3, window_seconds=60)
    with pytest.raises(HTTPException) as exc:
        check_rate_limit("unit-test", limit=3, window_seconds=60)
    assert exc.value.status_code == 429
    reset_rate_limits_for_tests()


def test_static_enrollment_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WATCHPOT_AGENT_ENROLLMENT_TOKEN", "static-enroll-secret")
    get_env_settings.cache_clear()
    try:
        from app.enrollment import enrollment_token_valid

        assert enrollment_token_valid("static-enroll-secret") is True
        assert enrollment_token_valid("wrong") is False
    finally:
        get_env_settings.cache_clear()
