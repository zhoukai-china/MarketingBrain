#!/usr/bin/env bash
set -euo pipefail
RELEASE_ID="${1:?Pass release id}"
APP_DIR=/opt/baolu-os-v2
SERVICE_NAME=baolu-os-v2
ENV_FILE=/etc/baolu-secrets/baolu-os-v2.env
BASE_URL=https://api.lcppch.top/os-v2
STAGE_DIR="/opt/baolu-stage/$RELEASE_ID"
BACKUP_DIR="/opt/baolu-backups/$RELEASE_ID-before"
SWITCHED=false
SUCCEEDED=false
test "$(readlink -f "$APP_DIR")" = "$APP_DIR"
test "$(systemctl is-active "$SERVICE_NAME")" = active
test -f "$ENV_FILE"
test -d "$STAGE_DIR"
test ! -e "$BACKUP_DIR"
sudo install -d -m 750 -o admin -g admin "$BACKUP_DIR"
sudo cp -a "$ENV_FILE" "$BACKUP_DIR/baolu-os-v2.env.before"
restore() { local code=$?; if [ "$SUCCEEDED" = true ]; then return; fi; sudo cp -a "$BACKUP_DIR/baolu-os-v2.env.before" "$ENV_FILE" || true; if [ "$SWITCHED" = true ] && [ -d "$BACKUP_DIR/previous-app" ]; then sudo systemctl stop "$SERVICE_NAME" || true; sudo mv "$APP_DIR" "$BACKUP_DIR/failed-app-after-check" || true; sudo mv "$BACKUP_DIR/previous-app" "$APP_DIR" || true; sudo systemctl start "$SERVICE_NAME" || true; fi; exit "$code"; }
trap restore EXIT
for host in qyapi.weixin.qq.com open.feishu.cn; do
  current="$(sudo sed -n 's/^DOMESTIC_OUTBOUND_ALLOWLIST=//p' "$ENV_FILE" | tail -n 1)"; test -n "$current"
  case ",$current," in *",$host,"*) ;; *) sudo sed -i "s|^DOMESTIC_OUTBOUND_ALLOWLIST=.*|DOMESTIC_OUTBOUND_ALLOWLIST=$current,$host|" "$ENV_FILE";; esac
done
test -f "$STAGE_DIR/apps/api/dist/apps/api/src/services/platform-knowledge-connectors.js"
test -f "$STAGE_DIR/apps/api/dist/apps/api/src/routes/knowledge-base.js"
grep -q "同步飞书资料" "$STAGE_DIR/apps/web/dist/assets/"*.js
set -a; . "$ENV_FILE"; set +a
cd "$STAGE_DIR"
pnpm prelaunch:check -- --env "$ENV_FILE"
pnpm knowledge:platform-connectors-smoke
pg_dump "$DATABASE_URL" --format=custom --file="$BACKUP_DIR/database-before.dump"
sha256sum "$APP_DIR/apps/web/dist/index.html" "$APP_DIR/apps/api/dist/apps/api/src/server.js" "$BACKUP_DIR/database-before.dump" > "$BACKUP_DIR/SHA256SUMS-before"
bash "$APP_DIR/scripts/production-switch-with-rollback.sh" "$STAGE_DIR" "$BACKUP_DIR"
SWITCHED=true
curl -fsS http://127.0.0.1:3002/health >/dev/null
curl -fsS http://127.0.0.1:3002/ready >/dev/null
test "$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/knowledge-base")" = 200
grep -q "同步飞书资料" "$APP_DIR/apps/web/dist/assets/"*.js
cd "$APP_DIR"; pnpm knowledge:platform-connectors-smoke
date -Iseconds > "$BACKUP_DIR/DEPLOYMENT-SWITCH-SUCCEEDED"
SUCCEEDED=true; trap - EXIT
systemctl show "$SERVICE_NAME" -p ActiveState -p SubState -p MainPID
echo "Differential production deployment completed: $RELEASE_ID"
