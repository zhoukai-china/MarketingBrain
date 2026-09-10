#!/usr/bin/env bash
# 只读验收：生产 lanqi 授权生效矩阵（不改任何数据）
set -uo pipefail

PSQL="sudo -u postgres psql -d baolu_os_v2 -X -tA -F|"

read -r CTRL_TID CTRL_UID < <($PSQL -c "select e.\"tenantId\", m.\"userId\" from \"TenantProductEntitlement\" e join \"Membership\" m on m.\"tenantId\"=e.\"tenantId\" and m.role='owner' where e.\"productCode\"='founder-ip' and e.status='active' and not exists (select 1 from \"TenantProductEntitlement\" x where x.\"tenantId\"=e.\"tenantId\" and x.\"productCode\"='lanqi') limit 1;" | tr '|' ' ')

LQ1_TID=cmt6idd1c04v62hgb86gvh7pz
LQ1_UID=cmt6idd1g04v72hgbue4moh86

echo "control_tenant=${CTRL_TID} control_user=${CTRL_UID}"

probe() { # label url tenant user
  local label="$1" url="$2" tid="$3" uid="$4"
  local args=(-s -o /tmp/_body.txt -w '%{http_code}')
  if [ -n "$tid" ]; then args+=(-H "x-sitong-tenant-id: ${tid}" -H "x-sitong-user-id: ${uid}"); fi
  local code
  code=$(curl "${args[@]}" "$url")
  printf '%-46s -> %s  body=%s\n' "$label" "$code" "$(head -c 160 /tmp/_body.txt)"
}

BASE=http://127.0.0.1:3002
echo "===== 1) 匿名（应 401）"
probe "anon /lanqi/stores" "$BASE/lanqi/stores" "" ""
echo "===== 2) 兰琪租户（应 200）"
probe "lanqi-tenant /lanqi/stores" "$BASE/lanqi/stores" "$LQ1_TID" "$LQ1_UID"
probe "lanqi-tenant /lanqi/dashboard" "$BASE/lanqi/dashboard?month=2026-09" "$LQ1_TID" "$LQ1_UID"
echo "===== 3) 无 lanqi 授权的对照租户（应 403 product_entitlement_missing）"
probe "ctrl /lanqi/stores" "$BASE/lanqi/stores" "$CTRL_TID" "$CTRL_UID"
probe "ctrl /lanqi/dashboard" "$BASE/lanqi/dashboard?month=2026-09" "$CTRL_TID" "$CTRL_UID"
echo "===== 4) 对照租户自己的产品仍可用（应 200，证明不是全局放开）"
probe "ctrl /chat/product-summary" "$BASE/chat/product-summary" "$CTRL_TID" "$CTRL_UID"
