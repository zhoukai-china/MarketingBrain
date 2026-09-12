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
BASE_URL="https://api.lcppch.top/os-v2"
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

restore_on_failure() {
  local status=$?
  if [ "$SUCCEEDED" = true ]; then return; fi
  sudo cp -a "$BACKUP_DIR/baolu-os-v2.env.before" "$ENV_FILE" || true
  if [ "$SWITCHED" = true ] && [ -d "$BACKUP_DIR/previous-app" ]; then
    sudo systemctl stop "$SERVICE_NAME" || true
    [ -d "$APP_DIR" ] && sudo mv "$APP_DIR" "$BACKUP_DIR/failed-app-after-check" || true
    sudo mv "$BACKUP_DIR/previous-app" "$APP_DIR" || true
    sudo systemctl start "$SERVICE_NAME" || true
  fi
  exit "$status"
}
trap restore_on_failure EXIT

set_env_if_missing() {
  local key="$1" value="$2"
  if ! sudo grep -q "^${key}=" "$ENV_FILE"; then
    printf '%s=%s\n' "$key" "$value" | sudo tee -a "$ENV_FILE" >/dev/null
  fi
}

existing_dashscope_key="$(sudo sed -n 's/^DASHSCOPE_API_KEY=//p' "$ENV_FILE" | tail -n 1)"
test -n "$existing_dashscope_key"
set_env_if_missing "ALIYUN_VIDEO_REPLICATION_API_KEY" "$existing_dashscope_key"
# wan2.2-animate-mix 只接受 image2video 端点；video-generation 端点会返回 url error。
set_env_if_missing "ALIYUN_VIDEO_REPLICATION_ENDPOINT" "https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/video-synthesis"
set_env_if_missing "ALIYUN_VIDEO_REPLICATION_MODEL" "wan2.2-animate-mix"
# Deliberately disabled until a product owner confirms the customer-facing credit price.
set_env_if_missing "ALIYUN_VIDEO_REPLICATION_CREDITS" "0"
set_env_if_missing "ALIYUN_VIDEO_REPLICATION_CALLBACK_TOKEN" "$(openssl rand -hex 32)"

set -a
. "$ENV_FILE"
set +a
curl -fsS -H "Authorization: Bearer $ALIYUN_VIDEO_REPLICATION_API_KEY" "https://dashscope.aliyuncs.com/compatible-mode/v1/models" >/dev/null

tar -xzf "$ARCHIVE" -C "$STAGE_DIR"
test -f "$STAGE_DIR/apps/api/src/routes/viral-video-replication.ts"
test -f "$STAGE_DIR/packages/db/prisma/migrations/202608110002_viral_video_replication_jobs/migration.sql"
test -f "$STAGE_DIR/apps/web/src/components/acquisition/ContentSystemWorkbench.tsx"
test -f "$STAGE_DIR/apps/api/dist/apps/api/src/server.js"
test -f "$STAGE_DIR/apps/web/dist/index.html"

cd "$STAGE_DIR"
pnpm install --frozen-lockfile --prod=false
pnpm --filter @baolu/db prisma:generate
pnpm prelaunch:check -- --env "$ENV_FILE"
pnpm content-system:viral-replication-smoke
pg_dump "$DATABASE_URL" --format=custom --file="$BACKUP_DIR/database-before.dump"
pnpm --filter @baolu/db prisma:deploy

bash "$APP_DIR/scripts/production-switch-with-rollback.sh" "$STAGE_DIR" "$BACKUP_DIR"
SWITCHED=true
curl -fsS "$BASE_URL/api/health" >/dev/null
test "$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/agents/acquisition?system=content_plan")" = "200"
grep -R -q "爆款复刻" "$APP_DIR/apps/web/dist/assets"
grep -q "viral-video-replication" "$APP_DIR/apps/api/dist/apps/api/src/server.js"
date -Iseconds > "$BACKUP_DIR/DEPLOYMENT-SWITCH-SUCCEEDED"
SUCCEEDED=true
trap - EXIT
systemctl show "$SERVICE_NAME" -p ActiveState -p SubState -p MainPID
echo "Viral video replication production deployment completed: $RELEASE_ID"
