#!/usr/bin/env bash
# 只读侦察：生产 lanqi 授权现状（不改任何数据）
# 用法：ssh -i <key> admin@api.lcppch.top "bash -s" < scripts/tmp/prod-lanqi-entitlement-recon.sh
set -euo pipefail
cd /tmp
run() {
  echo "----- $1"
  sudo -u postgres psql -d baolu_os_v2 -X -P pager=off -c "$2"
}

run "1. 名称含兰琪的租户" \
  'select t.id, t.name, t.industry, t."createdAt" from "Tenant" t where t.name like '"'"'%兰琪%'"'"' order by t."createdAt";'

run "2. 上述租户的产品授权明细" \
  'select e."tenantId", t.name, e."productCode", e.status, e.source, e."startsAt", e."expiresAt" from "TenantProductEntitlement" e join "Tenant" t on t.id = e."tenantId" where t.name like '"'"'%兰琪%'"'"' order by t.name, e."productCode";'

run "3. 带兰琪业务数据的租户（门店档案 / 朋友圈草稿 / 目标）" \
  'select '"'"'LanqiStoreProfile'"'"' as src, "tenantId" from "LanqiStoreProfile" union all select '"'"'LanqiMomentDraft'"'"', "tenantId" from "LanqiMomentDraft" union all select '"'"'LanqiStoreGoal'"'"', "tenantId" from "LanqiStoreGoal";'

run "4. 全库产品授权分布" \
  'select "productCode", status, count(*) from "TenantProductEntitlement" group by 1, 2 order by 1, 2;'

run "5. 兰琪租户的 owner 成员" \
  'select m."tenantId", m."userId", m.role, u."nickname", u."createdAt" from "Membership" m join "Tenant" t on t.id = m."tenantId" left join "User" u on u.id = m."userId" where t.name like '"'"'%兰琪%'"'"' order by t."createdAt";'

run "6. 兰琪租户的 Agent 授权分布" \
  'select a."tenantId", a."agentId", a.status, a."expiresAt" from "TenantAgentEntitlement" a join "Tenant" t on t.id = a."tenantId" where t.name like '"'"'%兰琪%'"'"' order by a."tenantId", a."agentId";'

run "7. 是否存在 productCode=lanqi 的邀请码 / 推荐码" \
  'select count(*) as lanqi_invite_codes from "InviteCode" where "productCode" = '"'"'lanqi'"'"';'

run "8. 全库 Tenant / User 规模" \
  'select (select count(*) from "Tenant") as tenants, (select count(*) from "User") as users, (select count(*) from "TenantProductEntitlement") as entitlements;'
