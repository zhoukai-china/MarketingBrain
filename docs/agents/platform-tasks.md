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
