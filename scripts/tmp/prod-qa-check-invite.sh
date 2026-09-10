#!/usr/bin/env bash
# Read-only check of the QA invite code and any QA workspace created by the acceptance run.
set -u
cd /tmp

echo "=== QA INVITE CODE ==="
sudo -u postgres psql -d baolu_os_v2 -X -P pager=off -c \
  "select id, \"codePreview\", label, \"planCode\", \"maxUses\", \"usedCount\", \"isActive\", \"lastUsedAt\" from \"InviteCode\" where \"codePreview\" = 'qa****01';"

echo "=== QA TENANTS ==="
sudo -u postgres psql -d baolu_os_v2 -X -P pager=off -c \
  "select id, name, industry, \"createdAt\" from \"Tenant\" where name like 'QA注册验收%' order by \"createdAt\" desc;"

echo "=== REDEMPTIONS FOR QA CODE ==="
sudo -u postgres psql -d baolu_os_v2 -X -P pager=off -c \
  "select r.* from \"InviteCodeRedemption\" r join \"InviteCode\" c on c.id = r.\"inviteCodeId\" where c.\"codePreview\" = 'qa****01';"

echo "=== TOTALS ==="
sudo -u postgres psql -d baolu_os_v2 -X -P pager=off -c \
  'select (select count(*) from "Tenant") as tenants, (select count(*) from "User") as users;'
