#!/bin/sh
# When DATABASE_URL is unset, build it from the password file Postgres created.
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  file="${WATCHPOT_DB_PASSWORD_FILE:-/run/secrets/db_password}"
  if [ ! -s "$file" ]; then
    echo "watchPot: database password file missing ($file)" >&2
    exit 1
  fi
  WATCHPOT_DB_PASSWORD=$(tr -d '\r\n' < "$file")
  if [ -z "$WATCHPOT_DB_PASSWORD" ]; then
    echo "watchPot: database password file is empty ($file)" >&2
    exit 1
  fi
  export WATCHPOT_DB_PASSWORD
  DATABASE_URL=$(python -c 'import os, urllib.parse; pw=urllib.parse.quote(os.environ["WATCHPOT_DB_PASSWORD"], safe=""); print("postgresql+asyncpg://watchpot:%s@postgres:5432/watchpot" % pw)')
  export DATABASE_URL
  unset WATCHPOT_DB_PASSWORD
fi

exec "$@"
