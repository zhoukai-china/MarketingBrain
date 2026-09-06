# FIP-01 四目标产品迁移

状态：已完成（迁移基础与四大来源选题 P1 闭环）

## 归属

- 产品：创始人 IP 获客系统
- 层级：产品任务含平台子改动
- 风险：高
- 预计修改热点：Agent 定义、工作地图、获客目标简报、路由、授权、前端产品入口、回归脚本
- 是否允许并行：不与其他修改 Agent 公共路由或工作台的任务并行

## 用户结果

老客户从一个创始人 IP 获客系统选择招商加盟、C 端团购到店、学员招募或合作方招募，并得到与目标一致的内容、承接和复盘。

## 本次范围

- 建立四目标类型与获客目标简报契约。
- 兼容迁移旧品牌招商和门店获客能力。
- 统一产品入口，但保持四种业务状态和指标隔离。
- 为正常、失败、混合目标和越界场景建立回归。

## 本次不做

- 不删除历史会话、客户权限或旧 Agent 数据。
- 不同时建设兰琪或外卖的新功能。
- 不部署生产。

## 验收条件

1. 正常路径：四目标可独立完成获客目标简报与四大来源选题；后续内容、承接和结果模块按独立任务卡交付。
2. 失败路径：目标缺失、资料缺失、冲突目标和工具失败有明确恢复方式。
3. 不应发生：跨目标错误指标、跨租户串数据、编造业务结果、未经确认外部执行。
4. 可观测结果事件：目标选择、获客目标简报完成、内容采用、线索阶段变化、真实业务结果与放弃原因。

## 基线与失败证据

- 基线命令：`pnpm.cmd qa:franchise-acquisition`、`pnpm.cmd acceptance:acquisition-scenarios`、`pnpm.cmd qa:fast`
- 修复前失败测试/Eval：开发开始时先新增四目标契约回归，并证明旧实现失败。
- 现象、根因和连带影响：产品方向改变；旧实现将招商和门店获客作为两个独立 Agent，尚无学员/合作方完整状态机。

## 本次完成

- 兼容保留 `agent_acquisition`，外显升级为创始人 IP 获客系统，并增加招商加盟、C 端团购到店、学员招募、合作方招募四个显式入口。
- 新增四目标语义路由与混合目标拆分回归；每个目标的获客目标简报提示与禁止混用指标、编造结果、未经确认外部执行的硬门禁已落地。
- 工作地图仅展示统一获客流程，四目标只在选题获客目标简报内选择；旧 `agent_store_acquisition`、老客户权限、历史会话与旧 Agent ID 未删除。
- `pnpm.cmd qa:founder-ip-acquisition` 已纳入 `scripts/founder-ip-four-goal-contract-smoke.ts`。
- 创始人 IP 选题工作台已统一四目标：从工作地图选择目标会预填招商加盟、C 端团购到店、学员招募或合作方招募；用户填写身份/项目、目标人群与本轮线索目标后，固定调用 `baolu_topics`。
- 企业知识库/资料库已从创始人 IP 的侧栏、页头和工作地图主流程隐藏，未删除任何历史资料、录音连接、会话、权限或旧兼容入口。
- 四源固定为近期行业热点、近期对标账号、AI 录音卡、自己账号真实数据复盘；最后一源明确用于识别可继续测试的爆款方向及应放弃/降频的方向，缺失或无法核验时不编造。
- 新增“问问保禄”独立对话模块：侧栏和工作地图可直达，固定调用 `baolu_ip_advisor`；它只以“保禄的新媒体与创始人 IP 能力分身”答疑，输出直接判断、依据、今天动作和待验证项，不冒充本人、不编造经历/数据/案例，也不执行外部动作。
- 新增统一获客目标简报持久化：按 `tenantId + subjectId + target` 保存和更新身份、目标人群、线索目标、项目、账号阶段、行业和对标账号；刷新当前主体时恢复对应目标，保存/恢复失败或主体无权时明确提示。迁移固定使用 `202608130007_fip_goal_briefs`，不修改既有迁移。
- 本机创始人 IP 体验入口：`/login/founder-ip` 在开发环境新增“本机直接开通并进入创始人 IP 获客”，复用现有非生产 `dev-login` 并传递 `personal_ip` 与 `ip_standard`。该入口不需要邀请码，清除浏览器数据后可再次直接进入；生产登录、微信登录、邀请码和产品授权不变。
- 单主体客户界面：创始人 IP 选题系统自动采用当前租户默认主体，不显示“更换主体 / 选择主体”，也不渲染“选择已有客户 / 新增客户”弹窗。新建任务同样自动回到默认主体；底层 Brief 仍以 `tenantId + subjectId + target` 约束，防止跨租户和跨目标串数据。

## 验证结果

- 修复前：`node apps/api/node_modules/tsx/dist/cli.mjs scripts/founder-ip-four-goal-contract-smoke.ts` 失败，旧实现仍显示品牌招商名称且无四目标入口。
- 修复后：`pnpm.cmd qa:founder-ip-acquisition` PASS；`pnpm.cmd qa:fast` PASS；`pnpm.cmd agent:smoke` PASS。
- 本轮选题迁移：先新增 `scripts/founder-ip-topic-workbench-smoke.mjs`，旧双模式工作台运行时失败；修复后 `pnpm.cmd qa:founder-ip-acquisition` PASS，`pnpm.cmd qa:fast` PASS，`pnpm.cmd --filter @baolu/web typecheck` PASS，`git diff --check` PASS。
- 问问保禄：先新增 `scripts/founder-ip-baolu-advisor-smoke.ts`，因 Skill 资产不存在失败；修复后以三次相同硬门禁样例运行 `scripts/verify-founder-ip-baolu-advisor.ts`，验证固定路由、必填结构和禁止冒充/编造/外部执行。
- 统一目标 Brief：先新增 `scripts/founder-ip-goal-briefs-smoke.ts`，修复前因专属服务与迁移不存在失败；运行态验收曾发现 demo 租户可跨主体读取，已由 `scripts/verify-founder-ip-goal-briefs.ts` 复现（修复前 200）并回归为跨租户 404。当前脚本覆盖保存、更新、刷新恢复、目标隔离与租户隔离。
- 最终复检：`pnpm.cmd qa:founder-ip-acquisition` 与 `pnpm.cmd qa:regression` PASS；`pnpm.cmd qa:fast` 的结构、Skill 资产、Eval 与共享/前端/Agent 类型检查通过，但被其他并行的兰琪文件 `apps/api/src/routes/lanqi-content-studio.ts:37` 的 `LanqiContentCopy -> InputJsonValue` 类型错误阻断，未修改该跨产品既有问题。
- 运行态基线：`pnpm.cmd acceptance:acquisition-scenarios` 与 `pnpm.cmd agent:input-smoke` 因本地 API `localhost:3011` 未启动而失败（ECONNREFUSED），未使用真实客户或外部服务替代。
- 本机体验入口：修复前 `node scripts/product-login-entry-smoke.mjs` 因缺少开发环境产品直达入口断言失败；修复后该脚本 PASS。运行态实际点击“本机直接开通并进入创始人 IP 获客”后，进入 `/agents/acquisition`，页面呈现四目标与“问问保禄”，浏览器控制台无新增 error。`POST http://127.0.0.1:3012/auth/dev-login` 的创始人 IP 专项返回 `personal_ip + ip_standard`。
- 单主体客户界面：先在 `scripts/founder-ip-topic-workbench-smoke.mjs` 新增“创始人 IP 不出现主体切换、自动使用默认主体”的断言，修复前失败；修复后专项 PASS，Web TypeScript 检查 PASS。运行态页面显示“本客户工作区”，不存在“更换主体 / 选择主体 / 当前主体”文本。
- 选题生成回归：`scripts/founder-ip-topic-workbench-smoke.mjs` 先新增“工作台等待生成请求”和“直达选题 URL 不重开工作地图”断言，修复前失败；本轮继续新增“用户可见的从四大来源生成创始人 IP 选题请求必须被最终结果定位器识别”断言，修复前失败。生成请求现等待 `onGenerate` / `send` 并反馈错误，结果能回显至选题工作台；`topicSystemRun=true` 的服务端运行返回 `topic_inspiration` 成品验证。浏览器自动化已实际点击生成并验证桌面与 390px 移动端结果区、内容系统入口、刷新恢复与控制台。
- 工作地图去重：四目标的选择改为仅在选题 Brief 内完成；地图移除招商加盟、C端团购到店、学员招募、合作方招募节点及“填写 Brief 后生成选题”连线，保留统一的选题—内容—投流预览—复盘与直播承接流程。`scripts/founder-ip-topic-workbench-smoke.mjs` 先以旧节点断言失败；更新后的 `scripts/agent-work-map-smoke.ts` 与 API `/agents/acquisition` 运行态读取均确认地图只包含统一流程节点。
- 招商线索目标去重：移除“获取加盟商留资”，保留“获取加盟咨询”；旧 Brief/本地缓存中“获取加盟商留资”（兼容“获取加盟商留址”写法）恢复时自动归一为“获取加盟咨询”。专项 smoke 已先因旧选项存在失败，再于修复后通过。
- 学员招募目标收敛：移除“完成报名”；旧 Brief/本地缓存中的该值恢复时自动归一为“报名说明会”。专项 smoke 已先因旧选项存在失败，再于修复后通过。
- 工作地图重组：新增不可点击的“创始人IP获客系统”总入口，分别连接选题系统、直播系统和独立的“问问保禄”任务卡；选题后依次连接内容系统、投流系统、视频复盘系统，直播后连接直播复盘系统。专项工作地图回归先因总入口不存在失败，再于修复后通过。
- 工作地图连线修复：直播与问问保禄均从总入口直接分支，移除会穿过问问保禄卡片的直播折线；问问保禄无后继连线。专项回归先因旧直播折线存在失败，再于修复后通过。
- 用户文案中文化：创始人 IP 获客系统页面、提示与选题生成上下文统一使用“获客目标简报”，不再向用户显示英文“Brief”；内部类型、函数、API 路径与数据库字段保持不变。
- 四大来源选题质量：P1 已关闭。来源选择会随请求传至服务端，未启用的来源不会进入最终交付；demo 路径使用当前仓库 Agent，最终交付会重建丢失五项必填字段的旧格式结果。四单来源、两种组合、缺失、超时、四目标、租户/主体隔离、最终 API 三次重复，以及桌面/移动端页面都已验收。

## 交接

- 残余风险：公共工作台和路由属于热点；后续改动必须串行迁移并保留回滚入口。本轮本机 demo API 常驻并已完成运行态复验；三条 pnpm 聚合门禁受包管理器签名校验/网络环境阻断，未绕过该安全保护。
- 已拆分的后续范围：内容生产与适配由 `FIP-04` 交付；四套承接状态由 `FIP-06` 交付；真实结果事件和下一轮复盘由 `FIP-07` 交付。它们不再阻塞本迁移任务完成。
- 后续任务：优先执行 `FIP-04`，让用户从已确认的选题进入可编辑、可保存、可恢复的内容草稿；之后再按模块推进 `FIP-05` 至 `FIP-07`。
- P1 选题闭环（2026-08-14）：已修复 demo 运行仍经旧 MCP 网关返回旧选题模板、以及用户可见四源请求未被结果定位规则匹配而不回显的问题；最终 API 现在强制保留五项可用字段和已启用来源边界。四个单来源、两种组合、缺来源、超时、四目标、租户/主体简报隔离与最终 API 三次重复回归已执行。桌面与 390px 移动端页面已实际验收；`qa:fast`、`qa:regression` 和 `qa:full` 均在 pnpm 签名校验阶段被环境阻断，等价专项、结构、资产、Eval 和 TypeScript 检查通过。
- 共享热点交接：`packages/skills/src/index.ts`、`packages/agent/src/index.ts` 和 `apps/api/src/services/agent-definitions.ts` 的当前差异由 FIP 产生，已通过 FIP 专项和 TypeScript 检查；后续任务应以当前工作树为基线，不覆盖这些差异。`packages/shared/src/index.ts` 混有 PLAT-01 三产品登录定义与 FIP 地图/能力/路由，不能由 FIP 或兰琪单独覆盖；需要总调度在串行合并时保留两类改动。
- 最后更新日期：2026-08-14。
