#!/usr/bin/env bash
# 为 api.lcppch.top/os-v2/ 构建「带前缀」前端产物（地址形如 /os-v2/agents）。
#
# 与 scripts/build-ai-root.sh 是同一套发布逻辑，只是换了 VITE_BASE_PATH 与目标目录。
# 两套产物必须成对发布，否则会出现「一个域名是新的、另一个还是旧的」——2026-09-20
# 的事故就是这样发生的（ai.lcppch.top 停在旧产物，用户看到「又回退了」）。
#
# 用法（服务器上执行，先 os-v2 再 ai-root 或反之，两个都要跑）：
#   bash /opt/baolu-os-v2/scripts/build-os-v2-web.sh
#   bash /opt/baolu-os-v2/scripts/build-ai-root.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="${WEB_DIR:-/opt/baolu-os-v2/apps/web}"

BASE_PATH="/os-v2/" \
DIST_DIR="$WEB_DIR/dist" \
BUILD_DIR="$WEB_DIR/.os-v2-build" \
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://api.lcppch.top/os-v2}" \
PUBLIC_AVATAR_PATH="/avatars/ip-position.png" \
  exec bash "$SCRIPT_DIR/build-ai-root.sh"
