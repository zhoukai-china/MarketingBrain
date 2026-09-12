#!/usr/bin/env bash
# 思潼 AI 增长 OS：PROD(chat) 发布 20260910-credits-yuan-free-redo-prod1
# 策略：stage 解包 -> 复用 PROD node_modules -> 服务器侧构建 -> 备份 -> 目录叠加(不删任何历史文件) -> 重启 -> 校验 -> 失败自动回滚
set -euo pipefail

REL="20260910-credits-yuan-free-redo-prod1"
ARCHIVE="/tmp/release-${REL}.tar.gz"
APP="/opt/baolu-os-v2"
STAGE="/opt/baolu-stage/${REL}"
BACKUP="/opt/baolu-backups/${REL}-before"
OVERLAY="/tmp/overlay-${REL}.tar.gz"
LOG="/tmp/deploy-${REL}.log"

case "$STAGE" in /opt/baolu-stage/*) ;; *) echo "unexpected STAGE=$STAGE"; exit 1 ;; esac
case "$BACKUP" in /opt/baolu-backups/*) ;; *) echo "unexpected BACKUP=$BACKUP"; exit 1 ;; esac

exec > >(tee -a "$LOG") 2>&1
step() { echo; echo "===== $* ====="; }

step "0. preflight"
test -f "$ARCHIVE"
sudo mkdir -p "$BACKUP" "$STAGE"
sudo chown admin:admin "$BACKUP" "$STAGE"
echo "archive sha256: $(sha256sum "$ARCHIVE" | awk '{print $1}')"

step "1. extract stage"
sudo rm -rf "$STAGE"
sudo mkdir -p "$STAGE"
sudo tar -xzf "$ARCHIVE" -C "$STAGE"
sudo chown -R admin:admin "$STAGE"
echo "stage files: $(find "$STAGE" -type f | wc -l)"

step "2. reuse PROD node_modules (no install, no network)"
for d in node_modules apps/api/node_modules apps/web/node_modules \
         packages/agent/node_modules packages/dashboard/node_modules packages/db/node_modules \
         packages/shared/node_modules packages/skills/node_modules; do
  if [ -d "$APP/$d" ]; then
    sudo mkdir -p "$STAGE/$d"
    sudo cp -a "$APP/$d/." "$STAGE/$d/"
  else
    echo "WARN: missing $APP/$d"
  fi
done
sudo chown -R admin:admin "$STAGE"
echo "node_modules reused ok"

step "3. build in stage"
set -a
# shellcheck disable=SC1091
. /etc/baolu-secrets/baolu-os-v2.env
set +a
cd "$STAGE"
echo "VITE_BASE_PATH=$VITE_BASE_PATH"
pnpm --filter @baolu/db run prisma:generate
VITE_BASE_PATH=/os-v2/ pnpm -r build

step "4. verify build artifacts"
test -f "$STAGE/apps/api/dist/apps/api/src/server.js"
test -f "$STAGE/apps/web/dist/index.html"
grep -q '/os-v2/assets/' "$STAGE/apps/web/dist/index.html"
SRC_HASH="$(sha256sum "$STAGE/apps/api/src/data/marketplace-v3.json" | awk '{print $1}')"
DIST_HASH="$(sha256sum "$STAGE/apps/api/dist/apps/api/src/data/marketplace-v3.json" | awk '{print $1}')"
echo "src=$SRC_HASH"
echo "dist=$DIST_HASH"
test "$SRC_HASH" = "$DIST_HASH"
test "$SRC_HASH" = "a668b6429315914e14e7d72601967e8f93a2006ecb9297dd59f283f0ba467416"
echo "build artifacts OK"

step "5. backup"
sudo cp -a /etc/baolu-secrets/baolu-os-v2.env "$BACKUP/baolu-os-v2.env"
sudo cp -a /etc/systemd/system/baolu-os-v2.service "$BACKUP/baolu-os-v2.service" || true
( cd "$APP" && sudo find apps packages -path '*/dist/*' -type f | sort | xargs -r sha256sum ) > "$BACKUP/dist-hashes-before.txt"
sudo tar czf "$BACKUP/app-before.tar.gz" -C "$APP" \
  --exclude=./node_modules --exclude=./node_modules.broken-f-links-20260804 \
  --exclude=./uploads --exclude=./.skill-release-backups --exclude=./.skill-release-staging .
( cd /tmp && sudo -u postgres pg_dump -Fp baolu_os_v2 ) | gzip -c > "$BACKUP/db-before.sql.gz"
echo "backup size: $(du -sh "$BACKUP" | awk '{print $1}')"

step "6. record new files (for exact rollback)"
tar -tzf "$ARCHIVE" | sed 's#^\./##' | grep -v '/$' > /tmp/rel-files-${REL}.txt
: > "$BACKUP/new-files.txt"
while IFS= read -r f; do
  [ -e "$APP/$f" ] || printf '%s\n' "$f" >> "$BACKUP/new-files.txt"
done < /tmp/rel-files-${REL}.txt
echo "new files that did not exist before: $(wc -l < "$BACKUP/new-files.txt")"

step "7. overlay (additive, nothing deleted)"
sudo tar czf "$OVERLAY" -C "$STAGE" --exclude=./node_modules .
tar xzf "$OVERLAY" -C "$APP"
echo "overlay applied"

step "8. restart service"
sudo systemctl restart baolu-os-v2
sleep 6
systemctl is-active baolu-os-v2
curl -fsS -o /dev/null -w 'health=%{http_code}\n' http://127.0.0.1:3002/health
curl -fsS -o /dev/null -w 'ready=%{http_code}\n' http://127.0.0.1:3002/ready

echo
echo "DEPLOY_OK ${REL}"
