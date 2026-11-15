#!/usr/bin/env bash
# One-time copy of an existing database into this server. /opt/corpus360/restore-from holds its URL (Render's
# external URL). The local database is emptied first, so it can be run again safely. The file is removed once the
# copy succeeds; the dump is kept in /opt/corpus360/backups.
set -uo pipefail
ROOT=/opt/corpus360
[ -s "$ROOT/restore-from" ] || exit 0
cd "$ROOT/src/deploy/digitalocean"
DC="docker compose --env-file $ROOT/.env"
mkdir -p "$ROOT/backups"
DUMP="$ROOT/backups/imported-$(date +%F-%H%M).dump"
echo "==> Copying the existing database"
$DC stop app >/dev/null 2>&1 || true
$DC up -d --wait db || { echo "database did not start"; exit 1; }
if ! $DC exec -T -e SRC="$(cat "$ROOT/restore-from")" db sh -c 'pg_dump "$SRC" -Fc --no-owner --no-acl' > "$DUMP" || [ ! -s "$DUMP" ]; then
  echo "could not read the source database (it stays in $ROOT/restore-from; retried on the next update)"; rm -f "$DUMP"; exit 1
fi
$DC exec -T db psql -q -U ledgerly -d ledgerly -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
# Small warnings (comments, extensions that already exist) are normal; they don't stop the copy.
$DC exec -T db pg_restore -U ledgerly -d ledgerly --no-owner --no-acl < "$DUMP" 2> "$ROOT/backups/import-warnings.log" || true
TABLES=$($DC exec -T db psql -tA -U ledgerly -d ledgerly -c "select count(*) from information_schema.tables where table_schema='public'")
echo "    copied: $TABLES tables ($(du -h "$DUMP" | cut -f1)); warnings: $(grep -c . "$ROOT/backups/import-warnings.log" || true) lines"
if [ "${TABLES:-0}" -gt 10 ]; then shred -u "$ROOT/restore-from" 2>/dev/null || rm -f "$ROOT/restore-from"; fi
