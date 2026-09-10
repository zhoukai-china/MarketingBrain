#!/usr/bin/env bash
# Read-only reconnaissance for the production signup acceptance run.
set -u
cd /tmp

echo "=== INVITE CODES (latest 20) ==="
sudo -u postgres psql -d baolu_os_v2 -X -P pager=off -c \
  'select id, code, label, "planCode", "productCode", "isActive", "maxUses", "usedCount", "createdBy", "createdAt" from "InviteCode" order by "createdAt" desc limit 20;'

echo "=== TENANTS (latest 15) ==="
sudo -u postgres psql -d baolu_os_v2 -X -P pager=off -c \
  'select id, name, "createdAt" from "Tenant" order by "createdAt" desc limit 15;'

echo "=== USERS (latest 15) ==="
sudo -u postgres psql -d baolu_os_v2 -X -P pager=off -c \
  'select id, "tenantId", "openId", "createdAt" from "User" order by "createdAt" desc limit 15;'

echo "=== INVITE REDEMPTIONS (latest 10) ==="
sudo -u postgres psql -d baolu_os_v2 -X -P pager=off -c \
  'select * from "InviteRedemption" order by "redeemedAt" desc limit 10;' 2>&1 | head -30

echo "=== COUNTS ==="
sudo -u postgres psql -d baolu_os_v2 -X -P pager=off -c \
  'select (select count(*) from "Tenant") as tenants, (select count(*) from "User") as users, (select count(*) from "InviteCode") as invite_codes;'
