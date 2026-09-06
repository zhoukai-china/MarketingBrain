# 创始人 IP 获客系统测试矩阵

## 问问保禄专项回归

- 固定路由到 `baolu_ip_advisor`，三次重复样例均输出直接判断、判断依据、今天动作和待验证。
- 不得冒充保禄本人、编造经历/数据/案例、跨到外卖或门店路径，或声称执行发布、投放、发消息和账号修改。

## 当前迁移基线

```powershell
pnpm.cmd qa:founder-ip-acquisition
pnpm.cmd qa:fast
```

当前命令只验证开发架构和可复用的获客目标简报、知识选择、内容展示基线，不代表四目标生产迁移已经完成。每个 FIP 模块落地后必须加入目标路由、承接状态与结果指标回归。

### 数据库迁移 P3018 回归

- `node scripts/user-role-assignment-migration-smoke.mjs`：断言 `MembershipRole @@map("UserRole")` 不变，而 RBAC 的 `model UserRole` 映射、202607010003 创建表、主键、两条外键和历史生成器全部使用 `UserRoleAssignment`；修复前 FAIL。
- 提供受控的 `MIGRATION_TEST_DATABASE_URL` 时，同一脚本只接受 127.0.0.1:55432 的隔离库并执行 `prisma migrate deploy`；其他目标立即拒绝。本次在干净库执行的标准 `pnpm.cmd --filter @baolu/db prisma:deploy` 已 PASS。

## 统一获客目标简报

- 已选主体下，四个目标各自保存、更新并在刷新后恢复；切换目标或主体不得带入另一份获客目标简报。
- 未选择主体、必填字段缺失、主体不属于当前租户、接口失败时明确提示；不能生成或覆盖其他目标数据。
- 数据库唯一键为 `tenantId + subjectId + target`；租户 A 不能读取或更新租户 B 的 Brief。

## 必测场景

### FIP-04 选题结果到内容草稿

- 单条选题进入内容系统时必须携带四目标、获客目标简报、选题/钩子、目标人群、来源依据、事实边界和目标关系；缺少服务端已保存简报时必须留在选题页并显示可恢复错误。
- 四目标的待补草稿分别使用加盟咨询、到店预约、课程咨询/试听、合作咨询/资格判断承接；不得复用其他目标 CTA。
- 内容服务超时、错选题、错目标或待验证来源被扩写成完整成品时，页面只显示事实受控待补草稿，阻断投流预览；草稿可保存和刷新恢复。
- 回归：`scripts/founder-ip-content-draft-closure-smoke.ts`、`scripts/founder-ip-content-delivery-quality-smoke.ts`；页面覆盖桌面与 390px 移动端。

### FIP-04-02 内容目标对齐与上下文隔离

- `scripts/founder-ip-content-context-isolation-smoke.ts`：断言 FIP 不再调用通用 `send()`，而是使用按草稿 ID 隔离的生成接口、空历史、锁定 Skill；演示模式与 `provider_fallback_used` 必须明确阻断。
- 同一上下文隔离回归还必须实际构建 `founder_ip_content_creator + content_plan` 系统消息，断言小于 5000 字符且不含企业默认画像、通用咨询师合同、Word 交付或本地商家默认目标；修复前精确命中旧门店画像并 FAIL。
- `scripts/founder-ip-content-target-quality-smoke.ts`：四目标各两例、同题切四目标、错目标/编造数字硬失败；每个合格文本须保留选题、受众、证据、目标关系与专属 CTA。
- `scripts/verify-founder-ip-content-generation.ts`：运行态验证生成→保存→恢复→租户隔离；若为演示/不可用模型则必须返回 503、无内容落库、上下文仍可恢复且跨租户 404。
- 页面：桌面与 390px 移动端验证进入内容系统、重复生成、错误中文提示、保存/恢复、返回重选与投流预览阻断。真实 Provider 成功输出及高风险样例三次稳定性只有在非 demo 环境才可标记 PASS。
- 联调 Champion：`scripts/founder-ip-content-live-provider-eval.ts` 固定四类目标的脱敏输入；`scripts/verify-founder-ip-content-live-provider.ts` 在非 demo API 上逐目标连续三次验证真实成品、CTA/事实边界、保存恢复和跨租户 404；`scripts/founder-ip-content-page-acceptance-smoke.mjs` 固定成功入口、失败阻断与刷新恢复页面契约。
- 真实复跑安全门禁：`scripts/verify-founder-ip-content-live-provider-single.ts` 只发一个已选目标的一次请求；`scripts/verify-founder-ip-content-live-provider.ts` 默认四目标各三次。两者必须显式设置 `FIP_LIVE_PROVIDER_CONFIRMED=1`，并在请求前确认本机 HTTP API、database、configured DeepSeek 和当前实际 Pro 模型 ID；未收到网关单请求交接不得开启。
- 真实输出硬门禁：逐请求记录 provider/model、阶段、延迟、成功/失败与是否降级；最终 API 必须保留来源证据、获客关系和目标 CTA，跨租户为 404，同目标三次不得全部返回完全相同的固定模板。请求有明确超时，任一次超时、编造、错目标、fallback 或固定模板硬失败即不放行。
- 页面 E2E：`scripts/verify-founder-ip-content-browser-e2e.ps1` 保留 browser-skill 路径；`scripts/verify-founder-ip-content-browser-playwright-e2e.mjs` 是宿主扩展不可用时的受控回归，使用工作区现有 Playwright 与系统 Chrome，且只允许 loopback Web/API。两条路径都不得调用生成接口；页面 acceptance 与 Provider 预检固定零模型边界。
- 数据库运行态脚本必须先经本机非生产 `dev-login` 创建测试租户并携带返回 token；不得使用 demo 的 `x-sitong-*` 请求头冒充数据库成员。当前主检出区启动前置为已注册的 FIP 原始 Skill：缺少 `mcp-skills/skills/baolu_ip_advisor/SKILL.md` 时，目录注册失败即阻断真实模型验证。
- `scripts/founder-ip-content-database-auth-smoke.ts`：固定 database 运行态验证必须使用 `dev-login` 的 Bearer token，跨租户使用第二个测试租户，并要求每个真实 Provider 样例用实际 `PUT` 保存获客目标简报；修复前旧脚本会以 demo 请求头获得 401。
- 模型策略门禁：目标简报、四来源综合、内容生成、投流预览与高风险事实/目标复核必须由网关当前批准的 Pro 模型完成（当前验收基线 `deepseek-v4-pro` + `reasoning_high`）；不得静默回落为 flash、其他低端模型、百炼文本或固定模板。模型不可用、超时、输出契约失败均返回明确待补/重试，且不保存为合格成品。
- 运行审计：每个真实 Eval 记录 selected provider/model、任务阶段、延迟、结果和降级状态；四目标各三次无硬失败后才能放行。内部 Eval 仅用隔离测试租户，不扣正式租户积分。Flash 若被提议用于字段提取，必须以同一 Champion Eval 证明无质量退化后才可启用。
- 2026-08-21 最终结果：共享终态将旧偶发 fallback 定位为 `finish_reason=length` 且 reasoning 耗尽 4096 输出预算；保持 Pro/high、无重试/无降级，仅把 FIP 内容阶段有界预算调整为 16384 后，同套四目标各 3 次 12/12 PASS、fallback 0、延迟 43.534–102.149 秒。桌面 1440×1000 与 390×844 页面 E2E 覆盖四目标、保存、刷新、返回、失败、取消、重复点击、租户隔离、控制台和网络，全部 PASS，模型请求 0。`qa:founder-ip-acquisition`、`qa:fast`、`qa:regression`、`qa:full` PASS，FIP-04-02 总门禁 PASS。
- 2026-08-21 本机体验链接复验：Playwright 增加工作地图可见性证据，要求一个不可点击总入口、3 条业务分支、2 条虚线复盘回流，并由 `agent-work-map-smoke.ts` 明确断言不存在“问问保禄 → 直播系统”。内容编辑器同时硬断言深色文字 `rgb(23, 61, 51)` 与实色浅底 `rgb(251, 253, 251)`；修复前可读性断言 FAIL。选题与内容专项另先以 AI 调用边界提示缺失 FAIL，修复后浏览器断言两处提示可见。最终桌面/390px、四目标、恢复/错误/取消/隔离、控制台、网络、零模型请求全部 PASS。
- 2026-08-21 工作地图命名回归：`agent-work-map-smoke.ts` 精确断言一级分支只能是“视频分支、直播分支、独立答疑”；视频分支内部必须保留选题、内容、投流、视频复盘，且不得把“选题系统”节点改名。Playwright 在桌面和 390px 检查三条分支、模块进入和两条回流虚线。
- 2026-08-21 证据相关性 P1 回归：`founder-ip-topic-evidence-guard-smoke.ts` 覆盖美业加盟不得由 AI 工具/企业 AI 改造录音主导、未确认/错主体/错行业录音不得自动入选、合成入口必须行业一致且持续标识；`verify-founder-ip-topic-evidence-api.ts` 覆盖无合格证据 422、目标或项目切换后的旧上下文 409、跨租户失败、重复请求、AgentRun/积分/Provider 调用为 0。服务端必须重新读取当前租户已保存的获客目标简报并把获准来源写入幂等指纹和最终 TOP10 来源白名单，不得依赖前端关键词删除。
- 2026-08-21 页面终验：本机合成验收入口不连接 GetNote、不允许新生成或对话微调，页面持续显示“本机合成验收数据”；美业加盟 TOP10 仅使用问题肌/美业加盟同目标合成证据，AI 咨询场景独立匹配 AI 项目，切换目标或项目不得复用旧行业结果。桌面/390px、刷新、返回、重复进入、跨租户 404、控制台和网络均 PASS，模型请求 0。

- 四种目标分别路由正确，缺失目标时追问。
- 选题入口先选择单一目标并填写身份、目标人群、线索目标；四个目标在同一选题工作台中可切换或从工作地图预填获客目标简报。
- 行业热点与对标账号必须保留近期性和可回溯状态；抓取失败、首用无对标或无账号数据时明确降级，不能编造热点、爆款或放弃结论。
- AI 录音卡和自己账号数据复盘只读取当前租户、当前 Agent 可访问的真实数据；资料库不作为进入选题的必填或可见步骤。
- 同一创始人复用已确认 IP 资料，不强制重复定位。
- 招商内容不被团购核销指标评价；团购到店不被加盟签约指标评价。
- 学员招募不编造课程效果、证书、就业、收入和报名。
- 合作方招募能区分加盟商、渠道、联营和其他合作类型。
- 混合目标分活动展示 Brief、内容、预算、承接状态和结果。
- 刷新恢复、重复请求、取消、超时、部分失败与扣费幂等。
- 租户、主体、会话、知识、线索和结果不串联。
- 高风险非确定性样例至少重复 3 次，任一硬失败都阻断放行。
- 选题最终 API 交付必须保留“选题/钩子、目标人群、来源依据、与获客目标的关系、下一步生成内容”五项；禁用的来源不得在结果中出现为依据。`scripts/founder-ip-topic-final-delivery-smoke.ts --api` 覆盖最终 HTTP 返回，不只检查中间 Agent 结果。

## 2026-08-14 P1 闭环证据

- `scripts/founder-ip-topic-source-quality-smoke.ts`：四种单来源、两种组合、缺失来源、超时降级和四目标边界，各连续运行三次；编造、来源未生效、字段缺失与目标串线均为硬失败。
- `scripts/founder-ip-topic-final-delivery-smoke.ts --api`：最终 HTTP 交付连续三次验证五个用户字段、10 条选题、已启用来源和禁用来源边界。
- `scripts/verify-founder-ip-goal-briefs.ts`：保存、更新、刷新恢复、目标隔离与跨租户 404 已在本机 API 验证。
- 页面：桌面和 390px 移动端实际打开并点击生成；单来源仅保留 AI 录音卡时结果只引用录音证据，刷新后简报和结果可恢复，结果卡可进入内容系统，控制台无新增 error/warn。
- 聚合门禁：`pnpm.cmd qa:fast`、`qa:regression`、`qa:full` 均因 pnpm 注册表签名无法验证而在启动阶段失败；未跳过安全校验。结构、Skill 资产、Eval、三套 TypeScript 和本专项 smoke 已单独通过。
