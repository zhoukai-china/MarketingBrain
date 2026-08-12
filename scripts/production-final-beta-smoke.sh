#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/baolu-os-v2}"
ENV_FILE="${ENV_FILE:-/etc/baolu-secrets/baolu-os-v2.env}"
BASE_URL="${BASE_URL:-http://127.0.0.1:3002}"

set -a
. "$ENV_FILE"
set +a

smoke_a="st-final-a-$(openssl rand -hex 8)"
smoke_b="st-final-b-$(openssl rand -hex 8)"
expires_at="$(date -u -d '+2 days' '+%Y-%m-%dT%H:%M:%S.000Z')"

cd "$APP_DIR"
INVITE_CODE="$smoke_a" pnpm invite:create -- \
  --label "2026-07-30最终生产冒烟-A" \
  --plan chain_premium \
  --max-uses 1 \
  --expires-at "$expires_at"
INVITE_CODE="$smoke_b" pnpm invite:create -- \
  --label "2026-07-30最终生产冒烟-B" \
  --plan chain_premium \
  --max-uses 1 \
  --expires-at "$expires_at"

export BETA_SMOKE_INVITE_CODE="$smoke_a"
export BETA_SMOKE_SECOND_INVITE_CODE="$smoke_b"
unset smoke_a smoke_b

node scripts/beta-smoke.mjs \
  --base "$BASE_URL"
