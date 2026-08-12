# Bug 回归台账

| QA-20260812-014 | 2026-08-12 | P1 | IP positioning | Interview output containing multiple questions was rendered as a completed IP report. Root cause: a keyword-and-question-mark UI heuristic and a permissive interview quality bypass. Regression: `scripts/ip-positioning-workbench-smoke.mjs` (failed before fix). Verification: `node scripts/ip-positioning-workbench-smoke.mjs` PASS; `pnpm.cmd qa:full` PASS. Status: Closed. |
| QA-20260812-019 | 2026-08-12 | P1 | 品牌获客 / 选题系统 | 品牌获客任务地图把 IP 定位设为进入选题的必经步骤；资料不足的用户无法直接得到可执行选题，且选题请求没有显式收集本轮获客目标。 | 工作地图与页面入口把旧 IP 定位能力置于主流程；选题系统仅依赖资料和行业，缺少身份、目标客户与本轮获客目标的任务输入契约。 | `scripts/topic-brief-workbench-smoke.mjs` 先在旧实现失败，断言 Brief、页面传参、品牌获客地图和能力列表均不再暴露 IP 定位；`scripts/agent-work-map-smoke.ts` 覆盖新工作地图。 | `node scripts/topic-brief-workbench-smoke.mjs` PASS；`pnpm.cmd agent:work-map-smoke` PASS；`pnpm.cmd agent:smoke` PASS；前后端 typecheck PASS。完整回归与页面验收待执行。 | 待回归 |
| QA-20260812-021 | 2026-08-12 | P1 | 企业知识库 / 选题系统 | 选题页自动带入同一企业内其他资料夹的录音，运行接口随后以“资料属于其他主体”为由拒绝整次生成；普通客户无法完成选题。 | 前端未按当前资料夹筛选自动带入的录音；后端把资料夹误作为安全边界，对同一企业中用户明确选择的资料也一律拒绝。 | `scripts/topic-knowledge-selection-smoke.mjs` 先在旧实现失败，断言自动带入按当前资料夹筛选，且同企业内显式选材不被主体校验阻断。 | 修复前：`node scripts/topic-knowledge-selection-smoke.mjs` FAIL；修复后：待执行专项与完整门禁。 | 待回归 |

## 使用规则

- 每个确认并修复的 Bug 增加一行；不要只记录在聊天里。
- 优先先提交失败测试/Eval，再提交修复。
- 测试数据必须脱敏或合成。
- 同一根因的重复报告合并，并保留所有证据链接或文件路径。
- 状态只使用：`待复现`、`已复现`、`修复中`、`待回归`、`已关闭`、`暂缓`。
- `已关闭` 必须有自动测试或可重复人工验收证据，以及实际执行结果。

## 严重程度

| 等级 | 定义 | 放行规则 |
|---|---|---|
| P0 | 数据泄露/破坏、支付错误、严重安全问题、系统核心不可用 | 立即阻断发布 |
| P1 | 核心用户路径失败、主要 Agent 不可用、严重错误输出 | 修复并回归后放行 |
| P2 | 非核心错误或存在明确替代路径 | 记录负责人和计划 |
| P3 | 轻微 UI、文案、低频体验问题 | 可进入需求池 |

## 台账

| ID | 日期 | 等级 | 模块/环境 | 现象与复现 | 根因 | 回归测试/Eval | 验证命令与结果 | 状态 |
|---|---|---|---|---|---|---|---|---|
| QA-20260812-015 | 2026-08-12 | P1 | IP positioning | A task with no manually selected document showed 0 documents and blocked generation even when the current enterprise had confirmed auto-available knowledge. Root cause: the page only counted task-bound manual document IDs and did not pass a fallback subject ID to the run request. Regression: `scripts/ip-positioning-workbench-smoke.mjs` (failed before fix). Verification: `node scripts/ip-positioning-workbench-smoke.mjs` PASS; `pnpm.cmd --filter @baolu/web typecheck` PASS; `pnpm.cmd qa:full` PASS; production backup, build, `/ready`, `/health`, and source-marker verification PASS. | 已关闭 |
| QA-20260812-016 | 2026-08-12 | P1 | IP positioning | Generating from the knowledge drawer could send the prior/default subject instead of the subject just selected by the user, and a browser-disconnected MCP request could keep an orphaned model call alive. Root cause: the drawer relied on an asynchronous parent state update, while the internal MCP endpoint did not propagate its HTTP cancellation signal into the Agent runtime. Regression: `scripts/ip-positioning-workbench-smoke.mjs` and `scripts/mcp-request-cancellation-smoke.mjs` (new assertions failed before the repair). Verification: `node scripts/ip-positioning-workbench-smoke.mjs` PASS; `node scripts/mcp-request-cancellation-smoke.mjs` PASS; `pnpm.cmd qa:full` pending. | 修复中 |
|---|---|---|---|---|---|---|---|---|
| QA-20260812-009 | 2026-08-12 | P1 | 品牌获客智能体 / IP定位系统 | 未选择知识库资料时仍可点击“一键生成IP定位方案”，页面长期显示“正在生成”，用户不知道应先做什么也无法在模块内中止。 | 工作台只把资料数量作为提示，未作为生成前置条件；发送入口也没有对空资料做保护。 | `scripts/ip-positioning-workbench-smoke.mjs` 断言空资料点击先打开资料选择器、按钮文案明确、生成中有停止入口，且发送层再次拦截空资料。修复前 FAIL。 | 待执行。 | 待回归 |
| QA-20260812-008 | 2026-08-12 | P1 | 企业知识库 / 飞书接入 | App ID 与 Secret 可获取租户令牌时，页面就显示“已连接”；首次同步才因知识库/文档无权限失败，并仅显示笼统的“检查凭证”。 | 连接校验只验证 tenant access token；非 2xx 飞书响应丢弃了平台的错误码与原因。 | `scripts/platform-knowledge-connectors-smoke.ts` 断言无链接校验知识空间读取、指定链接校验文档读取，且 HTTP 400 转为可执行提示。修复前仅能验证令牌。 | 待执行。 | 待回归 |
| QA-20260812-009 | 2026-08-12 | P1 | 外卖智能体 / 14天每日回填与复盘 | 每日字段无法稳定定位；14天全部保存后，“生成复盘”只跳转任务卡、未实际发起复盘；复盘完成后又把原始回填整段堆入“判断依据”，未识别模拟回填和14/14完成状态。 | 字段缺少逐日稳定无障碍标识；复盘处理只调用 `onOpenCapability`，没有构建并发送 review prompt；确定性复盘兜底只截取人工补充原文，缺少回填完整度、数据性质和可比周期判断。 | `scripts/takeaway-workbench-smoke.ts` 断言字段唯一标识、结构化复盘摘要和 review 调用链；`scripts/takeaway-capability-output-smoke.ts` 覆盖14/14模拟回填，断言明确流程演练、禁止扩大投入且不再提示补齐每日回填。 | 待执行本次回归与生产验收。 | 待上线验收 |
| QA-20260812-010 | 2026-08-12 | P1 | 外卖智能体 / 新店任务地图 | 新店场景已经生成7/14/30天落地计划后，任务地图仍把下一步连到“AI找问题与路由”，使用户误以为要重新诊断。 | 新店分支与老店共用了“场景 → AI找问题”的地图边，没有按冷启动执行流拆分。 | `scripts/agent-work-map-smoke.ts` 断言“新店场景 → 单变量增长实验”且禁止“新店场景 → AI找问题”。 | 待执行本次回归与生产验收。 | 待上线验收 |
| QA-20260812-011 | 2026-08-12 | P1 | 外卖智能体 / 门店阶段与任务流 | 系统用“新店/老店”二选一和固定地图推断下一步，既不支持品牌自己的阶段定义，也可能把处于起量不达标的新店错误地直接送去执行或重新诊断。 | 门店分析路径、品牌经营阶段和任务状态没有分层；任务地图把新店分支写成单一固定箭头。 | `scripts/takeaway-workbench-smoke.ts` 覆盖品牌自定义阶段写入提示词、页面阶段/状态展示和新店“问题不明诊断 / 问题明确执行”双入口；`scripts/agent-work-map-smoke.ts` 覆盖两条新店分支。 | 待执行本次回归与生产验收。 | 待上线验收 |
| QA-20260812-007 | 2026-08-12 | P2 | 企业知识库 / CEO 驾驶舱 | 企业知识库页同时承载资料接入、资料权限和经营会诊，用户无法区分“存什么”与“由谁决策分析”。 | 资料层与决策层共用旧 `KnowledgeBasePage` 的分析组件，未在 CEO 驾驶舱提供基于同一主体、同一权限边界的会诊入口。 | `scripts/ceo-knowledge-analysis-location-smoke.mjs` 断言知识库不再渲染分析智能体/报告表单，CEO 驾驶舱渲染会诊组件并沿用受控 `/knowledge-base/analyses` 接口。 | 待执行。 | 待回归 |
| QA-20260812-006 | 2026-08-12 | P2 | 外卖智能体 / 任务结果展示 | 用户在诊断页补充调价、菜品上下架与活动调整后，新的诊断请求已携带补充信息，但结果页首先只展示未变化的原始导入图表，且没有标识哪些补充事实已被纳入判断，用户无法分辨判断是否更新。 | 补充信息只进入生成提示词，没有独立的提交快照和结果展示层；原始数据图表与更新后的判断未做证据边界分层。 | `scripts/takeaway-workbench-smoke.ts` 断言补充信息影响区、更新后的判断和原始数据图表边界存在；修复前缺少 `takeawaySupplementImpact`，专项 smoke 失败。 | `pnpm.cmd takeaway:workbench-smoke` PASS；`pnpm.cmd agent:zhenshui-pilot-smoke` PASS；`pnpm.cmd typecheck` PASS；`pnpm.cmd qa:full` PASS。 | Closed |
| QA-20260812-005 | 2026-08-12 | P1 | Enterprise knowledge base | A completed base crawl stopped after the initial candidate set, leaving the user no supported way to expand research when the total was below the 200-document cap. | Research used one fixed topic and cursor; it had no expanded query profile or user-supplied keyword batch. The cursor also advanced by the configured page size rather than the number of consumed candidates. | `scripts/enterprise-knowledge-expanded-crawl-smoke.mjs` asserts expanded mode, bounded keywords, and consumed-candidate cursor progress. It failed before the implementation because no expanded crawl controls existed. | `pnpm.cmd knowledge:expanded-crawl-smoke` PASS; `node scripts/enterprise-knowledge-industry-crawl-smoke.mjs` PASS; `pnpm.cmd qa:full` PASS. | Closed |
| QA-20260812-004 | 2026-08-12 | P1 | Enterprise knowledge base | Sync status reported 891 documents assigned to the current subject, while the asset card showed only the first 50 with no way to access the rest. | The frontend ignored the paginated API total and always requested only the default first page. | `scripts/enterprise-knowledge-pagination-smoke.mjs` asserts subject filtering, total-count rendering, a next-page request, load-more control, and the API page-size cap; it failed before the UI fix. | `pnpm.cmd knowledge:pagination-smoke` PASS; `pnpm.cmd --filter @baolu/web typecheck` PASS; `node scripts/enterprise-knowledge-industry-crawl-smoke.mjs` PASS; `pnpm.cmd knowledge:platform-connectors-smoke` PASS; `pnpm.cmd qa:full` PASS. | Closed |
| QA-20260812-003 | 2026-08-12 | P1 | 外卖智能体 / 新店起量任务页方案修订 | 用户在“修改方案”补充新店基线后，结果仍沿用旧方案的“待补”；当“100单、70单”被误填入开业日和平台上线日时，系统还把配送范围错误视为商圈已补齐。 | 方案修订没有把新店字段识别为定向基线更新；日期、配送范围和商圈没有做类型与语义校验，导致旧方案与补充信息并存。 | `scripts/zhenshui-internal-pilot-smoke.ts` 新增脱敏无效字段用例，断言订单量不能作为日期且配送范围不能替代商圈；新增有效字段用例，断言开业日、上线日、半径和商圈写回第1节，且保留未点名章节。修复前无效字段会被输出为“已提供”。 | 修复后：`pnpm.cmd agent:zhenshui-pilot-smoke` PASS；`pnpm.cmd typecheck` PASS；`pnpm.cmd qa:full` PASS。 | 已关闭 |
| QA-20260812-002 | 2026-08-12 | P1 | 外卖智能体 / 任务页“问问题、修改方案” | 新店任务中输入“开业日、平台上线日、配送半径和商圈待补，在哪里补充完整？”时，系统没有识别为字段填写入口追问，错误要求用户再指出页面对象；预算、周期、负责人等明确方案约束也可能交给模型自由理解。 | 快速对话通道只匹配“如何给/补数据”的窄句式，未识别字段名加“在哪里填/怎么录入”等表达；修改方案的明确约束未进入保留原方案的定向修订通道。 | `scripts/zhenshui-internal-pilot-smoke.ts` 新增脱敏字段位置用例，Provider 若被调用即失败，断言返回“补充本轮已知信息”、更新判断和新店基线流程；新增预算不变、7天周期、负责人用例，断言保留原方案并定向写入约束。修复前前者会调用 Provider 并失败。 | 修复后：`pnpm.cmd agent:zhenshui-pilot-smoke` PASS；`pnpm.cmd typecheck` PASS；`pnpm.cmd qa:full` PASS。 | 已关闭 |
| QA-20260812-001 | 2026-08-12 | P2 | 外卖智能体 / 任务页人机协作区 | 请求期间只显示一行“正在回复”，用户无法确认系统仍在处理；“数据是否够用”的回答为长段文本，不便快速执行。 | 外卖任务页未复用主对话的分阶段进度交互；数据可用性追问没有稳定的结构化输出契约。 | `scripts/takeaway-workbench-smoke.ts` 断言三个进度阶段、非内部推理提示和组件存在，修复前 FAIL；`scripts/zhenshui-internal-pilot-smoke.ts` 断言数据够用回答包含“结论、现在能分析、暂时不能下结论、接下来补什么”四个章节。 | 修复后：`pnpm.cmd takeaway:workbench-smoke` PASS；`pnpm.cmd agent:zhenshui-pilot-smoke` PASS；`pnpm.cmd typecheck` PASS。浏览器 E2E 待本地页面可访问后执行。 | 待回归 |
| QA-20260811-013 | 2026-08-11 | P1 | 品牌获客 / 任务地图输出 | 选题缺少来源与证据标签；内容会把皮肤管理误写成美甲且没有下一步；投流没有单变量测试和负责人；直播一键生成可能降级为简版。 | 确定性输出与质量判定没有完全对齐 WorkBuddy 样板和任务地图入口标记。 | `scripts/acquisition-workmap-output-quality-smoke.ts` 用脱敏皮肤管理主体，强制 Provider 降级，断言选题、内容、投流和直播的可交付字段；修复前 FAIL。 | `node apps/api/node_modules/tsx/dist/cli.mjs scripts/acquisition-workmap-output-quality-smoke.ts` PASS；`pnpm.cmd agent:work-map-smoke` PASS；`pnpm.cmd agent:input-smoke` PASS；`pnpm.cmd content-system:batch-smoke` PASS；`pnpm.cmd qa:regression` PASS；`pnpm.cmd qa:full` PASS，2026-08-11。 | 已关闭 |
| QA-20260811-012 | 2026-08-11 | P1 | 外卖智能体/本地工作台任务生成 | 已导入结构化经营数据后，在“老店增长 → 不知道问题在哪”生成任务，页面长时间停留在“正在生成当前任务结果”。 | 工作台已经提供固定模块、结构化数据快照、异常证据和固定输出契约，但服务端仍先等待深度模型调用，只有调用失败后才使用可控降级结果。 | `scripts/zhenshui-internal-pilot-smoke.ts` 新增脱敏工作台老店诊断用例，使用会抛错的 Provider 断言 Provider 调用次数必须为 0、保留异常证据和核验动作，并标记 `takeaway_workbench_direct`；修复前 FAIL。 | 修复前：`pnpm.cmd agent:zhenshui-pilot-smoke` FAIL（仍先调用 Provider）；修复后：`pnpm.cmd agent:zhenshui-pilot-smoke` PASS；`pnpm.cmd takeaway:workbench-smoke` PASS；`pnpm.cmd typecheck` PASS。浏览器本地验收：导入 16 份已授权文件后，老店诊断在约 6 秒内返回，不再显示“正在生成当前任务结果”，且包含老店基线、异常、核验、完成标准和下一步，2026-08-11。 | 已关闭 |
| QA-20260811-011 | 2026-08-11 | P1 | 品牌获客 / 企业知识库 | 行业抓取仅返回少量网页线索，未形成可在当前主体下持续积累的行业垂直知识库。 | 原接口只调用趋势扫描并返回临时结果，未读取正文、未写入 `KnowledgeDocument`、未保存主体级进度。 | `scripts/industry-public-knowledge-crawler-smoke.ts` 使用脱敏网页夹具验证白名单候选、正文提取、稳定来源标识和批次状态；`scripts/enterprise-knowledge-industry-crawl-smoke.mjs` 验证 200 篇上限、主体隔离和页面进度。 | `node apps/api/node_modules/tsx/dist/cli.mjs scripts/industry-public-knowledge-crawler-smoke.ts` PASS；`node scripts/enterprise-knowledge-industry-crawl-smoke.mjs` PASS；`pnpm.cmd qa:full` PASS，2026-08-11。 | 待线上回归 |
| QA-20260811-010 | 2026-08-11 | P1 | 品牌获客 / 企业知识库 | 得到大脑显示同步完成，但历史同步资料没有显示在当前主体知识资产中。 | 得到大脑的增量游标使历史资料不再返回；主体关联只写入本轮返回的资料，未回填同一连接已有资料。 | `scripts/enterprise-knowledge-industry-crawl-smoke.mjs` 断言同步会按当前租户、连接和主体限定，回填历史资料的主体关联，并显示归入数量。 | `node scripts/enterprise-knowledge-industry-crawl-smoke.mjs` PASS；前后端 typecheck PASS；`pnpm.cmd qa:full` PASS，2026-08-11。 | 待线上回归 |
| QA-20260811-009 | 2026-08-11 | P1 | 外卖智能体/新店起量任务页对话 | 在“问问题”中说明老店数据不能作为新店基线并追问“如何给你数据？”，回答复述背景后要求补充页面对象，没有说明需提交哪些新店资料。 | 确定性对话快捷通道只覆盖识别质量和数据够用性，未识别新店的数据提交意图，因而落入通用页面对象澄清兜底。 | `scripts/zhenshui-internal-pilot-smoke.ts` 新增脱敏“演示新店数据提交”用例，断言必填字段、老店数据边界和独立对话通道；修复前 FAIL。 | `pnpm.cmd agent:zhenshui-pilot-smoke` PASS；`pnpm.cmd takeaway:workbench-smoke` PASS；`pnpm.cmd typecheck` PASS，2026-08-11。 | 已关闭 |
| QA-20260811-008 | 2026-08-11 | P1 | Skill 质量门禁/本地与发布前 | 执行 `pnpm.cmd qa:full` 时，`quality:assets` 报 `takeaway-growth-advisor/contract.json` 的 `requiredSections` 为空，阻断所有发布。 | 外卖增长顾问 Skill 的样板已经定义七段输出，但质量合同遗漏了必填栏目。 | `scripts/check-skill-quality-assets.mjs` 覆盖所有生产 Skill 的非空质量合同检查；该项修复前 FAIL。 | 待执行 `pnpm.cmd qa:full`。 | 待回归 |
| QA-20260811-007 | 2026-08-11 | P1 | 品牌获客/企业知识库 | 飞书连接后仍要求逐条填写资料链接；得到大脑同步成功后资料没有归入当前主体，当前主体知识资产不显示新增内容。 | 飞书连接器仅支持单文档 URL；同步接口未接收当前 `subjectId`，入库文档没有建立主体关联。 | `scripts/platform-knowledge-connectors-smoke.ts` 覆盖飞书无链接一键读取已授权知识空间与企微授权通讯录；`scripts/enterprise-knowledge-industry-crawl-smoke.mjs` 断言同步请求、接口校验和主体归属关联；修复前飞书无链接用例 FAIL。 | 两个专项脚本 PASS；前后端 typecheck PASS；`pnpm.cmd qa:full` FAIL（既有 `takeaway-growth-advisor/contract.json` 的 `requiredSections` 为空）。 | 待回归 |
| QA-20260811-006 | 2026-08-11 | P2 | 品牌获客/企业知识库 | 点击“同步最新录音”时，飞书与企业微信按钮同时显示“同步中…”，使人误以为它们被自动同步。 | 三个来源共用了单一 `syncing` 前端状态；实际请求只发给得到大脑连接。 | `scripts/enterprise-knowledge-industry-crawl-smoke.mjs` 断言同步状态按连接 ID 独立保存，按钮不再共用 `disabled={syncing}`；修复前 FAIL。 | 回归脚本 PASS；Web typecheck PASS；`pnpm.cmd qa:fast` FAIL（既有 `takeaway-growth-advisor/contract.json` 的 `requiredSections` 为空）。 | 待回归 |
| QA-20260811-005 | 2026-08-11 | P1 | 品牌获客/企业知识库 | 在“AI 抓取的行业知识”卡片点击“补充行业与企业经验”会跳转到通用知识库页面，不能填写行业或开始公开资料抓取。 | 按钮硬编码了页面跳转，未接入已有受控行业公开线索抓取服务。 | `scripts/enterprise-knowledge-industry-crawl-smoke.mjs` 断言同页行业填写、抓取接口与受控抓取服务绑定；修复前 FAIL。 | `node scripts/enterprise-knowledge-industry-crawl-smoke.mjs` PASS；前后端 typecheck PASS；`pnpm.cmd qa:full` FAIL（既有 `takeaway-growth-advisor/contract.json` 的 `requiredSections` 为空）。 | 待回归 |
| QA-20260810-001 | 2026-08-10 | P2 | 测试契约/本地 | `pnpm.cmd qa:regression` 在 `agent:smoke` 失败；实际获客 Agent 已有 12 个能力，测试仍要求 11 个 | 新增 `ip_positioning` 后，首发能力数量和必需能力断言未同步 | `scripts/agent-product-smoke.ts` 现在要求 12 个能力并单独验证 `ip_positioning` Skill 绑定；修复前 FAIL | `pnpm.cmd qa:regression` PASS，2026-08-10 | 已关闭 |
| QA-20260811-002 | 2026-08-11 | P1 | 租户品牌/线上与本地 | 未配置企业白标时，`/my-ai` 仍显示“枕水江南”名称、Logo 字样和外卖智能体品牌 | 后端全局默认品牌被写成单一客户品牌，且 `isCustomized` 错误设为 `true`；旧缓存会继续覆盖前端正确默认值 | `scripts/tenant-branding-smoke.ts` 新增思潼默认、旧默认迁移、主动白标保留和跨智能体外显断言 | `pnpm.cmd qa:full` PASS；生产 `/api/public/tenant-branding` 返回“思潼”且 `isCustomized=false`；公网 `/api/health`、`/api/ready` 均 PASS，2026-08-11 | 已关闭 |
| QA-20260811-003 | 2026-08-11 | P1 | 获客智能体/IP定位系统 | 从IP定位系统打开经营资料库并选择资料后，底部仍显示“提炼获客选题”，提交后可能路由到选题 Skill | 共用资料抽屉把获客智能体全局 `knowledgeAction` 写死，未读取当前工作系统 | IP定位上下文增加独立动作标签、说明和 `ip_positioning` capability 锁定；选中资料 ID 随本次调用提交 | `pnpm.cmd qa:full` PASS；源码断言确认IP定位按钮、能力锁定和“不得转去生成获客选题”边界存在，2026-08-11 | 待线上回归 |
| QA-20260811-004 | 2026-08-11 | P1 | 品牌获客智能体/选题系统 | 得到大脑已同步且选题请求已携带录音资料 ID 与正文，但四大来源仍把“AI录音卡”判为“未发现/待补”，贡献为 0 | 选题确定性兜底复用了普通对话事实提取器；该提取器只保留 `用户这次补充：` 后的短指令，错误裁掉同一请求中位于标记前的 `【资料 N｜...】` 录音正文 | `scripts/verify-topic-inspiration.ts` 新增“已携带有效录音正文”用例；修复前 FAIL；`scripts/verify-production-topic-recording-e2e.mjs` 使用生产录音做端到端断言 | 回归脚本 PASS；`@baolu/agent` typecheck/build PASS；生产真实录音链路返回“AI录音卡已读取且贡献非零”，`knowledgeSources` 可回溯，2026-08-11 | 已关闭 |
| 示例-001 | YYYY-MM-DD | P1 | Agent/测试环境 | 输入、步骤、预期、实际、证据路径 | 根因，不写表面现象 | 测试文件与用例 ID；修复前 FAIL | `pnpm ...` PASS，运行日期 | 已关闭 |

> 示例行仅展示格式，不代表真实缺陷。登记首个真实 Bug 时可删除示例行。

## 无法自动化的缺陷

若暂时无法自动化，必须在“回归测试/Eval”列写明：

1. 无法自动化的具体原因。
2. 可重复的人工步骤和证据要求。
3. 计划补齐的自动化层级：单元、接口、Eval、浏览器 E2E 或监控告警。

仅写“人工验证通过”不足以关闭高风险 Bug。
### QA-20260812-012 外卖增长主流程把经营阶段当分支并混淆问题验证与增长执行

- 现象：任务地图把“新店/老店”和菜单、投放、竞品作为主流程节点；新店计划或AI诊断后可直接进入单变量增长实验，缺少“验证原因是否成立、增长方案、真实执行、效果评估”四个独立阶段。AI诊断还把原因数量限制为最多3个，用户无法知道是否遗漏其他方向。
- 根因：工作地图按能力模块而非经营决策闭环组织；`takeaway_growth` 的 Prompt 与输出契约把“全面扫描范围”和“页面优先展示数量”混为同一个上限；问题验证实验和增长动作实验复用了同一任务。
- 修复：任务地图 V4 固定为“数据与经营阶段 → 数据质量 → AI经营诊断 → 问题验证 → 增长落地方案 → 真实执行与回填 → 增长效果评估 → 周期复盘与决策”。经营阶段改为诊断上下文，专业菜单/投放/竞品能力由AI按证据调用。AI经营诊断固定扫描12类原因并完整列出状态，只突出最多3个优先候选，每轮只验证1个；新增独立问题验证、执行和效果评估能力及页面入口。
- 不应发生：经营阶段不得绕过AI诊断；可能原因不得直接生成增长方案；模拟回填不得判定真实增长；“突出3个候选”不得被实现为“只扫描3个原因”。
- 回归：`scripts/agent-work-map-smoke.ts`、`scripts/takeaway-capability-output-smoke.ts`、`scripts/takeaway-workbench-smoke.ts`。
- 验证命令：`pnpm.cmd agent:work-map-smoke`、`pnpm.cmd takeaway:capability-output-smoke`、`pnpm.cmd takeaway:workbench-smoke`、`pnpm.cmd agent:smoke`、`pnpm.cmd qa:full`。

### QA-20260812-017 外卖增长首步将上传与数据可用性检查拆成两个任务

- 现象：用户上传经营文件后，还必须单独进入“数据质量门槛”并手动点击检查，才能知道数据是否可用、能分析什么和还缺什么；这与上传完成后立即核验的实际流程不一致。
- 根因：任务地图把数据导入和质量核验建成相邻节点，任务页也将质量结果隐藏在独立能力页的手动按钮后。
- 修复：任务地图 V5 合并为“数据与经营阶段”，上传后在同一页自动展示可用结论、文件质量、重复、口径风险、可判断边界与待补数据；保存经营阶段后直接进入 AI 经营诊断。
- 不应发生：任务地图不得再出现独立“数据质量门槛”节点；上传后不得要求用户手动点击质量检查；口径风险和缺失数据不得被隐藏或误写为增长结论。
- 回归：`scripts/agent-work-map-smoke.ts`、`scripts/takeaway-workbench-smoke.ts`、`scripts/takeaway-capability-output-smoke.ts`。
- 修复前证据：更新后的地图 smoke 在旧实现上断言失败，实际仍含 `takeaway_data_audit` 节点。
- 验证命令：`pnpm.cmd agent:work-map-smoke`、`pnpm.cmd takeaway:workbench-smoke`、`pnpm.cmd takeaway:capability-output-smoke`、`pnpm.cmd qa:full`。

### QA-20260812-018 AI经营诊断被拆成预览异常与二次“完整原因地图”操作

- 现象：进入 AI 经营诊断后，页面先展示少量显眼单点异常，用户还必须再点击“生成完整原因地图”才得到完整输出；单日订单低谷、单品成本偏高会被误当作优先增长原因，AI 没有体现跨平台、漏斗、时段、客单、货盘和经营动作之间的组合分析价值。
- 根因：诊断任务没有在任务入口自动发起一次完整调用；页面把数据看板里的原始异常卡与 Agent 诊断结果拆开呈现；异常检测只偏向单指标阈值，Fallback 也把所有异常直接放入优先候选。
- 修复：进入 `takeaway_growth` 即按当前数据版本自动生成一份完整诊断；补充经营变化后只需一次“更新完整诊断”。页面不再另列预览问题或要求生成完整原因地图。异常扫描新增订单与客单同步走弱、重复星期低位、同平台漏斗双断点、跨平台菜品价格差等组合信号；只有组合信号进入优先验证候选，单点异常明确标为线索。
- 不应发生：不得要求用户在 AI 诊断页重复点击两次才能看到完整结论；单日低谷或成本高不得在没有交叉证据时被写成优先增长根因；数据不足时必须明确没有形成组合证据链，而不是编造 AI 判断。
- 回归：`scripts/takeaway-workbench-smoke.ts`、`scripts/takeaway-data-dashboard-smoke.ts`、`scripts/takeaway-capability-output-smoke.ts`。
- 修复前证据：`pnpm.cmd takeaway:workbench-smoke` 报 `workbench_ux_contract_missing:进入即输出完整诊断`。
- 验证命令：`pnpm.cmd takeaway:workbench-smoke`、`pnpm.cmd takeaway:data-smoke`、`pnpm.cmd takeaway:capability-output-smoke`、`pnpm.cmd qa:full`。

### QA-20260812-019 问题验证对不同经营问题套用同一模板

- 现象：对“订单低谷”和“菜品成本偏高”点击生成本轮验证设计后，输出只有标题不同，均为笼统的验证周期、保持不变项和结论；用户不知道到哪个后台查看什么字段，也无法在完成核查后再填写结论。
- 根因：问题验证只透传候选的通用验证句，Fallback 没有按问题类型编排核查路径；页面在生成结果出现后立即展示结论表单，缺少“先现场核查、后回填结论”的交互边界。
- 修复：新增订单趋势、成本贡献、平台漏斗、投放和履约五类验证蓝图，分别输出去哪里看、必须记录、怎么比较与成立规则；将蓝图随任务上下文传给 Agent。验证结论改为完成现场核查后由负责人主动展开填写。
- 不应发生：成本问题不得使用订单低谷的同星期漏斗验证模板；订单低谷不得用成本核算替代；未完成现场核查不得暗示结论已经产生。
- 回归：`scripts/takeaway-capability-output-smoke.ts`、`scripts/takeaway-workbench-smoke.ts`。
- 验证命令：`pnpm.cmd takeaway:capability-output-smoke`、`pnpm.cmd takeaway:workbench-smoke`、`pnpm.cmd qa:full`。
# QA-20260812-004 外卖增长任务内部仍沿用旧状态机

- 现象：数据与经营阶段没有独立填写入口；AI诊断的问题不明确；原因地图把字段覆盖误写为“基本排除”；问题验证不能从候选逐项选择并登记结论；增长方案提前出现每日回填，旧模拟数据会自动带入；增长评估没有目标与实际值的结构化对比。
- 根因：任务地图已升级到八步，但 `TakeawayGrowthWorkbench` 仍复用旧五步状态与 `takeaway-daily-plan-v2` 本地草稿；诊断 fallback 又以关键词命中代替异常证据。
- 回归：`scripts/takeaway-workbench-smoke.ts`、`scripts/takeaway-capability-output-smoke.ts`。
- 修复前证据：新增回归会分别报 `total_diagnosis_semantic_rule_missing`、`workbench_ux_contract_missing`、`legacy_simulated_daily_plan_must_not_be_loaded` 或“只有字段覆盖不能写成基本排除”。
- 验证命令：`pnpm.cmd takeaway:workbench-smoke`、`pnpm.cmd takeaway:capability-output-smoke`、`pnpm.cmd agent:zhenshui-pilot-smoke`、`pnpm.cmd qa:full`。
# QA-20260812-020 品牌招商与门店获客混用同一智能体

- 现象：原“品牌获客智能体”同时面向连锁品牌招商和门店到店业务，选题、内容与投流容易输出团购、到店、消费者优惠等不属于品牌招商的内容，门店用户也没有独立工作流。
- 根因：产品定义、工作地图和通用选题 Brief 没有把“目标加盟商”和“目标消费者”作为互斥的业务边界。
- 修复：保留原 `acquisition` 路由和老客户权限，外显名称改为“品牌招商智能体”，将工作地图、Brief 和所有核心能力提示限定为招商加盟；新增独立 `store-acquisition` 门店获客智能体，提供门店选题、内容、团购到店投流与复盘流程。
- 不应发生：品牌招商智能体不得生成门店到店、团购券、消费者优惠、核销、菜品促销或门店复购方案；门店获客智能体不得生成招商加盟、加盟商招募或品牌考察方案。
- 修复前证据：`node apps/api/node_modules/tsx/dist/cli.mjs scripts/franchise-store-agent-split-smoke.ts` 断言“思潼·品牌招商智能体”失败，实际仍为“思潼·品牌获客智能体”。
- 回归：`scripts/franchise-store-agent-split-smoke.ts`、`scripts/topic-brief-workbench-smoke.mjs`、`scripts/agent-work-map-smoke.ts`、`scripts/agent-product-smoke.ts`。
- 验证命令：`pnpm.cmd qa:full`。
