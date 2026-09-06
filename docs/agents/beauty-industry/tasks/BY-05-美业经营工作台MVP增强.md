# BY-05 美业经营工作台 MVP 增强

状态：已完成，等待用户验收

## 归属

- 产品：美业智能体
- 层级：产品专用，复用现有共享 TenantProfile、Agent/Skill、MCP、entitlement 与账本
- 风险：高
- 预计修改热点：美业产品 profile 服务与路由、统一执行上下文、美业获客页面、美业专项 contract/E2E；原则上不改 Schema 和共享计费/MCP 热点
- 是否允许并行：否

## 用户结果

用户在同一个美业经营工作台确认门店档案、看到今天最多 3 项经营动作，以快速或专业模式连续完成“目标→选题→内容→投流/直播准备→复盘→下一步”；WorkBuddy 与网页读取同一份受控资料和任务记录。

## 本次范围

- 可配置细分赛道：皮肤管理、美发、美甲美睫、头疗养发、生活美容、医疗美容；医疗美容与生活美容显式区分，不能由模型猜测。
- 保存用户确认的品牌/门店名称、城市、服务项目、目标顾客、渠道、当前获客目标和事实边界；记录来源、确认状态和版本。
- 快速模式默认使用“一句需求 + 已确认门店档案”；专业模式只展开获客目标、受众、平台、内容结构、拍摄/EDL、投流预览和配图数量等必要参数。
- 两种模式调用相同 Agent/Skill/事实、entitlement 与账本；网页和 `beauty-industry` MCP 在同 tenant/product/operatingEntity 下读取同一资料。
- 资料可查看、修改和删除；未确认推断不得晋升为门店事实。
- 结果提供“选题 → 内容 → 投流预览 → 视频/直播复盘”下一步，不自动发布、投放、付款或发消息。
- 首页显示最多 3 项“今日经营动作”、上次任务进度、最近结果和建议下一步；这些只是状态驱动的建议，不冒充模型已执行动作。
- 首页保留美业 AI 改造日报、美业知识问题、美业获客、美业销售、美业专属交付、美业专属经营诊断六模块；仅美业获客开放，其余明确标注规划中/暂未开放且不可点击。

## 本次不做

- 不做销售陪练、沉睡顾客唤醒、Chat BI、多店看板、客户全生命周期、收银/预约/库存/提成/分账或摄像头巡店。
- 不自动采集企微、朋友圈、订单、会员、客户聊天等敏感数据。
- 不做兰琪品牌版、其他行业版、新定价、完整支付/充值后台、生产部署或真实媒体质量扩展。
- 不重新设计已确认页面，不增加虚拟员工头像，不复制网页/MCP Prompt。
- 不做六角色式 Agent 重构、顾客级动态记忆或多门店对比。

## 验收条件

1. 正常路径：确认门店档案后，首页给出最多 3 项今日动作；快速模式只输入一句需求即可生成，专业模式可增补参数；刷新、返回、网页与 MCP 都恢复同一受控资料和结果契约。
2. 失败路径：缺档案、错误细分赛道、资料删除、网络失败、超时/取消、余额不足和 Provider 失败均有明确终态，不晋升推断、不重复扣费。
3. 不应发生：生活美容/医疗美容混淆、跨门店/跨租户资料泄露、参数伪造身份、删除后仍注入旧档案、快速/专业两套 Prompt、自动发布/投流/付款/发消息。
4. 可观测结果事件：档案保存/删除记录 tenant/product/operatingEntity、版本、来源和确认状态；运行记录保持 channel/capability/credential/积分/幂等信息，不记录客户敏感原文。

## 基线与失败证据

- 完成基线：BY-04 原 8 案例 8/8 PASS、硬失败 0；`qa:fast`、`qa:regression` PASS。
- 修复前失败测试/Eval：当前网页只有每次手填 `confirmedFacts`，没有产品级门店档案、细分赛道、快速/专业模式或可删除共享记忆；MCP 输入也不会自动恢复已确认档案。
- 现象、根因和连带影响：现有统一执行链和 TenantProfile 可复用，但美业产品缺少受控 profile 适配层和页面交互；若直接拼接客户端字段，会导致网页/MCP 不一致和跨入口事实漂移。

## 实现记录

- 修改文件：
  - 产品资料与共享运行上下文：`apps/api/src/products/beauty-industry/profile.ts`、`execution.ts`、`mcp-adapter.ts`。
  - 产品接口：`apps/api/src/routes/beauty-industry.ts`、`apps/api/src/routes/workbuddy-mcp.ts`。
  - 页面：`apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx`、`apps/web/src/styles/beauty-industry.css`。
  - 产品名称：`packages/shared/src/index.ts`、`apps/api/src/services/agent-definitions.ts`；共享运行构建由 `@baolu/shared build` 与新增同步回归守护。
  - 专项：`scripts/beauty-industry-profile-memory-smoke.ts`、`beauty-industry-profile-database-smoke.ts`、`beauty-industry-web-contract-smoke.mjs`、`beauty-industry-mcp-contract-smoke.ts`、`verify-beauty-industry-live-mcp.ts`。
- 数据/接口/配置变化：优先在现有 `TenantProfile.confirmedData` 下加法保存 product-scoped 美业资料；不新增迁移。
- 兼容性和回滚点：旧获客接口和历史记录保持兼容；删除美业 profile 子对象可回滚，不影响其他产品 profile 数据。
- 用户结果：经营档案支持单店/连锁、经营阶段、六类细分赛道和用户确认事实；首页给出最多 3 项今日动作；快速/专业模式进入同一执行服务；网页/MCP 历史共用 AgentRun、账本与租户身份；只有美业获客开放。

## 验证

- 领域命令：profile 内存/隔离数据库、网页/MCP contract、平台 smoke、BY-04 P1 smoke 与保存结果零费用重放均 PASS；重放 8/8、硬失败 0、Provider 调用 0。
- `pnpm.cmd qa:fast`：PASS。
- `pnpm.cmd qa:regression`：PASS。
- `pnpm.cmd qa:full`：PASS；本阶段按额度策略只执行一次最终全量门禁。
- 页面/E2E：桌面与 390×844 实际页面 PASS；经营档案、最多 3 项今日动作、快速/专业、下一步只切换不执行、刷新恢复、断网明确终态与重载、旧结果保留、登录名称及控制台检查 PASS。
- MCP/E2E：隔离持久数据库上的真实 HTTP MCP `tools/list/tools/call` PASS；8 个工具可发现，3 次 MCP 与 1 次网页调用共用产品执行链，`paid_provider_calls=0`，secret 未输出。
- 删除/隔离：精确合成租户数据库 smoke 验证 A/B 不串资料、删除 A 不影响 B 或其他 TenantProfile 字段；浏览器未替用户点击破坏性删除确认。
- 未运行项：WorkBuddy 桌面应用原生配置、真实文本/媒体 Provider、生产迁移/部署/支付；协议层已由真实 HTTP MCP 客户端覆盖，页面受控 mock 明示不代表正式模型质量。

## 交接

- 残余风险：本地验收内容使用受控 mock；正式模型质量沿用 BY-04 `deepseek-v4-pro` 8/8 基线，本任务没有新增 Provider 费用。真实 WorkBuddy 桌面配置与生产环境仍未执行。
- 后续任务：完成到无 P0/P1 后停在用户验收，不自动进入兰琪品牌版或其他板块。
- 最后更新日期：2026-08-22
