#!/usr/bin/env bash
# 生产修复：baolu-os-v2 运行时 Prisma Client 过期，缺少 LanqiStoreGoal /
# LanqiMomentDraft / LanqiMomentUpgrade / LanqiMomentAsset 四个模型，
# 导致 /lanqi/dashboard、/lanqi/goals、/lanqi/moments/upgrades 全部 500。
#
# 根因：scripts/tmp/deploy-release.sh 在 $STAGE 里跑 prisma generate，但第 7 步
# overlay 只拷 apps/packages/docs/mcp-skills/scripts，node_modules 被显式排除，
# 生成结果从未进入 $APP。
#
# 用法：ssh -i <key> admin@api.lcppch.top "bash -s" < scripts/tmp/prod-lanqi-prisma-client-fix.sh
set -uo pipefail

APP=/opt/baolu-os-v2
PDIR="$APP/node_modules/.pnpm/@prisma+client@5.17.0_prisma@5.17.0/node_modules/.prisma/client"
ENVFILE=/etc/baolu-secrets/baolu-os-v2.env
SERVICE=baolu-os-v2
PORT=3002
STAMP="$(date +%Y%m%d-%H%M%S)"
BK="/opt/baolu-backups/prisma-client-fix-$STAMP"
MODELS="LanqiStoreGoal LanqiMomentDraft LanqiMomentUpgrade LanqiMomentAsset"

report() {
  echo "--- $1 ---"
  stat -c 'mtime=%y' "$PDIR/index.d.ts"
  for m in $MODELS; do printf '%-22s %s\n' "$m" "$(grep -c "$m" "$PDIR/index.d.ts" || true)"; done
}

echo "===== 0. backup runtime client ====="
sudo mkdir -p "$BK"
sudo tar czf "$BK/prisma-client-before.tar.gz" -C "$(dirname "$PDIR")" client
sudo sha256sum "$BK/prisma-client-before.tar.gz"
echo "backup=$BK/prisma-client-before.tar.gz"

echo
echo "===== 1. before ====="
report before
systemctl is-active "$SERVICE"

echo
echo "===== 2. prisma generate in place (as root, prod env) ====="
sudo bash -lc "set -a; . '$ENVFILE'; set +a; cd '$APP/packages/db' && pnpm run prisma:generate" 2>&1 | tail -25
GEN_RC="${PIPESTATUS[0]}"
echo "generate_exit=$GEN_RC"

echo
echo "===== 3. after ====="
report after

echo
echo "===== 4. restart + health ====="
sudo systemctl restart "$SERVICE"
sleep 3
systemctl is-active "$SERVICE"
ok=0
for i in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/health" || true)"
  if [ "$code" = "200" ]; then echo "health=200 after $((i*2))s"; ok=1; break; fi
  sleep 2
done
[ "$ok" = "1" ] || { echo "HEALTH_TIMEOUT"; sudo journalctl -u "$SERVICE" -n 40 --no-pager; }
curl -s -o /dev/null -w 'ready=%{http_code}\n' "http://127.0.0.1:${PORT}/ready"
systemctl show -p ActiveEnterTimestamp "$SERVICE"
echo "BACKUP_DIR=$BK"
