#!/usr/bin/env bash
set -euo pipefail

# One-time production release with a retained rollback directory.
APP_DIR="/opt/baolu-os-v2"
SERVICE="baolu-os-v2"
ARCHIVE="${1:-/home/admin/baolu-os-v2-release-20260810-acquisition-runtime-v2.tgz}"
STAMP="$(date +%Y%m%d-%H%M%S)"
STAGE_DIR="/home/admin/baolu-os-v2-stage-${STAMP}"
BACKUP_DIR="/opt/baolu-os-v2-backup-${STAMP}"

test -f "$ARCHIVE"
test -d "$APP_DIR"

mkdir -p "$STAGE_DIR"
tar -xzf "$ARCHIVE" -C "$STAGE_DIR"
test -f "$STAGE_DIR/package.json"

cd "$STAGE_DIR"
mkdir -p apps/api/uploads
pnpm install --offline --frozen-lockfile
pnpm --filter @baolu/db prisma:generate
test -f apps/web/dist/index.html
test -f apps/api/dist/apps/api/src/server.js

sudo systemctl stop "$SERVICE"
sudo mv "$APP_DIR" "$BACKUP_DIR"
sudo mv "$STAGE_DIR" "$APP_DIR"
sudo systemctl start "$SERVICE"
sleep 12

if ! systemctl is-active --quiet "$SERVICE" || ! curl --fail --silent --show-error http://127.0.0.1:3002/health >/dev/null; then
  echo "Release health check failed; rolling back." >&2
  sudo systemctl stop "$SERVICE" || true
  sudo mv "$APP_DIR" "${APP_DIR}-failed-${STAMP}"
  sudo mv "$BACKUP_DIR" "$APP_DIR"
  sudo systemctl start "$SERVICE"
  exit 1
fi

echo "Release successful. Backup retained at $BACKUP_DIR"
