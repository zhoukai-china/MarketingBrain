#!/usr/bin/env bash
# 服务器磁盘保留策略（默认 dry-run）：发布备份目录按环境各自保留最近 N 份，其余列出来待删。
#
# 背景（2026-09-15 P0）：生产磁盘被写满（`/opt/baolu-stage` 累计 8.4G + `/opt/baolu-backups` 6.4G / 49 份），
# PostgreSQL 报 `No space left on device`，`POST /auth/beta-login` 建租户时 500，内测用户看到「服务不可用」。
# 暂存目录已在现场清理；备份目录需要一条**可复核**的保留策略，避免再次堆满。
#
# 用法（默认只看不动）：
#   bash scripts/ops/prune-server-backups.sh                 # dry-run，打印将删除的目录
#   KEEP=8 bash scripts/ops/prune-server-backups.sh --apply   # 真正删除，保留每环境最近 8 份
#
# 只处理 /opt/baolu-backups 下形如 `*-before-baolu-os-v2{,-test}` 的发布备份目录；
# 任何不符合命名或不在该目录内的路径一律拒绝执行（fail closed），不碰应用目录、数据库与客户数据。
set -uo pipefail

BACKUP_ROOT="/opt/baolu-backups"
KEEP="${KEEP:-8}"
APPLY="${1:-}"

case "$KEEP" in ''|*[!0-9]*) echo "KEEP must be a positive integer" >&2; exit 2 ;; esac
test "$KEEP" -ge 2 || { echo "KEEP must be >= 2 (keep at least two rollback points)" >&2; exit 2; }
test -d "$BACKUP_ROOT" || { echo "missing $BACKUP_ROOT" >&2; exit 2; }
if [ -n "$APPLY" ] && [ "$APPLY" != "--apply" ]; then echo "unknown argument: $APPLY" >&2; exit 2; fi

echo "== before =="
df -h / | tail -n 1

plan=()
for suffix in "-before-baolu-os-v2-test" "-before-baolu-os-v2"; do
  # 精确后缀匹配：`-before-baolu-os-v2` 不能吃掉 `...-test`（先处理 test 组）。
  mapfile -t entries < <(find "$BACKUP_ROOT" -maxdepth 1 -mindepth 1 -type d -name "*${suffix}" -printf '%T@ %p\n' | sort -rn | awk '{print $2}')
  count="${#entries[@]}"
  echo "-- $suffix: $count 份，保留最近 $KEEP 份"
  index=0
  for dir in "${entries[@]}"; do
    index=$((index + 1))
    case "$(realpath -- "$dir")" in
      "$BACKUP_ROOT"/*) ;;
      *) echo "Refusing unexpected target: $dir" >&2; exit 1 ;;
    esac
    if [ "$index" -le "$KEEP" ]; then
      echo "   KEEP   $(basename "$dir")"
    else
      echo "   DELETE $(basename "$dir")"
      plan+=("$dir")
    fi
  done
done

if [ "${#plan[@]}" -eq 0 ]; then
  echo "nothing to prune"
  exit 0
fi

if [ "$APPLY" != "--apply" ]; then
  echo
  echo "DRY-RUN：将删除 ${#plan[@]} 个备份目录。确认后加 --apply 执行。"
  exit 0
fi

for dir in "${plan[@]}"; do
  echo "removing $dir"
  sudo rm -rf -- "$dir"
done

echo "== after =="
df -h / | tail -n 1
