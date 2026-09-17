#!/usr/bin/env bash
# 在服务器上安装「存储保留策略」定时任务（幂等，可重复执行；需要 root）。
#
# 安装内容：
#   /opt/baolu-ops/prune-stage.sh                 发布暂存超 24h 回收    （每小时 :17）
#   /opt/baolu-ops/prune-uploads-retention.sh     客户上传满 180 天清理   （每天 03:40）
#   /opt/baolu-ops/purge-legacy-artifacts.sh      一次性过期垃圾清理      （手动跑，不挂定时）
#   /opt/baolu-ops/disk-alert.sh                  磁盘水位告警            （每小时；夜间 23:00-07:00 只推紧急级）
#   /etc/systemd/system/baolu-stage-prune.timer
#   /etc/systemd/system/baolu-uploads-retention.timer
#   /etc/systemd/system/baolu-disk-alert.timer
#
# 用法（在服务器上，从有这个仓库文件的位置跑）：
#   bash scripts/ops/install-storage-retention.sh                    # 默认 SRC_DIR=脚本所在仓库根
#   SRC_DIR=/tmp/rel bash scripts/ops/install-storage-retention.sh   # 从解包目录安装
#   DRY_RUN=1 bash scripts/ops/install-storage-retention.sh          # 只校验文件与打印计划，不改系统
set -euo pipefail

OPS_DIR="${OPS_DIR:-/opt/baolu-ops}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
DRY_RUN="${DRY_RUN:-0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="${SRC_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"

require_root() {
  if [ "$DRY_RUN" = "1" ]; then return 0; fi
  if [ "$(id -u)" != "0" ]; then
    echo "请用 root 运行（sudo bash $0）" >&2
    exit 1
  fi
}

SCRIPTS=(
  "prune-stage.sh"
  "prune-uploads-retention.sh"
  "purge-legacy-artifacts.sh"
  "disk-alert.sh"
)
UNITS=(
  "baolu-stage-prune.service"
  "baolu-stage-prune.timer"
  "baolu-uploads-retention.service"
  "baolu-uploads-retention.timer"
  "baolu-disk-alert.service"
  "baolu-disk-alert.timer"
)

require_root

echo "SRC_DIR=$SRC_DIR  OPS_DIR=$OPS_DIR  SYSTEMD_DIR=$SYSTEMD_DIR  DRY_RUN=$DRY_RUN"

missing=0
for f in "${SCRIPTS[@]}"; do
  [ -f "$SRC_DIR/scripts/ops/$f" ] || { echo "missing $SRC_DIR/scripts/ops/$f" >&2; missing=1; }
done
for f in "${UNITS[@]}"; do
  [ -f "$SRC_DIR/scripts/ops/systemd/$f" ] || { echo "missing $SRC_DIR/scripts/ops/systemd/$f" >&2; missing=1; }
done
[ "$missing" = "0" ] || { echo "源文件不完整，未做任何改动" >&2; exit 1; }

if [ "$DRY_RUN" = "1" ]; then
  echo "DRY_RUN=1：将把上述 ${#SCRIPTS[@]} 个脚本装到 $OPS_DIR，${#UNITS[@]} 个 unit 装到 $SYSTEMD_DIR，并 enable --now 三个 timer。"
  exit 0
fi

echo "== 1. 安装运维脚本到 $OPS_DIR =="
install -d -m 755 -o root -g root "$OPS_DIR"
for f in "${SCRIPTS[@]}"; do
  install -m 755 -o root -g root "$SRC_DIR/scripts/ops/$f" "$OPS_DIR/$f"
  # 仓库在 Windows 上签出时可能带 CRLF，带 \r 的 shell 脚本在 Linux 上会直接报错；
  # 装到 /opt/baolu-ops 后统一去掉行尾 \r（幂等，下面的 bash -n 会兜底）。
  sed -i 's/\r$//' "$OPS_DIR/$f"
  echo "   installed $OPS_DIR/$f"
done

echo "== 2. 安装 systemd unit =="
for f in "${UNITS[@]}"; do
  install -m 644 -o root -g root "$SRC_DIR/scripts/ops/systemd/$f" "$SYSTEMD_DIR/$f"
  echo "   installed $SYSTEMD_DIR/$f"
done
systemctl daemon-reload

echo "== 3. 语法自检（bash -n）=="
for f in "${SCRIPTS[@]}"; do
  bash -n "$OPS_DIR/$f" && echo "   syntax OK: $f"
done

echo "== 4. 先 dry-run 看清将删什么 =="
bash "$OPS_DIR/prune-stage.sh"
bash "$OPS_DIR/prune-uploads-retention.sh"
bash "$OPS_DIR/purge-legacy-artifacts.sh"

echo "== 5. 启用定时任务 =="
systemctl enable --now baolu-stage-prune.timer baolu-uploads-retention.timer baolu-disk-alert.timer

echo "== 6. 立即各跑一次（真删）=="
systemctl start baolu-stage-prune.service
systemctl start baolu-uploads-retention.service
systemctl --no-pager --full status baolu-stage-prune.service | head -n 12 || true
systemctl --no-pager --full status baolu-uploads-retention.service | head -n 12 || true

echo "== 7. 定时任务清单 =="
systemctl list-timers --all --no-pager 'baolu-*' | head -n 12 || true

echo "== 8. 磁盘 =="
df -h / | tail -n 2 || true

echo
echo "INSTALL_OK"
echo "下一步（需要时手动跑）：bash $OPS_DIR/purge-legacy-artifacts.sh --apply"
