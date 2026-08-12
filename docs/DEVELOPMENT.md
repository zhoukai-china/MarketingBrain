# 开发与上线约定

## Local Development

```bash
pnpm install
pnpm dev:api
pnpm dev:web
```

本地默认 `DATA_MODE=demo`，没有 DeepSeek Key 也能返回模拟回复。配置真实模型后，聊天和文件分析会直接调用 DeepSeek。

Windows Codex 本地预览可用：

```powershell
.\scripts\dev-windows.ps1
.\scripts\stop-dev-windows.ps1
```

当前仓库先提交工程骨架。依赖安装需要在可访问国内 npm 镜像的环境执行。

## Environment Variables

```text
NODE_ENV=development
PORT=3011
DATA_MODE=demo
DATABASE_URL=postgresql://user:password@localhost:5432/sitong_os_v2
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=
DEEPSEEK_MODEL=deepseek-v4-pro
DOMESTIC_NETWORK_ONLY=true
DOMESTIC_OUTBOUND_ALLOWLIST=api.deepseek.com,dashscope.aliyuncs.com,bailian.aliyuncs.com,api.weixin.qq.com,api.mch.weixin.qq.com
WECHAT_AUTH_REQUIRED=false
JWT_SECRET=
UPLOAD_DIR=uploads
```

生产环境不要在代码里写密钥，统一放服务器环境变量或 `/etc/Sitong-secrets/Sitong-os-v2.env`。

## Deployment Notes

- 旧版 `/opt/Sitong-agent` 不改。
- 新版部署到 `/opt/Sitong-os-v2`。
- 本地 API 默认端口 `3011`，生产建议使用 `3002`，避免碰旧服务。
- nginx 先挂 `/os-v2/*`，不要抢占旧系统使用过的 `/v2/*`。

## Database Mode

开发骨架默认 `DATA_MODE=demo`，不依赖数据库即可跑通页面和 Agent 链路。

接入 PostgreSQL 后：

```bash
pnpm --filter @baolu/db prisma:generate
pnpm --filter @baolu/db prisma:migrate
pnpm --filter @baolu/db seed:demo
DATA_MODE=database pnpm dev:api
```

测试数据库模式时请求头带：

```text
x-Sitong-tenant-id: demo-local-tenant
x-Sitong-user-id: demo-local-owner
```

也可以使用开发登录拿 token：

```bash
curl -X POST http://localhost:3011/auth/dev-login \
  -H "Content-Type: application/json" \
  -d '{"planCode":"local_premium","tenantName":"演示本地商家"}'
```

后续请求带：

```text
Authorization: Bearer <token>
```

正式微信登录上线时，替换 `/auth/dev-login` 的 token 签发来源即可，其他业务接口继续通过 `resolveRequestContext` 读取身份。

微信登录骨架：

```bash
POST /auth/wechat-login
{
  "code": "wechat-oauth-code"
}
```

未配置 `WECHAT_AUTH_APPID` / `WECHAT_AUTH_SECRET` 时，database 模式返回 `wechat_auth_not_configured`。

正式用户第一次登录时，如果没有商家/品牌工作区，会返回 `needsTenant=true` 和 `onboardingToken`。前端收集商家名、行业、城市、套餐后调用：

```bash
POST /auth/onboarding/create-workspace
{
  "onboardingToken": "<from wechat-login>",
  "planCode": "local_standard",
  "tenantName": "客户门店/品牌名",
  "industry": "美容美业",
  "city": "杭州"
}
```

该接口会创建 tenant、默认门店、owner membership、试用订阅、初始积分，然后签发正式业务 token。

手机号绑定：

```bash
POST /auth/phone/bind
Authorization: Bearer <token>
{
  "phone": "13900000000",
  "code": "123456"
}
```

短信验证码校验待接入短信服务。

## Health Checks

```bash
curl http://localhost:3011/health
curl http://localhost:3011/ready
```

真实模型连通性：

```bash
curl -X POST http://localhost:3011/ops/llm-smoke
```

`/ops/llm-smoke` 会真实调用 DeepSeek；没有配置 Key 时会返回 `llm_not_configured`。

生产和准生产环境必须保持 `DOMESTIC_NETWORK_ONLY=true`。如果把模型地址误配成 OpenAI、Anthropic、Gemini 等海外模型域名，运行时配置检查会拦截。

如果本地设置了 `OPS_TOKEN`，需要带：

```bash
curl -H "x-Sitong-ops-token: $OPS_TOKEN" http://localhost:3011/ops/llm-smoke
```

如果本地设置了 `ADMIN_TOKEN`，后台接口需要带：

```bash
curl -H "x-Sitong-admin-token: $ADMIN_TOKEN" http://localhost:3011/admin/quality/summary
```

## Workbench File Test

本地打开：

```text
http://localhost:5174
```

操作：

1. 选择“本地商家高级版”或“连锁品牌高级版”。
2. 点击“开发登录”。
3. 进入“工作台”。
4. 选择 CSV/TXT/JSON/MD 文件。
5. 点击“上传文件”。
6. 点击“分析文件”。

标准版会被后端拒绝，避免绕过前端权限。

## Automation Test

创建高级版本地推任务：

```bash
POST /automation/tasks
{
  "type": "local_push_ad_plan",
  "payload": {
    "store": "杭州美容院",
    "budget": 300,
    "city": "杭州"
  }
}
```

标准版创建 `local_push_ad_plan` 或 `video_publish_plan` 会返回 `403 plan_requires_premium`。

## Billing Test

创建套餐订单：

```bash
POST /billing/orders
{
  "type": "subscription",
  "planCode": "local_premium",
  "billingPeriod": "monthly"
}
```

创建积分包订单：

```bash
POST /billing/orders
{
  "type": "credit_pack",
  "creditPackCode": "growth_1500"
}
```

开发环境模拟支付：

```bash
POST /billing/orders/:orderId/mock-pay
{}
```

生产环境会禁用 `mock-pay`，正式微信支付回调后复用订单发放逻辑。

真实微信预下单：

```bash
POST /billing/orders/:orderId/wechat-prepay
```

没有配置微信支付密钥时返回 `wechat_pay_not_configured`。
