#!/usr/bin/env bash
# 只读检查 TEST/PROD 的迁移与关键表状态。
set -uo pipefail
cd /tmp

echo "=== TEST schema (lanqi_test) migrations ==="
sudo -u postgres psql -d baolu_os_v2 -At -c \
  "select migration_name || ' ' || coalesce(to_char(finished_at,'YYYY-MM-DD\"T\"HH24:MI:SS'),'PENDING') from lanqi_test._prisma_migrations order by migration_name desc limit 6;" 2>/dev/null

echo "=== PROD schema (public) migrations ==="
sudo -u postgres psql -d baolu_os_v2 -At -c \
  "select migration_name || ' ' || coalesce(to_char(finished_at,'YYYY-MM-DD\"T\"HH24:MI:SS'),'PENDING') from public._prisma_migrations order by migration_name desc limit 6;" 2>/dev/null

echo "=== PROD key tables ==="
sudo -u postgres psql -d baolu_os_v2 -At -c \
  "select 'LanqiStoreGoal=' || (to_regclass('public.\"LanqiStoreGoal\"') is not null)::text || ' LanqiMomentDraft=' || (to_regclass('public.\"LanqiMomentDraft\"') is not null)::text || ' Wallet=' || (to_regclass('public.\"Wallet\"') is not null)::text;" 2>/dev/null

echo "=== TEST key tables ==="
sudo -u postgres psql -d baolu_os_v2 -At -c \
  "select 'LanqiStoreGoal=' || (to_regclass('lanqi_test.\"LanqiStoreGoal\"') is not null)::text || ' LanqiMomentDraft=' || (to_regclass('lanqi_test.\"LanqiMomentDraft\"') is not null)::text;" 2>/dev/null

echo "=== TEST env (masked) ==="
sudo grep -E '^(NODE_ENV|DATA_MODE|INVITE_REQUIRED|DIRECT_TEST_LOGIN|VITE_DIRECT_TEST_LOGIN|VITE_BASE_PATH|UPLOAD_DIR|PORT)=' /etc/baolu-secrets/baolu-os-v2-test.env

echo "=== PROD env (masked) ==="
sudo grep -E '^(NODE_ENV|DATA_MODE|INVITE_REQUIRED|DIRECT_TEST_LOGIN|VITE_DIRECT_TEST_LOGIN|VITE_BASE_PATH|UPLOAD_DIR|PORT)=' /etc/baolu-secrets/baolu-os-v2.env

echo "=== PROD db name in DATABASE_URL ==="
sudo grep -E '^DATABASE_URL=' /etc/baolu-secrets/baolu-os-v2.env | sed -E 's#://[^@]*@#://***@#'

echo "=== TEST db name in DATABASE_URL ==="
sudo grep -E '^DATABASE_URL=' /etc/baolu-secrets/baolu-os-v2-test.env | sed -E 's#://[^@]*@#://***@#'

echo "=== stage dirs ==="
ls -1 /opt/baolu-stage/ 2>/dev/null | tail -3
