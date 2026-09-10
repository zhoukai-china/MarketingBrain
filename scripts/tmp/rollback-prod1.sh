#!/usr/bin/env bash
# 回滚 20260910-credits-yuan-free-redo-prod1：还原发布前源码/dist，并删除本次新增的文件。
set -euo pipefail

REL="20260910-credits-yuan-free-redo-prod1"
APP="/opt/baolu-os-v2"
BACKUP="/opt/baolu-backups/${REL}-before"

case "$BACKUP" in /opt/baolu-backups/*) ;; *) echo "unexpected BACKUP=$BACKUP"; exit 1 ;; esac
test -f "$BACKUP/app-before.tar.gz"

sudo systemctl stop baolu-os-v2
sudo tar xzf "$BACKUP/app-before.tar.gz" -C "$APP"
if [ -s "$BACKUP/new-files.txt" ]; then
  while IFS= read -r f; do
    case "$APP/$f" in "$APP"/*) sudo rm -f "$APP/$f" ;; *) echo "skip $f" ;; esac
  done < "$BACKUP/new-files.txt"
fi
sudo systemctl start baolu-os-v2
sleep 6
systemctl is-active baolu-os-v2
curl -fsS -o /dev/null -w 'health=%{http_code}\n' http://127.0.0.1:3002/health
echo "ROLLBACK_DONE ${REL}"
