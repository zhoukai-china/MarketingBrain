# 开发总调度

本文件是开发总调度的排程与派发记录；新对话从本文件和各产品 STATUS/任务卡恢复上下文，不要求用户复制旧聊天。

## 职责边界

- 用户只与总调度沟通需求；总调度先判定「公共平台能力」还是「单个智能体开发」，再派发到对应代码区/产品任务窗口（公共能力进平台区、串行；单智能体进各自代码区、可并行）。
- 一个执行任务只交付一个可独立验收的主要用户结果；同一产品不并行两个编码任务；跨产品并行最多两个，且用独立 worktree/分支。
- 共享热点文件冲突时串行化；先做公共平台抽取，再并行业务任务。
- 外部动作默认只生成预览/草稿；没有用户确认不投放、付款、发布、发消息或改生产配置。
- 候选进入正式目录前必须独立验收，不直接调用 WorkBuddy 候选原件。
- 兰琪专属任务一律在兰琪专属任务窗口推进，不在总调度执行/决策；总调度只跑公共平台与调度事务。

## 派发记录

- 2026-09-06：B（BY-54 Seedance 真实云端收口前置核验）→ 新建 BY-55 卡，待用户提供 Ark 账号/素材/预算；详情见 docs/agents/beauty-industry/tasks/BY-55-Seedance真实云端收口前置核验.md。
- 2026-09-06：C（git 快照基线、外卖需求池、候选审计）在本对话框直接执行并提交快照基线。
- 2026-09-06：调度优先级确定为美业智能体优先；外卖、创始人 IP 智能体开发冻结，不派发新编码任务。

- 2026-09-07~09-13（总调度2→4 阶段批次，按提交历史与部署文档还原）：兰琪 LQ-23~27（真出片/检索源/拆页/出片接线）、QA-20260911/12/13 系列、PLAT-28 第①批（关闭人工发放、推荐归因、配置位）、PLAT-29/31（完整样例、去前置报价、拖拽上传）已实现并部署测试+生产；批次改动大部分仍留在未提交工作树，部署状态以 docs/CURRENT_DEPLOYMENT_STATUS.md 为准。
- 2026-09-13（总调度5，本会话）：① 收口 `/my-ai` 路由 E2E 红灯（脚本断言与采集时序修复，生产匿名 24/24 + 本地登录态 24/24）；② 完成 PLAT-25B 标题体系（chat 页浏览器 `<title>` = 智能体名 · 专区名 + 页内标题去重，含新契约测试与浏览器回归，`qa:fast` green；未提交未发布，见 QA-20260913-007）。
- 2026-09-13（总调度5 · 续）：货架三项 UI 口径改动 + PLAT-25B 标题体系已发布上线（`20260913-zd5-storefront-ux`，测试+生产 `DEPLOY_OK`+`VERIFY_OK`+生产探针/路由 24/24，见 docs/CURRENT_DEPLOYMENT_STATUS.md）。
- 待办队列（不自动启动）：PLAT-28 第②批推荐奖励实际发放（等用户启动）；`/ops/wechat-pay-check` 运行时读取密钥探测（已实现 + qa:fast 通过，未发布）；BY-55 Seedance 真实云端收口（转兰琪专属任务窗口跟进；等 Ark 账号/素材/预算）；服务器磁盘压力（`/opt/baolu-backups` 12G）+ 备份保留策略评估（建议单独任务）。
- 2026-09-13 收尾（用户关机，明日继续）：① 明天可发链接 https://api.lcppch.top/os-v2/login?ref=ref-mxow3bifnsv5（真码未使用）；生产全链路合成 E2E 21/21、reward-payguard（推荐第②批+90天到期+支付加固）已上线，活动窗 2026-09-13T12:02Z 起 / 2026-09-30T16:00Z 止。② 任务4 进度：直播话术招商完整样例已完成（web typecheck + neutral smoke PASS），IP定位 Word 去#修复已写（api typecheck PASS）但未运行渲染截图、未跑两条改动后的全量 qa:fast、未发布。③ 明日续作清单：补 qa:fast → docx 渲染验收 → 把样例+Word 修复并入下个公共平台批次；复盘 WorkBuddy 新用户链路验收报告中“断网原生提示/mock server error”文案残余。
- 2026-09-14（总调度7）：确立目标结构＝1 个公共平台代码区＋每个智能体各自一个代码区；平台少动、向后兼容、改动串行，智能体可并行，先做真实产品再抽公共能力；用户只与总调度沟通需求，由总调度判定公共/单智能体并派发。进展：兰琪 LQ-28 已收口（测试+生产上线）；「平台底座抽取」完成第①②③批（server.ts 产品路由抽到 `apps/api/src/products/register.ts`、main.tsx 兰琪路由抽到 `apps/web/src/routes/lanqi.tsx`），第④批 MarketplaceApp.tsx 全部拆成 5 个独立组件 + `sku-model.ts` + `shell.tsx`，auth.ts 已抽 schemas/helpers（qa:fast + web/api build 全绿）；auth.ts 巨型 registerAuthRoutes 建议单列后续任务。既有回归红灯：`beauty-video-oss-staging-smoke.ts` 期望 `cleanup_failed` 实得 `oss_http_503`（本批未触及，属既有失败）。暂不做平台发布。

- 2026-09-14（总调度7 · 发布）：`20260914-zd7-platform` 测试实例 + 生产均 `DEPLOY_OK` + `VERIFY_OK`；上线内容 = 样例修复（文案「内容十件套」/ 视频复盘「深度复盘」/ 直播话术完整样例）+ 客户端拖拽上传/去前置报价 + 「平台底座抽取」路由重构。生产产物核对：`内容十件套`=4、`深度复盘`=10、旧 `单条视频复盘`=0、`约扣`=0；备份 `/opt/baolu-backups/20260914-zd7-platform-prod1-before-baolu-os-v2/`（189M）。残留：美业专属样例 `meiye__copy` 仍是旧版短样例。

- 2026-09-14（总调度7 · 发布 2）：`20260914-zd7b-recharge-mcp` 测试 + 生产均 `DEPLOY_OK` + `VERIFY_OK`；充值页 WorkBuddy 区块换成可直接复制的 MCP 接入指令（首次点击自动生成 `sitong_wb_` 连接并连指令一起复制），旧的计费令牌 UI 下线。备份 `/opt/baolu-backups/20260914-zd7b-recharge-mcp-prod1-before-baolu-os-v2/`。

- 2026-09-14（总调度7 · 发布 3）：`20260914-zd7c-vidrev-off` 测试 + 生产均 `DEPLOY_OK` + `VERIFY_OK`；按用户口径把「视频复盘智能体」下架成「开发中」（`ipzone__vidrev` / `meiye__vidrev` → `coming_soon`，货架 `coming_soon=15` / `selling=4`），改好后再上架。备份 `/opt/baolu-backups/20260914-zd7c-vidrev-off-prod1-before-baolu-os-v2/`。

- 2026-09-14（总调度7 · 发布 4）：`20260914-zd7d/zd7e-vidrev-fix` 测试 + 生产均 `DEPLOY_OK` + `VERIFY_OK`；按 2026-09-13 工单改造视频复盘（数据导出指南 / 删快速诊断 / `parse-preview` 预检 / 一键填充标准请求 / 视频号抖音字段别名）。视频复盘仍为「开发中」，待业务验收后再上架。

- 2026-09-15（平台线「思潼AI平台开发」· 承接总调度7；发布 5）：总调度7 线程因桌面版 `missing field call_id` 系统错误停摆，平台任务在本线继续并收口发布 `20260915-plat44b-legacy-ai`（测试 `…-test1`、生产 `…-prod1` 均 `DEPLOY_OK` + `VERIFY_OK`；生产 `journalctl -p err` 近 12 分钟无条目；发布包 sha256 `d025c7b8…`）。上线内容 = 旧「专业工作地图」工作台下线（`/my-ai`、`/workbench`、`/app` 全部回货架；平台自有页面里「返回常用智能体」改到 `/mine`、品牌回货架）+ 视频复盘只做抖音/视频号（服务端 fail closed 422、预检 `其他平台`、前端选项与指南收窄）。同轮修掉「保留网址契约」的 `mustNotInMain` 哑断言（`docs/BUG_REGRESSIONS.md` QA-20260915-004）并新增 `marketplace:vidrev-platform-scope-smoke`（真实路由、0 Provider，已入 `qa:regression`）。生产真机 26/26 通过。任务卡：`docs/agents/platform-tasks.md` PLAT-44。

- 2026-09-15（跨线迁移结果，供两条线共同参考）：总调度8 已把兰琪编码任务迁到独立 worktree（`C:/Users/book/.codex/worktrees/f18c/baolu-os-v2-source`，分支 `codex/lanqi-acquire2-page`），平台任务留主树；迁移过程中平台在途改动被暂存带进了兰琪工作树，已核实全部回到主树、无文件丢失，兰琪工作树 `git status` 干净。跨产品自本轮起可真正并行（上限仍是 2 个编码任务），但**发布通道仍串行**。

## 总调度8 · 并行/串行判定与热点互斥（2026-09-15）

**判定：受限并行。** 各自产品目录的文件可并行；工作树、共享热点文件、发布通道一律**串行**。

判定依据（2026-09-15 18:00–18:10 只读取证）：

- 总调度7（`01a09d77`）与兰琪任务（`01a09f67`）**同时在同一工作树** `F:\思潼AI增长os\baolu-os-v2-source` 编码，两条线程各有一个进行中的回合。`docs/agents/AGENTS.md` 第 10 条要求跨产品并行必须使用独立 worktree/分支，当前条件不满足。
- 8 分钟内两条线交替写盘：兰琪 18:05:30 打出 `release-20260915-lq32-samecontent.tar.gz`，而平台侧文件同期仍在改（`scripts/ops/install-wechat-verify-file.sh` 18:02:08 → `apps/api/src/services/video-review-engine.ts` 18:05:19 → `apps/web/src/marketplace/chat-flows.ts` 18:05:46 → `apps/api/src/routes/marketplace.ts` 18:06:02 → `apps/web/src/main.tsx` / `NotFoundPage.tsx` 18:08:47）。
- 已核对 LQ-32 发布包内的平台文件 = HEAD 版本（`video-review-engine.ts` 仍是「笔记标题」旧口径、`main.tsx` 仍是 `MyAiPage` 旧实现），**本轮未把平台在途改动带上生产**；但这靠人工挑文件实现，历史上已失手一次：提交 `cd37a6b` 把兰琪 `LanqiAcquireVideoPage.tsx` 覆盖回「贴链接」旧版，后由 `881d7be` 重新落回。

规则（两条线程共同遵守，违反即按 P1 处理）：

1. **写区独占**：兰琪只写 `apps/web/src/pages/Lanqi*`、`apps/api/src/products/lanqi/**`、`scripts/lanqi-*`、`docs/agents/lanqi-beauty/**`；总调度7只写平台/公共与 `marketplace` / `vidrev` / `ops` 相关文件。不得顺手改对方文件。
2. **热点文件令牌**：`apps/web/src/main.tsx`、`apps/web/src/pages/NotFoundPage.tsx`、`apps/api/src/products/register.ts`、`package.json`、`scripts/tmp/deploy-*.sh`、`scripts/tmp/verify-deploy.sh`、`docs/CURRENT_DEPLOYMENT_STATUS.md`、`docs/BUG_REGRESSIONS.md` 同一时刻只允许一方改；要改先在对话里声明，对方确认空闲后再动。
3. **打包纪律**：打包前跑 `git status --porcelain`，包里只允许有自己的改动；对方在途文件必须取 HEAD 版本入包，并在发布记录里写明哪些文件是「HEAD 入包」。
4. **发布串行**：同一时刻只允许一个任务执行部署（共享 `scripts/tmp/deploy-*.sh`、共享服务重启与迁移窗口）。另一方在跑部署时不得打包发布。
5. **禁止回退对方文件**：不得用 `git checkout` / `restore` / 整文件回写去「修复」对方文件；发现被覆盖要保留证据并单独提交修复（参照 `881d7be`）。

**持久修复（需用户点头 + 线程空闲时执行）**：把兰琪编码任务迁到独立 worktree（`C:/Users/book/.codex/worktrees/<id>/baolu-os-v2-source`，仓库已有先例），平台留在主树；完成后跨产品可恢复真并行（最多 2 个编码任务同时进行）。

**当前排期**：

- 兰琪任务（`01a09f67`）：LQ-32 已上生产，先把登记/提交收口，新编码任务在总调度7本轮发布完成前不启动。
- 总调度7（`01a09d77`）：把手上的平台/公共改动做完（`/my-ai` 下线跳转、视频复盘抖音/视频号口径、marketplace 文案与门禁），确认 `git status` 只剩自己文件后发布。
- 交接条件：总调度7 发布完成并提交后交回兰琪；两者不得同时打发布包、不得同时跑部署。

### 迁移执行结果（2026-09-15 18:20）

- **已执行**：兰琪线程 `01a09f67` 由 handoff 迁到 `C:\Users\book\.codex\worktrees\f18c\baolu-os-v2-source`（分支 `codex/lanqi-acquire2-page`），平台任务留在主树 `main`。
- **迁移踩坑（必记）**：handoff 会把「源工作树的**未提交**改动」一起搬进目标工作树。当时总调度7 在途的 10 个平台文件被一并带走；已用 `git diff --binary` 取回主树（两侧补丁 sha256 完全一致：`55e95f8f1d406ec2b59e4e7c6bc1da7fd76417d9dccb2ebdbda08500546d2944`），并把目标工作树里那 10 个文件还原为 HEAD 版本。→ **以后任何迁移/交接前，必须先 `git status` 清场**。
- **thread 换不掉上下文**：兰琪线程与总调度7 线程此后每轮都在启动阶段报 `missing field call_id`（请求体已 ~2.9MB）。handoff 只换工作区，换不掉累积上下文 → **一个线程的累计输入超过约 2.9MB 就不可恢复，只能换新线程**。这是本仓当前最贵的运维教训。
- **替代方案已落地**：新建兰琪独立任务「兰琪-公域获客2-页面开发（独立工作区）」，工作树 `C:\Users\book\.codex\worktrees\6ee3\baolu-os-v2-source`、分支 `codex/lanqi-acquire2`、起点 `a5cad01`；已预装依赖（`pnpm.cmd install --frozen-lockfile`，405 个包，与主树一致）。任务提示里写死了写区独占、热点文件令牌、打包前先 merge `main`、发布串行四条纪律。
- **旧线程处置**：`01a09f67`（f18c）与 `01a09d77`（总调度7，主树）保留为只读历史，不再承接新工作；平台线由主树上的「思潼AI平台开发」任务继续。
- **规则新增**：一个任务一个线程，禁止在同一线程里跨任务/板块累积上下文；线程出现第二次启动失败立即换新线程，不再原地重试。

## 调度线交接（2026-09-15，任务「思潼AI平台开发」接管）

**为什么换线**：`总调度7`（`01a09d77`）与 `总调度8`（`01a0a489`）两条线程都已进入 `systemError`，启动阶段即报桌面版 `missing field call_id`（请求体累积到数百 KB～2.9MB）。handoff 只换工作区、换不掉累积上下文，**同一线程不可恢复，只能换新线程**。经用户确认，平台与调度职责一并由任务「思潼AI平台开发」（`01a0a48d`）接管。

**接管时的交接事实**（新会话从这里恢复，不用翻旧聊天）：

- 平台侧本轮已发布：`20260915-plat44b-legacy-ai`（测试 `…-test1` / 生产 `…-prod1` 均 `DEPLOY_OK` + `VERIFY_OK`），内容与证据见 `docs/CURRENT_DEPLOYMENT_STATUS.md` 顶部条目与 PLAT-44 卡。
- 兰琪线现由任务「兰琪-公域获客3」（`01a0a4d1`，in-progress）承接；已由本线把写区独占、热点文件令牌、打包纪律、发布串行四条规则发给它。
- **工作树现状**：兰琪3 当前用**主树** `F:\思潼AI增长os\baolu-os-v2-source`（`总调度8` 记录里的 `6ee3` 工作树**并不存在**，只是当时的计划）；主树在本线提交 `2f15a2f` 处干净。跨产品并行建议仍按 AGENTS.md 第 10 条在独立 worktree 里做，否则打包必须等对方 `git status` 干净。
- **定时任务现状**：`C:\Users\book\.codex\automations` 下没有任何 automation 定义（只有一个 `.run-jitter-salt`）——历史记录里提到的「每日 12 点定时任务」当前**不存在**；如需每日自动巡检，需要用户明确重建。
- **开放项清单**（平台侧）：PLAT-23 待用户拍板口径（阻塞）；PLAT-26 待用户给分润比例；PLAT-28 第②③批未开工（PLAT-30 排期其后）；PLAT-32 剩 `registerAuthRoutes` 拆分；PLAT-44 遗留兰琪/美业自有页面的 `/my-ai` 入口、美业 `beauty-directory-browser-e2e`、`MyAiPage` 去留。产品侧：美业 BY-55 等用户提供非生产 Ark 账号 + 已授权素材 + 预算核验（外部 PAUSED）；创始人 IP 扩展与外卖增长均无进行中编码任务。

## 已知阻塞

- 桌面版 create_thread/fork_thread 对项目/派生线程会报 missing field call_id 系统错误，线程执行通道不可用；任务暂时在“开发总调度”对话框直接推进。
- 兰琪/美业整体暂停等待新原型；XHS、经营问答、BY-19/20/43、BY-44 外部保持 PAUSED。
