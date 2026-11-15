#!/usr/bin/env bash
# Runs every few minutes (systemd timer): when GitHub has new commits, rebuild and restart the app.
set -euo pipefail
cd /opt/corpus360/src
git fetch -q origin
LOCAL=$(git rev-parse HEAD); REMOTE=$(git rev-parse '@{u}')
if [ "$LOCAL" = "$REMOTE" ] && [ "${1:-}" != "--force" ]; then exit 0; fi
echo "$(date -Is) updating $LOCAL -> $REMOTE"
git reset -q --hard "$REMOTE"
cd deploy/digitalocean
docker compose --env-file /opt/corpus360/.env build app
docker compose --env-file /opt/corpus360/.env up -d
docker image prune -f >/dev/null
echo "$(date -Is) running $(git -C /opt/corpus360/src rev-parse --short HEAD)"
