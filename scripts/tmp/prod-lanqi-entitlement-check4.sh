#!/usr/bin/env bash
# 只读：读回填 SQL 原文 + 选一个无 lanqi 授权的对照租户（不改任何数据）
set -uo pipefail

echo "----- A. /tmp/lq-ent-backfill-20260911.sql 原文"
sudo cat /tmp/lq-ent-backfill-20260911.sql 2>/dev/null || echo "(不可读)"

echo "----- B. 是否存在回填备份 / 回滚文件"
sudo ls -la /tmp | grep -iE 'lq|lanqi|ent' || echo "(无匹配)"
sudo ls -la /opt/baolu-backups 2>/dev/null | grep -iE 'lanqi|lq|0911' || echo "(backups 无匹配)"

echo "----- C. 对照租户：有一个 active founder-ip、但没有 lanqi 授权的租户 + 其 owner"
sudo -u postgres psql -d baolu_os_v2 -X -P pager=off <<'SQL'
select e."tenantId", t.name, e."productCode", m."userId", u.nickname
from "TenantProductEntitlement" e
join "Tenant" t on t.id = e."tenantId"
left join "Membership" m on m."tenantId" = e."tenantId" and m.role = 'owner'
left join "User" u on u.id = m."userId"
where e."productCode" = 'founder-ip' and e.status = 'active'
  and not exists (select 1 from "TenantProductEntitlement x" where x."tenantId" = e."tenantId" and x."productCode" = 'lanqi')
limit 3;
SQL

echo "----- D. 兰琪两租户当前 active 产品授权"
sudo -u postgres psql -d baolu_os_v2 -X -P pager=off <<'SQL'
select e."tenantId", t.name, e."productCode", e.status, e."expiresAt"
from "TenantProductEntitlement" e join "Tenant" t on t.id = e."tenantId"
where t.name like '%兰琪%' order by e."tenantId", e."productCode";
SQL
