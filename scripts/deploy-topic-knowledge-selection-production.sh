#!/usr/bin/env bash
set -euo pipefail

ARCHIVE="${1:?Pass the patch archive path}"
ARCHIVE_SHA256="${2:?Pass the patch archive SHA-256}"
RELEASE_ID="${3:?Pass the release id}"
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
test -f "$ARCHIVE" && test -f "$ENV_FILE"
test ! -e "$STAGE_DIR" && test ! -e "$BACKUP_DIR"
echo "$ARCHIVE_SHA256  $ARCHIVE" | sha256sum -c -

sudo install -d -m 755 -o admin -g admin /opt/baolu-stage
sudo install -d -m 750 -o admin -g admin "$BACKUP_DIR"

restore_on_failure() {
  local exit_code=$?
  if [ "$SUCCEEDED" = true ]; then return; fi
  echo "Topic knowledge selection deployment failed; rolling back." >&2
  if [ "$SWITCHED" = true ]; then
    sudo systemctl stop "$SERVICE_NAME" || true
    if [ -d "$APP_DIR" ] && [ ! -e "$BACKUP_DIR/failed-app" ]; then sudo mv "$APP_DIR" "$BACKUP_DIR/failed-app"; fi
    if [ -d "$BACKUP_DIR/previous-app" ]; then sudo mv "$BACKUP_DIR/previous-app" "$APP_DIR"; fi
  fi
  if [ -f "$BACKUP_DIR/baolu-os-v2.env.before" ]; then sudo install -o root -g admin -m 640 "$BACKUP_DIR/baolu-os-v2.env.before" "$ENV_FILE" || true; fi
  sudo systemctl start "$SERVICE_NAME" || true
  exit "$exit_code"
}
trap restore_on_failure EXIT

sudo cp -a "$ENV_FILE" "$BACKUP_DIR/baolu-os-v2.env.before"
sudo systemctl cat "$SERVICE_NAME" > "$BACKUP_DIR/baolu-os-v2.service.before.txt"
sudo nginx -T > "$BACKUP_DIR/nginx-before.txt" 2>&1
set -a
. "$ENV_FILE"
set +a
pg_dump "$DATABASE_URL" --format=custom --file="$BACKUP_DIR/database-before.dump"
sha256sum "$APP_DIR/apps/web/dist/index.html" "$APP_DIR/apps/api/dist/apps/api/src/server.js" "$BACKUP_DIR/database-before.dump" > "$BACKUP_DIR/SHA256SUMS-before"

sudo cp -a "$APP_DIR" "$STAGE_DIR"
sudo chown -R admin:admin "$STAGE_DIR"
tar -xzf "$ARCHIVE" -C "$STAGE_DIR"
test -f "$STAGE_DIR/apps/api/src/routes/agents.ts"
test -f "$STAGE_DIR/apps/api/src/routes/knowledge-base.ts"
test -f "$STAGE_DIR/apps/web/src/components/acquisition/TopicSystemWorkbench.tsx"
test -f "$STAGE_DIR/scripts/topic-knowledge-selection-smoke.mjs"
grep -q 'documentQuery.set("subjectId", subjectId)' "$STAGE_DIR/apps/web/src/components/acquisition/TopicSystemWorkbench.tsx"
! grep -q 'knowledge_subject_mismatch' "$STAGE_DIR/apps/api/src/routes/agents.ts"

cd "$STAGE_DIR"
pnpm prelaunch:check -- --env "$ENV_FILE"
pnpm --filter @baolu/db prisma:generate
pnpm build:clean
node scripts/topic-knowledge-selection-smoke.mjs
test -f "$STAGE_DIR/apps/api/dist/apps/api/src/server.js"
test -f "$STAGE_DIR/apps/web/dist/index.html"

bash "$APP_DIR/scripts/production-switch-with-rollback.sh" "$STAGE_DIR" "$BACKUP_DIR"
SWITCHED=true

curl -fsS http://127.0.0.1:3002/health >/dev/null
curl -fsS http://127.0.0.1:3002/ready >/dev/null
curl -fsS http://127.0.0.1:3002/mcp/status >/dev/null
curl -fsS http://127.0.0.1:3002/agents/acquisition >/dev/null
test "$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/agents/acquisition")" = "200"
grep -q 'documentQuery.set("subjectId", subjectId)' "$APP_DIR/apps/web/src/components/acquisition/TopicSystemWorkbench.tsx"
! grep -q 'knowledge_subject_mismatch' "$APP_DIR/apps/api/src/routes/agents.ts"
sha256sum "$APP_DIR/apps/web/dist/index.html" "$APP_DIR/apps/api/dist/apps/api/src/server.js" > "$BACKUP_DIR/SHA256SUMS-after"
date -Iseconds > "$BACKUP_DIR/DEPLOYMENT-SUCCEEDED"
SUCCEEDED=true
trap - EXIT
systemctl show "$SERVICE_NAME" -p ActiveState -p SubState -p MainPID
echo "TOPIC_KNOWLEDGE_SELECTION_DEPLOYMENT_SUCCEEDED release=${RELEASE_ID} backup=${BACKUP_DIR}"
