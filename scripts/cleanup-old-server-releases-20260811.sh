#!/usr/bin/env bash
set -euo pipefail

KEEP_OPT="/opt/baolu-os-v2-backup-20260811-134303"
KEEP_HOME="/home/admin/baolu-os-v2-ai-recording-prebuilt-backup-20260811-143635.tgz"

mapfile -t old_dirs < <(find /opt -maxdepth 1 \( -name 'baolu-os-v2-backup-*' -o -name 'baolu-os-v2-failed-*' \) ! -path "$KEEP_OPT" -print)
for candidate in "${old_dirs[@]}"; do
  resolved="$(realpath -- "$candidate")"
  case "$resolved" in
    /opt/baolu-os-v2-backup-*|/opt/baolu-os-v2-failed-*) ;;
    *) echo "Refusing unexpected cleanup target: $resolved" >&2; exit 1 ;;
  esac
done

for candidate in "${old_dirs[@]}"; do
  sudo rm -rf -- "$candidate"
done

# This file is an incomplete archive accidentally created by an old tar command.
if [[ -f /home/admin/-C ]]; then
  rm -f -- /home/admin/-C
fi

# Remove only deployment inputs created by this release. The latest compact
# rollback archive remains available at KEEP_HOME.
rm -f -- \
  /home/admin/baolu-os-v2-ai-recording-overlay-20260811.tgz \
  /home/admin/baolu-os-v2-ai-recording-prebuilt-20260811.tgz \
  /home/admin/baolu-os-v2-ai-recording-backup-20260811-143139.tgz

test -d /opt/baolu-os-v2
test -d "$KEEP_OPT"
test -f "$KEEP_HOME"
systemctl is-active --quiet baolu-os-v2
curl --fail --silent --show-error http://127.0.0.1:3002/health >/dev/null
df -h /
