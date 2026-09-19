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

## PLAT-04 思潼AI 智能体超市公共底座

状态：本地完成；数据库迁移已应用到 `sitong_os_v2`，浏览器 E2E 未执行（2026-09-08）

### 归属

- 产品：公共平台，服务未来第三方 Agent 入驻与统一计费。
- 层级：公共平台。
- 风险：中，涉及 Prisma 账本/权限模型和平台管理入口。
- 是否允许并行：否；不改变既有智能体输出。

### 用户结果

平台方获得四分区货架、SKU/供应商字段、统一积分账本、按次积分 + 人民币包月双轨、后端搜索与三态权限；主理人/运营可在平台管理端维护智能体、供应商和全局流水。

### 本次范围

- Prisma 新增 `MarketplaceSupplier`、`MarketplaceSku`、`MarketplaceSkuEntitlement`、`MarketplaceSubscription`、`MarketplaceSubscriptionOrder`、`MarketplaceLedgerEntry` 与配套枚举，以及迁移 `202609080001_marketplace_shelf_ledger`。
- 新增 `/market` 公开货架/搜索/详情/访问态/我的权益/按次扣费/包月订单接口，和 `/market/admin` 平台管理接口。
- 新增用户货架页 `/market` 和平台管理端 `/market/admin`。
- 按次使用走统一 CreditAccount/CreditTransaction，订阅为人民币独立付费并写入同源全局 ledger。

### 本次不做

- 不修改既有具体智能体输出、路由、Prompt、Skill 或计价执行链。
- 不接入真实微信支付或生产迁移。

### 验收条件

1. 正常路径：公开货架按四分区展示；后端搜索跨字段命中；按次扣费幂等；包月 mock-pay 生效。
2. 失败路径：未登录只读不购买；积分不足拦按次；无订阅 SKU 不支持包月。
3. 不应发生：订阅从积分钱包扣费；非 owner/运营/查看者访问平台管理端；离线/未知 SKU 被当作可购买。
4. 可观测：统一账本记录 ppu_consume 与 subscription_charge，管理端概览可汇总。

### 验证

- `pnpm marketplace:foundation-smoke`：PASS。
- `pnpm marketplace:api-smoke`：PASS（覆盖公开货架、后端搜索、统一钱包扣费、幂等、订阅、owner 管理端与 SKU 编辑）。
- `pnpm lint:structure`、`pnpm quality:assets`、`pnpm quality:evals`、`pnpm typecheck`：PASS。
- `pnpm qa:fast`：PASS。
- `pnpm build`：PASS。

### 交接

- 未运行：`pnpm qa:regression`/`qa:full` 未在本轮重跑；桌面/390px 浏览器 E2E 未执行。
- 已执行：本地 `prisma migrate deploy` 已成功应用全部 42 个迁移，`prisma migrate status` 显示 up to date。
- 残余风险：生产部署前仍需做配置预检；第三方供应商结算比例与真实支付分账仍需独立任务。
- 回滚点：删除/回滚 `202609080001_marketplace_shelf_ledger` 迁移并回退本轮源码，不影响既有 Agent 执行。

## PLAT-03 智能体超市用户端（四类页面 + 单点智能体对话任务流）

状态：已完成（用户端 UI 与对话任务流）

### 归属

- 产品：公共平台，服务智能体超市用户端。
- 层级：公共平台（用户端 UI + 内容契约）。
- 风险：中，新增路由与前端页面；不改既有智能体执行链。

### 用户结果

用户以「超市」心智浏览四业务分区货架、看详情、按次或包月开通，并在「我的智能体」查看余额与已购；公域获客 6 个单点 + 私域营销 2 个单点智能体可在对话工作台中按各自方法论逐轮完成任务流并查看三段式结果。

### 本次范围

- 新增 `apps/web/src/pages/AgentMarketplacePage.tsx`（货架 / 详情 / 购买 / 我的 + 对话工作台，复用 WorkBuddy 设计 Token，删除 proto-bar 演示工具）。
- 新增 `apps/web/src/marketplace/marketplace-data.ts`（四分区商品契约、8 个单点智能体的 welcome/enhance/slots/build 与报告结构）。
- 新增 `apps/web/src/styles/agent-marketplace.css`（作用域化 `.marketplace` 深空蓝+橙 Token）。
- `main.tsx` 增加 `/market`（用户端货架）、`/agent/:id`、`/agent/:id/buy`、`/mine` 路由；`/market/admin` 继续走 `MarketplaceAdminPage`。

### 本次不做

- 行业/套装智能体（餐饮 / 美业 / 全案套装）本轮只上架、不接任务流，待 WorkBuddy 补齐后再开分支。
- 对话产出尚未接真实 LLM + Skill；当前为按方法论的结构化结果契约，真实成稿需后端逐轮推导（公域 6 单点已有对应工作台，销售 / 朋友圈需新增）。
- 用户端货架/钱包当前使用 WorkBuddy 原型演示数据；接 `/market/*` 后端目录与统一钱包的运行时链路为下一独立任务。

### 验收条件

1. 正常路径：货架四分区 + 搜索 + 分区筛选；详情含变现锚定与双轨价格；按次/包月购买流程可走通；我的页显示余额与已购；8 个单点智能体逐轮问答后生成精简卡 + 完整版 + Word + 快捷追问。
2. 失败路径：积分不足进入充值引导；空信息直接生成被引导先答第 1 轮；行业/套装智能体「去使用」提示即将上线。
3. 不应发生：无 proto-bar；完整报告不塞进聊天气泡；已填信息不足的小节不编造为事实（标「续聊后推导」）。

### 验证

- `pnpm --filter @baolu/web typecheck`：PASS。
- `pnpm --filter @baolu/web build`：PASS。
- `pnpm lint:structure`：PASS。
- 浏览器 E2E（localhost:5174）：货架 / 详情 / 购买扣积分 / 我的 / IP定位 5 轮对话 + 完整版抽屉 + 空信息引导 均实测通过。

### 交接

- 未运行：`pnpm qa:fast`/`qa:regression`/`qa:full` 未在本轮重跑；移动端 390px 视觉与真实 Postgres 链路未执行。
- 残余风险：用户端 UI 目前是演示数据，正式发布前必须接 `/market/*` 后端目录与统一钱包，并把 8 个单点智能体产出路由到对应 Skill 的 LLM 成稿。
- 回滚点：`main.tsx` 将 `/market` 改回 `MarketplaceHomePage`、删除新增 3 个前端文件即回到 PLAT-02 基础状态，不影响平台管理端。

## PLAT-05 通用 WorkBuddy 访问令牌与统一钱包充值/扣费

状态：本地完成（2026-09-09）

### 归属

- 产品：公共平台，服务 WorkBuddy 与网页共用的统一积分钱包。
- 层级：公共平台。
- 风险：高，涉及访问令牌、幂等扣费、钱包入账和支付订单。
- 是否允许并行：否；不改既有智能体输出与 Skill 执行链。

### 用户结果

WorkBuddy 使用 `BillingAccessToken` 只推导思潼 tenant/user，读同一 `CreditAccount`；`/billing/precheck` 与 `/billing/consume` 支持 request_id 幂等与原子扣减；`/recharge` 页面完成充值、令牌管理、支付成功入账和行业智能体引流。

### 本次范围

- Prisma 新增 `BillingAccessToken`、`BillingConsume`，迁移 `202609090002_billing_access_token`、`202609090003_billing_consume`。
- 新增 `billing-access-tokens.ts`（生成/掩码/哈希/解析/失效）与 `/billing/access-tokens` 路由（列表/创建/轮换/撤销）。
- 新增 `billing-consume.ts` 与 `/billing/precheck`、`/billing/consume` 路由，Bearer 仅解析思潼账号，不读 WorkBuddy 用户标识。
- 新增前端 `/recharge` 页与 `recharge.css`，`main.tsx` 增加路由。
- 新增 smoke：`billing-consume-db-smoke.ts`、`billing-paid-order-db-smoke.ts`、`recharge-browser-smoke.mjs`，并登记对应 package scripts。

### 本次不做

- 不接真实微信支付；本地仅用 mock-pay 验证 `applyPaidOrder` 入账幂等。
- 不修改现有产品 Agent/Skill/Prompt/路由，不把订阅写进积分钱包。
- 不进行生产迁移、真实 WorkBuddy Connector E2E 或真实付款。

### 验收条件

1. 正常路径：令牌生成/掩码/轮换/撤销；precheck/consume 读同一 CreditAccount 并原子扣减；/recharge 显示与共享积分包一致的档位金额。
2. 失败路径：余额不足 consume 返回 402 与 `/recharge?from=workbuddy&skill=xxx`；无效/过期/撤销令牌返回 401。
3. 不应发生：出现「扣点」文案；订阅进入积分钱包；依赖 WorkBuddy 用户标识；余额扣成负数；同一 request_id 重复扣费。
4. 可观测：`CreditTransaction`、`BillingConsume`、`AuditLog` 记录幂等与生命周期事件。

### 验证

- `pnpm.cmd typecheck`：PASS。
- `pnpm.cmd billing:consume-db-smoke`：PASS（令牌、precheck、consume、402 链接、幂等、轮换/旧令牌失效）。
- `pnpm.cmd billing:paid-order-db-smoke`：PASS（credit_pack 入账一次、无订阅、账本一条）。
- `node scripts/recharge-browser-smoke.mjs`：PASS（桌面渲染、WorkBuddy 来源条、档位金额、令牌生成、登录回跳保留 query、无「扣点」）。
- `pnpm.cmd qa:fast`、`pnpm.cmd qa:regression`、`pnpm.cmd build`：PASS。
- `git diff --check`：PASS（仅 LF/CRLF 提示）。
- `pnpm.cmd --filter @baolu/db prisma:deploy`：两个新迁移已应用到本库。

### 交接

- 未运行：`qa:full`（本轮已分别执行 fast、regression、build）；真实微信支付与真实 WorkBuddy 外部 Connector E2E 未执行。
- 残余风险：生产上线前需配置预检、真实微信支付 smoke、迁移部署与回滚演练。
- 回滚点：回退 `202609090002`、`202609090003` 迁移并回退本轮源码，不影响既有 Agent 执行。

## PLAT-06 思潼AI 货架：IP 定位上架、7 内核「开发中」、兰琪专区与按次 Word 导出定价

状态：本地完成（2026-09-10）

### 归属

- 产品：公共平台货架，服务创始人 IP 获客专区与兰琪美业品牌专区。
- 层级：公共平台（货架目录契约 + 通用导出计费）。
- 风险：中高，涉及按次扣费、专区可见性和品牌专属内核的 fail-closed。
- 是否允许并行：否；不改既有单点智能体的 Skill 输出链与其它产品计费。

### 用户结果

- 创始人 IP 专区 9 个内核里，IP 定位智能体（200 积分/次）和文案智能体（40 积分/次）可售；其余 7 个内核（选题、视频复盘、直播话术、直播复盘、销售话术、朋友圈、IP 增长套装）显示「🚧 开发中」，货架可见但不可购买、不可运行、不扣积分。
- 兰琪美业经营大脑作为品牌专属内核进入独立「🧠 兰琪专区」，标「兰琪品牌 · 需授权」，当前为「开发中」占位。
- 任意智能体答案的「下载精美 Word」统一走 `/exports/docx`，按次独立扣 10 积分，不含在 40 积分等其它按次/包月计费里；按钮在点击前显示价格。

### 本次范围

- `apps/api/src/data/marketplace-v3.json`：ipzone 内核状态/价格定稿；新增 `lanqi-brain`（`zones:["lanqi"]`）与 `industries.lanqi`；`apps/api/src/data/` 为新增目录。
- `apps/api/src/services/marketplace-catalog.ts`：专区图标、专区 `skills` 白名单与内核 `zones` 白名单双过滤（`zoneSkillAllowList` / `skillZones`）。
- `apps/api/src/routes/marketplace.ts`：`coming_soon` 在 `/run` 与 `/ppu/consume` 返回 409 且不扣积分；货架展示（`/me`、访问态）与扣费（`/run`、`/ppu/consume`）统一到同一个用户双桶钱包。
- `apps/web/src/pages/MarketplaceApp.tsx`、`apps/web/src/components/chat/ChatMessages.tsx`：开发中态卡与禁用按钮、Word 按钮显示 10 积分。
- `packages/shared/src/index.ts`：`EXPORT_PRICING`（`docxVersion: 1`、`docxEffectiveAt: "2026-09-10"`、`docxCredits: 10`）；`apps/api/src/routes/exports.ts` 新增 `GET /exports/docx/price`，`POST /exports/docx` 交付物生成后按次扣费、失败不扣、同 `recordId` 幂等、余额不足 402 + `rechargeUrl`。
- 新增/更新 smoke 与 E2E：`marketplace-foundation-smoke.ts`、`marketplace-api-smoke.ts`、`marketplace-db-smoke.ts`、`marketplace-shelf-browser-e2e.mjs`。

### 本次不做

- 不开放 7 个「开发中」内核的真实生成；不把兰琪专区接进货架对话流（兰琪走自己的 8 板块工作台与产品授权）。
- 不做「合同级」Word 版式承诺（不加封面、目录；页眉页脚为既有基线，本轮未改，也未在文案里承诺封面+目录+页眉页脚）。
- 不改 WorkBuddy 计费令牌流程与其它产品仍在用的 `CreditAccount` 计费。
- 不做生产迁移、真实付款与生产配置变更。

### 验收条件

1. 正常路径：IP 定位 200 积分、文案 40 积分可售并可走通对话生成；任意智能体答案「下载精美 Word」扣 10 积分、可重复导出并按次递减；余额不足返回 402 与充值链接。
2. 失败路径：`coming_soon` 内核在 `/run`、`/ppu/consume` 返回 409（`marketplace_sku_coming_soon`）且余额不变；同 `idempotencyKey`/`requestId` 重复请求不重复扣费。
3. 不应发生：兰琪品牌内核出现在创始人 IP / 通用美业专区；货架展示余额与扣费不是同一个钱包；导出失败仍扣积分；Word 文案承诺封面+目录+页眉页脚。

### 验证

- `node scripts/marketplace-shelf-browser-e2e.mjs`：PASS。真实模型 1 次 IP 定位生成、真扣 200（合成钱包 1000 → 800）；货架 9 SKU、7「开发中」、兰琪专区 1 卡且详情「开发中 · 敬请期待」、IP 定位/文案价格正确、报告 11 张卡/选题 80 条门槛、Word 按钮「⬇ 下载精美 Word · 10 积分」、390px 无横向溢出、console 错误 0。
- `pnpm.cmd marketplace:db-smoke`：PASS（同源钱包 300→295、幂等、订阅 mock-pay、owner 改价）。
- `pnpm.cmd marketplace:api-smoke`、`pnpm.cmd marketplace:foundation-smoke`：PASS（19 SKU / 15 `coming_soon`、专区白名单、兰琪不出现在通用专区）。
- `pnpm.cmd qa:fast`：PASS。`pnpm.cmd qa:regression`：PASS。`pnpm.cmd build`：PASS（等价 `qa:full` 分段全绿）。
- `scripts/export-owner-isolation-smoke.ts`（在 `qa:regression` 内）：PASS，断言每次成功导出恰好扣 10 积分且不与其它计费合并、跨用户/跨租户不可下载。

### 交接

- 未运行：生产 E2E、真实微信/生产付款、生产迁移与回滚演练；兰琪专区的真实授权租户可见性未在生产验证。
- 残余风险：兰琪专区 `ready:true` 会参与「已上线专区」判定，当前用 `coming_soon` 卡 + 「需授权」徽标表达未开放；兰琪真正开放需另立任务补 capability 与 Eval（缺 capability 时货架 fail-closed）。
- 回滚点：回退 `apps/api/src/data/marketplace-v3.json` 的 ipzone 状态与 `lanqi` 专区/内核即回到 PLAT-04/05 状态；`/exports/docx` 计费回退 `EXPORT_PRICING` 与 `exports.ts` 两处即可。

## PLAT-07 思潼AI 货架：积分→人民币折算（≈¥）与按结果付费兜底「免费重做 1 次」

状态：本地完成（2026-09-10）

### 归属

- 产品：公共平台货架，作用于全部智能体答案（含 IP 定位、文案、后续内核与兰琪授权后的答案）。
- 层级：公共平台（标价展示 + 按次扣费兜底），不新开专区、不改任何单点智能体的 Skill 输出链。
- 风险：中高，涉及扣费语义（免费重做不能重复扣、不能被余额不足拦掉、不能跨账号/跨商品/链式白嫖）。
- 是否允许并行：否；与 PLAT-06 共用 `marketplace.ts` / `MarketplaceApp.tsx`，必须在 PLAT-06 之后串行。

### 用户结果

- 货架上所有积分价格旁统一显示人民币折算「≈ ¥X」，按基准「1 元 = 20 积分」折算且不随充值档位变化：顶栏钱包、卡片价、详情页价、套装/全链路价，以及聊天页「本次消耗」、确认需求、Word 导出按钮、余额卡、近期用量与 402 充值提示。
- 每个付费交付完成后，用户可对该单「免费重做一次」：不重复扣积分、余额被清零也能重做已购权益、每单限 1 次且不能顺链无限免费。

### 本次范围

- `packages/shared/src/index.ts`：新增 `creditsToYuan` / `formatYuanText` / `yuanLabelForCredits`，以 `CREDIT_PRICING.ptsPerYuan = 20` 为基准；只做展示、不参与定价公式。
- `apps/web/src/pages/MarketplaceApp.tsx`、`apps/web/src/components/chat/ChatMessages.tsx`：全面接入人民币折算；新增「😕 不满意 · 免费重做一次（不扣积分）」入口、免费重做成功文案与「本单重做机会已用完」提示。
- `apps/api/src/routes/marketplace.ts`：`marketplaceRunSchema.redoOf`、`resolveFreeRedo`、免费重做分支（跳过 402、复用 `recordRedo`、不静默降级为扣费）、响应字段 `freeRedo` / `freeRedoOf` / 新 `requestId`、账本 `adjustment` + `metadata.freeRedoOf`。
- 新增 `pnpm.cmd marketplace:free-redo-smoke`（`scripts/marketplace-free-redo-smoke.ts`）；更新 `scripts/marketplace-shelf-browser-e2e.mjs` 断言「≈ ¥」与免费重做按钮。

### 本次不做

- 不做价格配置化（ppu / 充值档 / 汇率走接口 + `version` / `effective_at` + 订单记 `price_version`），本轮汇率仍硬编码 1 元 = 20 积分。
- 不改 WorkBuddy 计费令牌流程与其它产品仍在用的 `CreditAccount` 计费；不新增专区、不上架兰琪「私域营销」。
- 不做「合同级」Word 承诺；不执行生产迁移、真实付款与生产配置变更。

### 验收条件

1. 正常路径：货架与聊天页在积分旁显示「≈ ¥」且折算正确（200→≈¥10、40→≈¥2、10→≈¥0.5）；付费交付后点「免费重做一次」扣 0 积分、余额不变、返回新交付并给出重做成功文案。
2. 失败路径：同一原单第二次重做 409 `marketplace_redo_exhausted`；跨 SKU 409 `marketplace_redo_sku_mismatch`；未知/跨账号凭证 404 `marketplace_redo_not_found`；余额清零后普通付费仍 402。
3. 不应发生：免费重做重复扣费或扣成负数；用重做产物的凭证再重做仍免费（链式）；跨账号/跨租户复用他人凭证；余额不足导致已购权益的免费重做被 402 拦掉；免费重做被静默降级为扣费。

### 验证

- `pnpm.cmd marketplace:free-redo-smoke`：PASS。真实模型调用 0 次、Provider 费用 ¥0（模型出口指向本进程内 `127.0.0.1` 桩）；11 组断言覆盖扣费一次、免费重做 0 积分、账本恰 1 条 `consume(-30)`+1 条 `redo(0)`、货架账本 2 条（`ppu_consume`/`adjustment`+`freeRedoOf`）、第二/链式/跨账号/跨 SKU/未知/零余额/对照 402/租户隔离。
- 修复前红灯：临时移除 `resolveFreeRedo` 的 `tenantId`/`userId` 归属过滤后脚本稳定 FAIL，恢复后 PASS（见 `docs/BUG_REGRESSIONS.md` QA-20260910-003）。
- `node scripts/marketplace-shelf-browser-e2e.mjs`：PASS（干净实例 `VITE_DIRECT_TEST_LOGIN=false`）。真实模型 1 次 IP 定位生成；货架「200 积分/次 · ≈ ¥10」「40 积分/次 · ≈ ¥2」、详情按钮「≈ ¥10/≈ ¥2」、Word「10 积分（≈ ¥0.5）」、本次消耗「200 积分（≈ ¥10）」、免费重做入口存在且可点、390px 无横向溢出、console 错误 0。
- `pnpm.cmd marketplace:api-smoke`、`marketplace:db-smoke`、`marketplace:foundation-smoke`、`marketplace:cost-smoke`：PASS。
- `pnpm.cmd qa:fast`、`pnpm.cmd qa:regression`：PASS。

### 交接

- 未运行：`qa:full` / `build`（本轮分段执行 fast + regression + 各专项已覆盖）；生产部署、真实付款未执行。
- 残余风险：汇率硬编码，充值档与有效价未落库版本，后续若要改汇率需走配置化任务；免费重做是「每单 1 次」的服务端账本权益，跨端/跨天以账本为准。
- 回滚点：回退 `marketplace.ts` 的 `redoOf`/`resolveFreeRedo`/免费重做分支与 `packages/shared` 折算函数、前端接入，即回到 PLAT-06「重新生成一律按次扣费」状态。

## PLAT-08 请求身份只认验签会话：修复 `x-sitong-*` 裸头冒充任意租户（P0）

状态：已交付（测试实例 + 生产已发布并复验）；发布与复验记录见 `docs/CURRENT_DEPLOYMENT_STATUS.md` 顶部条目

### 归属

- 产品：公共平台（跨全部产品、全部智能体的身份与租户隔离底座）。
- 层级：公共平台（认证/租户隔离），不新开专区、不改任何智能体的 Skill 输出链。
- 风险：高。身份来源即安全边界，改错会一次性打死所有登录用户或继续放行冒充者。
- 预计修改热点：`apps/api/src/services/request-context.ts`、受影响测试夹具与运维脚本、`package.json` 的 `qa:fast`。
- 是否允许并行：允许（只碰身份解析与夹具，不改货架/兰琪业务逻辑）。同一时刻不得再有第二个编码任务改 `request-context.ts`。

### 用户结果

任何人（包括从分享链接、路由、日志里捡到 `tenantId` / `userId` 的陌生人）都必须先完成微信登录拿到真令牌，才能读到该租户的门店、画像、驾驶舱与钱包数据；「手里有两个 ID」不再等于「拥有该租户身份」。

### 本次范围

- `apps/api/src/services/request-context.ts`：database 模式下身份**只来自** `verifySessionToken` 验签通过的会话令牌；无有效令牌且无运维凭证时按既有语义返回 401 `login_required`。有效令牌 + 伪造头仍以令牌为准。
- 唯一例外是内部运维通道 `hasValidOpsCredential`：`OPS_TOKEN` 非空 + `x-sitong-ops-token` 常量时间匹配才承认裸 `x-sitong-*` 头；未配置 `OPS_TOKEN` 即整体关闭（fail-closed，不走「开发环境无令牌即放行」的宽松分支）。
- `scripts/identity-header-spoof-smoke.ts`：新增 P0 自动回归（真实路由 + 合成 membership/entitlement 桩，30 条断言），接入 `qa:fast`。
- `scripts/lib/db-session-headers.ts`：10 个 database 模式夹具（marketplace / wallet / billing / 兰琪资产作用域 / WorkBuddy MCP）由裸身份头改为真实 Bearer。
- `scripts/lib/internal-ops-identity.mjs`：6 个运维脚本（生产 AI 记录、生产选题录制、BY09、BY17 两条、XHS 离线审计）改走显式运维凭证，取不到令牌即报错退出。

### 本次不做

- 不做密码学凭证模型改造（不引入 mTLS / 短期服务令牌 / OIDC）；不引入新的身份字段或数据库迁移。
- 不改产品授权层（`requireProductEntitlement` 与 403 语义保持原样）；不改登录/注册与微信 OAuth 链路。
- 不把 `x-sitong-ops-token` 通道做成公网长期方案（仅作为本轮最小改动下的运维例外，后续项见「交接」）。

### 验收条件

1. 正常路径：手上持有真实会话令牌的兰琪租户读 `/lanqi/stores`、`/account/status` 返回 200，身份取自令牌（`tenantId`/`userId`/`role` 与令牌一致）。
2. 失败路径：裸 `x-sitong-tenant-id`/`x-sitong-user-id`（含配无效 Bearer、过期签名、只给一个、随机 ID、伪造同租户他人、伪造别的租户 owner、`internal-*` 合成身份）一律 401，且**不得触达 membership / entitlement 查询**；令牌指向不存在的成员关系 401；有效令牌访问未开通产品 403（授权问题不等于身份问题）。
3. 不应发生：用无效 Bearer 覆盖掉身份校验；用一个租户的 ID 读到另一个租户的数据；裸头请求把「猜 ID」变成数据库查询（用户名/租户枚举副作用）；修好后真实登录用户被误判未登录。
4. 可观测结果事件：401 `login_required`（身份缺失）与 403 `product_entitlement_missing`（已识别身份但无授权）保持可区分；`missing_tenant_or_user` 不再由裸头满足。

### 基线与失败证据

- 基线命令：`pnpm.cmd qa:fast`（含 `auth:product-login-smoke`、`db:client-model-check`）。
- 修复前失败测试：`pnpm.cmd auth:identity-header-spoof-smoke` → 16 passed / **14 failed**（红灯点＝裸头必须 401 却 200）。
- 现象、根因和连带影响：见 `docs/BUG_REGRESSIONS.md` QA-20260911-002（含生产外网实测矩阵）。根因是 database 分支 `tokenPayload?.tenantId ?? tenantId` 无令牌时直接采信请求头；连带影响是全部走 `resolveRequestContext` 的读写接口都可被无凭证冒充。

### 实现记录

- 修改文件：`apps/api/src/services/request-context.ts`（身份来源 + `hasValidOpsCredential`）；新增 `scripts/identity-header-spoof-smoke.ts`、`scripts/lib/db-session-headers.ts`、`scripts/lib/internal-ops-identity.mjs`；改写 10 个夹具与 6 个运维脚本；`package.json`（新增 `auth:identity-header-spoof-smoke`，接入 `qa:fast`）。
- 数据/接口/配置变化：无数据库迁移、无接口签名变化。新请求头 `x-sitong-ops-token` 仅在 `OPS_TOKEN` 配置时生效；生产 `OPS_TOKEN` 为 80 字符随机值。
- 兼容性和回滚点：回滚 = 还原 `apps/api/src/services/request-context.ts` 一处（其余为测试/脚本与 `package.json`），即回到「裸头可用」状态；夹具与运维脚本改回裸头会同时恢复漏洞用法，不单独回滚。

### 验证

- 领域命令：`pnpm.cmd auth:identity-header-spoof-smoke` → 30 passed / 0 failed；`pnpm.cmd export:owner-isolation-smoke`、`billing:wallet-db-smoke`、`marketplace:db-smoke`、`marketplace:free-redo-smoke`、`lanqi:moments-asset-scope-smoke` 全 PASS。
- `pnpm.cmd qa:fast`：PASS（exit 0，含新用例 30/30 + 全仓 typecheck 7/7）；`pnpm.cmd qa:regression`：PASS（exit 0）。
- 生产发布后复验（2026-09-11，测试实例 + 生产同一发布包，两侧 `DEPLOY_OK`）：
  - 发布：包 `release-20260911-identity-p0-prod1.tar.gz`（8900152 B，sha256 `5e5ca99d123133bcdd8b88a9eef895329c61ab059c983afa77cc220055299e5f`，1426 文件）；发布 id `20260911-identity-p0-test1`（chat-test，健康 200 after 9s）/ `20260911-identity-p0-prod1`（生产，健康 200 after 15s），ready 均 200，48 个迁移无待应用，第 7b 步 `prisma client model coverage OK: 99 models`。
  - 正路仍通（服务器本机 3002，生产 `JWT_SECRET` 现签真实会话令牌）：`/lanqi/stores`、`/lanqi/store-profile`、`/lanqi/dashboard?month=2026-09`、`/lanqi/goals?month=2026-09`、`/lanqi/moments/upgrades?storeId=…`、`/beauty-industry/stores`、`/market/skus` 全部 **200**；正确 `OPS_TOKEN` 的运维通道 `/lanqi/stores` 200，错误令牌 401。
  - 冒充仍被拒（外网实测）：匿名 401、裸头 401、裸头 + 无效 Bearer 401、裸头 + 错误 ops 令牌 401、对照租户裸头 401；对照组真实令牌访问未开通产品 **403 `product_entitlement_missing`**（未把授权问题误判成身份问题）。
  - 公开面未受影响：`/health`、`/ready`、`/auth/wechat-config`、`/market/skus` 200。运行面 `baolu-os-v2` `NRestarts=0`，`journalctl -p err` 自重启点后无新增错误（记录见 `docs/CURRENT_DEPLOYMENT_STATUS.md`）。
- 未运行项：`qa:full`（本轮以 `qa:fast` + `qa:regression` + 受影响的 5 条专项覆盖；跨模块改动建议下次发布前补跑）。
- 已知既有失败（非本轮引入，`git stash` 对照证明）：`billing:consume-db-smoke`、`billing:paid-order-db-smoke`、`marketplace:live-run-smoke`。

### 交接

- 残余风险：`x-sitong-ops-token` 是共享密钥通道，仍可从公网探测（缓解：80 字符随机值 + 常量时间比较 + 未配置即关闭）。后续项：把它收敛到仅本机/内网可达，或改用 SSH 隧道/一次性签发令牌。
- 残余风险（P3，本轮复验时观察到）：未登录请求走 `missing_tenant_or_user` 抛错路径，Fastify 以 `level:50` 记 err，匿名扫描会在 journal 里堆出错误级噪声；对外状态码与文案都正确，仅在下一轮顺手把该分支降级为不高于 warn 的记录或改用不抛错的 401 返回。
- 后续任务：① 处理三条既有失败专项；② `complex-agent-live-eval.ts`、`verify-founder-ip-goal-briefs.ts` 若在 database 模式下打本机端口，需同法改走运维凭证通道；③ 收敛 `x-sitong-ops-token` 的公网可达性。
- 最后更新日期：2026-09-11

## PLAT-09 思潼AI 货架：上架「视频复盘」智能体（深度/快速双模式 + 十章硬口径）

状态：开发中（本地已实现 + 自动/页面验收通过；正式开卖状态待用户确认）

### 归属

- 产品：创始人 IP 专区（`ipzone__vidrev`，另有美业镜像 `meiye__vidrev`），作用于短视频复盘场景。
- 层级：公共平台（货架 SKU + 智能体运行链）叠加产品专用输出契约；不改身份/扫码链路，不改兰琪专区上架。
- 风险：中高，涉及按次扣费（60 积分/次、失败不扣、免费重做 1 次）、结构化数据解析与硬口径校验。
- 预计修改热点：`apps/api/src/services/video-review-engine.ts`、`apps/api/src/routes/marketplace.ts`、`apps/web/src/marketplace/vidrev-report.tsx`、`apps/web/src/pages/MarketplaceApp.tsx`、`apps/web/src/marketplace/chat-flows.ts`、`apps/web/src/styles/sitong-design.css`、`package.json`。
- 是否允许并行：否；与货架其它智能体共用 `marketplace.ts` / `MarketplaceApp.tsx`，须串行。

### 用户结果

用户从货架进入「视频复盘」智能体，用快捷选项选「深度复盘 / 快速诊断」、平台、统计周期，粘贴后台数据表或口头描述；系统用同一份数据重算出可复算的口径，产出「第零章数据质量审计 + 十章深度复盘」（或快速诊断精简版），并给出候选选题一键带入选题池；不满意可免费重做一次。

### 本次范围

- `apps/api/src/services/video-review-engine.ts`（新建）：纯确定性引擎。导出 `computeVidrevMetrics` / `parseVidrevRowsFromText` / `validateVidrevReport` / `vidrevMetricBrief` 等；实现加权比率（Σ互动÷Σ播放）、中位数基线、四象限（高≥中位数×1.5、低<中位数×0.6、中间带按播放基线二分）、自适应 3–5 时长桶、健康度、赞分享比阈值，以及输出契约校验 V0–V12；缺字段一律 `null`（禁止补 0）。深度 payload 带逐条明细 `videos[]` 供前端四象限筛选 / 明细卡 / CSV 导出。
- `apps/api/src/routes/marketplace.ts`（改）：`marketplaceRunSchema` 增 `mode/platform/period/rows/has_revenue_data`，`input` 对 vidrev 可空；vidrev 结构化 rows 优先、否则文本解析；深度 0 行 → 422 `V0` 不扣费；后端重算口径 + 明细表注入模型，模型只做归因；输出走 `validateVidrevReport`，失败自动纠错重跑一次，仍失败 → 422 不扣费；响应新增 `payload`。扣费只在模型交付成功后。
- `apps/web/src/marketplace/vidrev-report.tsx`（新建）：结构化渲染，落实样例 §七（第零章置顶不可折叠 + 黄底受限维度、四象限 2×2 点击筛选、配比堆叠条、均值+中位数双柱、候选选题「＋加入选题池」写 sessionStorage 跳选题智能体、导出 Markdown/CSV、底部原文折叠、空值显示「数据缺失」）。
- `apps/web/src/pages/MarketplaceApp.tsx`（改）：`ChatItem.payload` 联合 `VidrevPayload`、选题预填 `prefill`、`buildRunBody` + `redoOf`、快捷选项按钮（`.chat-choices/.chat-choice`）、`isVidrevPayload` 分发渲染。
- `apps/web/src/marketplace/chat-flows.ts`（改）：vidrev 4 轮（模式/平台/周期/数据），`ChatSlot.choices`；`buildVidrevRunBody()` 结构化入参、`has_revenue_data` 正则判定成交口径。
- `apps/web/src/styles/sitong-design.css`（改）：`.vrv-*` 全套 + `.chat-choices`；移动端补真实断点（`@media max-width`）——`body[data-device]` 被 `main.tsx` 固定为 desktop，仅靠它移动端规则永不命中。
- `package.json`：新增 `marketplace:vidrev-contract-smoke`、`marketplace:vidrev-run-smoke`、`marketplace:vidrev-browser-e2e`。
- 新增验收脚本：`scripts/marketplace-vidrev-contract-smoke.ts`（离线）、`scripts/marketplace-vidrev-run-smoke.ts`（真实 API+模型）、`scripts/marketplace-vidrev-browser-e2e.mjs`（真实浏览器）。

### 本次不做

- 不把 `ipzone__vidrev` 从 `coming_soon` 改为 `selling`（正式开卖前必须用户确认）；不动 `marketplace-catalog.ts` 里遗留的 vidrev ppu 常量。
- 不改身份/扫码/微信 OAuth；不上架兰琪「私域营销」（另一个任务）；不部署到 `chat`/`chat-test`（本轮不部署）。
- 不为 vidrev 单独新增数据库表或迁移；`videos[]` 走运行响应内联，不落库。

### 验收条件

1. 正常路径：货架进入视频复盘 → 快捷选项选「深度复盘 / 抖音」→ 填周期 + 粘贴 6 行中文表头 CSV → 确认生成 → 渲染第零章置顶（不可折叠）+ 十章结构、四象限可点击筛选出逐条明细、配比堆叠条、均值+中位数双柱、候选选题带「加入选题池」、CSV/Markdown 导出、原文折叠；本次消耗 60 积分。
2. 失败路径：深度模式 0 条可解析数据 → 422 `marketplace_output_invalid`（V0）且不扣费；模型输出不合契约 → 自动纠错重跑一次，仍失败 422 不扣费；余额不足 → 402；SKU 未开卖 → 409。
3. 不应发生：缺字段被当成 0 参与加权 / 分桶 / ROI；四象限条数之和 ≠ 总条数；模型自由发挥覆盖重算口径（四象限/健康度/中位数必须来自引擎）；深度报告漏章或出现 H3/H4；违禁词扫描误伤非候选选题正文；失败仍扣费；快速→深度升级同一 `request_id` 重复扣费；跨租户串数据。
4. 可观测结果事件：响应 `consumedCredits=60` / `state=completed` / `payload.kind=vidrev` / `payload.mode=deep|quick`；失败 `422` 带 `reasons` + `failed_rules`。

### 基线与失败证据

- 基线命令：`pnpm.cmd marketplace:vidrev-contract-smoke`（引擎与脚本同为本次新增，先建离线契约脚本再补引擎）；页面基线用已启动的 `dev:api`(3011) + `dev:web`(5174，`VITE_DIRECT_TEST_LOGIN=false`)。
- 修复前失败测试/Eval：契约冒烟初版报「四象限 id 不在 `videos[]`」「`completion_5s` 未保持 `null`」「`v6` 的 `is_paid/ad_spend` 丢失」；浏览器 E2E 初版报「点『确认，开始生成』后未出现 `.vrv` 报告」与「390×844 出现横向溢出」。
- 现象、根因和连带影响：只靠模型写报告会自由发挥口径（四象限 / 健康度 / 中位数不可复算），根因是缺少确定性引擎与输出契约校验，连带影响是「不合契约也可能照扣 60 积分」。改为「引擎重算口径 + 模型只做归因 + 校验失败自动纠错一次，仍失败 422 不扣费」。
- 反向验证：把 `packages/skills/skills/baolu_review_engine/contract.json` 的 `requiredSections` 改成 vidrev 新十章后，`pnpm.cmd beauty-industry:video-data-review-runtime-p1-smoke` 立即报 `beauty_workflow_output_contract_failed:missing_趋势预警`；已回退，证明该 contract 属于 legacy 美业链路，不能当 vidrev 契约。
- 模型排版漂移红灯（2026-09-11，详见 `docs/BUG_REGRESSIONS.md` QA-20260911-006）：真实模型对同一份合法数据偶发 422 拒付，判定 `V9 规律「时间」没有指名支撑视频` + `V10 方法论沉淀必须 ≥2 条，实际 1 条`。加 env 门控排障落盘（`VIDREV_DEBUG_DUMP_DIR`）后 deep 循环第 1 次即复现，拿到模型原文 `scripts/tmp/vidrev-debug/vidrev-first-2026-09-11T00-16-03-556Z.md`。根因是解析/供给问题而非内容不合格：① prompt 引导「类型 / 规律 / 证据 / …」单行串联，旧 V10 切分只认「行首 `1. 类型`」→ 只解析出 1 条；② 注入模型的明细表没有「发布时间」列，第八章却要求「时间」维度指名支撑视频 → 模型只能写「数据缺失」被判 V9。

### 实现记录

- 修改文件：`apps/api/src/services/video-review-engine.ts`（新建）、`apps/api/src/routes/marketplace.ts`、`apps/web/src/marketplace/vidrev-report.tsx`（新建）、`apps/web/src/pages/MarketplaceApp.tsx`、`apps/web/src/marketplace/chat-flows.ts`、`apps/web/src/styles/sitong-design.css`、`package.json`；新增 `scripts/marketplace-vidrev-contract-smoke.ts`、`scripts/marketplace-vidrev-run-smoke.ts`、`scripts/marketplace-vidrev-browser-e2e.mjs`。
- 数据/接口/配置变化：`marketplaceRunSchema` 增 `mode/platform/period/rows/has_revenue_data`，vidrev 的 `input` 可空；深度响应新增 `payload`（含 `videos[]` 明细）；`packages/skills/skills/baolu_review_engine/contract.json` 只新增文档性 `marketplaceChapterContract`（不参与 legacy 门禁），`packages/agent/evals/sample-grade-cases.json` 增 3 条 vidrev 脱敏回归。
- 兼容性和回滚点：SKU 仍是 `coming_soon`，未开卖即无外部影响；无数据库迁移、无新表，回退只需撤销上述文件。`marketplaceChapterContract` 为新增字段，改动前请确认没有消费方按「未知字段即报错」解析 `contract.json`。
- 第二轮修复（QA-20260911-006，模型排版漂移误伤）：`apps/api/src/services/video-review-engine.ts` 新增 `parseMethodologyBlocks()`（去 `**`、`／`→`/`、行内字段名拆行，再按行首「类型：」切条；整章表格按表头列名兜底）；V9 增 `hasPublishTime`，仅当数据完全没有发布时间才允许「时间」维度写「无」；`vidrevMetricBrief()` 增「周度基线」段供第七章照抄。`apps/api/src/routes/marketplace.ts` 的 `vidrevRowsTable()` 增「发布时间」列（缺则「数据缺失」），system prompt 收紧发布时段判定与第九章排版（≥2 条、各字段独占一行、禁止「/」串联），纠错重跑文案同步。新增 env 门控排障落盘 `dumpVidrevDebugOutput`（仅在显式设置 `VIDREV_DEBUG_DUMP_DIR` 时写盘）。

### 验证

- 领域命令：`pnpm.cmd marketplace:vidrev-contract-smoke` PASS；`pnpm.cmd marketplace:vidrev-run-smoke` PASS（deep `consumedCredits=60`、quadrant both1/playsNoConv2/convNoPlays1/neither2、healthScore 0.333 🟡；quick PASS；v0 → 422 `failedRules=["V0"]`；redo `consumedCredits=0/freeRedo=true`；isolation `foreignLedger=0`）。
- 排版漂移回归（2026-09-11）：`scripts/marketplace-vidrev-contract-smoke.ts` 新增 `checkModelFormatDrift()`（行内「/」串联 / 加粗+缩进 / 整章表格三种排版都必须解析出 2 条且不判 V10；红灯守护：仅 1 条仍判 V10、缺「证据」仍判 V10、无发布时间不判 V9、有发布时间写「无」仍判 V9）→ `pnpm.cmd marketplace:vidrev-contract-smoke` PASS；`pnpm.cmd marketplace:vidrev-run-smoke` 真实模型全量**连续 3 次 PASS**（`$env:NODE_ENV='test'` + `VIDREV_DEBUG_DUMP_DIR` 落盘就绪）；`pnpm.cmd beauty-industry:video-data-review-runtime-p1-smoke` PASS（legacy 美业视频复盘链路未被新十章带坏）。
- 页面/E2E：`pnpm.cmd marketplace:vidrev-browser-e2e` PASS —— `heads` 为第零章「⓪ 数据质量审计」置顶 + 十章；`quadCells=4`、`candidates≥2` 且带「加入选题池」、导出按钮两条、`details.vrv-raw` 存在、`costText=本次消耗 60 积分`、桌面 `overflow=0`、移动 390×844 `overflow=0`、`consoleErrors=0`。
- `pnpm.cmd typecheck`：PASS。
- `pnpm.cmd qa:fast`：PASS。
- `pnpm.cmd qa:regression`：PASS（日志末尾 `quality:continuous-smoke ok:true`、`quality:daily-startup-smoke` 可解析）。
- 文档门禁：`pnpm.cmd quality:assets` PASS；`pnpm.cmd quality:evals` PASS（21 条用例），`quality:evals` 仅有 1 条提示性 warning：快速模式用例的 `快速诊断/立即动作/判定` 未在 `contract.json` 声明（该 contract 归 legacy 链路，不能加）。
- 未运行项：`pnpm.cmd qa:full`（本轮不部署、无跨模块生产改动，`qa:fast + qa:regression + typecheck` 已覆盖）；`pnpm.cmd quality:run-model`（需真实模型跑 21 条 Eval，成本与时长另排）；真人微信扫码验收（用户 9 点后自带结果，另线程处理）。本轮未部署到 `chat-test`/`chat`。

### 交接

- 残余风险：移动端断点是在 `@media` 里补的兜底（`apps/web/src/main.tsx:39` 把 `body[data-device]` 固定为 `desktop`，仅靠它移动端规则永不命中）；vidrev SKU 仍 `coming_soon`，正式开卖前必须用户确认；`marketplaceChapterContract` 只是文档性元数据，真正门禁在 `video-review-engine.ts`；模型排版漂移只做到「三种已知写法兼容 + 红灯守护」——新增第四种写法仍会 422（不扣费、自动纠错一次），如再出现按 QA-20260911-006 的 `VIDREV_DEBUG_DUMP_DIR` 流程取原文补解析；排障开关 `dumpVidrevDebugOutput` 保留在 `marketplace.ts`，生产未设置 `VIDREV_DEBUG_DUMP_DIR` 时不落盘。
- 后续任务：① 开卖前把 `apps/api/src/data/marketplace-v3.json` 的 vidrev 改为 `selling`（需用户确认）；② 是否把 legacy 美业视频复盘链迁移到 vidrev 新十章口径，作为独立任务评估（会改动 `assertPrimaryContract` 依赖的 contract，不能顺手改）。
- 最后更新日期：2026-09-11

## PLAT-10 思潼AI 体验额度：销售审核后定向发放（幂等手工发放 + 数值口径）

状态：开发中（发放工具与回归已通过；**发放数值已确认：默认 400 积分 / 3 天**；到期回收方式仍是运营口径、系统不强制；未对任何真实账号执行发放；销售自助页面见 PLAT-11）

### 归属

- 产品：公共平台（用户级钱包 / 货架计费），服务所有已上架与在开发智能体的「体验→充值」转化漏斗。
- 层级：公共平台；不改身份与扫码链路，不改任何智能体的输出契约。
- 风险：高（直接写用户体验余额，属资金侧）。控制手段：不自动发放、不改注册赠送口径、幂等键 + 单笔硬上限 + 归属校验 + dry-run。
- 预计修改热点：`scripts/grant-marketplace-trial-credits.mjs`（新建）、`scripts/marketplace-trial-grant-smoke.ts`（新建）、`package.json`。
- 是否允许并行：允许；不触碰 `apps/api/src/routes/marketplace.ts`、`apps/web/src/pages/MarketplaceApp.tsx` 等货架热点文件。

### 用户结果

用户拿到链接自己扫码注册登入 → 销售/老板确认真实商家身份 → 由人定向发放体验额度 → 用户在货架直接跑智能体（IP 定位 / 文案 / 视频复盘…）判断能不能解决自己的问题 → 需要继续用就充值，充值后所有已开发智能体正常扣费使用。

### 本次范围

- 新增 `scripts/grant-marketplace-trial-credits.mjs`（运维 CLI）：
  - 身份定位四选一 `--user-id` / `--phone` / `--wechat-openid` / `--wechat-unionid`；找不到用户报 `user_not_found`（即必须先自己注册登入），命中多个报 `user_ambiguous`；可选 `--tenant-id` 校验工作区归属，避免发到同一个人名下的另一个工作区。
  - 额度写入**用户级钱包 `bonus` 桶**（货架展示与扣费同源），不写租户级遗留 `CreditAccount`；`--operator` 记入流水的 `refOrderId`。
  - 幂等键为 `trial_grant:<grant-id>`（流水 `source`）：重复执行返回 `already_applied` 且不重复加币；同一 grant-id 换金额报 `grant_id_conflict`。
  - 单笔金额硬上限 800 积分；`--dry-run` 零写入；`--valid-days` 只打印运营建议到期日。
- 新增回归 `scripts/marketplace-trial-grant-smoke.ts`，以及命令 `marketplace:credits:trial-grant`、`marketplace:trial-grant-smoke`。

### 本次不做

- 不自动赠送任何积分：新用户注册仍是 0，`NEW_USER_*_TRIAL_CREDITS` 只留给隔离测试环境。
- 不给 `Wallet` 增加 `trialBonusBalance` / `trialBonusExpiresAt`，不做「到期自动回收」——那是对资金主链（`consumeWalletCredits`）的改动，需独立建卡 + 红灯回归。
- 不做销售自助后台页面；当前入口是运维 CLI，销售侧先靠「销售报 → 运营代发」。
- 不把任何 `coming_soon` SKU 改成 `selling`。

### 推荐数值（待用户确认）

SKU 现有单价（积分/次，1 元 = 20 积分）：IP 定位 200、直播话术 200、直播复盘 100、视频复盘 60、销售话术 60、文案 40、选题 40、朋友圈文案 20。

| 体验包 | 积分 | 折算 | 能跑完的量 | 适用对象 |
|---|---|---|---|---|
| 轻量 | 200 | ≈ ¥10 | IP 定位 ×1，或文案 ×5，或视频复盘 ×3 | 还没确认预算、纯试水的商家 |
| 标准（默认推荐） | 400 | ≈ ¥20 | IP 定位 ×1 + 文案 ×3 + 视频复盘 ×1（余 20） | 大多数已确认真实身份的商家；够走完「定位→出内容→看数据」一次闭环 |
| 深度 | 600 | ≈ ¥30 | IP 定位 ×2 + 文案 ×3 + 视频复盘 ×1 | 已进入选型/比价、明确要买的商家 |

有效期口径（**2026-09-11 用户拍板确认**）：**默认 400 积分 / 3 天**（运营口径记录，系统当前不强制回收，回收靠人工核对）。

理由（用户决策）：用 3 天短窗制造紧迫感、把客户往充值转化推；同时靠 400 积分上限兜住消耗量——真正限制「3 天消耗量太大」的是**积分上限**（400 积分 = 最多 2 次 IP 定位，物理上跑不超），时间窗本身并不解决消耗量。因此现阶段是「积分封顶 + 运营口径 3 天有效期」，等有真实数据再决定要不要做硬性到期回收。

### 验收条件

1. 正常路径：对已注册用户执行 `--amount 400 --valid-days 3 --grant-id <日期-销售-客户>` → 钱包 bonus +400、paid 不变、产生 1 条 `type=bonus/bucket=bonus/source=trial_grant:<id>` 流水，货架上可直接扣费跑智能体。
2. 失败路径：未知手机号 → `user_not_found`；同一 grant-id 换金额 → `grant_id_conflict`；金额 0 或 >800 → 参数错误；`--tenant-id` 与用户工作区不符 → `tenant_mismatch`；余额不足时跑智能体 → 402 且不产生消耗流水。
3. 不应发生：重复执行同一 grant-id 重复加币；体验额度写进租户级 `CreditAccount` 造成双账本口径分叉；给 B 发额度改变 A 的余额；`--dry-run` 改余额或写流水；注册即赠送积分。

### 基线与失败证据

- 基线：`scripts/signup-welcome-wallet-smoke.ts` 锁死「注册 0 积分、无欢迎流水」（生产口径）。
- 红灯守护（本轮实测两条，均为临时注入缺陷后立即回退）：
  1. 把发放从 `bonusBalance` 改成 `paidBalance` → `pnpm.cmd marketplace:trial-grant-smoke` 立即 FAIL（`grant reports created with bonus_balance=400 ... bonus_balance=0;paid_balance=400`）。
  2. 关掉 `source` 幂等查询（改为按不存在的 id 查询）→ 同一脚本 FAIL（`replay reports already_applied` 不成立，重放后 `bonus_balance=800`，即真实双发）。

### 实现记录

- 修改文件：新增 `scripts/grant-marketplace-trial-credits.mjs`、`scripts/marketplace-trial-grant-smoke.ts`；`package.json` 新增两条命令。
- 数据/接口/配置变化：无数据库迁移、无新接口、无 env 新增；只写既有 `Wallet.bonusBalance` 与 `WalletLedger`。
- 兼容性和回滚点：不改变任何运行时或注册行为；回滚即删除两个脚本与两条命令。真实发放过的额度不会被回滚（需用 `grant-id` 反查流水后人工处理）。

### 验证

- `pnpm.cmd marketplace:trial-grant-smoke`：PASS（覆盖正常发放、bonus 桶落点、租户账本不被写、幂等重放、金额冲突、金额边界、缺身份参数、未知手机号、租户不匹配、dry-run 零写入、用户间隔离、体验额度真实扣费与不足拦截）。
- 红灯：上述两条注入缺陷均实测 FAIL，回退后复跑 PASS。
- `pnpm.cmd lint:structure`：PASS。
- 未运行：`qa:full`（无跨模块改动）；生产/测试环境真实发放（等用户确认数值与对象）；页面验收（本轮无 UI 变更）。

### 交接

- 残余风险：体验额度目前与充值赠送共用 `bonus` 桶，**无法按笔区分是否过期**，因此「3 天到期自动回收」当前不可实现也不可承诺；单笔上限 800 是脚本硬编码，改上限需改代码；销售自助发额度还没有界面，销售需把手机号/微信号报给运营。
- 后续任务：① 按确认后的数值执行首次真实发放；② 若确认要硬性到期回收，另建 PLAT-11（Wallet 增 `trialBonusBalance` + `trialBonusExpiresAt` + 扣费优先级 paid→trial→bonus + 过期懒回收 + 红灯回归）；③ 若销售要自助，另建「运营后台体验额度发放页」。
- 最后更新日期：2026-09-11

## PLAT-11 思潼AI 运营后台：体验额度发放页（销售/运营自助发放 + 平台凭证守卫）

状态：开发中（本地已实现 + HTTP 回归已绿 + 类型检查通过；页面浏览器验收与 `qa:full` 未执行，本轮不部署）

> 编号说明：PLAT-10 交接里「硬性到期回收」也占用了 PLAT-11 这个号。本轮把 PLAT-11 归给**已在本轮交付的自助发放页**（即 PLAT-10 交接 ③），到期回收需求顺延为 PLAT-12 候选，避免一个编号指向两件事。

### 归属

- 产品：公共平台（用户级钱包 / 货架计费）。服务 PLAT-10 的「销售审核后定向发放」从「运维跑 CLI」变成「销售/运营在页面上自己发」。
- 层级：公共平台 + 管理端 UI；不改身份与扫码链路，不改任何智能体的输出契约，不改钱包扣费主链。
- 风险：**高（资金侧）**。本轮实测发现并修掉一个 P0：新入口只校验租户角色，任何商家 owner 都能给自己发积分（详见 `docs/BUG_REGRESSIONS.md` QA-20260911-009）。
- 是否允许并行：否；与货架其它任务共用 `apps/api/src/routes/marketplace.ts` 与 `apps/web/src/pages/MarketplaceApp.tsx`，须串行。

### 用户结果

销售/运营确认真实商家身份后，打开后台发放页，填客户身份（手机号 / 微信 openid / unionid / 用户 ID）、积分（默认 400）、发放编号，点「发放」即可把体验额度打到该客户钱包，并当场看到发放结果、客户 bonus 余额与建议到期日；下方「最近发放记录」按钱包流水 `trial_grant:*` 列出可对账的历史，不必再登服务器跑脚本。

### 本次范围

- `apps/api/src/services/marketplace-trial-grant.ts`（工作区既有未提交实现，本轮纳入台账）：发放/对账服务层，口径与 PLAT-10 CLI 完全一致——只写用户级钱包 `bonus` 桶、幂等键 `source=trial_grant:<grant-id>`、单笔上限 800、`dryRun` 零写入、`operator` 记入 `refOrderId`。
- `apps/api/src/routes/marketplace.ts`：`GET/POST /market/admin/trial-grants`（列表 / 发放），状态码映射 400/404/409。
  - **本轮修复**：两条路由补 `requireAdminToken`（`x-sitong-admin-token == env.ADMIN_TOKEN`），资金侧读写不再只凭租户角色放行。
- `apps/web/src/pages/MarketplaceApp.tsx`：`MarketplaceAdminPage`（身份类型切换、默认值、结果卡、对账表）；本轮新增 `adminAuthHeaders()` 与「平台管理令牌」输入框（`sessionStorage`、仅这两条请求携带），并把 401 `admin_token_required` 的文案与「登录已失效」区分开。
- `apps/web/src/main.tsx`：`/agents/admin` → `MarketplaceAdminPage` 路由；`/market/admin` 旧路径重定向。
- 新增验收脚本 `scripts/marketplace-trial-grant-admin-smoke.ts` + 命令 `marketplace:trial-grant-admin-smoke`。

### 本次不做

- 不部署（本轮只在本地收口）。
- 不统一收敛 `/market/admin/*` 其余路由（含 `skus` 改价、`ledger` 全平台账本）的平台守卫——属跨接口权限口径变更，另建任务卡。
- 不做「到期自动回收」（PLAT-12 候选，需改 `consumeWalletCredits` 主链 + 红灯回归）。
- 不发任何真实积分给真实客户；不对生产环境做任何写操作。
- 不改 SKU `coming_soon` 状态、不改注册赠送口径。

### 验收条件

1. 正常路径：带会话 + 平台凭证的运营账号 `POST /market/admin/trial-grants`（默认 400 积分 / 3 天口径）→ `state=created`、钱包 `bonusBalance +400`、`paidBalance` 不变、产生 1 条 `bucket=bonus/type=bonus/source=trial_grant:<id>` 流水、`refOrderId=operator:<发放人>`；`GET ?limit=20` 能查到该笔并带发放人。
2. 失败路径：未登录 → 401；租户内低权限角色 → 403；未知手机号 → 404 `trial_grant_user_not_found`；同编号换金额 → 409 `trial_grant_id_conflict`；金额 0 / 801 / 非整数、身份双填 → 400；`dryRun` → `dry_run` 且零写入。
3. 不应发生：**任何商家 owner 靠自己租户的角色给自己或别人发体验积分**；无关租户 owner 读到含全平台客户手机号的发放列表；同编号重复加币；拒绝的请求动余额；`dryRun` 写余额或占编号；体验额度写进租户级 `CreditAccount`；给 B 发额度改变 A 的余额。
4. 可观测结果事件：`state=created|already_applied|dry_run`、`wallet.bonusBalance`、`grantedAt`；失败 404/409 带 error code。

### 基线与失败证据

- 基线：`pnpm.cmd marketplace:trial-grant-smoke`（PLAT-10 CLI 口径）PASS；`pnpm.cmd --filter @baolu/api typecheck`、`--filter @baolu/web typecheck` PASS。
- 修复前红灯（P0，实测）：`scripts/marketplace-trial-grant-admin-smoke.ts` 报 `FAIL: unrelated tenant owner must NOT be able to self-grant trial credits (got 200: {"grant":{"state":"created","grantId":"...-outsider","amount":800,...}})` —— 无关租户 owner 用自己 userId 发 800 积分成功。

### 实现记录

- 修改文件：`apps/api/src/routes/marketplace.ts`（补 `requireAdminToken` 到 `trial-grants` 读/写）、`apps/web/src/pages/MarketplaceApp.tsx`（`adminAuthHeaders()`、令牌输入框、401 文案分流）、`package.json`（新增 `marketplace:trial-grant-admin-smoke`）、`docs/BUG_REGRESSIONS.md`（QA-20260911-009）。
- 纳入台账的工作区既有未提交实现：`apps/api/src/services/marketplace-trial-grant.ts`、`apps/api/src/routes/marketplace.ts` 的 trial-grants 路由块、`MarketplaceAdminPage`、`main.tsx` 的 `/agents/admin` 路由。
- 数据/接口/配置变化：无 DB 迁移、无新表；`POST /market/admin/trial-grants` 新增「必须携带平台凭证」这一鉴权要求（生产 fail closed）；浏览器侧多一个 `sessionStorage.sitong_admin_token`。
- 兼容性与回滚点：运维 CLI（PLAT-10）走服务层函数、不经 HTTP，完全不受影响；旧调用方若直接打这两条 HTTP 路由且只带会话不带凭证，在配了 `ADMIN_TOKEN` 的环境下会由 200 变 401（这是有意的收紧）。回滚只需撤销上述三个文件的改动。

### 验证

- `pnpm.cmd marketplace:trial-grant-admin-smoke`：**PASS**（`adminToken=configured`），13 组断言全绿（见 QA-20260911-009）。
- 红灯：修复前该脚本在「无关租户 owner 自助发放」处实测 FAIL（`200 / amount:800`），修复后复跑 PASS。
- `pnpm.cmd marketplace:trial-grant-smoke`：PASS（PLAT-10 CLI 口径未被带坏）。
- `pnpm.cmd --filter @baolu/api typecheck`、`pnpm.cmd --filter @baolu/web typecheck`：PASS。
- 未运行：`/agents/admin` 真实浏览器验收（桌面 + 390px）、`qa:full`、`qa:regression` —— 本轮按 12:00–14:00 时段收尾，留给 18:00 段继续。

### 交接

- 残余风险：① 生产环境「销售/运营」目前只能靠共享的平台 `ADMIN_TOKEN` 证明内部身份，令牌一泄露即等于发放权泄露，且没有按人审计（`operator` 字段是手填的、可伪造）；若希望「每个销售一个账号、按人审计」，需要引入内部员工白名单/平台角色（新 env 或用户级字段），属权限口径变更，需用户确认后另建任务。② `ADMIN_TOKEN` 未配置的环境（本地/开发）该守卫按平台既有约定放行，此时保护只剩租户角色。③ PLAT-12 候选：体验额度到期自动回收。④ 同源未修：`/market/admin/skus`、`/ledger` 仍只按租户角色守卫。
- 后续任务：① 由用户确认销售侧内部身份机制（共享令牌 vs 按人白名单），再决定是否收紧；② 浏览器验收 `/agents/admin`（含令牌未填时的提示态）与 390px 布局；③ 统一收敛 `/market/admin/*` 平台守卫（独立任务卡，含 skus 改价与 ledger）。
- 最后更新日期：2026-09-11

## PLAT-13 电脑端微信扫码登录（扫码中转，修「请在微信客户端打开链接」死路）

状态：已部署（测试实例 + 生产均 `DEPLOY_OK`，自动化回归全绿；真人扫码验收待用户在生产执行）

### 归属

- 产品：公共平台（平台主入口 `/login`、自定义域名入口、产品邀请码入口三处共用），不改任何单品的业务输出。
- 层级：公共平台身份链路（登录/注册），直接落在 PLAT-01「三个产品独立登录与受控开通」的登录页之上。
- 风险：高（登录是核心路径，且新增了「谁能拿会话完成登录」的凭证通道；出错会导致进不去或串号），但**不涉及计费与资金**。
- 修改热点：`apps/api/src/routes/auth.ts`、`apps/api/src/services/wechat-login-bridge.ts`、`apps/web/src/pages/{LoginPage,WeChatBridgePage,WeChatCallback}.tsx`、`apps/web/src/main.tsx`、`apps/web/src/lib/wechat-bridge-session.ts`。
- 是否允许并行：否；与 PLAT-01 / 登录页任何改动共用 `auth.ts`、`LoginPage.tsx`，须串行。

### 用户结果

老板在**电脑浏览器**打开登录页，点「微信一键登录 / 注册」→ 页面直接给出二维码 → 用手机的微信扫一扫 → 手机上是「完成授权」，电脑上**自动登录**并进入工作区。首次使用的微信号在电脑上一样能走完「补资料 → 开通工作区」。全程不再出现「请在微信客户端打开链接」这种无处可去的提示。

### 本次范围

- `apps/api/src/services/wechat-login-bridge.ts`（新建）：一次性中转会话（`id + secret`，TTL 5 分钟、上限 500 会话、单次完成），纯内存、无 DB 变更。
- `apps/api/src/routes/auth.ts`（改）：4 条 `/auth/wechat-bridge/*` 路由（建会话 / 查状态 / 出二维码 / 手机完成）+ 把换码逻辑抽成 `resolveWechatLogin()` 供两条链路复用，保证建号与授权语义一致。
- `apps/web/src/pages/WeChatBridgePage.tsx`（新建）+ `apps/web/src/lib/wechat-bridge-session.ts`（新建）：手机落地页与 `sessionStorage` 暂存。
- `apps/web/src/pages/LoginPage.tsx`（改）：`wechatInAppBrowser()` 分流；桌面出码 + 2 秒轮询自动登录；过期给「刷新二维码」；三处微信按钮统一为 `WeChatLoginArea`。
- `apps/web/src/pages/WeChatCallback.tsx`（改）+ `apps/web/src/main.tsx`（改）+ `apps/web/src/styles/store-growth.css`（改）。
- `package.json`：新增 `auth:login-wechat-qr-browser-smoke`；`qa:fast` 接入 `auth:wechat-login-bridge-smoke`。

### 本次不做

- ~~不部署（本轮只在本地收口）~~ → **已按用户 2026-09-11「一起发」的决定，随工作区在途改动全量包发到 `chat-test` 与 `chat`**，见下方「部署记录」。
- 不改微信登录的建号、赠送、开通口径；不改 `snsapi_userinfo` 授权范围。
- 不引入公众号「带参二维码 / 关注即登录」通道（需要公众号后台配置与开放平台资质，另立任务）。
- 不做「扫码后选择账号」「多租户切换」等增强。

### 验收条件

1. 正常路径（桌面）：非微信 UA 打开登录页 → 点微信登录 → **不跳转微信**、页面出现可扫二维码；二维码内容指向本站 `/wechat-bridge` 且带 `b`/`s` 参数。
2. 正常路径（手机）：扫码打开中转页 → 跳 `oauth2/authorize` → 授权后**手机端不落 token**、电脑端 2 秒内自动登录并跳工作区；`needsTenant` 时跳补资料页。
3. 失败路径：二维码过期/不存在 → 电脑端出现「二维码已失效」+ 可点的「刷新二维码」，不出现白屏或死循环；授权被取消或 code 无效 → 复用 QA-20260911-004 的 `401 wechat_code_invalid`、上游故障 `502 wechat_upstream_unavailable`。
4. 不应发生：桌面环境被直接丢到「请在微信客户端打开链接」；二维码指向非本站地址（开放重定向）；同一会话被重复完成换出两个身份；手机端把电脑端的 token 落到本机；`/wechat-bridge/qrcode` 被当成任意 URL 的代理。
5. 可观测结果事件：会话 `created → completed`（`GET /auth/wechat-bridge/status` 的 `expired` / `completed` 字段），电脑端登录后落 `store_os_token`。

### 基线与失败证据

- 基线：`pnpm.cmd qa:fast` PASS（含既有 `auth:wechat-login-failure-paths-smoke` 34/34、`auth:identity-header-spoof-smoke` 30/30）。
- 修复前红灯（**真实生产实测，不是推断**）：`scripts/tmp/prod-login-desktop-deadend-probe.mjs` 对 `https://api.lcppch.top/os-v2/login` 实测 → 桌面点微信登录后整页跳 `open.weixin.qq.com`，正文 `请在微信客户端打开链接`，`dead_end_text=true / qr_shown=false / console_errors=[]`。详见 `docs/BUG_REGRESSIONS.md` QA-20260911-011。
- 红灯对照（**实测**）：把同一支 `scripts/login-wechat-qr-browser-smoke.mjs` 指向未修复的生产 `LOGIN_SMOKE_WEB_URL=https://api.lcppch.top/os-v2` 运行 → 在 `desktop_qr` 段超时失败（`waitFor timeout`，等不到 `[data-wechat-qr="pending"]` 二维码块）；指向本地新实现则 PASS。同一支脚本、同一批断言，红 ↔ 绿只由实现决定，能把该 Bug 钉在回归里。

### 实现记录

- 修改文件：见上方「本次范围」。
- 数据/接口/配置变化：新增 4 条 HTTP 路由；**无 DB 迁移、无新表、无新 env 变量**；中转会话仅存进程内存。
- 兼容性与回滚点：微信内直连链路与 `/auth/wechat-login` 行为完全不变（只是内部抽了个函数），旧手机扫码入口不受影响；回滚只需撤销上述前端页面/路由与新增服务文件。
- 未纳入本卡：`apps/api/src/services/marketplace-trial-grant.ts`、`apps/api/src/services/video-review-engine.ts`、`apps/web/src/marketplace/vidrev-report.tsx` 等同工作区的其它在途改动，分属 PLAT-09 / PLAT-10 / PLAT-11。

### 验证

- `pnpm.cmd auth:wechat-login-bridge-smoke`：**50 passed, 0 failed**。
- `pnpm.cmd auth:login-wechat-qr-browser-smoke`（真实 Chrome，dev server `127.0.0.1:5178`）：**PASS** `desktop_qr=PASS qr_target=PASS auto_login=PASS expired_refresh=PASS in_app_redirect=PASS`。
- `pnpm.cmd qa:fast`：**PASS**（结构检查 / Skill 质量资产 / Eval 结构 / 全仓 `typecheck` 全绿）。
- 未运行：`qa:regression`、`qa:full`、部署后两个实例的真人扫码验收。
- **既有失败（非本卡引入，已登记）**：`pnpm.cmd auth:login-entry-browser-smoke` 在步骤 2b 失败（`AssertionError: signup asks for the invite code required by the workspace`）。根因是检查资产与「开放注册」合同脱钩：该断言期望补资料页出现「邀请码」，而 `LoginPage.tsx` 的 `invitesNeeded = isProduction && inviteRequired !== false`，vite dev 下 `mode="dev"` ⇒ 恒不渲染邀请码入口。本卡改动未触及该分支（`git diff` 中该行处上下文未变），与 `docs/BUG_REGRESSIONS.md` QA-20260911-003 的残留项同源；该脚本不在 `qa:fast/regression/full` 内。

### 部署记录（2026-09-11）

- 发布包：`release-20260911-all-inflight-full.tar.gz`（**9088300 B**，sha256 `95c169e6dabebc46d5a57c20edf290aa2e3ffd61f4316f0668e67de8d26b38c6`，**1446 个文件**）。该包是用户拍板的**工作区在途改动全量发布**，本卡（PLAT-13）只是其中一条工作线，其余改动分属 PLAT-09 / PLAT-10 / PLAT-11。
- 发布 id：`20260911-all-inflight-full-test1`（`/opt/baolu-os-v2-test` · 3010 · `/lanqi-test/`）→ `DEPLOY_OK` + `health=200 (after 12s)` / `ready=200`；`20260911-all-inflight-full-prod1`（`/opt/baolu-os-v2` · 3002 · `/os-v2/`）→ `DEPLOY_OK` + `health=200 (after 15s)` / `ready=200`。两侧同产物，日志首段 `archive sha256` 与本机一致。
- 部署后实测（只读，未改数据）：生产 `scripts/tmp/prod-login-desktop-deadend-probe.mjs` → `dead_end_text=false / qr_shown=true / console_errors=[]`，正文出现「请用微信扫这个码登录 / 等待扫码授权…」（修复前 `dead_end_text=true / qr_shown=false`）；两侧 `POST /auth/wechat-bridge/session` = `200` 且返回 `{id, secret, expiresAt, ttlSeconds:300}`，非法会话 `GET /auth/wechat-bridge/status` = `400`（失败关闭）；生产有 `WeChatBridgePage-CVOI36xW.js`、`wechat-bridge-session-DOVEjPNz.js`、`apps/api/dist/.../wechat-login-bridge.js`；`pnpm.cmd auth:login-entry-production-check` PASS。
- 回滚：生产 `/opt/baolu-backups/20260911-all-inflight-full-prod1-before-baolu-os-v2/`（208M），测试 `/opt/baolu-backups/20260911-all-inflight-full-test1-before-baolu-os-v2-test/`（178M）；还原回 `$APP` 后 `systemctl restart` 即可。
- 仍未完成：真人扫码闭环（本卡「真人扫码验收清单」7 条）需用户在生产 `https://api.lcppch.top/os-v2/login` 用真机执行。

### 真人扫码验收清单（部署到生产后执行）

- 验收地址：**生产** `https://api.lcppch.top/os-v2/login`（平台主入口）；产品入口 `https://api.lcppch.top/os-v2/login/lanqi` 需兰琪产品邀请码。
- **不适用**：`https://api.lcppch.top/lanqi-test/` 是免登录内测实例（2026-09-11 实测打开 `/login` 直接落到 `/lanqi/dashboard`，没有登录页），不能用来验扫码登录。
- 准备：一部手机（微信）+ 两个微信号——A 用于「首次开通」，B（已开通过）用于「重复登录」。
- ① 电脑端出码：电脑浏览器打开验收地址 → 点「微信一键登录 / 注册」→ 应当**当场出现二维码**，页面不再跳去微信、不再出现「请在微信客户端打开链接」。
- ② 手机扫码登录：手机微信扫该二维码 → 进授权页点「允许」→ 手机提示「已确认，请回到电脑继续」→ **电脑端 2 秒内自动进入工作区**。
- ③ 首次开通（用微信号 A）：授权后电脑端进入「完成注册，开通你的工作区」→ 填企业/品牌名 → 进平台首页（`/os-v2/agents`），顶部钱包不再显示未登录态，能看到货架。
- ④ 重复登录（用微信号 B）：同一步再点一次 → 应当**直接登录进平台**，不再次要求补资料、不重复建号。
- ⑤ 二维码过期：出码后等 5 分钟以上再扫 → 电脑端应出现「二维码已失效」+「刷新二维码」按钮，点刷新能拿到新码并正常扫码登录。
- ⑥ 微信内不受影响：用手机微信直接打开同一个地址 → 点登录 → 应照旧直接跳微信授权（不显示二维码）。
- ⑦ 失败路径（已有自动探针，可只做抽查）：无效/已用的 code → 页面给中文提示「微信授权已失效，请返回登录页重新授权」，**不得**出现「服务器故障」。

### 交接

- 残余风险：① 中转会话是进程内存态，API 重启会让**未使用**的二维码作废（用户刷新即可），多实例部署时两个实例不共享会话（当前单实例）；② 会话上限 500、TTL 5 分钟，高峰期 500 个未完成会话会挤掉最旧的，属故意收敛；③ `GET /auth/wechat-bridge/qrcode` 是服务端出码，必须继续维持「只画本站 `/wechat-bridge`」的 allowlist 校验，后续做多域名/自定义域名时要同步扩白名单。
- 后续任务：① ~~用户确认部署范围后发 `chat-test` → 复验 → 发 `chat`~~ **已完成（2026-09-11）**；② 待用户在生产执行真人扫码验收（7 条，见上）；③ 若要多实例部署，把中转会话改为 Redis 或 DB；④ 公众号「关注即登录」另立任务。
- 最后更新日期：2026-09-11

## PLAT-14 手机端平台页布局修复 + 货架「退出登录」入口

状态：已部署（测试实例 + 生产均 `DEPLOY_OK`，布局与退出链路回归已绿；用户真机「换账号重登」体验待验收）

### 归属

- 产品：公共平台（平台货架 `/agents` 的顶栏与全局设备断点）。服务全部三个产品，因为这是所有产品共用的外壳。
- 层级：公共平台 UI 外壳（设备断点 + 设计 token + 货架顶栏）；不改任何智能体输出契约、不改登录/计费主链。
- 风险：中（纯前端展示层与一个退出按钮；退出只清本地会话，不动服务端数据）。真正高风险的是**没修之前的现状**：手机用户看到的顶栏是坏的。
- 修改热点：`apps/web/src/main.tsx`、`apps/web/src/styles/sitong-design.css`、`apps/web/src/pages/MarketplaceApp.tsx`。
- 是否允许并行：否；与 PLAT-11 / PLAT-13 共用 `MarketplaceApp.tsx` 与设计 token，须串行。

### 用户结果

老板用手机（含微信内置浏览器）打开平台页：顶栏是规规矩矩两行——第一行品牌名 + 积分钱包 + 「退出登录」，第二行三个 Tab（货架 / 我的智能体 / 积分充值）+ 浅色切换；正文完整落在屏幕宽度内，不再被压扁、不再横向溢出；浅色主题下顶栏是浅色的。想换一个微信号重新登入时，点顶栏「退出登录」即可，退出后回到登录页，重新登入成功仍回到货架。

### 本次范围

- `apps/web/src/main.tsx`：`MOBILE_MAX_WIDTH = 900` + `resolveDevice()`（视口宽度 ∧ 移动 UA）+ `applyDevice()`，在启动 / `resize` / `orientationchange` 重算，替换写死的 `data-device="desktop"`。
- `apps/web/src/styles/sitong-design.css`：手机断点 `.app-wrap` 去壳改满宽 + `overflow-x:hidden`；顶栏两行布局与 `.nav-link` 单行；钱包胶囊不换行、`margin-left:auto`；新增 `.logout-link`；`:root[data-theme="light"]` 补 `--topbar-bg` / `--toast-bg` / `--ovl-bg`。
- `apps/web/src/pages/MarketplaceApp.tsx`：`Topbar` 登录态 + 「退出登录」按钮与 `handleLogout()`。
- 回归：`scripts/marketplace-mobile-layout-check.mjs`（先修脚本自身的语法错误，再把两处「假绿」补成真断言）；新增 `scripts/tmp/shelf-logout-browser-check.mjs`。

### 本次不做

- 不做「退出时吊销服务端 token」——与既有会话口径保持一致（token 到期自然失效），单独做属鉴权口径变更。
- 不做多设备断点（平板/折叠屏的第三档），当前只有 900px 一档。
- 不改 `/market/admin/skus`、`/ledger` 的平台守卫（PLAT-11 交接里的同源未修项）。

### 验收条件

1. 正常路径：390×844 手机视口 + 微信 UA 打开 `/agents`，顶栏 ≤ 2 行、三个 Tab 各自单行且宽度够点、钱包胶囊在视口内、无横向滚动；横屏 844×390 同样不溢出。
2. 正常路径：登录态下顶栏出现「退出登录」；点击后本地会话与运营令牌清空、跳到 `/login`、并记录「登录后回到货架」。
3. 失败路径：未登录态不渲染退出按钮；登录页不因退出后的回跳逻辑形成死循环（回跳地址被归一化，且拒绝 `/login` 自身）。
4. 不应发生：手机断点下仍在用桌面顶栏（Tab 竖排）；内容靠 `overflow-x:hidden` 藏住而不是真的放得下；退出后把用户卡在登录页。
5. 可观测结果事件：`body[data-device]` 在真机为 `mobile`；退出后 `store_os_token` 为空、`store_os_post_login_redirect=/agents`。

### 基线与失败证据

- 基线：`pnpm.cmd qa:fast` PASS；`pnpm.cmd qa:full` PASS（`qa:fast` → `qa:regression` → `build` → `api:runtime-data-check` 全绿）。
- 修复前红灯（**真实生产实测**）：对 `https://api.lcppch.top/os-v2` 跑布局检查 → **12 条 FAIL**：顶栏 222px、Tab 被压成 46px 宽竖排（高 109px）、钱包 `right=418` / viewport 390、浅色主题顶栏 `rgba(15,15,19,.72)`。截图 `%TEMP%\sitong-mobile-prod-before.png`。详见 `docs/BUG_REGRESSIONS.md` QA-20260911-012。
- 修复前第二个红灯（脚本本身）：`scripts/marketplace-mobile-layout-check.mjs` 第 153 行注释里的反引号提前闭合模板字符串，`SyntaxError: missing ) after argument list`，脚本完全跑不了——也就是说这条回归此前是**名义存在、实际从未执行**的。

### 验证

- `node scripts/marketplace-mobile-layout-check.mjs`：生产 **PASS**（`topbar=390x100 tabs=货架:89x31|我的智能体:89x31|积分充值:89x31 overflowX=0 landscapeOverflowX=0`）、测试实例 **PASS**（`topbar=390x105`）；取证 `scrollWidthWithVisibleOverflow=390 / offenderCount=0`。
- `node scripts/tmp/shelf-logout-browser-check.mjs`（测试实例）：**PASS**（`tokenAfter=""`、`adminToken=""`、`postLoginRedirect="/lanqi-test/agents"`、URL `/lanqi-test/login`）。
- `pnpm.cmd qa:fast`：**PASS**；`pnpm.cmd qa:full`：**PASS**。
- `verify-deploy.sh` 两侧：**VERIFY_OK**。
- 未运行：生产侧真人「换账号重登」闭环（需要用户的真机与第二个微信号）。

### 部署记录（2026-09-11）

- 发布包 `release-20260911-mobile-topbar-full.tar.gz`（**9101971 B**，sha256 `1d9744ed1882d33c11ca9d2fc37e2c4d3f4a7eab5f868d810436db143f3d3dfc`，1448 文件），发布 id `20260911-mobile-topbar-test1` / `-prod1`，两侧 `DEPLOY_OK` + `health/ready=200`。
- 回滚：生产 `/opt/baolu-backups/20260911-mobile-topbar-prod1-before-baolu-os-v2/`（209M），测试 `/opt/baolu-backups/20260911-mobile-topbar-test1-before-baolu-os-v2-test/`（179M）；还原回 `$APP` 后 `systemctl restart` 即可。代码侧最小回滚点是上述三个源码文件。

### 交接

- 残余风险：① 断点阈值 900px 是唯一一档，平板/折叠屏未单独验收；② 退出不吊销服务端 token（口径与既有会话一致）；③ 服务器根分区只剩 ~2.1G（93%），下次发布前必须先腾挪 stage/backup；④ `scripts/marketplace-mobile-layout-check.mjs` 目前挂在 `scripts/` 下但**尚未接入 `qa:fast`**，建议下一步接入，避免又变成「名义存在」的回归。
- 后续任务：① 把移动端布局检查接进质量门禁；② 平板/折叠屏断点；③ 生产真人换账号重登闭环。
- 最后更新日期：2026-09-11

## PLAT-15 货架导航文案「我的智能体」→「常用智能体」

状态：已部署（测试实例 + 生产均 `DEPLOY_OK` 且 `VERIFY_OK`，两侧真机布局检查已确认新文案）

### 归属

- 产品：公共平台（平台货架 `/agents` 顶栏 Tab 与 `/mine` 页，以及智能体的返回入口）。三个产品共用同一套外壳与返回按钮。
- 层级：公共平台 UI 文案（纯展示层）；不改任何智能体输出契约、不改登录/计费主链、不改路由。
- 风险：低（改的是用户可见字符串；`/mine`、`/my-ai` 路由路径一律不动）。
- 修改热点：`apps/web/src/pages/MarketplaceApp.tsx`（唯一主口径）、`KnowledgeBasePage.tsx`、`AgentProductsApp.tsx`、`scripts/marketplace-mobile-layout-check.mjs`。
- 是否允许并行：是（只碰文案与一条断言字符串），但若同轮有人要改同一批页面文件需串行。

### 用户结果

老板在货架顶栏第二个 Tab、点进去的页面标题、以及从智能体/企业知识库返回时的按钮上，看到的都是「常用智能体」；`/mine`、`/my-ai` 两个地址与既有链接照旧可用。

### 本次范围

- `apps/web/src/pages/MarketplaceApp.tsx`：顶栏 Tab 与 `/mine` 页 `<h1>` 两处「我的智能体」→「常用智能体」。
- `apps/web/src/pages/KnowledgeBasePage.tsx`：企业知识库返回按钮「返回我的智能体」→「返回常用智能体」。
- `apps/web/src/pages/AgentProductsApp.tsx`：智能体侧栏底部入口与「尚未开通」页返回按钮同步改名。
- `apps/web/src/styles/sitong-design.css`：仅分区注释同步，无样式行为变化。
- 回归：`scripts/marketplace-mobile-layout-check.mjs` 第 289 行断言与文件头注释同步为 `货架|常用智能体|积分充值`；断言强度不变（仍校验 3 个 Tab 的 `length`、逐条宽度/高度、`overflowX`）。

### 本次不做

- 不改路由（`/mine`、`/my-ai` 保持原样），不改菜单结构、顺序或图标。
- 不统一改历史的 `docs/**` 台账里描述当时界面的旧文案（历史记录保持原样）。
- 不动 `scripts/tmp/lq-deploy-override*/` 下的旧部署副本（不参与生产）。

### 验收条件

1. 正常路径：390×844 手机视口 + 微信 UA 打开 `/agents`，顶栏第二个 Tab 文案是「常用智能体」，三个 Tab 各自单行且宽度足够点击，无横向滚动。
2. 正常路径：进入 `/mine` 页，页面标题显示「常用智能体」；从智能体页与企业知识库页返回时按钮文案一致。
3. 失败路径：旧链接 `/mine`、`/my-ai` 仍可达（文案改动不影响路由解析）。
4. 不应发生：文案改了而回归断言没改（页面级布局检查出现假失败）；或为了改名顺手改掉路由导致既有链接 404。
5. 可观测结果事件：布局检查输出 `tabs=货架:…|常用智能体:…|积分充值:…`。

### 基线与失败证据

- 基线：改动前 `pnpm.cmd qa:fast` **PASS**、`pnpm.cmd qa:full` **PASS**。
- 过程记录：本轮第一次 `qa:fast` 曾在 `auth:product-login-smoke`（`/agents` 根路径重定向断言）上失败一次；**未改任何代码**重跑该 smoke 与随后 3 次完整 `qa:fast` 全部 **PASS**，判定为一次性抖动，非本次改动引入（本次改动不碰 `main.tsx`）。

### 验证

- `pnpm.cmd qa:fast`：**PASS**（连续 3 次）；`pnpm.cmd qa:full`：**PASS**（含 `qa:regression`、`build`、`api:runtime-data-check: PASS files=marketplace-v3.json`）。
- `MARKETPLACE_LAYOUT_CHECK_URL=https://api.lcppch.top/lanqi-test node scripts/marketplace-mobile-layout-check.mjs`：**PASS**（`tabs=货架:89x31|常用智能体:89x31|积分充值:89x31`）。
- `MARKETPLACE_LAYOUT_CHECK_URL=https://api.lcppch.top/os-v2 node scripts/marketplace-mobile-layout-check.mjs`：生产 **PASS**（同文案，`overflowX=0 landscapeOverflowX=0`，`offenderCount=0`）。
- `DEPLOY_CHECK_WEB_URL=https://api.lcppch.top/os-v2 node scripts/deployed-marketplace-browser-check.mjs`：**PASS**（`shelf` / `credits_yuan` / `detail_redo_copy` / `direct_test_entry` / `console_clean`）。
- `pnpm.cmd auth:login-entry-production-check`：**PASS**（含 `console_clean`）。
- `verify-deploy.sh` 两侧：**VERIFY_OK**；`systemctl is-active baolu-os-v2` = `active`、`NRestarts=0`、`journalctl -p err` 无条目。
- 未运行：真机微信内的「点击『常用智能体』进入并返回」目视确认（需要用户本人手机）。

### 部署记录（2026-09-11）

- 发布包 `release-20260911-common-agents-label-full.tar.gz`（**9263958 B**，sha256 `0a90888775ddf484f396f040226bdd3ea8907f33f7fdee4a46bef1f9394a1540`，1452 文件），发布 id `20260911-common-agents-label-test1` / `-prod1`，两侧 `DEPLOY_OK` + `health=200 (after 15s)` / `ready=200`。
- 回滚：生产 `/opt/baolu-backups/20260911-common-agents-label-prod1-before-baolu-os-v2/`，测试 `/opt/baolu-backups/20260911-common-agents-label-test1-before-baolu-os-v2-test/`；还原后 `systemctl restart`。代码侧最小回滚点是上述 3 个 `.tsx` 文件的 4 处字符串。

### 交接

- 残余风险：① 文档台账里仍保留描述旧界面的历史文案（有意保留，便于追溯）；② `scripts/marketplace-mobile-layout-check.mjs` 仍未接入 `qa:fast`（沿用 PLAT-14 的待办）；③ 文案用「常用」而非「我的」，若后续要按「最近使用/收藏」排序，属功能需求另开卡。
- 后续任务：① 把移动端布局检查接进质量门禁；② 若确需「常用」语义落地，再做使用频率排序/收藏。
- 最后更新日期：2026-09-11

## PLAT-16 货架 SKU 分享链接路由归属修复（`/agents/<skuCode>`）

状态：已部署（测试实例 + 生产均 `DEPLOY_OK`，脚本回归 24/24 ALL PASS，`VERIFY_OK`）；源码级契约门禁已接入 `qa:fast`

### 归属

- 产品：公共平台（平台货架分享链接与前端路由归属）。
- 层级：公共平台**前端路由判定**——决定 `/agents/<slug>` 该交给货架详情页，还是交给工作台智能体页。
- 风险：低（纯前端分支；`/agent/<skuCode>` 单数路由、`/api/market/skus/*`、货架数据、登录、计费一律不动）。
- 修改热点：`apps/web/src/main.tsx`（唯一改动的产品文件）、`scripts/marketplace-sku-link-regression.mjs`（新增回归）。
- 是否允许并行：是（只碰一个前端文件的一段分支），但同一任务卡不允许同时有两个编码任务开工。

### 用户结果

把「创始人IP专区」或「美业专区」的货架链接（`/agents/ipzone__vidrev`、`/agents/meiye__vidrev`）发给任何人——不论是否登录——打开后直接看到这个智能体的专区详情页（名称 + 所属专区 + 「开发中」），而不是「服务暂时不可用」，也不会被推去登录页。原来的单数短链 `/agent/<skuCode>` 照旧可用。

### 本次范围

- `apps/web/src/main.tsx`：新增 `isMarketplaceSkuCode(slug)`（判据：slug 含 `__`，货架编码是 `<专区>__<能力>` 形态）；在既有 `agentMatch`（`/agents/<slug>`）分支**之前**插一条归属判定——命中货架编码就渲染 `MarketplaceAgentDetailPage`（与 `/agent/<skuCode>` 同一个组件、同一份数据源）；其余 `/agents/<slug>` 仍走 `AgentWorkspacePage`。
- `scripts/marketplace-sku-link-regression.mjs`：新增真实 Chromium 回归（2 个 SKU × 桌面 1440 / 手机 390 × 6 类断言 = 24 条），失败时打印本轮 `/api/` 请求与页面异常。已注册为 `pnpm.cmd marketplace:sku-link-regression`。
- `scripts/marketplace-sku-link-contract-smoke.ts`：新增源码级契约门禁（18 条离线断言，毫秒级），锁死「判据存在 → 货架分支在工作台分支之前 → 单数短链仍可用 → 货架 SKU 全部含 `__`、工作台 slug 全部不含 `__`、两者不相交 → 回归脚本覆盖两条真实链接与加载态文案」。已注册为 `pnpm.cmd marketplace:sku-link-contract-smoke` 并接进 `pnpm.cmd qa:fast`（纯开发工具，不参与运行时）。

### 本次不做

- 不动货架数据：`apps/api/src/data/marketplace-v3.json` 发布前后 sha256 一致，`ipzone__vidrev` / `meiye__vidrev` 仍保持 `coming_soon`（**改开卖状态要用户明确同意**）。
- 不改 `customerErrorMessage` 的兜底文案（真正不存在的工作台 slug 仍显示「服务暂时不可用」，属独立 P3）。
- 不回改单数 `/agent/<skuCode>` 路由，也不统一两套命名空间（统一属结构性改动，另开卡）。

### 验收条件

1. 正常路径：匿名访客打开 `/agents/ipzone__vidrev` 与 `/agents/meiye__vidrev`，直接渲染货架详情正文（智能体名 + 专区名 + 「开发中」），请求 `/api/market/skus/<sku>` 为 `200`。
2. 正常路径：已登录用户打开同样两条链接，结果一致（不再是工作台页的错误话术）。
3. 失败路径：不存在的货架编码（如 `/agents/notexist__xxx`）不得白屏，走货架详情页自己的「找不到」处理。
4. 不应发生：① 页面出现「服务暂时不可用」；② 未登录用户被强制改名跳 `/login`；③ 本轮出现 5xx 或前端控制台报错；④ 原有单数短链 `/agent/<skuCode>` 因为这次改动失效。
5. 可观测结果事件：断言「详情数据来自 `200 /api/market/skus/<sku>`」+「本轮无 5xx」+「无控制台错误」三条同时成立，脚本整体 `ALL PASS`。

### 基线与失败证据

- 基线（真实浏览器，生产环境，修复前）：`node scripts/marketplace-sku-link-regression.mjs --base https://api.lcppch.top/os-v2` → **12 failed**（两条链接 × 两个视口 × 3 类失败）：被强跳 `/login`、无货架详情正文、未调用货架详情接口；同轮 `/api/` 请求清单里只有 `auth/wechat-config`、`public/tenant-branding`。
- 已登录态现象（用户实际看到的一屏，取自内测实例）：同脚本 **12 failed**，失败文本即用户反馈的 `服务暂时不可用，请稍后再试。`
- 排除「真的是服务故障」的服务器取证：两条 URL nginx 全 `200`、当日无 5xx；`/api/market/skus/<sku>` 均 `200`（`status=coming_soon`）；nginx 日志显示用户已成功扫码登录（`wechat-bridge/complete` 200）。故障在前端渲染路径，不在接口或服务。
- 缺陷与根因的完整记录见 `docs/BUG_REGRESSIONS.md` **QA-20260911-015**。

### 验证

- 修复后生产：`node scripts/marketplace-sku-link-regression.mjs --base https://api.lcppch.top/os-v2` → **ALL PASS（24/24）**（2026-09-11 发布后 20:0x 与收尾交接 20:15 各跑一次，两次结果一致）。
- 同产物内测实例：连跑 **5 轮 ALL PASS**。
- 新增源码级门禁（先红后绿，是真门禁不是橡皮图章）：`pnpm.cmd marketplace:sku-link-contract-smoke` → **18 passed / 0 failed**；把同一支脚本放在 `HEAD`（修复前）源码上跑 → **7 passed / 11 failed**、`exit=1`（失败的正是「判据不存在 / 货架归属分支不存在 / 分支顺序反了 / 回归脚本缺失 / package.json 未注册」这些点，用临时目录 + `apps/api` junction 复现，已清理，仓库未改动）。
- 相邻回归：`pnpm.cmd qa:fast` **PASS**（**exit=0**，完整输出 316 行，新增门禁在链内跑出 `18 passed / 0 failed`，7 包 typecheck 全绿）；`pnpm.cmd --filter @baolu/web typecheck` / `build` **PASS**；`DEPLOY_CHECK_WEB_URL=https://api.lcppch.top/os-v2 node scripts/deployed-marketplace-browser-check.mjs` **PASS**。
- 部署校验：`bash /tmp/verify-deploy.sh …` 生产 → **VERIFY_OK**（`src_data_sha` 与 `dist_data_matches_src` 均 `2eec39bd…`、`skus_total=19` / `coming_soon=15`）；`NRestarts=0`；`journalctl -p err` 近 15 分钟无条目。
- 未运行：真机微信内、真人扫码登录后的目视确认（需用户本人手机；生产走真人扫码，无法无人值守进入登录后页面）。
- 探针自身修正（改探针，不放宽产品口径）：把加载态文案 `正在加载智能体` / `正在加载货架` 并入 `TRANSIENT_MARKERS`，消除「加载态被判成渲染完成」造成的假失败；真卡死时超时分支仍返回最后文本、断言照样失败。

### 部署记录（2026-09-11）

- 发布包 `release-20260911-qa015-sku-link-full.tar.gz`（**9270737 B**，sha256 `32d40b128ddbea2b3057e4045c3e71e48d1eb53757cbe2cf4c72380bcc1a68fc`，1453 文件），发布 id `20260911-qa015-sku-link-test1` / `-prod1`，两侧 `DEPLOY_OK` + `health=200 (after 15s)` / `ready=200`。
- 回滚：生产 `/opt/baolu-backups/20260911-qa015-sku-link-prod1-before-baolu-os-v2/`（211M），测试 `/opt/baolu-backups/20260911-qa015-sku-link-test1-before-baolu-os-v2-test/`（181M）；还原后 `systemctl restart`。代码侧最小回滚点是 `apps/web/src/main.tsx` 的 `isMarketplaceSkuCode` 函数与那条分支。

### 交接

- 残余风险：① `customerErrorMessage` 对未知工作台 slug 仍兜底成「服务暂时不可用」，语义不准（P3，建议单独开条目）；② `marketplace:sku-link-regression`（真实浏览器那条，需要起 Chromium + 连实例）**仍未接入任何门禁**——现已改由源码级契约门禁 `marketplace:sku-link-contract-smoke` 守在 `qa:fast` 里兜住归属契约，浏览器那条按需手动跑；③ 两套命名空间（`/agents/<slug>` 与 `/agent/<skuCode>`）仍并存，靠「slug 是否含 `__`」区分，属约定而非强类型约束。
- 后续任务：① 修 `customerErrorMessage` 兜底文案；② 若确认要把两套命名空间收敛，另开结构任务卡（需先有回归再动）；③ 想跑真页面回归时用 `pnpm.cmd marketplace:sku-link-regression -- --base https://api.lcppch.top/os-v2`。
- 最后更新日期：2026-09-11

## PLAT-17 平台管理后台「按人审计」改造（共享 `ADMIN_TOKEN` → 按人身份 + 发放人不可自由填写）

状态：待开发（已记录用户 2026-09-11 明确要求：「就你一个人做销售问题不大，以后加人必须先改」）

### 归属

- 产品：公共平台（`/agents/admin` 体验额度发放页、`/market/admin/skus`、`/ledger` 资金侧接口）。
- 层级：公共平台身份与授权边界（**不是**货架业务）。
- 风险：高，涉及资金侧操作的身份、审计与权限；改动会动到 `requireAdminToken`、发放流水字段与后台页面。
- 预计修改热点：`apps/api/src/routes/marketplace.ts`（`admin.*`、`trial-grants`、`requireAdminToken`）、`apps/api/src/services/marketplace-trial-grant.ts`、`apps/web/src/pages/MarketplaceApp.tsx`（`MarketplaceAdminPage`）、Prisma 后台账号/审计模型。
- 是否允许并行：否，同一工作树里不得与另一条资金侧任务并行。

### 当前缺口（用户原话归纳）

1. 「证明你是内部人」靠**一个共享令牌**（`ADMIN_TOKEN`）——令牌泄露即等于任何人可发额度，且无法区分是谁在用。
2. 发放记录的**发放人姓名是手填的**，可任意填写，等于没有按人审计。
3. 销售目前只有用户本人一人，所以**当前不阻塞**上线；一旦加人必须先改完。

### 用户结果

平台管理后台不再依赖单一共享口令：每个内部账号有独立身份与角色，发放人字段由登录身份决定、不可手填，每笔额度发放都能追到「谁在什么时候给谁发了多少」。

### 本次范围（建议顺序）

1. 先收紧 `/market/admin/skus`（直接改价、动钱），再收紧 `/ledger`（只读看账，风险低可后做）——**这个顺序已获用户 2026-09-11 明确同意**。
2. 引入按人身份（复用现有会话/租户体系或独立后台账号），`ADMIN_TOKEN` 降级为过渡期开关并记录使用。
3. `发放人` 改为由身份派生，保留「备注」类自由文本但不作为审计字段。

### 本次不做

- 不新建手机号/密码等全新身份体系（先复用现有登录与会话）。
- 不在没有回归的情况下改动现有发放流水的历史数据结构（先加字段，不迁移旧值）。
- 不在用户未确认前改任何**计费规则、价格口径或已发放额度**。

### 验收条件

1. 正常路径：内部账号 A 登录后可发放额度，流水里 `发放人` 是 A 的身份而不是手填文本。
2. 失败路径：无权限账号或过期会话调用 `admin.*` 一律拒绝，且拒绝原因可审计；共享令牌失效路径有明确报错，不是 500。
3. 不应发生：① 任何商家账号能给自己发额度；② 发放人字段可被手填成他人；③ 跨租户读到别人的发放/钱包流水。
4. 回归：为「无权限调用被拒」「发放人由身份派生」「按人审计可检索」各留一条自动回归；资金侧改动跑 `pnpm.cmd qa:regression`。

### 交接

- 当前未开始编码；现有实现与缺口描述以 `apps/api/src/routes/marketplace.ts` 的 `requireAdminToken` 与 `apps/web/src/pages/MarketplaceApp.tsx` 的 `MarketplaceAdminPage` 为准。
- 最后更新日期：2026-09-11

## PLAT-18 历史路由与历史页面清理（先只读盘点，再分批删，每批带回归）

状态：**第一、二批已完成并已上线生产**（测试实例 + 生产真实浏览器各 24/24 通过，生产部署前同脚本为 12/24 失败）；第三批 `/internal/*` 待用户点头；服务器清垃圾已执行（磁盘 77% → 59%），仅剩 `dist/assets` 历史产物暂缓。

- 用户 2026-09-11 提出：「我们现在有大量历史不用的页面 看如何清理」→ 当日只读盘点。
- 用户 2026-09-12 同意分批清理方式：「每批只删一组、独立可回滚，删前先加『保留网址清单』契约，删后跑 `qa:fast`」，并同意第一、二批先做。

### 归属

- 产品：公共平台（前端路由表 `apps/web/src/main.tsx` 的 `Root()`）。
- 层级：公共平台前端路由与死代码，属结构清理，**不改变任何在售能力**。
- 风险：中（删错会把已发出的网址变成白屏；但每条路由互不影响，可分批、可单独回滚）。
- 修改热点：`apps/web/src/main.tsx`、对应 `apps/web/src/pages/*`、`apps/web/src/styles/*`、以及引用它们的脚本。
- 是否允许并行：否，路由表是单点热点，必须串行。

### 用户结果

用户不再被历史开发页面误导；保留的网址一律仍能打开，删掉的网址有明确的替代去向（跳转或明确的「已下线」页），不再出现「URL 打开是另一个产品的页面」。

### 只读盘点结论（2026-09-11）

1. `/agents/admin` **不是**历史页面：它是额度发放页（`MarketplaceAdminPage`），2026-09-11 更名 `/market/admin` → `/agents/admin` 后仍在使用；实测生产渲染正确、无 console 错误。
2. 盘点结论按「有无入口」分三类：**在用**、**兼容跳转必须保留**、**疑似孤岛（只能手输 URL 打开）**。孤岛候选：`/industry-prototype`（美业原型）、`/v4-preview`、`/legacy-diagnosis`、`/clip-lab`（生产已改为跳 `/agents/clipper`）、`/internal/*`、`/fip/e2e/local`、`/lanqi/local`（仅本机开发）。
3. 兼容跳转必须保留：`/` → `/agents`、`/market*` → `/agents*`、`/workbench`|`/app` → `/my-ai`。
4. 顺带发现的非页面垃圾：服务器 `dist/assets` 累积 2218 个文件 / 129M（每次发布只叠加、不清理），`/tmp` 有历史发布包（2026-09-12 实测 21 个 / 210M）。

### 第一批（已完成，2026-09-12）：`/legacy-diagnosis`、`/v4-preview`、`/industry-prototype`

这三个地址没有任何入口链接，也没有被收藏。

- 删除路由分支：`isLegacyDiagnosisRoute`、`isV4PreviewRoute`、`/industry-prototype` 三段，以及它们专用的 `sitong-v4.css`、`industry-workbench-prototype.css` 样式引用。
- 删除文件：`apps/web/src/pages/BaoluDiagnosisApp.tsx`、`apps/web/src/pages/SitongV4App.tsx`、`apps/web/src/pages/IndustryWorkbenchPrototypePage.tsx`、`apps/web/src/styles/sitong-v4.css`、`apps/web/src/styles/industry-workbench-prototype.css`、`scripts/industry-workbench-prototype-smoke.mjs`。

### 第二批（已完成，2026-09-12）：`/clip-lab`

只删路由分支，**保留页面组件**——实测它们仍服务在售的 `/agents/clipper` 工作台，删掉会直接打坏在售能力：

- 删除：`main.tsx` 里的 `/clip-lab` 分支（含原「生产环境跳 `/agents/clipper`」逻辑）。
- 保留：`apps/web/src/pages/ClipLabApp.tsx`、`apps/web/src/pages/PersonaClipLabApp.tsx`、`apps/web/src/styles/clip-lab.css`、`apps/api/src/routes/clip-lab.ts`。
- 保留依据：`apps/web/src/pages/AgentProductsApp.tsx` 仍 `import ClipLabApp from "./ClipLabApp.js"`，并在 `agent.slug === "clipper"` 时渲染；这条已写成契约硬断言（`filesKept` + `stillUsedBy`），谁删谁的红灯先亮。

### 第三批（待用户点头）：`/internal/*`

这是平台内部控制台。用户 2026-09-12 的口径是「如果以后不打算用就可以下掉；我不擅自删」，**本轮未动**，等用户明确回答是否仍要用。

### 顺带修掉的真实毛病（PLAT-18 附带）

输错网址不再掉进外卖增长智能体的首页：路由表最后一行的 `return <AgentHomePage />` 改为 `return <NotFoundPage />`，新增 `apps/web/src/pages/NotFoundPage.tsx` + `apps/web/src/styles/not-found.css`（回显用户输错的路径，给出「回到智能体平台首页」「去常用智能体」两个出口，桌面与移动端都可读）。

### 本次不做

- 不删任何用户可能已经收藏或印在物料上的网址（`/market*`、`/agents/beauty-industry*`、`/lanqi/*` 全部保留）。
- 不动 `/lanqi/*` 的「开发中」占位页——它们是用户在用的上线口径（`LANQI_MOMENTS_ONLY_LAUNCH`）。
- 不动 `AgentProductsApp.tsx` 里的 `export function AgentHomePage()`（工作台内部仍在复用，只是不再作为全局兜底）。

### 保留网址清单契约（用户硬要求，「删前先加」）

- `scripts/platform-route-contract-smoke.mjs`（`pnpm.cmd platform:route-contract-smoke`）：只读源码、不连网、不调模型、不花钱。
  1. 37 组保留网址必须在 `main.tsx` 有对应路由分支；
  2. 第一/二批已删路由不得复活，对应文件必须已删除；`/clip-lab` 的复用组件必须仍在；
  3. 未知网址必须落 `NotFoundPage`，`main.tsx` 不得再加载 `AgentHomePage`；
  4. 契约自身必须挂在 `qa:fast` 上（防止有人把门禁摘掉）。
- 已注册 `package.json`：`platform:route-contract-smoke` 挂进 `qa:fast`（在 `lanqi:brand-nav-contract-smoke` 之后、`typecheck` 之前）。
- 真实浏览器验收：`scripts/platform-route-browser-e2e.mjs`（`pnpm.cmd platform:route-browser-e2e`，`PLATFORM_ROUTE_WEB_URL` 指定实例），覆盖保留网址、已删网址、乱码网址、控制台错误、`/agents/clipper` 未被波及、移动端 390×844 排版。

### 验收条件

1. 正常路径：清理后所有保留网址逐个真实浏览器打开成功，无白屏、无 console 错误。
2. 失败路径：被删网址访问时落到统一的「已下线」说明或替代页，或明确 404，不得显示其他产品的页面。
3. 不应发生：① 在售智能体入口失效；② 兼容跳转失效；③ 一次批量删除超过一个批次（每批只删一组，独立回滚）。
4. 每批清理前先加路由契约（列出保留网址清单），跑通后才删；清理后 `pnpm.cmd qa:fast` 必须绿。

### 部署记录（2026-09-12，测试实例 + 生产）

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 测试 | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | https://api.lcppch.top/lanqi-test/ | `20260912-plat18-route-cleanup-test1` | `DEPLOY_OK`（`stale files removed: 6`）+ `VERIFY_OK` + `platform:route-browser-e2e` **PASS 24/24** |
| 生产 | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | https://api.lcppch.top/os-v2/ | `20260912-plat18-route-cleanup-prod1` | `DEPLOY_OK`（`stale files removed: 6`）+ `VERIFY_OK` + `platform:route-browser-e2e` **PASS 24/24**（**部署前同脚本对生产 12/24 失败**，Bug 当场复现并被修掉） |

- 发布包：`release-20260912-plat18-route-cleanup-full.tar.gz`，sha256 `92a36b4f391dd2eb92957b43ede7430eb9a945745e2cd00cb8260b385cd21551`，1456 文件。
- 部署前备份：`/opt/baolu-backups/20260912-plat18-route-cleanup-prod1-before-baolu-os-v2/`、`/opt/baolu-backups/20260912-plat18-route-cleanup-test1-before-baolu-os-v2-test/`。
- 契约 smoke 计数：`platform_route_contract_smoke: PASS (99 passed / 0 failed)`，其中保留网址 37 组。
- 详细发布记录见 `docs/CURRENT_DEPLOYMENT_STATUS.md` 顶部条目；缺陷红/绿证见 `docs/BUG_REGRESSIONS.md` **QA-20260912-007**。
- 工程坑（已修）：`scripts/tmp/*.ps1` 为「UTF-8 无 BOM + LF」，PowerShell 5.1 按 ANSI 解码会把中文注释后的换行吞掉、静默注释掉下一行代码——这是首次打包时 6 个已删文件没被过滤的真正根因。已改 `build-prod-filelist.ps1`、`build-release-archive.ps1` 注释为 ASCII 并加显式警告；其余 `.ps1` 风险未清。

### 交接

- 回滚方式：还原 `/opt/baolu-backups/20260912-plat18-route-cleanup-{prod1-before-baolu-os-v2,test1-before-baolu-os-v2-test}/` 并 `systemctl restart`；或恢复 6 个已删文件 + 把 `main.tsx` 全局兜底改回 `<AgentHomePage />` 重新发包。
- 清垃圾（2026-09-12 已执行）：删 `/opt/baolu-stage/20260911-*` 13 个历史构建暂存目录（5.0G）+ `/tmp` 41 个发布传输产物，磁盘 77% → 59%（6.5G → 12G 可用）；`/opt/baolu-backups/**` 完全未触碰，当日 `20260912-*` 暂存目录保留。删后复核 `systemctl is-active=active`、`health=200`、`web=200`、`skus=200`。
- 待办：① 用户确认 `/internal/*` 是否还需要（**第三批，需单独点头，本轮未动**）；② `dist/assets` 历史产物（2263 文件 / 131M）清理**按工程判断暂缓**——收益小、要精确算全链路 import 可达集合才安全，建议随下次发布改为构建期生成可达清单后一起做。
- 最后更新日期：2026-09-12

## PLAT-19 智能体页面只显示积分，不再显示折算人民币

状态：**已改 + 已回归（本地 qa:fast 全绿）**，等待发布到测试实例与生产。

- 用户 2026-09-12 提出：「每次生成提示用户消耗多少积分就可以了 不要告诉花了多少钱 比如：约扣 60 积分 · ≈ ¥3 去掉≈ ¥3 平台每个智能体页面都只显示消耗多少积分 不显示消耗多少元」。

### 归属

- 产品：公共平台（客户侧前端展示口径）。
- 层级：纯展示口径，**不动计费、不动定价、不动钱包余额计算**。
- 风险：低（删除的只是「积分 → 人民币折算」的展示片段；折算函数本体保留给内部/管理端）。
- 修改热点：`apps/web/src/pages/MarketplaceApp.tsx`、`apps/web/src/components/chat/ChatMessages.tsx`、`packages/shared/src/index.ts` 注释。
- 是否允许并行：否，与货架/充值页展示冲突，须串行。

### 用户结果

客户在货架、智能体详情页、聊天页看到的扣费提示只有「N 积分」，不再出现「≈ ¥N」；**充值页 `/recharge` 仍显示真实付款金额（¥）**，因为那是真实支付，不是折算。

### 口径边界（写清楚，防止被改回去）

1. 客户界面：只显示积分。`约扣 60 积分`、`本次消耗 N 积分`、`N 积分/次`、`本次导出需 N 积分` 保留。
2. 充值页：保留 `¥` 与「基准 1 元 = 20 积分」——用户要付真钱，必须看到金额。
3. 内部/管理端：`yuanLabelForCredits` / `creditsToYuan` / `formatYuanText` 函数**保留**（`packages/shared/src/index.ts`），但加注释标明「仅供内部/管理端使用」并指向本契约 smoke，防止被搬回客户界面。

### 改动清单

- `apps/web/src/pages/MarketplaceApp.tsx`：删掉 `yuanLabelForCredits` import 与 13 处「≈ ¥」渲染（顶栏钱包、专区封面副标题、分步链路、单品货架卡、余额卡、已购列表、导出 402 alert、聊天页消耗、生成确认气泡、免费重做提示、Word 导出按钮）。
- `apps/web/src/components/chat/ChatMessages.tsx`：删掉 import；Word 导出按钮改为「下载精美 Word · N 积分」。
- `packages/shared/src/index.ts`：给 `yuanLabelForCredits` 加「仅供内部/管理端使用」注释 + 指向 `marketplace:credits-only-contract-smoke`。

### 保留网址清单契约（同 PLAT-18 口径：删前先加）

- 新增 `scripts/marketplace-credits-only-contract-smoke.mjs`（`pnpm.cmd marketplace:credits-only-contract-smoke`）：只读源码、不连网、不调模型、不花钱。
  1. `apps/web/src` 内不得出现 `≈ ¥`，不得出现「积分 + ¥」组合；
  2. `apps/web/src` 不得再引用 `yuanLabelForCredits` / `creditsToYuan` / `formatYuanText`；
  3. 关键扣费提示必须仍说「N 积分」（生成确认气泡、聊天页消耗、分步链路、单品详情、导出 402、重做提示、Word 导出 ×2）；
  4. 白名单豁免 `apps/web/src/pages/RechargePage.tsx`（真实支付金额），并要求充值页仍显示 `¥` 与「基准 1 元 = 20 积分」；
  5. 换算函数本体必须仍在 `packages/shared` 且带「仅供内部」标注；
  6. 契约自身必须挂在 `qa:fast` 上（防止有人把门禁摘掉）。
- 已注册 `package.json`：`marketplace:credits-only-contract-smoke` 挂进 `qa:fast`（在 `marketplace:sku-link-contract-smoke` 之后）。
- 修改 `scripts/deployed-marketplace-browser-check.mjs`：线上浏览器断言由「同时展示积分与人民币折算」改为「只显示积分 + 不得出现 `≈ ¥`」，输出字段 `credits_only=PASS` / `no_yuan_conversion=PASS`。

### 验收条件

1. 正常路径：货架、智能体详情、聊天页、生成确认、导出提示都只显示「N 积分」。
2. 失败路径：积分不足的导出 alert 仍说明所需积分，不出现金额。
3. 不应发生：① 客户界面出现 `≈ ¥` 或任何折算金额；② 充值页丢失真实付款金额；③ 计费金额被改动（本次只改展示）。
4. `pnpm.cmd qa:fast` 必须绿。

### 回归证据（先红后绿）

- 修复前红灯（临时 worktree 跑同一脚本）：`FAIL 14 passed / 5 failed`，`exit=1`，关键失败项「前端不再引用积分→人民币折算函数 :: 仍引用 ChatMessages.tsx、MarketplaceApp.tsx」。红灯 worktree 已 `git worktree remove --force` 清掉，未污染主仓库。
- 修复后绿灯（主仓库）：`marketplace_credits_only_contract_smoke: PASS (19 passed / 0 failed)`，`exit=0`。
- 线上真实现状取证（旧包，用户所见）：`DEPLOY_CHECK_WEB_URL=https://api.lcppch.top/lanqi-test node scripts/deployed-marketplace-browser-check.mjs` → `AssertionError`（货架仍在显示「200 积分/次 · ≈ ¥10」「60 积分/次 · ≈ ¥3」），文本存于 `%TEMP%\deployed-marketplace-check-*/01-shelf-agents.txt`。
- `pnpm --filter @baolu/shared build` + `pnpm --filter @baolu/web typecheck` → `exit=0`；`pnpm.cmd qa:fast` → `exit=0`（7 包 typecheck 全绿，含新契约）。

### 部署记录

发布包：`release-20260912-plat19-credits-only-full.tar.gz`（**9311332 B**，sha256 `e4d70513e51286d60134c0f5a522178ccadfa5e96e2891a6f758eeab4c057076`，1458 文件；服务器侧 `sha256sum` 与本机逐字一致）。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 测试 | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | https://api.lcppch.top/lanqi-test/ | `20260912-plat19-credits-only-test1` | `DEPLOY_OK`（`stale files removed: 0`，PLAT-18 已删文件早已不在）+ `VERIFY_OK`（`web_credits_rmb_copy_absent = no` / `web_credits_copy = yes`）+ 浏览器 **PASS** |
| 生产 | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | https://api.lcppch.top/os-v2/ | `20260912-plat19-credits-only-prod1` | `DEPLOY_OK`（`health=200 (after 15s)`）+ `VERIFY_OK` + 浏览器 **PASS**（`journalctl -p err` 近 15 分钟 `No entries`） |

**验收口径（真实浏览器，非类型检查）**：

- `DEPLOY_CHECK_WEB_URL=https://api.lcppch.top/os-v2 node scripts/deployed-marketplace-browser-check.mjs` → `PASS`，`shelf=PASS credits_only=PASS no_yuan_conversion=PASS detail_redo_copy=PASS console_clean=PASS`；截图 `%TEMP%\deployed-marketplace-check-1789174651795\`。
- 货架卡片实际文本（`01-shelf-agents.txt`）：`200 积分/次`、`40 积分/次`、`60 积分/次`——**`¥` 出现 0 次**（修复前同一位置是「200 积分/次 · ≈ ¥10」「60 积分/次 · ≈ ¥3」）。
- 详情页（`02-agent-ip-pos.png`）：`200 积分/次`、`用一次 · 扣 200 积分`，无人民币金额。
- 构建产物导入图探针（从 `index.html` 出发走 import 图，53 个资源，生产与测试实例一致）：`¥` **仍在**（充值页真实付款，正对照）、`≈ ¥` **已消失**、`基准 1 元` **仍在**、`积分` **仍在**。
- 未受波及回归：`platform:route-browser-e2e` 生产 **PASS 24/24**；`marketplace-sku-link-regression --base https://api.lcppch.top/os-v2` → **ALL PASS**；`verify-deploy.sh` 生产 `VERIFY_OK`（`skus_total=19`、`coming_soon=13`、两个 `vidrev` = `selling`）。

### 交接

- 回滚方式：还原 `/opt/baolu-backups/20260912-plat19-credits-only-{prod1-before-baolu-os-v2,test1-before-baolu-os-v2-test}/` 并 `systemctl restart baolu-os-v2`（或 `baolu-os-v2-test`）；也可只还原本轮 3 个前端/共享文件重发包，即恢复「积分 · ≈ ¥」双显示。
- 部署前备份：生产 `/opt/baolu-backups/20260912-plat19-credits-only-prod1-before-baolu-os-v2/`；测试 `/opt/baolu-backups/20260912-plat19-credits-only-test1-before-baolu-os-v2-test/`。发布日志 `/tmp/deploy-20260912-plat19-credits-only-{prod1-baolu-os-v2,test1-baolu-os-v2-test}.log`。
- 待办：无（用户口径已一次说清；若以后要恢复金额显示，需先问用户）。
- 最后更新日期：2026-09-12

## PLAT-20 用户侧输出模型升级到 DeepSeek 最新版（4.1）

状态：**已关闭（用户选 A：维持现状，2026-09-12）**。用户点名的 `deepseek 4.1` 在当前两条上游链路上都不存在，最后落定：货架继续用 `deepseek-v4-flash`，无任何代码/配置变更。

- 用户 2026-09-12 提出：「产环境 `MARKETPLACE_MODEL` 没配，所以货架那批付费智能体实际跑的是默认的 `deepseek-v4-flash`，而不是主对话用的 `deepseek-v4-pro`。成本因此还要再低一些。思潼AI接 deepseek 4.1 换成 deepseek 4.1 模型给用户输出」。

### 归属

- 产品：公共平台（模型路由 / 推理成本口径）。
- 层级：运行时配置为主（`MARKETPLACE_MODEL`），**不动计费规则**。
- 风险：中——影响所有付费交付的质量、延迟和推理成本。
- 预计修改热点：生产/测试 env（`MARKETPLACE_MODEL`）；必要时 `apps/api/src/routes/marketplace.ts:277` 的隐式默认值。
- 是否允许并行：允许（只动 env 或单文件）。

### 现状取证（2026-09-12，只读，未改任何生产配置）

1. 生产 env `/etc/baolu-secrets/baolu-os-v2.env` 只有 `LLM_PROVIDER=deepseek`、`DEEPSEEK_MODEL=deepseek-v4-pro`；**没有 `MARKETPLACE_MODEL`**。
2. `apps/api/src/routes/marketplace.ts:277`：`model: process.env.MARKETPLACE_MODEL ?? "deepseek-v4-flash"` → 货架付费智能体跑 flash，主对话跑 pro。**用户所述口径成立**（成本确实更低）。
3. 上游 OEM 端点 `GET $DEEPSEEK_BASE_URL/models` 只返回两个 id：`deepseek-flash`、`deepseek-v4-pro`。
4. 直接打 `POST /chat/completions`：`deepseek-v4.1`、`deepseek-v4.1-pro`、`deepseek-v4-1`、`deepseek-4.1` 全部被拒，回包逐字为
   `{"error":{"message":"The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed deepseek-v4.1.","type":"invalid_request_error","code":"invalid_request_error"}}`。
5. `deepseek-v4-flash` 是可用别名：实测一次 `max_tokens=1` 回包 `"model":"deepseek-flash"`（`prompt_tokens=31`，`reasoning_tokens=1`，约 ¥0.0001 量级），所以货架当前默认值**不是**无效配置。
6. 百炼/DashScope 目录 `GET $DASHSCOPE_BASE_URL/models` 内的全部 deepseek id：`deepseek-v4-pro`、`deepseek-v4-pro-0813`、`deepseek-v4-flash`、`deepseek-v4-flash-0731`、`vanchin/deepseek-*`、`siliconflow/deepseek-*`、`deepseek-v3*`、`deepseek-r1*`——**没有任何 4.1**。

**结论**：`deepseek 4.1` 目前 DeepSeek 官方链路与百炼链路都拿不到，无法切换。若用户是在 Codex 客户端模型选择里看到 `deepseek-v4.1-flash`（2026-09-10 到期的实验模型），那是客户端自带模型，与产品调用的 `api.deepseek.com` 不是同一条链路。

### 待用户决策（二选一，均可 5 分钟内执行）

- **A（维持现状）**：货架继续用 `deepseek-v4-flash`。成本最低、延迟最低，质量弱于主对话。
- **B（升到 pro）**：`MARKETPLACE_MODEL=deepseek-v4-pro`，与主对话同款。质量更高，成本和延迟上升；**用户支付的积分不变**——定价锚交付价值，成本只做毛利告警、不进定价公式（`packages/shared/src/index.ts:492`）。

### 决定与收尾（2026-09-12）

- 用户明确回复「**选 A 维持现状**：货架继续 flash，成本、延迟最低，质量弱于主对话」。
- 收尾取证（只读）：生产 `/etc/baolu-secrets/baolu-os-v2.env` 仍为 `LLM_PROVIDER=deepseek`、`DEEPSEEK_MODEL=deepseek-v4-pro`，**没有 `MARKETPLACE_MODEL`** → 代码默认 `deepseek-v4-flash` 生效，与用户选择一致。**无 env 改动、无代码改动、无发布、无回滚需求。**
- 该任务只做决定，不产生本次交付物；验收条件里与「切模型」相关的项不再执行。

### 本次不做

- 不擅自改生产/测试模型（成本与延迟口径变化需用户点头）。
- 不猜测性启用 4.1 相关别名，不做静默降级/回落。

### 验收条件（用户选 A/B 后执行）

1. 正常路径：`MARKETPLACE_MODEL` 显式配置为目标模型，货架 SKU 生成成功且按 `sku.ppu` 扣积分。
2. 失败路径：配置了上游不支持的模型 id 时必须失败关闭并给出明确错误，不静默回落、不误扣费。
3. 不应发生：① 用户支付积分随推理成本变化；② 未配置时静默使用高成本模型；③ 主对话模型被连带改动。
4. 可观测结果事件：交付记录/运行观测里的 `model` 字段等于配置值；`journalctl -u baolu-os-v2 -p err` 无 provider 4xx。

### 交接

- 回滚方式：还原 `MARKETPLACE_MODEL` 一行（或删除该行回到 flash 默认）+ `systemctl restart baolu-os-v2`。
- 待办：① ~~用户选定 A/B~~（已选 A）；② 若上游日后上线 4.1，再按同一方式切换，并同步确认 `llm-model-policy` 白名单（`LLM_ALLOWED_MODELS`）后跑一次真实样例。
- 最后更新日期：2026-09-12

## PLAT-21 客户侧响应不得暴露内部算力成本

状态：**已改 + 已回归（先红后绿）+ 已上测试实例与生产**。缺陷条目见 `docs/BUG_REGRESSIONS.md` **QA-20260912-010**。

- 用户 2026-09-12 提出：「我们把成本直接暴露给客户了。`/marketplace/run` 的响应里带了 `modelCostCny` 字段……客户打开开发者工具就能看到我们每次赚多少。这跟 `CONTRACTS.md` 里写的『不向普通用户暴露供应商、密钥或内部成本』冲突。建议从响应里摘掉，内部审计继续走账本 `metadata` 就够了。抓紧摘掉」。

### 归属

- 产品：公共平台（货架/按次付费接口的响应用词边界）。
- 层级：纯响应口径，**不动计费、不动定价、不动钱包与账本字段**。
- 风险：低（删的是客户从未使用的两个字段；内部审计字段原样保留）。
- 修改热点：`apps/api/src/routes/marketplace.ts`（热点文件，与货架/计费同源，须串行）。
- 是否允许并行：否。

### 用户结果

客户在 `/marketplace/run`（及货架各智能体生成）拿到的 JSON 只剩他该看到的东西：`consumedCredits`（本次扣多少积分）、`balance` 等；**真实算力成本 `modelCostCny` 不再出现在响应里**，客户无法从响应反推我们的成本与毛利。

### 口径边界（写清楚，防止被改回去）

1. 客户侧响应：**禁止**任何内部成本口径——`modelCostCny`、成本折算积分 `estimatedCredits`、`estimatedProviderCostYuan`、单位成本价（¥/百万 token）、加价倍数都不得出现。
2. 内部审计：成本与 token 计数只走账本 `MarketplaceLedgerEntry.metadata`（`modelCostCny` / `estimatedCredits` / `promptTokens` / `completionTokens` / `reasoningTokens`），一个都不能删。
3. 客户要看到的积分口径保留：`consumedCredits`（= SKU 定价 `ppu`）、`balance` / `paidBalance` / `bonusBalance`、`requestId`、`spent`、`freeRedo`。
4. 白名单（不是漏洞）：兰琪报价页 `/lanqi` 的 `estimatedCredits` 是**对外公开单价**（`quoteLanqiMedia()` 直读 `LANQI_MEDIA_*_CREDITS`：30 积分/秒、每镜 90 积分），用户明确要求「确认素材权利后显示本次报价」，必须保留；管理端 `gmvCny`、账本 `amountCny` 属内部管理/账本，同理保留。
5. 已覆盖两处客户端响应：货架 `/market/skus/<sku>/run`（`modelCostCny` / `estimatedCredits`）与美业图片报价 `/beauty-industry/acquisition/runs/:runId/media/quote`（`estimatedProviderCostYuan`）。报价的服务端成本闸门（`estimateBeautyImageProviderCostYuan` + `resolveReadiness`）必须保留。

### 改动清单

- `apps/api/src/routes/marketplace.ts`：成功响应删除 `modelCostCny: costCny,`、`estimatedCredits: dynamicCredits,`；账本 metadata 不动。
- `apps/api/src/routes/beauty-industry-media.ts`：`/media/quote` 响应删除 `estimatedProviderCostYuan,`（服务端闸门与 job 参数里的成本审计字段不动）。
- `apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx`：`BeautyMediaQuote` 类型删除 `estimatedProviderCostYuan?: number;`（页面本来就没渲染它）。
- `scripts/marketplace-live-run-smoke.ts` / `scripts/marketplace-ip-pos-run-smoke.ts` / `scripts/marketplace-vidrev-run-smoke.ts`：加 `!("modelCostCny" in body)`、`!("estimatedCredits" in body)` 缺席断言 + 账本 `metadata.modelCostCny` 审计断言；日志改为 `costFieldsAbsent` / `ledgerModelCostCny`。
- 新增 `scripts/response-cost-contract-smoke.mjs`（29 条离线断言）并注册 `platform:response-cost-contract-smoke`，挂进 `qa:fast`。

### 验收条件

1. 正常路径：生成成功响应只含客户字段，扣费与余额结算不变（`consumedCredits` = SKU 定价）。
2. 失败路径：模型失败（502）、校验失败（422）、积分不足（402）、免费重做用尽（409）等分支本就不含成本字段，修复后仍不含。
3. 不应发生：① 响应里出现 `modelCostCny` / `estimatedCredits` / `estimatedProviderCostYuan` / 单位成本；② 为了堵泄露把账本审计字段或服务端成本闸门删掉；③ 把客户需要的积分提示一起删掉。
4. 可观测结果事件：账本 `metadata.modelCostCny` 仍可查（真实运行实证 `0.029529`）；`costFieldsAbsent=true`；`qa:fast` 绿。

### 回归证据（先红后绿）

- 修复前红灯：第一处 `FAIL (15 passed / 7 failed)`、`exit=1`；扩到第二处后 `FAIL (25 passed / 4 failed)`、`exit=1`。
- 修复后绿灯：`node scripts/response-cost-contract-smoke.mjs` → `PASS (29 passed / 0 failed)`、`exit=0`；`pnpm.cmd qa:fast` **exit=0**。
- 真实端到端（本地 Postgres + 真实 DeepSeek）：`VIDREV_SMOKE_ONLY=deep pnpm.cmd marketplace:vidrev-run-smoke` → **PASS**（`elapsedMs=14843`、`consumedCredits=60`、`costFieldsAbsent=true`、`ledgerModelCostCny=0.029529`、`answerChars=5425`）。

### 交接

### 部署记录（2026-09-12，测试实例 + 生产）

第一轮 `release-20260912-plat21-cost-leak-full.tar.gz`（9326080 B，sha256 `dcd156437143c2bfcdc2d7c1fdcf59d447ea4c782511682ee6b7658ccf9dd21f`，1460 文件）；**当前线上版本**为第二轮 `release-20260912-plat21-cost-leak2-full.tar.gz`（**9327277 B**，sha256 `b6d922a58bac4525e39f21e837e1296e584d2b93d4768896cfeb19fb518647ac`，1460 文件，无意删文件）。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 测试 | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | https://api.lcppch.top/lanqi-test/ | `20260912-plat21-cost-leak-test1` | `DEPLOY_OK`（`health=200 (after 15s)` / `ready=200`，48 迁移无待应用）+ `VERIFY_OK` + 浏览器 **PASS** |
| 生产 | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | https://api.lcppch.top/os-v2/ | `20260912-plat21-cost-leak-prod1` | `DEPLOY_OK`（同上）+ `VERIFY_OK`（`skus_total=19` / `coming_soon=13` / 两个 `vidrev` = `selling`）+ 浏览器 **PASS** + `marketplace-sku-link-regression` **ALL PASS**；`journalctl -p err` 近 10 分钟 `No entries` |
| 测试 | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | https://api.lcppch.top/lanqi-test/ | `20260912-plat21-cost-leak2-test1` | 同上（含美业报价一处）+ `VERIFY_OK` + 浏览器 **PASS** |
| 生产 | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | https://api.lcppch.top/os-v2/ | `20260912-plat21-cost-leak2-prod1` | 同上 + 浏览器 **PASS** + `marketplace-sku-link-regression` **ALL PASS**；`journalctl -p err` 近 8 分钟 `No entries` |

上线后对部署产物验证（不只信源码，生产实例）：`marketplace.js` 中 `modelCostCny` / `estimatedCredits` 各只出现 1 次且均在账本 `metadata` 内，其后的 `return { state: "completed", ... }` 已无成本字段；`beauty-industry-media.js` 的 `/media/quote` 响应对象已无 `estimatedProviderCostYuan`，而成本闸门与 job 审计字段仍在。

### 交接

- 回滚方式：还原 `/opt/baolu-backups/20260912-plat21-cost-leak-{prod1-before-baolu-os-v2,test1-before-baolu-os-v2-test}/` 并 `systemctl restart baolu-os-v2`（或 `baolu-os-v2-test`）；纯响应字段删除，无迁移、无数据变更。部署日志 `/tmp/deploy-out-plat21-{test1,prod1}.log`、`/tmp/verify-plat21-{test1,prod1}.log`。
- 残余：① `marketplace:live-run-smoke` 因 `ipzone__moments` 状态以发布文件为准（QA-20260911-016 口径）而在本地 409 失败，属**既有问题**，本任务未扩大范围修复；真实端到端改用 `marketplace:vidrev-run-smoke`。② 美业图片 job `serialize()` 仍回传 `provider` / `model`（供应商与模型名）——属「供应商身份」而非「内部成本」，`docs/agents/lanqi-beauty/CONTRACTS.md` 有专门条款，**本轮未动**，等用户点头后单独处理。
- 待办：① 若以后给客户开放任何「用量/成本」视图，必须先定义清楚「对外单价 vs 内部成本」再动手，不得把 `metadata` 字段直接透传；② `marketplace:live-run-smoke` 的 SKU 选择待修（改成已开卖的 SKU 或按发布文件口径置状态）。
- 最后更新日期：2026-09-12

## PLAT-22 客户侧残留内部成本字段清理（剪辑台渲染成本）

状态：**已改 + 已回归（先红后绿）+ 已上测试实例与生产**。

- 用户 2026-09-12：「把上面这两个问题（成本字段外泄、换算常量口径）分别开成任务卡，按你说的『每批只动一件事』的节奏来修」。本卡是**第一批：成本字段外泄**的收尾——PLAT-21 已摘掉货架与美业报价两处，本卡只清剩下这一处。

### 归属

- 产品：公共平台（`/agents/clipper` 工作台智能体的响应口径）。
- 层级：纯响应字段，**不动计费、不动渲染逻辑、不动效率口径**。
- 风险：低（该字段前端从未渲染）。
- 修改热点：`apps/api/src/routes/clip-lab.ts`（与 `platform:route-contract-smoke` 的「第二批保留」断言相关，删路由不行、只删字段可以）。
- 是否允许并行：是（单文件）。

### 本批只动一件事

`POST /clip-lab/render` 响应里 `result.measurement.estimatedLocalCostYuan`。

### 现状取证（2026-09-12，修复前）

- `apps/api/src/routes/clip-lab.ts:240`：`estimatedLocalCostYuan: Number(Math.max(0.01, result.renderMs / 3_600_000 * 2.4).toFixed(2))`——把本机渲染成本（按 ¥2.4/小时估）回给浏览器。
- 消费方是 `/agents/clipper` 页面（`AgentProductsApp.tsx:1607` → `ClipLabApp`），租户可打开；全仓 grep 显示前端**从未渲染**该字段，只在响应里白送。

### 修复

- 删除 `estimatedLocalCostYuan` 一个字段。
- 保留同一 `measurement` 里不含钱的效率口径：`totalMs`、`renderMs`、`realtimeFactor`、`machineVideosPerHour`、`estimatedHumanMinutes`、`humanReviewVideosPerHour`（这是产品卖点，不能为了删成本一起删）。
- `scripts/response-cost-contract-smoke.mjs` 新增第 ⑥ 段（4 条断言）：渲染响应不得含 `estimatedLocalCostYuan`、4 个效率口径必须仍在、客户前端不得引用该字段。契约从 29 条扩到 **35 条**。

### 验收条件

1. 正常路径：剪辑台渲染成功响应只含效率口径，不含本地成本。
2. 失败路径：渲染失败分支本就不含该字段，修复后仍不含。
3. 不应发生：① 响应出现 `estimatedLocalCostYuan`；② 为删成本把 `machineVideosPerHour` 等效率口径或 `/clip-lab` 路由一起删掉（后者会红 `platform:route-contract-smoke`）。
4. 可观测结果事件：契约 35/35 绿；`qa:fast` 绿。

### 回归证据（先红后绿）

- 修复前红灯：`node scripts/response-cost-contract-smoke.mjs` → `FAIL (34 passed / 1 failed)`、`exit=1`，失败项 `[FAIL] 剪辑台渲染响应不含 estimatedLocalCostYuan（本地算力成本，人民币） :: 渲染响应仍含本地成本字段`。
- 修复后绿灯：`PASS (35 passed / 0 failed)`、`exit=0`；`pnpm.cmd qa:fast` **exit=0**（含 `platform:route-contract-smoke` 99/0、7 包 typecheck 全绿）；全仓 grep 除契约自身外无残留引用。

### 本次不做（另外两件，等用户定，不混批）

- 美业图片 job `serialize()` 仍回传 `provider` / `model`（供应商与模型名，属「供应商身份」而非成本，`docs/agents/lanqi-beauty/CONTRACTS.md` 有专门条款）。
- 换算常量口径：见 **PLAT-23**（单独一批，需用户先拍板）。

### 部署记录（2026-09-12，测试实例 + 生产）

发布包 `release-20260912-plat22-cliplab-cost-full.tar.gz`（**9333118 B**，sha256 `c0a65060b663c31642df90eee188f7f338ed3bb25101e1d6f9242acc7cabdce4`，1460 文件，无意删文件；本机与服务器 `sha256sum` 逐字一致）。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 测试 | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | https://api.lcppch.top/lanqi-test/ | `20260912-plat22-cliplab-cost-test1` | `DEPLOY_OK`（`health=200 (after 18s)` / `ready=200`，48 迁移无待应用）+ `VERIFY_OK`；部署产物 `clip-lab.js` 里 `estimatedLocalCostYuan` **0 次** |
| 生产 | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | https://api.lcppch.top/os-v2/ | `20260912-plat22-cliplab-cost-prod1` | `DEPLOY_OK`（`health=200 (after 15s)` / `ready=200`）+ `VERIFY_OK`（`skus_total=19` / `coming_soon=13` / 两个 `vidrev` = `selling`）+ 浏览器 `deployed-marketplace-browser-check` **PASS** + `platform:route-browser-e2e` **PASS 24/24** + `marketplace-sku-link-regression` **ALL PASS**；`journalctl -p err` 近 8 分钟 `No entries` |

上线后对部署产物验证（生产实例）：`apps/api/dist/apps/api/src/routes/clip-lab.js` 里 `estimatedLocalCostYuan` **0 次**；同轮复核 `marketplace.js` 的 `modelCostCny` 仍只有 1 次（账本 metadata），PLAT-21/22 三处口径没有互相回退。

### 交接

- 回滚方式：还原 `/opt/baolu-backups/20260912-plat22-cliplab-cost-{prod1-before-baolu-os-v2,test1-before-baolu-os-v2-test}/` 并 `systemctl restart baolu-os-v2`（或 `baolu-os-v2-test`）；也可只恢复 `clip-lab.ts` 那一行重发包。纯响应字段删除，无迁移、无数据变更。部署日志 `/tmp/deploy-out-plat22-{test1,prod1}.log`、`/tmp/verify-plat22-{test1,prod1}.log`。
- 最后更新日期：2026-09-12

## PLAT-23 积分 ↔ 人民币 ↔ 成本换算常量口径统一（先定口径，再动代码）

状态：**阻塞（待用户拍板口径）**。本卡只做只读取证与方案，**未动任何代码**——因为其中两个选项会改变内部估算口径，第三个选项才纯粹是注释，必须先由用户选定。

- 用户 2026-09-12 要求把「换算常量口径」单独开成任务卡，与「成本字段外泄」（PLAT-21/PLAT-22）分成两批。

### 归属

- 产品：公共平台（积分 ↔ 人民币 ↔ 算力成本的换算口径）。
- 层级：内部口径与常量定义；**对客价格与扣费口径不在本卡授权范围内**（要改必须先问用户）。
- 风险：中（常量被误改成倍数就会直接改变对客价格，属动钱）。
- 是否允许并行：否（与货架计费/兰琪媒体报价同源）。

### 现状取证（2026-09-12，只读）

**1）对客售价线**（单一事实来源，成立）

- `packages/shared/src/index.ts:494`：`CREDIT_PRICING = { ptsPerYuan: 20, customerPriceCnyPerCredit: 0.05, formula: "售价锚交付价值；成本波动由毛利吸收，不传导到前端价格" }`。
- `CreditPack` 注释「基础积分严格等于 priceCny × 20」，实测 `pack_50 = 50 元 / 1000 积分`、`pack_100 = 100 元 / 2000 积分`（另加多送），充值页文案「基准 1 元 = 20 积分」一致。

**2）内部成本线**（与 1 不一致）

- `apps/api/src/services/marketplace-cost.ts:9-14`：`MARKETPLACE_DEFAULT_INPUT_CNY_PER_1M = 3`、`MARKETPLACE_DEFAULT_OUTPUT_CNY_PER_1M = 6`（注释「DeepSeek 官方人民币价」）、`MARKETPLACE_CREDIT_MARKUP = 20`（注释「思潼对外积分按实际算力成本的倍数定价」）、`MARKETPLACE_COMPUTE_COST_CNY_PER_CREDIT = 0.01`。
- 生效公式：`credits = max(1, ceil(costCny × 20 / 0.01)) = ceil(costCny × 2000)`。

**3）具体矛盾**

- 同一个「积分」：线 1 是 **¥0.05 售价**，线 2 是 **¥0.01 成本**，差 5 倍；再叠加「20 倍」，真实倍数是 **成本 → 营收 100 倍**，而常量名与注释写的是 **20 倍**。
- 真实数字实证（PLAT-21 那轮真实深度复盘）：成本 `¥0.029529` → 成本折算 `60 积分`（按对客口径 ≈ ¥3），而该 SKU 实际按固定价扣 **200 积分（= ¥10）**。三个数字同时存在，没有一处文档说清哪个是「客户的价」、哪个是「我们的成本」。
- `CREDIT_PRICING.formula` 写「成本不进定价公式」，但线 2 的 `成本 × 2000` 正是成本进公式——两句口径互斥。

**4）模型单价表有两套**

- `marketplace-cost.ts:9-10`：`¥3 / 百万 input`、`¥6 / 百万 output`。
- `apps/api/src/products/beauty-industry/text-budget.ts:7-8`：`¥3.48 / 百万`（`0.435 × 8`）、`¥6.96 / 百万`（`0.87 × 8`），版本号 `deepseek-v4-pro-20260824-conservative-cny`（自称"保守"）。
- 同一模型两套价，仓库里没有任何地方说明「何时用哪套」（保守价用于预算上限，默认价用于事后估算？目前只有代码可推断）。

**5）不同产品线的「成本 → 积分」倍数还不同**

- 货架：固定 `sku.ppu`（定价锚交付价值，与成本无关）。
- 美业图片：`beauty-industry-media.ts:34` 每张成本 `¥0.2`（版本 `wan2.7-image-2026-08-27-cny-v1`），对客 `BEAUTY_MEDIA_IMAGE_CREDITS`。
- 兰琪视频：`LANQI_MEDIA_VIDEO_CREDITS_PER_SECOND = 30`（`lanqi-media-generation.ts:44` 注释口径「成本 ×10」）。
- 三条线分别是「固定价 / ×2000 / ×10」，没有一张统一表可查。

**6）展示 vs 扣费**

- 货架展示与扣费都用 `sku.ppu`（一致）。
- 成本折算的 `estimatedCredits` 已只进账本 `metadata`（PLAT-21）；若将来有人拿它做展示，就会出现「约扣 60 积分、实际扣 200」这种矛盾，本卡就是防止有人「顺手」这么改。

### 待用户拍板（三选一；A/C 不改任何数字，B 只改内部估算）

- **A（推荐，先让常量说真话）**：保留现有数值与对客价格，把常量改名/重构为自洽表达（例如 `MARKETPLACE_TARGET_COST_TO_REVENUE_MULTIPLE = 100`，公式改成 `credits = ceil(cost / CREDIT_PRICING.customerPriceCnyPerCredit × TARGET_MULTIPLE)`），并把两套模型价表的关系写进文档。
- **B（让「20 倍」名副其实）**：`credits = ceil(cost × 20 / 0.05) = ceil(cost × 400)`——内部估算积分变成现在的 1/5，**对客扣费不变**，但 `estimatedCredits`（账本 metadata / 未来可能的展示）数字会整体变化。
- **C（最省事）**：数值与公式都不动，只加注释 + 契约测试钉住三个常量的关系（`customerPriceCnyPerCredit` / `MARKETPLACE_COMPUTE_COST_CNY_PER_CREDIT` / `MARKETPLACE_CREDIT_MARKUP`）。

### 验收条件（用户选定后执行）

1. 存在**一份**《积分 ↔ 人民币 ↔ 成本换算口径》文档，写明三条线各自的常量、公式、倍数与适用场景（对客售价 / 内部成本估算 / 各产品线报价）。
2. 新增契约 smoke：三个常量的关系可自动校验（含倍数断言），常量被改到不自洽时红灯。
3. 两套 DeepSeek 价表必须有明确分工与版本号说明，不得再出现「同名不同价、无出处」。
4. 不应发生：① 对客价格/扣费口径在用户未批准的情况下发生变化；② 客户端响应重新出现成本字段（PLAT-21/PLAT-22 契约必须继续绿）。
5. 可观测结果事件：`qa:fast` 绿；货架抽 1 个 SKU 真实跑一次，扣费仍等于该 SKU 的 `ppu`。

### 交接

- 本批不做：不改任何对客价格、不改扣费公式、不动 PLAT-21/PLAT-22 已锁的响应口径。
- 前置：需要用户在上面 A/B/C 中选一个；选 B 需要额外确认「内部估算数字变化」可接受。
- 最后更新日期：2026-09-12

### 用户 2026-09-12 追加提问

> 「定价逻辑还得碰一下。文字、图片、视频成本和对外收费完全不能同比例，且我们还用了多个模型，且模型定价还在变化，要如何定这个积分消耗更合理呢？」

### 现状实测（2026-09-12，只读取证）

| 线 | 现价 | 折人民币 | 单位成本 | 现毛利倍数 |
| --- | --- | --- | --- | --- |
| 轻文字 `ipzone__moments` | 20 积分/次 | ¥1 | ~¥0.01（估，flash） | ~100× |
| 中文字 `*__vidrev` 深度复盘 | 60 积分/次 | ¥3 | **¥0.029529（实测）** | ~100× |
| 重文字 `ipzone__ip-pos` | 200 积分/次 | ¥10 | ~¥0.10–0.25（估，两段 8K 输出） | ~50–100× |
| 长文 `meiye__livescript` | 200 积分/次 | ¥10 | ~¥0.04–0.08（估） | ~150–250× |
| 图片 `wan2.7-image` | 100 积分/张 | ¥5 | **¥0.2/张**（`BEAUTY_IMAGE_PROVIDER_COST_PER_IMAGE_YUAN`） | 25× |
| 视频 `wan2.6-i2v-flash` 720P | 30 积分/秒 | ¥1.5/秒 | **¥0.30/秒**（实测 2 条 3 秒样片 ¥1.80） | **5×** |

三条结论：

1. **同类不同价**：`livescript` 与 `ip-pos` 都收 200 积分/次，成本差约 3 倍；文字线的毛利是视频线的 20–50 倍。
2. **「成本 × 倍数」已经失效**：文/图/视三条线的现实倍数分别是 ~100× / 25× / 5×，而代码里只有一个 `MARKETPLACE_CREDIT_MARKUP = 20`（还名不副实，见上文 3）。
3. **视频线最容易亏**：`wan2.6-i2v-flash` 实测 ¥0.30/秒，对客 ¥1.5/秒只有 5 倍；一旦某次生成失败重做或供应商涨价，很容易掉到 3 倍以下。LQ-23 文档里写的「成本 ×10 口径」与实测不符（实测是 5×）。

### 建议方案 v1（三段式，待用户拍板）

**核心原则：把「模型成本」和「对客价格」彻底解耦，中间只通过「目标倍数区间 + 取整档位」连接。**

**第一段 · 成本账（内部唯一事实来源）** `model-prices.<version>.json`

- 每个模型/模式一条：计价单位（¥/百万 token、¥/张、¥/秒）、单价、币种、生效日、来源（官方价页 / 账单实测）。
- 规则：**改价只改这张表和版本号**；业务代码里不允许再出现 ¥ 单价（现状：DeepSeek `¥3/¥6`（`marketplace-cost.ts`）、`¥3.48/¥6.96`（`text-budget.ts`）、图片 `¥0.2/张`（`beauty-industry-media.ts`）三处硬编码，视频 `¥0.30/秒` 只存在于文档实测里、代码里只有按倍数反推的积分价 30/秒）。
- 用途：成本估算 → 毛利告警 + 预算闸门（fail-closed），**不参与对客价格**。

**第二段 · 能力价目表（对外唯一事实来源）** `capability-pricing.<version>.json`

- 每个能力一行：`capabilityId / 计价单位（次·张·秒·镜）/ 积分价 / 包含量 / 超量单位价 / 最低毛利地板 / 生效日 / 版本号`。
- 定价方法＝**按单位成本的量级分层设倍数区间**（这正是用户说的"不能同比例"的制度化写法）：

| 线 | 单位成本量级 | 建议目标倍数 | 定价形态 |
| --- | --- | --- | --- |
| 文字 | ¥0.01–0.25/次 | **30–100×** | 按次分档（轻/中/重），整数档取整 |
| 图片 | ¥0.2/张 | **10–20×** | 按张，多张打包价 |
| 视频 | ¥0.30/秒 | **4–8×** | 按秒 + 按镜（整片）双口径，带单条上限 |

- 两条地板（硬门禁，写入契约）：任何一次交付 **毛利 ≥ 5×** 且 **绝对毛利 ≥ ¥0.5**（否则一次失败重做就亏）；视频类必须额外预留 **1 次重做成本**。

**第三段 · 变更机制**

- 模型涨价 / 换模型：**不改对客积分价**，只更新成本账版本 → 触发毛利告警；只有跌破地板才进入「复审」。
- 复审结果 = 一个用户批准的价目表新版本（含生效日、旧版归档），前台只跟着价目表走。
- 展示与扣费同源：页面上的「约扣 N 积分」必须来自价目表同一行，不得用成本折算（PLAT-21 已堵住这个坑）。
- 充值锚不动：1 元 = 20 积分保持不变；要调价就调「能力积分价」，绝不去动「积分/元」。

### 第一版价目表草案（数字待用户拍板；**不建议一次全改**）

| 能力 | 计价单位 | 单位成本 | 建议倍数 | 积分价 | 折人民币 | 对现状的动作 |
| --- | --- | --- | --- | --- | --- | --- |
| moments / copy / topic 轻文字 | 次 | ¥0.01–0.03 | 60–100× | 20–40 | ¥1–2 | 维持 |
| vidrev / sales 中文字 | 次 | ¥0.03–0.06 | 50–100× | 60 | ¥3 | 维持 |
| ip-pos 重文字 | 次 | ¥0.10–0.25 | 40–60× | 200 | ¥10 | 维持 |
| livescript 长文 | 次 | ¥0.04–0.08 | 50–100× | 60 | ¥3 | **建议从 200 降**（同类成本却比 vidrev 贵 3 倍），需用户批准 |
| 图片 | 张 | ¥0.20 | 5–10×（实际 5×） | **20**（3 张 = 60） | ¥1（¥3） | **已按用户 2026-09-12 指令从 100 改为 20（¥1/张）** |
| 视频 i2v 720P | 秒 | ¥0.30 | 4–8× | 30（维持） | ¥1.5/秒 | 维持，但加「单条上限 + 1 次重做预留」 |
| Word 导出 | 次 | ~0 | — | 10 | ¥0.5 | 维持（纯利润） |

**要用户点头的三件事（按顺序，一批一件）**：

1. 是否采纳三段式（成本账 / 价目表 / 变更机制）＋三条线的倍数区间（30–100× / 10–20× / 4–8×）＋两条地板。
2. 是否只做「口径与架构」（保持现有对客价不变，先建两张表和契约、把散落的 ¥ 常量收进成本账）——**推荐先做这一步，不动钱**。
3. 是否要顺手对齐上面两个明显不合理的价（`livescript` 200→60、图片 100→20）——**动钱，需单独批准**。

## PLAT-24 视频复盘 chat 页：匿名用户必须立刻被正确引导登录（WorkBuddy QA 2026-09-12 三条 P1）

状态：**已改 + 已回归（先红后绿）+ 已上测试实例与生产**。缺陷条目见 `docs/BUG_REGRESSIONS.md` **QA-20260912-011**。

- 来源：WorkBuddy 报告 `C:\Users\book\WorkBuddy\2026-09-12-07-24-26\OSv2_视频复盘_agent_QA报告.md`（2026-09-12 07:24 快照，匿名视角、桌面 + 移动）。报告第七条给了修复优先级建议，但那是**报告作者的建议**；本卡只采纳与用户结果直接相关的部分，并按仓库「每批只动一件事」拆批。
- 用户 2026-09-12 把该报告交给本任务处理（未附额外文字要求）。

### 归属

- 产品：公共平台（`/agent/<skuCode>/chat` 客户侧对话页的登录/顶栏口径）。
- 层级：客户侧前端交互 + 文案；**不动后端接口、不动计费、不动货架数据**。
- 风险：中（改的是付费生成前的入口；已用带登录的真实 E2E 证明老路径不回归）。
- 修改热点：`apps/web/src/pages/MarketplaceApp.tsx`（货架/详情/我的/管理端/对话页同源热点文件，须串行）。
- 是否允许并行：否。

### 本批只动一件事

「匿名或掉登录的用户在视频复盘 chat 页的登录引导」＝ 顶栏登录入口 + 进页即检测 + 文案不再误导。

### 现状取证（2026-09-12，生产 `https://api.lcppch.top/os-v2`，修复前）

新增只读探针 `scripts/vidrev-chat-anonymous-probe.mjs`（干净 Chrome、不登录、不提交生成、不花钱），两个 SKU × 桌面 1440 / 移动 390 共 4 个视口、每个 4 条断言，**修复前全红**：

- 顶栏文本是 `思潼AI 货架 对话` —— 没有登录入口、没有钱包、没有主题切换，而错误提示让用户「点右上角『未登录 · 点击登录』」。
- 匿名用户直接进入 4 步向导（`hasModeChoice=true`），填完 4 步 + 确认卡片后才在 `POST /market/skus/<sku>/run` 撞 401。
- 页面没有任何可点的登录按钮（`hasLoginButton=false`）。
- 文案是「登录状态已失效，本地登录信息已清除」——匿名首访并不存在「失效」，属误导（报告 P1 第 2 条）。

报告快照里「约扣 60 积分 · ≈ ¥3」的人民币折算已在本日 PLAT-19 下线，属报告时效差异，非新缺陷。

### 修复

1. chat 页顶栏由硬编码的「货架 / 对话」两链接换成全局 `Topbar`（🔒 未登录·点击登录 / 💎 积分余额 / 主题切换 / 退出登录），与货架页一致——报告 P1 第 1 条；顺带解决报告 P2 的「chat 页缺主题切换」。
2. 新增 `hasSession`（读本地会话）+ 钱包读取；**未登录时不渲染 4 步向导**，改渲染登录引导：说明「登录后才能使用、每次扣 N 积分、结果存进自己账号」，主按钮「🔒 立即登录」跳登录并带回跳地址，次按钮回详情看输出参考案例——报告 P1 第 2、3 条。
3. 文案区分：掉登录由「登录状态已失效」改为「登录已过期」（匿名用户已到不了这一步）。

### 验收条件

1. 正常路径（匿名）：进 chat 页立刻看到登录引导 + 可点登录按钮，且**不进入** 4 步向导。
2. 正常路径（已登录）：仍能走完 4 步 + 生成；扣费文案仍为「本次消耗 N 积分」；移动端无横向溢出；控制台无新增错误。
3. 失败路径：登录态过期时提示「登录已过期」并指向真实存在的顶栏登录入口，不扣积分。
4. 不应发生：① 匿名用户被放进 4 步向导后才 401；② 提示用户点击页面上不存在的按钮；③ 把匿名访客直接踢去登录页（详情页仍可匿名浏览——报告未要求改，保持原状）。

### 回归证据（先红后绿）

- 红灯（生产，修复前）：`PROBE_WEB_URL=https://api.lcppch.top/os-v2 node scripts/vidrev-chat-anonymous-probe.mjs` → 4 视口 × 4 断言 **全 FAIL**、`exit=1`。
- 绿灯（生产，修复后）：同命令 **PASS**（4 视口 × 4 断言）：顶栏含「未登录 · 点击登录」、页面出现登录引导与登录按钮、不再出现 4 步向导。
- 老路径不回归（本地带登录，真实模型 1 次深度复盘）：`MP_E2E_WEB_URL=http://127.0.0.1:5175 MP_E2E_API_URL=http://127.0.0.1:3011 node scripts/marketplace-vidrev-browser-e2e.mjs` → **PASS**（`chatRun=true`、11 个正文章节、导出按钮、`costText="本次消耗 60 积分 · 双桶钱包"`、移动端 `overflow=0`、`consoleErrors=0`）。
- `pnpm.cmd --filter @baolu/web typecheck` → `exit=0`；`pnpm.cmd qa:fast` → `exit=0`。

### 本次不做（留给 PLAT-25，第二批）

- 报告 P2 第 5 条：页面标题冗余（「视频复盘 · 视频复盘智能体」）。
- 报告 P2 第 6 条：浏览器 `<title>` 四个页面都是「思潼AI 行业智能体平台」。
- 报告 P2 第 4 条：meiye 欢迎语与进度条不一致——已定位为数据文案问题：`apps/api/src/data/marketplace-v3.json` 的 `industries.meiye.ov.vidrev.welcome` 让用户先答「**第 1 轮**：这条视频挂了 POI / 团购吗？」，而进度条第 1 步是「复盘模式」。属文案/数据改动，单独一批。
- 报告的「未验证项」（生成质量、上传链路）已在上面那条带登录 E2E 中覆盖（真实深度复盘出报告）。

### 交接

### 部署记录（2026-09-12，测试实例 + 生产）

发布包 `release-20260912-plat24-chat-login-gate-full.tar.gz`（**9348144 B**，sha256 `170c6dab0b4fbf37cb70dab30f7737c8e50f99a0f7735baa31c8ad687e9a52f9`，1461 文件，无意删文件；本机与服务器 `sha256sum` 逐字一致）。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 测试（内测免登录实例） | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | https://api.lcppch.top/lanqi-test/ | `20260912-plat24-chat-login-gate-test1` | `DEPLOY_OK`（`health=200 (after 15s)` / `ready=200`）+ `VERIFY_OK` + `PROBE_EXPECT=auto-login` 探针 **PASS**（免登录体验未被闸门弄坏） |
| 生产 | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | https://api.lcppch.top/os-v2/ | `20260912-plat24-chat-login-gate-prod1` | `DEPLOY_OK` + `VERIFY_OK` + 匿名探针 **PASS** + `deployed-marketplace-browser-check` **PASS** + `platform:route-browser-e2e` **PASS 24/24** + `marketplace-sku-link-regression` **ALL PASS**；`journalctl -p err` 近 8 分钟 `No entries` |

**探针两种口径（写清楚，避免下次误判）**：生产实例是真实匿名入口，跑默认 `PROBE_EXPECT=anonymous`；`lanqi-test` 是**内测免登录体验实例**（构建期 `VITE_DIRECT_TEST_LOGIN=true`），访客会被自动开通成兰琪体验工作区，因此那里跑 `PROBE_EXPECT=auto-login`（断言顶栏是登录态、仍能进 4 步向导、不显示登录闸门）。探针已注册为 `pnpm.cmd platform:vidrev-chat-anonymous-probe`；因为要打真实线上，**不挂 `qa:fast`**。

### 交接

- 回滚方式：还原 `/opt/baolu-backups/20260912-plat24-chat-login-gate-{prod1-before-baolu-os-v2,test1-before-baolu-os-v2-test}/` 并 `systemctl restart baolu-os-v2`（或 `baolu-os-v2-test`）；或只回滚 `MarketplaceApp.tsx` 一个文件重发包（纯前端交互/文案，无接口、无迁移、无数据变更）。部署日志 `/tmp/deploy-out-plat24-{test1,prod1}.log`、`/tmp/verify-plat24-{test1,prod1}.log`。
- 待办：PLAT-25（标题体系 + meiye 欢迎语顺序）。
- 最后更新日期：2026-09-12

### 决定与实现（方案 A，2026-09-12 落地）

- 用户 2026-09-12 选定：**「选 A（推荐）：不改任何数字，只让常量说真话——把 `MARKETPLACE_CREDIT_MARKUP` 换成自洽表达（如 `TARGET_COST_TO_REVENUE_MULTIPLE = 100`），公式改为用 `CREDIT_PRICING.customerPriceCnyPerCredit` 推导，并补文档写清两套模型价表何时用哪套。」**

#### 实现

- `apps/api/src/services/marketplace-cost.ts` 重写常量：`MARKETPLACE_TARGET_COST_TO_REVENUE_MULTIPLE = 100`（成本 → 对客营收倍数）、`MARKETPLACE_CUSTOMER_PRICE_CNY_PER_CREDIT = CREDIT_PRICING.customerPriceCnyPerCredit`（¥0.05，唯一事实来源）、`MARKETPLACE_CREDITS_PER_COST_CNY = 100 ÷ 0.05 = 2000`（浮点下**精确**等于 2000）；换算改成单次乘法 `max(1, ceil(成本 × 2000))`。旧的 `MARKETPLACE_CREDIT_MARKUP = 20` 与 `MARKETPLACE_COMPUTE_COST_CNY_PER_CREDIT = 0.01` 从代码里删除（注释里保留「它们是什么、为什么被换掉」的历史说明）。
- 新增口径文档 `docs/PRICING.md`：三条线（对客售价 / 内部成本 / 各产品线倍数）、两套模型价表分工（**事后估算** ¥3/¥6 在 `marketplace-cost.ts`；**预算保守** ¥3.48/¥6.96 在 `text-budget.ts`）、变更规则（换模型/涨价不改对客价；改对客价要先问用户）、契约清单。
- 新增契约 smoke `scripts/credits-cost-consistency-contract-smoke.ts`（`pnpm.cmd platform:credits-cost-consistency-contract-smoke`，已挂 `qa:fast`，24 条断言）：旧常量必须从代码消失、`100 ÷ 0.05 = 2000` 精确成立、换算必须是单次乘法、**逐点比对 20 万个成本值**（差异只允许出现在「成本 × 2000 正好是整数」的边界且不超过 1 积分）、真实样例 `¥0.029529 → 60 积分`、`3000/4500 tokens → ¥0.036 → 72 积分`、口径文档段落齐全。
- `scripts/marketplace-cost-smoke.ts` 的断言从区间（72–74）收紧为精确值 `credits === 72`。

#### 一个必须说清楚的精度事实（不是「数字被改了」）

方案 A 要求「不改任何数字」，但**纯表达式重写做不到逐位一致**：我实测过 300 万个成本值，旧的 `(成本 × 20) ÷ 0.01` 与任何自洽写法都有差异（对比单次乘法是 459 处、对比 `(成本×100)/0.05` 是 513 处）。差异**全部**出现在「成本 × 2000 正好是整数」的边界上（成本是 ¥0.0005 的整数倍），方向固定为**旧式多送 1 积分**（浮点噪声把 7.000000000000001 抬成 8），新式返回精确整数。

- 影响面：只影响内部 `estimatedCredits` 与账本 `metadata`（PLAT-21 之后已不再回给浏览器）；**对客扣费永远等于 SKU 的 `ppu`，一分未变**（真实端到端复核：深度复盘 `consumedCredits=60`，与历史账本一致）。
- 契约把这条事实钉住了：断言「差异 ≤1 且只落在整数边界」+「边界方向固定为旧式多送 1 分」，任何人改回旧式都会红灯。

#### 验证

- 契约：`platform:credits-cost-consistency-contract-smoke` **PASS 24/0**（对旧代码必然红灯：`git show HEAD:apps/api/src/services/marketplace-cost.ts` 里有 4 处旧常量，契约本条断言会直接失败）。
- `pnpm.cmd marketplace:cost-smoke` PASS（`credits=72`）、`pnpm.cmd qa:fast` **exit=0**。
- 真实端到端：`VIDREV_SMOKE_ONLY=deep pnpm.cmd marketplace:vidrev-run-smoke` → **PASS**（`consumedCredits=60`、`costFieldsAbsent=true`、`ledgerModelCostCny=0.032415`）——PLAT-21 的响应口径没被带回，扣费与历史一致。
- 生产核查（部署产物，不只是源码）：`apps/api/dist/.../marketplace-cost.js` 含新常量 2 处、旧常量仅存在于注释；`journalctl -p err` 近 6 分钟 `No entries`。

#### 部署记录与一次并发发布事故（重要，留给以后）

| 环境 | 发布 id | 包 / sha256 | 结果 |
| --- | --- | --- | --- |
| 测试 | `20260912-plat23-credits-consistency-test1` | `release-20260912-plat23-credits-consistency-full.tar.gz` · `684fe4f6…` | `DEPLOY_OK` + `VERIFY_OK` |
| 生产 | `20260912-plat23-credits-consistency-prod1` | 同上 | `DEPLOY_OK`（`health=200 after 45s`）+ `VERIFY_OK` |
| **生产（当前线上）** | `20260912-plat23b-merged-prod1` | `release-20260912-plat23b-merged-full.tar.gz` · `2b6c6501…`（**9367676 B**，1465 文件） | `DEPLOY_OK` + `VERIFY_OK` + 匿名探针 **PASS** + `deployed-marketplace-browser-check` **PASS** + `platform:route-browser-e2e` **PASS 24/24** |
| **测试（当前）** | `20260912-plat23b-merged-test2` | 同上 | `DEPLOY_OK`（`health=200 after 27s`）+ `ready=200`；核查新常量 2 处 + lq24 标记 4 处 |

**事故**：我这次生产发布（`plat23-credits-consistency-prod1`）完成后，**另一个并行任务**正在发 `20260912-lq24-needs-regen-prod1`（兰琪朋友圈重新生成）。它的包来自**不含我本次修改**的树，覆盖后我核查到：`MARKETPLACE_CREDITS_PER_COST_CNY` 在生产 src/dist 都变成 **0 处**（被回退），而同轮的 PLAT-21/22/24 仍在（它们与对方包内容一致，未被覆盖）。

**处置**：把两个包逐文件比对（`tar -xzf` 到两个临时目录 + 逐个 sha256）得到差异全集只有 10 个文件，其中运行时代码 3 个（我的 `marketplace-cost.ts` vs 他们的 `LanqiMomentsPage.tsx` / `LanqiMomentsWechatGroupPage.tsx`）。随后从**当前合并后的工作区**重新打包（`plat23b-merged`），确认包内**同时**含「我的新常量」和「他们的 lq24 标记」，再发生产；核查结果：新常量 src 2 处 / dist 2 处、lq24 标记 4 处、PLAT-21/22 成本字段仍 0 处、PLAT-24 闸门仍在。

**同一个坑在测试实例又踩了一次**：`plat23b-merged-test1` 发完后，第三个并行任务的 `20260912-lq25-invite-keep-test1` 也发到 `/opt/baolu-os-v2-test`，把我这次的新常量又覆盖回 0 处（`lq24/lq25` 的页面改动则在）。已用同一个合并包补发 `20260912-plat23b-merged-test2` 恢复，核查新常量 2 处、lq24 标记 4 处、`health=200`。**结论：并行任务期间，测试实例的状态也可能随时被别人的包改写，验收前必须先跑一遍标记核查。**

**给以后的经验（写死在这里）**：同一 workspace 有多个任务并行时，`deploy-release.sh` 是**叠加覆盖**，谁最后发谁说了算。发布前后都应做一次「标记核查」（本文列的几条 `grep`），发现被覆盖就**用当前合并后的工作区重新打包**再发，不要用旧包互相覆盖。

#### 交接

- 回滚：`/opt/baolu-backups/20260912-plat23b-merged-prod1-before-baolu-os-v2/`（或 `...-test1-before-baolu-os-v2-test/`）+ `systemctl restart`。
- 待办（仍是 PLAT-23 后续批次，都要用户点头）：① 三条线倍数区间与两条地板是否写入正式价目；② 是否对齐 `livescript` 200→60、图片 100→20（动钱）。

## PLAT-25 视频复盘页的标题体系与 meiye 欢迎语顺序（WorkBuddy QA 剩余 P2）

状态：**A（meiye 欢迎语顺序）已完成并上生产；B（标题体系）已完成 + 已回归 + 已上线（2026-09-13，发布 20260913-zd5-storefront-ux，测试+生产 DEPLOY_OK + VERIFY_OK）**。缺陷登记 docs/BUG_REGRESSIONS.md **QA-20260913-007**。

### 本批（A，已完成）做了什么

- 用户 2026-09-12 明确：「PLAT-25 先做 A 美业欢迎语顺序（先做，它影响用户第一屏）」。
- 改动：`apps/api/src/data/marketplace-v3.json` 的 `industries.meiye.ov.vidrev.welcome` 重写——保留「同城播放占比 → 到店咨询 / 团单点击」的行业洞察，删掉与进度条第 1 步冲突的「**第 1 轮**：这条视频挂了 POI / 团购吗？」提问，改为说明「先选复盘模式（快速诊断 / 深度复盘），再依次给平台、统计周期和数据」，并把 POI / 团购与目标动作明确挪到「数据 / 描述」那一步。
- 验收：首屏第一条 AI 消息不再抢先问不在进度条里的问题；进度条第 1 步仍是「复盘模式」；POI / 团购信息没有丢（在数据步与 `ov.need` 里保留）。

### 归属

- 产品：公共平台（客户侧文案与标题）。
- 层级：① 浏览器 `<title>` 与页面标题＝前端；② meiye 欢迎语＝数据文案（`apps/api/src/data/marketplace-v3.json`）。
- 风险：低（不改接口结构、不改计费）。

### 现状取证（2026-09-12，生产只读探针）

- `document.title` 在货架、详情、对话页**都是**「思潼AI 行业智能体平台」，多标签时无法区分，分享出去也没有识别度。
- 对话页页面标题冗余：`视频复盘 · 视频复盘智能体`、`视频复盘 · 美业视频复盘智能体`（`flow.name · runSku.name` 两段重复）。
- meiye 欢迎语与进度条顺序冲突：`marketplace-v3.json` 的 `industries.meiye.ov.vidrev.welcome` 让用户先答「**第 1 轮**：这条视频挂了 POI / 团购吗？」，而进度条第 1 步是「复盘模式（快速诊断 / 深度复盘）」——用户会先被问一个不在进度条里的问题。

### 待用户选（本批只做一件）

- **A（建议先做）**：meiye 欢迎语顺序——把「第 1 轮 POI/团购」改成第 2 步之后的提问，与进度条对齐。理由：它直接决定用户第一屏要不要困惑，且改动只在数据文案。
- **B**：标题体系——浏览器 `<title>` 带上智能体名（如「视频复盘智能体 · 创始人IP专区」），并去掉页面标题里的重复段。

### 验收条件（选定后执行）

1. 正常路径：meiye 首屏第一个问题与进度条第 1 步一致；或（选 B）四个关键页面 `<title>` 各不相同且含智能体名。
2. 不应发生：改文案把「第 1 轮」的行业口径（POI/团购）整体删掉——那是美业的核心判断问题，只能挪位置。
3. 可观测：真实浏览器复验（1440 + 390），控制台无新增错误。

### 交接

### B（标题体系）实施记录（总调度5，2026-09-13）

- 改动（纯前端 `apps/web/src/pages/MarketplaceApp.tsx` + 回归脚本）：
  1. `MarketplaceAgentChatPage` 新增 `document.title` effect：浏览器 `<title>` = `智能体名 · 专区名`（ipzone→「视频复盘智能体 · 创始人IP专区」、meiye→「美业视频复盘智能体 · 美业专区」），不再所有页面共用「思潼AI 行业智能体平台」。
  2. 页内标题由 `flow.name · runSku.name`（「视频复盘 · 视频复盘智能体」重复段）改为 `runSku?.name + industry?.title`（智能体名 · 专区名）。
- 回归：
  - 新增离线契约 `scripts/vidrev-chat-title-contract-smoke.mjs`（6 断言：标题表达式/锚点注释/不再有重复拼法/页内标题结构/meiye 欢迎语守护 A 的顺序与 POI/团购不丢），注册 `marketplace:vidrev-chat-title-contract-smoke` 并挂进 `qa:fast`。
  - 浏览器 E2E `scripts/marketplace-vidrev-browser-e2e.mjs` 新增 `checkChatTitles`（带登录态、零模型）：本地实测两 SKU 标题正确且互为不同、控制台 0 错误。
  - 匿名探针 `vidrev-chat-anonymous-probe` 本地 4 视口 PASS（P1 登录闸门无回归）。
  - `pnpm qa:fast`：exit 0（含新契约断言与全仓 typecheck）。
- 状态：代码与回归完成，并已随 20260913-zd5-storefront-ux 上线测试+生产（2026-09-13）。git 提交仍待统一收口。

- 前置：已按用户选择先做 A（已完成并上生产）；B（标题体系）已由总调度5 完成，待发布决策。
- 最后更新日期：2026-09-13（PLAT-25B 由总调度5 完成，未提交未发布）

## PLAT-26 市场合伙人的分润口径与结算（先定口径，再动钱）

### 命名约定（用户 2026-09-12 指令）

- **对外与文档一律叫「市场合伙人」**，不再用「分销商」这种说法（客户界面已有契约兜底：`platform:route-contract-smoke` 会扫 `apps/web/src`，出现「分销商」直接红）。
- 代码里的历史表名 `Distributor` / `DistroCommissionLog` / `CommissionRule` **不改名**（避免一次大迁移）；它们只是内部实现名，任何面向用户或文档的新文案都不得回落到「分销商」。

状态：**待用户确认口径**（本卡是设计草案，未写任何代码、未改任何比例、未发任何分润）。

**❄️ 2026-09-15 追加：本卡冻结。** 用户原话：「市场合伙人分成任务先冻结，等我启动再说，先不找市场合伙人」。冻结期间：`PARTNER_SHARE_PERCENT` 保持全 `null`（`splitPartnerShare` 返回 `null`，不臆造分润）、不发任何分润、不联系任何合伙人、不做结算任务与只读后台；只保留已就位的结构（同一张表按能力配置、单位＝对客营收百分比）。**恢复条件：用户明确说「启动市场合伙人分成」并给出各能力比例**。另注：按统一倍数表（文字 100× / 图片 5× / 视频 2× / 语音 10× / 视觉 100×）毛利分别是 99% / 80% / 50% / 90% / 99%，恢复时视频线比例要单独算（给 30% 会跌破本卡「保留毛利 ≥40%」地板）。

- 用户 2026-09-12 提出：「文字 图片 视频 都分别定价，要如何给市场合伙人分润？比如我想给他们分充值金额的 20-50%，如果我的毛利不够 50% 支撑不住。分润也可以根据文字 图片 视频 分别分润吗？」
- 答案：**可以按线分别分润，而且应该分开**；20–50% 在文字/图片线撑得住，**视频线必须单独压低**（建议封顶 30%）。

### 归属

- 产品：公共平台（渠道分润 / 财务结算）。
- 层级：**动钱**（把平台收入的一部分分出去）→ 必须先定口径、再单独一批实现，上线前要有试算与对账。
- 风险：高（算错 = 真金白银付错；涉及退款、赠送积分、税务与合规）。
- 是否允许并行：否（与货架计费、账本、充值订单同源）。

### 一、真实毛利决定「最多能给多少」

充值档位的实际「积分/元」（含多送，决定客户每花 ¥1 能买多少积分，也决定我们的成本）：

| 档位 | 实付 | 到手积分 | 积分/元 |
| --- | --- | --- | --- |
| pack_50 | ¥50 | 1000 | 20.0 |
| pack_100 | ¥100 | 2200 | 22.0 |
| pack_300 | ¥300 | 7000 | 23.33 |
| pack_500 | ¥500 | 12000 | 24.0 |
| pack_1000 | ¥1000 | 25000 | 25.0 |

按**最坏档位 25 积分/元**（赠送最多）折算，客户每付 ¥1 我们付出的算力成本：

| 线 | 对客价 | 单位成本（实测/估） | 每 ¥1 收入的成本 | 毛利率 |
| --- | --- | --- | --- | --- |
| 文字·轻（moments 20 积分/次） | ¥1 | ~¥0.01 | ¥0.0125 | **98.8%** |
| 文字·中（vidrev 60 积分/次） | ¥3 | ¥0.0295–0.0324（实测） | ¥0.0125 | **98.8%** |
| 文字·重（ip-pos 200 积分/次） | ¥10 | ~¥0.10–0.25（估） | ~¥0.019 | ~98.1% |
| 图片（**20 积分/张**，2026-09-12 起 ¥1/张） | ¥1/张 | ¥0.20/张 | ¥0.25 | **75%** |
| 视频（30 积分/秒） | ¥1.5/秒 | ¥0.30/秒（实测 2 条 3 秒 ¥1.80） | ¥0.25 | **75%** |

按 20 积分/元（pack_50）算，视频线毛利率是 80%；按 25 积分/元算只有 75%。**差别全在赠送比例上**。

### 二、建议的分线分润档（给用户拍板的默认值）

| 线 | 建议分润区间 | 给到上限后平台剩余毛利 | 依据 |
| --- | --- | --- | --- |
| 文字（轻/中/重统一） | **20% → 50%** 阶梯 | 48.8%（50% 时） | 毛利率 ~98%，50% 很安全 |
| 图片 | **20% → 30%** 阶梯 | 45%（30% 时） | 对客价改到 ¥1/张（20 积分）后毛利率降到 ~75–80%，与视频线同一量级，所以分润上限同步下调到 30% |
| 视频 | **15% → 30%** 阶梯（**封顶 30%**） | 45%（30% 时） | 毛利率 75–80%，给 50% 只剩 25%，扣通道费/重做/税就太薄 |
| 全平台地板 | 任何单笔分润后平台保留毛利 **≥40%** | — | 视频线是唯一边界，用这条兜底 |

**还没算进去、但必须先扣掉的三项**（否则 50% 会在视频线变成亏损）：

1. 支付通道费（微信商户费率按实际签约，估 0.6% 量级）。
2. **失败重做成本**：视频一次重做 = 再花一遍生成成本（现在免费重做 1 次是产品承诺）。建议按 5% 预留在分润前扣除。
3. 税费（按经营主体口径，由财务确认）。

### 三、分润基数：三个必须定死的规则

1. **基数 = 已消耗的「付费桶」积分折算金额**，不是充值面额。
   - 理由：客户充值后可能不用；赠送积分（bonus）与体验额度（PLAT-10 trial grant）不产生收入。
   - 系统已经具备：钱包是双桶，扣费时 `consumeWalletCredits` 已返回 `spent.paid` / `spent.bonus`，货架账本 `MarketplaceLedgerEntry` 记录了 SKU、积分、类型与 metadata。
   - 折算单价要**按订单加权**（`¥/paid 积分`）：pack_1000 是 ¥0.04/积分、pack_50 是 ¥0.05/积分，差 25%。直接一律按 ¥0.05 算会让平台在重度客户上多付 25%。
2. **结算时点 = 消耗后月结 + 冻结期**（建议 7–15 天，覆盖退款与免费重做窗口）。若为了激励要充值时先给，建议只给基础档（如 15%），消耗后再补到目标档。
3. **不计分润的情形**：本次生成失败/未扣分、免费重做、体验额度消耗、赠送积分消耗、退款订单。分润只挂在「成功交付且扣费成功」的账本记录上。

### 四、技术现状（好消息：底座一半已有）

- **已有且活着**：按 `BillingOrder.channelId` 触发的渠道分润引擎 `ensureChannelCommission()`（`apps/api/src/services/billing-effects.ts`），会写 `DistroCommissionLog` 并累计到 `Distributor`；规则表 `CommissionRule` 支持 `level` / `productTag` / `minAmount` / `maxAmount` / `unfreezeDays`，正好能承载「按线差异化 + 阶梯 + 冻结期」。
- **已有数据模型、但没有接到货架**：`Distributor`（含父子层级）、`DistroCustomer`、`DistroOrder`、`ShareLink`、`OfflineEvent`。目前没有任何货架/积分消耗把分润接上。
- **缺的三块**：
  1. **渠道归因**：客户是哪个合伙人带来的——注册/充值链路目前没有把 `ShareLink`/邀请码绑定到租户或充值订单（`BillingOrder` 有 `channelId`，货架充值订单没有）。这是最关键的缺口。
  2. **结算任务**：按线比例 + 加权单价 + 冻结期，生成分润流水（要幂等、可对账、可冲正）。
  3. **只读后台**：给销售/合伙人看自己的客户、消耗、分润、可提现余额。

### 五、验收条件（定口径后才开工）

1. 正常路径：一笔「文字/图片/视频」成功扣费，能按该线比例算出分润并写入流水；同一笔重复结算不重复计（幂等）。
2. 失败路径：失败/重做/退款/赠送积分消耗不产生分润；退款后已冻结分润可冲正。
3. 不应发生：① 分润后平台毛利跌破地板（40%）；② 把赠送积分当收入分出去；③ 用 ¥0.05 一律折算而不看订单实际单价；④ 跨租户/跨合伙人错算。
4. 可观测结果事件：月度分润对账表（客户、SKU 线、消耗 paid 积分、加权单价、比例、金额、冻结/解冻状态）能与账本逐笔对上。

### 六、待用户确认（决定后才能开工）

1. 是否采用「**按线分润**」：文字 20→50%、图片 20→40%、视频 15→30%（封顶），全平台地板 40%？
2. 分润基数用「已消耗付费积分」还是「充值面额」？（前者更安全，后者更简单但视频线有亏损风险）
3. 合伙人带来的客户怎么归因：用专属邀请码/分享链接（需要打通），还是你手工在后台登记？
4. 结算节奏：月结 + 冻结期 7 天？提现走什么通道（线下打款 / 平台余额）？
5. 通道费与实际税率的口径由谁给（财务），是否在分润前扣除？

### 交接

- 本批不做：不写分润代码、不改任何比例、不发任何分润。
- 前置：用户对上面 5 个问题给出口径；随后按「一批一件事」拆成：① 归因打通；② 结算任务；③ 只读后台。
- 最后更新日期：2026-09-12

## PLAT-27 图片对客价改成 ¥1/张（20 积分）

状态：**用户 2026-09-12 直接指令 → 已改 + 已上生产**。

- 用户原话：「图片改成对客价一元一张」。

### 归属

- 产品：公共平台（美业小红书三图包 + 兰琪图片，两条图片线统一）。
- 层级：**动钱**（用户直接指令，已授权）。
- 风险：中——价格下调会立刻影响毛利与分润空间。

### 改动

- `apps/api/src/config/env.ts`：`BEAUTY_MEDIA_IMAGE_CREDITS` 与 `LANQI_MEDIA_IMAGE_CREDITS` 默认值 **100 → 20**（= ¥1/张，1 元 = 20 积分）。生产与测试 env 都没有覆盖这两个变量（只读核查过），因此改默认值即生效。
- `.env.example` 同步为 20。
- 本地验收档：`scripts/acceptance/beauty-industry/start.ps1` 的合同断言由「300 积分三图」改为 **「60 积分三图」**；用户本机审批文件 `F:\思潼AI增长os\test-environments\beauty-industry-acceptance-20260821\.env.media-approval` 里的 `BEAUTY_MEDIA_IMAGE_CREDITS` 也已从 100 改为 20（备份 `.bak-20260912-imgprice`）。
- 真实出片验收脚本 `scripts/beauty-industry-xhs-image-live-acceptance.mjs` 里 6 处 300 积分的期望值改为 **60**。

### 毛利与分润影响（写清楚，避免下次拍脑袋）

- 单张成本 ¥0.2（`wan2.7-image`）→ 对客 ¥1/张 → **毛利率 ~80%**（按 pack_50 的 20 积分/元）；按 pack_1000 的 25 积分/元折算为 **~75%**，与视频线同一量级。
- 结论：图片线的分润上限同步从「20%→40%」下调为 **「20%→30%」**（PLAT-26 表已改），否则会跌破「分润后平台保留毛利 ≥40%」这条地板。

### 验收条件与验证

1. 报价与扣费一致：3 图包报价 = **60 积分**，扣费 = 60 积分（此前 300）。
2. 不应发生：① 代码里还残留 100 的默认值；② 验收脚本仍期望 300；③ 客户端看到的价格与扣费不一致（展示与扣费都读同一个 `creditCost`）。
3. 证据：`pnpm.cmd qa:fast` 全绿；`pnpm.cmd beauty-industry:brand-package-p1-smoke` / `beauty-industry:real-media-smoke` 通过；部署后按 `BEAUTY_MEDIA_IMAGE_CREDITS` 的生效值核一次报价（详见部署记录）。

### 回滚

- 把两个默认值改回 100（以及验收脚本/审批文件）重发包；或给生产 env 显式加 `BEAUTY_MEDIA_IMAGE_CREDITS=100` 并重启（env 优先于代码默认值，最快）。

### 最后更新日期

2026-09-12

### 部署记录（2026-09-12）

- 发布包 `release-20260912-plat27b-img1yuan-full.tar.gz`（**9389447 B**，sha256 `978705c8f7a9ffb1a4f3354aa1398fb2925abbfd3c8a96287fc9a3295854bca4`，1467 文件）。生产 `20260912-plat27b-img1yuan-prod1`、测试 `20260912-plat27b-img1yuan-test1` 均 `DEPLOY_OK`；生产 `VERIFY_OK`、`deployed-marketplace-browser-check` **PASS**、匿名探针 **PASS**；部署产物核查：`BEAUTY_MEDIA_IMAGE_CREDITS` 与 `LANQI_MEDIA_IMAGE_CREDITS` 默认值都是 **20**。
- 中途第一次发布（`20260912-plat27-…-prod2`）在**改任何文件之前**被部署脚本的硬校验拦下：我改了 `marketplace-v3.json`（美业欢迎语），而 `deploy-release.sh` / `verify-deploy.sh` / `deploy-prod1.sh` 里硬编码了它的旧 sha256。已把三处常量同步为新哈希 `8a1f7bb7…`（本地 + 服务器 `/tmp` 副本），再发即通过。
- **磁盘事故**：测试实例第二次发布时 `/` 100% 满（`cp: No space left on device`，退出码 141）。根因是 `/opt/baolu-stage` 累积了 **30 个历史发布暂存目录 / 12G**（每次发布一个、从不清理）。清理后可用空间 **0 → 11G（64% 已用）**；`/opt/baolu-backups`（5.2G，回滚依据）**未动**，两个服务 `active`、health 均 200，测试实例重新发布成功。**建议（未做）**：给 `deploy-release.sh` 增加「发布成功后删除自己的 stage 目录」，否则这个坑会周期性复发。

## PLAT-28 思潼AI 推荐有礼（三批；第①批：关闭人工发放入口 + 推荐归因 + 配置位后台可读写）

状态：**第①批已完成 + 已上测试实例与生产**；**第②批（双向各 100 积分）2026-09-15 内测通过 · 未上线**（等用户通知启动，详见下方「第②批收口」）；第③批（推荐明细后台）未开工。

### 归属

- 产品：公共平台（推荐关系、积分钱包、后台配置位都是跨产品的公共能力）。
- 层级：平台 + 计费侧（第①批不动钱，只关入口、落归因、开配置）。
- 批次边界（用户要求「一批一件事」）：
  - **第①批（本卡）**：人工发放入口默认停用；推荐归因落唯一约束；10 个开关后台可读写。**本批不实际发奖**。
  - 第②批：按配置发三段奖励（新客 100 / 推荐人首次真实使用 100 / 推荐人首次真实充值 200）、unionid 去重、90 天、text-only 硬限制、月无上限+超阈值告警、退款冲正。
  - 第③批：推荐明细后台（推荐人视角：带来多少人、何时绑定、谁完成首次使用/首充、拿了多少、多少已过期；平台视角：活动期内共发出多少积分、折算文字类算力成本多少）。

### 冻结口径（用户 2026-09-12 拍板，不要变更）

1. 三段奖励：新客 100；推荐人第一段 100（该新客完成首次真实使用）；推荐人第二段 200（该新客首次真实充值）。
2. **所有推荐奖励积分只能用于文字类智能体**（服务端硬限制，前端隐藏不算）；真实充值积分文字/图片/视频通用。
3. 奖励进 **bonus 桶**：不可提现、不计市场合伙人分润、不能再产生推荐资格。
4. 有效期：**推荐奖励 90 天**；普通体验额度/其他赠送仍 30 天。
5. **不设单人月上限**，改为超阈值（默认 2 万积分）**只告警不拦截**。
6. 三个事件（绑定、首次真实使用、首次真实充值）**都必须落在活动窗内**，左闭右开。
7. 充值必须真实 `paid` 且未退款；退款做冲正。
8. 风控：同一微信（unionid）只能被推荐一次；同设备/IP 批量注册限频。
9. 活动窗：开始 = 上线第②批的那一刻；结束 = **2026-09-30 24:00 北京时间 = 2026-10-01T00:00:00+08:00（右开）**。

### 第①批做了什么

**A. 关闭人工发放入口（配置开关控制，历史流水一条不删）**

- `apps/api/src/config/env.ts` 新增 `MARKETPLACE_TRIAL_GRANT_ENABLED`（默认 `false`）。
- `POST /market/admin/trial-grants`（`apps/api/src/routes/marketplace.ts`）在鉴权通过后先查开关：关闭时返回 **403 `trial_grant_disabled`**（明确「已停用」，不是 500），且零写入；`GET /market/admin/trial-grants` 保持只读可用。
- 后台面板 `apps/web/src/pages/MarketplaceApp.tsx`：停用时标题变「体验额度发放（已停用）」、显示停用说明、**不渲染发放表单**（避免误操作），历史发放记录区块保留。
- 运维脚本 `scripts/grant-marketplace-trial-credits.mjs`：开关关闭时打印明确原因并以**退出码 2** 结束，不写任何流水。
- 开关可后台重新放行（同面板 `/agents/admin`，写库记录操作人），不是删接口。

**B. 推荐归因（第①批只落归因，不发奖）**

- 新增 `ReferralCode`（归属到**用户**，明文只回一次、库里只存 sha256 + 预览）与 `ReferralBinding`（推荐人 + 被推荐人 + 绑定时间 + 来源 + 工作区）。
- 唯一性：`referredUserId` / `referredUnionid` / `referredOpenid` **三重唯一**；自荐（同 userId 或同 unionid/openid）与重复绑定一律拒绝归因。
- **只拒绝归因，不阻断注册**：归因在注册事务**提交后**执行，任何归因失败都只记日志/返回状态，绝不把已创建的工作区回滚；无码注册行为与上线前完全一致（`referral.state="none"`）。
- 入口：`/login?ref=<推荐码>` → `POST /auth/onboarding/create-workspace`（微信注册主链路）与 `POST /auth/beta-login`（非微信/产品入口）带上 `referralCode`；后台/运营用 `POST /market/admin/referral-codes` 下发推荐码，`GET /market/admin/referrals` 查归因清单。
- **生产实测（2026-09-12，`baolu_os_v2`）**：`User` 共 204 人，**有 unionid 0 人 / 有 openid 17 人** —— 微信网页授权当前拿不到 unionid。因此「同一微信只能被推荐一次」在 unionid 缺失时必须用 **openid 兜底**（同一公众号 appid 下 openid 就是同一微信），否则这条风控在真实数据上等于不存在。两个字段都为空时只剩 `userId` 唯一这一道，已在代码注释与接口 warning 里写明。

**C. 配置位后台可读写（10 个开关）**

- 新增 `PlatformSetting`（键值表）+ `apps/api/src/services/referral-config.ts`：env 提供默认值，后台覆盖值优先。
- 10 个开关：`REFERRAL_REWARD_ENABLED`、`REFERRAL_CAMPAIGN_STARTS_AT`、`REFERRAL_CAMPAIGN_ENDS_AT`、`REFERRAL_NEW_USER_CREDITS`、`REFERRAL_REFERRER_FIRST_USE_CREDITS`、`REFERRAL_REFERRER_FIRST_RECHARGE_CREDITS`、`REFERRAL_REWARD_VALID_DAYS`、`REFERRAL_REWARD_ALERT_THRESHOLD_CREDITS`、`REFERRAL_REWARD_TEXT_ONLY`，加上人工发放总开关 `MARKETPLACE_TRIAL_GRANT_ENABLED`。
- 接口：`GET /market/admin/referral-config`（读）、`PATCH /market/admin/referral-config`（写，管理员令牌 + operator 及以上角色）。
- 严格校验：未知键、负值/超范围、小数天数、非布尔、"裸日期"时间、活动窗倒挂、**总开关打开但窗口不完整**一律 400 且不留半截副作用。
- 冻结口径硬约束：`REFERRAL_REWARD_TEXT_ONLY` **锁死 true**（改 false 直接 400；env 校验也会拦；后台该行只读）。

### 验收条件与结果（第①批）

| # | 验收条件 | 结果 |
| --- | --- | --- |
| 1 | 停用后接口返回明确「已停用」而非 500，且零写入 | PASS（403 `trial_grant_disabled`，无钱包/无流水） |
| 2 | 历史发放流水一条不删、只读可查 | PASS（`GET /market/admin/trial-grants` 仍 200） |
| 3 | 开关是开关，不是删接口：打开后人工发放恢复可用 | PASS（PATCH 打开 → `state=created`；关掉 → 立刻 403） |
| 4 | 带码注册落唯一归因（推荐人 + 被推荐人 + 绑定时间 + 来源 + 工作区） | PASS（HTTP 全链路 + 落库核对） |
| 5 | 重复绑定被拒（同微信第二账号 / 同一被推荐人重复） | PASS（`already_bound`，无第二行） |
| 6 | 自荐被拒 | PASS（`self_referral`，不落行） |
| 7 | 无效/过期/停用/用尽推荐码只拒绝归因、注册照常 | PASS（`invalid_code` / `expired` / `exhausted`；HTTP 均 200 注册成功） |
| 8 | 无码注册不受影响 | PASS（`referral.state="none"`、无归因行） |
| 9 | 活动窗左闭右开 | PASS（开始前 1ms=false / 开始时刻=true / 结束前 1ms=true / 结束时刻=false；未配置=窗外） |
| 10 | 配置位后台可读写 + 严格校验 | PASS（10 项读写；8 类非法输入全部 400；写入记录操作人） |
| 11 | 不应发生：第①批发任何奖励 | PASS（被推荐人与推荐人 bonus/paid 余额 0、无 `referral` 相关流水） |
| 12 | 页面（桌面 1440 + 移动 390）真实可操作 | PASS（停用态无表单、10 开关渲染、真写一次落库、控制台 0 错误、无横向溢出） |

### 回归证据（先红后绿）

- 新增回归：`pnpm.cmd platform:referral-attribution-smoke`（`scripts/referral-attribution-smoke.ts`，60 条断言，覆盖停用/开关/配置读写/归因全链路/风控矩阵/活动窗/不发奖）。
- **红灯**：把同一份脚本放到 **修复前 HEAD** 的临时 git worktree 上跑（`node tsx scripts/referral-attribution-smoke.ts`）→ **16 passed / 34 failed**：人工发放返回 `200 created`（未停用）、`/market/admin/referral-config` 与 `/market/admin/referral-codes`/`/referrals` 全部 404。
- **绿灯**：同一脚本在修复后 → **60 passed / 0 failed**。
- 既有 PLAT-11 回归 `pnpm.cmd marketplace:trial-grant-admin-smoke` 已按新契约更新（先断言默认停用 → 再打开开关跑完原有的幂等/冲突/dry-run 契约）→ **PASS**。
- 运维 CLI：`node --env-file=.env scripts/grant-marketplace-trial-credits.mjs --phone … --amount 100 --grant-id …` → 打印停用原因、**EXIT=2**、零写入。
- 页面：`node --env-file=.env apps/api/node_modules/tsx/dist/cli.mjs scripts/tmp/plat28-admin-ui-check.ts` → **16 passed / 0 failed**（截图 `%TEMP%\plat28-admin-ui-*\desktop-1440.png` / `mobile-390.png`）。
- 门禁：`pnpm.cmd qa:fast` PASS；`pnpm.cmd qa:full` PASS。

### 本批刻意不做（留给后续批次或需用户拍板）

- 不发任何奖励（第②批）；不写推荐明细后台（第③批）。
- 同设备/IP 批量注册限频属于第②批风控实现（本批只做 unionid/openid/userId 唯一性）。
- **活动窗在本批尚未配置**：按冻结口径「开始 = 上线第②批那一刻」，第①批期间产生的归因记录在奖励计算时会被判为「窗外」而**不产生奖励**（这正是口径要求的，不是缺陷）。第②批上线时必须同时写入开始/结束时间，否则 `REFERRAL_REWARD_ENABLED=true` 会被 env 校验与接口校验同时拦下。

### 交接（第②批开工前必读）

- 配置读取入口：`getReferralConfig()`；活动窗判断：`isWithinReferralCampaignWindow()`（左闭右开，已锁测试）。
- 归因读入口：`listReferralBindings()`（第③批在此基础上做汇总）。
- 奖励发放必须新建独立于本批的账本来源前缀（建议 `referral_reward:<kind>:<bindingId>`），并复用 bonus 桶 + 90 天；**不得**修改本批已锁的 `trial_grant_disabled` / 唯一索引 / text-only 语义。

### 第②批开发进度（2026-09-13，开发中 · 未发布）

**规则核对表（冻结口径，按用户 2026-09-12 拍板逐条落实）**：

| # | 规则 | 实现状态 |
| --- | --- | --- |
| 1 | 三段奖励：新客 100 / 推荐人首用 100 / 推荐人首充 200 | ✅ `referral-rewards.ts#maybeGrantReferralReward`，金额读配置位 |
| 2 | 奖励只进 bonus 桶 | ✅ 账本 `bucket=bonus` |
| 3 | 只用于文字类智能体（服务端硬限制） | ✅ 结构性成立：图片/视频走租户 CreditAccount，用户钱包 bonus 只有货架文字 SKU 与 Word 导出消耗（已核对，无需额外改动） |
| 4 | 90 天有效 | ⚠️ 未实现：当前 Wallet 无到期字段与 FIFO 扣减，需要一次小迁移 + 消费时账本改造（本卡下一步） |
| 5 | 月无上限 + 超阈值只告警 | ✅ 发放后按用户当月 `referral_reward:*` 累计与 `REFERRAL_REWARD_ALERT_THRESHOLD_CREDITS` 比对，达标 `console.warn`（告警通道待接） |
| 6 | 三个事件都在活动窗内（左闭右开） | ✅ `isWithinReferralCampaignWindow(new Date(), config)` |
| 7 | 首充必须真实 paid 未退款；退款冲正 | ✅ 发放挂在 `applyPaidOrder` 成功路径后；`reverseReferralReward` 已实现幂等冲正（当前系统无退款流程，接入点待未来退款功能） |
| 8 | 同一微信只能被推荐一次 | ✅ 沿用第①批 ReferralBinding 三重唯一（unionid/openid 兜底） |
| 9 | 活动窗开始=上线第②批那一刻；结束 2026-10-01T00:00:00+08:00 右开 | ✅ 上线时必须写入 `REFERRAL_CAMPAIGN_STARTS_AT/ENDS_AT` 且 `REFERRAL_REWARD_ENABLED=true`（配置校验会拦不完整窗口） |
| 10 | 幂等 / 不阻断主流程 | ✅ 同 `referral_reward:<kind>:<bindingId>` 只发一次；所有钩子 best-effort，失败只记日志 |

**已接线钩子**：注册/开通绑定成功 → 新客 100（`auth.ts` 3 处）；货架 run 成功扣费 → 推荐人首用 100（`marketplace.ts`）；微信支付通知与 paid 订单入账成功 → 推荐人首充 200（`billing.ts` 2 处）。`apps/api typecheck` ✅。

自动回归 smoke（`scripts/referral-rewards-smoke.ts` 已完成：14 条断言 PASS，注册 `platform:referral-rewards-smoke`）；

### 第②批收口（2026-09-15，用户口径收窄为「双向各 100」；**内测通过 · 未上线**）

**用户 2026-09-15 原话**：「先只做推荐有礼，被推荐人获得 100 积分、推荐人获得 100 积分，先做好这个。什么时候启动推荐有礼等我通知，先不用上线，先内测通过就可以了。」

口径调整（相对 2026-09-12 的三段口径）：

1. **被推荐人 100 + 推荐人 100**（不变）；
2. **推荐人「首充再加 200」那一段默认关闭**：`REFERRAL_REFERRER_FIRST_RECHARGE_CREDITS` 默认 200 → **0**（env 默认 + 后台配置位说明同步；机制没删，改回 200 即恢复三段口径）；
3. 其余冻结口径不动：只进 bonus 桶、90 天有效、只能用于文字类智能体、三个事件都要在活动窗内、超阈值只告警、幂等不阻断主流程。

验证（**全部本地真实环境，未上任何环境、未改生产配置**）：

- 服务级回归 `pnpm.cmd platform:referral-rewards-smoke` → **22 passed / 0 failed**（含新口径默认值断言、首充段 0 时不发奖、改回 200 仍能发奖 + 冲正、90 天到期不可消费、窗外/停用不发）。
- **端到端内测验收**（新增 `scripts/acceptance/plat28-referral-rewards-e2e.mjs`，命令 `pnpm.cmd plat28:referral-rewards-e2e`，真实 HTTP + 真实库 + 一次真实生成）→ **16 passed / 0 failed**：推荐人开通 → `/market/me/referral-link` 生成 `?ref=` 链接 → 被推荐人带码开通（归因落库 + **100 bonus** + 90 天到期）→ 推荐人此刻仍为 0 → 被推荐人真跑 `ipzone__copy`（扣 40 分，只动 bonus）→ **推荐人 +100**、账本只有 `first_use` 一条、无 `first_recharge` → 验收数据残留 0。成本：1 次真实模型调用（约 ¥0.02）。
- 过程中确认两条真实契约（已写进脚本注释）：发奖钩子是**异步**的（`void maybeGrant…`，验收必须轮询）；前端发的是**固定格式需求单**（`buildRunPrompt` 的 5 槽位），发自由文本会被智能体追问（`needsInput`，不扣费）。
- 已有能力（第②批早期实现，本轮一并核实）：`referral-rewards.ts` 发奖/幂等/冲正/告警、`sitong-wallet.ts` 到期扣减、`auth.ts`×3 + `marketplace.ts` + `billing.ts`×2 的钩子接线。

**状态**：内测通过，**未上线**（生产 `REFERRAL_REWARD_ENABLED` 仍为 false、未配活动窗、未启用任何奖励）；等用户通知「启动推荐有礼」再决定启用环境与活动窗。第③批（推荐明细后台）仍未开工。

### 活动窗（用户 2026-09-16：暂定 10.1–10.7）

- **排期**：2026-10-01 00:00 起、2026-10-07 全天，**左闭右开**——`REFERRAL_CAMPAIGN_STARTS_AT=2026-10-01T00:00:00+08:00`、`REFERRAL_CAMPAIGN_ENDS_AT=2026-10-08T00:00:00+08:00`（这样 10-07 23:59 在内、10-08 00:00 起不再发奖）。若用户希望「10-08 也算」，把 end 改成 `2026-10-09T00:00:00+08:00` 即可。
- **启动/关闭命令**（新增 `scripts/enable-referral-campaign.mjs`，注册为 `pnpm.cmd plat28:referral-campaign`；**默认只预览不写**）：
  - 预览：`pnpm.cmd plat28:referral-campaign`
  - 启用：`pnpm.cmd plat28:referral-campaign --apply`（写 `REFERRAL_REWARD_ENABLED=true` + 上面的窗口 + 100/100/0 + 90 天 + 2 万告警线，写完复核 8/8）
  - 关闭/回滚：`pnpm.cmd plat28:referral-campaign --disable --apply`
  - 生效无需重启服务（发奖时每次重新读配置位）；目标库由 `DATABASE_URL` 决定（生产 public / 测试 lanqi_test）。
- **当前状态（2026-09-16）**：**仍旧关闭**（本地演练过启用→关闭，复核 8/8；生产与测试实例都没写任何推荐配置）。等用户通知「启动」再执行启用；届时按 `docs/QUALITY_WORKFLOW.md` 做启动后首日观察（新增奖励流水条数、被推荐人 bonus、有无 `referral_reward_alert`）。

### 部署记录（2026-09-12）

- 发布包（线上现行）：`release-20260912-plat28b-refcode-alnum-full.tar.gz`（**9431218 B**，sha256 `59d76e808d88869089ce5b6649dfb6efdafd7f698f42dd43642811f255e9b382`，1474 文件，服务器侧逐字一致）。第一版 `release-20260912-plat28-referral-attribution-full.tar.gz`（9428112 B，sha256 `311b44ca…`，1472 文件）先上了两侧，随后因为推荐码字符集修正（见下）又发了 `plat28b`。
- 两侧环境：测试 `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 · https://api.lcppch.top/lanqi-test/ → `DEPLOY_OK` + `VERIFY_OK`；生产 `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 · https://api.lcppch.top/os-v2/ → `DEPLOY_OK` + `VERIFY_OK`。迁移 `202609120001_referral_rewards_plat28` 两侧各应用一次（生产由 48 → 49 个 migration，第二次发布时显示 `No pending migrations to apply`）。
- 生产功能核查（`scripts/tmp/plat28-prod-verify.sh`，真实生产接口 + 生产库）→ **38 PASS / 0 FAIL**：人工发放 403 `trial_grant_disabled`、配置位 10 项全部读得到（`source=env` 默认值）、推荐码下发成功、**带码注册 → 归因落库（推荐人 / 被推荐人 / 绑定时间 / 工作区 / 来源）**、无码注册 `none`、无效码 `invalid_code` 且注册照常成功、三重唯一索引在生产库存在、**零奖励流水与零余额**、运维 CLI 退出码 2；脚本按 id 精确清理合成验收数据后逐表核对**残留全为 0**（租户/用户/会员/门店/钱包/流水/归因）。
- 生产页面（真实 Chrome，只读）：`scripts/tmp/plat28-login-ref-probe.mjs` → **12 passed / 0 failed**：`/login?ref=<码>` 桌面 1440 与移动 390 都出现「已识别推荐码 ref-mx\*\*\*\*v5：注册完成后系统会自动登记推荐关系」，微信一键登录/注册入口仍在，无横向溢出、控制台 0 错误；截图 `%TEMP%\plat28-login-ref-*\desktop-1440.png` / `mobile-390.png`。线上入口 chunk 确认：`index-Dqgy24yN.js` 引用的 `MarketplaceApp-DK_T5sB6.js`（含「推荐有礼配置位」「trial_grant_disabled」）与 `LoginPage-CBzlPxL-.js`（含「已识别推荐码」）。
- 后台页（本地 dev，真实 API + 真实库）：`scripts/tmp/plat28-admin-ui-check.ts` → **16 passed / 0 failed**（停用态不渲染表单、10 开关、真写一次落库、桌面/移动截图）。
- **推荐码字符集修正**：第一版用 base64url 生成推荐码，生产实测本次验收码正好以 `_` 结尾（`ref-…zpo_`）——分享到聊天工具或手抄时结尾的下划线/连字符最容易被截断，链接就废。已改为 `ref-` + 12 位**小写字母+数字**（36¹² ≈ 62 bit 熵），并新增断言 `^ref-[a-z0-9]{12}$` 锁死；旧的 `ref-…zpo_` 码已置为 `isActive=false`，当前验收码为 `ref-mxow3bifnsv5`（`ref-****v5`）。
- **并发发布核查（用户特别提醒过）**：发布前后都做了标记核查。本次发布**顺带修复了一处被并发发布覆盖的既有改动**——生产/测试的 `apps/api/src/services/marketplace-cost.ts` 在 16:01 那轮发布后已丢失 PLAT-23 的 `MARKETPLACE_TARGET_COST_TO_REVENUE_MULTIPLE`（服务器侧 0 处）；本次包内该文件是含 PLAT-23 常量的版本，发布后两侧 `plat23=2` 处恢复。同时核查确认 PLAT-21/22/24/27 与微信支付验签修复的标记都在（`verifyWechatPaySignature=1`、`data-lanqi-moments-regen=2`、图片默认 20 积分=1）。
- 发布后运行面：`baolu-os-v2` 与 `baolu-os-v2-test` 均 `active`；`health=200` / `ready=200`；生产 `journalctl -p err` 近 6 分钟 `No entries`；磁盘剩余 6.2G（`/` 78%）。
- 回滚：`/opt/baolu-backups/20260912-plat28b-refcode-alnum-before-baolu-os-v2{,-test}/`（各含 `app-before.tar.gz` + `db-before.sql.gz`）；本次为纯新增表 + 新增路由，回滚代码即可，新增表可保留（不影响旧代码）。

### 第①批补充：真机注册被过期授权卡死 → 修复 + 合并重发（2026-09-12 晚）

用户在真机验收（18:25）撞到 **P1 阻塞**：手机微信里打开的推荐链接渲染成「完成注册」表单，`微信一键登录 / 注册` 被藏起来，提交 7 次全是 401 `invalid_onboarding_token`（详见 `docs/BUG_REGRESSIONS.md` **QA-20260912-018**）。根因是登录页只看 `store_os_onboarding_token` 有没有值、不校验 30 分钟有效期，残留死令牌把页面锁死在补资料形态。

修复：`LoginPage.tsx` 过期/损坏令牌当场清掉并把登录入口还给用户（过期提示用独立 sessionStorage 标记承载，规避 React StrictMode 双调用丢状态）；服务端 401 补中文 message。改完后本地干净实例探针 5/5、生产探针 5/5、带码链接探针 12/12。

**并发发布覆盖事故（本轮最大风险，用户特别提醒过）**：本轮 PLAT-28 先后发了 3 个包——

1. `20260912-plat28-referral-attribution`（首版，两侧 OK）；
2. `20260912-plat28b-refcode-alnum`（推荐码字符集修正，两侧 OK）；
3. **`20260912-lq30-video-budget`（另一条并行任务的包，17:45/17:51 发）覆盖了第 2 包**：它的源码树不含 PLAT-28，导致生产/测试的 `marketplace.ts`（人工发放闸门）、`LoginPage.tsx`（推荐码提示）、`MarketplaceApp.tsx`（配置面板）被回退，`marketplace-v3.json` 也被回退成旧内容；同时它把服务器 `/tmp/deploy-release.sh` 覆盖成**旧副本**（marketplace-v3.json 的哈希常量是旧的），所以我随后用新包发布时在第 4 步被这个旧常量拦下（未改任何文件、服务未动、无需回滚）。

处置（沿用 PLAT-23 事故的既定做法）：**从当前合并后的工作区重新打包**（`release-20260912-plat28c-merged-fix-full.tar.gz`，9437321 B，sha256 `2d95769e…`，1474 文件），发布前把 `deploy-release.sh` 重传并核对 sha，再发测试 + 生产；发布后逐项核查标记，确认**我的 5 个 PLAT-28 标记 + 对方 2 个 LQ-30 标记 + PLAT-23 + 微信支付验签 + LQ-24 + marketplace-v3.json 新哈希同时在线**（不再是谁覆盖谁）。

**暴露出的流程缺口（建议，未做）**：`deploy-release.sh` 是「谁最后发谁说了算」，且脚本/常量随 `/tmp` 副本漂移。建议给发布流程加两道机器校验：① 打包脚本固定「以当前工作树为准」并拒绝比目标树更旧的包；② 部署后自动核对一组事先声明的标记（每个在途任务 1-2 个），任一缺失即报警。这属于平台工程改造，建议单独开卡，不要夹在业务批次里做。

**事故期间的数据干净度（只读核对）**：17:50–18:45 期间 `WalletLedger` 中 `trial_grant:*` 新增 **0** 条（人工发放虽短暂放开，但没有人调用），`ReferralBinding` 全程 0 行，两张推荐码未丢失（1 活跃 + 1 停用）。

#### 真机注册验收的前置事实（2026-09-12 晚实测，写给下一次）

- 生产 `User` 共 204 行，其中**有微信身份（openid）的 17 个账号全部至少有一个工作区**（兰琪美业、探洞工场、大连道圆、央联、怡美乐宝、塑料袋定制、一箱办、萋萋、数信方舟、贴膜小子、初颜秘集、保禄ip…）。
- 因此**只有「从未在思潼AI登录过的微信」才能走注册分支**并产生归因：新微信 → `prisma.user.upsert` 的 create 分支 → 一定会新建一行 `User`。反过来说，只要没有新建 `User`，就说明这次用的是老账号（会直接登录旧工作区，`ReferralBinding` 不会产生）。
- 实测（19:20 等多次）：老板用已有账号的微信点链接 → `POST /auth/wechat-login` 返回 **200**、但 `User`/`Tenant`/`ReferralBinding` **零写入**，页面直接进旧工作区。这不是 bug，是「老账号直接登录」的正常路径；`DATA_MODE=database` 已用 `/ready` 与进程环境双重确认（排除 demo 分支）。
- 下一次做真机验收前，先让用户确认两点：① 这个微信**没在思潼AI登录过**；② 授权后**出现了「完成注册，开通你的工作区」这一步**（出现即代表是全新用户，归因会落库）。若直接进了工作区，就换一个微信再试。
- 可选的产品改进（未做，待用户拍板）：老账号带着推荐码登录时，页面给一句「你已有工作区，推荐关系只在被推荐人首次开通时建立」，避免每次都靠后台日志解释。

#### 用户 2026-09-12 晚的三条指令与执行结果

1. **「可以把历史微信登入都清除掉」→ 已执行（可回滚）**：清理前生产 `User` 中带微信身份的有 **17 行**（兰琪美业、探洞工场、大连道圆、央联、怡美乐宝×2、塑料袋定制、老马、小牛、一箱办×2、萋萋、数信方舟、贴膜小子、初颜秘集、保禄ip、未命名业务），全部 `wechatOpenid` / `wechatUnionid` 置空；`User` 204 行、`Tenant` 211、`Membership` 211 **均未改动**（数据与工作区都在，只是微信绑定清掉）。备份 `/opt/baolu-backups/20260912-wechat-identity-clear/`（`wechat-identity-before.csv` 17 行 + `rollback.sql` 17 条 update，一跑即恢复）。**影响**：这 17 个微信号下次扫码会被当成新用户（需要重新开通工作区）；如需只恢复其中几个，用备份里的对应 update 即可。
2. **「老账号带推荐码登录要提示」→ 已实现**：新增 `apps/web/src/lib/referral-notice.ts`（sessionStorage 一次性标记）；`LoginPage`（扫码中转 + 表单提交两条路径）与 `WeChatCallback`（微信内授权）在「已有工作区且带着推荐码」时打标；货架落地页 `MarketplaceHomePage` 显示可关闭提示「你已有工作区，本次是直接登录：推荐关系只在被推荐人首次开通工作区时建立」；登录页的推荐码说明也改成「**只有首次开通工作区的新账号**才会登记推荐关系」。
3. **第二张推荐码（避免自判自荐）**：原码 `ref-****v5` 的码主是「兰琪美业」账号，用该微信号自己扫会被判自荐；已再下发一张码 **`ref-1tckrmyfcuc5`**（码主＝保禄ip 账号 `cmrey0qxw…`）。两条链接任选，规则只有一条：**别用该链接码主本人的微信去扫**。

## PLAT-29 货架「输出参考案例」与真实交付契约对齐（用户 2026-09-12 报障）

状态：**已修 + 已回归 + 已上测试实例与生产**。

### 归属

- 产品：公共平台（货架详情页的静态参考案例，9 个通用内核 + 行业专属样例）。
- 层级：纯前端静态文案（不改提示词 / 不改扣费 / 不改路由 / 不调模型）。

### 用户报障与真实差距

用户截图报「文案智能体的输出样例不对 / 视频复盘的输出样例不对」。逐条对权威契约后确认是**交付物结构层面**的不符（详见缺陷台账 QA-20260912-019）：

| 智能体 | 旧样例（错） | 真实契约（对） |
| --- | --- | --- |
| 文案（`ipzone__copy` → `content_plan`） | 「1 条抖音口播文案 · 可直发」= 钩子/正文/结尾动作/话题标签 | **分级交付**：只要一条文案 → 标题+正文+话题（多平台适配）；要执行包 → **内容十件套**（选题策划→口播逐字稿→访谈话术→拍摄脚本→拍摄注意事项→剪辑EDL→发布标题与话题→最佳发布时间→评论区引导话术→投流建议） |
| 视频复盘（`ipzone__vidrev` → `video_data_review`） | 「单条视频复盘 · 含下一条动作」= 数据/归因/下一条动作 | **两种模式同价**：🚀 快速诊断（判定+3–5 条要点+恰好 1 条立即动作+不重复扣费说明）／📊 深度复盘（第零章数据质量审计 + 十章：数据总览→视频分层→内容结构健康度→单条深拆→完播率深层归因→互动深度分析→趋势预警→规律总结→方法论沉淀→选题建议） |

### 改动与验收

- 改动：`apps/web/src/marketplace/reference-cases.ts` 的 `copy` / `vidrev` 两条样例重写（保留脱敏中性，不出现行业词）。
- 验收条件：① 两个弹层能展示真实交付结构（十件套十栏、快速诊断/深度复盘、第零章+十章）；② 旧样例标题不再出现；③ 通用样例中性守护仍绿；④ 桌面/移动打开无控制台错误。
- 证据：新增 `scripts/tmp/plat28-sample-probe.mjs`（真实浏览器点开弹层断言线上文字）→ 修复前生产 **4 passed / 4 failed**，修复后本地 **8/8**、生产 **8/8**；`marketplace:reference-case-neutral-smoke` PASS；`qa:fast` exit 0。截图 `%TEMP%\plat28-samples-*\copy-modal.png` / `vidrev-modal.png`。

### 部署记录（2026-09-12）

- 包 `release-20260912-plat28d-sample-fix-full.tar.gz`（9467268 B，sha256 `10c631c5bf2596e272c8a1cdab4da15a5c2f9f86a64704a5baafcfd82d824e0e`，1479 文件）。生产 `20260912-plat28d-sample-fix` + 测试同包：两侧 `DEPLOY_OK` + `VERIFY_OK`。
- 该包同时**补带了并行任务已提交但生产尚未上线的 LQ-25**（`LANQI_VIRAL_SEARCH_DRIVER` 等 4 处标记，发布前核查 prod=0 → 发布后=4），以及本批 PLAT-28/28c 的全部内容；发布后标记核查：PLAT-28 三项 + 新样例两项 + LQ-25 + LQ-30 + PLAT-23 + 微信支付验签**全部在线**。（**2026-09-14 追注：LQ-25 的爆款检索能力已由 LQ-28 按用户口径整体下线，上述 LQ-25 标记不再存在**，见 `docs/BUG_REGRESSIONS.md` QA-20260914-003。）
- 回滚：`/opt/baolu-backups/20260912-plat28d-sample-fix-before-baolu-os-v2{,-test}/`。

### 第二轮（用户 2026-09-12 晚）：「输出样例就是完整的输出样例，不是概况」

用户看到第一版（结构清单 + 节选）后明确：样例要给**完整产出**。已改成完整交付物：

- **文案智能体**：新增 `apps/web/src/marketplace/content-ten-full-case.ts` —— 品牌信息 + **十栏全部展开**（选题策划 / 口播逐字稿（0–3 秒钩子分段、可照读全文）/ 访谈话术（3 组问答）/ 拍摄脚本（5 镜号表 + B-roll + 构图）/ 拍摄注意事项 / 剪辑 EDL（时间线 + 字幕+BGM+转场规范）/ 发布标题与话题 / 最佳发布时间 / 评论区引导话术 / 投流建议（三条方案 + 日历 + 待确认项））。
- **视频复盘智能体**：新增 `apps/web/src/marketplace/vidrev-full-case.ts` —— 一份**真实深度复盘报告全文**（脱敏 + 合成数据）：零、数据质量审计 → 一、数据总览 → 二、视频分层 → 三、内容结构健康度 → 四、单条深拆（TOP3 + BOTTOM3）→ 五、完播率深层归因 → 六、互动深度分析 → 七、趋势预警 → 八、规律总结 → 九、方法论沉淀 → 十、下个周期选题建议，含全部表格与数字口径。
- 验证（真实浏览器点开弹层断言线上文字）：`scripts/tmp/plat28-sample-probe.mjs` 扩到 **13 项**（两个完整样例 10/11 栏目 + 老账号提示），本地与生产均 **13 passed / 0 failed**；`marketplace:reference-case-neutral-smoke` PASS（新样例不含行业词）；`qa:fast` exit 0。
- 发布：包 `release-20260912-plat29b-full-samples-full.tar.gz`（9502545 B，sha256 `4bec73662546c257045564d8daa1f165eb8e41a6da128d2aaa0ca44eff24b1c6`，1485 文件），生产 + 测试均 `DEPLOY_OK` + `VERIFY_OK`；回滚 `/opt/baolu-backups/20260912-plat29b-full-samples-before-baolu-os-v2{,-test}/`。

## PLAT-30 发布流水线防覆盖：打包只认当前工作树 + 部署后自动标记核查（用户 2026-09-12 拍板开卡）

状态：**可开发 · 已排期**。用户 2026-09-12 明确要求「开」这张卡，并当天拍板**开工顺序：等推荐有礼第②批之后再做**（理由：它要改所有任务共用的发布脚本，必须独占串行；先让第②批发奖上线）。

### 归属

- 产品：公共平台 · 工程效能（发布流水线），不属于任何业务产品。
- 层级：公共平台。
- 风险：中——改的是**所有任务共用的发布脚本**，一旦写错会同时影响所有在途发布；且该脚本本身就是并行热点文件。
- 预计修改热点：`scripts/tmp/deploy-release.sh`（**并行热点，必须串行独占**）、`scripts/tmp/build-release-archive.ps1`、`scripts/tmp/verify-deploy.sh`、新增 `scripts/release/*`（随包携带的规范脚本与标记清单）。
- 是否允许并行：**不允许与任何编码任务并行**（见「交接」）。

### 用户结果

一条命令发布即可：**如果这个包比目标环境旧、或漏带了其他在途任务的标记，流水线自己拦住并说清「从当前工作树重新打包」**，不再靠人肉做标记核查、也不会出现「被覆盖了还报 DEPLOY_OK」。

### 背景（不是假想问题，今天一天发生了 3 次）

| 时间 | 事故 | 结果 |
| --- | --- | --- |
| 2026-09-12 早（PLAT-23 轮） | `20260912-lq24-needs-regen-prod1` 用不含 PLAT-23 的包覆盖生产 | `MARKETPLACE_TARGET_COST_TO_REVENUE_MULTIPLE` 在生产消失，合并重发才修回 |
| 2026-09-12 16:01 那轮发布后 | 同上性质：另一条包覆盖 `apps/api/src/services/marketplace-cost.ts` | 生产/测试 PLAT-23 常量归零，直到 18:43 我合并重发才恢复 |
| 2026-09-12 17:45/17:51 | `20260912-lq30-video-budget` 用不含 PLAT-28 的包覆盖生产/测试 | 人工发放闸门、推荐码提示、配置面板、货架数据被回退；它还把服务器 `/tmp/deploy-release.sh` 覆盖成**旧副本**，导致我随后用新包发布时被旧的 `marketplace-v3.json` 哈希常量在第 4 步拦下（未改文件、服务未动） |

共同根因：① `deploy-release.sh` 是**只叠加不删除**的覆盖式发布，谁最后发谁说了算，没有任何「包比目标旧」的判断；② 发布脚本/常量靠 `/tmp` 副本传递，会被并行任务互相覆盖；③ 「包是否漏带了其他在途改动」全靠人肉标记核查。

### 本次范围（三道机器门禁 + 一处脚本来源收口）

1. **包清单 `release-manifest.json`（新增，随包携带）**
   - 内容：`releaseId`、`generatedAt`、`gitHead`、`worktreeDirty`（true/false + `git status --porcelain` 摘要）、`files[]`（相对路径 + sha256）、`deleted[]`、`baseState`（打包时目标环境 `.release-state.json` 的 releaseId + 本次覆盖到的文件的 baseHash）。
   - 由 `build-release-archive.ps1` 生成，与归档一起进包。
2. **部署前「时效/一致性门禁」（`deploy-release.sh` 第 0 步之后、动任何文件之前）**
   - 校验 `manifest.releaseId` == 命令行 releaseId；缺失 manifest 直接拒发（可用 `ALLOW_MANIFESTLESS=true` 显式放行并写日志）。
   - 读取目标环境 `.release-state.json`（上次成功发布时写入：releaseId + gitHead + 记录的文件哈希）。
   - 对 manifest 里 `baseState` 覆盖到的每个文件，比对**目标当前哈希**：若既不等于 baseHash 也不等于本包 newHash → 说明目标已被别的包改过（即将被覆盖），**默认拒绝**，打印「冲突文件清单 + 上次发布 id + 建议：从当前工作树重新打包」。
   - 允许 `ALLOW_STALE_OVERLAY=true` 强制放行（该动作必须写进部署日志与备份目录，便于事后追责）。
3. **部署后「标记核查」（`deploy-release.sh` 第 9 步之后）**
   - 声明式清单 `scripts/release/deploy-markers.json`：按环境分组，每条 = `{ id, file, mustContain[], mustNotContain[] }`（`file` 支持源码文件或 dist 产物，`mustContain` 断言用户可见能力仍在）。
   - 部署成功后逐条核对；任一缺失 → 打印 `MARKER_MISSING id=... file=...` 并以非零退出（**不回滚**：业务可能仍可用，由人判断是否回滚；但绝不能再报 DEPLOY_OK）。
   - 初始标记集（种子，随卡实现时落地）：PLAT-28（`trial_grant_disabled`、referral 服务、登录过期修复）、PLAT-29（`内容十件套`、`数据质量审计`）、LQ-30（`ALIYUN_VIDEO_REPLICATION_MAX_COST_FEN`）、PLAT-23（`MARKETPLACE_TARGET_COST_TO_REVENUE_MULTIPLE`）、微信支付验签（`verifyWechatPaySignature`）。**已删项：LQ-25（`LANQI_VIRAL_SEARCH_DRIVER`）—— 2026-09-14 由 LQ-28 按用户口径下线，该标记作废，不得再作为「能力在线」依据。**
4. **脚本来源收口（消除 `/tmp` 漂移）**
   - 把 `deploy-release.sh` / `verify-deploy.sh` / 标记清单纳入仓库 `scripts/release/`（**不再放 `scripts/tmp/`**，因为 `scripts/tmp/` 被 filelist 排除、永远进不了包），部署时以**包内**脚本为准并校验 sha256；调用方不再手动 sftp 到 `/tmp`。
   - 保留向后兼容：旧调用方式仍可用，但会打印「使用 /tmp 副本，跳过脚本校验」的显式告警。
5. **发布成功后自动清理自己的 stage 目录（用户 2026-09-12 明确同意加）**
   - 现状：`/opt/baolu-stage/<release-id>` 每发一次留一份 388M，历史累积到 **5.0G**；2026-09-12 当天因此两次逼近磁盘红线（先是测试实例 `No space left on device`，当晚又到 **97%（968M 可用）**，我手动清了一次才回到 79%）。
   - 要求：`deploy-release.sh` 在 `DEPLOY_OK`（且标记核查通过）之后删除自己的 `$STAGE`；**失败路径不删**（便于排障），且删除失败只告警不改变部署结论（不能因为清理失败把一次成功发布报成失败）。
   - 验收：连续两次发布后 `/opt/baolu-stage` 不再新增历史目录；磁盘增长只来自 `/opt/baolu-backups`（回滚资产，按保留策略另行管理）。

### 本次不做

- 不做跨任务的发布互斥锁 / 自动排队（另一张卡，涉及多人协作策略，需用户拍板）。
- 不做自动合并、自动 rebase、自动重打包（保持人决定「从当前工作树重打」）。
- 不动备份与回滚策略、不动 `prisma migrate deploy` 与构建步骤本身。
- 不把发布逻辑塞进业务代码或业务测试。

### 验收条件

1. 正常路径：用当前工作树打包 → 部署测试实例 → `DEPLOY_OK` + `MARKER_OK` + 写入 `.release-state.json`；再发生产同样通过。
2. 失败路径 A（旧包）：故意构造一个**不含 PLAT-28 标记**的旧包对生产执行 → 必须在**动任何文件之前**以 `REJECT_STALE_PACKAGE` 拒绝，服务不重启、目标目录哈希不变，并打印「从当前工作树重新打包」的下一步。
3. 失败路径 B（漏标记）：构造一个 manifest 正常但缺某个声明标记的包 → 部署后 `MARKER_MISSING` 非零退出并指名 `id/file/缺失字样`。
4. 失败路径 C（强制放行）：`ALLOW_STALE_OVERLAY=true` 时必须真的放行，且日志与备份目录都能看到这次是「强制覆盖」。
5. 不应发生：① 目标被覆盖仍报 `DEPLOY_OK`；② 门禁失败时改动了目标文件；③ 校验逻辑让既有回滚路径失效；④ 脚本校验把正常发布挡死（误杀）。
6. 可观测结果事件：`.release-state.json` 每次成功发布更新；部署日志出现 `REJECT_STALE_PACKAGE` / `MARKER_MISSING` / `MARKER_OK` 三个可检索关键字。

### 基线与失败证据

- 基线脚本：`scripts/tmp/deploy-release.sh`（现行版本 sha256 `f3b92808…`，含硬编码 `marketplace-v3.json` 哈希常量——今天正是它被并行任务的旧副本覆盖）。
- 修复前失败证据（**已经在生产复现过**，可直接当红灯用）：`20260912-lq30-video-budget-prod1` 覆盖后，生产 `apps/api/src/routes/marketplace.ts` 的 `trial_grant_disabled` 由 1 → 0、`apps/web/src/marketplace/reference-cases.ts` 的 `内容十件套` 由 3 → 0，而该轮部署仍然报 `DEPLOY_OK`。
- 参考处置记录：`docs/CURRENT_DEPLOYMENT_STATUS.md` 的 `20260912-plat28c-merged-fix` / `20260912-plat28d-sample-fix` 两段，以及更早的 `20260912-plat23b-merged-prod1` 段。

### 实现记录

- 修改文件：（待实现）
- 数据/接口/配置变化：新增 `scripts/release/`（脚本 + 标记清单）、`release-manifest.json`、目标环境 `.release-state.json`；无数据库/接口变化。
- 兼容性和回滚点：不放行任何业务行为变更；回滚 = 恢复旧 `deploy-release.sh`（部署脚本本身随包，旧包即可恢复旧行为）。

### 验证（计划）

- 领域命令：`pnpm.cmd qa:fast`（结构检查必须允许新增 `scripts/release/`）、`pnpm.cmd prelaunch:check`。
- 部署演练：**先在测试实例**（`/opt/baolu-os-v2-test`）跑通 5 条验收条件，再对生产做一次正常发布 + 一次「旧包被拒」演练（演练不落地任何文件）。
- 页面/E2E：不涉及页面；用部署日志与 `.release-state.json` 作为可观测证据。
- 未运行项：（实现后填）

### 交接

- **串行约束**：`scripts/tmp/deploy-release.sh` 是所有任务共用的热点文件，本卡实现期间**不得与任何编码任务并行发布**；建议在 PLAT-28 第②批开工前先把这张卡做完（它是第②③批的安全网），或由用户指定优先级。
- 残余风险：门禁只能防「已知标记」被覆盖，防不住「新增能力没登记标记」——所以每个新任务收口时要把自己的 1–2 个标记补进 `deploy-markers.json`（这条要写进 `docs/QUALITY_WORKFLOW.md` 的发布前清单）。
- 后续任务：跨任务发布互斥/排队（未开卡）。
- 最后更新日期：2026-09-13（PLAT-25B 由总调度5 完成）

## PLAT-31 客户界面不再使用前报价 + 对话框支持拖拽上传（用户 2026-09-13 两条口径）

状态：**已完成 + 已上测试实例与生产**。

### 用户口径与改动

1. **「每次使用都要告诉扣多少积分，感受不好」→ 去掉使用前的扣积分文字，只在交付后告知消耗。**
   - 去掉（前置报价）：货架卡片价格文案（原 `N 积分/次` / `按环节计费 · 走完 N 步共 X 积分`）、详情页价格块与「用一次 · 扣 N 积分 / 开始第 1 步 · 扣 N 积分」按钮文案、分步卡片里的每步 `N 分`、按结果付费说明里的「不重复扣积分」、匿名登录引导的「每生成一次扣 N 积分」、生成确认气泡的「约扣 N 积分」、重做用尽提示的「会按次扣 N 积分」。
   - 保留（交付后 / 动作前必需）：聊天页顶部 **`本次消耗 {cost} 积分`**（交付完成后显示）、Word 导出按钮的所需积分与「本次导出需 N 积分」（用户主动发起的单独动作，不能隐藏价格）、积分不足提示、失败路径的「本次未扣积分」、充值页的真实金额与换算基准。
   - 契约：`marketplace-credits-only-contract-smoke` 由「必须出现前置报价」改成 **`forbidContains` 反向断言**（前置报价再回来就红），并保留「交付后必须显示本次消耗」。改完 24 passed / 0 failed（先红：改代码后旧断言先红了 4 条，再改契约转绿）。
2. **「要支持文件直接拖拽进浏览器的对话框里（目前不支持）」→ 已支持。**
   - 拖拽区挂在**整个对话框容器**（`.chat-page-shell`）上，支持同时拖多个文件、拖拽时有「松手即可把文件添加到对话框」的提示；同时保留 📎文件 / 🎬视频 按钮，并新增**粘贴文件**（Ctrl+V）与附件逐个移除。
   - **附件真的会进需求单**：文本类（`.txt/.md/.csv/.tsv/.json/.log/.srt`）读取内容（上限 2 万字）并在调用智能体时以 `【附件：文件名】` 拼进 `input`（接口上限 5 万字，二次截断）；用户自己那条消息里也会显示「（附件：…）」。
   - 其它类型（PDF/Word/Excel/图片/视频）**明确告知**「暂不能自动读取，请把关键内容粘贴进来或另存为 CSV/TXT」，不做「假装已解析」。

### 验收

- 生产真实浏览器（Chrome 原生拖拽协议 + 真实文件 `后台数据.csv`）→ 对话框出现 `📎 后台数据.csv（已读取）` 与「已读取「后台数据.csv」的内容」；详情页断言 `N 积分/次`、`扣 N 积分/约扣/每生成一次扣` 全部为 false。
- `marketplace:credits-only-contract-smoke` 24 passed / 0 failed；`pnpm.cmd qa:fast` exit 0；`--filter @baolu/web typecheck` exit 0。
- 发布：`release-20260913-no-preprice-dragdrop-full.tar.gz`（sha256 `21009997…`）+ `release-20260913-dragdrop-outer-full.tar.gz`（sha256 `defaac89…`，把拖拽区提到整个对话框容器的那一版），生产与测试均 `DEPLOY_OK` + `VERIFY_OK`。

### 交接

- 残余：Excel/Word/PDF/图片不做自动解析（要接解析管线是独立任务）；导出 Word 的价格仍在使用前显示（单独动作，建议保留）。
- 后续：如果要把「重做薅羊毛」一起收口，见 QA-20260913-004 的四个候选口径（待用户拍板）。
- 最后更新日期：2026-09-13

## PLAT-32 平台底座抽取：公共底座与智能体专用代码清晰分离（用户 2026-09-14 拍板）

状态：基本完成（第①②③批完成；第④批 MarketplaceApp.tsx 全部拆成 5 个独立页面组件 + sku-model + shell；auth.ts 已抽 schemas/helpers，仅剩巨型 registerAuthRoutes 约 1250 行未拆，建议单列后续任务）。

### 用户结果

思潼AI 公共平台与每个智能体各占一个清晰代码区；公共底座稳定、少动、向后兼容，智能体可各自独立并行开发、互不影响。

### 归属

- 产品：公共平台（`platform`）
- 层级：架构/结构整理，不改业务行为
- 风险：中（涉及生产代码拆分，必须逐批回归）

### 现状盘点（2026-09-14 实测）

- 已分离·公共底座：`apps/api/src/routes/{auth,tenant,billing,credits,marketplace,exports,health,files,conversations,agents,mcp,knowledge-base,account,admin,agent-admin,catalog,billing-consume,billing-access-tokens,continuous-improvement,feedback,offline-events,proactive,reports,workbench,automation,desktop,media,audio-cards,wechat-kf,wechat-messages}.ts` + `packages/{db,shared,agent,skills,dashboard}` + 平台页 `apps/web/src/pages/{MarketplaceApp,LoginPage,RechargePage,WeChatCallback,WeChatBridge,...}.tsx`。
- 已分离·智能体专用：`apps/api/src/products/{lanqi,beauty-industry}/`、`apps/api/src/routes/{lanqi-*.ts,beauty-industry.ts,takeaway-growth.ts,moments.ts,viral-video-replication.ts,ceo-cockpit.ts,diagnosis.ts,geo.ts,clip-lab.ts,acquire.ts}`、`apps/web/src/pages/{Lanqi*.tsx,BeautyIndustry*.tsx}`。
- 待拆·公共巨型文件（平台与产品装配混杂）：`apps/api/src/server.ts`（195 行）、`apps/web/src/main.tsx`（1009 行）、`apps/api/src/routes/auth.ts`（1659 行）、`apps/web/src/pages/MarketplaceApp.tsx`（1934 行）、`apps/api/src/routes/beauty-industry.ts`（688 行）。

### 本次范围（第①批，本轮已完成）

- 建立平台/智能体边界契约与本卡盘点。
- 确认基线 `pnpm.cmd qa:fast` 全绿（EXIT=0，7/8 workspace typecheck 全过）。
- 本轮不做代码搬迁。

### 后续批次（不自动启动，逐批回归后再移动）

1. 第②批：收口当前未提交工作树，把公共平台改动与智能体改动原子化分开提交。
2. 第③批：拆 `server.ts` / `main.tsx` 的路由装配为「平台注册 + 各产品注册」，保持行为不变。
3. 第④批：拆 `MarketplaceApp.tsx` / `auth.ts` 等公共大文件为可维护模块。

### 验收条件（总目标）

1. 公共能力只落在平台区，智能体能力只落在对应产品区，互不 import 对方业务实现。
2. 智能体只调用平台稳定接口（登录/租户/钱包/扣费/导出/会话/路由），不改平台内部。
3. 拆分前后 `qa:fast` + 领域回归全绿，行为不变。
4. 新智能体可在独立 worktree/分支并行开发，不碰平台与其它智能体代码区。

### 交接

- 基线：`qa:fast` EXIT=0（2026-09-14 总调度7 实测）。
- 残余风险：公共巨型文件拆分需逐批回归，禁止一次性搬迁；`scripts/tmp/deploy-release.sh` 仍是共享热点，PLAT-30 防覆盖卡实现前需人工串行。
- 最后更新日期：2026-09-14

## PLAT-33 公共平台语音输入（用户 2026-09-14：支持用户语音输入内容）

状态：**已完成 + 已上测试实例与生产**（`20260914-plat33-voice-input-test1` / `…-prod1` 均 `DEPLOY_OK` + `VERIFY_OK`；生产 `POST /os-v2/api/voice/transcribe` 未登录 401 `voice_login_required`、`providerCalls: 0`）。2026-09-15 对账时补正本行——此前停留在「待发布」，实际当天已发布，详见 `docs/CURRENT_DEPLOYMENT_STATUS.md` 的 `20260914-plat33-voice-input` 条目。

### 归属

- 产品：公共平台（`platform`），服务货架所有智能体的对话框。
- 层级：公共平台（前端输入组件 + 一个新的受授权后端入口）。
- 风险：中，新增一个会外发用户录音的接口，必须把准入写死。

### 用户结果

用户在公共平台任意智能体的对话框里点「🎤 语音」说一句话，再点一次结束，录音被转成中文填进输入框，检查后照常发送；麦克风没权限、没设备、被占用、没听到声音、服务未配置时都给一句中文人话，并且**不扣积分、不静默**。

### 本次范围

- 前端：公共平台对话页 `apps/web/src/marketplace/AgentChatPage.tsx` 新增「🎤 语音 / ⏹ 结束录音」按钮与状态提示；录音逻辑抽成可复用 hook `apps/web/src/components/chat/useVoiceInput.ts`；智能体工作台 `ChatComposer.tsx` 复用同一 hook 的同一入口。
- 后端：新增 `POST /voice/transcribe`（`apps/api/src/routes/voice.ts`），服务端固定用途 `web_voice_input`。四项准入：① 身份只取服务端验签会话（未登录 401 `voice_login_required`）；② 每小时次数上限 `VOICE_TRANSCRIBE_HOURLY_LIMIT`（默认 60 次/租户+用户，超限 429）；③ 体积上限 `VOICE_TRANSCRIBE_MAX_MB`（默认 10MB，超限 413）；④ 缺 Key/地址 503 `voice_transcription_not_configured`。超时 504、上游失败 502，均 `creditCost: 0` 且明说未扣积分。
- 配置：`apps/api/src/config/env.ts` 新增 `VOICE_TRANSCRIBE_MAX_MB` / `VOICE_TRANSCRIBE_HOURLY_LIMIT` / `VOICE_TRANSCRIBE_TIMEOUT_MS` 三项（都有默认值，不配也能跑）。

### 本次不做

- 不给语音输入做积分计费（`creditCost: 0`）：成本先用次数 + 体积上限控住，按次收费属于新计费口径，需要单独走计费契约与回归。
- 不放开共享入口 `/media/analyze` 的音视频闸门（见 QA-20260905-003 / BY-47）：该入口没有产品用途/租户/预算绑定，保持 fail-closed。
- 不做长音频（分钟级）转写：语音输入按「一句话」设计，长音频/视频另走对应产品入口。

### 验收条件

1. 正常路径：登录后在对话框点语音 → 说话 → 结束录音 → 中文出现在输入框；工作台同一按钮同一条链路。
2. 失败路径：未登录 401；超次数 429；超体积 413；非音频 415；缺 Key 503；上游失败 502；超时 504。全部给人话、`creditCost: 0`。
3. 不应发生：匿名或客户端自报的用途/租户字段能开启外发；语音请求扣积分；失败静默；录音内容写进日志。
4. 可观测结果事件：成功/失败都写 `voice_transcribe.terminal`（只记用途、mime、字节数、字数、脱敏 provider 观测），准入拒绝写 `voice_transcribe.admission_rejected`（`providerCalls: 0`）。

### 基线与失败证据

- 基线：`pnpm.cmd qa:fast` EXIT=0（2026-09-14 开工前实测）。
- 修复前红灯（`test-environments/plat33-voice-input-20260914/redlight-before-fix.json`）：旧实现下公共平台对话页没有语音入口；工作台的语音按钮打的 `/media/analyze` 对音视频一律 **503 `asr_authorization_required`**，新入口 `/voice/transcribe` **404**，外发 0 次、费用 0。
- 根因：语音输入当时复用了「共享上传入口」，而该入口按安全要求只接文档、拒音视频；公共平台缺乏一个绑定用途/租户/预算的语音转写入口。

### 验证

- 领域命令：`pnpm.cmd plat33:voice-transcribe-admission-smoke`（3 轮：12 次成功 / 21 次拒绝，真实外发 0、费用 0）、`pnpm.cmd plat33:voice-input-contract-smoke`（19 项契约断言）、`pnpm.cmd beauty-industry:asr-admission-smoke`（共享入口仍 fail-closed）。
- 真实链路：`scripts/acceptance/plat33-voice-transcribe-live.ts` 用真实中文录音走一遍生产同源 ASR 配置 → 200、207 字中文、1.6 秒、`creditCost: 0`（`live-asr-check-1.json`）。
- 真机浏览器（Chrome 假麦克风喂真实中文录音，只读不发送）：① 公共平台对话页 `/agent/ipzone__copy/chat` 7/7 PASS；② 智能体工作台 `/agents/acquisition` 7/7 PASS；两侧控制台 0 error，截图与 `result.json` 见 `test-environments/plat33-voice-input-20260914/`。
- 复跑方式：`PLAT33_SESSION_FILE=<含 token 的 json> PLAT33_FAKE_MIC_WAV=<16k 单声道 wav> PLAT33_SKU_PATH=/agent/<sku>/chat node scripts/acceptance/plat33-voice-input-browser-e2e.mjs`（工作台再加 `PLAT33_PRE_CLICKS`）。

### 交接

- 残余风险：真实浏览器验收只覆盖桌面 1440（移动端未跑真机录音）；iOS Safari 的 `audio/mp4` 录音已在前端做了容器与扩展名兼容，但未在真机 iPhone 上验过。
- 计费口径：语音输入当前免费但有次数上限；如果上线后用量大，再谈按次计费。
- 最后更新日期：2026-09-14

## PLAT-34 统一注册链接（用户 2026-09-15：兰琪要邀请码，其他智能体都不要）

状态：**已完成 + 已上测试实例与生产**（`verify-deploy.sh` VERIFY_OK）。

### 用户口径

「兰琪智能体要邀请码，其他智能体都不需要邀请码，通过链接直接注册就可以了；推荐归因要保留；把给用户的链接统一成一个链接。」

### 归属

- 产品：公共平台（登录 / 开通 / 推荐归因）。
- 风险：高（身份与开通闸门），因此同时锁「开对了」和「没开错」两侧。

### 实现（最小改动）

- `apps/api/src/services/invite-codes.ts`：受控产品清单显式声明 `LANQI_PRODUCT_CODE = "lanqi"`；缺省邀请码时——兰琪 403 `invite_code_required`，非兰琪产品入口放行（`source: "not_required"`，不写任何邀请码归属），平台主入口仍由 `INVITE_REQUIRED` 决定（生产/测试均为 `false` = 开放注册）。**显式带了码就按码校验**：无效 / 过期 / 用尽 / 产品不匹配仍然 403，绝不静默忽略。
- `apps/api/src/routes/auth.ts`：`beta-login` 与 `onboarding/create-workspace` 在没有 `inviteCodeId` 时跳过兑换；美业品牌归属只在邀请码带品牌时写入（无码保持默认品牌，不伪造来源）。推荐归因（`referralCode`）链路一行未改。
- `apps/web/src/pages/LoginPage.tsx`：邀请码表单与必填只在兰琪入口出现；其他产品入口直接进工作区资料表单并保留微信通道；统一链接（`/login?ref=…`）带失效旧码时清码并提示，不把新用户挡在门外。

### 对外链接（只有一个）

`https://api.lcppch.top/os-v2/login?ref=<你的推荐码>`（推荐码可省略；`ref` 只做归因，首次开通工作区才登记，已有账号不重复绑定）。兰琪仍用 `…/login/lanqi?invite=<兰琪码>` 发加盟商。

### 验收

1. 正常路径：统一链接无邀请码建号（测试实例真实 HTTP 200，`invite.source=disabled`）；美业 / 创始人 IP / 外卖入口无码开通（测试实例真实 HTTP 200 且回带 `productCode`）；兰琪带有效码开通并兑换一次。
2. 失败路径：兰琪无码 403 `invite_code_required`；任何入口带无效码 403 `invite_code_not_found`；用尽的码再用 403。
3. 不应发生：无码白拿兰琪授权；无效码被静默忽略；推荐归因因「没邀请码」丢失；已有账号被要求重新填码。
4. 页面级（生产真机只读，17/17 PASS）：统一链接只给「微信一键登录 / 注册」+ 展示推荐码、无邀请码输入框；兰琪入口保留「产品邀请码」必填；美业 / 创始人 IP / 外卖入口直接进资料表单；四个入口控制台 0 error。

### 测试

- 新增 `pnpm.cmd auth:invite-gate-smoke`（真数据库 6 项，已入 `qa:regression`）：无码注册 / 兰琪 403 / 三个非兰琪产品放行 / 无效码 403 / 有效码兑换且 `usedCount=1` / 无效推荐码不挡注册。**红灯证据**：把 `invite-codes.ts` + `auth.ts` 回退到修复前，该用例稳定失败（`beauty-industry 无邀请码必须能直接开通（实际 403 invite_code_required）`）。
- `pnpm.cmd auth:product-login-smoke`（静态契约已同步 PLAT-34 口径）、`pnpm.cmd platform:referral-attribution-smoke`（60 passed / 0 failed）、`pnpm.cmd qa:fast` 全绿。
- 页面级脚本：`scripts/acceptance/plat34-unified-login-browser-e2e.mjs`（生产 `https://api.lcppch.top/os-v2` 17/17、控制台 0 error）。

### 交接

- 发布包 `release-20260915-plat34-unified-login.tar.gz`（sha256 `f869e1e0…`），测试 `20260915-plat34-test1` / 生产 `20260915-plat34-prod1` 均 `DEPLOY_OK` + `VERIFY_OK`。
- 残余：测试实例是「兰琪本机直登」环境，登录页会被自动跳过，所以页面级验收放在生产做（只读、不注册）；测试实例改做真实 HTTP 闸门验证（含 2 个验收租户，跑完已清理）。
- 还没做（用户已点名，排在后面）：统一管理后台入口；计费模型改成「按 token 成本 × 利润率、只告知消耗、不给单个智能体标价」（需要利润率/取整/余额不足三处拍板）。
- 最后更新日期：2026-09-15

## PLAT-35 统一管理后台入口（用户 2026-09-15：侧边导航串起 5 个视图 + 客户/订单/积分干预）

状态：**已完成 + 已上测试实例与生产**（`verify-deploy.sh` VERIFY_OK）。

### 用户口径

「侧边导航把 5 个视图 + 客户 / 订单 / 积分干预串起来，复用已有 API」「后台只有我需要用，不需要给用户」。

### 归属与边界

- 产品：公共平台（运营后台）。风险：高（资金侧写操作 + 客户数据），因此**默认只读、写操作只保留原有四类**。
- 入口 `/agents/admin`（旧页面退到 `/agents/admin/legacy`）；不对普通用户开放：数据视图同时要求平台管理令牌与 owner/admin 会话。

### 实现

- 新增 `apps/web/src/marketplace/AdminConsolePage.tsx`：左侧 7 个分组——**概览 / 客户 / 订单与收款 / 积分干预 / 智能体与货架 / 推荐归因 / 质量与安全**；页头列出每个视图用到的接口；数组/对象用通用表格渲染（最多 50 行 + 提示），未知结构也不会白屏。
- 复用接口：`/market/admin/overview|skus|suppliers|ledger|trial-grants|referral-config|referral-codes|referrals`、`/admin/customers|invites|billing/audit|ops/summary|quality/summary|security/isolation-audit|agents`（不新增聚合 API）。
- 写操作：发体验额度、建邀请码、SKU 上下架/改价、生成推荐码——都是后台本来就有的动作与守卫。
- 门槛与文案：令牌缺失 → 「这个视图需要平台管理令牌」；账号非 owner/admin → 「当前账号不是 owner / admin，读不了后台数据」（不再复用「体验额度发放」页的通用文案）。
- 样式 `apps/web/src/styles/admin-console.css` 随后台懒加载；`marketplace.css` 里原本放错位置（该文件未被任何地方引用）的样式已移出。

### 验收

1. 正常路径：本地与**测试实例**真机各 18/18 —— 7 个视图逐个切换都能渲染出真实数据、页面标注「仅运营使用」、控制台 0 error。
2. 失败路径：不带令牌时 `/admin/customers` 返回 401 且页面给出「需要平台管理令牌」；非 owner/admin 会话被 403 拦下（本地实测）。
3. 不应发生：普通用户看到后台数据或入口；后台里再造一套计费/扣费逻辑；移动端横向溢出（390 实测 scrollWidth=innerWidth）。
4. 可观测：每个视图页头显示它调用的接口路径，排障不需要翻代码。

### 测试

- `scripts/acceptance/plat35-admin-console-browser-e2e.mjs`（本地 18/18、测试实例 18/18）。
- `pnpm.cmd qa:fast` 全绿（`PLAT35_QA_FAST_OK`）。

### 交接

- 发布包 `release-20260915-plat35-admin-console.tar.gz`（sha256 `69a16d42…`），测试 `20260915-plat35-test1` / 生产 `20260915-plat35-prod1` 均 `DEPLOY_OK` + `VERIFY_OK`。
- 老板入口：`https://api.lcppch.top/os-v2/agents/admin`；用平台账号登录后，在页面顶部「平台管理令牌」粘贴 `ADMIN_TOKEN`（服务器 `/etc/baolu-secrets/baolu-os-v2.env`）。
- 未做：生产页面级验收（生产要真人微信登录 + 令牌，不代老板登录）；「推荐有礼配置位」的可写编辑仍只在旧页 `/agents/admin/legacy`（要不要搬进新后台等老板说了算）。
- 最后更新日期：2026-09-15

## PLAT-36 清掉 4 条既有红灯（用户 2026-09-15：同意开卡修）

状态：**已完成**（4 条全绿；`qa:regression` 全链路首次通过）。

### 用户口径

「4 条既有红灯同意开卡修。其中 `beauty-industry:web-contract-smoke` 是断言过期（PLAT-32 把注册搬到了 `products/register.ts`），另外 3 条在视频复刻那条线上。」

### 实际结果（先复现，后动手；其中 2 条已被并行 LQ-30 线程修掉）

| 红灯 | 复现结果 | 处置 |
|---|---|---|
| `beauty-industry:video-foundation-smoke` | 当前 HEAD 已 **PASS**（LQ-30 线程修掉） | 只回归确认，不动代码 |
| `beauty-industry:video-material-authorization-smoke` | 当前 HEAD 已 **PASS**（同上） | 只回归确认，不动代码 |
| `beauty-industry:web-contract-smoke` | 仍红：断言 `server.ts` 含 `registerBeautyIndustryRoutes` | 改断言：`server.ts` 走 `registerProductRoutes` + `products/register.ts` 真注册美业路由（QA-20260915-002） |
| `beauty-industry:video-oss-staging-smoke` | 仍红：① 断言旧的 `/cleanup_failed/` 文案；② **修掉①后暴露审计泄漏上游原始错误 message**（P1） | ① 改成钉「必须抛错 + 驱动具体码 + 租约 `cleanup_failed` + sweep 可恢复」；② `rawErrorDetail()` 只留「类名 + 错误码 + 12 位消息指纹」（QA-20260915-001） |

### 验收与测试

- `REDLIGHT_ALL_OK`：上述 4 条一次性连跑全部 PASS（oss-staging 连续 3 轮，每轮 124 次注入 SDK 请求、云端 0、Provider 0、费用 0）。
- `pnpm.cmd qa:regression` 全链路通过（此前被这两条挡在中间，含 `auth:invite-gate-smoke`、`plat33:voice-transcribe-admission-smoke` 等新增门禁）。
- 泄漏红灯证据：探针 `LEAK_MARKER SYNTHETIC_RAW_RESPONSE`（审计 detail 里出现上游 message 原文）；修复后新断言要求 `messageFingerprint=<12位>` 且不得出现原始文本/URL。

### 交接

- 代码改动仅两处运行时文件：`apps/api/src/services/beauty-video-oss-staging.ts`（审计脱敏）+ 两个 smoke 断言；另有 `docs/BUG_REGRESSIONS.md` 登记。
- 残余：真实云 OSS / 真实素材仍未接入（本卡全程离线合成，`BEAUTY_VIDEO_STAGING_DRIVER` 未开启时该驱动不生效）；视频复刻线上链路此前已由 LQ-30 线程发布。
- 最后更新日期：2026-09-15

## PLAT-44 旧「专业工作地图」工作台下线 + 视频复盘只做抖音/视频号（用户 2026-09-15）

状态：**已完成**（测试实例 + 生产已发布）

### 归属

- 产品：公共平台（前端路由表 `main.tsx`、货架与智能体工作台入口、`marketplace` 预检/运行校验）。
- 层级：公共平台（历史页面下线 + 业务口径收窄），**不改**计费、定价、权限与积分口径。
- 风险：中。路由是单点热点；视频复盘收窄会改变「上传小红书表格」的用户可见结果。
- 预计修改热点：`apps/web/src/main.tsx`、`apps/web/src/pages/{AgentProductsApp,KnowledgeBasePage,ClipLabApp,PersonaClipLabApp,NotFoundPage}.tsx`、`apps/web/src/marketplace/chat-flows.ts`、`apps/web/src/components/acquisition/BeautyVideoDataReviewWorkbench.tsx`、`apps/api/src/routes/marketplace.ts`、`apps/api/src/services/video-review-engine.ts`、路由契约与浏览器验收脚本。
- 是否允许并行：否（`main.tsx` 属热点文件令牌清单，同一时刻只允许一方改）。

### 用户结果

打开旧工作台地址（`/my-ai`、`/workbench`、`/app`）不再看到历史工作台（CEO 驾驶舱 / 外卖 / 餐饮），而是直接落到智能体平台货架；视频复盘只接受抖音与视频号的数据表，其它平台明确说明「不支持」，且不解析、不消耗积分。

### 本次范围

- `/my-ai` 不再渲染 `MyAiPage`，兼容跳转到 `/agents`（仍走 `takePostLoginRedirect`，尊重「登录后要去的页面」）；`/workbench`、`/app` 一跳 `/agents`（不再经 `/my-ai` 中转）。
- 平台自有页面里指向 `/my-ai` 的入口改到正确落点：企业知识库「返回常用智能体」、工作台侧栏「常用智能体」、工作地图「切换智能体」、账户页「返回智能体」、未开通页「返回常用智能体」→ `/mine`；品牌按钮、ClipLab / PersonaClipLab 品牌 → `/agents`；`NotFoundPage` 的「去常用智能体」→ `/mine`。
- 视频复盘（服务端）：`detectVidrevPlatform` 先把 小红书 / 快手 / B站 判成「其他平台」（避免它们的字段被抖音规则误吞）；`POST /vidrev/parse-preview` 对非支持平台返回 `ok:false` + 明确说明；`POST /market/skus/:sku/run` 对非支持平台 **422 `vidrev_platform_not_supported`**（不扣费、不调模型）；解析字段别名去掉小红书口径（`笔记标题`/`观看量`）。
- 视频复盘（前端）：平台快捷选项只留「抖音 / 视频号」；欢迎语写明支持范围；美业数据复盘页的平台导出指南去掉小红书 / 快手 / B站。
- 契约与回归：修掉 `mustNotInMain` 哑断言（QA-20260915-004）；新增 `scripts/marketplace-vidrev-platform-scope-smoke.ts`（`pnpm.cmd marketplace:vidrev-platform-scope-smoke`，真实路由 + 真实库目录同步、0 Provider，已挂进 `qa:regression`）；`marketplace-vidrev-browser-e2e.mjs` 增加「平台范围」相位（真页面，不生成、不花钱）。

### 本次不做

- 不删 `MyAiPage` 组件本体：`agent:work-map-smoke`、`owned-product-directory-smoke` 与美业 BY-52 仍引用它，本次只下线路由。
- 不动兰琪 / 美业自有页面里的 `/my-ai` 入口（跨线文件，已转派总调度8）。
- 不改计费、价格、额度、权限模型，不做数据库迁移。

### 验收条件

1. 正常路径：匿名与登录态访问 `/my-ai`、`/workbench`、`/app` 都落到货架 `/agents`；抖音 / 视频号表格预检 `ok:true` 且能解析出数据行。
2. 失败路径：小红书 / B站 / 快手表格预检 `ok:false`、`platform="其他平台"`、`rowCount=0`、`fields=[]`，说明里点名「只支持抖音和视频号」；显式传 `platform="小红书"` 同样被拒。
3. 不应发生：旧地址落入「页面不存在」兜底页或历史工作台；平台自有页面里再出现指向已下线 `/my-ai` 的入口；非支持平台被解析成有数据或产生扣费。
4. 可观测结果事件：预检返回 `platform` / `rowCount` / `notes`；运行接口 422 体 `error=vidrev_platform_not_supported`，`creditCost=0`。

### 基线与失败证据

- 基线命令：`pnpm.cmd platform:route-contract-smoke`（改前 101/0）、`pnpm.cmd marketplace:vidrev-contract-smoke`。
- 修复前失败测试/Eval：契约反向断言的红灯复现记录在 `docs/BUG_REGRESSIONS.md` QA-20260915-004（旧写法 `FAIL 105 passed / 1 failed`）；同一记录还包含浏览器验收共用会话导致的假阴性。
- 现象、根因和连带影响：见 QA-20260915-004；产品侧 `/my-ai` 原先渲染历史工作台，老书签会进入已下线的历史智能体列表。

### 实现记录

- 修改文件：本卡「本次范围」列出的 18 个文件 + 新增 `scripts/marketplace-vidrev-platform-scope-smoke.ts`。
- 数据/接口/配置变化：无迁移、无 env 变更。接口行为变化仅两处：`POST /vidrev/parse-preview`（非支持平台 `ok:false`）、`POST /market/skus/:sku/run`（非支持平台 422）。
- 兼容性和回滚点：路由回滚 = 还原 `main.tsx` 的 `/my-ai`、`/workbench|/app` 两个分支与 `platform-route-contract-smoke.mjs`；视频复盘回滚 = 还原 `routes/marketplace.ts` + `services/video-review-engine.ts` + `marketplace/chat-flows.ts`。发布前备份见 `docs/CURRENT_DEPLOYMENT_STATUS.md`。

### 验证

- 领域命令：`marketplace:vidrev-contract-smoke`、`marketplace:vidrev-platform-scope-smoke`、`vidrev:excel-upload-smoke`、`platform:route-contract-smoke`（106/0）、`agent:work-map-smoke`、`@baolu/web typecheck`、`@baolu/api typecheck`。
- `pnpm.cmd qa:fast`：PASS（`QAFAST_EXIT=0`，7 包 typecheck 全绿）。
- 页面/E2E：本地真实 Chromium 6/6（企业知识库「返回常用智能体」落 `/mine`；`/app`、`/workbench`、`/my-ai` 落 `/agents`）；本地 `platform:route-browser-e2e` 26/26；`marketplace:vidrev-browser-e2e` 平台范围相位 PASS（`choices=["抖音","视频号"]`、0 console error、0 模型调用）；测试实例与生产 `platform:route-browser-e2e` 各 **26/26**；生产/测试 `POST /vidrev/parse-preview` 实测小红书 `ok:false`、视频号 `ok:true`。
- 未运行项：`marketplace:vidrev-run-smoke`（含真实模型深度复盘，本轮不改该链路，避免模型费用）。

### 交接

- 残余风险：兰琪 / 美业自有页面里的 `/my-ai` 入口仍在（点击会跳货架，功能不阻塞、语义不一致），已转派；`scripts/beauty-directory-browser-e2e.mjs` 仍断言 `/my-ai` 渲染 `.myAiPage`，美业线恢复活动前必须改。
- 后续任务：`MyAiPage` 组件本体的去留（需与引用它的 smoke 和 BY-52 文档一起处理）。
- 最后更新日期：2026-09-15

## PLAT-45 三条计费口径：IP 定位固定 400 积分/次 + A+图片对全部智能体放开并真解析 + 文案智能体积分包月（用户 2026-09-17）

状态：**已完成**（本地全绿；发布状态见本卡「交接」）

### 归属

- 产品：公共平台（货架计费口径 + 通用对话页附件链路），影响全部专区（`ipzone` / `meiye`）与全部智能体。
- 层级：公共平台，**同时动钱（计费）与动数据库结构**，是本轮最高风险项。
- 风险：高（付费错误面 + 迁移）。
- 预计修改热点：`apps/api/src/services/billing-cost-model.ts`、`apps/api/src/data/marketplace-v3.json`、`apps/api/src/routes/{marketplace,billing-consume}.ts`、`apps/api/src/services/marketplace-catalog.ts`、`apps/web/src/marketplace/AgentChatPage.tsx`、`packages/db/prisma/schema.prisma`。
- 是否允许并行：否（`marketplace.ts` / `AgentChatPage.tsx` 属热点文件）。

### 用户结果

1. **IP 定位智能体每次 400 积分**（固定价），不再随 token 用量浮动；其他智能体价格不变。
2. 在**文件 / 视频 / 语音 / 增强提示词** 4 个入口，前后端**所有智能体**都能传图片，且图片**真的被识别进需求**（不是只记文件名）。
3. 文案智能体可 **4000 积分包月**（每天 5 条），订阅期内生成**不再扣积分**；当天 5 条用满会被明确拦下且**不偷偷改回扣分**；用户仍可继续选按消耗计费。

### 本次范围

- ① IP 定位：`marketplace-v3.json` 的 `skills["ip-pos"].ppu = 400`；`billing-cost-model.ts` 新增 `FIXED_PRICE_SKUS = ["ip-pos"]` + `isFixedPriceSku()`，在 `usesCostBasedPricing()` 里**先于白名单与 `*` 通配判定**（生产 env 是 `BILLING_COST_BASED_SKUS=*`，没有这条例外就退不出成本口径）；`billing-consume.ts` 的 `SKILL_PPU["ip-pos"]` 同步 200 → 400。
- ② A+图片：`AgentChatPage.tsx` 的 `accept` 增加 `.webp/.gif/.bmp`，新增 `IMAGE_ATTACHMENT_PATTERN` 与 `parseImageAttachment()`，图片分支走平台受登录保护、带预留/结算的 `/media/analyze`（qwen-vl），把「画面里能验证的事实」拼进需求单；界面写明「10 积分/次、解析失败不扣积分」。**后端计费不改**（PLAT-41 链路已具备）。
- ③ 文案包月：`MarketplaceSku` +`subscriptionCredits`/`subscriptionDailyQuota`，`MarketplaceSubscription` +`credits`/`dailyQuota`；迁移 `202609170001_marketplace_subscription_credits`（纯加列）；`ensureMarketplaceCatalog()` 不再把包月字段写死为 `null`（这是「生产上所有 SKU 包月价都是空的」的根因）；`POST /market/subscriptions` 支持积分口径订阅（幂等、不重复扣分、余额不足 402 带 `rechargeUrl`）；`/market/skus/:skuCode/run` 先查订阅 → 覆盖时 `charge = 0` 且不调用钱包，额度用尽 **409 `marketplace_subscription_quota_exhausted`**；`accessStateFor()` 返回 `state:"subscribed"` 与 `subscriptionOffer`；网页端按订阅态显示「本次生成不扣积分，今天还剩 N 条」/「📅 改包月」，交付后顶栏显示「本次由包月覆盖 · 不扣积分」。

### 本次不做

- 不给文案之外的 SKU 上包月（`subscriptionCredits` 为空 = 不显示包月报价）。
- 不启用旧人民币口径包月（`subscriptionPriceCny` 保留字段但继续不用）。
- 不改 ASR / 视觉的单价（本轮只是把图片接进已有的收费通道）。

### 验收条件

1. 正常路径：IP 定位真实运行**只扣 400**、账本恰好一条；图片上传能拿回画面事实且只按成功视觉调用计 10 积分；文案订阅成功后生成不扣积分、顶栏写明「本次由包月覆盖」。
2. 失败路径：图片解析失败/超时明确提示「本次不扣积分」；余额不足在调用 Provider 之前 402；订阅额度用尽 409 且**不扣分**。
3. 不应发生：`BILLING_COST_BASED_SKUS=*` 把 IP 定位拉回成本口径；重复点订阅重复扣分或建出第二条订阅；别人的订阅放行我的运行；订阅覆盖的那一次仍去调用钱包。
4. 可观测结果事件：账本 `pricingMode ∈ {fixed_ppu, cost_based, subscription}`；订阅用量账本 `refType = marketplace_subscription_usage`、`refId = 订阅 id`；运行响应带 `subscription{covered,usedToday,remaining,endDate}`。

### 基线与失败证据

- 修复前红灯：`docs/BUG_REGRESSIONS.md` QA-20260917-001（逐字记录「临时把扣费改回旧算法 → 真实模型 200 后 `[FAIL] 订阅期内运行扣 0 积分（实际 40）`」）。
- 基线命令：`pnpm.cmd billing:cost-model-smoke`、`pnpm.cmd marketplace:api-smoke`、`pnpm.cmd marketplace:ip-pos-run-smoke`。
- 契约同步（本次一并改）：`marketplace:credits-only-contract-smoke` 增「包月覆盖时顶部必须写不扣积分」断言；`billing:cost-model-smoke` 的扣费表达式断言改为含订阅分支。

### 实现记录

- 迁移：`packages/db/prisma/migrations/202609170001_marketplace_subscription_credits/migration.sql`（**纯加列，可安全回滚**）。本地 `pnpm.cmd --filter @baolu/db prisma:deploy` → `52 migrations found`，已应用。
- 接口变化：新增 `POST /market/subscriptions` 的积分口径分支；`/market/skus/:sku/run` 新增 `pricingMode = "subscription"` 与 409 分支；`/market/skus/:sku/access` 增加订阅字段。**未订阅用户的响应与扣费一字未变**。
- 兼容与回滚点：回滚 = 关掉 `marketplace-v3.json` 的 `sub` 配置（包月入口即消失）+ 还原 `routes/marketplace.ts` / `marketplace-catalog.ts`；数据库多出的列对旧代码无影响。IP 定位回滚 = 从 `FIXED_PRICE_SKUS` 移除 `ip-pos` 并还原 ppu。

#### 用户现场二次反馈（2026-09-17）：`/agent/ipzone__copy` 上看不到包月（P1，已修 + 已上生产）

- 现象：用户直接打开 `https://api.lcppch.top/os-v2/agent/ipzone__copy`，页面上没有任何包月字样。**接口与数据是好的**（生产 `GET /os-v2/api/market/skus/ipzone__copy` 返回 `subscriptionCredits:4000` / `subscriptionDailyQuota:5`），缺的是入口。
- 根因：`/agent/<sku>` 命中的是**详情页** `MarketplaceAgentDetailPage`，包月入口当初只做在**对话页**（`/agent/<sku>/chat`）的「请先确认需求」确认面板里——要先答完 4–5 轮提问才看得到，等于没有入口。
- 修复：`apps/web/src/marketplace/AgentDetailPage.tsx` 价格卡内渲染 `.pc-block.sub`（价与每日条数全部读 SKU 字段、不写死），按钮走与对话页**同一个** `POST /market/subscriptions`：未登录跳登录、401/403 清会话、402 带 `next` 回跳充值、已在订阅期返回 `alreadySubscribed` 不重复扣分。
- 契约/门禁：`marketplace:credits-only-contract-smoke` 新增 6 条详情页断言（先红 28/5，后绿 **33/0**）；`scripts/deployed-marketplace-browser-check.mjs` 新增 `detail_monthly_package` 与「只按次售卖的 SKU 不得出现包月」双向断言（从接口现值比对，不写死数字）。
- 生产真机绿证：`DEPLOY_CHECK_WEB_URL=https://api.lcppch.top/os-v2 node scripts/deployed-marketplace-browser-check.mjs` → **PASS**（`detail_monthly_package=PASS no_monthly_on_ppu_only_sku=PASS console_clean=PASS`）；手机 390×844 探针：块可见、按钮 318×43、无横向溢出、console 0。
- 台账：`docs/BUG_REGRESSIONS.md` **QA-20260917-003**。

### 验证

- `pnpm.cmd qa:fast`：**PASS**（`QAFAST_EXIT=0`，含 `billing:cost-model-smoke`、`marketplace:credits-only-contract-smoke`、`typecheck` 7/7 包）。
- `pnpm.cmd qa:regression`：**PASS**（`QAREG_EXIT=0`，含新增 `marketplace:subscription-smoke`）。
- `pnpm.cmd qa:full`：**PASS**（`QAFULL_EXIT=0`，web/api 均 build + `api_runtime_data_check:PASS`）。
- `pnpm.cmd marketplace:subscription-smoke`：**PASS**（真实路由 + 真实数据库 + **一次真实模型运行**）。关键行：`[PASS] 未订阅时透出包月报价 4000 积分 · 每天 5 条`、`[PASS] 订阅扣 4000 积分`、`[PASS] 订阅后余额 5000 → 1000`、`[PASS] 重复订阅不再扣积分（余额不变）`、`[PASS] 订阅期内运行扣 0 积分（实际 0）`、`[PASS] 订阅期内运行不改余额（期望 1000，实际 1000）`、`[PASS] 额度用尽后运行返回 409`、`[PASS] 错误码是 marketplace_subscription_quota_exhausted`、`[PASS] 额度用尽被拒时余额分文不动`、`[PASS] 其他租户不会被别人的订阅放行（实际 guest）`、末行 `PASS: 包月订阅计费回归全部通过`。
- 未运行项（2026-09-17 更新）：「详情页看不到包月」这一段**已补做并上生产**（见上「用户现场二次反馈」）；剩下需要**用户本人登录**才能做的那一步：在 `/os-v2/agent/ipzone__copy` 点「📅 开通包月：4000 积分/月」→ 连生成 2 次确认不扣积分 → 当天第 6 次被 409 拦下。这一步会真实扣 4000 积分，Codex 不能代持微信登录与付款。

### 交接

- 残余风险：`subscriptionPriceCny`（人民币口径包月）仍在库表里但没有入口，长时间不用建议单列任务清理；`ip-pos` 的 400 是**用户指定的固定价**，与 9-15「按成本计价」的口径冲突由用户裁决，已在 `docs/PRICING.md` §五 记录。
- 后续任务：给其他智能体按需上包月（配置位已就绪，加 `sub` 即可）；录音卡 `/audio-cards` 仍未定价。
- 发布（详情页包月补丁）：生产 `20260917-plat48-copy-monthly-detail-prod1`（归档 `release-20260917-plat48-copy-monthly-detail.tar.gz`，sha256 `43a59529c6af5c000369b12f3d67ffbd74647a0b74f9059674f6cb4da69add6a`）；服务器侧 `DEPLOY_OK`、`health=200 (after 15s)`、`No pending migrations`。发布日志里**没有** `VERIFY_OK` 行（该次只跑了部署链），事后补跑 `verify-deploy.sh` 除 `public_web`（裸 `/os-v2` 被 nginx 302 归一成 `/os-v2/`，浏览器自动跟随，非本次引入、也非产品缺陷）外全 PASS——详见 `docs/CURRENT_DEPLOYMENT_STATUS.md`。
- 最后更新日期：2026-09-17

## PLAT-46 WorkBuddy MCP 双账本打通：钱包优先扣费 + 遗留租户账本兜底（用户 2026-09-17）

状态：**已完成**（本地全绿；发布状态见本卡「交接」）

### 归属

- 产品：公共平台（MCP / 外部接入通道的积分账本），影响 WorkBuddy 全部工具调用与所有经 MCP 接入的能力。
- 层级：公共平台。改动**触及动钱（扣费/退款）与事务边界**，风险高。
- 风险：高。
- 预计修改热点：`apps/api/src/services/credit-reservations.ts`、`apps/api/src/services/sitong-wallet.ts`。
- 是否允许并行：否。

### 用户结果

在货架充值拿到积分的用户，WorkBuddy 里的 `sitong.ask` **立刻可用**，不再报 `insufficient_credits`；迁移前只在租户账本里有余额的老客户**余额不作废**。

### 本次范围

- `reserveCreditsBeforeProvider`：`channel === "mcp"` 时改走 `reserveMcpCredits` —— 先扣用户级 `Wallet`（与货架同源），不足再回落遗留租户 `CreditAccount`，**两条路只扣其中一条**；预留 id 用 `wallet-reservation:<requestId>` 前缀。
- `release` / `settle` / `compensate` 按前缀分流：差额退回**当初扣的那个桶**（bonus 优先，与扣费顺序对称），退款 requestId 固定为 `<预留id>#release|#settle|#compensate` 保证幂等。
- `refundWalletInTx(tx, ...)`：把钱包退款逻辑从事务里抽出来，供 MCP 结算与 `AgentRun` / `Message` 落库**共用同一个事务**，消掉半成品态。

### 本次不做

- 不合并两套账本（不做数据迁移），只做「读得到、扣得对、退得准」。
- 不动发放侧、货架扣费侧与租户账本本身。
- 不修 `sitong.skills` 只返回一个 Agent 的问题（见「交接」）。

### 验收条件

1. 正常路径：钱包有余额、租户账本为 0 → MCP 预留成功且扣的是钱包；结算按实际额退回原桶，流水可逐笔核对。
2. 失败路径：两边都不足 → **在调用 Provider 之前**抛 `InsufficientCreditsError`（不产生外发与成本）；Provider 失败释放 → 全额退回且重复释放幂等。
3. 不应发生：钱包不足时误扣租户账本之外的第三处；重复释放多退；改 A 的钱包影响 B。
4. 可观测结果事件：`walletLedger` 上 `type=consume/refund`、`bucket=paid/bonus`、`refRequestId` 可对账。

### 基线与失败证据

- 生产证据（只读复核）：用户 `cmtzaheu905e5ef4mzno13ugz`（租户「杨萋萋」）`Wallet.paidBalance = 490` 而 `CreditAccount.balance = 0`，WorkBuddy `sitong.ask` 稳定 `insufficient_credits`。
- 红灯复现逐字见 `docs/BUG_REGRESSIONS.md` QA-20260917-002（注释掉 MCP 分流后：`InsufficientCreditsError: insufficient_credits at reserveTenantCredits (credit-reservations.ts:124:10)`，`exit code 1`）。
- 基线命令：`pnpm.cmd billing:wallet-db-smoke`、`pnpm.cmd billing:consume-db-smoke`、`pnpm.cmd credit:charge-smoke`。

### 实现记录

- 无迁移、无 env 变更。改动两个运行时文件 + 新增一个 smoke。
- 兼容与回滚点：回滚 = 还原 `credit-reservations.ts` 的 MCP 分流分支（旧行为 = 只读租户账本）；数据无破坏性变更。`<预留id>#release` 等幂等键在回滚后不再生成，历史记录不影响。

### 验证

- `pnpm.cmd mcp:wallet-ledger-smoke`：**PASS**（真实 PostgreSQL）。逐字：`mcp_wallet_ledger_smoke: PASS` + `{"mainWalletAfterSettle":478,"mainWalletAfterRelease":478,"fallbackTenantBalance":70,"settleLedgers":[{"type":"consume","bucket":"paid","delta":-30},{"type":"refund","bucket":"paid","delta":18}]}`。
- 红/绿对照：同一脚本在修复前 `exit code 1`（复现生产现象），修复后 `exitCode=0`。
- `pnpm.cmd qa:fast` / `qa:regression` / `qa:full`：**PASS**（`mcp:wallet-ledger-smoke` 已挂进 `qa:regression`）。
- 未运行项：WorkBuddy 客户端侧真实调用（需要在 WorkBuddy 里发一次 `sitong.ask`），留到发布后实测。

### 交接

- 残余风险：**`sitong.skills` 只返回 `ceo-cockpit-analyst` 仍未修** —— 根因是 `WorkbuddyConnection` 只有单个 `agentId`，生产 4 个 active 连接全绑 `agent_ceo_cockpit`。修法需要 `agentIds Json?` 多值 + 迁移 + `resolveWorkbuddyAccess` 多 Agent 汇总 + `sitong.skills` 输出 + `apps/web/src/pages/AgentProductsApp.tsx` 的连接管理 UI。**建议单列一张卡**。
- 后续任务：把 `sitong.skills` 多 Agent 白名单作为下一张卡；上线后请用户在 WorkBuddy 里真机发一次 `sitong.ask` 复核。
- 最后更新日期：2026-09-17

## PLAT-47 WorkBuddy 接入货架已上架 SKU：sitong.skills/ask 改走 marketplace 计费与执行（用户 2026-09-17）

状态：**已完成（本地门禁 + 测试实例 + 生产已发布）**

### 归属

- 产品：公共平台（WorkBuddy MCP 接入通道 × 货架 marketplace SKU）。
- 层级：公共平台；改动**触及接入通道、计费（ppu / 成本口径 / 包月）与执行路由**，风险高。
- 风险：高。
- 预计修改热点：`apps/api/src/routes/workbuddy-mcp.ts`、`apps/api/src/routes/workbuddy-settings.ts`、`apps/api/src/services/workbuddy-connections.ts`、`apps/api/src/routes/marketplace.ts`（抽可复用执行函数）、`packages/db/prisma/schema.prisma`（连接表）、`apps/web/src/pages/RechargePage.tsx` 及连接管理 UI。
- 是否允许并行：否。

### 用户结果

用户点「在 WorkBuddy 里接入思潼 AI」拿到的是**货架层已上架（selling）的 SKU**（IP定位 / 文案 / 视频复盘 + 美业版），而不是单一个 CEO 驾驶舱智能体。WorkBuddy 里 `sitong.skills` 能列出这些已上架 SKU，`sitong.ask` 能按 SKU 执行，计费与网页货架完全一致（按次 ppu / 成本口径 / 包月订阅）。

### 本次范围

- 连接从「单个 `agentId`」扩展为支持「货架 SKU 集合」模式：接入货架时不再绑定单一智能体，而是暴露货架 selling SKU。
- `sitong.skills`：返回 `listMarketplaceSkus({ status: "selling" })` 的 SKU（skuCode / name / capabilityKey / 价格口径），不再返回单 agent 的 `allowedSkills`。
- `sitong.ask`：接收 `skuCode`（或 `capabilityId`），路由到货架执行与计费——复用 `POST /market/skus/:skuId/run` 的核心逻辑（ppu / cost-based / subscription），结算走 `consumeWalletCredits`，余额不足 402 + `rechargeUrl`。
- 保留美业 `productCode` 分支与既有 `agentId` 分支的兼容（老连接不破坏）。

### 本次不做

- 不合并货架 SKU 与智能体 agent 两套目录；不新上架 / 下架任何 SKU。
- 不改货架 ppu / 包月价格本身；不新增订阅以外计费口径。
- 不做真实 WorkBuddy 客户端 E2E（留到发布后实测，同 PLAT-46 边界）。

### 验收条件

1. 正常路径：货架 selling SKU ≥ 3（IP定位 / 文案 / 视频复盘），`sitong.skills` 返回这些 SKU 且与 `/market/skus?status=selling` 一致；`sitong.ask(skuCode=copy)` 执行成功并按 `copy` 的 ppu（或成本口径 / 包月）从用户钱包扣费，账本 `marketplaceLedgerEntry.type=ppu_consume` 且 `skuCode=copy`，响应含 `creditCost` / `remainingCredits` / `pricingMode`。
2. 失败路径：`skuCode` 为 coming_soon / 不存在 → 409 `marketplace_sku_coming_soon` / `marketplace_sku_not_found`；钱包余额不足且无包月 → 402 `insufficient_credits` 且带 `required` + `rechargeUrl`；包月当日额度用尽 → 409 `marketplace_subscription_quota_exhausted`。
3. 不应发生：WorkBuddy 通道再出现「钱包有钱却报 `insufficient_credits`」；扣费走 `invokeSkillViaGateway` 的 agent 线而绕过货架 ppu；跨租户读取 / 执行他人 SKU 或订阅；同一次调用重复扣费。
4. 可观测：`sitong.skills` 列表与货架 selling 一致；`sitong.ask` 账本可逐笔对账，幂等键与网页货架同一口径。

### 基线与失败证据

- 现状证据（只读）：`WorkbuddyConnection.agentId` 单值（[workbuddy-connections.ts](/F:/思潼AI增长os/baolu-os-v2-source/apps/api/src/services/workbuddy-connections.ts:12)）；生产 4 个 active 连接全绑 `agent_ceo_cockpit`（PLAT-46 取证）；`sitong.skills` 只返回 `agent.allowedSkills`（[workbuddy-mcp.ts](/F:/思潼AI增长os/baolu-os-v2-source/apps/api/src/routes/workbuddy-mcp.ts:232)）；货架执行 / 计费在 `POST /market/skus/:skuId/run`（[marketplace.ts](/F:/思潼AI增长os/baolu-os-v2-source/apps/api/src/routes/marketplace.ts:349)），与 WorkBuddy 是两条线。
- 红灯（实现前补）：用测试脚本证明 `sitong.skills` 不含货架 selling SKU、`sitong.ask(skuCode=copy)` 走不到货架 ppu 计费。

### 实现记录

- `apps/api/src/routes/marketplace.ts`：把 `POST /market/skus/:skuId/run` 的执行 + 计费核心抽成导出函数 `runMarketplaceSku`（返回结构化 outcome），网页 `/run` 改为复用该函数；导出 `listMarketplaceSkus` / `getMarketplaceSku` 供 WorkBuddy 复用。
- `packages/db/prisma/schema.prisma` + `migrations/202609170002_workbuddy_marketplace_mode`：`WorkbuddyMcpConnection.agentId` 改为可空，新增 `mode`（默认 `agent`，兼容老连接）。
- `apps/api/src/services/workbuddy-connections.ts`：连接解析支持 `mode` 与可空 `agentId`。
- `apps/api/src/routes/workbuddy-settings.ts`：连接创建支持 `{ mode: "marketplace" }`，货架模式 `agentId=null`；旋转与 `publicConnection` 兼容可空 agent。
- `apps/api/src/routes/workbuddy-mcp.ts`：`resolveWorkbuddyAccess` 改为 `agent | marketplace` 联合；`sitong.skills` 在货架模式列 selling SKU；`sitong.ask` 在货架模式按 `skuCode` 走 `runMarketplaceSku`；透传 `marketplace_*` 错误码。
- `apps/web/src/pages/RechargePage.tsx`：「在 WorkBuddy 里接入思潼 AI」改为创建货架模式连接（不再绑定首个智能体）。
- QA 后补丁（与主实现同批收口）：`apps/api/src/data/marketplace-v3.json` 给 `ipzone.ov.copy` 补通用获客 `cap`/`tip`；`apps/api/src/routes/marketplace.ts` 让 `marketplaceIndustryContext` 对 `general:true` 专区也注入方法论上下文；`apps/api/src/routes/workbuddy-mcp.ts` 在缺 `skuCode` 时报错附带可选 SKU 清单、成功响应返回 `conversationId`、支持 `history` 数组多轮续聊。

### 验证

- `pnpm.cmd typecheck`（全仓 7 包）：**PASS**。
- `pnpm.cmd marketplace:foundation-smoke` / `pnpm.cmd marketplace:credits-only-contract-smoke`：**PASS**（抽取未破坏货架行为）。
- 新增 `scripts/workbuddy-marketplace-sync-smoke.mjs`（源码契约，已挂 `qa:fast`）：**PASS**。
- QA 后补丁复测：`pnpm.cmd --filter @baolu/api typecheck` **PASS**；`pnpm.cmd workbuddy:marketplace-sync-smoke` **PASS**；`pnpm.cmd marketplace:foundation-smoke` **PASS**；`pnpm.cmd marketplace:credits-only-contract-smoke` **PASS（33/0）**。
- 生产发布 `20260918-plat47-workbuddy-prod1`：发布包 sha256 `fead0ecd6f48393c7d42cc75de047686998b35ad91cbc918c68752a26468d8a9`，`DEPLOY_OK`；迁移 `202609170002_workbuddy_marketplace_mode` 已应用；`health=200`、`ready=200`、`/integrations/workbuddy/status=200`；生产 `marketplace.ts` 命中 `runMarketplaceSku`、`workbuddy-mcp.ts` 命中货架模式与 `available=`、`RechargePage-*.js` 命中 `mode:"marketplace"`；`journalctl -u baolu-os-v2 -p err` 无条目。
- 未运行：WorkBuddy 客户端真机调用（同 PLAT-46 边界，留用户实测）。

### 交接

- 关键决策：计费口径选 **A（与货架同价同账，ppu / 包月）**，用户 2026-09-17 确认。
- 实现决策：把 `POST /market/skus/:skuId/run` 的核心执行 + 计费抽成可复用函数，让网页货架与 WorkBuddy `sitong.ask` 共用同一套，避免两套计费漂移。
- 最后更新日期：2026-09-17

## 任务登记补记（2026-09-15 对账）

对账原因：本登记表从 PLAT-36 直接跳到 PLAT-44，中间 7 个已交付的平台任务**没有任务卡**，只在 `docs/CURRENT_DEPLOYMENT_STATUS.md` 留了发布记录。按 `docs/agents/AGENTS.md` 第 10 条「一个 Codex 任务只交付一个可独立验收的主要用户结果」，这里按发布记录补登记摘要。

口径说明：下面的「编号 ↔ 内容」对应关系来自发布 id 与提交信息（如 `20260915-pl40-noredo`、`b896d7a`），**未逐条回溯原始工单**；细节与验收证据一律以 `docs/CURRENT_DEPLOYMENT_STATUS.md` 对应条目和回归台账为准，不在此处复述未经核对的内容。

- **PLAT-37 按真实成本计费的换算契约**：倍数口径（文字 100× / 图片 5× / 视频 2× / 语音识别 10× / 视觉 100×）与公式落在 `apps/api/src/services/billing-cost-model.ts`（唯一出处），开关 `BILLING_COST_BASED_ENABLED` 默认关、线上价格一分未变；门禁 `billing:cost-model-smoke`。
- **PLAT-38 「我的」页自助邀请链接 + 对外统一客户链接**：`GET/POST /market/me/referral-link`（身份取自服务端验签会话）、推荐码明文只签发一次、链接与二维码服务端按 `PUBLIC_WEB_BASE_URL` 生成；发布 `20260915-plat38-plink`（含 `plat38b` 竞态修复）；门禁 `referral:self-service-smoke`。
- **PLAT-39 平台管理后台账号密码登录 + 概览业务数字**：`POST /admin/login`（12 小时会话、15 分钟 10 次限流、账号/密码错误文案一致防枚举）、`/admin/ops/summary` 补 `credit` 汇总（口径按生产校准）；门禁 `admin:login-smoke`。
- **PLAT-40 取消智能体「免费重做」**：`redoOf` 一律 409 `marketplace_free_redo_removed`，老 `/billing/redo` 一律 409 `billing_free_redo_removed`，前端按钮与状态下线；门禁 `marketplace:free-redo-smoke`。
- **PLAT-41 按实际成本结算接线**：`/voice/transcribe`（ASR 10×）与 `/media/analyze`（图片、扫描 PDF 视觉 100×）走「先预留 → 按实际结算 → 差额退回」，余额不足在**调用 Provider 之前** 402；门禁 `credit:charge-smoke`、`plat33:voice-transcribe-admission-smoke`。
- **PLAT-42 货架「行业专家专区」空栏**：新增专区占位、暂不上架智能体（提交 `b896d7a`）；发布校验断言 `expert_zone_empty=True`。
- **PLAT-43 客户可见文案「去计费感」**：取消「按次使用 / 从统一积分钱包扣 / 扣积分 / 扣费」类表述，改为交付导向；发布 `20260915-plat43-copy`，`marketplace:foundation-smoke` 与 `deployed-marketplace-browser-check` 断言同步。

### 当前开放项（2026-09-15 对账时的真实状态）

| 项 | 状态 | 卡在哪 |
| --- | --- | --- |
| PLAT-23 积分 ↔ 人民币 ↔ 成本换算常量口径统一 | **阻塞** | 待用户拍板口径（三选一），未动代码 |
| PLAT-26 市场合伙人分润口径与结算 | **待确认** | 待用户给分润比例；`PARTNER_SHARE_PERCENT` 未定前返回 `null`，不臆造 |
| PLAT-28 推荐有礼第②③批 | 未开工 | 第①批已上线；②（按配置发双向奖励）、③（推荐明细后台）未启动 |
| PLAT-30 发布流水线防覆盖 | 已排期 | 用户拍板「等 PLAT-28 第②批之后再做」（要独占改共用发布脚本） |
| PLAT-32 平台底座抽取 | 基本完成 | 剩 `auth.ts` 巨型 `registerAuthRoutes` 拆分，建议单列任务 |
| PLAT-33 公共平台语音输入 | **已完成**（本行已校准） | 原写「待发布」，实际 2026-09-14 已上线 |
| PLAT-44 旧工作台下线 + 视频复盘收窄 | 已完成 | 遗留：兰琪/美业自有页面的 `/my-ai` 入口、美业 `beauty-directory-browser-e2e`、`MyAiPage` 去留 |
| PLAT-45 三条计费口径（IP 定位固定 400 / A+图片放开 / 文案包月） | **已完成 + 已上生产** | 详情页包月入口已补做并上线（`20260917-plat48-copy-monthly-detail-prod1`）；剩「用户登录后真开通一次包月 → 连生成 2 次不扣分 → 第 6 次被拒」的人工实测 |
| PLAT-46 WorkBuddy MCP 双账本打通（钱包优先 + 租户账本兜底） | **已完成**（本地全绿） | 待 WorkBuddy 客户端真机发一次 `sitong.ask` 复核 |
| PLAT-47 WorkBuddy 接入货架已上架 SKU（sitong.skills/ask 改走 marketplace 计费与执行） | **已完成 + 已上生产** | 计费口径选 A（与货架同价同账），用户已确认；客户端真机调用待用户复核 |

- 最后更新日期：2026-09-17

## PLAT-49 餐饮专区数字人上线（同美业逻辑）

状态：**已部署测试实例与生产**（测试 `…-test3` `DEPLOY_OK`；生产 `20260919-plat49-restaurant-digital-humans-prod1` `DEPLOY_OK`）

### 归属

- 产品：公共平台（货架专区 `canyin`）。
- 层级：货架配置与行业参考案例；不新增模型路由、不新增计费口径、不新增 Skill。
- 风险：中。开卖状态会进入公开货架并允许扣积分，因此只随发布文件走、可回滚。

### 用户结果

用户进入货架后看到「餐饮专区」不再显示「待上线」，而是与美业专区一致地逐内核展示 9 个餐饮行业数字人：IP 定位、选题、文案、视频复盘、直播话术、直播复盘、销售话术、朋友圈、IP 增长套装。当前可购买口径与美业一致：IP 定位 / 文案 / 视频复盘 / 直播话术为 `selling`，其余 5 个为 `coming_soon`。

### 本次范围

- `apps/api/src/data/marketplace-v3.json`：把 `canyin.ready` 置为 `true`，补齐 `prefix`、`who`、`lexicon`、`pains`、`redline` 与 9 个内核的 `ov`（欢迎语 / 交付口径 / 需要输入 / 方法论 / 落地提示）。
- `apps/web/src/marketplace/reference-cases.ts` + `industry-samples.ts`：把 WorkBuddy 交付的 8 份行业校准样例（IP定位 / 文案 / 视频复盘 / 直播话术 × 美业 / 餐饮）挂成按完整 SKU 命中的参考案例；通用直播样例改为中性；保留 `topic` / `moments` 既有专属样例。
- `scripts/marketplace-foundation-smoke.ts`：货架 SKU / 开发中 / 开卖口径从 19 / 11 / 8 更新为 28 / 16 / 12，并把 `canyin` 纳入状态来源回归。
- `scripts/marketplace-reference-case-neutral-smoke.ts`：新增 `canyin` 行业词守护，并断言餐饮专属样例存在。

### 本次不做

- 不改 `restaurant-growth-advisor` / `takeaway-growth-advisor` 的 Prompt、路由或 Skill 版本。
- 不改现有 ipzone / meiye / lanqi 专区价格、状态或文案。
- 已部署测试实例；本轮不部署生产、不发起付款或外部动作。

### 验收条件

1. `/market/zones` 仍返回 `canyin`，且 `/market/skus` 包含 9 个 `canyin__*` SKU。
2. `canyin` 状态与美业一致：`canyin__ip-pos` / `canyin__copy` / `canyin__vidrev` / `canyin__livescript` 为 `selling`，其余 5 个为 `coming_soon`。
3. `coming_soon` 仍不可购买或扣积分，`selling` 允许进入正常购买/运行链路。
4. 通用参考案例不得出现餐饮行业词；餐饮专属参考案例只对完整 SKU 命中。
5. 状态必须来自发布文件 `marketplace-v3.json`，不能被数据库专区 profile 的空 `ov` 吞掉。

### 验证

- `pnpm.cmd marketplace:foundation-smoke`：PASS。
- `pnpm.cmd marketplace:reference-case-neutral-smoke`：PASS。
- `pnpm.cmd marketplace:api-smoke`：PASS。
- `pnpm.cmd marketplace:sku-link-contract-smoke`：PASS（18/0）。
- `pnpm.cmd marketplace:credits-only-contract-smoke`：PASS（33/0）。
- `pnpm.cmd workbuddy:marketplace-sync-smoke`：PASS。
- `pnpm.cmd --filter @baolu/api typecheck` / `pnpm.cmd --filter @baolu/web typecheck`：PASS。
- `pnpm.cmd qa:fast`：**未完成**，在 `auth:wechat-login-failure-paths-smoke` 因缺少 `WECHAT_AUTH_REDIRECT_URI` 提前中断（环境配置缺失，非本改动引入）。
- 测试实例：`DEPLOY_OK`（test1 核心专区 + test2 样例挂载 + test3 P2 修复），`health=200`、`ready=200`，`/market/skus` 返回 9 个 `canyin__*`，4 `selling` / 5 `coming_soon`；`grep` 命中餐饮 IP 定位与直播话术样例。
- 生产：`20260919-plat49-restaurant-digital-humans-prod1` `DEPLOY_OK`；`health=200`、`ready=200`；`/market/skus` 返回 9 个 `canyin__*`，4 `selling` / 5 `coming_soon`；`grep` 命中餐饮样例。

### 交接

- 测试实例链接：`https://api.lcppch.top/lanqi-test/agents`；生产链接：`https://api.lcppch.top/os-v2/agents`。生产已发布，仍需按发布纪律补跑 `prelaunch:check`、`qa:full` 与线上真实登录 smoke（测试环境 `dev-login` 不代表生产微信登录）。
- 残余既有失败（与本改动文件无关）：`marketplace:chat-slot-numbering-contract-smoke`、`marketplace:chat-restart-smoke`、`marketplace:ip-pos-interview-contract-smoke` 与 `marketplace:mine-docx-download-smoke`（缺 `DATABASE_URL`），应单列修复，不在本任务扩大范围。
- 最后更新日期：2026-09-19
