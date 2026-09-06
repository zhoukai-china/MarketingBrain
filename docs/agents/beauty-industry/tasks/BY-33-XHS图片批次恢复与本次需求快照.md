# BY-33 XHS 图片批次恢复与本次需求快照

状态：已完成（2026-08-28）

## 归属

- 产品：美业智能体｜门店 AI 经营大脑
- 层级：美业通用核心；兰琪仅复用服务端品牌配置，不新增品牌知识或硬编码
- 风险：高（真实媒体批次、积分、租户、任务恢复）
- 预计修改热点：XHS Web 工作台、beauty-industry 媒体路由、专业选项合同、Web/WorkBuddy 适配、专项测试和产品质量文档
- 是否允许并行：否；BY-19/BY-20 继续 PAUSED

## 用户结果

每个成功保存的小红书文字任务拥有独立三图计划与一次确认资格；旧失败图片批次不会锁死新文字任务，用户还能在同页编辑仅属于本次任务的需求，并在明确修改和再次确认后为同一文字任务创建一个新批次。

## 本次范围

- 修复每租户历史图片总数错误充当单批上限的问题。
- 按 `AgentRun + batchRequestId` 隔离媒体批次，查询、顺序提交、结算和资产授权只作用于目标批次。
- `quality_failed` 后提供“修改本次图片要求后重新生成”显式路径；要求变化、费用和积分再次确认，禁止自动重试。
- 新增本次主题/目的、项目、顾客、城市/门店事实、角度/语气、三图视觉要求、明确事实与禁用内容编辑及任务快照展示；经营档案仅作默认值，不自动回写。
- Web 与 WorkBuddy 共用新增专业字段、租户和事实边界。

## 本次不做

- 不自动重试、补图、换模、追加第 4 张或绕过质量门禁。
- 不调用真实文本/图片/视频/ASR Provider；先完成零费用闭环。
- 不修改经营档案，除非用户以后从独立经营档案页面主动保存。
- 不恢复 BY-19/BY-20，不部署生产，不引用 WorkBuddy 候选运行资产。

## 验收条件

1. 正常路径：第二个新文字任务即使同租户已有 3 个失败/已退积分图片作业，也能正常报价并确认独立三图批次。
2. 失败恢复：同一文字任务最新批次 `quality_failed` 时默认不可再次调用；用户修改本次图片要求并再次确认后可创建唯一新批次，旧批次只读保留。
3. 幂等/账本：同一批次重复点击只建一个批次、一次预留；每批独立结算或释放，资产只对所属成功批次和租户开放。
4. 任务事实：文字与图片计划使用同一任务快照；历史/刷新显示保存时采用的信息，当前编辑不会回写长期经营档案。
5. 用户指引：按钮禁用时明确区分额度、授权、旧批失败、未确认、进行中、质量失败和服务失败。
6. 不应发生：旧失败批次锁死新任务；历史累计数触发单批额度；兰琪名称/知识进入通用核心；候选 Skill 运行引用；Provider 调用。

## 基线与失败证据

- 数据库脱敏审计：同租户首个文字任务已有 3 个媒体作业，批次终态 `quality_failed` 且 300 积分已退；第二个成功文字任务无媒体作业，却因租户历史计数 `3 + requested 3 > max3` 返回 `quota_exhausted`。
- 代码根因：`resolveReadiness()` 和媒体创建事务按租户累计 `lanqiMediaJob.count()`；媒体查询、提交、结算和资产授权又按整个 `runId` 合并所有作业，无法表达同一文字任务的后续显式新批次。
- 修复前红灯：`pnpm.cmd beauty-industry:xhs-media-retry-p1-smoke` 必须证明历史作业不应占用新批次单批额度、旧失败批次应允许“要求已变化”的显式新批次、未变化或并发重复仍失败关闭。

## 实现记录

- 通用核心 API：`apps/api/src/products/beauty-industry/media-batch.ts`、`xhs-task-snapshot.ts`、`profile.ts`、`execution.ts`、`mcp-adapter.ts`，以及 `apps/api/src/routes/beauty-industry-media.ts`、`beauty-industry.ts`。
- 通用核心 Web：`apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx`、`apps/web/src/components/acquisition/BeautyXhsWorkbench.tsx`、`apps/web/src/styles/beauty-industry.css`。
- 回归：`scripts/beauty-industry-xhs-media-retry-p1-smoke.ts`、`scripts/beauty-industry-real-media-smoke.ts`、`scripts/verify-beauty-xhs-controlled-browser-e2e.mjs`、根 `package.json`。
- 文档：本任务卡、`STATUS.md`、`TEST_MATRIX.md`、`tasks/README.md`、`docs/BUG_REGRESSIONS.md`。
- 数据/接口/配置变化：不做数据库迁移；使用现有 `parameters.batchRequestId` 作为批次键并兼容旧作业。
- 兼容性和回滚点：旧批次无新字段时按历史 `batchRequestId`/legacy 只读归组；旧 URL、Skill、AgentRun 与资产不重算。
- 品牌边界：上述运行修改全部属于 beauty-industry 通用核心，不含兰琪显示名、品牌知识或主题硬编码；租户品牌仍由既有服务端配置派生。

## 验证

- 红灯：用户租户脱敏审计证明首个任务 3 个图片作业已 `quality_failed/refunded`，第二个文字任务无图片作业却被租户历史 `3 + 3 > max3` 锁死；新增专项修复前因缺少批次域模块失败。
- 领域命令：`pnpm.cmd beauty-industry:xhs-media-retry-p1-smoke`、`beauty-industry:xhs-same-page-image-p1-smoke`、`beauty-industry:real-media-smoke`、`beauty-industry:image-persistence-observability-p1-smoke`、`beauty-industry:media-observability-smoke`、`beauty-industry:brand-package-p1-smoke` 均 PASS。
- 用户路径：`pnpm.cmd beauty-industry:xhs-controlled-browser-e2e` PASS，桌面1440/390px、双击单请求、保存/刷新、双租户、console=0、external provider=0；应用内浏览器亦验证本次字段、同一任务快照、长期档案未回写和横向溢出0。Chrome扩展在30秒内未连接，已失败关闭并改用仓库受控Chrome脚本，不重复等待。
- 类型与全量：API/Web/Agent typecheck、`pnpm.cmd qa:fast`、`pnpm.cmd qa:regression`、`pnpm.cmd qa:full`（含 build）均 PASS；`git diff --check` PASS。
- 环境：PG `55434/PID23096`、API `3016/PID3428`、Web `5176/PID15456`；source/runtime=`EEE6BE1D`、fresh=true、ready/database=true、Web200。最终 `text=controlled_mock`、`media=disabled/max0`，因此用户验收不会误触发付费图片；真实模式的确认资格与重试状态由零调用合同/Eval覆盖。
- 外部动作：真实文本/图片/视频/ASR Provider调用0、媒体确认点击0、费用¥0、未部署。

## 交接

- 残余风险：BY-33范围 P0/P1=0。受控预览环境会明确禁用真实图片按钮；如需再次验证真实三图，必须另行物化精确一次性授权，不能复用本轮。
- 邀请：记录 `cmtcln3nv00006l2z42sh9hwd`，product=`beauty-industry`、brand=`lanqi`、24小时、最多1次、usedCount=0；服务端只保存哈希，明文不入仓库/日志。
- 后续任务：本任务完成后由总调度安排；不得自行切换模块。
- 最后更新日期：2026-08-28
