# BY-04 美业 Skill 输出质量 P1 闭环

状态：完成

## 归属

- 产品：美业智能体
- 层级：产品任务含必要的最小共享运行时修复
- 风险：高
- 预计修改热点：美业正式 Skill/contract/Eval、产品适配器；仅在根因证明确需时最小修改 Agent 结构化输出与事实保留逻辑
- 是否允许并行：否

## 用户结果

同一组 8 个代表性美业业务场景全部得到行业正确、事实完整、可直接使用且安全合规的结果，再交给用户做一次最终业务验收。

## 本次范围

- 原样保留 BY-03 Champion、8 案例失败证据与累计估算费用 ¥0.2765。
- 闭环选题空结果、小红书虚构体验和缺 3 张配图方向、生活美容误分美甲、投流截断、直播串带货/餐饮、复盘丢字段六类 P1。
- 先按实际运行链定位 Skill、Agent 路由、结构化解析、finish reason、fallback 和测试夹具责任，再按最少根因单变量修复。
- 先跑零费用确定性回归；确需真实文本复测时只使用 `deepseek-v4-pro`，本任务与 BY-03 合计估算成本不得超过 ¥1。
- 重新生成 6–8 案例业务验收包，Codex 先按统一 rubric 筛选。

## 本次不做

- 不删除、放宽或改写 BY-03 失败 Eval 和硬门禁。
- 不使用 Flash、低端模型或固定模板冒充专业理解。
- 不调用图片/视频 Provider，不充值、不自动重试、不发布、不投流、不付款、不部署。
- 不恢复 BY-01/BY-02 功能开发或页面改版，不启动兰琪品牌版。

## 验收条件

1. 正常路径：原 8 案例在行业专业度、事实边界、直接可用、获客目标、合规、品牌/租户中立六维全部达线。
2. 失败路径：资料不足、模型超时/截断、Provider 失败和结构缺失必须明确终态，不返回空白、半截结果或跨行业模板。
3. 不应发生：空结果、截断、静默丢字段、皮肤管理误判美甲、直播串餐饮/电商、第一人称虚构体验、价格疗效案例编造、越权执行、跨租户/品牌泄露。
4. 可观测结果事件：记录 case id、Skill/tool/capability、模型、finish reason、延迟、token 与费用聚合；不记录思维链、密钥或客户原始资料。

## 基线与失败证据

- 基线命令：`pnpm.cmd beauty-industry:output-quality-eval -- --input reports/beauty-industry/BY-03-live-results.json`（以当前 package 脚本实际入口为准）。
- 修复前失败测试/Eval：BY-03 8 案例 0 个可无判断直接使用；6 类 P1 见 BY-03 任务卡和验收包。
- 现象、根因和连带影响：当前已确认 finish reason/结构终态、美业子行业约束、通用直播模式和 CSV 字段识别均存在责任点；仍需以精确回归区分生产链与 Eval harness 后再修改。

## 实现记录

- 修复前确定性回归：`scripts/beauty-skill-output-quality-p1-smoke.ts` 先稳定复现 10 个断言红灯，覆盖六类 P1；修复后同一命令 PASS。
- 单变量根因：图片/投流截断未失败关闭；美业选题/小红书完整性缺少受控返工；完整短视频执行包被关键词误路由到拍剪；生活美容 fallback 被宽泛“美业”规则误判为美甲；直播通用节奏表带入购买/核销；视频 CSV 未识别 3 秒留存与私信咨询别名。
- 修改文件：`apps/api/src/services/domestic-chat-provider.ts`、`packages/agent/src/index.ts`、美业 `content-diff/xhs` Skill 三件套、`scripts/beauty-skill-output-quality-p1-smoke.ts`、`scripts/beauty-skill-output-quality-eval.ts`。
- 零费用 8 案例预检：8/8 无硬失败，Provider 调用 0，版本已恢复为 `content-diff/xhs 1.1.0`。
- 真实 Pro 复测调用前上限：本轮以 `--cost-ceiling 0.72` 执行；加 BY-03 已估算 ¥0.2765 后总最坏上限 ¥0.9965，不自动重试。
- 数据/接口/配置变化：不计划迁移或生产配置变化。
- 兼容性和回滚点：每个根因单变量提交语义；美业专属改动可独立回退，共享运行时改动须保留相邻行业回归。

## 验证

- 修复前红灯：`node apps/api/node_modules/tsx/dist/cli.mjs scripts/beauty-skill-output-quality-p1-smoke.ts` 稳定得到 10 个失败断言，覆盖原 6 类 P1；相同命令修复后 PASS。
- 零费用确定性闭环：同一 8 案例通过当前生产路由、结构化收口与安全门禁，8/8 PASS，硬失败 0。
- 真实 `deepseek-v4-pro` 复测：BY-04 共 12 次文本 Provider 调用，三批估算费用分别为 ¥0.2085、¥0.0677、¥0.1324，合计 ¥0.4086；与 BY-03 的 ¥0.2765 合计 ¥0.6851，低于 ¥1 硬上限。媒体调用 0，未自动重试、充值、发布、投流、付款或部署。
- 最终同批验证：`BY-04-final-8-case-results.json` 使用已付费结果经当前生产最终化逻辑零费用重放，8/8 PASS、硬失败 0；该重放不是新的 Provider 质量调用。
- 专项：`beauty-skill-output-quality-p1-smoke.ts`、`beauty-skill-output-quality-eval.ts`、`quality:assets`、`agent:smoke`、`fip:self-mcp-timeout-smoke`、美业 8 类×3 policy Eval、MCP contract、网页 contract 均 PASS。
- `pnpm.cmd qa:fast`：PASS。
- `pnpm.cmd qa:regression`：PASS。
- `git diff --check`：PASS；仅报告工作树既有行尾警告，无空白错误。
- `pnpm.cmd qa:full`：本任务未单独运行。按 28% 额度策略，保留到“美业可验收 MVP”完成后只运行一次最终全量门禁；因此 BY-04 的结论限定为输出质量 P1 已关闭，不等同于完整 MVP 已交付。
- 页面/E2E：本任务没有改版面；真实网页与 WorkBuddy 的最终 E2E 归入下一张美业 MVP 任务，不以裸 Prompt 结果冒充页面验收。

## 交接

- 残余风险：最终业务验收仍需用户判断“像不像美业、能否直接使用”；网页/WorkBuddy 完整路径与最终 `qa:full` 尚未在本任务执行。后续不得再以这 8 案例自动扩大通用行业方法论。
- 后续任务：独立启动 BY-05“美业 MVP 易用性与行业记忆增强”，复用本任务完成基线；不得在 BY-04 中继续编码。
- 最后更新日期：2026-08-22
