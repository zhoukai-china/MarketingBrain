#!/usr/bin/env bash
# 过期垃圾一次性清理（2026-09-15，用户拍板；默认 dry-run，可重复执行）。
#
# 清理对象写死白名单（不在表里的一律不动）：
#   /opt/baolu-os-v2/node_modules.broken-f-links-20260804     站点里失效的软链残留（约 19M）
#   /opt/baolu-os-v2/_tmp_zhenshui_715_parser_check_20260810  一次性解析器检查残留（约 7.6M）
#   /opt/baolu-os-v2-releases                                 历史发布包（2026-07 起，约 322M）
#   /opt/baolu-os-v2-backups                                  历史源码/产物备份（2026-07 起，约 168M）
#   /opt/baolu-os-v2-backup-20260811-134303                   历史整机备份（约 260M）
#
# 这一批合计约 1.5G，都不是回滚资产——回滚用的是 /opt/baolu-backups 里带日期的那批快照。
#
# 安全边界（fail closed）：
#   · **/opt/baolu-backups 永不删除**：脚本显式拒绝任何 `/opt/baolu-backups` 开头的路径；
#     `/opt/baolu-os-v2-backups` 与它名字只差几个字符，所以白名单用整串精确比较，不做前缀匹配；
#   · 每一项必须「存在 + 是目录 + 里面最新文件也早于 MIN_AGE_DAYS 天」才删，
#     最近有写入的目录会被跳过并打印原因（避免误删正在用的目录）；
#   · 删除前打印体积、文件数和最近 5 个条目，便于事后复核。
#
# 用法：
#   bash /opt/baolu-ops/purge-legacy-artifacts.sh             # 预览（dry-run）
#   bash /opt/baolu-ops/purge-legacy-artifacts.sh --apply     # 执行
set -uo pipefail

MIN_AGE_DAYS="${MIN_AGE_DAYS:-7}"
APPLY="${1:-}"

case "$APPLY" in
  "" | --apply) ;;
  *) echo "unknown argument: $APPLY" >&2; exit 2 ;;
esac
case "$MIN_AGE_DAYS" in
  "" | *[!0-9]*) echo "MIN_AGE_DAYS must be a positive integer" >&2; exit 2 ;;
esac

TARGETS=(
  "/opt/baolu-os-v2/node_modules.broken-f-links-20260804"
  "/opt/baolu-os-v2/_tmp_zhenshui_715_parser_check_20260810"
  "/opt/baolu-os-v2-releases"
  "/opt/baolu-os-v2-backups"
  "/opt/baolu-os-v2-backup-20260811-134303"
)

# 回滚资产根：任何情况下都不在这里面删东西。
ROLLBACK_ROOT="/opt/baolu-backups"

echo "policy: 白名单一次性清理，要求目录内最新文件也早于 ${MIN_AGE_DAYS} 天；APPLY=${APPLY:-<dry-run>}"
echo "== before =="
df -h / | tail -n 1

now="$(date +%s)"
plan=()
total_mb=0

for target in "${TARGETS[@]}"; do
  if [ ! -e "$target" ]; then
    echo "SKIP missing: $target"
    continue
  fi
  if [ ! -d "$target" ]; then
    echo "SKIP not-a-dir: $target"
    continue
  fi
  if [ -L "$target" ]; then
    echo "SKIP symlink: $target"
    continue
  fi
  resolved="$(readlink -f -- "$target")"
  # 精确比较：绝不允许删到回滚根或它下面任何东西。
  case "$resolved" in
    "$ROLLBACK_ROOT" | "$ROLLBACK_ROOT"/*)
      echo "SKIP rollback asset: $resolved" >&2
      continue
      ;;
  esac
  # 白名单精确匹配（解析软链后仍必须等于原串），防止路径漂移。
  match=0
  for t in "${TARGETS[@]}"; do
    if [ "$resolved" = "$t" ]; then match=1; fi
  done
  if [ "$match" != "1" ]; then
    echo "SKIP not-in-allowlist after resolve: $target -> $resolved" >&2
    continue
  fi

  mb="$(du -sm -- "$resolved" 2>/dev/null | cut -f1)"
  files="$(find "$resolved" -type f 2>/dev/null | wc -l)"
  newest="$(find "$resolved" -type f -printf '%T@\n' 2>/dev/null | sort -n | tail -n 1)"
  if [ -n "$newest" ]; then
    newest_i="${newest%.*}"
    age_days=$(( (now - newest_i) / 86400 ))
  else
    age_days="$MIN_AGE_DAYS"
  fi

  echo "-- $resolved"
  echo "   size=${mb:-?}MB files=$files newest_age_days=$age_days"
  find "$resolved" -maxdepth 1 -mindepth 1 -printf '   · %f\n' 2>/dev/null | sort | head -n 5

  if [ "$age_days" -lt "$MIN_AGE_DAYS" ]; then
    echo "   SKIP 最近 ${age_days} 天内有写入（< ${MIN_AGE_DAYS} 天），先不动"
    continue
  fi

  plan+=("$resolved")
  total_mb=$((total_mb + ${mb:-0}))
done

echo
if [ "${#plan[@]}" -eq 0 ]; then
  echo "nothing to purge"
  exit 0
fi

echo "计划删除 ${#plan[@]} 项，合计约 ${total_mb}MB："
for p in "${plan[@]}"; do echo "   $p"; done

if [ "$APPLY" != "--apply" ]; then
  echo
  echo "DRY-RUN：未删除任何文件。确认后加 --apply 执行。"
  exit 0
fi

deleted=0
for p in "${plan[@]}"; do
  resolved="$(readlink -f -- "$p")"
  case "$resolved" in
    "$ROLLBACK_ROOT" | "$ROLLBACK_ROOT"/*) echo "SKIP rollback asset: $resolved" >&2; continue ;;
  esac
  match=0
  for t in "${TARGETS[@]}"; do
    if [ "$resolved" = "$t" ]; then match=1; fi
  done
  if [ "$match" != "1" ]; then
    echo "SKIP not-in-allowlist: $resolved" >&2
    continue
  fi
  if rm -rf -- "$resolved"; then
    deleted=$((deleted + 1))
    echo "removed $resolved"
  else
    echo "FAILED to remove $resolved" >&2
  fi
done

echo "deleted=${deleted}/${#plan[@]}"
echo "== after =="
df -h / | tail -n 1
echo "回滚资产（未触碰）：$(find "$ROLLBACK_ROOT" -mindepth 1 -maxdepth 1 -type d ! -name '.prune-log' 2>/dev/null | wc -l) 份快照"
