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
# 容错：调用方经常漏掉结尾斜杠（2026-09-12 生产校验即因此把 /os-v2/api 拼成
# /os-v2/apimarket/skus，落回 SPA index.html，误报「market/skus parse error」）。
API_BASE="${API_BASE%/}/"
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
chk "src_data_sha" "1dd5b672eea8841a36c624bf08b8b191fa2f55a54c3d246c9740cabbe30f12c0" "$SRC"
chk "dist_data_matches_src" "$SRC" "$DIST"

echo "== web build =="
chk "index_base_path" "${VITE_BASE}" "$(grep -o "${VITE_BASE}" "$APP/apps/web/dist/index.html" | head -1)"
# PLAT-19（2026-09-12）：客户界面只显示积分，不再显示折算人民币。
# 断言必须只看「浏览器真正会加载的产物」。`/opt/baolu-*` 的发布是只叠加不删除，
# dist/assets 会一直累积历史构建（2026-09-12 实测 53 个在链 / 2253 个历史，
# 123.8 MB），全目录 grep 会把早已下线的旧文案当成当前问题。
# 这里从 index.html 出发走一遍 import 图（html -> js/css -> 动态 chunk），
# 得到的集合就是真实浏览器请求集。构建垃圾的回收见 scripts/gc-web-dist-assets.sh。
WEB_COPY="$(python3 - "$APP/apps/web/dist" <<'PY'
import os, re, sys
base = sys.argv[1]
assets = os.path.join(base, "assets")
result = {"rmb": "no", "credits": "no", "coming": "no", "redo": "no", "count": "0"}
try:
    index = open(os.path.join(base, "index.html"), encoding="utf-8", errors="ignore").read()
except OSError:
    index = ""
reach = set(re.findall(r"assets/([A-Za-z0-9_.\-]+)", index))
queue = list(reach)
while queue:
    name = queue.pop()
    if not name.endswith((".js", ".css")):
        continue
    path = os.path.join(assets, name)
    if not os.path.exists(path):
        continue
    try:
        text = open(path, encoding="utf-8", errors="ignore").read()
    except OSError:
        continue
    for found in re.findall(r"assets/([A-Za-z0-9_.\-]+)", text):
        if found not in reach:
            reach.add(found)
            queue.append(found)
blob = []
for name in sorted(reach):
    if not name.endswith((".js", ".css")):
        continue
    path = os.path.join(assets, name)
    if not os.path.exists(path):
        continue
    blob.append(open(path, encoding="utf-8", errors="ignore").read())
text = "".join(blob)
result["rmb"] = "yes" if "≈ ¥" in text else "no"
result["credits"] = "yes" if "积分" in text else "no"
result["coming"] = "yes" if "开发中" in text else "no"
result["redo"] = "yes" if "重做" in text else "no"
result["count"] = str(len(reach))
for key in ("rmb", "credits", "coming", "redo", "count"):
    print("%s=%s" % (key, result[key]))
PY
)"
web_field() { echo "$WEB_COPY" | grep "^$1=" | head -1 | cut -d= -f2-; }
echo "INFO  web_assets_in_graph = $(web_field count)"
chk "web_credits_rmb_copy_absent" "no" "$(web_field rmb)"
chk "web_credits_copy" "yes" "$(web_field credits)"
chk "web_coming_soon_copy" "yes" "$(web_field coming)"
chk "web_free_redo_copy" "yes" "$(web_field redo)"

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
    # 开卖状态必须真的落到线上（QA-20260911-016）：库里已有 profile 行时，
    # 种子文件里的 ov.<skill>.status 会在「建行后不再覆盖 ov」的旧逻辑下被吞掉，
    # 表现为源码/产物哈希全对、线上仍是 coming_soon。这里直接断言货架状态。
    for code in ('ipzone__vidrev', 'meiye__vidrev'):
        row = next((s for s in skus if (s.get('skuCode') or s.get('id')) == code), None)
        if row is None:
            raise SystemExit('%s missing from /market/skus' % code)
        got = row.get('status')
        if got != 'selling':
            raise SystemExit('%s expected selling, got %s' % (code, got))
        print("PASS  %s_status = selling" % code)
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
