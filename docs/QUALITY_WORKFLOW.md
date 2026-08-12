# 思潼 AI 增长 OS 开发、测试与迭代流程

## 目的

本流程把“开发者手动试一遍、发现问题、再告诉 Codex 修改”改造成可重复的质量闭环：

```text
需求与验收条件
  → 最小实现
  → 自动检查
  → 智能体 Eval / 业务回归
  → 页面真实操作
  → 缺陷分级
  → 失败测试
  → 最小修复
  → 全量回归
  → 测试环境放行
  → 小范围上线与监控
```

## 1. 需求进入开发

Codex 开始编码前必须输出可验证的验收条件：

- 用户完成什么核心任务。
- 正常结果是什么。
- 输入为空、错误、重复或超时时应该发生什么。
- 哪些行为绝不能发生，例如跨租户读取、重复扣费、编造客户事实、未经确认执行外部动作。
- 哪些检查通过后才能称为完成。

大需求拆成可以独立验收的小批次。每个批次完成一次测试闭环，避免最后集中发现大量相互影响的问题。

## 2. 修改前建立基线

根据改动范围运行最小相关检查，保存命令和结果。常用基线：

```powershell
pnpm qa:fast
pnpm qa:regression
```

若已有失败：

- 明确失败是否与本任务相关。
- 不把既有失败描述成本次修复完成。
- 与本任务相关时，先纳入本次验收；无关时记录为已知风险，不擅自扩大修改范围。

## 3. 开发中快速循环

每完成一个小改动：

1. 运行最窄的相关测试。
2. 运行相关类型检查或构建。
3. 对 Agent 改动运行相关 smoke/Eval。
4. 对 UI 改动刷新页面，检查控制台和网络请求。

不要等所有代码写完才第一次运行。

## 4. 统一命令

以下示例使用 `pnpm`。Windows PowerShell 若提示 `pnpm.ps1 cannot be loaded because running scripts is disabled`，改用 `pnpm.cmd`，例如 `pnpm.cmd qa:full`。不要修改系统执行策略来完成普通项目验证，也不要把该拦截误记为测试失败。

### 快速门禁

```powershell
pnpm qa:fast
```

包括：

- `pnpm lint:structure`
- `pnpm quality:assets`
- `pnpm quality:evals`
- `pnpm typecheck`

### 核心回归

```powershell
pnpm qa:regression
```

包括：

- `pnpm skill:smoke`
- `pnpm agent:smoke`
- `pnpm agent:input-smoke`
- `pnpm agent:orchestrator-smoke`
- `pnpm skill:mcp-resilience-smoke`

### 完整本地门禁

```powershell
pnpm qa:full
```

依次运行快速门禁、核心回归和全仓构建。它是跨模块修改、Bug 修复交付和发布准备的默认本地门禁。

### 领域专项测试

统一命令不能替代专项测试。按 `TEST_PLAN.md` 选择对应命令，例如：

```powershell
pnpm qa:takeaway
pnpm qa:franchise-acquisition
pnpm qa:lanqi-foundation
pnpm acceptance:acquisition-scenarios
pnpm agent:topic-system-smoke
pnpm agent:topic-research-smoke
pnpm agent:zhenshui-pilot-smoke
pnpm takeaway:data-smoke
pnpm takeaway:workbench-smoke
pnpm restaurant:diagnostic-smoke
pnpm content-system:batch-smoke
pnpm content-system:display-smoke
pnpm delivery:smoke
pnpm branding:smoke
pnpm channels:smoke
pnpm invite:redemption-smoke
pnpm invite:concurrency-smoke
```

三个产品的自动分流、任务卡和交接规则见 `docs/agents/AGENTS.md`，单人使用方式见 `docs/SOLO_AGENT_DEVELOPMENT.md`。`qa:lanqi-foundation` 当前只验收蓝旗产品与知识治理基础文件；在蓝旗生产模块落地后，必须把对应代码回归继续加入该命令，不能将基础文件通过表述为产品已完成。

需要运行中的 API、令牌、外部服务或生产式环境的命令，必须先确认目标环境。不得为了让测试通过而指向真实客户数据或执行真实付款、投放、发布。

## 5. 智能体 Eval 规则

每个 Agent/Skill 的测试集至少包含：

- 典型成功案例。
- 缺字段与模糊需求。
- 错误格式、超长输入和冲突事实。
- 工具成功、工具失败、超时、取消、部分失败。
- 越权、提示注入、敏感数据和跨租户尝试。
- 禁止承诺、禁止编造、禁止未经确认执行。
- 与历史真实 Bug 对应的回归案例。

断言优先检查可验证契约：路由、工具、参数、结构、必填内容、禁止内容、引用或依据、状态和副作用。主观质量可采用评分器，但不能用主观评分替代确定性业务规则。

对高风险非确定性案例重复至少 3 次。任何一次出现严重越权、编造、串数据或错误执行，都视为失败并调查，不以平均分掩盖。

## 6. 页面自动 QA

对每个核心用户旅程，Codex 应使用浏览器自动化或 Computer Use：

1. 从干净测试账号和明确环境开始。
2. 按 `TEST_PLAN.md` 执行主路径。
3. 补充空输入、重复点击、返回、刷新、超时、断网和权限不足。
4. 记录复现步骤、预期、实际、截图、控制台错误和失败请求。
5. 非阻塞问题继续测试，不要在第一个小问题处停止。
6. 最终按 P0-P3 输出缺陷清单和覆盖范围。

稳定的人工路径应逐步转成自动 E2E。每次只靠人工重复点击同一路径，说明该路径还欠自动化债务。

## 7. Bug 修复和回归

Bug 单必须具备：环境、版本、前置状态、复现步骤、输入、预期、实际、严重程度、证据。

修复顺序固定为：

```text
复现 → 失败测试 → 根因 → 最小修复 → 新测试通过 → 相邻回归 → 全量门禁 → 登记台账
```

每个已修复 Bug 都登记到 `BUG_REGRESSIONS.md`。如果暂时只能人工验收，应记录自动化缺口和补齐计划。

## 8. 发布前验收

发布候选必须满足：

- `pnpm qa:full` 通过。
- 受影响领域专项测试通过。
- 测试环境核心页面和 API 路径通过。
- 无开放 P0/P1。
- P2/P3 有明确记录，不隐藏。
- 生产环境配置使用明确 env 文件完成：

```powershell
pnpm prelaunch:check -- --env <生产式配置文件路径>
```

- 完成备份，写清部署步骤、健康检查、回滚条件和回滚命令。

`prelaunch:check` 是配置预检，不替代 `/ready`、`/ops/launch-check`、真实模型 smoke、微信能力检查、租户隔离和页面验收。

## 9. 上线后迭代

- 小范围发布，先观察测试租户或内部账号。
- 监控 API 错误、模型/工具失败、耗时、重复扣费、质量失败、用户反馈和异常日志。
- 重复问题合并，按 P0-P3 排序；观察事实和推测分开。
- 每个线上 Bug 先转成脱敏回归案例，再修复。
- 每次迭代只改变一个主要变量，保留基线、测试期、护栏、止损线和回滚点。

## 10. 人工只做什么

自动化通过后，人工重点验收：

- 产品是否真正解决用户问题。
- 业务建议是否符合现实和品牌判断。
- 用户是否看得懂、愿意用、能执行。
- 风险、价格、服务边界和外部动作是否符合经营决策。

机械点击、重复复现、类型检查、格式契约、历史 Bug 回归和证据整理应优先由 Codex 和自动化完成。

## 11. 长期质量学习闭环

智能体上线后的反馈、结果事件、每日评分、失败聚类、Eval 草稿、候选评审、灰度和回滚统一执行 `CONTINUOUS_IMPROVEMENT.md`。每日任务不等于自动发布：任何 Prompt、Skill、路由、工具、知识或代码变更仍需独立验收和人工放行。
