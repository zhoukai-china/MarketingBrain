# BY-16 直播复盘 Skill 驱动专属页面

状态：已完成（2026-08-25）

## 归属

- 产品：美业智能体（`productCode=beauty-industry`）
- 层级：产品任务含共享正式 Skill 合同复用
- 风险：高
- 预计修改热点：`apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx`、新增直播复盘专属组件与样式、`apps/api/src/products/beauty-industry/*`、Web/WorkBuddy 路由合同、专项脚本与美业产品文档
- 是否允许并行：否；同一美业智能体只保留本任务开发中

## 用户结果

用户可在稳定直播复盘页面分别提交当前场次真实数据、录音转写和原话术计划，经资料核验后进入固定 `baolu_live_review_engine@3.0.0` 八模块复盘；资料不足时明确补充位置与影响，不伪造已读取的数据、画面或成交事实。

## 正式产品判定

- 仓库唯一映射为 `beauty.live_review / acquisition:live-review / live_review / baolu_live_review_engine@3.0.0 / beauty-industry-compliance`。
- 正式产品是分阶段的综合直播复盘：`数据/转写/计划三类资料 → 核验与降级 → 八模块报告 → 下场动作`；不是纯数据报表、纯话术点评，也不与视频数据/内容复盘合并。
- 固定八模块为：核心数据速览、流量诊断、转化归因、互动诊断、话术执行对照表、人货场诊断、方法论沉淀、下次直播调整清单。

## 本次范围

- 建立 Web 与 WorkBuddy 共用的版本化直播复盘输入合同及服务端严格校验。
- 建立专属页面，覆盖场次、平台、时间、场景/目标、数据、转写、原话术计划、互动/项目/转化口径、用户确认画面证据与事实边界。
- Web 支持 CSV/XLS/XLSX 真实后端解析；失败、空文件、错格式、无数值记录在运行前停止，解析不触发媒体或文本 Provider。
- 按三类核心证据显示就绪/缺失/影响；三类全缺时 Provider 前停止，部分缺失按正式 Skill 规则降级。
- 保持租户/权限、账本、幂等、失败释放、历史与刷新恢复，以及既有导航和深链。

## 本次不做

- 不实现直播生成、开播、投流、商品操作、发布或外部消息。
- 不自动上传/解析直播录屏，不调用视觉、ASR、视频、文本或其他收费 Provider 做验收。
- 不合并视频复盘，不复制创始人 IP、餐饮或其他产品文案/examples。
- 不部署生产，不停止或替换身份不明或既有受控环境进程。

## 验收条件

1. 正常路径：至少一类真实数据或转写证据与必要场次资料通过服务端合同后，固定路由运行正式 Skill；完整资料生成八模块报告并保存到同租户历史。
2. 失败路径：三类核心资料全缺、错误/空数据文件、错误字段、超时/取消/重复点击、无权限、跨租户和越权文件均失败关闭，说明补什么、去哪里补、影响什么。
3. 不应发生：自由文本切 Skill、模板/假数据冒充结果、声称读取未连接数据/录屏、编造场观/转化/顾客/疗效/价格、自动重试/换模、重复扣费或跨租户读取。
4. 可观测结果事件：固定 route receipt、workflow 版本、三类证据状态、解析零 Provider/零费用、账本预留/释放与已保存 AgentRun 可追溯且不记录原始敏感媒体。

## 基线与失败证据

- 基线命令：`pnpm.cmd beauty-industry:live-review-workbench-p1-smoke`
- 修复前失败测试/Eval：首次运行 exit 1，`ENOENT ... apps/web/src/components/acquisition/BeautyLiveReviewWorkbench.tsx`；红灯证明稳定路由尚无专属工作台和正式合同。
- 现象：当前稳定路由存在，但落入通用“这次要完成什么”文本区；仅有 `platform + contentStructure`，无版本化三证据合同、专属核验旅程或八模块结果视图。
- 根因：BY-10 只建立固定能力映射与通用工作区，尚未实施正式直播复盘专属页面和共用输入合同。

## 实现记录

- 新增：`apps/api/src/products/beauty-industry/live-review-workflow.ts`、`apps/web/src/components/acquisition/BeautyLiveReviewWorkbench.tsx`、`scripts/beauty-industry-live-review-{workbench,runtime,workbuddy}-p1-smoke.*`、`scripts/verify-beauty-live-review-browser-e2e.mjs`、`scripts/fixtures/beauty-live-review-data.csv`、本任务卡。
- 修改：`apps/api/src/products/beauty-industry/{execution,mcp-adapter,profile}.ts`、`apps/api/src/routes/{beauty-industry,workbuddy-mcp}.ts`、`apps/api/src/services/domestic-chat-provider.ts`、`apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx`、`apps/web/src/styles/beauty-video-review.css`、`scripts/beauty-industry-{controlled-mock-routing-smoke,fixed-route-output-p1-smoke}.ts`、`package.json` 与本产品文档。
- 数据/接口/配置变化：新增严格 `live_review_workflow_v1` 请求字段与同一 MCP JSON Schema；无数据库 Schema 变化。CSV fixture 为完全脱敏合成数据，162 bytes，SHA-256 `3494e799dfc692583a9789fb498394654d5d8a78bb1ceccc3a27fed66f10bc9f`。
- 兼容性和回滚点：保留原 tool/capability/scope/Skill 和稳定 URL；回滚点为新增 workflow 字段、组件接线及专项脚本。文件原件与解析回执不持久化，刷新只恢复安全文字/结果/同租户历史。

## 验证

- 领域命令：`beauty-industry:live-review-workbench-p1-smoke`、`beauty-industry:live-review-runtime-p1-smoke`、`beauty-industry:live-review-workbuddy-p1-smoke`、`beauty-industry:mcp-database-smoke`、`beauty-industry:fixed-route-output-p1-smoke`、`beauty-industry:web-contract-smoke` 均 PASS。
- 页面/E2E：当前源码 mock API `3017` + Web `5176`，桌面与 390px、直接深链、返回、CSV 解析、证据门禁、八模块结果、刷新、跨租户、控制台与外部请求均 PASS；`console_errors=0`、`external_provider_requests=0`。
- 全仓：API/Web typecheck、`pnpm.cmd qa:fast`、`pnpm.cmd qa:regression`、`pnpm.cmd qa:full`（含 build）和 `git diff --check` 均 PASS。
- 诊断说明：旧独立 `scripts/verify-live-skills.ts` 通过强制抛错验证历史确定性 fallback，会得到 `provider_failure_unknown`；BY-16 正式合同要求失败关闭，未为通过旧 fallback 断言而放宽门禁。正式 Schema/Eval 由新增 runtime、Web/WorkBuddy 共用 Schema 与全仓质量门禁覆盖。
- 未运行项：收费 Provider、媒体上传、生产部署；均不在本次授权范围。

## 交接

- 环境：PostgreSQL `55434 / PID 12564`、API `3016 / PID 31024`、Web `5176 / PID 25232` 身份已于 2026-08-25 只读核验；未处理任何进程。
- 费用：文本/视觉/视频/ASR/媒体 Provider 均 0 次，新增费用 ¥0；BY-15 授权未延续。
- 残余风险：范围内 P0/P1=0。浏览器扩展未连接，按 browser-skill 规则改用仓库隔离 CDP Chrome 完成等价实际页面验收。
- 验收链接：`http://127.0.0.1:5176/agents/beauty-industry/acquisition/live/review?apiBase=http%3A%2F%2F127.0.0.1%3A3016`（受控 API 仍为既有组合源码；若需验证本次当前源码，应按维护流程刷新受控运行记录后再替换 API）。
- 用户验收（不超过 5 步）：1）打开直播复盘深链；2）填写场次/目标并上传脱敏 CSV；3）补充转写与原话术，核对三类证据状态；4）运行并核对八模块及历史；5）刷新、返回并在 390px 检查恢复与导航。
- 后续任务：已停止并反馈总调度；不得自行启动其他模块。
- 最后更新日期：2026-08-25

## 验收环境维护交接（2026-08-25，fail-closed）

- 只读健康检查：PostgreSQL `55434 / PID 12564` 正常接受连接，API `3016 / PID 31024` 的 `/ready` 为 `ok=true, database=true`，Web `5176 / PID 25232` 返回 200；三者监听地址均为 `127.0.0.1`。
- 正式 `status.ps1` 判定 `source_fresh=false`、原因 `record pid mismatch`。当前源码指纹为 `67D89511E42B00E273C9B18D8D2994CB2C9E9C84945A74B7236030A49F83A7AA`，运行记录指纹为 `A4548D1BD0CC8A5CE1FE8448C488B7C8306A4012B505D168BA52D8CD19E01D66`；`api.pid` 与 3016 监听 PID 均为 `31024`，但 `api.runtime.json` 记录 PID `28544`。
- 3016 当前命令为 `node --import tsx src/server.ts`，缺少正式门禁要求的当前仓库绝对 TSX bootstrap 路径；纯决策函数返回 `FailClosed / foreign or unknown process`。无法可靠读取该相对入口进程的 cwd，也不能用健康响应替代进程身份。
- 安全处置：没有改写 runtime 记录、没有停止/替换 PID 31024，没有重启数据库或 Web，没有清库、创建邀请码、运行 Provider、上传媒体或部署生产；费用 ¥0。现有环境保持原样。
- 当前阻塞：验收环境仍不能证明正在服务 BY-16 最新源码，故本次“让用户看到最新源码”维护结果为阻塞，环境残余 P1=1（源码新鲜度/进程身份），产品实现范围 P0/P1 仍为 0。必须由能建立可信绝对启动身份的受控维护重新登记/启动；不得人工覆盖旧 runtime 记录后强行停止现 PID。

## 隔离最新源码验收 API（2026-08-25，已恢复）

- 总调度确认不接管、不停止、不修改 3016/PID 31024，也不覆盖其旧 runtime；该环境继续保持 `source_fresh=false / record pid mismatch`，不得作为 BY-16 最新源码入口。
- 新的隔离受控 API 为 `127.0.0.1:3017 / PID 8268`，runtime 根为 `F:\思潼AI增长os\test-environments\beauty-industry-by16-acceptance-20260825-v2`。`api.pid`、`api.runtime.json`、`by16.session.json` 与监听 PID 四方一致；当前源码指纹均为 `67D89511E42B00E273C9B18D8D2994CB2C9E9C84945A74B7236030A49F83A7AA`。
- 启动身份：`node.exe --require F:\思潼AI增长os\baolu-os-v2-source\apps\api\node_modules\tsx\dist\preflight.cjs --import tsx F:\思潼AI增长os\baolu-os-v2-source\apps\api\src/server.ts`；正式 `Test-ApiCommandIdentity` PASS。受控会话在启动前记录 CWD `F:\思潼AI增长os\baolu-os-v2-source\apps\api`，入口与 bootstrap 均为当前仓库绝对路径。
- 健康：3017 `/ready ok=true, database=true`；现有 PostgreSQL `55434 / PID 12564` 与 Web `5176 / PID 25232` 保持原样，Web 返回 200。数据库配置只指向 `beauty_industry_acceptance_20260821`，没有清库、迁移或删除持久业务记录。
- 最小冒烟：`beauty-industry:live-review-runtime-p1-smoke` PASS（provider=0）；`beauty-industry:live-review-browser-e2e` PASS（桌面、390px、深链、数据解析、证据门禁、八模块、刷新、返回、双租户、console=0、external provider requests=0）；`beauty-industry:live-review-workbuddy-p1-smoke` PASS（scope/权限、租户、幂等、缺失 fail-closed、controlled mock）。`domestic_provider_usage` 事件 0、媒体 Provider 事件 0、付费调用 0、费用 ¥0。
- 验收入口必须显式使用新 API：`http://127.0.0.1:5176/login/beauty-industry?apiBase=http%3A%2F%2F127.0.0.1%3A3017`。已创建 product=`beauty-industry`、24 小时有效、最多使用 1 次的邀请码；明文只在最终交接显示，不写仓库或日志。
- 停止方式：仅执行仓库外 `F:\思潼AI增长os\test-environments\beauty-industry-by16-acceptance-20260825-v2\stop-isolated.ps1`；脚本要求 3017 listener、PID 文件、runtime、session、源码指纹和绝对命令连续两次一致才停止 PID 8268，任一不一致 fail-closed。当前按总调度要求保持在线。
- 首次隔离启动因回调函数作用域未形成 runtime，启动计划已保留为失败证据；当次新进程 PID 18452 经绝对 bootstrap/入口和 `src\server.ts` marker 两次核验后停止，3017 释放后才使用全新 `-v2` 目录启动。3016/5176/55434 全程未处理。
- 最终状态：环境残余 P0/P1=0，产品实现残余 P0/P1=0，未部署生产，不启动下一模块。
