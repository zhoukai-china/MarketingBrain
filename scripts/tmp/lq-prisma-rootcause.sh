set -u
echo "=== 1) deployed schema model count ==="
SCH=/opt/baolu-os-v2/packages/db/prisma/schema.prisma
for m in LanqiMomentDraft LanqiMomentUpgrade LanqiMomentAsset LanqiStoreGoal LanqiStoreProfile; do
  printf '%-22s %s\n' "$m" "$(grep -c "model $m " $SCH)"
done
echo "schema mtime: $(stat -c '%y' $SCH)"
echo "=== 2) stage schema model count ==="
SCH2=/opt/baolu-stage/20260910-lanqi-lq18-closeout-prod1/packages/db/prisma/schema.prisma
for m in LanqiMomentDraft LanqiMomentUpgrade LanqiMomentAsset LanqiStoreGoal; do
  printf '%-22s %s\n' "$m" "$(grep -c "model $m " $SCH2)"
done
echo "=== 3) exact runtime prisma client path ==="
cd /opt/baolu-os-v2/apps/api
node -e "
const {createRequire}=require('module');
const r=createRequire('/opt/baolu-os-v2/packages/db/dist/index.js');
const c=r.resolve('@prisma/client');
console.log('client',c);
const r2=createRequire(c);
console.log('generated',r2.resolve('.prisma/client/default.js'));
" 2>&1 | tail -n 4
echo "=== 4) model delegate check on that generated client ==="
cd /opt/baolu-os-v2/apps/api
node -e "import('@baolu/db').then(m=>{const c=m.prisma;console.log('upgrade',typeof c.lanqiMomentUpgrade,'draft',typeof c.lanqiMomentDraft,'asset',typeof c.lanqiMomentAsset,'goal',typeof c.lanqiStoreGoal,'profile',typeof c.lanqiStoreProfile);})" 2>&1 | tail -n 3