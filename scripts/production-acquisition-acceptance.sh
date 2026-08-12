#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/baolu-os-v2}"
ENV_FILE="${ENV_FILE:-/etc/baolu-secrets/baolu-os-v2.env}"
BASE_URL="${BASE_URL:-http://127.0.0.1:3002}"

set -a
. "$ENV_FILE"
set +a

code="st-accept-$(openssl rand -hex 8)"
expires_at="$(date -u -d '+7 days' '+%Y-%m-%dT%H:%M:%S.000Z')"

cd "$APP_DIR"
INVITE_CODE="$code" pnpm invite:create -- \
  --label "2026-07-30四场景生产验收" \
  --plan chain_premium \
  --max-uses 1 \
  --expires-at "$expires_at"

login="$(
  curl -fsS \
    -X POST \
    -H "Content-Type: application/json" \
    --data "$(
      node -e '
        console.log(JSON.stringify({
          tenantRole: "chain_brand",
          planCode: "chain_premium",
          tenantName: "四场景生产验收",
          industry: "餐饮美业连锁",
          city: "沈阳",
          nickname: "生产验收",
          inviteCode: process.argv[1]
        }));
      ' "$code"
    )" \
    "${BASE_URL}/auth/beta-login"
)"
token="$(
  node -e '
    const body = JSON.parse(process.argv[1]);
    if (!body.token) process.exit(1);
    process.stdout.write(body.token);
  ' "$login"
)"
unset code login

node scripts/acquisition-scenarios-acceptance.mjs \
  --base "$BASE_URL" \
  --token "$token"
unset token
