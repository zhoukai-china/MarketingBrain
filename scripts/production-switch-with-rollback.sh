#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/baolu-os-v2}"
NEXT_DIR="${1:?Pass the fully built staging directory as argument 1}"
BACKUP_DIR="${2:?Pass the verified backup directory as argument 2}"
SERVICE_NAME="${SERVICE_NAME:-baolu-os-v2}"
PREVIOUS_DIR="${BACKUP_DIR}/previous-app"
FAILED_DIR="${BACKUP_DIR}/failed-app"

require_exact_path() {
  local actual
  actual="$(readlink -f "$1")"
  if [ "$actual" != "$2" ]; then
    echo "Unexpected path: $1 -> $actual (expected $2)" >&2
    exit 1
  fi
}

require_exact_path "$APP_DIR" "/opt/baolu-os-v2"
require_exact_path "$NEXT_DIR" "$NEXT_DIR"
require_exact_path "$BACKUP_DIR" "$BACKUP_DIR"

if [ -e "$PREVIOUS_DIR" ] || [ -e "$FAILED_DIR" ]; then
  echo "Rollback target already exists under $BACKUP_DIR" >&2
  exit 1
fi
if [ ! -f "$NEXT_DIR/apps/api/dist/apps/api/src/server.js" ]; then
  echo "Staging API build is missing" >&2
  exit 1
fi
if [ ! -f "$NEXT_DIR/apps/web/dist/index.html" ]; then
  echo "Staging web build is missing" >&2
  exit 1
fi

rollback() {
  echo "Deployment health check failed; rolling back." >&2
  sudo systemctl stop "$SERVICE_NAME" || true
  if [ -d "$APP_DIR" ] && [ ! -e "$FAILED_DIR" ]; then
    sudo mv "$APP_DIR" "$FAILED_DIR"
  fi
  if [ -d "$PREVIOUS_DIR" ]; then
    sudo mv "$PREVIOUS_DIR" "$APP_DIR"
  fi
  sudo systemctl start "$SERVICE_NAME"
}

sudo systemctl stop "$SERVICE_NAME"
sudo mv "$APP_DIR" "$PREVIOUS_DIR"
sudo mv "$NEXT_DIR" "$APP_DIR"

sudo install -d -m 755 -o admin -g admin "$APP_DIR/uploads"
if [ -d "$PREVIOUS_DIR/uploads" ]; then
  sudo cp -a "$PREVIOUS_DIR/uploads/." "$APP_DIR/uploads/"
fi
sudo chown -R admin:admin "$APP_DIR"

sudo systemctl start "$SERVICE_NAME"

healthy=false
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:3002/health" >/dev/null &&
    curl -fsS "http://127.0.0.1:3002/ready" >/dev/null &&
    curl -fsS "http://127.0.0.1:3002/mcp/status" >/dev/null; then
    healthy=true
    break
  fi
  sleep 1
done

if [ "$healthy" != "true" ]; then
  rollback
  exit 1
fi

echo "Production switch completed."
systemctl show "$SERVICE_NAME" -p ActiveState -p SubState -p MainPID
curl -fsS "http://127.0.0.1:3002/ready"
echo
curl -fsS "http://127.0.0.1:3002/mcp/status"
echo
