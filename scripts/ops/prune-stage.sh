#!/usr/bin/env bash
# /opt/baolu-stage 发布暂存保留策略（默认 dry-run，幂等，可重复执行）。
#
# 背景（2026-09-15）：
#   发布成功时 deploy-release.sh 会删掉自己这次的暂存，但**失败路径**会保留暂存便于现场取证，
#   一次失败就留下 300–400M；当天已经因此把磁盘写满过一次（docs/BUG_REGRESSIONS.md QA-20260915-001）。
#   所以需要一条「不管发布成没成功，超过 24 小时就回收」的定时兜底。
#
# 做两件事，按固定时限回收：
#   1) 删除 /opt/baolu-stage 下**修改时间超过 KEEP_HOURS 小时**的一级子目录（发布暂存）；
#   2) 删除 /tmp 下**修改时间超过 KEEP_HOURS 小时**的 release-*.tar.gz（发布包上传副本）。
#
# 安全边界（fail closed）：
#   · STAGE_ROOT 必须精确等于 /opt/baolu-stage；/tmp 只匹配 release-*.tar.gz；
#   · 删除前用 readlink -f 复核路径仍在其根目录内，越界一律拒绝；
#   · **绝不触碰 /opt/baolu-backups**（发布前回滚快照，保留策略见 scripts/ops/prune-server-backups.sh）。
#
# 用法：
#   bash /opt/baolu-ops/prune-stage.sh              # 预览（dry-run），不删任何东西
#   bash /opt/baolu-ops/prune-stage.sh --apply      # 执行清理
#   KEEP_HOURS=48 bash /opt/baolu-ops/prune-stage.sh --apply
set -uo pipefail

STAGE_ROOT="${STAGE_ROOT:-/opt/baolu-stage}"
KEEP_HOURS="${KEEP_HOURS:-24}"
APPLY="${1:-}"

case "$APPLY" in
  "" | --apply) ;;
  *) echo "unknown argument: $APPLY" >&2; exit 2 ;;
esac
case "$KEEP_HOURS" in
  "" | *[!0-9]*) echo "KEEP_HOURS must be a positive integer" >&2; exit 2 ;;
esac
test "$KEEP_HOURS" -ge 1 || { echo "KEEP_HOURS must be >= 1" >&2; exit 2; }
case "$STAGE_ROOT" in
  /opt/baolu-stage) ;;
  *) echo "unexpected STAGE_ROOT: $STAGE_ROOT" >&2; exit 2 ;;
esac
# 冗余防呆：名字只差几个字符的 /opt/baolu-backups 是回滚资产，永远不在这里删。
case "$STAGE_ROOT" in
  /opt/baolu-backups*) echo "refuse: $STAGE_ROOT looks like the rollback root" >&2; exit 2 ;;
esac

KEEP_MIN=$((KEEP_HOURS * 60))

echo "policy: KEEP_HOURS=$KEEP_HOURS（暂存目录 + /tmp 发布包），APPLY=${APPLY:-<dry-run>}"
echo "== before =="
df -h / | tail -n 1

if command -v pgrep >/dev/null 2>&1 && pgrep -f 'deploy-release\.sh' >/dev/null 2>&1; then
  echo "WARN: 检测到正在运行的 deploy-release.sh；超过 ${KEEP_HOURS}h 的暂存通常是中断残留，但建议等发布结束再清理。"
fi

if [ ! -d "$STAGE_ROOT" ]; then
  echo "skip: missing $STAGE_ROOT（没有暂存目录，无需清理）"
  exit 0
fi

plan=()
tmp_plan=()

echo "== plan: $STAGE_ROOT =="
while IFS= read -r -d '' dir; do
  resolved="$(readlink -f -- "$dir")"
  case "$resolved" in
    "$STAGE_ROOT"/*) ;;
    *) echo "   SKIP unsafe path: $resolved" >&2; continue ;;
  esac
  case "$resolved" in
    /opt/baolu-backups*) echo "   SKIP rollback root: $resolved" >&2; continue ;;
  esac
  mb="$(du -sm -- "$resolved" 2>/dev/null | cut -f1)"
  age_h=$(( ($(date +%s) - $(stat -c %Y -- "$resolved")) / 3600 ))
  echo "   DELETE ${mb}MB  age=${age_h}h  $(basename "$resolved")"
  plan+=("$resolved")
done < <(find "$STAGE_ROOT" -maxdepth 1 -mindepth 1 -type d -mmin "+${KEEP_MIN}" -print0 2>/dev/null)

echo "== plan: /tmp/release-*.tar.gz =="
for f in /tmp/release-*.tar.gz; do
  [ -f "$f" ] || continue
  [ -L "$f" ] && continue
  [ -n "$(find "$f" -maxdepth 0 -mmin "+${KEEP_MIN}" -print 2>/dev/null)" ] || continue
  mb="$(du -sm -- "$f" 2>/dev/null | cut -f1)"
  age_h=$(( ($(date +%s) - $(stat -c %Y -- "$f")) / 3600 ))
  echo "   DELETE ${mb}MB  age=${age_h}h  $(basename "$f")"
  tmp_plan+=("$f")
done

if [ "${#plan[@]}" -eq 0 ] && [ "${#tmp_plan[@]}" -eq 0 ]; then
  echo "nothing to prune（没有超过 ${KEEP_HOURS}h 的暂存）"
  exit 0
fi

if [ "$APPLY" != "--apply" ]; then
  echo
  echo "DRY-RUN：将删除 ${#plan[@]} 个暂存目录 + ${#tmp_plan[@]} 个 /tmp 发布包。确认后加 --apply 执行。"
  exit 0
fi

deleted=0
freed_mb=0

if [ "${#plan[@]}" -gt 0 ]; then
  for dir in "${plan[@]}"; do
    resolved="$(readlink -f -- "$dir")"
    case "$resolved" in
      "$STAGE_ROOT"/*) ;;
      *) echo "SKIP unsafe path: $resolved" >&2; continue ;;
    esac
    case "$resolved" in
      /opt/baolu-backups*) echo "SKIP rollback root: $resolved" >&2; continue ;;
    esac
    [ -d "$resolved" ] || continue
    mb="$(du -sm -- "$resolved" 2>/dev/null | cut -f1)"
    if rm -rf -- "$resolved"; then
      deleted=$((deleted + 1))
      freed_mb=$((freed_mb + ${mb:-0}))
      echo "removed $resolved"
    fi
  done
fi

if [ "${#tmp_plan[@]}" -gt 0 ]; then
  for f in "${tmp_plan[@]}"; do
    case "$f" in
      /tmp/release-*.tar.gz) ;;
      *) echo "SKIP unsafe path: $f" >&2; continue ;;
    esac
    [ -f "$f" ] || continue
    mb="$(du -sm -- "$f" 2>/dev/null | cut -f1)"
    if rm -f -- "$f"; then
      deleted=$((deleted + 1))
      freed_mb=$((freed_mb + ${mb:-0}))
      echo "removed $f"
    fi
  done
fi

echo "deleted=${deleted} freed_approx_mb=${freed_mb}"
echo "== after =="
df -h / | tail -n 1
