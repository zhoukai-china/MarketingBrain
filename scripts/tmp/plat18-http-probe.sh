#!/usr/bin/env bash
# PLAT-18: read-only HTTP status probe for the platform roots (documents the 302 vs 200 shape).
set -u
for u in https://api.lcppch.top/lanqi-test https://api.lcppch.top/lanqi-test/ https://api.lcppch.top/os-v2 https://api.lcppch.top/os-v2/; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$u")"
  loc="$(curl -s -o /dev/null -D - "$u" | grep -i '^location:' | tr -d '\r' | head -n 1)"
  printf '%s -> %s %s\n' "$u" "$code" "$loc"
done
for u in https://api.lcppch.top/lanqi-test/legacy-diagnosis https://api.lcppch.top/os-v2/legacy-diagnosis; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$u")"
  printf '%s -> %s\n' "$u" "$code"
done
