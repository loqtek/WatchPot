"""Time utility tests."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone

import pytest

from app.time_utils import DEFAULT_TIMEZONE, ensure_utc, utc_now, validate_timezone


def test_ensure_utc_naive_becomes_aware() -> None:
    naive = datetime(2024, 6, 1, 12, 0, 0)
    fixed = ensure_utc(naive)
    assert fixed is not None
    assert fixed.tzinfo is not None
    assert fixed.tzinfo == timezone.utc


def test_ensure_utc_aware_stays_comparable_with_utc_now() -> None:
    naive = datetime(2024, 6, 1, 12, 0, 0)
    last_lookup = ensure_utc(naive)
    now = utc_now()
    assert last_lookup < now - timedelta(hours=1)


def test_ensure_utc_none() -> None:
    assert ensure_utc(None) is None


def test_validate_timezone_default() -> None:
    assert validate_timezone(DEFAULT_TIMEZONE) == "America/New_York"


def test_validate_timezone_invalid() -> None:
    with pytest.raises(ValueError, match="Unknown timezone"):
        validate_timezone("Not/A_Real_Zone")
