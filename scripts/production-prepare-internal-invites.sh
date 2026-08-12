#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/baolu-os-v2}"
ENV_FILE="${ENV_FILE:-/etc/baolu-secrets/baolu-os-v2.env}"
CODES_FILE="${1:?Pass a protected output path for plaintext internal codes}"
shift

if [ -e "$CODES_FILE" ]; then
  echo "Refusing to overwrite existing codes file: $CODES_FILE" >&2
  exit 1
fi
if [ "$(readlink -f "$APP_DIR")" != "/opt/baolu-os-v2" ]; then
  echo "Unexpected APP_DIR: $APP_DIR" >&2
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

expires_at="$(date -u -d '+30 days' '+%Y-%m-%dT%H:%M:%S.000Z')"
smoke_a="st-smoke-a-$(openssl rand -hex 8)"
smoke_b="st-smoke-b-$(openssl rand -hex 8)"
concurrency="st-once-$(openssl rand -hex 8)"
manual_a="st-internal-a-$(openssl rand -hex 8)"
manual_b="st-internal-b-$(openssl rand -hex 8)"

umask 077
{
  printf 'SMOKE_A=%s\n' "$smoke_a"
  printf 'SMOKE_B=%s\n' "$smoke_b"
  printf 'CONCURRENCY=%s\n' "$concurrency"
  printf 'INTERNAL_A=%s\n' "$manual_a"
  printf 'INTERNAL_B=%s\n' "$manual_b"
  printf 'EXPIRES_AT=%s\n' "$expires_at"
} > "$CODES_FILE"
chmod 600 "$CODES_FILE"

cd "$APP_DIR"
create_invite() {
  local code="$1"
  local label="$2"
  INVITE_CODE="$code" pnpm invite:create -- \
    --label "$label" \
    --plan chain_premium \
    --max-uses 1 \
    --expires-at "$expires_at"
}

create_invite "$smoke_a" "2026-07-30生产验收-自动A"
create_invite "$smoke_b" "2026-07-30生产验收-自动B"
create_invite "$concurrency" "2026-07-30生产验收-并发一次性"
create_invite "$manual_a" "2026-07-30内部体验-A"
create_invite "$manual_b" "2026-07-30内部体验-B"

for invite_id in "$@"; do
  response="$(
    curl -fsS \
      -X PATCH \
      -H "x-sitong-admin-token: $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      --data '{"isActive":false}' \
      "http://127.0.0.1:3002/admin/invites/${invite_id}"
  )"
  node -e '
    const body = JSON.parse(process.argv[1]);
    if (!body.invite || body.invite.isActive !== false) process.exit(1);
    console.log(JSON.stringify({
      id: body.invite.id,
      codePreview: body.invite.codePreview,
      label: body.invite.label,
      isActive: body.invite.isActive
    }));
  ' "$response"
done

unset smoke_a smoke_b concurrency manual_a manual_b
echo "Internal invite preparation completed. Plaintext values remain only in $CODES_FILE."
