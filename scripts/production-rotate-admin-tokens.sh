#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/baolu-secrets/baolu-os-v2.env}"
SERVICE_NAME="${SERVICE_NAME:-baolu-os-v2}"
BACKUP_FILE="${1:?Pass a protected backup filename}"

if [ -e "$BACKUP_FILE" ]; then
  echo "Refusing to overwrite token rotation backup: $BACKUP_FILE" >&2
  exit 1
fi

sudo install -m 600 "$ENV_FILE" "$BACKUP_FILE"
admin_token="$(openssl rand -hex 40)"
ops_token="$(openssl rand -hex 40)"

sudo sed -i \
  -e "s/^ADMIN_TOKEN=.*/ADMIN_TOKEN=${admin_token}/" \
  -e "s/^OPS_TOKEN=.*/OPS_TOKEN=${ops_token}/" \
  "$ENV_FILE"
sudo chown root:admin "$ENV_FILE"
sudo chmod 640 "$ENV_FILE"
unset admin_token ops_token

sudo systemctl restart "$SERVICE_NAME"
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3002/ready >/dev/null; then
    echo "Admin and ops tokens rotated; service is ready."
    exit 0
  fi
  sleep 1
done

echo "Service did not become ready after token rotation." >&2
exit 1
