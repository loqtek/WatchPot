#!/bin/sh
# Create the stack database password once, then start official Postgres init.
# The file lives on stack_db_secret so the API can read the same value.
# Postgres applies this password only when the data volume is first initialized.
set -eu

f=/secrets/db_password
if [ ! -s "$f" ]; then
  if [ -n "${WATCHPOT_DB_PASSWORD_SEED:-}" ]; then
    printf '%s' "$WATCHPOT_DB_PASSWORD_SEED" > "$f"
    echo "watchPot: stored POSTGRES_PASSWORD for first database init"
  else
    pw=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
    printf '%s' "$pw" > "$f"
    echo "watchPot: generated a database password for this stack"
  fi
  chmod 600 "$f"
fi

exec docker-entrypoint.sh "$@"
