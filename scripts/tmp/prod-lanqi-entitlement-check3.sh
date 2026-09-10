#!/usr/bin/env bash
# 只读排查：lanqi entitlement 的创建时间与全库分布（不改任何数据）
set -uo pipefail

echo "----- A. lanqi entitlement 完整行（含 createdAt/updatedAt）"
sudo -u postgres psql -d baolu_os_v2 -X -P pager=off <<'SQL'
select id, "tenantId", "productCode", status, source, "startsAt", "expiresAt", "createdAt", "updatedAt"
from "TenantProductEntitlement"
where "productCode" = 'lanqi'
order by "createdAt";
SQL

echo "----- B. 全库产品授权分布（重跑，与上次 recon 对照）"
sudo -u postgres psql -d baolu_os_v2 -X -P pager=off <<'SQL'
select "productCode", status, count(*) from "TenantProductEntitlement" group by 1,2 order by 1,2;
SQL

echo "----- C. 总条数与当前时间"
sudo -u postgres psql -d baolu_os_v2 -X -P pager=off <<'SQL'
select now() as db_now, (select count(*) from "TenantProductEntitlement") as entitlements;
SQL

echo "----- D. 最近 10 分钟内改动的 entitlement"
sudo -u postgres psql -d baolu_os_v2 -X -P pager=off <<'SQL'
select "tenantId", "productCode", status, source, "createdAt", "updatedAt"
from "TenantProductEntitlement"
where greatest("createdAt","updatedAt") > now() - interval '20 minutes'
order by "updatedAt" desc;
SQL

echo "----- E. 服务器上是否有其它脚本/会话痕迹（最近 20 分钟 /tmp 与 bash_history 摘要）"
ls -lt --time-style=full-iso /tmp 2>/dev/null | head -20
echo "-- postgres 最近活动连接（当前）"
sudo -u postgres psql -d baolu_os_v2 -X -P pager=off -c "select pid, application_name, client_addr, backend_start, query_start, left(query,80) as q from pg_stat_activity where datname='baolu_os_v2' order by backend_start desc limit 10;"
