# BY-19 Get笔记同步性能与可观测性

状态：业务验收

## 归属

- 产品：美业智能体｜门店 AI 经营大脑
- 层级：产品任务含公共知识库连接器子改动
- 风险：高（租户资料、外部授权、异步状态、幂等）
- 预计修改热点：Get笔记 connector、知识库同步 API/数据模型、Web 同步入口、专项测试与美业交接文档
- 是否允许并行：否；同一美业智能体仅本任务编码

## 用户结果

用户点击“同步到大脑”后一秒内看到真实已入队/执行阶段；首次和增量同步可恢复、可观测、租户隔离，同一连接不会重复并发同步。

## 本次范围

- 建立持久化同步任务和查询合同，返回真实阶段、进度、计数、重试/退避与终态。
- Get笔记列表、详情、节流、退避、解析、持久化和主体绑定分段遥测（仅元数据）。
- 以租户内 `externalUpdatedAt`/内容指纹为增量依据，跳过可证明未变化的详情或写入。
- 四个既有 Web 同步入口复用同一任务合同，支持重复点击复用与刷新恢复。
- 使用受控 mock/合成资料覆盖租户、权限、失败和性能目标。

## 本次不做

- 不访问真实 Get笔记，不调用模型/媒体 Provider，不产生费用。
- 不删除 Get笔记远端缺失的本地知识；列表分页不是完整删除凭证。
- 不取消既有限流、退避或权限边界，不引入无限并发。
- 不启动美业 AI 日报或其他模块，不部署生产。

## 验收条件

1. 正常路径：POST 在 1 秒内返回持久化任务；首次、无变化增量、单条新增/更新均给出真实阶段与计数，最终可刷新恢复。
2. 失败路径：授权过期、429、5xx、不可重试错误、部分详情失败、数据库失败和进程中断均有脱敏、可解释、可恢复终态。
3. 不应发生：同连接重复并发、跨租户任务/水位复用、重复文档、正文/凭证进日志、Provider/模型费用、假完成。
4. 可观测结果事件：接收/排队、列表、详情、节流、退避、解析、持久化、主体绑定、完成/失败及各阶段耗时和计数。

## 基线与失败证据

- 已有只读证据：连接约 1.131s；同步约 53.616s；同步不是模型调用，Provider 费用 ¥0。
- 当前根因：同步 POST 直接串行执行最多 5 页列表/详情、详情间隔 350ms、单请求最多 4 次退避及逐条数据库写入；所有 Web 入口等待终态，且缺少阶段、计数和浏览器点击到 API 接收遥测。
- 修复前失败测试/Eval：`pnpm.cmd beauty-industry:getnote-sync-p1-smoke`（先建立后运行；应因缺少持久任务合同、阶段遥测和增量跳过而失败）。

## 实现记录

- 修改文件（本卡精确归属）：
  - `apps/api/src/services/getnote-connector.ts`：增量水位、分段观测、请求/重试/节流/退避计数与测试注入；不记录正文或凭证。
  - `apps/api/src/routes/knowledge-base.ts`：持久任务启动/查询/执行、单飞、失心跳、租户水位、upsert/绑定和脱敏日志；既有非 Get笔记 platform sync 保持同步合同。
  - `packages/db/prisma/schema.prisma`、`packages/db/prisma/migrations/202608260001_knowledge_sync_jobs/migration.sql`：`KnowledgeSyncJob` 与 active partial unique index。
  - `apps/web/src/lib/knowledge-sync.ts`：Web 共用启动、轮询、刷新恢复、阶段/终态文案。
  - `apps/web/src/pages/KnowledgeBasePage.tsx`、`EnterpriseKnowledgeBasePage.tsx`、`AgentProductsApp.tsx`、`components/acquisition/TopicSystemWorkbench.tsx`：四个既有入口接同一合同。
  - `scripts/beauty-industry-getnote-sync-p1-smoke.ts`、`package.json`：红绿灯和持续回归入口。
  - 本任务卡、`STATUS.md`、`TEST_MATRIX.md`、`CONTRACTS.md`、`WORKFLOW.md`、`tasks/README.md`、`docs/BUG_REGRESSIONS.md`：合同与交接。
- 数据/接口/配置变化：新增 `KnowledgeSyncJob`；Get笔记 POST 保留原 URL但返回 202；新增 connection latest 与 job status GET。用户 requestId 入库/日志前转为 16 位 SHA-256 指纹。没有新增 Provider、费用、密钥或外部连接配置。
- 兼容性和回滚点：非 Get笔记连接仍走旧同步响应；Get笔记 Web 四入口同时升级。回滚需先停止新任务，再同时回退 Web、路由、connector 与迁移；不得只回退一层。迁移只新增表/索引/外键，不修改既有知识文档。

## 验证

- 领域命令：`pnpm.cmd beauty-industry:getnote-sync-p1-smoke`、`pnpm.cmd getnote:credential-state-smoke`、`pnpm.cmd getnote:transcript-classification-smoke`、API/Web typecheck、Prisma validate/generate、`git diff --check` 全部 PASS。
- `pnpm.cmd qa:fast`：PASS。
- `pnpm.cmd qa:regression`：PASS。
- `pnpm.cmd qa:full`（含 build）：PASS。
- 页面/E2E：临时 demo API `3020`（worker PID 23416，HMR 后 14412/13120）与 Web `5174`（受控 PTY session 70184）验证视频选题深链；桌面入口真实空连接、不伪造已同步，390px `innerWidth=390/scrollWidth=375`、移动导航可用、console error=0。没有填写凭证或点击外部同步。两端已通过各自创建会话 Ctrl-C 停止，3020/5174 listener=0，浏览器 tab 已关闭且 viewport reset。
- 未运行项：真实 Get笔记首次/无变化性能基线和数据库迁移后的真实 route E2E。用户已经授权外部读取，但测试账号范围缺少网络前可核验证据，故按硬门禁停止；不是费用或 Provider 阻塞。
- 2026-08-26 授权后真实 preflight：用户批准“两任务、最多 10 条全合成笔记、不删源笔记”，但安全门禁在任何外部读取前 FAIL-CLOSED。验收数据库仅有 3 条既有 Get笔记连接，每条已有 99 个文档且无测试标记；CLI 凭据与三条连接的本地哈希比对均不相同，但 CLI 配置只含 `api_key/client_id`，没有账号标签、允许 note id/hash 清单或其他能证明远端仅暴露最多 10 条合成资料的证据。未调用列表接口来反向证明范围；同步任务数 0、正常/重试网络请求数 0、标题/正文读取 0、Provider 0、费用 ¥0。
- 本轮环境：只按验收标记和绝对 pgdata 双重核对后启动 PostgreSQL `55434/PID19436`，用于本地连接元数据/凭据哈希比对；未启动 API、Web 或浏览器。核对完成后按该 pgdata 的正式 `pg_ctl stop -m fast` 停止；`port_55434_listening=false`、`pid_19436_exists=false`，3016–3025 与 5170–5180 均无本轮监听。

## 交接

- 残余风险：P0=0；P1=1（真实 Get笔记网络/限流下的 POST≤1秒与无变化 P95≤5秒仍无证据；当前阻塞不是费用授权，而是无法在网络读取前证明测试账号的数据范围）。代码、离线合同和仓库门禁无残余 P0/P1。
- 已批准真实基线边界：仅使用一个专用 Get笔记测试账号/连接，账号内最多 10 条完全合成、无人物/顾客/门店/品牌/账号/联系方式/经营事实的笔记；允许读取列表元数据和这 10 条合成正文，落入一个独立合成 tenant 的知识库。执行首次同步 1 次和立即无变化同步 1 次；正常请求上限 12（2 次 list + 最多 10 次 detail），若发生正式退避最坏上限 48（每个请求最多 4 次），不自动发起第三次任务；正常预计 1 分钟，绝对停止 10 分钟。只记录分段计数/耗时/hash，不记录正文/凭证；不删除源笔记，隔离租户记录保留审计。模型/媒体 Provider=0、费用 ¥0。本次因范围证明不足未创建任何同步记录。
- 后续恢复：保留本次授权，不得改用三条 99 文档连接。先在受控本地配置中补充能与当前 CLI 凭据指纹绑定的测试账号标识和最多 10 条全合成 note id/hash 白名单（不写正文/凭据）；只有范围证明通过后，才执行首次同步 1 次和无变化同步 1 次。BY-19 关闭后才由总调度决定是否创建美业 AI 日报独立任务卡。
- 最后更新日期：2026-08-26
