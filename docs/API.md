# API 草案

第一版 API 先服务 H5、电脑端 Web 工作台和后台管理。

## Public / App

```text
GET  /health
GET  /ready
GET  /ops/launch-check
POST /ops/llm-smoke
GET  /ops/wechat-auth-check
GET  /ops/wechat-pay-check
POST /auth/dev-login
POST /auth/wechat-login
POST /auth/onboarding/create-workspace
POST /auth/phone/bind
GET  /plans
GET  /skills
GET  /plans/:planCode/skills
GET  /billing/catalog
GET  /billing/orders
GET  /billing/orders/:orderId
POST /billing/orders
POST /billing/orders/:orderId/mock-pay
POST /billing/orders/:orderId/wechat-prepay
POST /billing/wechat/notify
GET  /credits/transactions
POST /chat
GET  /account/status
GET  /tenant/current
PATCH /tenant/current/profile
GET  /workbench/summary
POST /files
GET  /files
POST /files/:fileId/analyze
GET  /conversations
GET  /conversations/:conversationId/messages
POST /agent-runs/:agentRunId/feedback
GET  /reports
POST /reports
POST /audio-cards
POST /audio-cards/:id/analyze
GET  /automation/capabilities
GET  /automation/tasks
POST /automation/tasks
POST /desktop/devices/register
GET  /desktop/tasks/poll
POST /desktop/tasks/:taskId/status
GET  /admin/invites
POST /admin/invites
GET  /admin/customers
GET  /admin/customers/:tenantId
GET  /admin/security/isolation-audit
```

`DATA_MODE=database` 时，业务接口会从请求身份解析 `tenant_id` / `user_id`，并从数据库读取套餐、画像和积分。当前 MVP 临时使用请求头：

```text
x-Sitong-tenant-id
x-Sitong-user-id
```

正式接微信登录后，这两个值必须从服务端 session/JWT 中解析，不能信任前端直接传。

现在已经支持 `Authorization: Bearer <token>`。`/auth/dev-login` 是开发登录入口，正式版会替换为微信 OAuth / 手机号绑定后的登录入口。

Security headers:

```text
x-Sitong-admin-token: required for /admin/* when ADMIN_TOKEN is configured or in production
x-Sitong-ops-token: required for /ops/* when OPS_TOKEN is configured or in production
```

`/auth/dev-login` is disabled in production.

微信授权诊断：

```text
GET /ops/wechat-auth-check?redirectUri=https%3A%2F%2Fapi.lcppch.top%2Fv2%2Fchat
x-Sitong-ops-token: <OPS_TOKEN>
```

该接口不消耗微信 code、不创建用户，只检查微信网页授权配置，并返回可复制测试的 `authorizeUrl`。

微信支付诊断：

```text
GET /ops/wechat-pay-check
x-Sitong-ops-token: <OPS_TOKEN>
```

该接口不访问微信、不产生订单，只检查微信支付配置、回调地址和 PEM 密钥格式。配置通过后再创建测试订单并运行 `beta:smoke --include-wechat-pay`。

## Auth Flow

当前开发链路：

```text
POST /auth/dev-login
  ↓
返回 token
  ↓
业务接口带 Authorization
  ↓
resolveRequestContext 解析 tenant_id / user_id
  ↓
读取套餐、画像、积分、权限
```

正式微信链路：

```text
微信网页授权 code
  ↓
POST /auth/wechat-login
  ↓
后端换 openid/unionid
  ↓
绑定或创建 user
  ↓
查找 membership
  ↓
已有 tenant：签发 token
  ↓
没有 tenant：返回 needsTenant=true + onboardingToken
  ↓
POST /auth/onboarding/create-workspace
  ↓
校验内测邀请码
  ↓
创建商家/品牌、owner membership、试用订阅、初始积分
  ↓
签发正式业务 token
```

手机号绑定：

```text
POST /auth/phone/bind
Authorization: Bearer <token>
{
  "phone": "13900000000",
  "code": "123456"
}
```

当前 MVP 只保存手机号，短信验证码校验待接入短信服务。

### 身份来源（P0 修复后，`docs/BUG_REGRESSIONS.md` QA-20260911-002）

`DATA_MODE=database` 时，`resolveRequestContext` 的身份**只来自 `Authorization: Bearer <token>` 里验签通过的会话令牌**。`x-sitong-tenant-id` / `x-sitong-user-id` 不再是身份来源：无有效令牌时即使带上这两个头也返回 401 `login_required`，且不会去查 membership（避免「猜 ID 即探测」）。有效令牌同时携带伪造头时，一律以令牌为准。

内部运维脚本是唯一例外：除裸身份头外必须携带 `x-sitong-ops-token`，其值与 API 进程的 `OPS_TOKEN` 常量时间相等时才被承认；未配置 `OPS_TOKEN` 时该通道整体关闭。仓库内脚本统一用 `scripts/lib/internal-ops-identity.mjs`，测试夹具统一用 `scripts/lib/db-session-headers.ts`（真实会话令牌）。

## Tenant Profile And Conversations

客户画像是思潼AI增长OS输出专业度的基础，不是普通用户资料。前端“资料”页会写入：

```text
GET   /tenant/current
PATCH /tenant/current/profile
```

建议首批内测至少补齐：行业、城市、主营项目、目标客户、价格带、获客渠道、当前经营卡点、团队和执行现状。Agent 每次输出都会读取当前租户画像，避免变成通用 AI 回答。

历史会诊接口：

```text
GET /conversations
GET /conversations/:conversationId/messages
```

`POST /chat` 支持传入 `conversationId` 继续同一条会诊。所有会诊和消息都按 `tenantId` 查询，不能跨商家读取。

## File Workbench MVP

高级版工作台当前支持：

- 上传文件并按 `tenant_id` 保存。
- 文本、CSV、TSV、JSON、Markdown 读取内容后进入 Agent 分析。
- PDF、Word、Excel 等二进制文件先保存元数据，MVP 阶段返回分析框架和补充字段建议。
- `DATA_MODE=database` 时，上传记录进入 `uploaded_files`，分析结果进入 `file_analyses`。

下一步需要接入：

- Excel 解析。
- PDF 文本抽取。
- Word 文档解析。
- 报告导出 Word/PDF。

## Automation MVP

当前自动化接口先保存任务，不直接操作用户电脑：

```text
GET  /automation/capabilities
GET  /automation/tasks
POST /automation/tasks
```

高级版开放：

- `local_push_ad_plan`
- `local_push_ad_adjustment`
- `video_publish_plan`
- `video_publish_execution`
- `audio_card_analysis`

标准版只能使用基础推送类任务。

桌面客户端上线后，会拉取这些任务，在用户本机执行辅助动作，并在关键节点要求用户确认。

## Audio Card MVP

录音卡/工作记录先支持文本转写结果接入：

```text
POST /audio-cards
POST /audio-cards/:id/analyze
```

高级版可用。当前先用 `AutomationTask(type=audio_card_analysis)` 承载记录，分析时调用 `sales_growth_advisor`，并复用 Agent 运行记录、积分扣减和质量反馈链路。后续字段稳定后再拆独立录音卡表，接入外部录音卡 API 和音频文件存储。

## Report MVP

高级版工作台支持经营建议报告：

```text
GET  /reports
POST /reports
```

当前先返回 Markdown 和 HTML 两种内容。报告会汇总当前租户最近的 Agent 输出、文件分析、录音卡分析，并调用 `sales_growth_advisor` 生成经营诊断和未来7天动作建议。后续接 Word/PDF 渲染时复用同一份 Markdown/HTML 内容。

## Billing MVP

当前计费接口已经支持：

- 查询四版本套餐和积分包。
- 创建套餐订单。
- 创建积分包订单。
- 开发环境模拟支付。
- database 模式下支付后写入订阅、发放积分、记录积分流水。
- 查询积分余额和积分流水。

开发模拟支付：

```text
POST /billing/orders/:orderId/mock-pay
```

生产环境会禁用 `mock-pay`。正式微信支付接入后，微信支付回调只负责验证签名和订单状态，验证通过后调用同一套发放逻辑。

年付订单当前会创建一年订阅，并立即发放当月积分；后续需要增加“月度积分发放任务”。

微信支付配置未完成时，`/billing/orders/:orderId/wechat-prepay` 返回 `wechat_pay_not_configured`。

注意：微信支付回调验签依赖原始请求体。`/billing/wechat/notify` 已单独接入 raw JSON parser，其他业务接口仍使用普通 JSON 解析。

## Admin

```text
GET /admin/billing/audit
GET /admin/ops/summary
GET /admin/quality/summary
GET /admin/invites
POST /admin/invites
GET /admin/customers
GET /admin/customers/:tenantId
GET /admin/security/isolation-audit
```

`/admin/customers` 用于内测运营排查：查看商家/品牌、当前套餐、积分余额、成员数、会诊数、文件数和订单数。`/admin/customers/:tenantId` 用于查看单个客户的成员、订阅、最近 Agent 运行、订单、文件、自动化任务和历史会诊。

`/admin/security/isolation-audit` 用于扫描高风险跨租户关联异常，包括消息与会诊、AgentRun 与会诊、文件分析与文件、自动化任务与桌面设备、积分流水与积分账户。内测期间每天至少看一次，发现 `ok=false` 先暂停放量。

所有正式接口都必须从鉴权上下文拿到 `tenant_id`，不能信任前端直接传入的 `tenant_id`。

## Beta Invites

内测邀请码支持两种来源：

- `INVITE_CODES` 环境变量：适合本地开发和极小范围临时测试。
- 数据库 `InviteCode`：适合正式内测，可查看使用次数和核销记录。

创建邀请码：

```text
POST /admin/invites
x-Sitong-admin-token: <ADMIN_TOKEN>
{
  "code": "customer-private-code",
  "label": "老客户A",
  "planCode": "local_premium",
  "maxUses": 1,
  "expiresAt": "2026-07-31T23:59:59.000Z"
}
```

数据库只保存邀请码哈希和预览，不保存明文。明文只在创建时由思潼团队发给客户。

查看邀请码：

```text
GET /admin/invites
```

入驻时 `POST /auth/onboarding/create-workspace` 会校验邀请码。数据库模式下优先查数据库邀请码，找不到时兼容 `INVITE_CODES`。
# Agent 持续质量学习

```text
POST /agent-runs/:agentRunId/feedback
POST /agent-runs/:agentRunId/outcomes
GET  /admin/continuous-improvement/latest
GET  /admin/continuous-improvement/candidates
GET  /admin/continuous-improvement/eval-drafts
POST /admin/continuous-improvement/candidates/:candidateId/decision
```

管理端决策只能批准候选进入离线评测或拒绝，不能直接发布生产版本。
