#!/usr/bin/env bash
# 思潼 AI 增长 OS：全量源码叠加发布（stage 构建 -> 备份 -> 叠加 -> 迁移 -> 重启 -> 校验 -> 失败回滚）
#
# 用法: deploy-release.sh <release-id> <archive> <app-dir> <service> <env-file> <port> <vite-base>
# 例:   deploy-release.sh 20260910-credits-yuan-free-redo-prod1 /tmp/release-....tar.gz \
#         /opt/baolu-os-v2 baolu-os-v2 /etc/baolu-secrets/baolu-os-v2.env 3002 /os-v2/
#
# 策略说明：PROD/TEST 的历史源码都是 dist 的子集，且没有任何服务器独有源文件，
# 因此“只叠加、不删除”即可让源码树等于本地工作树；历史脚本/目录/node_modules 全部保留。
set -euo pipefail

REL="${1:?release id}"
ARCHIVE="${2:?archive path}"
APP="${3:?app dir}"
SERVICE="${4:?service name}"
ENV_FILE="${5:?env file}"
PORT="${6:?port}"
VITE_BASE="${7:?vite base path}"

STAGE="/opt/baolu-stage/${REL}"
# 允许用 BACKUP_TAG 指定备份前缀，重跑时保留上一轮备份不被覆盖
BACKUP_TAG="${BACKUP_TAG:-$REL}"
BACKUP="/opt/baolu-backups/${BACKUP_TAG}-before-$(basename "$APP")"
LOG="/tmp/deploy-${REL}-$(basename "$APP").log"
OVERLAY="/tmp/overlay-${REL}-$(basename "$APP").tar.gz"
SUCCEEDED=false

case "$STAGE" in /opt/baolu-stage/*) ;; *) echo "unexpected STAGE=$STAGE"; exit 1 ;; esac
case "$BACKUP" in /opt/baolu-backups/*) ;; *) echo "unexpected BACKUP=$BACKUP"; exit 1 ;; esac
case "$APP" in /opt/baolu-*) ;; *) echo "unexpected APP=$APP"; exit 1 ;; esac
test "$(readlink -f "$APP")" = "$APP"

restore_on_failure() {
  local status=$?
  if [ "$SUCCEEDED" = true ]; then return; fi
  if [ ! -f "$BACKUP/app-before.tar.gz" ]; then
    echo "!!! failed before any change to $APP (exit=$status); service untouched, no rollback needed" >&2
    return
  fi
  echo "!!! deployment failed (exit=$status); rolling back $APP" >&2
  sudo systemctl stop "$SERVICE" || true
  sudo tar xzf "$BACKUP/app-before.tar.gz" -C "$APP" || true
  if [ -s "$BACKUP/new-files.txt" ]; then
    while IFS= read -r f; do
      case "$APP/$f" in "$APP"/*) sudo rm -f "$APP/$f" ;; *) echo "skip $f" ;; esac
    done < "$BACKUP/new-files.txt"
  fi
  sudo systemctl start "$SERVICE" || true
  systemctl is-active "$SERVICE" || true
  wait_http_ok "http://127.0.0.1:${PORT}/health" rollback_health 40 3 || true
  echo "ROLLBACK_DONE ${REL}"
}
trap restore_on_failure EXIT

exec > >(tee -a "$LOG") 2>&1
step() { echo; echo "===== $* ====="; }

# 轮询等待服务就绪：PROD 冷启动（pnpm -> node）约需 12s，固定 6s 窗口会误判失败并触发不必要的回滚
wait_http_ok() {
  local url="$1" label="$2" attempts="${3:-40}" interval="${4:-3}"
  local code="" i
  for i in $(seq 1 "$attempts"); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)"
    if [ "$code" = "200" ]; then
      echo "${label}=200 (after $(( (i - 1) * interval ))s)"
      return 0
    fi
    sleep "$interval"
  done
  echo "${label}=${code:-000} TIMEOUT after $(( attempts * interval ))s" >&2
  return 1
}

step "0. preflight"
test -f "$ARCHIVE"
test -f "$ENV_FILE"
test "$(systemctl is-active "$SERVICE")" = "active"
echo "archive sha256: $(sha256sum "$ARCHIVE" | awk '{print $1}')"
sudo install -d -m 755 -o admin -g admin /opt/baolu-stage "$STAGE"
sudo install -d -m 755 -o admin -g admin "$BACKUP"

step "1. extract stage"
sudo rm -rf "$STAGE"
sudo mkdir -p "$STAGE"
sudo tar -xzf "$ARCHIVE" -C "$STAGE"
sudo chown -R admin:admin "$STAGE"
echo "stage files: $(find "$STAGE" -type f | wc -l)"

step "2. reuse target node_modules (no install, no network)"
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
echo "node_modules reused"

step "3. build in stage"
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
cd "$STAGE"
echo "VITE_BASE_PATH(from env)=$VITE_BASE_PATH / using=$VITE_BASE"
pnpm --filter @baolu/db run prisma:generate
VITE_BASE_PATH="$VITE_BASE" pnpm -r build

step "4. verify build artifacts"
test -f "$STAGE/apps/api/dist/apps/api/src/server.js"
test -f "$STAGE/apps/web/dist/index.html"
grep -q "${VITE_BASE}assets/" "$STAGE/apps/web/dist/index.html"
SRC_HASH="$(sha256sum "$STAGE/apps/api/src/data/marketplace-v3.json" | awk '{print $1}')"
DIST_HASH="$(sha256sum "$STAGE/apps/api/dist/apps/api/src/data/marketplace-v3.json" | awk '{print $1}')"
echo "marketplace src=$SRC_HASH dist=$DIST_HASH"
test "$SRC_HASH" = "$DIST_HASH"
test "$SRC_HASH" = "2eec39bd3ea2b9821d8ad8113c63123c580e0f72f0063fe06890feb9553752e4"
grep -rq '≈ ¥' "$STAGE/apps/web/dist/assets"
echo "build artifacts OK"

step "5. backup"
sudo cp -a "$ENV_FILE" "$BACKUP/$(basename "$ENV_FILE")"
sudo systemctl cat "$SERVICE" > "$BACKUP/${SERVICE}.service.txt"
( cd "$APP" && sudo find apps packages -path '*/dist/*' -type f | sort | xargs -r sha256sum ) > "$BACKUP/dist-hashes-before.txt"
sudo tar czf "$BACKUP/app-before.tar.gz" -C "$APP" \
  --exclude=./node_modules --exclude=./node_modules.broken-f-links-20260804 \
  --exclude=./uploads --exclude=./.skill-release-backups --exclude=./.skill-release-staging .
DB_NAME="$(printf '%s' "${DATABASE_URL##*/}" | cut -d'?' -f1)"
( cd /tmp && sudo -u postgres pg_dump -Fp "$DB_NAME" ) | gzip -c > "$BACKUP/db-before.sql.gz"
echo "backup: $(du -sh "$BACKUP" | awk '{print $1}') db=$DB_NAME"

step "6. record files new to this target"
tar -tzf "$ARCHIVE" | sed 's#^\./##' | grep -v '/$' > "/tmp/rel-files-${REL}.txt"
: > "$BACKUP/new-files.txt"
while IFS= read -r f; do
  [ -e "$APP/$f" ] || printf '%s\n' "$f" >> "$BACKUP/new-files.txt"
done < "/tmp/rel-files-${REL}.txt"
echo "new files: $(wc -l < "$BACKUP/new-files.txt")"

step "7. overlay (additive; nothing deleted)"
sudo tar czf "$OVERLAY" -C "$STAGE" --exclude=./node_modules .
# 目标目录里存在历史遗留的 root:root 文件（早期 sudo 部署所致），
# 普通用户解包会因 unlink 失败报 "Cannot open: File exists"，必须用 sudo 且不保留归档属主。
sudo tar --no-same-owner -xzf "$OVERLAY" -C "$APP"
for d in apps packages docs mcp-skills scripts; do
  [ -e "$APP/$d" ] && sudo chown -R admin:admin "$APP/$d"
done
while IFS= read -r f; do
  case "$f" in */*) ;; *) [ -e "$APP/$f" ] && sudo chown admin:admin "$APP/$f" ;; esac
done < "/tmp/rel-files-${REL}.txt"
echo "overlay applied"

step "8. prisma migrate deploy"
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
cd "$APP"
pnpm --filter @baolu/db run prisma:deploy

step "9. restart + health"
sudo systemctl restart "$SERVICE"
systemctl is-active "$SERVICE"
if ! wait_http_ok "http://127.0.0.1:${PORT}/health" health 40 3; then
  echo "--- journalctl tail ---" >&2
  sudo journalctl -u "$SERVICE" -n 60 --no-pager >&2 || true
  false
fi
wait_http_ok "http://127.0.0.1:${PORT}/ready" ready 20 3

SUCCEEDED=true
echo
echo "DEPLOY_OK ${REL} app=${APP}"
