#!/usr/bin/env bash
# 修复后验收：兰琪授权 + Prisma 客户端 4 模型修复的端到端探测。
# 用法：ssh -i <key> admin@api.lcppch.top "bash -s" < scripts/tmp/prod-lanqi-prisma-client-acceptance.sh
set -uo pipefail
BASE=http://127.0.0.1:3002
LT=cmt6idd1c04v62hgb86gvh7pz            # 兰琪租户（有 lanqi 授权）
CT=cmqzy0z6a00011ayp0m5dcouh            # 对照租户（无 lanqi，有 founder-ip）
SID=cmt6idd1j04v92hgbyxtcd694           # 兰琪默认门店

lu=$(sudo -u postgres psql -tAq -d baolu_os_v2 -c "select \"userId\" from \"Membership\" where \"tenantId\"='$LT' and \"isActive\" order by \"createdAt\" limit 1")
cu=$(sudo -u postgres psql -tAq -d baolu_os_v2 -c "select \"userId\" from \"Membership\" where \"tenantId\"='$CT' and \"isActive\" order by \"createdAt\" limit 1")
echo "lanqiUser=$lu controlUser=$cu"

probe() { # label expected url [extra curl args...]
  local label="$1" want="$2" url="$3"; shift 3
  local out code
  out="$(curl -s -o /tmp/pr.json -w '%{http_code}' "$@" "$url" || echo 000)"
  code="$out"
  local mark="OK "
  [ "$code" = "$want" ] || mark="!! "
  printf '%s%-46s -> %s (want %s)  %s\n' "$mark" "$label" "$code" "$want" "$(head -c 130 /tmp/pr.json | tr -d '\n')"
}

echo
echo "===== A. 匿名（必须 401）====="
probe "anon /lanqi/stores" 401 "$BASE/lanqi/stores"
probe "anon /lanqi/dashboard" 401 "$BASE/lanqi/dashboard?month=2026-09"

echo
echo "===== B. 兰琪租户（修复目标，必须 200）====="
LH=(-H "x-sitong-tenant-id: $LT" -H "x-sitong-user-id: $lu")
probe "lanqi /lanqi/stores" 200 "$BASE/lanqi/stores" "${LH[@]}"
probe "lanqi /lanqi/dashboard" 200 "$BASE/lanqi/dashboard?month=2026-09" "${LH[@]}"
probe "lanqi /lanqi/goals" 200 "$BASE/lanqi/goals?storeId=$SID&month=2026-09" "${LH[@]}"
probe "lanqi /lanqi/moments/upgrades" 200 "$BASE/lanqi/moments/upgrades?storeId=$SID&month=2026-09" "${LH[@]}"
probe "lanqi /lanqi/store-profile" 200 "$BASE/lanqi/store-profile" "${LH[@]}"

echo
echo "===== C. 对照租户（无 lanqi 授权，必须 403 且不得越权）====="
CH=(-H "x-sitong-tenant-id: $CT" -H "x-sitong-user-id: $cu")
probe "control /lanqi/stores" 403 "$BASE/lanqi/stores" "${CH[@]}"
probe "control /lanqi/dashboard" 403 "$BASE/lanqi/dashboard?month=2026-09" "${CH[@]}"
probe "control /lanqi/goals" 403 "$BASE/lanqi/goals?storeId=$SID&month=2026-09" "${CH[@]}"

echo
echo "===== D. 美业与平台（回归基线，必须 200）====="
probe "beauty /beauty-industry/stores" 200 "$BASE/beauty-industry/stores" "${LH[@]}"
probe "platform /health" 200 "$BASE/health"
probe "platform /ready" 200 "$BASE/ready"

echo
echo "===== E. 运行时错误日志（应无 findUnique/findMany undefined）====="
sudo journalctl -u baolu-os-v2 --since "-6min" --no-pager 2>/dev/null \
  | grep -c "Cannot read properties of undefined" || echo "0 (clean)"
