#!/usr/bin/env bash
set -euo pipefail

SOURCE_FILE="${1:?Pass the protected internal code source file}"
OUTPUT_FILE="${2:?Pass the protected handoff output file}"

if [ -e "$OUTPUT_FILE" ]; then
  echo "Refusing to overwrite invite handoff: $OUTPUT_FILE" >&2
  exit 1
fi

set -a
. "$SOURCE_FILE"
set +a

umask 077
{
  echo "思潼AI增长飞轮｜内部体验邀请码"
  echo
  echo "体验地址：https://api.lcppch.top/os-v2/"
  echo "套餐：chain_premium"
  echo "有效期：${EXPIRES_AT}"
  echo
  echo "内部A：${INTERNAL_A}"
  echo "内部B：${INTERNAL_B}"
  echo
  echo "说明：每个邀请码只能成功使用一次。先用A完成完整体验，再用B做第二账号隔离复核。"
  echo "暂时不要把这两个内部码转发给客户；客户正式体验时单独创建客户专属码。"
} > "$OUTPUT_FILE"
chmod 600 "$OUTPUT_FILE"
echo "Invite handoff created: $OUTPUT_FILE"
