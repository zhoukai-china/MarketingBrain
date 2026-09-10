#!/usr/bin/env bash
# 部署后只读验收：服务健康、货架内容、dist 运行时数据、前端产物。
set -uo pipefail
APP=/opt/baolu-os-v2-test
PORT=3010

echo "=== service ==="
systemctl show baolu-os-v2-test -p ActiveState -p SubState -p MainPID

echo "=== health ==="
curl -s -o /dev/null -w 'health=%{http_code}\n' --max-time 5 "http://127.0.0.1:${PORT}/health"
curl -s -o /dev/null -w 'ready=%{http_code}\n' --max-time 5 "http://127.0.0.1:${PORT}/ready"

echo "=== skus ==="
curl -s --max-time 10 "http://127.0.0.1:${PORT}/market/skus" > /tmp/skus-now.json
echo -n "coming_soon_count="; grep -o 'coming_soon' /tmp/skus-now.json | wc -l
echo -n "has_lanqi_brain="; grep -c 'lanqi__lanqi-brain' /tmp/skus-now.json
echo -n "has_ip_pos="; grep -c 'ip-pos' /tmp/skus-now.json

echo "=== zones ==="
curl -s --max-time 10 "http://127.0.0.1:${PORT}/market/zones" | head -c 600
echo

echo "=== runtime data in dist ==="
sha256sum "$APP/apps/api/src/data/marketplace-v3.json" "$APP/apps/api/dist/apps/api/src/data/marketplace-v3.json" 2>&1

echo "=== web bundle markers ==="
echo -n "login-lanqi-bundles="; grep -rl 'login/lanqi' "$APP/apps/web/dist/assets" | wc -l
echo -n "yuan-approx="; grep -rl '≈ ¥' "$APP/apps/web/dist/assets" | wc -l
echo -n "base-path-assets="; grep -o '/lanqi-test/assets/[^"]*' "$APP/apps/web/dist/index.html" | head -2 | tr '\n' ' '
echo

echo "=== deployed source markers ==="
grep -n 'DIRECT_TEST_LOGIN_ENABLED &&' "$APP/apps/web/src/main.tsx" | head -3
grep -c 'login/lanqi' "$APP/apps/web/src/pages/LanqiMomentsPage.tsx"
