#!/usr/bin/env bash
# Read-only schema inspection for invite code / user / tenant tables.
set -u
cd /tmp

for t in InviteCode User Tenant CreditAccount; do
  echo "=== COLUMNS: $t ==="
  sudo -u postgres psql -d baolu_os_v2 -X -P pager=off -c \
    "select column_name, data_type, is_nullable from information_schema.columns where table_name = '$t' order by ordinal_position;"
done

echo "=== TABLES LIKE invite ==="
sudo -u postgres psql -d baolu_os_v2 -X -P pager=off -c \
  "select table_name from information_schema.tables where table_schema='public' and table_name ilike '%invite%';"

echo "=== TABLES LIKE redemption/grant ==="
sudo -u postgres psql -d baolu_os_v2 -X -P pager=off -c \
  "select table_name from information_schema.tables where table_schema='public' and (table_name ilike '%redempt%' or table_name ilike '%grant%');"
