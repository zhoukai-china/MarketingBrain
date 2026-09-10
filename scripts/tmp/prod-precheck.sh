#!/usr/bin/env bash
# 只读预检：PROD /opt/baolu-os-v2 当前状态（不修改任何文件）
set -uo pipefail
APP=/opt/baolu-os-v2
SVC=baolu-os-v2
ENVF=/etc/baolu-secrets/baolu-os-v2.env

echo "== service =="
systemctl is-active "$SVC"; systemctl show "$SVC" -p ExecStart -p WorkingDirectory -p User -p MainPID

echo "== app root =="
readlink -f "$APP"; stat -c '%U:%G %a %n' "$APP"
ls -1 "$APP"
du -sh "$APP" "$APP/node_modules" "$APP/apps/web/dist" "$APP/uploads" 2>/dev/null

echo "== node_modules ownership =="
stat -c '%U:%G %a %n' "$APP/node_modules"
find "$APP" -maxdepth 3 -name node_modules -printf '%u:%g %p\n' 2>/dev/null | head -20

echo "== routes src vs dist =="
echo "src ts: $(find "$APP/apps/api/src/routes" -maxdepth 1 -name '*.ts' | wc -l)"
echo "dist js: $(find "$APP/apps/api/dist/apps/api/src/routes" -maxdepth 1 -name '*.js' 2>/dev/null | wc -l)"
comm -13 <(find "$APP/apps/api/src/routes" -maxdepth 1 -name '*.ts' -printf '%f\n' | sed 's/\.ts$//' | sort) \
         <(find "$APP/apps/api/dist/apps/api/src/routes" -maxdepth 1 -name '*.js' -printf '%f\n' 2>/dev/null | sed 's/\.js$//' | sort) | tr '\n' ' '
echo

echo "== web dist =="
test -f "$APP/apps/web/dist/skill_key.html" && echo "skill_key.html: present $(stat -c %s "$APP/apps/web/dist/skill_key.html")" || echo "skill_key.html: MISSING"
echo "assets: $(find "$APP/apps/web/dist/assets" -type f 2>/dev/null | wc -l)"
grep -o '/os-v2/assets/[^"]*' "$APP/apps/web/dist/index.html" | head -3
echo "index base lines:"; grep -c '%BASE_URL%' "$APP/apps/web/dist/index.html"

echo "== nginx =="
sudo grep -rn "skill_key\|os-v2" /etc/nginx/conf.d/*.conf 2>/dev/null | grep -v '^\s*#' | head -20

echo "== runtime data (货架旧数据证据) =="
sha256sum "$APP/apps/api/src/data/marketplace-v3.json" 2>/dev/null || echo "src/data missing"
sha256sum "$APP/apps/api/dist/apps/api/src/data/marketplace-v3.json" 2>/dev/null || echo "dist data missing"

echo "== migrations dir =="
ls -1 "$APP/packages/db/prisma/migrations" 2>/dev/null | tail -6

echo "== env file keys (值不打印) =="
sudo sed -n 's/^\([A-Z0-9_]*\)=.*/\1/p' "$ENVF" | sort | tr '\n' ' '
echo

echo "== node/pnpm =="
node -v; (cd "$APP" && pnpm -v)

echo "== live probes =="
curl -fsS --max-time 5 http://127.0.0.1:3002/health; echo
curl -fsS --max-time 5 http://127.0.0.1:3002/ready; echo
curl -fsS --max-time 5 http://127.0.0.1:3002/mcp/status | head -c 300; echo
echo "coming_soon in /market/skus: $(curl -fsS --max-time 10 http://127.0.0.1:3002/market/skus | grep -o 'coming_soon' | wc -l)"
echo "lanqi-brain in /market/skus: $(curl -fsS --max-time 10 http://127.0.0.1:3002/market/skus | grep -c 'lanqi__lanqi-brain')"

echo "== disk / stage =="
df -h / | tail -1
ls -1d /opt/baolu-stage /opt/baolu-backups 2>/dev/null
ls -1 /opt/baolu-backups 2>/dev/null | tail -5
