#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/baolu-secrets/baolu-os-v2.env}"
BASE_URL="${BASE_URL:-http://127.0.0.1:3002}"

set -a
. "$ENV_FILE"
set +a

check_json() {
  local name="$1"
  local path="$2"
  local required_field="$3"
  local response
  response="$(
    curl -fsS \
      -H "x-sitong-admin-token: $ADMIN_TOKEN" \
      "${BASE_URL}${path}"
  )"
  node -e '
    const [name, field, raw] = process.argv.slice(1);
    const body = JSON.parse(raw);
    if (!(field in body)) {
      console.error(`${name}: missing ${field}`);
      process.exit(1);
    }
    console.log(JSON.stringify({ check: name, ok: true }));
  ' "$name" "$required_field" "$response"
}

check_json "admin_ops_summary" "/admin/ops/summary" "dataMode"
check_json "admin_billing_audit" "/admin/billing/audit" "ok"
check_json "admin_isolation_audit" "/admin/security/isolation-audit" "ok"
check_json "admin_quality_summary" "/admin/quality/summary" "dataMode"
check_json "admin_invite_list" "/admin/invites" "invites"
check_json "admin_customer_list" "/admin/customers" "customers"

launch="$(
  curl -fsS \
    -H "x-sitong-ops-token: $OPS_TOKEN" \
    "${BASE_URL}/ops/launch-check"
)"
node -e '
  const body = JSON.parse(process.argv[1]);
  if (body.ok !== true || body.launchMode !== "customer_ready") {
    console.error(JSON.stringify(body));
    process.exit(1);
  }
  console.log(JSON.stringify({
    check: "ops_launch_check",
    ok: true,
    launchMode: body.launchMode
  }));
' "$launch"

echo "Production admin verification passed."
