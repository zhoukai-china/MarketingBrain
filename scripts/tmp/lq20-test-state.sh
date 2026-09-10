#!/usr/bin/env bash
# 只读：测试实例当前构建状态快照
set -uo pipefail

APP=/opt/baolu-os-v2-test

echo "=== service ==="
systemctl show baolu-os-v2-test -p ActiveState -p SubState -p MainPID

echo "=== health ==="
curl -s -o /dev/null -w 'health=%{http_code}\n' --max-time 5 "http://127.0.0.1:3010/health"
curl -s -o /dev/null -w 'ready=%{http_code}\n' --max-time 5 "http://127.0.0.1:3010/ready"

echo "=== index.html referenced assets ==="
grep -o '/lanqi-test/assets/[^"]*' "$APP/apps/web/dist/index.html"

echo "=== dist assets (lanqi) ==="
ls -la "$APP/apps/web/dist/assets" | grep -i 'lanqi' | awk '{print $6, $7, $8, $9}'

echo "=== newest dist assets (top 12 by mtime) ==="
ls -lt "$APP/apps/web/dist/assets" | head -13 | awk '{print $6, $7, $8, $9}'

echo "=== dist index.html mtime ==="
stat -c '%y %n' "$APP/apps/web/dist/index.html"

echo "=== dist api server.js mtime ==="
stat -c '%y %n' "$APP/apps/api/dist/apps/api/src/server.js"

echo "=== dist lanqi routes present ==="
ls "$APP/apps/api/dist/apps/api/src/products/lanqi/" 2>&1

echo "=== src/dist runtime data ==="
sha256sum "$APP/apps/api/src/data/marketplace-v3.json" "$APP/apps/api/dist/apps/api/src/data/marketplace-v3.json"

echo "=== direct-test-login env ==="
sudo grep -E '^(DIRECT_TEST_LOGIN|VITE_BASE_PATH|DATA_MODE|NODE_ENV)=' /etc/baolu-secrets/baolu-os-v2-test.env
