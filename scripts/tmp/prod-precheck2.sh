#!/usr/bin/env bash
# 只读预检 2：路径类 env、nginx 对 app 目录的其它引用、DB 备份可行性、变更点确认
set -uo pipefail
APP=/opt/baolu-os-v2
ENVF=/etc/baolu-secrets/baolu-os-v2.env

echo "== path-like env values =="
sudo grep -E '^(WECHAT_PAY_PRIVATE_KEY_FILE|ORIGINAL_SKILL_ROOT|UPLOAD_DIR|SKILL_MCP_URL|WECHAT_SERVICE_ACTION_URL|VITE_BASE_PATH|VITE_API_BASE_URL|DATABASE_URL)=' "$ENVF" | sed 's#\(://[^:]*:\)[^@]*@#\1***@#'

echo "== nginx full references to app dir =="
sudo grep -n "/opt/baolu-os-v2" /etc/nginx/conf.d/*.conf 2>/dev/null | grep -v '^[[:space:]]*#'

echo "== other references to app dir on host =="
sudo grep -rn "/opt/baolu-os-v2" /etc/systemd/system /etc/cron.d /etc/crontab 2>/dev/null | head -20
sudo ls -1 /etc/systemd/system | grep -i baolu

echo "== app dir subtree sizes =="
du -sh "$APP"/* 2>/dev/null | sort -h | tail -12

echo "== db =="
DB_URL="$(sudo sed -n 's/^DATABASE_URL=//p' "$ENVF")"
psql "${DB_URL%%\?*}" -c "select current_database(), pg_size_pretty(pg_database_size(current_database()));" 2>&1 | head -5
psql "${DB_URL%%\?*}" -c "select migration_name, finished_at is not null as applied from _prisma_migrations order by migration_name desc limit 5;" 2>&1 | head -10
command -v pg_dump || echo "pg_dump NOT FOUND"

echo "== 变更点确认 =="
sudo test -e "$APP/apps/api/src/data" && echo "prod src/data EXISTS" || echo "prod src/data ABSENT (需新增)"
sudo test -e "$APP/apps/api/scripts" && echo "prod apps/api/scripts EXISTS" || echo "prod apps/api/scripts ABSENT (需新增)"
sudo test -d "$APP/mcp-skills/skills" && echo "prod mcp-skills/skills ok: $(find "$APP/mcp-skills/skills" -maxdepth 1 -mindepth 1 -type d | wc -l) skills" || echo "prod mcp-skills/skills MISSING"
sudo test -d "$APP/mcp-skills/candidates" && echo "prod mcp-skills/candidates: $(find "$APP/mcp-skills/candidates" -maxdepth 1 -mindepth 1 | wc -l) entries" || echo "prod mcp-skills/candidates absent"

echo "== web dist 顶层文件 =="
find "$APP/apps/web/dist" -maxdepth 1 -type f -printf '%s %f\n' | sort -n
