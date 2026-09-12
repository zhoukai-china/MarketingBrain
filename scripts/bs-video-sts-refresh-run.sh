#!/bin/bash
# 兰琪爆款复刻：STS 定时刷新包装脚本（由 bs-video-sts-refresh.timer 调用）。
#
# 为什么需要重启：应用把 BEAUTY_VIDEO_* 当进程环境变量读取，且 staging driver
# 明确不做自动续期。所以刷新后必须让服务重新加载 env；这里只在到期时间真的变了
# 才重启，避免无意义抖动。
set -euo pipefail

APP_ENV="/etc/baolu-secrets/baolu-os-v2.env"
REFRESH="/usr/local/bin/bs-video-sts-refresh.mjs"

before="$(grep '^BEAUTY_VIDEO_OSS_CREDENTIAL_EXPIRES_AT=' "$APP_ENV" || true)"
/usr/bin/node "$REFRESH"
after="$(grep '^BEAUTY_VIDEO_OSS_CREDENTIAL_EXPIRES_AT=' "$APP_ENV" || true)"

if [ "$before" != "$after" ]; then
  /bin/systemctl restart baolu-os-v2
  echo "sts_refreshed_and_restarted expires=${after#*=}"
else
  echo "sts_unchanged_no_restart"
fi
