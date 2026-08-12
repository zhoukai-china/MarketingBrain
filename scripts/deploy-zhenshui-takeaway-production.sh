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
grep -q '思潼·外卖增长智能体' "$STAGE_DIR/apps/api/src/services/agent-definitions.ts"
grep -q 'multiple accept=".xlsx,.xls,.csv,.tsv,.json,.txt"' "$STAGE_DIR/apps/web/src/components/takeaway/TakeawayGrowthDataPanel.tsx"
grep -q 'readTakeawayWorkbook' "$STAGE_DIR/apps/api/src/services/takeaway-growth-data.ts"
grep -q '"catalog"' "$STAGE_DIR/apps/api/src/services/takeaway-growth-data.ts"
grep -q 'inferTakeawayRoutingCapability' "$STAGE_DIR/apps/api/src/routes/agents.ts"
grep -q 'shouldReplaceSparseTakeawayAnswer' "$STAGE_DIR/packages/agent/src/index.ts"
grep -q 'scenarioNotice' "$STAGE_DIR/apps/web/src/pages/AgentProductsApp.tsx"
grep -R -q 'https://api.lcppch.top/os-v2/api' "$STAGE_DIR/apps/web/dist/assets"

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
    echo "Zhenshui takeaway deployment failed after switch; rolling back." >&2
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
test "$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/agents/takeaway-growth")" = "200"
curl -fsS "$BASE_URL/api/agents/takeaway-growth" >/tmp/zhenshui-takeaway-agent.json
node - <<'NODE'
const fs = require("fs");
const agent = JSON.parse(fs.readFileSync("/tmp/zhenshui-takeaway-agent.json", "utf8"));
if (agent.name !== "思潼·外卖增长智能体") throw new Error(`agent_name_invalid:${agent.name}`);
const requiredCapabilities = ["takeaway_data_foundation", "takeaway_growth", "takeaway_problem_validation", "takeaway_experiment", "takeaway_execution", "takeaway_effect_evaluation", "takeaway_review"];
if (!Array.isArray(agent.capabilities) || !requiredCapabilities.every((key) => agent.capabilities.some((item) => item.key === key))) throw new Error("takeaway_capabilities_invalid");
NODE
curl -fsS "$BASE_URL/api/public/tenant-branding?hostname=api.lcppch.top" >/tmp/zhenshui-takeaway-branding.json
node - <<'NODE'
const fs = require("fs");
const payload = JSON.parse(fs.readFileSync("/tmp/zhenshui-takeaway-branding.json", "utf8"));
if (typeof payload.branding?.brandName !== "string" || !payload.branding.brandName.trim()) throw new Error("branding_name_invalid");
NODE

sha256sum "$APP_DIR/apps/web/dist/index.html" "$APP_DIR/apps/api/dist/apps/api/src/server.js" > "$BACKUP_DIR/SHA256SUMS-after"
date -Iseconds > "$BACKUP_DIR/DEPLOYMENT-SWITCH-SUCCEEDED"
trap - ERR
echo "ZHENSHUI-TAKEAWAY-DEPLOYMENT-SUCCEEDED"
systemctl show "$SERVICE_NAME" -p ActiveState -p SubState -p MainPID
