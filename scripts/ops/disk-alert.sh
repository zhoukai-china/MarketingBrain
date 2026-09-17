#!/usr/bin/env bash
# 磁盘水位告警：可用空间或使用率越线就发一条告警，越线前安静。
#
# 背景：生产 `/` 曾被发布暂存（8.4G）与历史备份（6.4G）写满，PostgreSQL 扩展文件失败，
# `/auth/beta-login` 建租户 500，内测用户看到「服务不可用」。发布脚本已加空间预检与暂存回收，
# 这条告警负责在**写满之前**把人叫醒。
#
# 夜间静默（2026-09-17 用户要求「夜间不用一小时一推送」）：水位越线是**持续状态**，不是一次性事件，
# 原来一小时一条会在夜里整夜重复刷屏。现在夜间只发**紧急级**，常规越线留到白天再提醒；
# 检查本身照旧每小时跑（timer 不变），静默只影响「推不推」，不影响「查没查」。
#
# 用法：
#   bash scripts/ops/disk-alert.sh                 # 正常检查（越线且不在静默期才发告警）
#   bash scripts/ops/disk-alert.sh --dry-run       # 只打印判定结果，不发任何请求
#   WARN_PCT=80 WARN_FREE_GB=10 bash scripts/ops/disk-alert.sh
#   QUIET_HOURS=off bash scripts/ops/disk-alert.sh # 关掉夜间静默（回到旧的每小时推）
#
# 环境变量（可用 systemd 的 EnvironmentFile / Environment= 覆盖）：
#   TARGET        检查路径，默认 /
#   WARN_PCT      使用率告警线，默认 85（%）
#   WARN_FREE_GB  可用空间告警线，默认 8（G）
#   CRIT_FREE_GB  紧急线，默认 5（G）——与发布脚本「可用 <5G 拒绝发布」同一条线；
#                 达到紧急线时**忽略夜间静默**，立刻推送
#   QUIET_HOURS   夜间静默窗口，默认 23-7（本地时间 23:00 起、次日 07:00 止，支持跨零点）；
#                 置空或 off = 关闭静默
#   QUIET_TZ      计算静默窗口用的时区，默认取系统时区（本机 Asia/Shanghai）
#   NOW_HOUR      仅测试用：强制当前小时（0-23），覆盖真实时间
#
# 环境：告警通道从 `SITONG_ALERT_WEBHOOK` 读取（与本机其它 watchdog 同一份 alerts env）；
#       未配置 webhook 时只写 journal（仍会以退出码 2 标红，便于 systemd 记录失败）。
# 退出码：0=未越线或 dry-run；2=越线（无论已推送还是被夜间静默）——沿用旧的「越线即 systemd
#         标红」口径，方便在 journal 里筛「现在是否越线」，不代表脚本崩了。
set -uo pipefail

TARGET="${TARGET:-/}"
WARN_PCT="${WARN_PCT:-85}"
WARN_FREE_GB="${WARN_FREE_GB:-8}"
CRIT_FREE_GB="${CRIT_FREE_GB:-5}"
QUIET_HOURS="${QUIET_HOURS-23-7}"
DRY_RUN="${1:-}"
if [ -n "$DRY_RUN" ] && [ "$DRY_RUN" != "--dry-run" ]; then echo "unknown argument: $DRY_RUN" >&2; exit 2; fi

is_hour() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  [ "$1" -le 23 ]
}

if [ -n "${NOW_HOUR:-}" ]; then
  HOUR="$NOW_HOUR"
elif [ -n "${QUIET_TZ:-}" ]; then
  HOUR="$(TZ="$QUIET_TZ" date +%H)"
else
  HOUR="$(date +%H)"
fi
if ! is_hour "$HOUR"; then echo "取不到合法小时（NOW_HOUR/时区）：$HOUR" >&2; exit 2; fi
HOUR=$((10#$HOUR))

IN_QUIET=0
QUIET_LABEL="off"
if [ -n "$QUIET_HOURS" ] && [ "$QUIET_HOURS" != "off" ]; then
  Q_START="${QUIET_HOURS%%-*}"
  Q_END="${QUIET_HOURS##*-}"
  if is_hour "$Q_START" && is_hour "$Q_END"; then
    QUIET_LABEL="${Q_START}:00-${Q_END}:00"
    if [ "$Q_START" -le "$Q_END" ]; then
      if [ "$HOUR" -ge "$Q_START" ] && [ "$HOUR" -lt "$Q_END" ]; then IN_QUIET=1; fi
    else
      # 跨零点：默认 23-7 即 23:00 起到次日 06:59 都在静默期
      if [ "$HOUR" -ge "$Q_START" ] || [ "$HOUR" -lt "$Q_END" ]; then IN_QUIET=1; fi
    fi
  else
    QUIET_LABEL="invalid(${QUIET_HOURS})→关闭静默"
    echo "QUIET_HOURS 非法（$QUIET_HOURS），按不静默处理" >&2
  fi
fi

read -r USED_PCT AVAIL_GB <<<"$(df -P "$TARGET" | awk 'NR==2 {gsub(/%/,"",$5); gb=$4/1048576; printf "%d %.1f", $5, gb}')"
echo "disk $TARGET used=${USED_PCT}% avail=${AVAIL_GB}G thresholds: pct>=${WARN_PCT}% or free<=${WARN_FREE_GB}G"

ALERT=""
if [ "$USED_PCT" -ge "$WARN_PCT" ]; then ALERT="使用率 ${USED_PCT}% ≥ ${WARN_PCT}%"; fi
if awk "BEGIN{exit !(${AVAIL_GB} <= ${WARN_FREE_GB})}"; then ALERT="${ALERT:+$ALERT；}可用 ${AVAIL_GB}G ≤ ${WARN_FREE_GB}G"; fi
if [ -z "$ALERT" ]; then
  echo "OK（未越线，不发告警）"
  exit 0
fi

CRITICAL=0
if awk "BEGIN{exit !(${AVAIL_GB} <= ${CRIT_FREE_GB})}"; then
  CRITICAL=1
  MESSAGE="【思潼AI增长OS 磁盘紧急告警】${TARGET} 可用 ${AVAIL_GB}G ≤ ${CRIT_FREE_GB}G（发布红线：发布脚本会直接拒绝发布）；${ALERT}。处置：先跑 scripts/ops/prune-server-backups.sh（dry-run 看清单）清历史备份，再清 /opt/baolu-stage/* 与 /tmp/release-*.tar.gz。"
else
  MESSAGE="【思潼AI增长OS 磁盘告警】${TARGET} 空间越线：${ALERT}。处置：先跑 scripts/ops/prune-server-backups.sh（dry-run 看清单）清历史备份，再清 /opt/baolu-stage/* 与 /tmp/release-*.tar.gz；发布脚本已内置「可用 <5G 拒绝发布」预检。"
fi

echo "now=${HOUR}h quiet_window=${QUIET_LABEL} quiet=${IN_QUIET} critical=${CRITICAL}"
echo "ALERT: $MESSAGE"

if [ "$IN_QUIET" = "1" ] && [ "$CRITICAL" = "0" ]; then
  echo "QUIET: 夜间（${QUIET_LABEL}）静默常规水位告警，本次不推送；紧急线（可用 ≤${CRIT_FREE_GB}G）不受静默影响，白天恢复推送。"
  if [ "$DRY_RUN" = "--dry-run" ]; then exit 0; fi
  exit 2
fi

if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "DRY-RUN: 只判定不发送"
  exit 0
fi

if [ -n "${SITONG_ALERT_WEBHOOK:-}" ]; then
  curl -sS --max-time 15 -X POST -H 'content-type: application/json' \
    -d "$(printf '{"msgtype":"text","text":{"content":%s}}' "$(printf '%s' "$MESSAGE" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')")" \
    "$SITONG_ALERT_WEBHOOK" >/dev/null && echo "alert sent" || echo "alert webhook failed" >&2
  exit 2
fi

echo "SITONG_ALERT_WEBHOOK not configured; journal only" >&2
exit 2
