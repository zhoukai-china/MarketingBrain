#!/usr/bin/env bash
# 生成服务器工作树（LF 归一化）SHA256 清单，用于反向比对「服务器独有文件」。
# 用法：make-server-manifest.sh <app-dir> <out-file>
set -euo pipefail
APP="${1:?app dir}"
OUT="${2:?out file}"
: > "$OUT"
for d in apps/api/src apps/api/scripts apps/web/src packages/db/prisma mcp-skills/skills scripts; do
  [ -d "$APP/$d" ] || continue
  find "$APP/$d" -type f -not -path '*/node_modules/*' | sed "s#^$APP/##" | sort | while IFS= read -r rel; do
    h=$(tr -d '\r' < "$APP/$rel" | sha256sum | cut -d' ' -f1)
    printf '%s  %s\n' "$h" "$rel"
  done
done >> "$OUT"
for f in apps/web/index.html apps/web/vite.config.ts apps/web/package.json package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json; do
  [ -f "$APP/$f" ] || continue
  h=$(tr -d '\r' < "$APP/$f" | sha256sum | cut -d' ' -f1)
  printf '%s  %s\n' "$h" "$f"
done >> "$OUT"
wc -l "$OUT"
