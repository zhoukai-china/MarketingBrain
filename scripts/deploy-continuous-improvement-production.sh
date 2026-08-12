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
QUALITY_SERVICE="/etc/systemd/system/baolu-quality-daily.service"
QUALITY_TIMER="/etc/systemd/system/baolu-quality-daily.timer"
SWITCHED="false"
ENV_CHANGED="false"
UNITS_CHANGED="false"

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
test -f "$STAGE_DIR/packages/db/prisma/migrations/202608100001_continuous_agent_improvement/migration.sql"
test -f "$STAGE_DIR/scripts/run-daily-quality-cycle.ts"
test -f "$STAGE_DIR/deploy/systemd/baolu-quality-daily.service"
test -f "$STAGE_DIR/deploy/systemd/baolu-quality-daily.timer"

cd "$STAGE_DIR"
pnpm install --frozen-lockfile --offline --prod=false
pnpm --filter @baolu/db prisma:generate

set -a
. "$ENV_FILE"
set +a
pg_dump "$DATABASE_URL" --format=custom --file="$BACKUP_DIR/database-before.dump"
sudo cp -a "$ENV_FILE" "$BACKUP_DIR/baolu-os-v2.env.before"
sudo systemctl cat "$SERVICE_NAME" > "$BACKUP_DIR/baolu-os-v2.service.before.txt"
sha256sum "$APP_DIR/apps/web/dist/index.html" "$APP_DIR/apps/api/dist/apps/api/src/server.js" > "$BACKUP_DIR/SHA256SUMS-before"

if sudo test -f "$QUALITY_SERVICE"; then
  sudo cp -a "$QUALITY_SERVICE" "$BACKUP_DIR/baolu-quality-daily.service.before"
else
  touch "$BACKUP_DIR/quality-service-was-absent"
fi
if sudo test -f "$QUALITY_TIMER"; then
  sudo cp -a "$QUALITY_TIMER" "$BACKUP_DIR/baolu-quality-daily.timer.before"
else
  touch "$BACKUP_DIR/quality-timer-was-absent"
fi

restore_units() {
  sudo systemctl disable --now baolu-quality-daily.timer >/dev/null 2>&1 || true
  if [ -f "$BACKUP_DIR/baolu-quality-daily.service.before" ]; then
    sudo install -o root -g root -m 644 "$BACKUP_DIR/baolu-quality-daily.service.before" "$QUALITY_SERVICE"
  else
    sudo rm -f -- "$QUALITY_SERVICE"
  fi
  if [ -f "$BACKUP_DIR/baolu-quality-daily.timer.before" ]; then
    sudo install -o root -g root -m 644 "$BACKUP_DIR/baolu-quality-daily.timer.before" "$QUALITY_TIMER"
  else
    sudo rm -f -- "$QUALITY_TIMER"
  fi
  sudo systemctl daemon-reload || true
}

rollback_on_error() {
  exit_code="$?"
  trap - ERR
  if [ "$UNITS_CHANGED" = "true" ]; then restore_units; fi
  if [ "$SWITCHED" = "true" ]; then
    echo "Continuous improvement deployment failed after switch; rolling back application." >&2
    sudo systemctl stop "$SERVICE_NAME" || true
    if [ -d "$APP_DIR" ] && [ ! -e "$BACKUP_DIR/failed-app" ]; then sudo mv "$APP_DIR" "$BACKUP_DIR/failed-app"; fi
    if [ -d "$BACKUP_DIR/previous-app" ]; then sudo mv "$BACKUP_DIR/previous-app" "$APP_DIR"; fi
  fi
  if [ "$ENV_CHANGED" = "true" ]; then
    sudo install -o root -g admin -m 640 "$BACKUP_DIR/baolu-os-v2.env.before" "$ENV_FILE" || true
  fi
  if [ "$SWITCHED" = "true" ]; then sudo systemctl start "$SERVICE_NAME" || true; fi
  exit "$exit_code"
}
trap rollback_on_error ERR

set_env_value() {
  key="$1"
  value="$2"
  tmp_file="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$ENV_FILE" > "$tmp_file"
  sudo install -o root -g admin -m 640 "$tmp_file" "$ENV_FILE"
  rm -f -- "$tmp_file"
}

ENV_CHANGED="true"
set_env_value CONTINUOUS_IMPROVEMENT_ENABLED true
set_env_value CONTINUOUS_IMPROVEMENT_AUTO_PERSIST true
set_env_value CONTINUOUS_IMPROVEMENT_AUTO_ACTIVATE false
set_env_value CONTINUOUS_IMPROVEMENT_MIN_SAMPLE 10

set -a
. "$ENV_FILE"
set +a
test "$CONTINUOUS_IMPROVEMENT_ENABLED" = "true"
test "$CONTINUOUS_IMPROVEMENT_AUTO_PERSIST" = "true"
test "$CONTINUOUS_IMPROVEMENT_AUTO_ACTIVATE" = "false"
test "$CONTINUOUS_IMPROVEMENT_MIN_SAMPLE" = "10"
pnpm prelaunch:check -- --env "$ENV_FILE"
pnpm --filter @baolu/db prisma:deploy

bash "$STAGE_DIR/scripts/production-switch-with-rollback.sh" "$STAGE_DIR" "$BACKUP_DIR"
SWITCHED="true"

UNITS_CHANGED="true"
sudo install -o root -g root -m 644 "$APP_DIR/deploy/systemd/baolu-quality-daily.service" "$QUALITY_SERVICE"
sudo install -o root -g root -m 644 "$APP_DIR/deploy/systemd/baolu-quality-daily.timer" "$QUALITY_TIMER"
sudo systemctl daemon-reload
sudo systemctl enable --now baolu-quality-daily.timer

curl -fsS http://127.0.0.1:3002/health >/dev/null
curl -fsS http://127.0.0.1:3002/ready >/dev/null
curl -fsS http://127.0.0.1:3002/mcp/status >/dev/null
test "$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/")" = "200"
test "$(systemctl is-enabled baolu-quality-daily.timer)" = "enabled"
test "$(systemctl is-active baolu-quality-daily.timer)" = "active"
systemctl list-timers baolu-quality-daily.timer --no-pager > "$BACKUP_DIR/quality-timer-after.txt"

sha256sum "$APP_DIR/apps/web/dist/index.html" "$APP_DIR/apps/api/dist/apps/api/src/server.js" > "$BACKUP_DIR/SHA256SUMS-after"
date -Iseconds > "$BACKUP_DIR/DEPLOYMENT-SUCCEEDED"
rm -f -- "$ARCHIVE"
trap - ERR
echo "CONTINUOUS-IMPROVEMENT-DEPLOYMENT-SUCCEEDED"
systemctl show "$SERVICE_NAME" -p ActiveState -p SubState -p MainPID
cat "$BACKUP_DIR/quality-timer-after.txt"
