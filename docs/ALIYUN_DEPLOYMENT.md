# 阿里云部署草案

## 服务

```text
ECS: Node.js API + 前端静态资源
RDS PostgreSQL: Sitong_os_v2
Redis: 自动化任务队列
OSS: 文件、报告、录音卡音频
SLS: 日志
国内模型: DeepSeek 或国内模型中转
ASR: 阿里云智能语音交互或其他国内语音识别
```

## 目录

```text
/opt/Sitong-os-v2
/opt/Sitong-os-v2/uploads
/etc/Sitong-secrets/Sitong-os-v2.env
```

## 交接资料核对

旧版工作交接文档里已经包含服务器、旧版服务、微信、支付和模型相关线索。
这些内容包含敏感信息，不写入代码仓库。部署 v2 时只做现场核对：

- ECS 登录方式和 nginx 配置位置。
- 旧版服务目录、端口和 systemd 名称，确保 v2 上线不影响老客户。
- 微信网页授权 AppID、Secret 和回调域名。
- 微信支付商户配置、证书、回调地址和验签材料。
- DeepSeek API Key、Base URL 和国内网络白名单。
- v2 专用 `DATABASE_URL`、`JWT_SECRET`、`ADMIN_TOKEN`、`OPS_TOKEN`。
- 首批老客户的邀请码、套餐、商家/品牌资料。

原则：真实密钥只放在服务器 `/etc/Sitong-secrets/` 下，仓库只保存变量名、检查脚本和部署说明。

## systemd

```ini
[Unit]
Description=Sitong OS v2 API
After=network.target

[Service]
WorkingDirectory=/opt/Sitong-os-v2
EnvironmentFile=/etc/Sitong-secrets/Sitong-os-v2.env
ExecStart=/usr/bin/pnpm --filter @baolu/api start
Restart=always
RestartSec=3
User=admin

[Install]
WantedBy=multi-user.target
```

## nginx

内测阶段建议先挂 `/os-v2/`，不要抢占旧系统使用过的 `/v2/`：

```text
/os-v2/api -> 127.0.0.1:3002
/os-v2/chat -> web dist
/os-v2/workbench -> web dist
/os-v2/admin -> web dist
```

老系统入口保持不动。

## Production Environment

生产环境 `/etc/Sitong-secrets/Sitong-os-v2.env` 至少需要：

可先复制模板 `docs/Sitong-os-v2.env.template` 到服务器 `/etc/Sitong-secrets/Sitong-os-v2.env`，再在服务器上填写真实密钥。

```text
NODE_ENV=production
PORT=3002
DATA_MODE=database
DATABASE_URL=postgresql://user:password@host:5432/sitong_os_v2
LLM_PROVIDER=deepseek
LLM_ALLOWED_MODELS=
DEEPSEEK_API_KEY=your_deepseek_key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-v4-pro
ALIYUN_API_KEY=
ALIYUN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
ALIYUN_MODEL=qwen-max
DOMESTIC_COMPATIBLE_PROVIDER_NAME=domestic-compatible
DOMESTIC_COMPATIBLE_API_KEY=
DOMESTIC_COMPATIBLE_BASE_URL=
DOMESTIC_COMPATIBLE_MODEL=deepseek-v4-pro
LLM_TIMEOUT_MS=45000
JWT_SECRET=至少32位随机字符串
ADMIN_TOKEN=至少32位随机字符串
OPS_TOKEN=至少32位随机字符串
INVITE_REQUIRED=true
INVITE_CODES=可选，仅作为紧急兜底；生产内测优先使用数据库邀请码
DOMESTIC_NETWORK_ONLY=true
DOMESTIC_OUTBOUND_ALLOWLIST=api.deepseek.com,dashscope.aliyuncs.com,bailian.aliyuncs.com,api.weixin.qq.com,api.mch.weixin.qq.com,api.lcppch.top,www.jiqizhixin.com,www.leiphone.com,www.tmtpost.com,nls-meta.cn-shanghai.aliyuncs.com,nls-gateway-cn-shanghai.aliyuncs.com
WECHAT_AUTH_REQUIRED=false
WECHAT_AUTH_APPID=微信公众号/网页授权AppID
WECHAT_AUTH_SECRET=微信公众号/网页授权Secret
WECHAT_AUTH_REDIRECT_URI=https://api.lcppch.top/os-v2/wechat-callback
WECHAT_PAY_APPID=微信支付AppID
WECHAT_PAY_MCH_ID=微信支付商户号
WECHAT_PAY_API_V3_KEY=微信支付APIv3密钥
WECHAT_PAY_CERT_SERIAL_NO=商户证书序列号
WECHAT_PAY_PRIVATE_KEY=商户API私钥PEM，换行用\n转义
WECHAT_PAY_NOTIFY_URL=https://api.lcppch.top/os-v2/api/billing/wechat/notify
WECHAT_PAY_PLATFORM_PUBLIC_KEY=微信支付平台公钥PEM，换行用\n转义
UPLOAD_DIR=/opt/Sitong-os-v2/uploads
VITE_API_BASE_URL=https://api.lcppch.top/os-v2/api
VITE_BASE_PATH=/os-v2/
VITE_WECHAT_AUTH_APPID=微信公众号/网页授权AppID
VITE_WECHAT_AUTH_REDIRECT_URI=https://api.lcppch.top/os-v2/wechat-callback
```

## Readiness Checks

部署前先在服务器上检查环境文件：

```bash
pnpm prelaunch:check -- --env /etc/Sitong-secrets/Sitong-os-v2.env
```

部署后再检查服务：

```bash
curl http://127.0.0.1:3002/health
curl http://127.0.0.1:3002/ready
curl -H "x-Sitong-ops-token: $OPS_TOKEN" http://127.0.0.1:3002/ops/launch-check
```

`/ready` 会检查：

- 生产环境配置是否完整。
- `DATA_MODE=database` 时 PostgreSQL 是否可连接。
- DeepSeek 是否已配置。

模型真实连通性单独检查，避免普通健康检查消耗模型额度：

```bash
curl -H "x-Sitong-ops-token: $OPS_TOKEN" http://127.0.0.1:3002/ops/llm-smoke
curl -H "x-Sitong-ops-token: $OPS_TOKEN" "http://127.0.0.1:3002/ops/wechat-auth-check?redirectUri=https%3A%2F%2Fapi.lcppch.top%2Fos-v2%2Fwechat-callback"
curl -H "x-Sitong-ops-token: $OPS_TOKEN" http://127.0.0.1:3002/ops/wechat-pay-check
```

后台接口需要：

```bash
curl -H "x-Sitong-admin-token: $ADMIN_TOKEN" http://127.0.0.1:3002/admin/quality/summary
```

`/auth/dev-login` 在 `NODE_ENV=production` 下会被禁用，正式登录必须走微信/手机号体系。

## Domestic Network Policy

思潼AI增长OS 面向中国境内用户，生产环境必须满足：

- 服务器、数据库、对象存储、日志、缓存部署在中国境内云资源。
- 生产环境 `DOMESTIC_NETWORK_ONLY=true`，禁止关闭。
- 大模型只允许国内供应商或国内合规中转服务，不允许 OpenAI、ChatGPT、Anthropic、Gemini 等海外模型节点。
- `DEEPSEEK_BASE_URL` 必须落在 `DOMESTIC_OUTBOUND_ALLOWLIST` 白名单内。
- 默认白名单只包含 DeepSeek API、微信网页授权、微信支付。新增短信、ASR、OSS、支付等供应商时，先确认其中国境内服务域名，再加入白名单。
- 文件、录音卡、经营数据、聊天记录、支付记录不出境，不写入海外日志和海外分析工具。

上线前必须执行：

```bash
curl http://127.0.0.1:3002/ready
```

如果误配海外模型地址，例如 OpenAI API，服务会在启动检查或模型调用前返回配置错误。

静态部署检查也会拦截 OpenAI、Anthropic、Gemini 等海外模型域名：

```bash
pnpm prelaunch:check -- --env /etc/Sitong-secrets/Sitong-os-v2.env
```

## First Database Setup

第一次部署：

```bash
pnpm install --prod=false
pnpm --filter @baolu/db prisma:generate
pnpm --filter @baolu/db prisma:deploy
pnpm build
sudo systemctl restart Sitong-os-v2
```

创建首批老客户内测邀请码：

```bash
set -a
source /etc/Sitong-secrets/Sitong-os-v2.env
set +a

INVITE_CODE="只在线下发给客户的明文邀请码" \
pnpm invite:create -- --label "首批老客户内测" --plan local_premium --max-uses 1
```

邀请码明文只在线下发给客户，不写入仓库；数据库只保存哈希和预览。

后续更新可以使用：

```bash
APP_DIR=/opt/Sitong-os-v2 \
ENV_FILE=/etc/Sitong-secrets/Sitong-os-v2.env \
SERVICE_NAME=Sitong-os-v2 \
bash scripts/deploy-linux.sh
```

如果 v2 挂在老域名 `/v2/` 子路径，构建前确认：

```bash
export VITE_BASE_PATH=/os-v2/
export VITE_API_BASE_URL=https://api.lcppch.top/os-v2/api
```

nginx 可参考 `docs/nginx-v2.example.conf`，上线前先备份旧配置并执行：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

内测需要本地演示数据时：

```bash
pnpm --filter @baolu/db seed:demo
```

生产环境不要使用 `seed:demo` 发放正式邀请码。

## Billing Notes

订单表会记录套餐订单和积分包订单。微信支付接入已经预留：

- 微信 Native 支付预下单：`POST /billing/orders/:orderId/wechat-prepay`
- 微信支付回调：`POST /billing/wechat/notify`
- 回调幂等处理：已支付订单重复回调直接返回
- 支付成功后调用同一套订单发放逻辑

开发环境的 `/billing/orders/:orderId/mock-pay` 在生产环境禁用。

当前回调验签依赖 `WECHAT_PAY_PLATFORM_PUBLIC_KEY`。`/billing/wechat/notify` 已单独接入 raw JSON parser，签名串使用微信原始请求体。
