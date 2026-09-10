#!/usr/bin/env bash
# 只读：按本机给出的文件清单，在测试实例上计算「归一化 sha256」，
# 输出 "sha  path" / "MISSING  path"。
# 归一化 = 去掉 UTF-8 BOM + 删除 CR（消除 Windows CRLF 与 BOM 造成的假差异）。
# 用法：lq20-compare-server-manifest.sh <app-dir> <paths-file> <out-file>
set -uo pipefail

APP="${1:?app dir}"
PATHS="${2:?paths file}"
OUT="${3:?out file}"

case "$APP" in /opt/baolu-*) ;; *) echo "unexpected APP=$APP" >&2; exit 1 ;; esac
test -f "$PATHS"

: > "$OUT"
while IFS= read -r p; do
  [ -z "$p" ] && continue
  if [ -f "$APP/$p" ]; then
    printf '%s  %s\n' "$(tr -d '\r' < "$APP/$p" | sed '1s/^\xEF\xBB\xBF//' | sha256sum | awk '{print $1}')" "$p" >> "$OUT"
  else
    printf 'MISSING  %s\n' "$p" >> "$OUT"
  fi
done < "$PATHS"

echo "lines=$(wc -l < "$OUT")"
echo "missing=$(grep -c '^MISSING' "$OUT" || true)"
