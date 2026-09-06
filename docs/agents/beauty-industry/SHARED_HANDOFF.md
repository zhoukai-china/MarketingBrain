# BY-01 共享平台串行交接

状态：共享 MCP/凭据/账本已于 2026-08-21 串行语义合入；BY-01 可继续网页复用与真实 WorkBuddy E2E。生产未迁移、未部署。

## 当前冲突证据

主检出区的 `packages/shared/src/index.ts`、`packages/skills/src/index.ts`、`packages/agent/src/index.ts`、`apps/api/src/services/agent-definitions.ts`、`packages/db/prisma/schema.prisma`、`apps/api/src/server.ts`、`apps/web/src/main.tsx`、`apps/web/src/pages/AgentProductsApp.tsx` 已有多任务未提交差异。不得由 BY-01 覆盖、格式化或回退。

## 已完成的产品专属输入

- 稳定产品：`beauty-industry`。
- 产品 adapter：`apps/api/src/products/beauty-industry/mcp-adapter.ts`。
- 行业安全上下文：`apps/api/src/products/beauty-industry/policy.ts`。
- 新 Skill：`beauty-industry-compliance`、`beauty-industry-content-diff`、`beauty-industry-xhs`。
- 红灯→绿灯：`scripts/beauty-industry-mcp-contract-smoke.ts`。
- 高风险 Eval：`scripts/beauty-industry-policy-eval.ts`，8 类×3，硬失败 0。

## 最小共享变更

### 1. 产品注册

文件：`packages/shared/src/index.ts`

- 向 `PRODUCT_LOGIN_CODES` 增加 `beauty-industry`。
- 增加品牌中立定义：名称“美业行业通用智能体”，默认路径建议 `/beauty/acquisition`，`agentIds=["agent_beauty_acquisition"]`。
- 不修改 `lanqi` 定义或默认路径。

### 2. Skill 注册

文件：`packages/shared/src/index.ts`、`packages/skills/src/index.ts`、`packages/agent/src/index.ts`

- 注册上述 3 个 SkillId、manifest 和运行时激活集合；版本均为 1.0.0。
- reasoning：行业合规/内容差异/小红书正文使用已批准 Pro 文本策略；不得 Flash/模板静默降级。
- 原始 MCP 包来自 `mcp-skills/skills/<skillId>/SKILL.md`；运行时资产来自 `packages/skills/skills/<skillId>/`。
- 保持 FIP、外卖、兰琪和旧门店获客映射不变。

### 3. 产品 Agent

文件：`apps/api/src/services/agent-definitions.ts`

- 加法创建 `agent_beauty_acquisition`，不改写 `agent_store_acquisition`。
- 绑定美业策略/选题到 `beauty-industry-content-diff`，小红书整包到 `beauty-industry-xhs`；投流/直播/复盘复用现有 `optimize_local_push_ads`、`live_script_planner`、`baolu_review_engine`、`baolu_live_review_engine`。
- 不绑定 `lanqi-image-prompt-enhancer`；未完成通用抽取前不开放图片/视频付费工具。
- 所有外部动作保持草稿或 `PREVIEW_ONLY`。

### 4. 产品凭据

文件：`packages/db/prisma/schema.prisma` + 新增单独迁移、`apps/api/src/services/workbuddy-connections.ts`、`apps/api/src/routes/workbuddy-settings.ts`

在现有 `WorkbuddyMcpConnection` 上加法补充：

- `productCode`（必填；历史行迁移需明确兼容值，不能猜成 beauty）。
- `operatingEntityId`（必填或有明确旧记录兼容策略）。
- `scopes`（JSON/字符串数组，服务端白名单解析）。
- `expiresAt`、`revokedAt`、`rotatedFromId`；保留 tokenHash/tokenPrefix/lastUsedAt。
- 可选速率字段或独立共享限流实现；不能只前端限流。

创建/轮换凭据前校验当前用户的 product entitlement、Agent 权限、经营主体归属和 scopes；secret 仍一次显示，服务端只存 hash。列表不返回 hash 或完整 secret。

### 5. MCP 薄适配

文件：`apps/api/src/routes/workbuddy-mcp.ts`

- 共享 resolver 返回 connection id、productCode、operatingEntityId、scopes、expires/revoked 状态。
- `tools/list` 遇到 `beauty-industry` 时调用 `listBeautyIndustryMcpTools`；禁止返回通用 `sitong.ask`、任意 skillId 锁定或其他产品工具来绕过产品包。
- `tools/call` 调用 `runBeautyIndustryMcpTool`，身份全部来自连接；请求参数含 tenantId/userId/productCode/operatingEntityId/credentialId/scopes 时拒绝。
- execute bridge 继续走同一 Agent/Skill 网关、CreditAccount 和 AgentRun，写入 credentialId、channel=mcp、capability/provider/积分；同 credential + requestId 幂等。
- 余额不足在 Provider 前拒绝；超时/取消/失败不自动重试或重复扣费。

### 6. 路由与网页

文件：`apps/api/src/server.ts`、`apps/web/src/main.tsx`、独立品牌中立页面；连接管理若复用 `AgentProductsApp.tsx` 只做产品过滤的最小 patch。

- 公开同一远程 MCP URL，不为每个 Skill 建 URL/secret。
- 新入口只显示获客板块已开放能力，不显示其他一级板块空壳按钮。
- 兰琪入口与历史数据保持原样。

## 平台回归要求

- 修复前：`beauty-industry` token 不能注册/过滤工具；现有连接缺 product/scopes/expiry。
- 修复后：无 token、错产品、过期、撤销、跨 tenant/entity、伪造身份参数、scope 越权、重复 requestId、余额不足、超时/取消、Provider 失败全部有协议断言。
- 保持现有 `workbuddy:selfservice-smoke`、`channel-gateways-smoke`、Agent/Skill 回归和三个旧产品登录测试通过。
- BY-01 在共享合入后继续 MCP Inspector/真实客户端、WorkBuddy、桌面/390px和 `qa:full`。
