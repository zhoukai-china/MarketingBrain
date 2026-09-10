#!/usr/bin/env bash
# 2026-09-10 平台增量发布 -> chat-test 联调实例
# 目标实例：/opt/baolu-os-v2-test（service baolu-os-v2-test，端口 3010，nginx /lanqi-test/）
# 发布内容：积分→人民币折算、货架「不满意免费重做一次」、以及同一工作树当前状态的兰琪/美业增量。
# 用法：deploy-credits-yuan-free-redo-test.sh <archive> <sha256> <release-id>
set -euo pipefail

ARCHIVE="${1:?Pass deployment archive path as argument 1}"
ARCHIVE_SHA256="${2:?Pass archive SHA-256 as argument 2}"
RELEASE_ID="${3:?Pass a release id as argument 3}"

APP_DIR="/opt/baolu-os-v2-test"
SERVICE_NAME="baolu-os-v2-test"
ENV_FILE="/etc/baolu-secrets/baolu-os-v2-test.env"
PORT=3010
STAGE_DIR="/opt/baolu-stage/${RELEASE_ID}"
BACKUP_DIR="/opt/baolu-backups/${RELEASE_ID}-before"
SUCCEEDED=false

test "$(readlink -f "$APP_DIR")" = "$APP_DIR"
test "$(systemctl is-active "$SERVICE_NAME")" = "active"
test -f "$ENV_FILE" && test -f "$ARCHIVE"
test ! -e "$STAGE_DIR" && test ! -e "$BACKUP_DIR"
echo "$ARCHIVE_SHA256  $ARCHIVE" | sha256sum -c -

sudo install -d -m 755 -o admin -g admin /opt/baolu-stage "$STAGE_DIR"
sudo install -d -m 750 -o admin -g admin "$BACKUP_DIR"
sudo cp -a "$ENV_FILE" "$BACKUP_DIR/baolu-os-v2-test.env.before"
sudo systemctl cat "$SERVICE_NAME" > "$BACKUP_DIR/baolu-os-v2-test.service.before.txt"
tar -tzf "$ARCHIVE" > "$BACKUP_DIR/release-filelist.txt"

: > "$BACKUP_DIR/present-filelist.txt"
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  if [ -f "$APP_DIR/$rel" ]; then printf '%s\n' "$rel" >> "$BACKUP_DIR/present-filelist.txt"; fi
done < "$BACKUP_DIR/release-filelist.txt"
if [ -s "$BACKUP_DIR/present-filelist.txt" ]; then
  sudo tar -czf "$BACKUP_DIR/source-before.tgz" -C "$APP_DIR" -T "$BACKUP_DIR/present-filelist.txt"
fi
printf '%s\n' apps/api/dist apps/web/dist packages/shared/dist packages/agent/dist packages/skills/dist packages/db/dist \
  > "$BACKUP_DIR/dist-dirs.txt"
: > "$BACKUP_DIR/dist-present.txt"
while IFS= read -r rel; do
  [ -d "$APP_DIR/$rel" ] && printf '%s\n' "$rel" >> "$BACKUP_DIR/dist-present.txt"
done < "$BACKUP_DIR/dist-dirs.txt"
if [ -s "$BACKUP_DIR/dist-present.txt" ]; then
  sudo tar -czf "$BACKUP_DIR/dist-before.tgz" -C "$APP_DIR" -T "$BACKUP_DIR/dist-present.txt"
fi

restore_on_failure() {
  local status=$?
  if [ "$SUCCEEDED" = true ]; then return; fi
  echo "TEST deployment failed; restoring previous sources, dist and service." >&2
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    sudo rm -rf "${APP_DIR:?}/$rel"
  done < "$BACKUP_DIR/dist-present.txt"
  sudo tar -xzf "$BACKUP_DIR/dist-before.tgz" -C "$APP_DIR" || true
  if [ -f "$BACKUP_DIR/source-before.tgz" ]; then
    sudo tar -xzf "$BACKUP_DIR/source-before.tgz" -C "$APP_DIR" || true
  fi
  sudo systemctl restart "$SERVICE_NAME" || true
  exit "$status"
}
trap restore_on_failure EXIT

tar -xzf "$ARCHIVE" -C "$STAGE_DIR"
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  test -f "$STAGE_DIR/$rel"
done < "$BACKUP_DIR/release-filelist.txt"

while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  sudo install -d -m 755 "$(dirname "$APP_DIR/$rel")"
  sudo install -m 644 "$STAGE_DIR/$rel" "$APP_DIR/$rel"
done < "$BACKUP_DIR/release-filelist.txt"

cd "$APP_DIR"
set -a
. "$ENV_FILE"
set +a
pnpm --filter @baolu/db run prisma:generate
pnpm -r build
pnpm --filter @baolu/db run prisma:deploy

sudo systemctl restart "$SERVICE_NAME"
for attempt in $(seq 1 45); do
  if curl -fsS --max-time 3 "http://127.0.0.1:${PORT}/health" >/dev/null \
    && curl -fsS --max-time 3 "http://127.0.0.1:${PORT}/ready" >/dev/null; then
    break
  fi
  test "$attempt" -lt 45
  sleep 2
done

grep -q "freeRedoOf" "$APP_DIR/apps/api/dist/apps/api/src/routes/marketplace.js"
grep -q "marketplace_redo_exhausted" "$APP_DIR/apps/api/dist/apps/api/src/routes/marketplace.js"
grep -rq "≈ ¥" "$APP_DIR/apps/web/dist/assets"
grep -q "/lanqi-test/assets/" "$APP_DIR/apps/web/dist/index.html"
test -f "$APP_DIR/apps/web/dist/index.html"

# 运行时数据必须进 dist：marketplace-catalog.ts 用 readFileSync 读 src/data/*.json，
# 而 tsc 不复制 JSON；漏了这一步线上会一直吃 dist 里的旧货架数据（专区/内核状态改了但线上不变）。
# 回归：docs/BUG_REGRESSIONS.md QA-20260910-013。
RUNTIME_DATA_SRC="$(sha256sum "$APP_DIR/apps/api/src/data/marketplace-v3.json" | cut -d' ' -f1)"
RUNTIME_DATA_DIST="$(sha256sum "$APP_DIR/apps/api/dist/apps/api/src/data/marketplace-v3.json" | cut -d' ' -f1)"
test "$RUNTIME_DATA_SRC" = "$RUNTIME_DATA_DIST"

# 货架接口必须给出本次发布的目录：兰琪专区内核 + 未完成内核的 coming_soon 状态。
curl -fsS --max-time 10 "http://127.0.0.1:${PORT}/market/skus" > "$BACKUP_DIR/skus-after.json"
grep -q 'lanqi__lanqi-brain' "$BACKUP_DIR/skus-after.json"
test "$(grep -o 'coming_soon' "$BACKUP_DIR/skus-after.json" | wc -l)" -ge 7

while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  sha256sum "$APP_DIR/$rel"
done < "$BACKUP_DIR/release-filelist.txt" > "$BACKUP_DIR/SHA256SUMS-after"
date -Iseconds > "$BACKUP_DIR/DEPLOYMENT-SWITCH-SUCCEEDED"
SUCCEEDED=true
trap - EXIT
systemctl show "$SERVICE_NAME" -p ActiveState -p SubState -p MainPID
echo "chat-test deployment completed: $RELEASE_ID"
