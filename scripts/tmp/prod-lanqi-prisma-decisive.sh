#!/usr/bin/env bash
# 只读排查：生产 Prisma 客户端到底有哪些模型（不改任何数据）
set -uo pipefail
PC=/opt/baolu-os-v2/node_modules/.pnpm/@prisma+client@5.17.0_prisma@5.17.0/node_modules/.prisma/client
echo "----- 1) 生成客户端目录内容"
ls -la --time-style=full-iso "$PC" 2>/dev/null | head -20
echo "----- 2) index.d.ts / index.js 中的模型计数"
for f in index.d.ts index.js default.js; do
  if [ -f "$PC/$f" ]; then
    printf '%-14s Store=%s Membership=%s LanqiMomentDraft=%s LanqiStoreGoal=%s LanqiStoreProfile=%s\n' "$f" \
      "$(grep -c 'Store' "$PC/$f")" "$(grep -c 'Membership' "$PC/$f")" \
      "$(grep -c 'LanqiMomentDraft' "$PC/$f" 2>/dev/null || echo 0)" \
      "$(grep -c 'LanqiStoreGoal' "$PC/$f" 2>/dev/null || echo 0)" \
      "$(grep -c 'LanqiStoreProfile' "$PC/$f" 2>/dev/null || echo 0)"
  else
    echo "$f: (缺失)"
  fi
done
echo "----- 3) schema.prisma 里是否有这两个模型"
grep -c "model LanqiStoreGoal" /opt/baolu-os-v2/packages/db/prisma/schema.prisma 2>/dev/null
grep -c "model LanqiMomentDraft" /opt/baolu-os-v2/packages/db/prisma/schema.prisma 2>/dev/null
echo "----- 4) @baolu/db 是如何导出 prisma 的"
cat /opt/baolu-os-v2/packages/db/package.json 2>/dev/null
echo "-- src/db.ts 头部"
head -30 /opt/baolu-os-v2/packages/db/src/index.ts 2>/dev/null
echo "----- 5) 运行时实际模型键（node 直连生产 cwd）"
cd /opt/baolu-os-v2 && sudo -u admin node --input-type=module -e "
import { prisma } from '@baolu/db';
const keys = Object.keys(prisma).filter(k => !k.startsWith('_') && !k.startsWith('\$'));
console.log('has store:', typeof prisma.store);
console.log('has membership:', typeof prisma.membership);
console.log('has lanqiStoreGoal:', typeof prisma.lanqiStoreGoal);
console.log('has lanqiMomentDraft:', typeof prisma.lanqiMomentDraft);
console.log('modelCount:', keys.length);
" 2>&1 | tail -20
