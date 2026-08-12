#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/Sitong-os-v2}"
ENV_FILE="${ENV_FILE:-/etc/Sitong-secrets/Sitong-os-v2.env}"
SERVICE_NAME="${SERVICE_NAME:-Sitong-os-v2}"
PNPM_BIN="${PNPM_BIN:-pnpm}"

cd "$APP_DIR"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

echo "==> Static prelaunch check"
$PNPM_BIN prelaunch:check -- --env "$ENV_FILE"

echo "==> Load production environment"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
API_PORT="${PORT:-3011}"

echo "==> Install dependencies"
CI="${CI:-true}" $PNPM_BIN install --frozen-lockfile --prod=false

echo "==> Generate Prisma client"
$PNPM_BIN --filter @baolu/db prisma:generate

echo "==> Run database migrations"
$PNPM_BIN --filter @baolu/db prisma:deploy

echo "==> Build packages"
$PNPM_BIN build:clean

echo "==> Restart service"
sudo systemctl restart "$SERVICE_NAME"

echo "==> Wait for API"
sleep 3

echo "==> Health"
curl -fsS "http://127.0.0.1:${API_PORT}/health"
echo

echo "==> Ready"
curl -fsS "http://127.0.0.1:${API_PORT}/ready"
echo

echo "==> Original Skill MCP"
curl -fsS "http://127.0.0.1:${API_PORT}/mcp/status"
echo

echo "Deploy completed. Continue with ops launch-check, llm-smoke, WeChat auth and pay callback tests."
