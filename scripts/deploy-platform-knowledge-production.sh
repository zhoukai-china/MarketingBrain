#!/usr/bin/env bash
set -euo pipefail

ARCHIVE="${1:?Pass deployment archive path as argument 1}"
ARCHIVE_SHA256="${2:?Pass archive SHA-256 as argument 2}"
RELEASE_ID="${3:?Pass a release id as argument 3}"
APP_DIR="/opt/baolu-os-v2"
SERVICE_NAME="baolu-os-v2"
ENV_FILE="/etc/baolu-secrets/baolu-os-v2.env"
BASE_URL="https://api.lcppch.top/os-v2"
STAGE_DIR="/opt/baolu-stage/${RELEASE_ID}"
BACKUP_DIR="/opt/baolu-backups/${RELEASE_ID}-before"
SWITCHED=false
SUCCEEDED=false

test "$(readlink -f "$APP_DIR")" = "$APP_DIR"
test "$(systemctl is-active "$SERVICE_NAME")" = "active"
test -f "$ENV_FILE"
test -f "$ARCHIVE"
test ! -e "$STAGE_DIR"
test ! -e "$BACKUP_DIR"
echo "$ARCHIVE_SHA256  $ARCHIVE" | sha256sum -c -

sudo install -d -m 755 -o admin -g admin /opt/baolu-stage
sudo install -d -m 755 -o admin -g admin "$STAGE_DIR"
sudo install -d -m 750 -o admin -g admin "$BACKUP_DIR"
sudo cp -a "$ENV_FILE" "$BACKUP_DIR/baolu-os-v2.env.before"
sudo systemctl cat "$SERVICE_NAME" > "$BACKUP_DIR/baolu-os-v2.service.before.txt"

restore_on_failure() {
  local status=$?
  if [ "$SUCCEEDED" = true ]; then return; fi
  echo "Deployment failed; restoring the production environment and application if needed." >&2
  sudo cp -a "$BACKUP_DIR/baolu-os-v2.env.before" "$ENV_FILE" || true
  if [ "$SWITCHED" = true ] && [ -d "$BACKUP_DIR/previous-app" ]; then
    sudo systemctl stop "$SERVICE_NAME" || true
    if [ -d "$APP_DIR" ] && [ ! -e "$BACKUP_DIR/failed-app-after-check" ]; then
      sudo mv "$APP_DIR" "$BACKUP_DIR/failed-app-after-check" || true
    fi
    sudo mv "$BACKUP_DIR/previous-app" "$APP_DIR" || true
    sudo systemctl start "$SERVICE_NAME" || true
  fi
  exit "$status"
}
trap restore_on_failure EXIT

ensure_allowlist_host() {
  local host="$1"
  local current updated
  current="$(sudo sed -n 's/^DOMESTIC_OUTBOUND_ALLOWLIST=//p' "$ENV_FILE" | tail -n 1)"
  test -n "$current"
  case ",$current," in
    *",$host,"*) return ;;
  esac
  updated="$current,$host"
  sudo sed -i "s|^DOMESTIC_OUTBOUND_ALLOWLIST=.*|DOMESTIC_OUTBOUND_ALLOWLIST=$updated|" "$ENV_FILE"
}

ensure_allowlist_host "qyapi.weixin.qq.com"
ensure_allowlist_host "open.feishu.cn"

tar -xzf "$ARCHIVE" -C "$STAGE_DIR"
test -f "$STAGE_DIR/apps/api/dist/apps/api/src/server.js"
test -f "$STAGE_DIR/apps/web/dist/index.html"
test -f "$STAGE_DIR/apps/api/src/services/platform-knowledge-connectors.ts"
test -f "$STAGE_DIR/apps/api/src/routes/knowledge-base.ts"
test -f "$STAGE_DIR/apps/web/src/pages/EnterpriseKnowledgeBasePage.tsx"
test -f "$STAGE_DIR/apps/web/src/pages/AgentProductsApp.tsx"
test -f "$STAGE_DIR/scripts/platform-knowledge-connectors-smoke.ts"

set -a
. "$ENV_FILE"
set +a
cd "$STAGE_DIR"
pnpm install --frozen-lockfile --prod=false
pnpm --filter @baolu/db prisma:generate
pnpm prelaunch:check -- --env "$ENV_FILE"
pnpm knowledge:platform-connectors-smoke

pg_dump "$DATABASE_URL" --format=custom --file="$BACKUP_DIR/database-before.dump"
sha256sum "$APP_DIR/apps/web/dist/index.html" "$APP_DIR/apps/api/dist/apps/api/src/server.js" "$BACKUP_DIR/database-before.dump" > "$BACKUP_DIR/SHA256SUMS-before"

bash "$APP_DIR/scripts/production-switch-with-rollback.sh" "$STAGE_DIR" "$BACKUP_DIR"
SWITCHED=true

curl -fsS http://127.0.0.1:3002/health >/dev/null
curl -fsS http://127.0.0.1:3002/ready >/dev/null
curl -fsS http://127.0.0.1:3002/mcp/status >/dev/null
test "$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/knowledge-base")" = "200"
grep -q "同步飞书资料" "$APP_DIR/apps/web/dist/assets/"*.js
grep -q "platform-knowledge-connectors" "$APP_DIR/apps/api/dist/apps/api/src/routes/knowledge-base.js"

cd "$APP_DIR"
pnpm knowledge:platform-connectors-smoke
sha256sum "$APP_DIR/apps/web/dist/index.html" "$APP_DIR/apps/api/dist/apps/api/src/server.js" > "$BACKUP_DIR/SHA256SUMS-after"
date -Iseconds > "$BACKUP_DIR/DEPLOYMENT-SWITCH-SUCCEEDED"
SUCCEEDED=true
trap - EXIT

systemctl show "$SERVICE_NAME" -p ActiveState -p SubState -p MainPID
echo "Platform knowledge sync deployment completed: $RELEASE_ID"
