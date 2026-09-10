#!/usr/bin/env bash
# 只读：确认新注册账号的用户级钱包（Wallet）是否有欢迎积分
# 用法：在仓库根 (Get-Content scripts/tmp/prod-qa-wallet-recon.sh -Raw) -replace "`r","" | ssh -i <key> admin@api.lcppch.top "bash -s"
set -euo pipefail
cd /tmp
run() {
  echo "----- $1"
  sudo -u postgres psql -d baolu_os_v2 -X -P pager=off -c "$2"
}

run "Wallet 最近 8 条（按创建时间）" \
  'select w."userId", w."paidBalance", w."bonusBalance", w."createdAt", u."nickname" from "Wallet" w left join "User" u on u.id = w."userId" order by w."createdAt" desc limit 8;'

run "今日本轮 QA 工作区自有 Wallet 汇总（tenant 名为 QA注册验收）" \
  'select t.id as tenant_id, t.name, m."userId", w."paidBalance", w."bonusBalance", ca.balance as credit_account_balance
     from "Tenant" t
     join "Membership" m on m."tenantId" = t.id and m.role = '"'"'owner'"'"'
     left join "CreditAccount" ca on ca."tenantId" = t.id
     left join "Wallet" w on w."userId" = m."userId"
    where t.name like '"'"'QA注册验收%'"'"'
    order by t."createdAt" desc;'

run "WalletLedger 最近 8 条" \
  'select "userId", delta, bucket, type, source, "createdAt" from "WalletLedger" order by "createdAt" desc limit 8;'

run "WalletLedger 总量 + 按 type 分组" \
  'select type, count(*) from "WalletLedger" group by type order by 2 desc;'

run "兰琪美业相关租户（对照：老租户余额来源）" \
  'select t.id as tenant_id, t.name, m."userId", ca.balance as credit_account_balance, w."paidBalance", w."bonusBalance"
     from "Tenant" t
     left join "Membership" m on m."tenantId" = t.id and m.role = '"'"'owner'"'"'
     left join "CreditAccount" ca on ca."tenantId" = t.id
     left join "Wallet" w on w."userId" = m."userId"
    where t.name like '"'"'%兰琪%'"'"'
    order by t."createdAt" desc limit 10;'
