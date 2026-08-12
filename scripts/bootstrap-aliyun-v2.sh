#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/Sitong-os-v2}"
ENV_FILE="${ENV_FILE:-/etc/Sitong-secrets/Sitong-os-v2.env}"
DB_NAME="${DB_NAME:-sitong_os_v2}"
DB_USER="${DB_USER:-sitong_os_v2}"
API_PORT="${API_PORT:-3002}"
WEB_BASE_PATH="${WEB_BASE_PATH:-/os-v2/}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://api.lcppch.top/os-v2}"
WECHAT_PAY_MCH_ID="${WECHAT_PAY_MCH_ID:-1747157353}"

require_file() {
  if [ ! -f "$1" ]; then
    echo "Missing required file: $1" >&2
    exit 1
  fi
}

secret_token() {
  openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n'
}

require_file /etc/Sitong-secrets/deepseek.env
require_file /etc/Sitong-secrets/wx-service.env

set -a
# shellcheck disable=SC1091
source /etc/Sitong-secrets/deepseek.env
# shellcheck disable=SC1091
source /etc/Sitong-secrets/wx-service.env
set +a

DB_PASSWORD="${BAOLU_V2_DB_PASSWORD:-$(openssl rand -hex 24)}"
JWT_SECRET="${BAOLU_V2_JWT_SECRET:-$(secret_token)}"
ADMIN_TOKEN="${BAOLU_V2_ADMIN_TOKEN:-$(secret_token)}"
OPS_TOKEN="${BAOLU_V2_OPS_TOKEN:-$(secret_token)}"

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD';"
else
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASSWORD';"
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
fi

sudo mkdir -p "$(dirname "$ENV_FILE")" "$APP_DIR/uploads"
tmp_env="$(mktemp)"
cat > "$tmp_env" <<EOF
NODE_ENV=production
PORT=$API_PORT
DATA_MODE=database
DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@127.0.0.1:5432/$DB_NAME

LLM_PROVIDER=deepseek
LLM_ALLOWED_MODELS=
DEEPSEEK_API_KEY=$DEEPSEEK_API_KEY
DEEPSEEK_BASE_URL=https://api.deepseek.com/chat/completions
DEEPSEEK_MODEL=deepseek-v4-pro
ALIYUN_API_KEY=
ALIYUN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
ALIYUN_MODEL=qwen-max
ALIYUN_VIDEO_MODEL=qwen-vl-max
ALIYUN_ASR_MODEL=qwen3-asr-flash
ALIYUN_MEDIA_BASE64_MAX_MB=12
DOMESTIC_COMPATIBLE_PROVIDER_NAME=domestic-compatible
DOMESTIC_COMPATIBLE_API_KEY=
DOMESTIC_COMPATIBLE_BASE_URL=
DOMESTIC_COMPATIBLE_MODEL=deepseek-v4-pro
LLM_TIMEOUT_MS=120000

JWT_SECRET=$JWT_SECRET
ADMIN_TOKEN=$ADMIN_TOKEN
OPS_TOKEN=$OPS_TOKEN

INVITE_REQUIRED=true
INVITE_CODES=

DOMESTIC_NETWORK_ONLY=true
DOMESTIC_OUTBOUND_ALLOWLIST=api.deepseek.com,dashscope.aliyuncs.com,bailian.aliyuncs.com,api.weixin.qq.com,api.mch.weixin.qq.com,api.lcppch.top,www.jiqizhixin.com,www.leiphone.com,www.tmtpost.com,nls-meta.cn-shanghai.aliyuncs.com,nls-gateway-cn-shanghai.aliyuncs.com

WECHAT_AUTH_APPID=$WX_APP_ID
WECHAT_AUTH_SECRET=$WX_APP_SECRET
WECHAT_AUTH_REDIRECT_URI=${PUBLIC_BASE_URL}/wechat-callback
WECHAT_AUTH_REQUIRED=false

WECHAT_PAY_APPID=$WX_APP_ID
WECHAT_PAY_MCH_ID=$WECHAT_PAY_MCH_ID
WECHAT_PAY_API_V3_KEY=
WECHAT_PAY_CERT_SERIAL_NO=
WECHAT_PAY_PRIVATE_KEY=
WECHAT_PAY_NOTIFY_URL=${PUBLIC_BASE_URL}/api/billing/wechat/notify
WECHAT_PAY_PLATFORM_PUBLIC_KEY=
WECHAT_PAY_REQUIRED=false

UPLOAD_DIR=$APP_DIR/uploads

VITE_API_BASE_URL=${PUBLIC_BASE_URL}/api
VITE_BASE_PATH=$WEB_BASE_PATH
VITE_WECHAT_AUTH_APPID=$WX_APP_ID
VITE_WECHAT_AUTH_REDIRECT_URI=${PUBLIC_BASE_URL}/wechat-callback
EOF

sudo install -m 600 -o root -g root "$tmp_env" "$ENV_FILE"
rm -f "$tmp_env"
sudo chown -R admin:admin "$APP_DIR/uploads"

echo "Bootstrap completed for $APP_DIR"
echo "Env file created at $ENV_FILE"
echo "Database prepared: $DB_NAME"
