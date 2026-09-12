#!/usr/bin/env bash
# /opt/baolu-backups 保留策略（可重复执行 / 幂等）。
#
# 保留策略（定稿 2026-09-11）：
#   1) 按分组各自保留「最新 KEEP_NEWEST 个」发布前快照：
#        prod   = *-before-baolu-os-v2        （生产 /opt/baolu-os-v2）
#        test   = *-before-baolu-os-v2-test   （内测 /opt/baolu-os-v2-test）
#        gc     = web-dist-assets-gc-*        （构建垃圾回收隔离区，只留最新 1 个）
#        legacy = 其余历史命名
#   2) 任何修改时间早于 MAX_AGE_DAYS 天的快照无条件删除（覆盖旧命名的大包）。
#   3) 只删 $BACKUP_ROOT 的一级子目录；删除前用 readlink -f 校验路径仍在备份根内。
#
# 2026-09-12 追加：scripts/gc-web-dist-assets.sh 会把「未被任何页面引用的历史
# 构建产物」移到 web-dist-assets-gc-* 隔离区。它们只是机械删除的安全垫，
# 验证过站点正常后就不需要长期保留，故单独成组只留最新 1 个（KEEP_NEWEST_GC）。
#
# 这些目录是每次发布前的「回滚快照」，删除后不可恢复。务必先看 DRY_RUN 输出。
#
# 用法：
#   DRY_RUN=1 bash scripts/prune-baolu-backups.sh   # 预览，不删任何文件
#   bash scripts/prune-baolu-backups.sh             # 执行清理
#   KEEP_NEWEST=6 MAX_AGE_DAYS=30 bash scripts/prune-baolu-backups.sh
set -euo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-/opt/baolu-backups}"
KEEP_NEWEST="${KEEP_NEWEST:-4}"
KEEP_NEWEST_GC="${KEEP_NEWEST_GC:-1}"
MAX_AGE_DAYS="${MAX_AGE_DAYS:-14}"
DRY_RUN="${DRY_RUN:-0}"

# 防呆：备份根必须精确等于约定值，避免变量拼错后误删其它目录。
case "$BACKUP_ROOT" in
  /opt/baolu-backups) ;;
  *) echo "unexpected BACKUP_ROOT: $BACKUP_ROOT" >&2; exit 1 ;;
esac
[ -d "$BACKUP_ROOT" ] || { echo "missing $BACKUP_ROOT" >&2; exit 1; }

echo "=== before ==="
df -h / | tail -1
echo "policy: KEEP_NEWEST=$KEEP_NEWEST per group (gc=$KEEP_NEWEST_GC), MAX_AGE_DAYS=$MAX_AGE_DAYS, DRY_RUN=$DRY_RUN"

now=$(date +%s)
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
inventory="$scratch/inventory.tsv"

for d in "$BACKUP_ROOT"/*; do
  [ -d "$d" ] || continue
  name="$(basename "$d")"
  case "$name" in .*) continue ;; esac
  mtime=$(stat -c %Y "$d")
  mb=$(du -sm "$d" | cut -f1)
  case "$name" in
    *-before-baolu-os-v2-test) group=test ;;
    *-before-baolu-os-v2)      group=prod ;;
    web-dist-assets-gc-*)      group=gc ;;
    *)                         group=legacy ;;
  esac
  printf '%s\t%s\t%s\t%s\n' "$group" "$mtime" "$mb" "$name" >> "$inventory"
done

# 每组内按修改时间倒序，序号即「最新第 N 个」。
sort -k1,1 -k2,2nr "$inventory" -o "$inventory"

python3 - "$inventory" "$KEEP_NEWEST" "$MAX_AGE_DAYS" "$now" "$KEEP_NEWEST_GC" > "$scratch/plan.tsv" <<'PY'
import sys

inv, keep_n, max_age_days, now = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
keep_gc = int(sys.argv[5])
max_age_sec = max_age_days * 86400
rank = {}

for line in open(inv, encoding="utf-8"):
    if not line.strip():
        continue
    group, mtime, mb, name = line.rstrip("\n").split("\t")
    keep_limit = keep_gc if group == "gc" else keep_n
    rank[group] = rank.get(group, 0) + 1
    age = now - int(mtime)
    if age > max_age_sec:
        action, why = "DEL", "older_than_%dd" % max_age_days
    elif rank[group] <= keep_limit:
        action, why = "KEEP", "newest_%d" % rank[group]
    else:
        action, why = "DEL", "beyond_newest_%d" % keep_limit
    print("\t".join([action, group, mb, name, why]))
PY

echo "=== plan: KEEP ==="
awk -F'\t' '$1=="KEEP"{printf "KEEP  %6sMB  %-6s  %s\n", $3, $2, $4}' "$scratch/plan.tsv"

echo "=== plan: DEL ==="
awk -F'\t' '$1=="DEL"{printf "DEL   %6sMB  %-6s  %s  (%s)\n", $3, $2, $4, $5; total+=$3}
  END{printf "TOTAL_DELETE_MB=%d\n", total}' "$scratch/plan.tsv"

if [ "$DRY_RUN" = "1" ]; then
  echo "DRY_RUN=1 → 未删除任何文件"
  exit 0
fi

logdir="$BACKUP_ROOT/.prune-log"
mkdir -p "$logdir"
manifest="$logdir/$(date +%Y%m%d-%H%M%S).tsv"
printf 'action\tgroup\tsize_mb\tname\treason\n' > "$manifest"

deleted=0
while IFS=$'\t' read -r action group mb name why; do
  [ "$action" = "DEL" ] || continue
  target="$BACKUP_ROOT/$name"
  resolved="$(readlink -f "$target")"
  case "$resolved" in
    "$BACKUP_ROOT"/*) ;;
    *) echo "SKIP unsafe path: $resolved" >&2; continue ;;
  esac
  [ -d "$resolved" ] || { echo "SKIP not-a-dir: $resolved" >&2; continue; }
  rm -rf "$resolved"
  printf 'DEL\t%s\t%s\t%s\t%s\n' "$group" "$mb" "$name" "$why" >> "$manifest"
  deleted=$((deleted + 1))
done < <(awk -F'\t' '$1=="DEL"{print}' "$scratch/plan.tsv")

echo "deleted_dirs=$deleted"
echo "manifest=$manifest"

echo "=== after ==="
df -h / | tail -1
echo "remaining_backups=$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d ! -name '.prune-log' | wc -l)"
