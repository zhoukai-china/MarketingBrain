#!/bin/bash
# 视频素材保留策略：**给用户保存 24 小时，之后从服务器删掉**（用户 2026-09-12 口径）。
#
# 覆盖两处：
#   1) OSS 暂存桶：靠桶上的 1 天生命周期规则（beauty-industry/video-staging/v1/lanqi-prod/）自动过期；
#   2) 本机落盘：本脚本删除 24 小时前的本地结果与暂存文件。
#
# 只删文件、不删目录树本身，只输出数量与字节数（不输出文件名，避免把客户信息写进日志）。
set -euo pipefail

ROOT="${BS_VIDEO_RETENTION_ROOT:-/opt/baolu-os-v2/uploads}"
declare -a TARGETS=(
  "$ROOT/.beauty-video-results"
  "$ROOT/lanqi-media/staging"
)

deleted=0
freed=0
for dir in "${TARGETS[@]}"; do
  [ -d "$dir" ] || continue
  while IFS= read -r -d '' file; do
    size="$(stat -c %s "$file" 2>/dev/null || echo 0)"
    if rm -f -- "$file"; then
      deleted=$((deleted + 1))
      freed=$((freed + size))
    fi
  done < <(find "$dir" -type f -mmin +1440 -print0 2>/dev/null)
done

echo "video_retention_24h deleted_files=${deleted} freed_bytes=${freed}"
