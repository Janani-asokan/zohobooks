#!/usr/bin/env bash
# Nightly database copy, kept 14 days in /opt/corpus360/backups (on the Droplet's own disk).
set -euo pipefail
mkdir -p /opt/corpus360/backups
cd /opt/corpus360/src/deploy/digitalocean
docker compose --env-file /opt/corpus360/.env exec -T db pg_dump -U ledgerly -d ledgerly -Fc > "/opt/corpus360/backups/ledgerly-$(date +%F).dump"
find /opt/corpus360/backups -name 'ledgerly-*.dump' -mtime +14 -delete
