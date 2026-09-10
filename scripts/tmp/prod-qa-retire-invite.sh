#!/usr/bin/env bash
# Retire the temporary QA invite code after acceptance (QA-only artifact, reversible).
set -euo pipefail
cd /tmp
sudo -u postgres psql -d baolu_os_v2 -X -P pager=off -c \
  "update \"InviteCode\" set \"isActive\" = false where id = 'cmtve7g3g0000z9gftrhc7qvp';"
sudo -u postgres psql -d baolu_os_v2 -X -P pager=off -c \
  "select id, \"codePreview\", \"usedCount\", \"maxUses\", \"isActive\" from \"InviteCode\" where \"codePreview\" = 'qa****01';"
