#!/usr/bin/env bash
# Create a single-use QA invite code for the production signup acceptance run.
set -euo pipefail
cd /opt/baolu-os-v2
set -a
. /etc/baolu-secrets/baolu-os-v2.env
set +a
node scripts/create-beta-invite.mjs \
  --code "${QA_INVITE_CODE:?QA_INVITE_CODE required}" \
  --label "QA注册验收（临时，跑完作废）" \
  --plan local_standard \
  --max-uses 1 \
  --created-by script:qa-signup-acceptance
