"""UTC clock and datetime normalization (SQLite returns naive datetimes)."""

from __future__ import annotations

from datetime import UTC, datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TIMEZONE = "America/New_York"


def utc_now() -> datetime:
    return datetime.now(UTC)


def ensure_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def validate_timezone(name: str) -> str:
    cleaned = name.strip()
    if not cleaned:
        raise ValueError("Timezone is required")
    try:
        ZoneInfo(cleaned)
    except ZoneInfoNotFoundError as e:
        raise ValueError(f"Unknown timezone: {cleaned}") from e
    return cleaned
