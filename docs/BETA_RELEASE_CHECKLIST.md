# v2 老客户内测上线清单

目标：先让 3-5 个熟悉的老客户进入思潼AI增长OS v2 内测，老版本继续兜底，不做一次性全量迁移。

## 1. 上线前准备

- 备份旧版 nginx 配置、旧版服务目录和旧版数据库。
- 确认 v2 使用独立目录、独立端口、独立数据库。
- 确认域名 ICP 备案已可用，v2 先挂 `/os-v2/`，不要抢占旧系统使用过的 `/v2/`。
- 准备服务器环境文件：`/etc/Sitong-secrets/Sitong-os-v2.env`。
- 确认生产配置不出现 OpenAI、ChatGPT、Anthropic、Gemini 等海外模型节点。

## 2. 必填生产配置

可以先复制模板：

```bash
sudo mkdir -p /etc/Sitong-secrets
sudo cp docs/Sitong-os-v2.env.template /etc/Sitong-secrets/Sitong-os-v2.env
sudo chmod 600 /etc/Sitong-secrets/Sitong-os-v2.env
sudo nano /etc/Sitong-secrets/Sitong-os-v2.env
```

```text
NODE_ENV=production
DATA_MODE=database
DATABASE_URL=...
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-v4-pro
JWT_SECRET=...
ADMIN_TOKEN=...
OPS_TOKEN=...
DOMESTIC_NETWORK_ONLY=true
DOMESTIC_OUTBOUND_ALLOWLIST=api.deepseek.com,dashscope.aliyuncs.com,bailian.aliyuncs.com,api.weixin.qq.com,api.mch.weixin.qq.com,api.lcppch.top
WECHAT_AUTH_REQUIRED=false
WECHAT_AUTH_APPID=
WECHAT_AUTH_SECRET=
WECHAT_AUTH_REDIRECT_URI=https://api.lcppch.top/os-v2/wechat-callback
WECHAT_PAY_REQUIRED=false
WECHAT_PAY_APPID=...
WECHAT_PAY_MCH_ID=...
WECHAT_PAY_API_V3_KEY=...
WECHAT_PAY_CERT_SERIAL_NO=...
WECHAT_PAY_PRIVATE_KEY=...
WECHAT_PAY_NOTIFY_URL=https://api.lcppch.top/os-v2/api/billing/wechat/notify
WECHAT_PAY_PLATFORM_PUBLIC_KEY=...
UPLOAD_DIR=/opt/Sitong-os-v2/uploads
VITE_BASE_PATH=/os-v2/
VITE_API_BASE_URL=https://api.lcppch.top/os-v2/api
VITE_WECHAT_AUTH_REDIRECT_URI=https://api.lcppch.top/os-v2/wechat-callback
```

## 3. 部署命令

```bash
pnpm prelaunch:check -- --env /etc/Sitong-secrets/Sitong-os-v2.env
bash scripts/deploy-linux.sh
```

部署脚本会执行：

- 静态生产配置检查
- 安装依赖
- Prisma client 生成
- 数据库迁移
- 构建
- 重启 systemd 服务
- `/health` 和 `/ready` 检查

## 4. 创建内测邀请码

```bash
set -a
source /etc/Sitong-secrets/Sitong-os-v2.env
set +a

INVITE_CODE="线下发给客户的明文邀请码" \
pnpm invite:create -- --label "首批老客户内测-客户A" --plan local_premium --max-uses 1
```

注意：明文邀请码只线下发给客户，不写进仓库。数据库只保存哈希和预览。

## 5. 上线后检查

```bash
curl http://127.0.0.1:3002/health
curl http://127.0.0.1:3002/ready
curl -H "x-Sitong-ops-token: $OPS_TOKEN" http://127.0.0.1:3002/ops/launch-check
curl -H "x-Sitong-ops-token: $OPS_TOKEN" http://127.0.0.1:3002/ops/llm-smoke
curl -H "x-Sitong-ops-token: $OPS_TOKEN" "http://127.0.0.1:3002/ops/wechat-auth-check?redirectUri=https%3A%2F%2Fapi.lcppch.top%2Fos-v2%2Fwechat-callback"
curl -H "x-Sitong-ops-token: $OPS_TOKEN" http://127.0.0.1:3002/ops/wechat-pay-check
```

完整内测冒烟：

```bash
pnpm beta:smoke -- --base https://api.lcppch.top/os-v2/api \
  --invite-code "<测试邀请码>" \
  --second-invite-code "<第二个测试邀请码，用于数据隔离检查，可选>" \
  --include-chat \
  --include-workbench \
  --wechat-redirect-uri "https://api.lcppch.top/os-v2/wechat-callback" \
  --ops-token "$OPS_TOKEN" \
  --admin-token "$ADMIN_TOKEN"
```

## 6. 内测当天人工验证

- 微信登录能进入 v2。
- 邀请码能创建商家/品牌工作区。
- 客户资料页能保存经营画像。
- 聊天能输出专业咨询方案，不出现通用 AI 口吻。
- 历史会诊能读取，继续追问不会串到别的客户。
- 高级版能上传文件、分析文件、提交录音卡、生成经营报告。
- 创建订单后能生成微信支付二维码。
- 支付成功后订单、订阅、积分到账。
- 运营页能查看客户列表、客户详情、质量反馈、账务复核。

## 7. 每天内测巡检

```text
GET /ops/launch-check
GET /admin/ops/summary
GET /admin/billing/audit
GET /admin/quality/summary
GET /admin/customers
GET /admin/security/isolation-audit
```

发现 `billing/audit` 有 critical issue 时，先暂停继续放量，人工核对订单、订阅和积分流水。

发现 `security/isolation-audit` 有 issue 时，先暂停继续放量，人工核对对应客户数据，确认没有客户看到其他商家的聊天、文件、订单或积分记录。

发现质量反馈集中在“不准、太空泛、无法执行”时，优先修复对应 Skill 提示词和客户画像字段，不急着加新功能。

## 8. 放量节奏

- 第 1 天：内部账号完整跑通。
- 第 2-3 天：3-5 个熟悉老客户内测。
- 第 4-7 天：修复高频问题，只保留老版本兜底。
- 稳定后：扩到 20-30 个老客户。
- 新客户默认进入 v2，老客户按意愿灰度迁移。
