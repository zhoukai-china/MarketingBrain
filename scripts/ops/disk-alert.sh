#!/usr/bin/env bash
# 磁盘水位告警（2026-09-15 P0 后新增）：可用空间或使用率越线就发一条告警，越线前安静。
#
# 背景：生产 `/` 被发布暂存（8.4G）与历史备份（6.4G）写满，PostgreSQL 扩展文件失败，
# `/auth/beta-login` 建租户 500，内测用户看到「服务不可用」。发布脚本已加空间预检与暂存回收，
# 这条告警负责在**写满之前**把人叫醒。
#
# 用法：
#   bash scripts/ops/disk-alert.sh                 # 正常检查（越线才发告警）
#   bash scripts/ops/disk-alert.sh --dry-run       # 只打印判定结果，不发任何请求
#   WARN_PCT=80 WARN_FREE_GB=10 bash scripts/ops/disk-alert.sh
#
# 环境：告警通道从 `SITONG_ALERT_WEBHOOK` 读取（与本机其它 watchdog 同一份 alerts env）；
#       未配置 webhook 时只写 journal（仍会以退出码 2 标红，便于 systemd 记录失败）。
set -uo pipefail

TARGET="${TARGET:-/}"
WARN_PCT="${WARN_PCT:-85}"
WARN_FREE_GB="${WARN_FREE_GB:-8}"
DRY_RUN="${1:-}"
if [ -n "$DRY_RUN" ] && [ "$DRY_RUN" != "--dry-run" ]; then echo "unknown argument: $DRY_RUN" >&2; exit 2; fi

read -r USED_PCT AVAIL_GB <<<"$(df -P "$TARGET" | awk 'NR==2 {gsub(/%/,"",$5); gb=$4/1048576; printf "%d %.1f", $5, gb}')"
echo "disk $TARGET used=${USED_PCT}% avail=${AVAIL_GB}G thresholds: pct>=${WARN_PCT}% or free<=${WARN_FREE_GB}G"

ALERT=""
if [ "$USED_PCT" -ge "$WARN_PCT" ]; then ALERT="使用率 ${USED_PCT}% ≥ ${WARN_PCT}%"; fi
if awk "BEGIN{exit !(${AVAIL_GB} <= ${WARN_FREE_GB})}"; then ALERT="${ALERT:+$ALERT；}可用 ${AVAIL_GB}G ≤ ${WARN_FREE_GB}G"; fi
if [ -z "$ALERT" ]; then
  echo "OK（未越线，不发告警）"
  exit 0
fi

MESSAGE="【思潼AI增长OS 磁盘告警】${TARGET} 空间越线：${ALERT}。处置：先跑 scripts/ops/prune-server-backups.sh（dry-run 看清单）清历史备份，再清 /opt/baolu-stage/* 与 /tmp/release-*.tar.gz；发布脚本已内置「可用 <5G 拒绝发布」预检。"
echo "ALERT: $MESSAGE"

if [ "$DRY_RUN" = "--dry-run" ]; then exit 0; fi

if [ -n "${SITONG_ALERT_WEBHOOK:-}" ]; then
  curl -sS --max-time 15 -X POST -H 'content-type: application/json' \
    -d "$(printf '{"msgtype":"text","text":{"content":%s}}' "$(printf '%s' "$MESSAGE" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')")" \
    "$SITONG_ALERT_WEBHOOK" >/dev/null && echo "alert sent" || echo "alert webhook failed" >&2
  exit 2
fi

echo "SITONG_ALERT_WEBHOOK not configured; journal only" >&2
exit 2
