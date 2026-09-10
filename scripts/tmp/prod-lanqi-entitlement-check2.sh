#!/usr/bin/env bash
# 只读排查：生产 /lanqi/stores 竟然 200 的原因核对（不改任何数据）
# 用法：ssh -i <key> admin@api.lcppch.top "bash -s" < scripts/tmp/prod-lanqi-entitlement-check2.sh
set -uo pipefail

echo "----- A. 生产后端 env 的 DATABASE_URL / DATA_MODE"
sudo grep -nE '^(DATABASE_URL|DATA_MODE|NODE_ENV)=' /etc/baolu-secrets/baolu-os-v2.env | sed -E 's#(DATABASE_URL=postgresql://)[^@]*@#\1***@#'

echo "----- B. 直接查 lanqi 系列 entitlement（大小写/包含匹配）"
sudo -u postgres psql -d baolu_os_v2 -X -P pager=off <<'SQL'
select id, "tenantId", "productCode", status, source, "expiresAt"
from "TenantProductEntitlement"
where "productCode" ilike '%lanqi%';
SQL

echo "----- C. 部署产物 access-guards.js 中 requireProductEntitlement 的实现"
sed -n '20,70p' /opt/baolu-os-v2/apps/api/dist/apps/api/src/services/access-guards.js

echo "----- D. 部署产物里是否有别的 provider 分支（搜索 tenantProductEntitlement 引用）"
grep -rn "tenantProductEntitlement" /opt/baolu-os-v2/apps/api/dist/apps/api/src | head -20

echo "----- E. 服务运行时间 / 最近重启"
systemctl show baolu-os-v2 -p ActiveEnterTimestamp -p MainPID -p ExecMainStartTimestamp

echo "----- F. 本地直连 API（绕过 nginx）带身份头请求 /lanqi/stores"
TID=cmt6idd1c04v62hgb86gvh7pz
UID_=cmt6idd1g04v72hgbue4moh86
curl -s -o /dev/null -w "local /lanqi/stores -> %{http_code}\n" \
  -H "x-sitong-tenant-id: ${TID}" -H "x-sitong-user-id: ${UID_}" \
  http://127.0.0.1:3002/lanqi/stores
curl -s -o /dev/null -w "local /beauty-industry/stores -> %{http_code}\n" \
  -H "x-sitong-tenant-id: ${TID}" -H "x-sitong-user-id: ${UID_}" \
  http://127.0.0.1:3002/beauty-industry/stores
echo "----- G. 本地直连 API 返回体"
curl -s -H "x-sitong-tenant-id: ${TID}" -H "x-sitong-user-id: ${UID_}" \
  http://127.0.0.1:3002/lanqi/stores | head -c 400
echo
