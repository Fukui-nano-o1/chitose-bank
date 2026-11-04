#!/usr/bin/env bash
# Disposable synthetic cluster. Never consumes PGHOST/PGDATABASE/Supabase credentials.
set -euo pipefail
cd "$(dirname "$0")/.."
PG_BIN="${PG_BIN:-$(pg_config --bindir)}"
PG_SHARE="${PG_SHARE:-$(pg_config --sharedir)}"
TEST_PG_PORT="${TEST_PG_PORT:-55439}"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/operator-greeting-pg.XXXXXXXX")"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$TEST_ROOT/data" -m immediate stop >/dev/null 2>&1 || true
  # Delete only the temporary cluster created by this invocation.
  rm -rf -- "$TEST_ROOT"
}
trap cleanup EXIT
"$PG_BIN/initdb" -D "$TEST_ROOT/data" -L "$PG_SHARE" --no-locale --encoding=UTF8 --auth-local=reject --auth-host=reject >/dev/null
# Restrict connectivity to loopback; no external network listener or real secrets.
sed -i '1i host all all 127.0.0.1/32 trust' "$TEST_ROOT/data/pg_hba.conf"
"$PG_BIN/pg_ctl" -D "$TEST_ROOT/data" -l "$TEST_ROOT/server.log" -o "-k '' -h 127.0.0.1 -p $TEST_PG_PORT" start >/dev/null || { cat "$TEST_ROOT/server.log"; exit 1; }
PYTHONDONTWRITEBYTECODE=1 python3 scripts/operator-greetings-concurrency.test.py --port "$TEST_PG_PORT" --user "$(id -un)"
