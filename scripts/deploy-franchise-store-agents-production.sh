#!/usr/bin/env bash
set -euo pipefail

ARCHIVE="${1:?Pass deployment archive path}"
ARCHIVE_SHA256="${2:?Pass archive SHA-256}"
RELEASE_ID="${3:?Pass release id}"
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

sudo install -d -m 755 -o admin -g admin /opt/baolu-stage "$STAGE_DIR"
sudo install -d -m 750 -o admin -g admin "$BACKUP_DIR"

restore_on_failure() {
  local exit_code=$?
  if [ "$SUCCEEDED" = true ]; then return; fi
  echo "Franchise/store agent deployment failed; rolling back." >&2
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

tar -xzf "$ARCHIVE" -C "$STAGE_DIR"
test -f "$STAGE_DIR/apps/api/src/services/agent-definitions.ts"
test -f "$STAGE_DIR/apps/api/src/routes/agents.ts"
test -f "$STAGE_DIR/apps/web/src/pages/AgentProductsApp.tsx"
grep -q 'id: "agent_store_acquisition"' "$STAGE_DIR/apps/api/src/services/agent-definitions.ts"
grep -q '思潼·品牌招商智能体' "$STAGE_DIR/apps/api/src/services/agent-definitions.ts"
grep -q 'latest-video-review' "$STAGE_DIR/apps/api/src/routes/agents.ts"

cd "$STAGE_DIR"
pnpm install --offline --frozen-lockfile --prod=false
pnpm --filter @baolu/db prisma:generate
pnpm prelaunch:check -- --env "$ENV_FILE"
pnpm build:clean
test -f "$STAGE_DIR/apps/api/dist/apps/api/src/server.js"
test -f "$STAGE_DIR/apps/web/dist/index.html"

bash "$APP_DIR/scripts/production-switch-with-rollback.sh" "$STAGE_DIR" "$BACKUP_DIR"
SWITCHED=true

curl -fsS http://127.0.0.1:3002/health >/dev/null
curl -fsS http://127.0.0.1:3002/ready >/dev/null
curl -fsS http://127.0.0.1:3002/mcp/status >/dev/null
curl -fsS http://127.0.0.1:3002/agents/acquisition > "$BACKUP_DIR/acquisition-after.json"
curl -fsS http://127.0.0.1:3002/agents/store-acquisition > "$BACKUP_DIR/store-acquisition-after.json"
node - "$BACKUP_DIR/acquisition-after.json" "$BACKUP_DIR/store-acquisition-after.json" <<'NODE'
const fs = require("fs");
const franchise = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const store = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
if (franchise.name !== "思潼·品牌招商智能体" || store.name !== "思潼·门店获客智能体") throw new Error("agent_name_mismatch");
if (franchise.slug !== "acquisition" || store.slug !== "store-acquisition") throw new Error("agent_slug_mismatch");
console.log("agent_release_contract:PASS");
NODE
for page in /agents/acquisition /agents/store-acquisition; do
  test "$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL$page")" = "200"
done

sha256sum "$APP_DIR/apps/web/dist/index.html" "$APP_DIR/apps/api/dist/apps/api/src/server.js" > "$BACKUP_DIR/SHA256SUMS-after"
date -Iseconds > "$BACKUP_DIR/DEPLOYMENT-SUCCEEDED"
SUCCEEDED=true
trap - EXIT
systemctl show "$SERVICE_NAME" -p ActiveState -p SubState -p MainPID
echo "FRANCHISE_STORE_AGENT_DEPLOYMENT_SUCCEEDED release=${RELEASE_ID} backup=${BACKUP_DIR}"
