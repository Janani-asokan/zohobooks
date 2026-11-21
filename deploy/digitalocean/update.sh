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
# Rebuilding takes 20+ minutes of the server's single CPU and slows the live site meanwhile: skip it when the new
# commits only touch what the server doesn't run (the phone app, docs, CI). Settings and scripts still apply.
CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE" 2>/dev/null)
NEEDS_BUILD=1
if [ -n "$CHANGED" ] && [ "${1:-}" != "--force" ] && healthy && [ ! -s "$ROOT/restore-from" ] && \
   ! echo "$CHANGED" | grep -qvE '^(mobile/|e2e/|docs/|\.github/|[^/]+\.md$|deploy/digitalocean/[^/]+\.md$|\.env\.app$)'; then
  NEEDS_BUILD=0
fi
# The image is built on GitHub (.github/workflows/server-image.yml) and only downloaded here: building on this
# 1-CPU, 1 GB server took 20+ minutes and slowed the live site. While GitHub is still building this commit, keep the
# current version running and try again on the next run (5 minutes). If GitHub's build failed, or the image can't
# be downloaded (the package isn't public), build here as before so updates never get stuck.
IMAGE=ghcr.io/janani-asokan/zohobooks-server
PULLED=0
if [ "$NEEDS_BUILD" = 1 ]; then
  if docker pull -q "$IMAGE:$REMOTE" >/dev/null 2>&1; then
    PULLED=1; echo "downloaded the ready-made image for $REMOTE"
  else
    RUN=$(curl -fsS -m 15 "https://api.github.com/repos/Janani-asokan/zohobooks/actions/workflows/server-image.yml/runs?head_sha=$REMOTE&per_page=1" 2>/dev/null \
      | python3 -c 'import json,sys; r=(json.load(sys.stdin).get("workflow_runs") or [{}])[0]; print(r.get("status","none"), r.get("conclusion") or "")' 2>/dev/null || echo "unknown")
    AGE=$(( $(date +%s) - $(git log -1 --format=%ct "$REMOTE" 2>/dev/null || date +%s) ))
    case "$RUN" in
      queued*|in_progress*|waiting*|pending*|requested*)
        if [ "$AGE" -lt 3600 ] && healthy; then echo "$(date -Is) GitHub is still building $REMOTE; keeping the current version, will check again"; exit 0; fi ;;
      "completed success")
        echo "GitHub built $REMOTE but the image can't be downloaded: make the zohobooks-server package public on GitHub. Building here instead." ;;
    esac
  fi
fi

git reset -q --hard "$REMOTE"
# The app runs as an unprivileged user in the container: the code must be world-readable.
chmod -R a+rX "$ROOT/src"
install -m 755 deploy/digitalocean/update.sh /usr/local/bin/corpus360-update
install -m 755 deploy/digitalocean/backup.sh /usr/local/bin/corpus360-backup
install -m 755 deploy/digitalocean/restore.sh /usr/local/bin/corpus360-restore
install -m 755 deploy/digitalocean/reimport.sh /usr/local/bin/corpus360-reimport
cd deploy/digitalocean
DC="docker compose --env-file $ROOT/.env"
if [ "$PULLED" = 1 ]; then docker tag "$IMAGE:$REMOTE" corpus360-app:latest
elif [ "$NEEDS_BUILD" = 1 ]; then $DC build app || { echo "build failed"; exit 1; }
else echo "only app/docs changes: no rebuild"; fi
/usr/local/bin/corpus360-restore || echo "database copy not done yet"
$DC up -d
docker image prune -f >/dev/null
echo "$(date -Is) running $(git -C "$ROOT/src" rev-parse --short HEAD)"
