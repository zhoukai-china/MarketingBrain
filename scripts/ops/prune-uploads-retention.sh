#!/usr/bin/env bash
# 客户上传保留策略：满 RETAIN_DAYS 天自动清理（默认 180 天，幂等，可重复执行）。
#
# 用户口径（2026-09-15）：客户上传是这台服务器上**唯一会长期变大**的东西，
# 采用「满 180 天自动清理」——省空间、对合规也更友好。比它更短命的视频暂存
# 继续由 scripts/bs-video-retention.sh（24 小时）负责，本脚本不重复管。
#
# 覆盖目录（写死白名单）：
#   /opt/baolu-os-v2/uploads        生产
#   /opt/baolu-os-v2-test/uploads   内测
#
# 不碰什么：
#   · 数据库、/opt/baolu-backups（回滚资产）、发布暂存（见 scripts/ops/prune-stage.sh）；
#   · 隐藏目录（`.beauty-video-results`、`.video-inspection`、`.qa` 等平台自管目录）；
#   · `lanqi-media/staging`（24 小时策略管理）；
#   · 各上传根目录**第一层**的文件（如 `.demo-knowledge-base.json`），客户上传都在子目录里；
#   · 软链（不跟随、不删除），其它文件系统（-xdev 不进入）。
#
# 日志口径：默认只输出「数量 + 字节数 + 各一级目录分布」，不把客户文件名写进日志；
#   需要人工排查看清单时用 `--list`（只打印到屏幕，不落日志）。
#
# 用法：
#   bash /opt/baolu-ops/prune-uploads-retention.sh             # 预览（dry-run）
#   bash /opt/baolu-ops/prune-uploads-retention.sh --list      # 预览并列文件名
#   bash /opt/baolu-ops/prune-uploads-retention.sh --apply     # 执行删除
#   RETAIN_DAYS=90 bash /opt/baolu-ops/prune-uploads-retention.sh --list
set -uo pipefail

RETAIN_DAYS="${RETAIN_DAYS:-180}"
MODE="${1:-}"
LOG_DIR="${LOG_DIR:-/var/log/baolu-uploads-retention}"

case "$MODE" in
  "" | --apply | --list) ;;
  *) echo "unknown argument: $MODE" >&2; exit 2 ;;
esac
case "$RETAIN_DAYS" in
  "" | *[!0-9]*) echo "RETAIN_DAYS must be a positive integer" >&2; exit 2 ;;
esac
test "$RETAIN_DAYS" -ge 1 || { echo "RETAIN_DAYS must be >= 1" >&2; exit 2; }
if [ "$RETAIN_DAYS" -lt 7 ]; then
  echo "WARN: RETAIN_DAYS=$RETAIN_DAYS 小于 7 天，客户刚上传的文件就可能被删，确认无误再继续。" >&2
fi

ALLOWED_ROOTS=(
  "/opt/baolu-os-v2/uploads"
  "/opt/baolu-os-v2-test/uploads"
)

echo "policy: RETAIN_DAYS=$RETAIN_DAYS  MODE=${MODE:-<dry-run>}"
echo "== before =="
df -h / | tail -n 1

total_files=0
total_bytes=0
total_dirs_removed=0
report=""

for root in "${ALLOWED_ROOTS[@]}"; do
  if [ ! -d "$root" ]; then
    echo "-- $root: 不存在，跳过"
    continue
  fi
  resolved_root="$(readlink -f -- "$root")"
  allowed=0
  for a in "${ALLOWED_ROOTS[@]}"; do
    if [ "$resolved_root" = "$(readlink -f -- "$a")" ]; then allowed=1; fi
  done
  if [ "$allowed" != "1" ]; then
    echo "-- $root: 解析到白名单之外（$resolved_root），拒绝处理" >&2
    continue
  fi

  echo "-- $root"
  root_files=0
  root_bytes=0
  top_summary=""

  while IFS= read -r -d '' file; do
    size="$(stat -c %s -- "$file" 2>/dev/null || echo 0)"
    rel="${file#"$resolved_root"/}"
    # 平台自管文件在根目录第一层（如 .demo-knowledge-base.json），不参与客户上传清理。
    case "$rel" in
      */*) ;;
      *) continue ;;
    esac
    top="${rel%%/*}"
    if [ "$MODE" = "--list" ]; then
      echo "   DELETE ${size}B  $rel"
    fi
    root_files=$((root_files + 1))
    root_bytes=$((root_bytes + size))
    top_summary="${top_summary}${top}"$'\n'
    if [ "$MODE" = "--apply" ]; then
      rm -f -- "$file"
    fi
  done < <(find "$resolved_root" -xdev \
      \( -type d \( -name '.*' -o -path "$resolved_root/lanqi-media/staging" \) -prune \) -o \
      \( -type f -mtime "+${RETAIN_DAYS}" -print0 \) 2>/dev/null)

  empty_dirs=0
  if [ "$root_files" -gt 0 ] && [ "$MODE" = "--apply" ]; then
    # -delete 隐含深度优先，两轮足以收掉嵌套空目录（客户目录 → 租户目录 → 分类目录）。
    round=1
    while [ "$round" -le 2 ]; do
      while IFS= read -r -d '' d; do
        if rmdir -- "$d" 2>/dev/null; then empty_dirs=$((empty_dirs + 1)); fi
      done < <(find "$resolved_root" -xdev -mindepth 1 -type d -empty -print0 2>/dev/null)
      round=$((round + 1))
    done
  fi

  echo "   files=$root_files bytes=$root_bytes empty_dirs_removed=$empty_dirs"
  if [ "$root_files" -gt 0 ]; then
    echo "   by_top_dir:"
    printf '%s' "$top_summary" | sort | uniq -c | sort -rn | sed 's/^/     /'
  fi

  total_files=$((total_files + root_files))
  total_bytes=$((total_bytes + root_bytes))
  total_dirs_removed=$((total_dirs_removed + empty_dirs))
  report="${report}${resolved_root}\tfiles=${root_files}\tbytes=${root_bytes}\tempty_dirs_removed=${empty_dirs}"$'\n'
done

echo
if [ "$total_files" -eq 0 ]; then
  echo "nothing to prune（没有超过 ${RETAIN_DAYS} 天的上传文件）"
else
  echo "TOTAL files=$total_files bytes=$total_bytes empty_dirs_removed=$total_dirs_removed"
fi

if [ "$MODE" != "--apply" ]; then
  echo "DRY-RUN：未删除任何文件。确认后加 --apply 执行。"
  echo "== after =="
  df -h / | tail -n 1
  exit 0
fi

if mkdir -p "$LOG_DIR" 2>/dev/null; then
  log_file="$LOG_DIR/$(date +%Y%m%d-%H%M%S).log"
  {
    echo "# 客户上传保留策略执行记录（不含客户文件名）"
    echo "time=$(date -Is)  RETAIN_DAYS=$RETAIN_DAYS"
    printf '%b' "$report"
    echo "TOTAL files=$total_files bytes=$total_bytes empty_dirs_removed=$total_dirs_removed"
  } > "$log_file" 2>/dev/null && chmod 600 "$log_file" 2>/dev/null
  echo "log_dir=$LOG_DIR"
else
  echo "WARN: 无法写入 $LOG_DIR，仅输出到 journal" >&2
fi

echo "== after =="
df -h / | tail -n 1
