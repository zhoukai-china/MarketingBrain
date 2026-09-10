#!/usr/bin/env bash
# 只读：确认生产目录在「回滚只解了一半」之后依然完好，并记录现场。
set -uo pipefail
APP=/opt/baolu-os-v2
BACKUP=/opt/baolu-backups/20260910-copy-neutral-refcase-prod-before-baolu-os-v2

echo "=== service ==="
systemctl is-active baolu-os-v2 || true
curl -s -o /dev/null -w 'health=%{http_code}\n' http://127.0.0.1:3002/health || true

echo "=== dist hashes: now vs before-deploy ==="
( cd "$APP" && sudo find apps packages -path '*/dist/*' -type f | sort | xargs -r sha256sum ) > /tmp/dist-hashes-now.txt
sort "$BACKUP/dist-hashes-before.txt" > /tmp/dist-before-sorted.txt
sort /tmp/dist-hashes-now.txt > /tmp/dist-now-sorted.txt
diff /tmp/dist-before-sorted.txt /tmp/dist-now-sorted.txt > /tmp/dist-diff.txt 2>&1
echo "diff_lines=$(wc -l < /tmp/dist-diff.txt)"
head -30 /tmp/dist-diff.txt

echo "=== served entry chunk ==="
curl -s https://api.lcppch.top/os-v2/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' || true

echo "=== marketplace chunk on disk ==="
ls -l "$APP"/apps/web/dist/assets/MarketplaceApp-*.js 2>/dev/null | head -5 || true

echo "=== reference-cases in served bundle ==="
ENTRY_JS=$(curl -s https://api.lcppch.top/os-v2/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)
CHUNK=$(curl -s "https://api.lcppch.top/os-v2/$(dirname "$ENTRY_JS")/../$ENTRY_JS" 2>/dev/null | grep -o 'MarketplaceApp-[A-Za-z0-9_-]*\.js' | head -1)
echo "entry=$ENTRY_JS marketplace_chunk=$CHUNK"
