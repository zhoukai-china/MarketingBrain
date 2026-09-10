#!/usr/bin/env bash
# Read-only: welcome-credit config + credit account for the QA workspace.
set -u
cd /tmp

echo "=== NEW_USER_*_TRIAL_CREDITS in PROD env ==="
sudo grep -nE 'NEW_USER|TRIAL_CREDITS' /etc/baolu-secrets/baolu-os-v2.env || echo "(not set -> code default 300)"

echo "=== QA CREDIT ACCOUNTS ==="
sudo -u postgres psql -d baolu_os_v2 -X -P pager=off -c \
  "select c.id, c.\"tenantId\", c.balance, t.name, t.type from \"CreditAccount\" c join \"Tenant\" t on t.id = c.\"tenantId\" where t.name like 'QA注册验收%';"

echo "=== QA CREDIT TRANSACTIONS ==="
sudo -u postgres psql -d baolu_os_v2 -X -P pager=off -c \
  "select x.id, x.amount, x.direction, x.reason, t.name from \"CreditTransaction\" x join \"Tenant\" t on t.id = x.\"tenantId\" where t.name like 'QA注册验收%';"

echo "=== RECENTLY CREATED WORKSPACES (balance reference) ==="
sudo -u postgres psql -d baolu_os_v2 -X -P pager=off -c \
  "select t.name, t.type, c.balance from \"Tenant\" t left join \"CreditAccount\" c on c.\"tenantId\" = t.id order by t.\"createdAt\" desc limit 8;"
