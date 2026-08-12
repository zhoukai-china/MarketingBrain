# 思潼 AI 智能体持续学习与受控迭代

## 目标与边界

本系统让智能体根据真实使用证据持续发现问题、沉淀评测、提出改进候选，并通过受控发布逐步变好。这里的“学习”不是让模型每天直接修改自身权重或线上提示词，而是持续改进以下可审计资产：

- Eval 与历史 Bug 回归集；
- Skill 契约、提示词、路由、工具参数和降级策略；
- 知识库内容、事实依据和缺失数据处理；
- 代码、监控、超时、幂等和权限护栏；
- 被人工确认的长期业务规则。

生产环境永远禁止 `CONTINUOUS_IMPROVEMENT_AUTO_ACTIVATE=true`。每日任务只能生成证据、草稿和候选，不能自行改线上版本、发布内容、投放、付款或修改生产配置。

## 证据来源

### 1. 用户明确反馈

`POST /agent-runs/:agentRunId/feedback` 支持 `rating`、`issueType`、`reasonCodes`、`note` 和可选 `feedbackKey`。反馈至少包含一个真实反馈字段；前端使用 `feedbackKey` 幂等更新同一次评价，避免刷新或重试放大评分。接口先验证当前租户对 `AgentRun` 的所有权，租户 A 不能给租户 B 的运行写反馈。

### 2. 真实使用结果

`POST /agent-runs/:agentRunId/outcomes` 接受受控事件：

- 正向或中性：`output_viewed`、`copied`、`downloaded`、`continued`、`task_completed`、`business_outcome_positive`；
- 需要调查：`edited`、`regenerated`、`abandoned`、`business_outcome_negative`。

单一行为不能直接证明输出好坏。例如复制可能只是为了转发错误结果，编辑也可能只是改语气。因此行为信号只占综合评分的一部分，不能覆盖硬门禁。

结果事件可携带 `eventKey` 做幂等去重。`metadata` 只允许产品界面、动作、结果码、耗时、编辑比例和分桶业务指标等白名单字段，并拒绝邮箱、手机号和常见密钥内容。主智能体页面已经接入“有帮助/有问题”及细分原因、下载、继续执行和重新生成信号。

### 3. 系统确定性证据

每日复核读取运行状态、错误、质量标记、用户反馈和结果事件，输出确定性分数、反馈分数、行为分数、综合分数、问题类别和硬门禁结果。

跨租户、数据泄露、密钥泄露、未经授权的付款或发布、编造事实等属于硬失败。无论平均分或用户评分多高，都不能被抵消。

## 每日自动闭环

```text
真实运行与反馈
  -> 确定性评分和硬门禁
  -> 重复失败聚类
  -> 脱敏 Eval 草稿
  -> 改进候选（等待人工评审）
  -> 离线 Eval / 回归
  -> Challenger 实验
  -> 小流量灰度
  -> 达标后人工发布，异常即回滚
```

每日任务具有以下安全属性：

- 同一天、同一范围重复执行会 upsert，不重复堆积快照、候选和 Eval 草稿；
- 总样本不足时，普通单例问题只进入报告，不生成修改候选；重复问题达到门槛后才进入候选；
- 严重安全问题不等待样本量，立即生成待评审候选；
- 报告不包含原始输入、原始输出、反馈备注或客户标识；
- Eval 草稿只保存在受控数据库中，手机号、邮箱、身份证号和常见密钥字段会先脱敏；
- 草稿必须经人工复核后才能成为正式 Eval；
- 候选默认 `awaiting_review` 且 `requiresHumanApproval=true`。

## 命令

### 纯函数专项回归

```powershell
pnpm.cmd quality:continuous-smoke
```

该命令使用合成数据，不连接客户数据库、不调用模型、不修改任何环境。

### 只读每日演练

```powershell
pnpm.cmd quality:daily
pnpm.cmd quality:daily -- --date 2026-08-09
```

需要 `DATA_MODE=database` 和可读数据库连接。它读取前一个上海自然日或指定日期，生成本地脱敏报告，但不写质量表。

### 写入每日质量库

先在测试环境设置：

```dotenv
CONTINUOUS_IMPROVEMENT_ENABLED=true
CONTINUOUS_IMPROVEMENT_AUTO_PERSIST=true
CONTINUOUS_IMPROVEMENT_AUTO_ACTIVATE=false
CONTINUOUS_IMPROVEMENT_MIN_SAMPLE=10
```

再执行：

```powershell
pnpm.cmd quality:daily:apply
pnpm.cmd quality:daily:apply -- --date 2026-08-09
```

不要在未执行数据库迁移、未备份或未完成测试环境验收时开启生产定时任务。

## 建议调度

测试环境稳定运行至少 7 天后，可让系统调度器每天上海时间 02:30 执行 `pnpm quality:daily:apply`。生产部署使用 `baolu-quality-daily.timer` 调度 `baolu-quality-daily.service`，日志进入 systemd journal。调度器必须保存退出码、标准输出和告警；失败可以重跑，因为任务是幂等的。

代码仓库只提供可调度命令，不会自动创建服务器 Cron 或 Windows 计划任务。是否开启生产调度属于生产变更，必须单独确认。

## 管理接口

所有接口都要求管理员令牌：

- `GET /admin/continuous-improvement/latest`：最近快照、失败聚类和候选；
- `GET /admin/continuous-improvement/candidates?status=awaiting_review`：候选列表；
- `GET /admin/continuous-improvement/eval-drafts`：脱敏 Eval 草稿；
- `POST /admin/continuous-improvement/candidates/:candidateId/decision`：只允许 `approve_for_evaluation` 或 `reject`。

批准只把候选改为 `approved_for_evaluation`，不会修改 SkillRelease、提示词、路由、模型或生产流量。

## 候选发布门禁

候选必须依次通过：

1. 人工确认失败聚类和根因，不把相关性误当因果；
2. 将脱敏草稿整理为可验证 Eval；
3. 保持 Champion 不变，只在 Challenger 修改一个主要变量；
4. 运行相关专项测试、`pnpm qa:full` 和历史回归；
5. 硬门禁零失败，目标指标有统计意义，护栏指标不退化；
6. 人工批准后只给内部账号或小流量灰度；
7. 观察错误率、低分率、硬失败、成本、耗时和业务完成率；
8. 达标后人工扩大范围；任一止损线触发即回到 Champion。

建议最低护栏：

- 安全、越权、泄露、编造和错误执行：必须为 0；
- 核心历史回归：100% 通过；
- 综合质量分不得低于 Champion；
- P95 耗时、失败率和单次成本不得超过预设上限；
- 业务完成率和用户负反馈率至少一个改善，另一个不得明显退化。

## 数据治理

- 报告目录 `reports/continuous-improvement/` 已加入 `.gitignore`，禁止提交；
- 不把反馈备注、客户原文或模型原文发送到第三方评测服务；
- 管理接口不返回原始运行内容；
- Eval 草稿转正式用例前必须再次检查隐私、事实和权限；
- 为快照、事件、草稿和实验记录设置数据库保留期与删除策略，遵守客户合同和适用法规；
- 任何从单个客户学到的业务偏好默认只属于该租户，不能未经确认提升为全局规则。

## Codex 每次开发时的责任

涉及智能体、Skill、路由、工具、知识或提示词时，Codex 必须：

1. 先定义成功、失败和硬门禁；
2. 确认功能会留下可评测的 `AgentRun`、结构化质量标记和必要结果事件；
3. 新 Bug 或稳定负反馈先转成脱敏回归，再修改实现；
4. 修改前保存 Champion 基线，修改后用同一批 Eval 对比；
5. 一次只改变一个主要变量；
6. 输出证据，不凭“感觉更聪明”宣布优化；
7. 不自动激活候选，不绕过人工确认、灰度和回滚。

## 当前实现的刻意限制

- v1 使用确定性规则、用户反馈和行为信号，不用 LLM 自己给自己打最终分；
- 尚未自动把草稿并入 `packages/agent/evals`，避免未经复核的数据污染回归集；
- 尚未自动创建或分配生产灰度流量；
- 尚未自动修改 Prompt、Skill、知识库或代码；
- 业务结果事件需要产品端在真实完成点主动上报，不能仅靠“用户打开过页面”推断成功。

这些限制用于防止反馈回路、奖励投机、样本污染和不可回滚的线上自我修改。
