import asyncio
import logging
from collections.abc import AsyncGenerator
from datetime import datetime
from pathlib import Path

from sqlalchemy import event, inspect, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Session

from app.config import get_env_settings
from app.time_utils import ensure_utc

log = logging.getLogger("watchpot.database")

SQLITE_BUSY_TIMEOUT_SEC = 30
SQLITE_COMMIT_RETRIES = 5
SQLITE_COMMIT_BASE_DELAY_SEC = 0.05


class Base(DeclarativeBase):
    pass


def _ensure_sqlite_parent_dir(url: str) -> None:
    if "sqlite" not in url.split(":", 1)[0]:
        return
    no_q = url.split("?", 1)[0]
    if no_q.startswith("sqlite+aiosqlite:////"):
        path_part = no_q[len("sqlite+aiosqlite:////") :]
        p = Path("/") / path_part
    elif no_q.startswith("sqlite+aiosqlite:///"):
        path_part = no_q[len("sqlite+aiosqlite:///") :]
        p = Path(path_part)
        if not p.is_absolute():
            p = Path.cwd() / p
    else:
        return
    p.parent.mkdir(parents=True, exist_ok=True)


def _is_sqlite_url(url: str) -> bool:
    return url.split(":", 1)[0].endswith("sqlite")


def _engine_args(url: str, debug: bool) -> dict:
    kwargs: dict = {"echo": debug, "pool_pre_ping": True}
    if _is_sqlite_url(url):
        kwargs["connect_args"] = {
            "check_same_thread": False,
            "timeout": SQLITE_BUSY_TIMEOUT_SEC,
        }
    return kwargs


def _register_sqlite_pragmas(eng) -> None:
    @event.listens_for(eng.sync_engine, "connect")
    def _on_sqlite_connect(dbapi_conn, _connection_record) -> None:
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute(f"PRAGMA busy_timeout={SQLITE_BUSY_TIMEOUT_SEC * 1000}")
        cursor.close()


async def commit_session(session: AsyncSession) -> None:
    """Commit with brief retries when SQLite reports a transient lock."""
    if not _is_sqlite_url(_env.database_url):
        await session.commit()
        return
    delay = SQLITE_COMMIT_BASE_DELAY_SEC
    for attempt in range(SQLITE_COMMIT_RETRIES):
        try:
            await session.commit()
            return
        except OperationalError as exc:
            if "database is locked" not in str(exc).lower() or attempt + 1 >= SQLITE_COMMIT_RETRIES:
                raise
            log.debug("sqlite commit locked; retry %s/%s", attempt + 1, SQLITE_COMMIT_RETRIES)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 1.0)


_env = get_env_settings()
_ensure_sqlite_parent_dir(_env.database_url)
engine = create_async_engine(
    _env.database_url,
    **_engine_args(_env.database_url, _env.debug),
)
if _is_sqlite_url(_env.database_url):
    _register_sqlite_pragmas(engine)
async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


@event.listens_for(Session, "loaded_as_persistent")
def _coerce_loaded_datetimes_to_utc(_session: Session, instance: object) -> None:
    """SQLite stores datetimes without tzinfo; normalize on load before comparisons."""
    mapper = inspect(instance.__class__, raiseerr=False)
    if mapper is None:
        return
    for attr in mapper.column_attrs:
        val = getattr(instance, attr.key, None)
        if isinstance(val, datetime):
            fixed = ensure_utc(val)
            if fixed is not None and fixed is not val:
                setattr(instance, attr.key, fixed)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        try:
            yield session
            await commit_session(session)
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


def _apply_runtime_migrations(sync_conn) -> None:
    """Add columns on existing DBs (create_all does not alter tables)."""
    from sqlalchemy import inspect, text

    insp = inspect(sync_conn)
    if insp.has_table("stacks"):
        cols = {c["name"] for c in insp.get_columns("stacks")}
        if "restart_generation" not in cols:
            sync_conn.execute(
                text("ALTER TABLE stacks ADD COLUMN restart_generation INTEGER NOT NULL DEFAULT 0")
            )
    if insp.has_table("events"):
        cols = {c["name"] for c in insp.get_columns("events")}
        if "channel" not in cols:
            sync_conn.execute(
                text("ALTER TABLE events ADD COLUMN channel VARCHAR(32) NOT NULL DEFAULT 'runtime'")
            )
    if insp.has_table("users"):
        cols = {c["name"] for c in insp.get_columns("users")}
        if "username" not in cols:
            sync_conn.execute(text("ALTER TABLE users ADD COLUMN username VARCHAR(64)"))
            sync_conn.execute(text("CREATE UNIQUE INDEX ix_users_username ON users (username)"))
        if "timezone" not in cols:
            sync_conn.execute(
                text(
                    "ALTER TABLE users ADD COLUMN timezone VARCHAR(64) NOT NULL DEFAULT 'America/New_York'"
                )
            )
    if insp.has_table("backup_jobs"):
        cols = {c["name"] for c in insp.get_columns("backup_jobs")}
        for col, ddl in (
            ("storage_location", "ALTER TABLE backup_jobs ADD COLUMN storage_location VARCHAR(16) NOT NULL DEFAULT 'agent'"),
            ("artifact_format", "ALTER TABLE backup_jobs ADD COLUMN artifact_format VARCHAR(16)"),
            ("artifact_sha256", "ALTER TABLE backup_jobs ADD COLUMN artifact_sha256 VARCHAR(64)"),
            ("server_artifact_path", "ALTER TABLE backup_jobs ADD COLUMN server_artifact_path VARCHAR(1024)"),
            ("ingest_status", "ALTER TABLE backup_jobs ADD COLUMN ingest_status VARCHAR(16)"),
            ("ingest_command_id", "ALTER TABLE backup_jobs ADD COLUMN ingest_command_id BLOB"),
        ):
            if col not in cols:
                sync_conn.execute(text(ddl))
    if insp.has_table("cve_entries"):
        cols = {c["name"] for c in insp.get_columns("cve_entries")}
        for col, ddl in (
            ("category", "ALTER TABLE cve_entries ADD COLUMN category VARCHAR(64) NOT NULL DEFAULT 'other'"),
            ("vendor", "ALTER TABLE cve_entries ADD COLUMN vendor VARCHAR(128)"),
            ("product", "ALTER TABLE cve_entries ADD COLUMN product VARCHAR(128)"),
            ("tags", "ALTER TABLE cve_entries ADD COLUMN tags JSON"),
            ("detection_hint", "ALTER TABLE cve_entries ADD COLUMN detection_hint TEXT"),
            ("enabled", "ALTER TABLE cve_entries ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT 1"),
            ("is_custom", "ALTER TABLE cve_entries ADD COLUMN is_custom BOOLEAN NOT NULL DEFAULT 0"),
            ("notes", "ALTER TABLE cve_entries ADD COLUMN notes TEXT"),
        ):
            if col not in cols:
                sync_conn.execute(text(ddl))


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_apply_runtime_migrations)
