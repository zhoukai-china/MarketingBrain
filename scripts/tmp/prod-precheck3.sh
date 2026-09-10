#!/usr/bin/env bash
set -uo pipefail
APP=/opt/baolu-os-v2
echo "== web dist top-level files =="
find "$APP/apps/web/dist" -maxdepth 1 -type f -printf '%s %f\n'
echo "== web dist top-level dirs =="
find "$APP/apps/web/dist" -maxdepth 1 -mindepth 1 -type d -printf '%f\n'
echo "== all dist dirs (非 node_modules) =="
sudo find "$APP" -maxdepth 3 -name dist -type d -not -path '*/node_modules/*' -printf '%p\n'
echo "== prod scripts 清单 =="
sudo ls -1 "$APP/scripts"
echo "== prod mcp-skills/skills 目录名 =="
sudo ls -1 "$APP/mcp-skills/skills" | tr '\n' ' '
echo
echo "== timers =="
systemctl list-timers --all 2>/dev/null | grep -i baolu
