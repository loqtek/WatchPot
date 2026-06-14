"""
One-shot DB init + bootstrap (tables, app_settings, wpadmin).
Run in a fresh Python process with DATABASE_URL (and optional WATCHPOT_*) already set.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")


async def _amain() -> None:
    paths_raw = os.environ.get("WATCHPOT_EXTERNAL_LOG_PATHS_JSON")
    external: list[str] | None = None
    if paths_raw:
        try:
            val = json.loads(paths_raw)
            external = list(val) if isinstance(val, list) else None
        except json.JSONDecodeError:
            print("Invalid WATCHPOT_EXTERNAL_LOG_PATHS_JSON, ignoring", file=sys.stderr)

    from app.bootstrap import run_bootstrap
    from app.database import init_db
    from app.database import async_session_factory

    await init_db()
    async with async_session_factory() as session:
        await run_bootstrap(
            session,
            deployment_stack_mode=os.environ.get("WATCHPOT_STACK_MODE"),
            cors_origins=os.environ.get("WATCHPOT_CORS_ORIGINS"),
            external_log_paths=external,
        )
        await session.commit()


def main() -> None:
    if not os.environ.get("DATABASE_URL"):
        print("DATABASE_URL is required", file=sys.stderr)
        sys.exit(1)
    asyncio.run(_amain())


if __name__ == "__main__":
    main()
