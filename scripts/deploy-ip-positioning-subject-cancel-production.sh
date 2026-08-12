#!/usr/bin/env bash
set -euo pipefail

ARCHIVE="${1:?Pass deployment archive path as argument 1}"
ARCHIVE_SHA256="${2:?Pass archive SHA-256 as argument 2}"
RELEASE_ID="${3:?Pass a release id as argument 3}"
APP_DIR="/opt/baolu-os-v2"
SERVICE_NAME="baolu-os-v2"
ENV_FILE="/etc/baolu-secrets/baolu-os-v2.env"
STAGE_DIR="/opt/baolu-stage/${RELEASE_ID}"
BACKUP_DIR="/opt/baolu-backups/${RELEASE_ID}-before"
SWITCHED=false
SUCCEEDED=false

test "$(readlink -f "$APP_DIR")" = "$APP_DIR"
test "$(systemctl is-active "$SERVICE_NAME")" = "active"
test -f "$ENV_FILE" && test -f "$ARCHIVE"
test ! -e "$STAGE_DIR" && test ! -e "$BACKUP_DIR"
echo "$ARCHIVE_SHA256  $ARCHIVE" | sha256sum -c -

sudo install -d -m 755 -o admin -g admin /opt/baolu-stage "$STAGE_DIR"
sudo install -d -m 750 -o admin -g admin "$BACKUP_DIR"
sudo cp -a "$ENV_FILE" "$BACKUP_DIR/baolu-os-v2.env.before"
sudo systemctl cat "$SERVICE_NAME" > "$BACKUP_DIR/baolu-os-v2.service.before.txt"
sudo cp --parents \
  "$APP_DIR/apps/api/src/routes/mcp.ts" \
  "$APP_DIR/apps/web/src/pages/AgentProductsApp.tsx" \
  "$APP_DIR/packages/agent/src/index.ts" \
  "$APP_DIR/package.json" \
  "$BACKUP_DIR"
sha256sum \
  "$APP_DIR/apps/api/src/routes/mcp.ts" \
  "$APP_DIR/apps/web/src/pages/AgentProductsApp.tsx" \
  "$APP_DIR/packages/agent/src/index.ts" \
  "$APP_DIR/package.json" > "$BACKUP_DIR/SHA256SUMS-before"

restore_on_failure() {
  local status=$?
  if [ "$SUCCEEDED" = true ]; then return; fi
  echo "Deployment failed; restoring backed up source and current service." >&2
  sudo cp -a "$BACKUP_DIR/baolu-os-v2.env.before" "$ENV_FILE" || true
  sudo cp -a "$BACKUP_DIR$APP_DIR/apps/api/src/routes/mcp.ts" "$APP_DIR/apps/api/src/routes/mcp.ts" || true
  sudo cp -a "$BACKUP_DIR$APP_DIR/apps/web/src/pages/AgentProductsApp.tsx" "$APP_DIR/apps/web/src/pages/AgentProductsApp.tsx" || true
  sudo cp -a "$BACKUP_DIR$APP_DIR/packages/agent/src/index.ts" "$APP_DIR/packages/agent/src/index.ts" || true
  sudo cp -a "$BACKUP_DIR$APP_DIR/package.json" "$APP_DIR/package.json" || true
  sudo systemctl restart "$SERVICE_NAME" || true
  exit "$status"
}
trap restore_on_failure EXIT

tar -xzf "$ARCHIVE" -C "$STAGE_DIR"
test -f "$STAGE_DIR/apps/api/src/routes/mcp.ts"
test -f "$STAGE_DIR/apps/web/src/pages/AgentProductsApp.tsx"
test -f "$STAGE_DIR/packages/agent/src/index.ts"
test -f "$STAGE_DIR/package.json"

sudo install -m 644 "$STAGE_DIR/apps/api/src/routes/mcp.ts" "$APP_DIR/apps/api/src/routes/mcp.ts"
sudo install -m 644 "$STAGE_DIR/apps/web/src/pages/AgentProductsApp.tsx" "$APP_DIR/apps/web/src/pages/AgentProductsApp.tsx"
sudo install -m 644 "$STAGE_DIR/packages/agent/src/index.ts" "$APP_DIR/packages/agent/src/index.ts"
sudo install -m 644 "$STAGE_DIR/package.json" "$APP_DIR/package.json"

cd "$APP_DIR"
set -a
. "$ENV_FILE"
set +a
pnpm -r build
sudo systemctl restart "$SERVICE_NAME"
for attempt in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:3002/health >/dev/null \
    && curl -fsS --max-time 3 http://127.0.0.1:3002/ready >/dev/null; then
    break
  fi
  test "$attempt" -lt 30
  sleep 2
done
grep -q "mcp_client_disconnected" "$APP_DIR/apps/api/dist/apps/api/src/routes/mcp.js"
test -f "$APP_DIR/apps/web/dist/index.html"
sha256sum \
  "$APP_DIR/apps/api/src/routes/mcp.ts" \
  "$APP_DIR/apps/web/src/pages/AgentProductsApp.tsx" \
  "$APP_DIR/packages/agent/src/index.ts" \
  "$APP_DIR/package.json" > "$BACKUP_DIR/SHA256SUMS-after"
date -Iseconds > "$BACKUP_DIR/DEPLOYMENT-SWITCH-SUCCEEDED"
SUCCEEDED=true
trap - EXIT
systemctl show "$SERVICE_NAME" -p ActiveState -p SubState -p MainPID
echo "IP positioning subject and cancellation deployment completed: $RELEASE_ID"
