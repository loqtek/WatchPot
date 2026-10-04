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

# Compose drops the image CMD when entrypoint is overridden. Without this,
# docker-entrypoint.sh is exec'd with no arguments and the container exits 0.
if [ "$#" -eq 0 ]; then
  set -- postgres
fi

exec docker-entrypoint.sh "$@"
