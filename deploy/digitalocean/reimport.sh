#!/usr/bin/env bash
# Rebuild the database from a saved dump (default: the newest copy imported from Render), with nothing else running:
# the update timer and the app are stopped first, the database is emptied, the dump loaded and checked, then the app
# starts and runs its migrations on the complete data.  Usage: corpus360-reimport [dump-file]
set -uo pipefail
ROOT=/opt/corpus360
DUMP=${1:-$(ls -t "$ROOT"/backups/imported-*.dump 2>/dev/null | head -1)}
[ -s "$DUMP" ] || { echo "No dump found (looked for $ROOT/backups/imported-*.dump)"; exit 1; }
exec 9>/run/corpus360.lock
echo "==> Waiting for any running update to finish"; flock 9
systemctl stop corpus360-update.timer
cd "$ROOT/src/deploy/digitalocean"
DC="docker compose --env-file $ROOT/.env"
echo "==> Stopping the app"; $DC stop app
$DC up -d --wait db
echo "==> Emptying the database"
$DC exec -T db psql -q -U ledgerly -d ledgerly -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;' 2>&1 | grep -v NOTICE
echo "==> Loading $(basename "$DUMP") ($(du -h "$DUMP" | cut -f1))"
$DC exec -T db pg_restore -U ledgerly -d ledgerly --no-owner --no-acl < "$DUMP" 2> "$ROOT/backups/reimport-warnings.log"
echo "    restore messages: $(grep -c 'error:' "$ROOT/backups/reimport-warnings.log") errors (details: $ROOT/backups/reimport-warnings.log)"
grep 'error:' "$ROOT/backups/reimport-warnings.log" | cut -c1-110 | sort | uniq -c | sort -rn | head -5
$DC exec -T db psql -U ledgerly -d ledgerly -c "select (select count(*) from shops) shops, (select count(*) from customers) customers, (select count(*) from items) items, (select count(*) from invoices) invoices, (select count(*) from pg_indexes where schemaname='public') indexes"
echo "==> Starting the app"; $DC up -d app
systemctl start corpus360-update.timer
for i in $(seq 1 36); do
  if curl -fsS -m 5 http://127.0.0.1/api/health >/dev/null 2>&1; then echo "App is healthy: $(curl -s http://127.0.0.1/api/health)"; exit 0; fi
  sleep 5
done
echo "App not healthy after 3 minutes. Last log lines:"; $DC logs app --no-color --tail 25
exit 1
