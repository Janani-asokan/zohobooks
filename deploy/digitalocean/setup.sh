#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 Droplet for Corpus360. Run as root in the Droplet Console:
#   curl -fsSL https://raw.githubusercontent.com/Janani-asokan/zohobooks/claude/blissful-hamilton-n7kcit/deploy/digitalocean/setup.sh | bash
# Safe to run again: it keeps the existing secrets and data.
set -uo pipefail
# Files must be readable by the app's own user inside the container (a 077 umask broke the first installs).
umask 022
REPO=https://github.com/Janani-asokan/zohobooks.git
BRANCH=claude/blissful-hamilton-n7kcit
ROOT=/opt/corpus360
export DEBIAN_FRONTEND=noninteractive

echo "==> 1/6 Swap (the build needs more than 1 GB of memory)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 3G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> 2/6 Docker and git"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git ufw >/dev/null
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh >/dev/null; fi
systemctl enable --now docker >/dev/null

echo "==> 3/6 Firewall: SSH, HTTP, HTTPS only"
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null

echo "==> 4/6 Code"
mkdir -p "$ROOT"
if [ ! -d "$ROOT/src/.git" ]; then git clone -q --branch "$BRANCH" "$REPO" "$ROOT/src"; else git -C "$ROOT/src" pull -q; fi
chmod -R a+rX "$ROOT/src"

echo "==> 5/6 Settings and secrets (kept in $ROOT/.env)"
IP=$(curl -fsS http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address || hostname -I | awk '{print $1}')
if [ ! -f "$ROOT/.env" ]; then
  rnd() { openssl rand -hex "$1"; }
  cat > "$ROOT/.env" <<ENV
# Corpus360 settings. Change a value, then run: $ROOT/src/deploy/digitalocean/update.sh --force
POSTGRES_PASSWORD=$(rnd 24)
APP_URL=http://$IP
# Plain http until a domain with HTTPS is set up; set to 1 after that.
COOKIE_SECURE=0
SEED_DEMO=1
DEMO_SIMPLE_PASSWORDS=1
DEMO_PASSWORD=$(rnd 12)
# Encrypts Aadhaar numbers. When copying data from Render, replace this with Render's AADHAAR_KEY.
AADHAAR_KEY=$(rnd 32)
# Optional: email and the smart reader
BREVO_API_KEY=
MAIL_FROM=
ANTHROPIC_API_KEY=
ENV
  chmod 600 "$ROOT/.env"
fi
install -m 755 "$ROOT/src/deploy/digitalocean/update.sh" /usr/local/bin/corpus360-update
install -m 755 "$ROOT/src/deploy/digitalocean/backup.sh" /usr/local/bin/corpus360-backup

echo "==> 6/6 Auto-update (heals and deploys every 5 minutes), nightly backup, then build and start"
install -m 755 "$ROOT/src/deploy/digitalocean/restore.sh" /usr/local/bin/corpus360-restore
cat > /etc/systemd/system/corpus360-update.service <<UNIT
[Unit]
Description=Corpus360: deploy new commits from GitHub, heal the app
[Service]
Type=oneshot
ExecStart=/usr/local/bin/corpus360-update
UNIT
cat > /etc/systemd/system/corpus360-update.timer <<UNIT
[Unit]
Description=Corpus360: check every 5 minutes
[Timer]
OnBootSec=5min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
UNIT
cat > /etc/cron.d/corpus360-backup <<CRON
30 2 * * * root /usr/local/bin/corpus360-backup >> /var/log/corpus360-backup.log 2>&1
CRON
systemctl daemon-reload
# The timer starts after the first build, so the two never run at once.
cd "$ROOT/src/deploy/digitalocean"
docker compose --env-file "$ROOT/.env" build app || echo "first build failed; the 5-minute timer retries"
/usr/local/bin/corpus360-restore || echo "database copy not done; the 5-minute timer retries"
docker compose --env-file "$ROOT/.env" up -d || true
systemctl enable --now corpus360-update.timer >/dev/null

echo "==> Waiting for the app to answer"
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1/api/health >/dev/null 2>&1; then
    echo; echo "Corpus360 is running: http://$IP"; echo "Updates from GitHub are deployed automatically within 5 minutes."; exit 0
  fi
  sleep 5
done
echo "The app did not answer yet. Check: cd $ROOT/src/deploy/digitalocean && docker compose logs app --tail 50"
exit 1
