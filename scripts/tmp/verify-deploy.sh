#!/usr/bin/env bash
# 发布后校验：产物一致性 + API 契约 + 货架内容
# 用法: verify-deploy.sh <app-dir> <service> <port> <web-url> <api-base> <expected-vite-base>
set -uo pipefail

APP="${1:?app dir}"
SERVICE="${2:?service}"
PORT="${3:?port}"
WEB_URL="${4:?web url}"
API_BASE="${5:?api base}"
VITE_BASE="${6:?vite base}"
FAIL=0
chk() { # chk <name> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "PASS  $1 = $3"; else echo "FAIL  $1 expected=$2 actual=$3"; FAIL=1; fi
}

echo "== service =="
chk "systemd_active" "active" "$(systemctl is-active "$SERVICE")"
chk "health" "200" "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/health")"
chk "ready" "200" "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/ready")"

echo "== runtime data (P1 fix) =="
SRC="$(sha256sum "$APP/apps/api/src/data/marketplace-v3.json" | awk '{print $1}')"
DIST="$(sha256sum "$APP/apps/api/dist/apps/api/src/data/marketplace-v3.json" | awk '{print $1}')"
chk "src_data_sha" "2eec39bd3ea2b9821d8ad8113c63123c580e0f72f0063fe06890feb9553752e4" "$SRC"
chk "dist_data_matches_src" "$SRC" "$DIST"

echo "== web build =="
chk "index_base_path" "${VITE_BASE}" "$(grep -o "${VITE_BASE}" "$APP/apps/web/dist/index.html" | head -1)"
chk "web_credits_yuan_copy" "yes" "$(grep -rql '≈ ¥' "$APP/apps/web/dist/assets" && echo yes || echo no)"
chk "web_coming_soon_copy" "yes" "$(grep -rql '开发中' "$APP/apps/web/dist/assets" && echo yes || echo no)"
chk "web_free_redo_copy" "yes" "$(grep -rql '重做' "$APP/apps/web/dist/assets" && echo yes || echo no)"

echo "== public endpoint =="
chk "public_web" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$WEB_URL")"
chk "public_market_skus" "200" "$(curl -s -o /dev/null -w '%{http_code}' "${API_BASE}market/skus")"

echo "== marketplace contract =="
curl -s "${API_BASE}market/skus" -o /tmp/verify-skus.json
if python3 <<'PY'
import json
try:
    d = json.load(open('/tmp/verify-skus.json'))
    skus = d.get('skus') or d.get('data') or d
    if isinstance(skus, dict):
        skus = skus.get('skus') or skus.get('items') or []
    codes = [s.get('skuCode') or s.get('id') for s in skus]
    coming = [s for s in skus if s.get('status') == 'coming_soon']
    print(f"PASS  skus_total = {len(skus)}")
    print(f"PASS  coming_soon = {len(coming)}")
    hit = 'lanqi__lanqi-brain' in codes
    if not hit:
        raise SystemExit('lanqi__lanqi-brain missing')
    print("PASS  lanqi_brain_present = True")
    zones = set()
    for s in skus:
        z = s.get('zone') or s.get('category')
        if z: zones.add(str(z))
    print(f"INFO  zones = {sorted(zones)}")
except Exception as e:
    print(f"FAIL  market/skus parse error: {e}")
    raise SystemExit(1)
PY
then echo "PASS  marketplace contract"; else FAIL=1; echo "FAIL  marketplace contract"; fi

echo
if [ "$FAIL" -eq 0 ]; then echo "VERIFY_OK"; else echo "VERIFY_FAILED"; fi
exit "$FAIL"
