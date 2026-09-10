#!/usr/bin/env bash
# 比对本地 LF 归一化 SHA256 清单与服务器工作树。用法：compare-manifest.sh <app-dir> <manifest>
set -euo pipefail
APP="${1:?app dir}"
M="${2:?manifest}"
ok=0; diff=0; missing=0
DIFF_LIST=/tmp/manifest-diff.txt
MISS_LIST=/tmp/manifest-missing.txt
: > "$DIFF_LIST"; : > "$MISS_LIST"
while IFS= read -r line; do
  [ -n "$line" ] || continue
  hash="${line%%  *}"; rel="${line#*  }"
  if [ "$hash" = "MISSING_LOCAL" ]; then continue; fi
  if [ ! -f "$APP/$rel" ]; then printf '%s\n' "$rel" >> "$MISS_LIST"; missing=$((missing+1)); continue; fi
  lf=$(tr -d '\r' < "$APP/$rel" | sha256sum | cut -d' ' -f1)
  if [ "$lf" = "$hash" ]; then ok=$((ok+1)); else printf '%s\n' "$rel" >> "$DIFF_LIST"; diff=$((diff+1)); fi
done < "$M"
echo "OK=$ok DIFF=$diff MISSING=$missing"
echo "--- DIFF ---"; cat "$DIFF_LIST"
echo "--- MISSING ---"; cat "$MISS_LIST"
