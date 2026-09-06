# FIP-04 选题结果到内容草稿闭环

状态：已完成

## 归属

- 产品：创始人 IP 获客系统
- 层级：产品专用
- 风险：高（四目标上下文、租户隔离与内容事实边界）
- 预计修改热点：FIP 选题/内容工作台、FIP 专属草稿服务与专项回归
- 是否允许并行：不与修改公共 Agent 路由、共享导出或兰琪 LQ-09 的任务并行；避免 `packages/shared/src/index.ts`、`packages/skills/src/index.ts`、`packages/agent/src/index.ts`、`apps/api/src/services/agent-definitions.ts`

## 用户结果

用户从本轮选题结果选择一个选题，进入内容系统后得到带完整获客上下文、可编辑、可保存并可恢复的内容草稿；草稿只提供进入投流系统的预览入口，不执行投放、发布、付款或其他外部动作。

## 本次范围

- 选择一个选题并携带当前获客目标、获客目标简报、题目/钩子、目标人群、来源依据与事实边界、获客关系进入内容系统。
- 基于已确认上下文调用现有内容能力生成可编辑、可保存、可恢复的内容草稿。
- 支持回到选题系统重新选择，四个目标、主体和租户严格隔离。
- 缺少关键素材时一次性列出待补，不输出虚假的完整成品；投流只给 PREVIEW_ONLY 入口。

## 本次不做

- 不重构整个内容系统，不接入投流执行、发布、付款或直播链路。
- 不引入兰琪、外卖或其他租户的知识、方法论和资料。
- 不修改四个共享热点；如实现证明必须修改，先停在安全点报告。

## 验收条件

1. 正常路径：四个获客目标各自选择选题后，内容草稿保留全部上游字段；同题在不同目标下的受众、CTA 和承接动作不同。
2. 失败路径：选题上下文或关键素材缺失、服务错误/超时、重复点击、刷新恢复与返回重选均有明确、可恢复的状态。
3. 不应发生：跨目标、跨主体或跨租户串数据；把未核验热点、案例、收益或数字写成事实；自动投流、发布、付款或外部执行。
4. 可观测结果事件：选题被选择、草稿生成、草稿保存、草稿恢复、继续投流预览；事件不含客户原文或敏感资料。

## 基线与失败证据

- 基线命令：`node scripts/founder-ip-topic-workbench-smoke.mjs`、`pnpm.cmd content-system:display-smoke`、页面真实操作。
- 修复前失败测试/Eval：待先复现“进入内容系统仅导航、未携带选题和获客目标简报”的断点后新增。
- 现象、根因和连带影响：待定位；不得以通用批量内容提示替代已确认的选题上下文。

## 实现记录

- 修改文件：`TopicSystemWorkbench.tsx`、`ContentSystemWorkbench.tsx`、`founderIpContentDraft.ts`、`AgentProductsApp.tsx`、`apps/api/src/routes/agents.ts`、`apps/api/src/services/founder-ip-content-drafts.ts` 与 FIP 专项 smoke。
- 数据/接口：新增受租户保护的 FIP 内容草稿创建、读取、保存接口；生产模式复用 `Conversation + Message` 持久化，demo 模式使用当前租户键控临时数据。
- 交付门禁：最终内容必须保留当前选题、目标人群、线索目标；待验证来源不得被扩写为完整成品，跨目标 CTA 一律退回事实受控的待补草稿，并阻断投流预览。
- 兼容性和回滚点：保留旧 `agent_acquisition` 会话和通用内容入口；FIP 通过 `fipDraft` 查询参数独立进入，可单独回退。

## 验证

- 修复前失败证据：`scripts/founder-ip-content-draft-closure-smoke.ts` 与 `scripts/founder-ip-content-delivery-quality-smoke.ts` 分别在缺少选题上下文链路、缺少最终交付门禁时失败。
- 专项：两项上述 smoke、`pnpm.cmd qa:founder-ip-acquisition` 均 PASS。
- 质量门禁：`pnpm.cmd qa:fast`、`pnpm.cmd qa:regression`、`pnpm.cmd qa:full` 均 PASS。
- 页面/E2E：本机桌面与 390px 移动端实际完成选题进入内容、错目标旧内容拦截、待补草稿保存、刷新恢复、返回入口和控制台检查；控制台无新增应用 error/warn。
- 已知服务降级：本地实际内容 Skill 曾返回旧通用“到店”内容；页面已在最终交付层阻断该结果并改为事实受控待补草稿，不允许保存错误成品或进入投流预览。

## 交接

- 残余风险：现有内容系统是通用批量输入，默认不能证明四目标/证据上下文可达；本任务以最小 FIP 专属闭环修复。
- 后续任务：`FIP-05` 投流和渠道预览、`FIP-06` 分目标承接与转化、`FIP-07` 结果回填与复盘。
- 最后更新日期：2026-08-14。
