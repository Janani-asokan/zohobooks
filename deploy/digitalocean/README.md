# Corpus360 on a DigitalOcean Droplet

One $6/month Droplet (1 GB, Ubuntu 24.04) runs the app and PostgreSQL with Docker Compose.

## Set up (once)
Create the Droplet, open it in the DigitalOcean control panel → **Access → Launch Droplet Console**, and run:

```bash
curl -fsSL https://raw.githubusercontent.com/Janani-asokan/zohobooks/claude/blissful-hamilton-n7kcit/deploy/digitalocean/setup.sh | bash
```

It adds swap, installs Docker, opens the firewall for SSH/HTTP/HTTPS, writes secrets to `/opt/corpus360/.env`,
builds and starts the app on port 80, deploys new GitHub commits every 5 minutes, and backs up the database nightly
to `/opt/corpus360/backups` (14 days).

## Updates are built on GitHub
Building the app on this 1 GB, 1-CPU Droplet takes 20+ minutes and makes the live site slow while it runs. So
GitHub builds it (`.github/workflows/server-image.yml`, free for public repositories) and the Droplet only
downloads the finished image, which takes about a minute. While GitHub is still building, the current version keeps
running. If GitHub's build fails, or the image can't be downloaded, the Droplet builds it itself as before.

**If downloads ever fail** (the update log says "make the zohobooks-server package public"): open GitHub → your
profile → **Packages** → **zohobooks-server** → **Package settings** → **Change visibility** → **Public**. Until then
the Droplet builds the image itself. As of 21 Nov 2026 the package is public and downloads work without a login.

## Everyday
- Deploy now instead of waiting: `corpus360-update --force` (it uses GitHub's image when there is one)
- Change a setting (email key, AI key…): edit `/opt/corpus360/.env`, then `corpus360-update --force`
- Logs: `cd /opt/corpus360/src/deploy/digitalocean && docker compose logs app --tail 100`
- Back up now: `corpus360-backup`

## Copy data from Render
```bash
cd /opt/corpus360/src/deploy/digitalocean
docker compose --env-file /opt/corpus360/.env stop app
docker run --rm postgres:18-alpine pg_dump "RENDER_EXTERNAL_DATABASE_URL" -Fc > /opt/corpus360/render.dump
docker compose --env-file /opt/corpus360/.env exec -T db pg_restore -U ledgerly -d ledgerly --clean --if-exists --no-owner < /opt/corpus360/render.dump
docker compose --env-file /opt/corpus360/.env up -d
```
Copy Render's `AADHAAR_KEY` into `/opt/corpus360/.env` too, or saved Aadhaar numbers can't be read.
