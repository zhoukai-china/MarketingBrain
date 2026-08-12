#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/baolu-os-v2"
ARCHIVE="/home/admin/baolu-os-v2-ai-recording-prebuilt-20260811.tgz"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="/home/admin/baolu-os-v2-ai-recording-prebuilt-backup-${STAMP}.tgz"

cd "$APP_DIR"
tar -czf "$BACKUP" \
  package.json \
  apps/api/src/services/getnote-connector.ts \
  apps/api/src/routes/knowledge-base.ts \
  apps/api/src/services/agent-definitions.ts \
  apps/api/src/routes/chat.ts \
  apps/api/dist \
  apps/web/src/components/acquisition/TopicSystemWorkbench.tsx \
  apps/web/src/data/ipAcquisitionAgent.ts \
  apps/web/src/pages/AgentProductsApp.tsx \
  apps/web/dist \
  packages/agent/src/index.ts \
  packages/agent/evals/today-core-skills-cases.json \
  packages/agent/dist \
  packages/shared/dist \
  packages/db/dist \
  packages/dashboard/dist \
  packages/skills/dist \
  packages/skills/skills/baolu_topics/prompt.md \
  packages/skills/skills/baolu_topics/examples/sample-grade.md \
  packages/skills/skills/baolu_topics/examples/00-workbuddy-golden-topic-inspiration.md \
  scripts/verify-topic-inspiration.ts

rollback() {
  echo "Deploy failed; restoring $BACKUP" >&2
  tar -xzf "$BACKUP" -C "$APP_DIR"
  sudo systemctl restart baolu-os-v2
}
trap rollback ERR

tar -xzf "$ARCHIVE" -C "$APP_DIR"
test -f apps/web/dist/index.html
test -f apps/api/dist/apps/api/src/server.js
sudo systemctl restart baolu-os-v2
sleep 10
systemctl is-active --quiet baolu-os-v2
curl --fail --silent --show-error http://127.0.0.1:3002/health >/dev/null
trap - ERR

echo "Prebuilt release successful. Backup retained at $BACKUP"
