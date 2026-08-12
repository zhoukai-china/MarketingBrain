# 思潼独立 Agent 产品架构

## 产品入口

- `/p/acquisition`、`/p/sales`：公开营销页和一次免登录体验。
- `/agents/acquisition`、`/agents/sales`：已开通客户的独立 Agent 工作区。
- `/my-ai`：企业拥有多个 Agent 时的增长飞轮。
- `/account`：企业档案、成员 Agent 权限、积分和订单。
- `/internal`：Agent 上下架、Skill 版本、Offer 和手工开通。
- `/internal/legacy`：仅保留给内部使用的旧工作台。

匿名用户完成一次任务后，登录认领结果会获得该 Agent 的 24 小时体验权益；体验输入和结果会进入同一个企业会话，之后再由 Offer 升级为正式权益。设备只能领取一次匿名完整任务，同一网络另有频率限制。

## 正式执行链

```text
Agent page
  -> POST /agents/:slug/runs
  -> Agent entitlement and member access check
  -> shared semantic router creates one or more capability ids
  -> execution plan (single / parallel / sequential / hybrid)
  -> MCP sitong_skill.invoke
  -> version-pinned SKILL.md snapshot
  -> domestic LLM
  -> quality check
  -> deterministic synthesis and partial-failure handling
  -> conversation, AgentRun, AgentRunStep and shared credit transaction
```

任务卡片固定命中一个能力。自由提问只能在当前 Agent 的 `AgentSkillBinding` 白名单中路由。单一需求只执行一个主 Skill；用户明确要求多个独立交付时，路由器最多生成三个执行步骤。独立步骤并行执行，存在前置依赖时串行执行，例如“行业热点→内容创作”。单个步骤失败时保留其他成功结果，并在最终答案与步骤记录中标记未完成项。

语义路由规则只维护在 `@baolu/shared`。前端可用同一函数做任务提示，但服务端始终重新判断并作为最终路由权威。执行计划、依赖调度、结果组合和部分失败降级统一由 `agent-orchestrator` 完成，不再写在具体页面或单个 Skill 中。

每次组合任务保存一条 `AgentRun` 和多条 `AgentRunStep`。子步骤分别记录 capability、Skill版本、依赖、输入、输出、耗时、积分、质量标记和错误码，避免只记录第一个 Skill。同一租户、同一 Agent 使用相同 `requestId` 重试时直接回放整次任务及步骤状态，不重复执行或扣费；请求编号若被其他租户或其他 Agent 占用则返回 `409 request_id_conflict`。

## 上线步骤

1. 备份生产数据库。
2. 执行 `pnpm --filter @baolu/db prisma:deploy`。
3. 设置 `SKILL_MCP_URL`、强随机 `SKILL_MCP_TOKEN`、`SKILL_MCP_REQUIRED=true` 和覆盖完整深度任务的 `SKILL_MCP_INVOKE_TIMEOUT_MS`（默认 420000）。
4. 重启 API。首次安装产品目录时会建立两个 Agent、不可变 Skill 版本快照和草稿 Offer，并仅在这一次给当时已有的有效客户发放两个首发 Agent；之后新注册客户不会被自动赠送。
5. 访问 `/internal`，确认 Offer 价格、积分和有效期后才切换为“上架”。
6. 运行 `pnpm agent:smoke`、`pnpm agent:input-smoke`、`pnpm agent:orchestrator-smoke`、`pnpm skill:mcp-resilience-smoke`、`pnpm typecheck`、`pnpm build`和 `pnpm prelaunch:check`。

## 兼容性

旧 `/chat` 中的 `ip_acquisition_agent` 会转发到新的 Agent/MCP 执行链。旧会员、积分、企业档案和历史会话保留；新会话会额外记录 `agentId`，确保不同 Agent 之间不串会话。

客户工作区默认处于“自由提问”，只有主动点击任务卡片时才固定调用卡片 Skill。会话列表和消息恢复都按 `agentId` 过滤，获客与销售不会互相读取聊天记录。

## Skill 发布和回滚

- `POST /admin/skill-releases`：创建带哈希的不可变草稿版本。
- `POST /admin/skill-releases/:releaseId/test`：用内部测试账号执行并查看质量标记，不扣客户积分。
- `POST /admin/agents/:agentId/skill-releases/:releaseId/activate`：原子切换 Agent 白名单绑定和相关任务卡片。选择任意历史版本调用同一接口即完成回滚。

API 启动只补齐缺失的初始绑定，不会覆盖已经人工发布或回滚的版本。
