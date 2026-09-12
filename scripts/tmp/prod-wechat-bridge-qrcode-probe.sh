#!/usr/bin/env bash
# 生产只读探针（不进发布包）：验证 /auth/wechat-bridge/qrcode 的正例与三类负例。
# 只读取接口与生成二维码，不建号、不写任何数据。
set -uo pipefail

PORT="${1:-3002}"
HOSTHDR="${2:-api.lcppch.top}"
BASE="https://${HOSTHDR}/os-v2"
H=(-H "Host: ${HOSTHDR}")

S="$(curl -s -X POST "http://127.0.0.1:${PORT}/auth/wechat-bridge/session" \
  -H 'Content-Type: application/json' --data-binary '{"origin":"'"${BASE}"'"}')"
echo "session=${S}"
ID="$(printf '%s' "$S" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
SEC="$(printf '%s' "$S" | sed -n 's/.*"secret":"\([^"]*\)".*/\1/p')"
if [ -z "$ID" ] || [ -z "$SEC" ]; then echo "FAILED to create session"; exit 1; fi

echo "--- same origin (expect 200 + image/svg+xml) ---"
curl -s -o /tmp/probe-qr.svg -w 'self=%{http_code} type=%{content_type}\n' "${H[@]}" \
  --get --data-urlencode "u=${BASE}/wechat-bridge?b=${ID}&s=${SEC}" \
  "http://127.0.0.1:${PORT}/auth/wechat-bridge/qrcode"
head -c 120 /tmp/probe-qr.svg; echo

echo "--- external host (expect 400 invalid_qrcode_target) ---"
curl -s -w '\nevil=%{http_code}\n' "${H[@]}" \
  --get --data-urlencode "u=https://evil.example/wechat-bridge?b=${ID}&s=${SEC}" \
  "http://127.0.0.1:${PORT}/auth/wechat-bridge/qrcode"

echo "--- non-http scheme (expect 400) ---"
curl -s -o /dev/null -w 'javascript=%{http_code}\n' "${H[@]}" \
  --get --data-urlencode "u=javascript:alert(1)" \
  "http://127.0.0.1:${PORT}/auth/wechat-bridge/qrcode"

echo "--- bogus session on real host (expect 404/410) ---"
curl -s -w '\nbogus=%{http_code}\n' "${H[@]}" \
  --get --data-urlencode "u=${BASE}/wechat-bridge?b=nope&s=nope" \
  "http://127.0.0.1:${PORT}/auth/wechat-bridge/qrcode"
