#!/usr/bin/env bash
set -euo pipefail

ARCHIVE="${1:?Pass archive path as argument 1}"
ARCHIVE_SHA256="${2:?Pass archive sha256 as argument 2}"
RELEASE_ID="${3:?Pass release id as argument 3}"

APP_DIR="/opt/baolu-os-v2"
SERVICE_NAME="baolu-os-v2"
ENV_FILE="/etc/baolu-secrets/baolu-os-v2.env"
BASE_URL="https://api.lcppch.top/os-v2"
STAGE_DIR="/opt/baolu-stage/${RELEASE_ID}"
BACKUP_DIR="/opt/baolu-backups/${RELEASE_ID}-before"
SWITCHED="false"

test "$(readlink -f "$APP_DIR")" = "$APP_DIR"
test "$(systemctl is-active "$SERVICE_NAME")" = "active"
test -f "$ENV_FILE"
test -f "$ARCHIVE"
test ! -e "$STAGE_DIR"
test ! -e "$BACKUP_DIR"
echo "${ARCHIVE_SHA256}  ${ARCHIVE}" | sha256sum -c -

sudo install -d -m 755 -o admin -g admin /opt/baolu-stage
sudo install -d -m 755 -o admin -g admin "$STAGE_DIR"
sudo install -d -m 750 -o admin -g admin "$BACKUP_DIR"
tar -xzf "$ARCHIVE" -C "$STAGE_DIR"

test -f "$STAGE_DIR/apps/api/dist/apps/api/src/server.js"
test -f "$STAGE_DIR/apps/web/dist/index.html"
test -f "$STAGE_DIR/apps/web/src/components/automation/AgentAutomationDrawer.tsx"
test -f "$STAGE_DIR/apps/api/src/services/automation-schedule.ts"

set -a
. "$ENV_FILE"
set +a
cd "$STAGE_DIR"
pnpm install --frozen-lockfile --offline --prod=false
pnpm --filter @baolu/db prisma:generate
pnpm prelaunch:check -- --env "$ENV_FILE"

pg_dump "$DATABASE_URL" --format=custom --file="$BACKUP_DIR/database-before.dump"
sudo cp -a "$ENV_FILE" "$BACKUP_DIR/baolu-os-v2.env.before"
sudo systemctl cat "$SERVICE_NAME" > "$BACKUP_DIR/baolu-os-v2.service.before.txt"
sha256sum "$APP_DIR/apps/web/dist/index.html" "$APP_DIR/apps/api/dist/apps/api/src/server.js" > "$BACKUP_DIR/SHA256SUMS-before"

rollback_on_error() {
  exit_code="$?"
  trap - ERR
  if [ "$SWITCHED" = "true" ]; then
    echo "Automation deployment failed after switch; rolling back." >&2
    sudo systemctl stop "$SERVICE_NAME" || true
    if [ -d "$APP_DIR" ] && [ ! -e "$BACKUP_DIR/failed-app" ]; then sudo mv "$APP_DIR" "$BACKUP_DIR/failed-app"; fi
    if [ -d "$BACKUP_DIR/previous-app" ]; then sudo mv "$BACKUP_DIR/previous-app" "$APP_DIR"; fi
    sudo install -o root -g admin -m 640 "$BACKUP_DIR/baolu-os-v2.env.before" "$ENV_FILE" || true
    sudo systemctl start "$SERVICE_NAME" || true
  fi
  exit "$exit_code"
}
trap rollback_on_error ERR

pnpm --filter @baolu/db prisma:deploy
bash "$APP_DIR/scripts/production-switch-with-rollback.sh" "$STAGE_DIR" "$BACKUP_DIR"
SWITCHED="true"

curl -fsS http://127.0.0.1:3002/health >/dev/null
curl -fsS http://127.0.0.1:3002/ready >/dev/null
curl -fsS http://127.0.0.1:3002/mcp/status >/dev/null
for page in /my-ai /agents/acquisition /agents/restaurant-growth; do
  test "$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL$page")" = "200"
done
curl -fsS "$BASE_URL/api/agents/catalog" | grep -q '"automationAction"'
curl -fsS "$BASE_URL/api/agents/catalog" | grep -q '"slug":"acquisition"'

sha256sum "$APP_DIR/apps/web/dist/index.html" "$APP_DIR/apps/api/dist/apps/api/src/server.js" > "$BACKUP_DIR/SHA256SUMS-after"
date -Iseconds > "$BACKUP_DIR/DEPLOYMENT-SWITCH-SUCCEEDED"
trap - ERR
echo "AUTOMATION-DEPLOYMENT-SUCCEEDED"
systemctl show "$SERVICE_NAME" -p ActiveState -p SubState -p MainPID
