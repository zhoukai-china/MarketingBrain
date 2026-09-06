# 公共平台任务登记

只有两个以上智能体以完全相同语义复用的能力才登记在这里。登录、租户隔离、知识访问控制、文件、会话、AgentRun、取消、幂等、钱包流水和通用组件属于候选公共能力。

巨型公共文件的拆分必须另建 `PLAT-*` 任务，先建立回归，再保持行为不变地迁移。

## PLAT-01 三个产品独立登录与受控开通

状态：已完成

### 归属

- 产品：公共平台，服务创始人 IP 获客、外卖增长和兰琪美业。
- 层级：公共平台。
- 风险：高，涉及身份入口、租户创建、邀请码和产品授权。
- 预计修改热点：登录路由、登录页、邀请码服务、认证路由、Prisma 邀请码模型。
- 是否允许并行：否；同一工作树中的产品任务已暂停，独立 worktree 不受影响。

### 用户结果

用户从被邀请的具体产品入口登录，只开通该产品；思潼 AI OS 和经营类型选择不再暴露为公共首登步骤。

### 本次范围

- 新增 `/login/founder-ip`、`/login/takeaway`、`/login/lanqi`。
- `/login` 只做受控入口说明，旧开通页迁至 `/internal/onboarding`。
- 产品邀请码先校验，再采集工作区资料；后端校验邀请码产品归属并按产品授权。
- 保持微信回调、旧邀请码和内部开发登录兼容。

### 本次不做

- 不建设手机号、密码等全新身份体系。
- 不迁移三个产品现有业务代码。
- 不自动发布、改生产配置或生成真实客户邀请码。

### 验收条件

1. 正常路径：三个产品 URL 展示对应品牌，邀请码验证后进入资料开通并只授予目标产品。
2. 失败路径：空、无效、过期、耗尽或产品不匹配的邀请码均不能创建租户。
3. 不应发生：公共入口不显示经营类型选择；产品开通不授予其他产品智能体；生产环境不出现开发一键登录。
4. 可观测结果事件：接口返回 `productCode`，邀请码兑换 metadata 记录产品入口，不记录敏感原始邀请码。

### 基线与失败证据

- 基线命令：`pnpm.cmd agent:development-architecture-smoke`、web/api typecheck，均 PASS。
- 修复前失败测试/Eval：`pnpm.cmd auth:product-login-smoke` 预期 FAIL，旧实现缺少四个新路由和产品邀请码契约。
- 现象、根因和连带影响：统一首登把平台租户类型暴露给产品用户，邀请码没有产品归属，旧授权会同时开放多个产品。

### 实现记录

- 修改文件：共享产品契约、Prisma 邀请与产品授权模型、认证/邀请码/管理路由、登录页/微信回调/路由/CSS、邀请脚本与回归脚本。
- 数据/接口/配置变化：`InviteCode.productCode`；`TenantProductEntitlement`；`POST /auth/product-invite/validate`；认证接口支持 `productCode`；创建邀请码支持 `--product`。
- 兼容性和回滚点：数据库字段可空，旧邀请码仍可走内部开通；产品入口拒绝无产品归属的旧邀请码；兰琪历史推荐码按关联记录兼容识别。

### 验证

- 领域命令：`pnpm.cmd auth:product-login-smoke`、`pnpm.cmd qa:lanqi-foundation`，PASS。
- `pnpm.cmd qa:fast`：PASS（同时由 `qa:full` 再次执行）。
- 页面/E2E：隔离实例 `3012/5178` 实际验收三个产品、通用入口、内部入口、无效邀请码、重复点击、刷新、390px 移动端和控制台，PASS。
- 未运行项：未执行真实微信 OAuth（本地无公众号回调和真实身份）；未执行数据库迁移部署与真实邀请码兑换（不修改生产/客户数据）。

### 交接

- 残余风险：生产上线前需部署迁移并为新邀请明确填写产品；旧环境变量邀请码只能继续用于内部兼容入口。
- 后续任务：多产品账号的“我的产品”选择页另立任务。
- 最后更新日期：2026-08-13。

## PLAT-02 共享 Agent/Skill 路由与 FIP self-MCP 终态

状态：共享运行时与 Provider 稳定性 P1 已完成；FIP 页面 E2E 待产品任务归档（2026-08-21）

### 用户结果与边界

- FIP 内容请求只运行 `agent_founder_ip_acquisition / founder_ip_content_creator`；门店获客继续运行 `agent_store_acquisition / baolu_content_creator`，两者不互相降级。
- FIP self-MCP 请求具备请求级硬超时、取消传播、single-flight 幂等、无自动重试和明确 499/504；仍只允许 `deepseek-v4-pro + thinking enabled + reasoning_effort=high`。
- 本任务不启用 V4 Flash、低端 DeepSeek、固定模板或 MiniMax；不修改百炼媒体路径、生产配置或部署状态。

### 失败证据与根因

- 修复前 `pnpm.cmd agent:smoke` FAIL：`agent=agent_acquisition skill=baolu_content_creator`。根因是专属 Skill 已注册到类型、manifest 与 Agent 定义，却遗漏在 Agent 运行时激活集合中。
- FIP self-MCP 修复前的受控请求在约 65 秒仍无终态；根因与证据登记于 `QA-20260820-007`。修复后的受控单请求在 67.848 秒完成 Provider/MCP 并得到明确 422 质量拒绝，无挂起、孤儿、重试或模板降级。
- 后续真实四目标批测的偶发 503 已由安全终态分类精确定位：DeepSeek 返回 `finish_reason=length`，4099 个 completion tokens 全为 reasoning tokens，最终正文为空；不是 HTTP、MCP、取消或 JSON 解析故障。

### 实现与验证

- 最小共享修改：把 `founder_ip_content_creator` 加入激活集合；Provider/Agent/MCP/FIP route 透传并记录脱敏终态；FIP 专属 `reasoning_high` 输出预算从已证实不足的 4096/8192 调整为有界 16384。未放宽授权、未改 Prompt、未启用重试或任何降级模型。
- 真实 PASS：修复后单请求通过，同套招商加盟、C 端团购到店、学员招募、合作方招募各 3 次达到 12/12，实际模型 `deepseek-v4-pro`、reasoning mode `reasoning_high`、fallback 0，延迟 43.534–102.149 秒。
- 副作用 PASS：13 条最终验证 trace 均为 Provider/route completed；本次 Eval 使用 `persist:false`，关联 AgentRun 0、积分交易 0。没有付费媒体、迁移、部署或生产配置变更。
- 门禁 PASS：`agent:smoke`、`fip:self-mcp-timeout-smoke`、`skill:mcp-resilience-smoke`、`mcp-request-cancellation-smoke.mjs`、API/Agent typecheck、`qa:founder-ip-acquisition`、`qa:fast`、`qa:regression`、`qa:full`。

### 交接

- 兰琪 LQ-14 的共享回归阻塞已解除，当前主检出区的原始 `qa:regression`、`qa:full` 已通过。
- FIP-04-02 只需继续桌面/390px E2E、失败/取消/刷新恢复与最终文档归档；不得重复发送模型批测，也不得自动开始新的 FIP 产品编码。
- 回滚点：回退 Provider 安全终态字段及 `FIP_CONTENT_MAX_TOKENS` 即可恢复旧运行行为；回退到 4096/8192 会重新触发已登记的 reasoning-only 截断，不能作为放行状态。生产未部署、未迁移。

## PLAT-03 美业行业产品级 WorkBuddy MCP 凭据与统一计费

状态：共享底层完成；BY-01 真实 WorkBuddy/网页 E2E 待产品任务继续（2026-08-21）

### 用户结果与边界

- 一个 `beauty-industry` 连接按 scopes 发现多个已实现工具；外部请求只凭 Bearer secret 推导 tenant/user/product/operatingEntity/Agent，不接受参数覆盖身份。
- 网页和 MCP 复用现有 CreditAccount、Agent/Skill 网关和 usage 记录；余额不足在 Provider 前拒绝，成功按实际积分结算，失败/超时/取消释放预留。
- 本任务不实现正式支付、充值、退款、运营后台、付费媒体、生产迁移或部署。

### 失败证据与根因

- 修复前 `scripts/beauty-industry-workbuddy-platform-smoke.ts` 稳定 FAIL：`beauty-industry product login is not registered`；现有 WorkBuddy 连接只有 Agent/tenant/user/token，不能表达 product/scopes/expiry，也没有调用前耐久积分预留。
- 根因是产品专属 BY-01 adapter/Skill/Eval 已完成，但共享 product/Agent/Skill 注册、凭据生命周期、MCP product 路由和 usage ledger 尚未串行合入。

### 实现与验证

- 加法注册 `beauty-industry`、`agent_beauty_acquisition` 和 3 个行业 Skill；7 个工具只复用已实现能力，图片只给零付费 prompt 预览，不暴露虚假生成动作。
- 凭据 secret 随机生成且只返回一次，服务端只存 hash/prefix；支持 scopes、到期、撤销、轮换、lastUsedAt、速率和审计。每次请求重查成员、Agent access、产品 entitlement、经营主体和 credential 状态。
- `CreditReservation` 在 Provider 前原子预留；同 requestId/credential/product 复用，冲突/既往失败 fail-closed；成功关联 AgentRun/交易，失败释放。单个计费请求某一 Provider 阶段失败后不再调用上游。
- 唯一迁移 `202608210001_beauty_industry_mcp_credentials` 在隔离库全量升级、幂等复跑、回滚和再升级均 PASS；历史 product 空连接继续原兼容路径。生产未迁移。
- PASS：美业 contract、8 类×3 policy Eval、共享平台 smoke、隔离数据库 JSON-RPC smoke、`qa:fast`、`qa:regression`、`qa:full`、`git diff --check`。

### 交接

- BY-01 现在只需用认证产品会话一次性领取测试 secret，执行真实 WorkBuddy、品牌中立网页、桌面/390px和刷新/断网 E2E；secret 不得进入聊天、日志或仓库。
- MCP URL 取 `WORKBUDDY_MCP_PUBLIC_URL`；仓库默认值不是上线证明，部署前仍需迁移、配置预检和在线 smoke。
- 回滚：先停止新 MCP 调用并备份 product usage/reservation，再运行该迁移目录的 `rollback.sql`；旧连接兼容数据不需要改写。正式环境未执行。
