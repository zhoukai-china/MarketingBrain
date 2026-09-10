#!/usr/bin/env bash
# 只读排查：生产 Prisma 生成客户端是否包含 LanqiStoreGoal（不改任何数据）
set -uo pipefail

echo "----- 1) 生产部署目录内所有 .prisma/client 目录"
find /opt/baolu-os-v2 -maxdepth 6 -type d -name ".prisma" 2>/dev/null
find /opt/baolu-os-v2 -maxdepth 8 -type d -path "*/.prisma/client" 2>/dev/null | head

echo "----- 2) 在 node_modules 下搜 LanqiStoreGoal（生成客户端模型名）"
grep -rl "LanqiStoreGoal" /opt/baolu-os-v2/node_modules 2>/dev/null | head -10

echo "----- 3) 搜 LanqiMomentDraft（上一批 09-09 迁移的模型，用作对照）"
grep -rl "LanqiMomentDraft" /opt/baolu-os-v2/node_modules 2>/dev/null | head -10

echo "----- 4) systemd 启动方式与工作目录"
systemctl cat baolu-os-v2 --no-pager 2>/dev/null | grep -E "ExecStart|WorkingDirectory|Environment"

echo "----- 5) 应用实际解析到的 @baolu/db"
ls -la /opt/baolu-os-v2/apps/api/node_modules/@baolu/ 2>/dev/null
readlink -f /opt/baolu-os-v2/apps/api/node_modules/@baolu/db 2>/dev/null

echo "----- 6) 该解析路径下的 .prisma/client 是否含 LanqiStoreGoal"
DBPKG=$(readlink -f /opt/baolu-os-v2/apps/api/node_modules/@baolu/db 2>/dev/null)
echo "DBPKG=${DBPKG}"
if [ -n "$DBPKG" ]; then
  ls -la "$DBPKG/node_modules/.prisma/client" 2>/dev/null | head
  grep -c "LanqiStoreGoal" "$DBPKG/node_modules/.prisma/client/index.d.ts" 2>/dev/null || echo "(index.d.ts 无或不可读)"
  grep -c "LanqiMomentDraft" "$DBPKG/node_modules/.prisma/client/index.d.ts" 2>/dev/null || true
fi

echo "----- 7) 迁移表里两条兰琪迁移"
sudo -u postgres psql -d baolu_os_v2 -X -tA -c "select migration_name, finished_at from _prisma_migrations where migration_name like '%lanqi%' order by finished_at;"
echo "----- 8) 生产库里 LanqiStoreGoal 表是否存在"
sudo -u postgres psql -d baolu_os_v2 -X -tA -c "select to_regclass('public.\"LanqiStoreGoal\"') as t_goal, to_regclass('public.\"LanqiMomentDraft\"') as t_moment;"
