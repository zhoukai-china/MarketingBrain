#!/usr/bin/env bash
# 只读排查：生产 /lanqi/dashboard 500 根因（不改任何数据）
set -uo pipefail

APP=/opt/baolu-os-v2/apps/api
echo "----- 1) 部署的 goal-store.js 引用了哪个 prisma 模型"
grep -n "prisma\.[a-zA-Z]*\." $APP/dist/apps/api/src/products/lanqi/goal-store.js | head -20

echo "----- 2) 部署的 @baolu/db 生成客户端里是否有 LanqiStoreGoal"
grep -rln "LanqiStoreGoal" /opt/baolu-os-v2/node_modules/.prisma/client/ 2>/dev/null | head -5
echo "-- packages/db 生成目录"
grep -rln "LanqiStoreGoal" /opt/baolu-os-v2/packages/db/node_modules/.prisma/client/ 2>/dev/null | head -5

echo "----- 3) 部署的 @baolu/db 包解析路径"
ls -la /opt/baolu-os-v2/node_modules/@baolu/db 2>/dev/null
readlink -f /opt/baolu-os-v2/node_modules/@baolu/db 2>/dev/null

echo "----- 4) 直接问运行中的 API：/lanqi/goals（同样走 readStoreGoal）"
curl -s -o /tmp/_g.txt -w "GET /lanqi/goals -> %{http_code}\n" \
  -H "x-sitong-tenant-id: cmt6idd1c04v62hgb86gvh7pz" -H "x-sitong-user-id: cmt6idd1g04v72hgbue4moh86" \
  "http://127.0.0.1:3002/lanqi/goals?month=2026-09"
head -c 300 /tmp/_g.txt; echo

echo "----- 5) 服务日志里 lanqi_dashboard_error 的最近堆栈"
sudo journalctl -u baolu-os-v2 --since '30 min ago' --no-pager 2>/dev/null | grep -iE "lanqi_dashboard|findUnique|LanqiStoreGoal" | tail -20

echo "----- 6) schema 与生成客户端时间戳"
ls -la --time-style=full-iso $APP/dist/apps/api/src/products/lanqi/ 2>/dev/null | head -20
stat -c '%y %n' /opt/baolu-os-v2/node_modules/.prisma/client/index.js 2>/dev/null
