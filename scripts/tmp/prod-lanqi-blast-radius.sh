#!/usr/bin/env bash
# 只读：量出「过期 Prisma 客户端」在生产的影响面（不改任何数据）
set -uo pipefail
T=cmt6idd1c04v62hgb86gvh7pz
U=cmt6idd1g04v72hgbue4moh86
H=(-H "x-sitong-tenant-id: ${T}" -H "x-sitong-user-id: ${U}")
B=http://127.0.0.1:3002

hit() { # method path
  local m="$1" p="$2"
  local code
  code=$(curl -s -o /tmp/_b.txt -w '%{http_code}' -X "$m" "${H[@]}" "$B$p")
  printf '%-6s %-42s -> %s  %s\n' "$m" "$p" "$code" "$(head -c 120 /tmp/_b.txt)"
}

echo "===== 兰琪路由（预期 200，实测暴露 500）"
hit GET "/lanqi/stores"
hit GET "/lanqi/dashboard?month=2026-09"
hit GET "/lanqi/goals?month=2026-09"
hit GET "/lanqi/moments/history"
hit GET "/lanqi/moments/suggestions"
hit GET "/lanqi/store-profile"
echo "===== 美业路由（其它产品，预期不受影响）"
hit GET "/beauty-industry/stores"
hit GET "/beauty-industry/moments/history"
echo "===== 平台路由（预期 200）"
hit GET "/health"
hit GET "/ready"
