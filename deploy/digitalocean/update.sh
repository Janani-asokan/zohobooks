#!/usr/bin/env bash
# Runs every 5 minutes (systemd timer). Deploys new GitHub commits, and heals the server: when the app isn't
# answering, or a database copy is still pending, it rebuilds and restarts.
set -uo pipefail
ROOT=/opt/corpus360
# One run at a time: a timer run starting the app while a manual run was copying the database broke the schema.
exec 9>/run/corpus360.lock
flock -n 9 || { echo "$(date -Is) another update or restore is running; skipped"; exit 0; }
cd "$ROOT/src" || exit 1
git fetch -q origin || true
LOCAL=$(git rev-parse HEAD); REMOTE=$(git rev-parse '@{u}' 2>/dev/null || echo "$LOCAL")
healthy() { curl -fsS -m 5 http://127.0.0.1/api/health >/dev/null 2>&1; }
if [ "$LOCAL" = "$REMOTE" ] && [ "${1:-}" != "--force" ] && healthy && [ ! -s "$ROOT/restore-from" ]; then exit 0; fi
echo "$(date -Is) updating $LOCAL -> $REMOTE"
git reset -q --hard "$REMOTE"
# The app runs as an unprivileged user in the container: the code must be world-readable.
chmod -R a+rX "$ROOT/src"
install -m 755 deploy/digitalocean/update.sh /usr/local/bin/corpus360-update
install -m 755 deploy/digitalocean/backup.sh /usr/local/bin/corpus360-backup
install -m 755 deploy/digitalocean/restore.sh /usr/local/bin/corpus360-restore
install -m 755 deploy/digitalocean/reimport.sh /usr/local/bin/corpus360-reimport
cd deploy/digitalocean
DC="docker compose --env-file $ROOT/.env"
$DC build app || { echo "build failed"; exit 1; }
/usr/local/bin/corpus360-restore || echo "database copy not done yet"
$DC up -d
docker image prune -f >/dev/null
echo "$(date -Is) running $(git -C "$ROOT/src" rev-parse --short HEAD)"
