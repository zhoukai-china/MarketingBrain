#!/usr/bin/env bash
# 发布前磁盘腾挪：只删「临时传输产物」与「历史构建暂存目录」。
# 回滚资产在 /opt/baolu-backups 与本脚本无关，绝不触碰。
set -euo pipefail

echo "=== before ==="
df -h / | tail -1

# 1) /tmp 传输产物（overlay 包 / 发布文件清单 / 历史 release 包），均已应用完毕
before_tmp=$(du -sm /tmp | awk '{print $1}')
find /tmp -maxdepth 1 -type f \( \
  -name 'overlay-*.tar.gz' -o \
  -name 'rel-files-*.txt' -o \
  -name 'sitong-osv2-release*.tgz' -o \
  -name 'release-2026091*.tar.gz' \) -print -delete
after_tmp=$(du -sm /tmp | awk '{print $1}')
echo "tmp freed = $(( before_tmp - after_tmp )) MB"

# 2) /opt/baolu-stage 历史构建暂存目录（deploy-release.sh 每次发布会重建，纯 scratch）
STAGE_ROOT=/opt/baolu-stage
case "$STAGE_ROOT" in /opt/baolu-stage) ;; *) echo "unexpected stage root"; exit 1 ;; esac
targets="$(find "$STAGE_ROOT" -mindepth 1 -maxdepth 1 -type d \( -name '20260910-*' -o -name 'ip-positioning-*' \) | sort)"
echo "--- to delete ---"
echo "$targets"
echo "count=$(printf '%s\n' "$targets" | grep -c .)"
while IFS= read -r d; do
  [ -n "$d" ] || continue
  rp="$(readlink -f "$d")"
  case "$rp" in "$STAGE_ROOT"/*) ;; *) echo "SKIP unsafe: $rp"; exit 1 ;; esac
  rm -rf "$rp"
done <<< "$targets"

echo "=== after ==="
df -h / | tail -1
echo "--- remaining stages ---"
ls -1 "$STAGE_ROOT"
