#!/usr/bin/env bash
# 微信「业务域名」校验文件部署（幂等，可在服务器上重复执行）。
#
# 目标：让 https://api.lcppch.top/MP_verify_<token>.txt **直接返回纯文本 token**
#   —— 不进后端（FastAPI）、不 302、不包 HTML。微信校验失败 90% 卡在这三点。
#
# 背景（2026-09-15）：公众号后台「业务域名」填了 api.lcppch.top，微信内打开 os-v2
#   会弹黄色安全提示；放好校验文件并在后台点「保存」后即长期不再提示。
#
# 用法：
#   bash /opt/baolu-ops/install-wechat-verify-file.sh                 # 默认 token QnYOQF6cJVSpRYvk
#   bash /opt/baolu-ops/install-wechat-verify-file.sh <新token>       # 以后换文件只改参数
#   DRY_RUN=1 bash /opt/baolu-ops/install-wechat-verify-file.sh       # 只打印计划
#
# 安全边界：只写 /var/www/wechat-verify/ 与 nginx 站点配置；改配置前自动备份，
#   `nginx -t` 失败自动回滚并报错退出；location 用正则匹配所有 MP_verify_*.txt，无需重复加。
set -uo pipefail

TOKEN="${1:-QnYOQF6cJVSpRYvk}"
VERIFY_ROOT="${VERIFY_ROOT:-/var/www/wechat-verify}"
NGINX_CONF="${NGINX_CONF:-/etc/nginx/conf.d/qiwx-bot.conf}"
SSL_LISTEN="listen 443 ssl;"
SERVER_NAME_LINE="server_name api.lcppch.top;"
DRY_RUN="${DRY_RUN:-0}"
PROBE_URL_BASE="${PROBE_URL_BASE:-https://api.lcppch.top}"
FILE="$VERIFY_ROOT/MP_verify_${TOKEN}.txt"

case "$TOKEN" in
  '' | *[!A-Za-z0-9]*) echo "token 必须是纯字母数字：$TOKEN" >&2; exit 2 ;;
esac
case "$PROBE_URL_BASE" in https://api.lcppch.top) ;; *) echo "unexpected PROBE_URL_BASE: $PROBE_URL_BASE" >&2; exit 2 ;; esac
[ -f "$NGINX_CONF" ] || { echo "missing $NGINX_CONF" >&2; exit 2; }
grep -q "$SSL_LISTEN" "$NGINX_CONF" || { echo "$NGINX_CONF 里找不到 443 server 块" >&2; exit 2; }

echo "token=$TOKEN"
echo "file=$FILE"
echo "nginx_conf=$NGINX_CONF"

if [ "$DRY_RUN" = "1" ]; then
  echo "DRY_RUN=1：将写校验文件，并把 MP_verify location 插入 443 server 块（若尚未存在），然后 nginx -t + reload + 线上探测。"
  exit 0
fi

if [ "$(id -u)" != "0" ]; then echo "请用 root 运行（sudo bash $0）" >&2; exit 1; fi

backup="$NGINX_CONF.bak-$(date +%Y%m%d-%H%M%S)-wechat-verify"
cp -a "$NGINX_CONF" "$backup"
echo "backup=$backup"

mkdir -p "$VERIFY_ROOT"
printf '%s' "$TOKEN" > "$FILE"
chmod 755 "$VERIFY_ROOT"
chmod 644 "$FILE"
echo "written $FILE bytes=$(wc -c < "$FILE") sha256=$(sha256sum "$FILE" | cut -d' ' -f1)"

python3 - "$NGINX_CONF" "$SSL_LISTEN" "$SERVER_NAME_LINE" <<'PY'
import sys

path, ssl_line, server_line = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path, encoding="utf-8").read()
if "MP_verify_" in text:
    print("nginx: MP_verify location 已存在，跳过插入")
    sys.exit(0)

lines = text.splitlines(keepends=True)
idx_ssl = next((i for i, l in enumerate(lines) if l.strip() == ssl_line), None)
if idx_ssl is None:
    sys.exit("nginx: 找不到 'listen 443 ssl;'")
idx_srv = next((i for i in range(idx_ssl, len(lines)) if lines[i].strip() == server_line), None)
if idx_srv is None:
    sys.exit("nginx: 443 块里找不到 server_name api.lcppch.top;")

block = [
    "\n",
    "    # 微信业务域名校验文件（由 scripts/ops/install-wechat-verify-file.sh 维护；勿改成 proxy_pass/302）\n",
    "    location ~ ^/MP_verify_[\\w]+\\.txt$ {\n",
    "        default_type text/plain;\n",
    "        root /var/www/wechat-verify;\n",
    "    }\n",
]
lines[idx_srv + 1 : idx_srv + 1] = block
open(path, "w", encoding="utf-8").write("".join(lines))
print("nginx: location 已插入（第 %d 行之后）" % (idx_srv + 1))
PY

if ! nginx -t; then
  echo "nginx -t 失败 → 回滚配置到 $backup" >&2
  cp -a "$backup" "$NGINX_CONF"
  nginx -t || true
  exit 1
fi
systemctl reload nginx
echo "nginx reloaded"

curl_opts=(-sS --max-time 20)
# reload 是平滑替换 worker：紧接着探测有概率还落在旧 worker 上（会误报 404），所以重试几次。
code=""
ctype=""
body=""
for attempt in 1 2 3 4 5; do
  code=$(curl "${curl_opts[@]}" -o /tmp/wechat-verify-probe.txt -w '%{http_code}' "$PROBE_URL_BASE/MP_verify_${TOKEN}.txt" || echo "000")
  ctype=$(curl "${curl_opts[@]}" -o /dev/null -w '%{content_type}' "$PROBE_URL_BASE/MP_verify_${TOKEN}.txt" || echo "-")
  body=$(cat /tmp/wechat-verify-probe.txt 2>/dev/null || echo "")
  echo "probe#$attempt: status=$code content_type=$ctype body=$body"
  if [ "$code" = "200" ] && [ "$body" = "$TOKEN" ]; then break; fi
  sleep 1
done
rm -f /tmp/wechat-verify-probe.txt

if [ "$code" = "200" ] && [ "$body" = "$TOKEN" ]; then
  case "$ctype" in
    text/plain*) ;;
    *) echo "WARN: Content-Type=$ctype（期望 text/plain，微信可能仍判失败）" >&2 ;;
  esac
  echo "WECHAT_VERIFY_OK 下一步：公众号后台「业务域名」点保存完成验证"
  exit 0
fi
echo "WECHAT_VERIFY_FAILED（期望 200 且 body=$TOKEN）" >&2
exit 1
