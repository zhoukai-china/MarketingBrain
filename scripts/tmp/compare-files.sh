#!/usr/bin/env bash
# 对指定文件列表做「原始字节 + LF 归一化」双口径比对。
# 用法：compare-files.sh <local-root-dir> <deploy-dir> <relpath-list-file>
set -euo pipefail
LOCAL="${1:?local root}"
DEPLOY="${2:?deploy dir}"
LIST="${3:?relpath list}"
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  lraw=$(sha256sum "$LOCAL/$rel" | cut -d' ' -f1)
  lraw_d=$(sha256sum "$DEPLOY/$rel" | cut -d' ' -f1)
  llf=$(tr -d '\r' < "$LOCAL/$rel" | sha256sum | cut -d' ' -f1)
  dlf=$(tr -d '\r' < "$DEPLOY/$rel" | sha256sum | cut -d' ' -f1)
  verdict="SAME-BYTES"
  [ "$lraw" = "$lraw_d" ] || verdict="RAW-DIFF"
  if [ "$verdict" = "RAW-DIFF" ]; then
    if [ "$llf" = "$dlf" ]; then verdict="CRLF-ONLY"; fi
  fi
  printf '%-12s %10s %10s  %s\n' "$verdict" "$(stat -c%s "$LOCAL/$rel")" "$(stat -c%s "$DEPLOY/$rel")" "$rel"
done < "$LIST"
