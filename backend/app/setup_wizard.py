"""
Interactive or scripted first-time setup: .env, optional Docker DB, DB bootstrap + wpadmin.

Run from repository root: `./setup` / `./setup.sh` (Docker-first) or `cd backend && python -m app.setup_wizard`.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
SETUP_POSTGRES = REPO_ROOT / "deploy" / "setup" / "docker-compose.postgres.yml"
SETUP_MYSQL = REPO_ROOT / "deploy" / "setup" / "docker-compose.mysql.yml"


def write_backend_env(pairs: dict[str, str]) -> None:
    path = BACKEND_DIR / ".env"
    path.parent.mkdir(parents=True, exist_ok=True)
    merged: dict[str, str] = {}
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            merged[k.strip()] = v.strip()
    merged.update(pairs)
    body = "\n".join(f"{k}={v}" for k, v in sorted(merged.items())) + "\n"
    path.write_text(body)
    print(f"Wrote {path}")


def find_python() -> Path:
    venv_py = BACKEND_DIR / ".venv" / "bin" / "python"
    if venv_py.is_file():
        return venv_py
    return Path(sys.executable)


def run_bootstrap_subprocess(env: dict[str, str]) -> None:
    full = os.environ.copy()
    full.update({k: v for k, v in env.items() if v is not None})
    proc = subprocess.run(
        [str(find_python()), "-m", "app.setup_bootstrap_only"],
        cwd=str(BACKEND_DIR),
        env=full,
    )
    if proc.returncode != 0:
        sys.exit(proc.returncode)


def start_docker_compose(compose_path: Path) -> None:
    subprocess.run(
        ["docker", "compose", "-f", str(compose_path), "up", "-d"],
        cwd=str(REPO_ROOT),
        check=True,
    )


def prompt_choice(title: str, options: list[tuple[str, str]]) -> str:
    print(title)
    for i, (key, label) in enumerate(options, 1):
        print(f"  {i}) {label}")
    while True:
        raw = input("Choice [1]: ").strip() or "1"
        if raw.isdigit():
            idx = int(raw) - 1
            if 0 <= idx < len(options):
                return options[idx][0]
        for key, _ in options:
            if raw.lower() == key.lower():
                return key


def build_database_url(db: str, mode: str) -> str:
    if db == "sqlite":
        (BACKEND_DIR / "data").mkdir(parents=True, exist_ok=True)
        return "sqlite+aiosqlite:///./data/watchpot.db"
    if db == "postgres":
        if mode in ("full", "api_only"):
            return "postgresql+asyncpg://watchpot:watchpot@postgres:5432/watchpot"
        return "postgresql+asyncpg://watchpot:watchpot@127.0.0.1:5433/watchpot"
    if db == "mysql":
        return "mysql+aiomysql://watchpot:watchpot@127.0.0.1:3307/watchpot?charset=utf8mb4"
    raise ValueError(db)


def print_next_steps(mode: str, db: str) -> None:
    print("\n--- Next steps ---")
    if mode == "local_dev":
        print("  1) cd backend && ./run")
        print("  2) From repo root: npm install && npm run dev  (set NEXT_PUBLIC_API_URL=http://127.0.0.1:6040/api)")
    elif mode == "full":
        print("  From repo root: docker compose up -d --build")
        print("  UI http://127.0.0.1:3020  API http://127.0.0.1:6040")
        print(
            "  Agent (optional, same machine as compose): add WATCHPOT_POT_ID + WATCHPOT_AGENT_TOKEN to .env, then "
            "`docker compose --profile agent up -d agent` (mounts the host Docker socket)."
        )
    elif mode == "api_only":
        print("  docker compose up -d --build postgres api prometheus grafana")
    elif mode == "ui_only":
        print("  Build web with your API URL baked in, then:")
        print('    docker compose build --build-arg NEXT_PUBLIC_API_URL="https://your-api/api" web  # context: repo root')
        print("    docker compose up -d web")
    if db in ("postgres", "mysql"):
        print(f"  Helper DB compose: deploy/setup/docker-compose.{db}.yml (localhost port {'5433' if db == 'postgres' else '3307'})")


def apply_configuration(
    *,
    db: str,
    mode: str,
    paths_list: list[str],
    start_docker: bool,
    cors: str | None,
    next_public_api_url: str | None,
    skip_bootstrap: bool,
) -> None:
    url = build_database_url(db, mode)
    if start_docker:
        if db == "postgres":
            start_docker_compose(SETUP_POSTGRES)
        elif db == "mysql":
            start_docker_compose(SETUP_MYSQL)

    env_pairs: dict[str, str] = {
        "DATABASE_URL": url,
        "WATCHPOT_STACK_MODE": mode,
        "WATCHPOT_API_ROLE": "control",
    }
    if cors:
        env_pairs["WATCHPOT_CORS_ORIGINS"] = cors
    if next_public_api_url:
        env_pairs["NEXT_PUBLIC_API_URL"] = next_public_api_url
    if paths_list:
        env_pairs["WATCHPOT_EXTERNAL_LOG_PATHS_JSON"] = json.dumps(paths_list)

    write_backend_env(env_pairs)

    if skip_bootstrap:
        print("Skipping one-shot DB bootstrap (API will run it on first startup; watch API logs for wpadmin).")
        print_next_steps(mode, db)
        return

    bootstrap_env: dict[str, str | None] = {
        "DATABASE_URL": url,
        "WATCHPOT_STACK_MODE": mode,
        "WATCHPOT_CORS_ORIGINS": cors,
    }
    if paths_list:
        bootstrap_env["WATCHPOT_EXTERNAL_LOG_PATHS_JSON"] = json.dumps(paths_list)

    print("\nInitializing database and default admin (password printed in output below).\n")
    run_bootstrap_subprocess({k: v for k, v in bootstrap_env.items() if v is not None})

    print_next_steps(mode, db)


def interactive() -> None:
    print("watchPot setup\n")
    print("Docker is the supported path for API + UI; bare-metal is mainly for development.\n")
    mode = prompt_choice(
        "What will you run on this machine?",
        [
            ("full", "Docker (recommended): Postgres + API + Web + Prometheus + Grafana"),
            ("api_only", "Docker: API + Postgres + metrics (no Web container)"),
            ("ui_only", "Docker: Web UI only (set remote API URL for browser → API calls)"),
            ("local_dev", "Dev without image rebuilds: SQLite or helper DB + ./run + npm run dev"),
        ],
    )

    if mode in ("full", "api_only"):
        db = "postgres"
        print("Using PostgreSQL from the main docker-compose.yml (service hostname: postgres).\n")
    else:
        db = prompt_choice(
            "Database backend:",
            [
                ("sqlite", "SQLite (./backend/data/watchpot.db)"),
                ("postgres", "PostgreSQL via Docker helper on 127.0.0.1:5433"),
                ("mysql", "MySQL 8 via Docker helper on 127.0.0.1:3307"),
            ],
        )

    ext = input("External host log paths (comma-separated, stored in DB for compose hints) [empty]: ").strip()
    paths_list = [p.strip() for p in ext.split(",") if p.strip()] if ext else []

    start_docker = False
    if mode == "local_dev" and db in ("postgres", "mysql"):
        start_docker = input("Start standalone Docker DB on localhost (helper compose)? [Y/n]: ").strip().lower() in (
            "",
            "y",
            "yes",
        )

    next_url: str | None = None
    if mode == "ui_only":
        next_url = input("Remote API base URL including /api (e.g. http://10.0.0.5:6040/api): ").strip() or None

    cors_in = input("Extra CORS origins (comma-separated) [empty]: ").strip() or None

    skip_bootstrap = mode in ("full", "api_only")
    if skip_bootstrap:
        print(
            "\nInitial admin (wpadmin) and app_settings will be created when the API container starts; "
            "check `docker compose logs api` for the generated password.\n",
        )

    apply_configuration(
        db=db,
        mode=mode,
        paths_list=paths_list,
        start_docker=start_docker,
        cors=cors_in,
        next_public_api_url=next_url,
        skip_bootstrap=skip_bootstrap,
    )

def main() -> None:
    parser = argparse.ArgumentParser(description="watchPot setup wizard")
    parser.add_argument("--non-interactive", action="store_true")
    parser.add_argument("--db", choices=("sqlite", "postgres", "mysql"), default="sqlite")
    parser.add_argument(
        "--mode",
        choices=("full", "api_only", "ui_only", "local_dev"),
        default="local_dev",
        help="full/api_only use postgres hostname 'postgres' when --db postgres",
    )
    parser.add_argument("--docker-db", action="store_true", help="Start helper Docker DB (postgres/mysql)")
    parser.add_argument("--cors", help="Comma-separated CORS origins")
    parser.add_argument("--next-public-api-url", help="For ui_only / web build")
    parser.add_argument(
        "--external-log-paths",
        help="Comma-separated paths (stored in app_settings as JSON)",
    )
    parser.add_argument("--skip-bootstrap", action="store_true", help="Only write .env")
    args = parser.parse_args()

    if args.non_interactive:
        paths = [p.strip() for p in args.external_log_paths.split(",") if p.strip()] if args.external_log_paths else []
        skip = args.skip_bootstrap or (
            args.non_interactive and args.mode in ("full", "api_only") and args.db == "postgres"
        )
        apply_configuration(
            db=args.db,
            mode=args.mode,
            paths_list=paths,
            start_docker=args.docker_db,
            cors=args.cors,
            next_public_api_url=args.next_public_api_url,
            skip_bootstrap=skip,
        )
    else:
        interactive()


if __name__ == "__main__":
    main()
