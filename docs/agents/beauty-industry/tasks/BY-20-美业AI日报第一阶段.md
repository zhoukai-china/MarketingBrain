# BY-20 美业 AI 日报第一阶段

状态：同日一次性人工终验已按授权 fail-closed；QA-20260826-003 保持打开，正式调度/导航/部署未开放

## 归属

- 产品：美业智能体｜门店 AI 经营大脑
- 层级：产品专用，复用既有日报结构与平台账本/自动化基础设施
- 风险：高（公开来源真实性、自动调度、多实例幂等、费用、产品权限）
- 预计修改热点：美业日报合同/服务/路由、自动化任务与持久快照、BeautyIndustryShell 页面、WorkBuddy 合同、专项 Eval、产品文档
- 是否允许并行：否；BY-19 暂缓但不在本轮编码，禁止其他美业任务

## 用户结果

获权美业门店每天北京时间 09:00 可查看同一份有真实来源证据的“美业 AI 日报”，服务错过 09:00 时只补跑一次；页面支持状态恢复、历史日期和受权人工重试。

## 本次范围

- 固定 `beauty-industry / beauty_daily_brief / beauty.daily_brief / operations:daily-brief` 产品合同，第一阶段不读取租户私有经营资料。
- 固定 15 条、5 版块、每版块 3 条、3 趋势、1 今日动作及逐条来源/日期/核验状态/美业细分类标签。
- 复用现有日报结构经验，但美业来源、相关性、合规、污染与事实门禁独立验证；不改坏通用日报。
- 复用数据库自动化任务与账本能力，按产品+北京时间业务日期+合同版本唯一；09:00 正常任务、错过后的单次补跑、人工重试共用日键和终态。
- controlled mock 仅使用全合成来源夹具并显著标为测试结果；正式自动任务与外部读取默认禁用。

## 本次不做

- 不访问真实资讯源、不调用真实文本/图片/视频/ASR Provider，不产生费用。
- 不正式开放导航或 WorkBuddy 工具，不部署生产。
- 不做微信/企微推送，不读取经营档案做个性化，不恢复 BY-19。
- 不复制静态 HTML 的文字、品牌或独立玫瑰粉样式。

## 验收条件

1. 正常路径：08:59 不运行，09:00 恰好一项；同日多实例/多租户复用唯一任务与成功快照；历史按北京时间日期读取。
2. 失败路径：24 小时来源不足扩到 72 小时，仍不足则来源不足失败关闭；404、过期、重复、跨行业、事实不符、医疗/疗效违规、Provider/账本/租约中断均有可恢复终态。
3. 不应发生：静态 fallback 冒充实时、来源不足凑满15条、跨产品内容、重复调用/扣费、无限重试/换模、私有租户资料进入公共日报。
4. 可观测结果事件：计划、排队、采集、核验、生成、合同校验、成功/来源不足/失败；记录业务日期、截止时间、触发类型、窗口、计数、租约、账本和下次 09:00，不记录 Prompt/正文/密钥。

## 基线与失败证据

- 基线命令：`pnpm.cmd beauty-industry:daily-brief-p1-smoke`。
- 修复前失败测试/Eval：`pnpm.cmd beauty-industry:daily-brief-p1-smoke` 首次稳定命中 `AssertionError: 美业日报仍使用旧规划名称`；源码审计同时锁定通用日报静态 fallback/假历史、泛行业来源和缺少美业唯一任务/调度合同。
- 现象、根因和连带影响：现有 `/agents/beauty-industry/daily` 只是规划页；通用 `daily-brief` 失败时会用样板库凑满15条，Web失败时再造离线日报，历史也由静态回退合成，不满足来源真实性、产品权限、持久缓存或09:00多实例调度。

## 实现记录

- 修改文件：`apps/api/src/products/beauty-industry/daily-brief-contract.ts`、`daily-brief-fixtures.ts`、`daily-brief-service.ts`、`mcp-adapter.ts`、`workflows.ts`；`apps/api/src/routes/beauty-industry.ts`、`workbuddy-mcp.ts`、`desktop.ts`、`apps/api/src/config/env.ts`、`apps/api/src/server.ts`；`apps/web/src/components/beauty-industry/BeautyIndustryDailyBrief.tsx`、`BeautyIndustryShell.tsx`、`apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx`、`apps/web/src/styles/beauty-industry.css`；`packages/db/prisma/schema.prisma`、`migrations/202608260002_beauty_daily_brief/migration.sql`；三个 `scripts/beauty-industry-daily-brief-*` 专项、`scripts/beauty-industry-fixed-route-output-p1-smoke.ts`、`.env.example`、`package.json` 与本任务列出的产品文档。
- 数据/接口/配置变化：新增 `BeautyDailyBriefSnapshot` 与 `AutomationTaskType.beauty_daily_brief`，唯一键为 `beauty-industry + Asia/Shanghai 业务日期 + 1.0.0`；新增读取、历史、排队/重试 API 与 WorkBuddy 共用服务。正式 runtime、调度、持续授权、网络/模型/单日费用上限默认均为 disabled/false/0，生产或 live 配置缺失即启动失败。
- 09:00 调度：通过既有 `AutomationTask`、数据库唯一键与快照租约仲裁；08:59 不运行，09:00 正常触发，错过后仅一次 catchup；成功、活动租约或终态不明均不重复。多租户只访问同一公开产品快照，不读取租户私有档案。
- 来源与交付：严格执行 15 条/5 版块/每版块 3 条、3 趋势、1 动作；逐条校验 URL、可访问性证据、日期、24h→72h 窗口、美业相关性、事实一致、去重、来源状态、医疗/疗效和跨行业污染。合成夹具明确标示“测试结果，非实时资讯/非真实模型质量”。
- 兼容性和回滚点：通用 `/daily-brief/*` 与 `DailyView` 保持原行为；美业日报仅挂在 beauty-industry entitlement 下。

## 验证

- `pnpm.cmd beauty-industry:daily-brief-p1-smoke`：PASS；含时区边界、调度/补跑/唯一键/租约、严格结构、24h→72h、来源不足与对抗样例，Provider/网络/费用均为 0。
- `pnpm.cmd beauty-industry:daily-brief-database-smoke`：PASS；5 个并发排队得到 1 个快照/任务，2 个 worker 仅 1 个 claim，租约过期零调用任务可恢复，Provider 终态不明不自动重试；`providerCalls=0 / networkRequests=0 / costYuan=0`。
- `pnpm.cmd beauty-industry:daily-brief-browser-e2e`：PASS；桌面与 390px、15 条/5 版块/15 来源链接、刷新历史、双租户复用公开缓存、console error 0、Provider 0。
- `pnpm.cmd beauty-industry:fixed-route-output-p1-smoke`、API/Web typecheck、`pnpm.cmd qa:fast`、`pnpm.cmd qa:regression`、`pnpm.cmd qa:full`（含 build）：PASS。
- `git diff --check`：PASS（仅既有 Windows LF→CRLF 提示，无 whitespace error）。
- 临时验收环境：PostgreSQL `55434/PID10416`、API `3022/listener PID13892/parent PID7252`、Web `5177/PID1164`，均经命令行、cwd 和当前源码身份核验后停止；端口已释放，数据库保留。
- 未运行项：真实公开来源、真实模型、正式 09:00 自动任务、生产部署；缺少用户对持续网络读取、每天付费、自动启用与部署的明确授权。

## 交接

- 费用与缺陷：外部公开来源请求 0、LLM/图片/视频/ASR/媒体 Provider 0，新增费用 ¥0；BY-20 残余 P0=0、P1=1（真实来源+真实模型+持续调度终验未获授权，导航/工具继续规划中）。BY-19 另有暂缓 P1=1，不属于本任务。
- 持续运行授权请求（未授权不得执行）：
  1. 允许只读访问 `www.cac.gov.cn`、`www.miit.gov.cn`、`www.caict.ac.cn`、`www.jiqizhixin.com`、`www.leiphone.com`、`www.tmtpost.com` 的公开页面；每天最多 6 个列表页 + 30 个详情页（36 次 HTTP、最多 40 个候选），先取截至 09:00 的 24h，不足再扩至 72h；不使用付费 Web 搜索，不读取登录态或租户私有资料。
  2. 只有来源门禁得到 15 条合格候选才调用 `deepseek-v4-pro` 每业务日最多 1 次，thinking disabled，输入最多 25,000 tokens 且 `maxPromptBytes=100,000`，输出 `max_tokens=5,120`；自动重试 0、修复调用 0、换模 0。
  3. 单日模型最坏费用建议硬上限 ¥0.13；31 日月度硬上限 ¥4.10、最多 31 次模型调用和 1,116 次来源 HTTP。正常 09:00 与补跑共用同一日键/调用上限；人工重试在已尝试模型或终态不明后新增模型/来源调用上限为 0，任何额外付费重试需重新授权。
  4. 来源不足、HTTP 上限、合同失败、Provider 失败或终态不明立即停止，当日不再自动尝试；不凑数、不换来源域名、不换模型。
  5. 请求用户同时批准：上述持续公开来源读取、DeepSeek 日/月费用、一次受控真实终验，以及终验通过后启用正式 09:00 调度并部署生产。未同时获得这些批准，当前 live 适配器、scheduler、导航和 WorkBuddy 工具保持 fail-closed。
- 恢复点：获得完整授权后仍只恢复 BY-20，先做一次受控真实日报终验；通过来源/Eval/账本/单日唯一键/页面回归后才允许正式启用与部署。不得自行恢复 BY-19 或启动下一任务。
- 最后更新日期：2026-08-26

## 六域 parser 根因审计与零网络适配（2026-08-26）

- 范围与证据边界：只读取三次终验已持久化的脱敏 `AutomationLog.metadata`、任务/账本终态和当前源码；未读取、恢复或输出网页正文、完整查询参数、Prompt、模型正文、Cookie、密钥。第三次审计库仅通过正式受控环境启动读取，未访问外网。
- 修复前红灯：旧 parser 对整页执行 `cleanText`，再从任意位置取首个日期；离线夹具因此把导航中的 AI 词和页脚日期拼成“普通会议通知”的合格 AI 文章。旧详情失败统一写 `article_contract_rejected`，无法区分缺日期、缺正文、非 AI 或合规拒绝；通用链接只在 `<a>` 后方寻找日期，链接前方的同条目日期会漏失。专项首跑稳定 FAIL 于“导航 AI 词与页脚日期不得冒充文章”。
- 最小修复：建立六个授权域的显式 adapter 注册表（域名、唯一列表入口、监管/研究/行业媒体分类及授权来源）；共享 parser 只处理 RSS item、Atom entry、JSON-LD `headline/datePublished/articleBody`、属性顺序无关的 meta、`time[datetime]`、语义 `article/itemprop=articleBody/main` 和剔除 nav/header/footer/aside/form 后的 body。相对链接与列表前后最近日期确定性归一化；同域 canonical 重新过 HTTPS/精确白名单/端口/凭据/IP literal 安全检查，跟踪参数不进入来源唯一键。没有安全结构证据的站点 selector 未凭空新增，CAICT 412 仍 fail-closed。
- 精确失败：详情现在区分 `article_title_missing`、`article_date_missing/invalid/future/outside_72h`、`article_body_missing`、`article_ai_fact_missing`、`article_forbidden`；每域统计新增列表请求状态、日期/正文/AI事实成功与失败计数。不得把缺日期默认为当天、把列表摘要或导航当正文、把搜索/列表页冒充文章。

### 三轮安全审计矩阵

| 域 | 列表状态 | 第三轮列表候选 | 逻辑详情/实际详情 HTTP | 第三轮合格 | 已持久化拒绝 | 日期/正文/AI 分项结论 |
|---|---:|---:|---:|---:|---|---|
| cac | 200 | 0 | 0/0 | 0 | 无详情 | 未进入 parser，未知 |
| miit | 200 | 1 | 1/1 | 0 | `article_contract_rejected=1` | 旧日志未分项，未知 |
| caict | 412 | 0 | 0/0 | 0 | `http_412_adapter_required` | 未读取正文，未知 |
| jiqizhixin | 200 | 0 | 0/0 | 0 | 无详情 | 未进入 parser，未知 |
| leiphone | 200 + 同域302 | 85 | 10/12 | 2 | `article_contract_rejected=8` | 旧日志未分项，未知 |
| tmtpost | 200 | 114 | 10/10 | 0 | `article_contract_rejected=10` | 旧日志未分项，未知 |

首次运行只有 `byHost`，详情集中雷峰网且36 HTTP后合格1；前一人工运行29 HTTP/合格0；第三轮29 HTTP/合格2。旧日志没有日期/正文/AI分项，所以不能断言六域72h客观供给不足，也不能断言修复必然达到15条。离线修复能证明 parser 不再误接收整页导航/页脚，同时能对后续真实请求给出可审计分项，但不能把合成 fixture 当真实供给证明。

### 零网络绿灯与范围外阻断

- `scripts/beauty-industry-daily-brief-parser-p1-smoke.ts` 覆盖六域各自正常、空、JSON-LD/meta 变体、缺日期、缺正文、站内302、412、404；另重放0候选/2候选的脱敏拒绝分布，断言29次请求、雷峰网12个实际详情 HTTP、钛媒体非AI与雷峰网缺日期的精确归因。全部使用注入 fetch，外部网络/Provider/费用均0。
- `beauty-industry:daily-brief-live-p1-smoke`、原日报专项、数据库隔离、API/Web/Agent typecheck、`qa:regression`、独立 build PASS；`quality:assets` 如实 FAIL 于四份范围外、未提交的兰琪正式包 `lanqi-{compliance,content-diff,xhs,zhaoshang}/examples/sample-grade.md` 缺“用户输入/样板输出”段。它们由 `packages/skills/lanqi-hq-manifest.json` 归属兰琪总部约束链，本轮未改；须后续独立串行 P1 先补 provenance/owner 和格式红灯，不得在 BY-20 混改或把 `qa:fast/full` 记为 PASS。
- WorkBuddy 候选隔离复核：BY-20 运行链对 `mcp-skills/candidates|intake|quarantine` 引用0，仍只引用 Codex 正式日报 Skill。

### 最后一次真实终验授权

- 用户明确只允许最后一次：若仍在北京时间 `2026-08-26`，关联原失败日键，运行前必须核对既有累计 HTTP=94、模型=0；新 grant 创建即消费、不可重放，新增 HTTP≤36、同日审计累计≤130。若实际跨日则使用真实新日键，禁止伪造日期、清零/覆盖旧计数或改合同版本绕过。
- 其余边界不变：原六域、列表≤6、详情/白名单跳转≤30、总新增≤36、公平配额、每资源最多2跳、24h→72h、候选≤40；仅≥15且多样性/URL/日期/AI事实/合规/去重全过后调用 `deepseek-v4-pro` 1次，thinking disabled，输入≤25,000 tokens/100,000 bytes，输出≤5,120，重试/修复/换模/追加=0，费用≤¥0.13。
- 若仍失败：绝不第五次；BY-20/QA 标为 PAUSED/业务阻塞，scheduler/导航/WorkBuddy日报工具/部署继续关闭，然后只做当前源码既有美业功能的本机免邀请码环境维护。若成功：才进入既有全套集成、兰琪资产独立质量修复、09:00启用与生产部署链。

## 受控真实终验（2026-08-26）

- 授权：用户批准固定六域名持续只读、`deepseek-v4-pro` 每日最多 1 次/单日 ¥0.13/月度 ¥4.10，并批准“真实终验通过后才启用 09:00 与部署生产”。执行顺序未改变。
- 零费用 live 实现：新增固定六域名采集器、禁 Cookie/登录/站外重定向、6 列表+30 详情/36 HTTP、40 候选、24h→72h、Prompt `25,000 tokens + 100,000 bytes` 双门、输出 5,120、日/月模型与费用预检、请求前持久计数、来源溯源和无 fallback 合同；通用日报 fallback 与扩域热点抓取均未复用。
- 红绿灯：新 `beauty-industry:daily-brief-live-p1-smoke` 修复前因 live 模块不存在稳定 FAIL；修复后固定域名、36 次硬上限、站外 302 阻断、预算和合成采集 PASS。日报原专项、API/Web typecheck、`qa:fast`、`qa:regression`、`qa:full`（含 build）和 `git diff --check` 全部 PASS。
- 隔离环境：仓库外 `F:/思潼AI增长os/test-environments/beauty-industry-by20-live-20260826`；PostgreSQL `55434/PID19084`、API `3016/PID20976`、Web `5176/PID6276`，源码/runtime 指纹均为 `E98C4A2CF0A6C7DB45DC6F80911961BD17AB657A930F33B1966E3220552CFB1F`，`/ready ok=true/database=true/provider configured=true`。测试租户与账本为全合成、仅 `beauty-industry` entitlement。
- 唯一真实终验结果：北京时间业务日 `2026-08-26`，列表 6、详情 30、总 HTTP 36、候选 1、状态 `source_insufficient`；DeepSeek 0 次、tokens 0、模型费用 ¥0、AgentRun 0、日报快照未成功、任务失败关闭。未读取私有资料，未保存整页正文/Prompt/模型正文/密钥，未重试、未换域、未扩 72h 以外窗口。
- 脱敏域名观测：`cac 1×200/215ms`、`miit 2×200/299ms`、`caict 1×412/288ms`、`jiqizhixin 1×200/103ms`、`leiphone 30×(200/302)/9473ms`、`tmtpost 1×200/345ms`；站外重定向阻断 14。详情预算被标题优先排序集中到雷峰网，其他域名详情覆盖不足，这是下一次终验前必须以离线 fixture 修复的来源配额 P1；不能用本次失败结果推断其他域名没有合格内容。
- 放行结论：真实成功门禁未满足，scheduler/live adapter 的生产配置、导航、WorkBuddy 正式工具继续 fail-closed；**未部署生产**、未修改生产、无生产版本/链接/09:00 计划。BY-20 残余 P0=0、P1=1。
- 恢复点：先在同一 BY-20 内为“六域详情公平配额 + 412/302 明确失败归因”建立离线红灯并做零网络修复；之后需重新取得一次真实来源/模型终验授权。不得复用本次已终止日键，不得在未授权情况下追加 HTTP 或模型调用，也不得恢复 BY-19/启动其他任务。

## QA-20260826-003 零网络修复（2026-08-26）

- 修复前红灯：六个白名单域均有候选、首域有 30 条时，旧全局排序稳定得到详情请求 `30/0/0/0/0/0`，证明单域可以吞掉全部预算；旧观测只有 `host/kind/status/elapsedMs`，无法区分站内、白名单跨域、站外、循环/超限 302，也未把 412 标为适配器不可访问。
- 公平调度：候选按域分桶，域内按美业相关性与截止日前新鲜度排序；首轮以轮询方式为每个有候选域最多分配 5 个详情，全部有候选域完成首轮后才轮询重分配；单域逻辑详情绝对上限 10，总详情 HTTP（含跳转）≤30、列表+详情/跳转总 HTTP≤36。候选不足域可释放额度，但单域不能再次占满 30。
- 跳转与安全：只有限跟随同白名单域规范跳转和六域间跳转，最多 2 跳；每个实际请求/跳转均在请求前计入同一 36 次硬预算，最终 URL 重新通过 HTTPS、精确域名、凭据、端口和 IP-literal 安全校验。站外、循环、超限、无效 Location 均停止；不使用 Cookie、登录态、反爬绕过或隐式重试。
- 归因与可观测：每次请求只记录脱敏 `domain/status/finalDomain/redirectClass/stage/retryable/requestBudgetImpact/originDomain`；412 固定归因为 `http_412_adapter_required` 且不重试，429/5xx 只标可重试性但本采集器不自动重试。按域记录列表候选、首轮额度、已分配逻辑详情、实际详情 HTTP、合格/拒绝原因和剩余候选，不保存正文或完整查询参数。
- 来源多样性：模型前候选池至少 4 域，且必须同时包含监管、研究、行业媒体三类；正式 15 条结果任一域不得超过 6 条，每版块至少 2 个来源域，仍须满足真实性、时间、美业相关性与合规门禁，不能为多样性放宽其他合同。
- 合成覆盖：六域都有候选、部分域为空、单域海量、同域/白名单跨域/站外 302、循环/超限、412、404、429、5xx、恰好 36 次预算和来源垄断失败关闭均 PASS；注入 fetch 全程真实网络 0、Provider 0、费用 ¥0。
- 文件归属：`apps/api/src/products/beauty-industry/daily-brief-live.ts`、`daily-brief-service.ts`、`scripts/beauty-industry-daily-brief-live-p1-smoke.ts` 及本任务文档。未改数据库、页面、导航、调度开关或生产配置。
- 门禁：live/来源/预算/跳转专项、原日报专项、fixed-route、API/Web/Agent typecheck、`qa:fast`、`qa:regression`、`qa:full`（含 build）及 `git diff --check` PASS；数据库专项因当前 `DATABASE_URL` 指向非该脚本允许的隔离库而在连接前 fail-closed，未连接或修改数据库。未启动 API/Web/浏览器或临时验收进程。
- 当前状态：QA-20260826-003 仍为 P1；只有新的受控真实终验达到 15 条合格候选、一次模型与全部合同门禁后才能关闭。此前 `2026-08-26` 终验日键、36 HTTP 和授权均已耗尽，不得复用。
- WorkBuddy Skill 依赖自查：对 BY-20 产品目录、日报路由/WorkBuddy 路由、server、Agent/Skill 注册、`mcp-skills/skills/ai_daily_brief`、`packages/skills/skills/ai_daily_brief` 和日报专项做静态追踪，`mcp-skills/candidates|intake` 及 `candidates/workbuddy` 路径引用为 0；两个正式 `ai_daily_brief` 目录均为普通目录、非软链/重解析点。BY-20 运行链不直接或间接加载 WorkBuddy 候选原件，门禁 PASS，无需在本任务复制或迁移 Skill。全量历史候选审计留给 BY-20 完成后的独立任务。

### 第二次真实终验边界（已于 2026-08-26 获授权，等待新日键）

1. 仅访问原六个域；逻辑列表最多 6。列表跳转与详情/详情跳转全部计入同一总 HTTP 硬上限 36；详情阶段实际 HTTP 最多 30。六域有候选时首轮每域最多 5 个逻辑详情，首轮完成后轮询重分配，单域逻辑详情最多 10；每个资源最多跟随 2 次、仅白名单内的跳转。
2. 使用新的北京时间业务日键（建议 `2026-08-27 / contract 1.0.0`），不得复用 `2026-08-26` 已终止日键；仍为 24h 不足才扩至 72h、候选最多 40。
3. 只有至少 15 条且通过来源多样性、URL/日期/事实/美业/合规/去重门禁才调用 `deepseek-v4-pro` 1 次；thinking disabled，输入≤25,000 tokens、`maxPromptBytes≤100,000`，输出 `max_tokens≤5,120`，自动重试/修复/换模/追加调用均为 0。
4. 模型单日费用硬上限 ¥0.13；来源不足、预算耗尽、跳转/HTTP、合同、Provider 或终态不明任一失败即停止，不发布、不保存成功快照、不增加当日调用。终验通过后才恢复正式 scheduler/导航/WorkBuddy 并进入已授权部署流程。授权已具备，但必须等待非 `2026-08-26` 的实际新业务日键。

## 第二次真实终验授权与日期门禁（2026-08-26）

- 用户已批准第二次真实终验及 `deepseek-v4-pro` 最高 ¥0.13，边界与上一节完全一致；终验和全量回归全绿后，既有的 09:00 自动任务启用及普通生产部署授权继续有效。
- 调用前读取系统权威时钟为 `2026-08-26T12:27:11+08:00 / China Standard Time`。首次终验已经消耗 `2026-08-26 / contract 1.0.0` 日键的 36 次 HTTP；新授权明确禁止复用该日键。因此本次在任何外部六域请求、Provider、数据库任务或环境启动前 fail-closed，实际新增 HTTP=0、Provider=0、费用 ¥0、生产变更=0。
- 不允许通过伪造业务日期、修改系统时钟、建立绕过正式唯一键的临时验收键或重置旧计数执行。下一合法执行点为北京时间 `2026-08-27 09:00` 截止后，使用实际 `2026-08-27 / contract 1.0.0` 新日键。
- 已在 Codex 中提交一次性 `2026-08-27 09:05 Asia/Shanghai` 本任务恢复建议；恢复时仍须重新核对当前时间、git、端口/PID/runtime、测试租户、日/月账本、请求计数器和 Provider 配置，不相信本节记录的任何旧进程状态。
- 当前仍为 QA-20260826-003/P1 打开；scheduler、导航、WorkBuddy 正式日报工具和生产部署保持 fail-closed。不得在等待期恢复 BY-19 或其他任务。

## 同日一次性人工真实终验（2026-08-26）

- 授权覆盖：用户取消等待次日日键，明确授权北京时间 `2026-08-26` 额外一次人工终验。新增 HTTP 最多 36、与首次 36 次合并审计上限 72；生产日常预算仍为 36，不能继承本例外。DeepSeek 当日仍最多 1 次/¥0.13；首次为 0 次，因此本次理论上最多 1 次。
- 红灯与最小实现：普通 `product+businessDate+contractVersion` 唯一链只会复用首次失败快照，无法表达同日独立授权。新增 `daily-brief-manual-acceptance.ts`、独立 live runner、postflight 和专项 smoke：一次性 grant 直接使用不可重复的 `AutomationTask.id`，创建即消费，关联原日键/快照及旧 36 次计数；每个新 HTTP 在请求前以 Serializable 事务写审计日志。该入口没有路由、Web 或 WorkBuddy 参数，`productionBudgetInherited=false`，没有修改正式日键、系统时钟、合同版本或生产 36 次上限。
- 受控环境：仓库外 `F:/思潼AI增长os/test-environments/beauty-industry-by20-manual-live-20260826`，从已安全停止的首次终验数据库克隆，runtime/logs 全新。PostgreSQL `55434/PID32260`、API `3016/PID20356`、Web `5176`；API 命令行为当前仓库绝对 TSX bootstrap，runtime/源码指纹 `2BD2855E72CCED6AB7C24B52BCF1FA0F6E88D53E54DF653B0D652F09239AB770`，`/ready ok=true/database=true/deepseek configured=true`，scheduler=false，媒体 Provider 未启用。完成后正式 stop 脚本通过 API/Web/runtime 双重身份门禁并以 `pg_ctl -m fast` 停止数据库，3016/5176/55434 均无监听；审计数据库保留。
- 唯一 grant：`by20-manual-20260826-a58a3267ba31f315`；run key 为 `beauty-industry:2026-08-26:1.0.0:manual-acceptance:<grant>`，已消费且状态 `failed`，不可重放。父日键仍保持 `source_insufficient / networkRequestCount=36 / providerCallCount=0`，没有清零、改版或覆盖。
- 真实结果：本次新增列表 6、详情/白名单跳转 23、总 HTTP 29；同日累计 `36+29=65≤72`。脱敏每域实际 HTTP 为 cac/miit/caict/jiqizhixin/leiphone/tmtpost=`1/2/1/1/13/11`；caict=`412 adapter_required`，雷峰网页面内 302 有限跟随，站外跳转 0。逻辑详情分配 miit/leiphone/tmtpost=`1/10/10`，其余域列表未给出合格详情候选，单域逻辑上限 10 生效。
- 来源门禁：24h 合格 0、72h 合格 0；21 个已读取详情均因严格文章合同（时间+AI+美业+合规）拒绝。故在模型前停止：`deepseek-v4-pro=0`、tokens=0、费用 ¥0、AgentRun=0、CreditReservation/Transaction=0、未发布快照、未保存 Prompt/网页正文/模型正文/密钥。
- 回归：人工 grant 红绿灯、live/来源/预算/跳转、日报原专项、PostgreSQL 唯一键/租约专项、API/Web/Agent typecheck、`qa:regression`、独立 `build` 与 `git diff --check` PASS。`qa:fast`/`qa:full` 被 BY-20 范围外四份既有 `packages/skills/skills/lanqi-{compliance,content-diff,xhs,zhaoshang}/examples/sample-grade.md` 缺少“用户输入/样板输出”段落阻断；manifest 证明它们是 WorkBuddy 维护且与美业门店智能体分离的兰琪总部约束资产，本轮未跨产品修改，`qa:full` 因 fast 前置失败未进入其内部 build，故单独 build 已 PASS。应由总调度为兰琪资产质量格式另建独立 P1。
- 放行结论：真实 15 条门禁仍未满足，QA-20260826-003/P1 与 BY-20 保持打开；正式 scheduler、日报导航/WorkBuddy 工具和生产配置继续 fail-closed，**未部署生产**。现有公网入口仍是旧生产版本，只能测试已经开放的美业智能体能力，不能测试正式美业 AI 日报。
- 文件归属：新增 `apps/api/src/products/beauty-industry/daily-brief-manual-acceptance.ts`、`scripts/beauty-industry-daily-brief-manual-acceptance-p1-smoke.ts`、`scripts/beauty-industry-daily-brief-manual-live-acceptance.ts`、`scripts/beauty-industry-daily-brief-manual-postflight.ts`；更新 `package.json` 及 BY-20/产品质量文档。未修改页面、正式路由、数据库 schema、生产配置或其他任务功能。
- 恢复点：不要再次使用本 grant、2026-08-26 来源授权或追加模型调用。下一步仍需在同一 BY-20 内解决“六个现有域在 72h 严格合同下无法形成 15 条美业+AI候选”的真实来源适配/产品来源组合问题，并在获得新的外部读取/模型授权后重验；不得通过放宽事实门禁、反爬绕过、扩域或旧闻凑数关闭 P1。
- 最终一次性用户验收门：本次不邀请用户测试半成品、不生成邀请码。只有 BY-20 真实终验通过，并以当前权威仓库源码/指纹形成生产候选后，才在同一任务内做 BY-18 选题、BY-17 小红书、BY-13 视频数据复盘、BY-15 视频内容复盘、BY-16 直播复盘、BY-14 导航/深链和 WorkBuddy 正式 Skill 隔离的集成回归与公网桌面/390px验收；任何红灯先按 P1 修复。部署、09:00 调度、预算/日志/回滚探针全部通过后，才一次性提供用户入口；如需邀请码，仅在最终反馈显示一次 24 小时/1 次 beauty-industry 邀请码。

## 两层事实合同零网络 P1（2026-08-26）

- 产品根因：同日人工终验已经公平读取 21 个详情，但旧 `parseBeautyDailyBriefArticle` 要求正文同时命中 AI 词和美业词，导致真实通用 AI 新闻在来源层全部被拒。这里不是六域没有 AI 新闻，也不是模型能力问题，而是把“新闻来源事实”和“美业解释”错误合成了同一个准入条件。
- 修复前红灯：通用大模型能力更新有六域 URL、发布日期和 AI 核心事实，但无美业词时 parser 返回 `undefined`；非 AI 促销通知同样返回 `undefined`。该红灯只证明美业词误杀，未降低 AI 真实性门禁。
- 来源事实层：允许六域内真实通用 AI、模型、产品、监管、产业、企业/零售/本地服务改造新闻；固定核验标题、URL、发布日期、核心事实、来源行业、直接美业证据、去重、24h→72h 和来源状态。非 AI、超窗、无日期、无来源、合规污染仍拒绝。
- 美业解释层：正式 `ai_daily_brief@1.0.0` 和产品 JSON 合同新增 `sourceFacts/sourceIndustry/inferenceLabel/possibleImpact/applicabilityConditions/verificationNeeded`。`summary/sourceFacts` 只能来自来源证据；`beauty_interpretation` 必须写“可能/若/需核验”边界，页面分开展示思潼点评、可能影响、适用条件和建议验证。
- 失败关闭：通用 AI 被改写成已在美业发生、编造门店/顾客/品牌/价格/疗效/数字、推断未标记、sourceIndustry 漂移、逐条事实无证据、跨行业案例冒充美业案例，均在保存前拒绝。企业改造案例可保留原行业并说明可借鉴点，不能改成真实美业案例。
- 解析与预算：参考资料中 RSS/Atom 的确定性解析思想经独立红灯后由 Codex 在正式采集器实现；支持 RSS `item`、Atom `entry` 和通用 `<a>`，统一去重并进入既有六域公平队列。没有复制/调用 WorkBuddy 代码，没有新增域名、搜索、Cookie、重试、请求或时效窗口。
- 文件归属：`apps/api/src/products/beauty-industry/daily-brief-contract.ts`、`daily-brief-fixtures.ts`、`daily-brief-live.ts`；`apps/web/src/components/beauty-industry/BeautyIndustryDailyBrief.tsx`、`apps/web/src/styles/beauty-industry.css`；`mcp-skills/skills/ai_daily_brief/SKILL.md`、`packages/skills/src/index.ts`、`packages/skills/skills/ai_daily_brief/{prompt.md,contract.json,examples/sample-grade.md}`；日报 live/browser smoke 与本任务文档。
- 绿灯：21/21 通用 AI 合成详情进入来源池；非 AI 0/1；真实直接美业案例可进入；虚构美业事实、无来源经营数字、未标记推断、来源事实不接地与跨行业冒充全部失败关闭。六域公平、≤36 HTTP、候选至少4域+监管/研究/行业媒体、正式单域≤6/版块≥2域保持原门禁。
- 质量门禁：日报/live/人工 grant/数据库、fixed-route、WorkBuddy共享路径、API/Web/Agent及全仓 typecheck、`qa:regression`、独立 build PASS；数据库 5 并发/2 worker/租约恢复/终态不明继续 `provider=0/network=0/cost=0`。`qa:fast/full` 仍被范围外兰琪总部四份 WorkBuddy 来源样例缺统一标题阻断，不能标 PASS。
- 页面 E2E：补了“等待日报异步状态恢复后再断言”的测试红灯；本轮受控环境保留了同日真实失败快照且日报 runtime=disabled，无法在不删除审计记录/改变环境授权的情况下生成受控 15 条，因此未把该环境冒充桌面/390px绿灯。此前页面专项仍有效，本次新字段由 Web typecheck、静态合同与 build 覆盖；新真实终验后的生产候选仍必须做完整桌面/390px/控制台验收。
- 环境：正式 start 脚本启动受控根 `F:/思潼AI增长os/test-environments/beauty-industry-by20-manual-live-20260826`，源码/runtime 指纹短值 `0FA06D60`，`/ready database=true`，日报外部 adapter/Provider未调用。停止前双重身份为 API `3016/PID30200`、Web `5176/PID20652`、PostgreSQL `55434/PID26804`；正式 stop 脚本 exit 0，停止后 `3016/5176/55434` 监听均为 0、三个 PID 均不存在，审计数据库和未提交源码保留。
- 费用/放行：真实新闻 HTTP 0、DeepSeek/媒体 Provider 0、新增费用 ¥0、未部署。QA-20260826-003/P1 与 BY-20 继续打开，正式 scheduler、导航、WorkBuddy日报工具和生产保持 fail-closed；旧 grant 不可复用。

### 非权威参考文档采纳/拒绝矩阵

参考：`C:/Users/book/WorkBuddy/2026-08-25-17-39-34/CODEX交付_美业AI日报_采集逻辑.md`，完整读取 122 行/8,844 bytes。该文件只提供历史说明和建议，不是授权、正式合同或运行资产，未复制/运行其中代码。

| 参考内容 | 处理 | 本任务边界 |
|---|---|---|
| source build → fetch → parse → relevance → score → verify 分层 | 采纳设计思想 | 当前采集器继续以列表/详情、解析、AI相关、事实/多样性核验和脱敏观测分段；不调用 `scanIndustryTrends()` |
| RSS item、Atom entry、通用链接/日期确定性解析 | 采纳并独立实现 | 只用脱敏 fixture 红绿灯；仍走六域、白名单跳转和36 HTTP总预算 |
| AI_TERMS、强事件词、低价值标题惩罚、来源信任分级 | 部分采纳 | 本轮保留/加强 AI 词与 primary authority 语义；未把建议分数直接当正式阈值，未放宽事实门禁 |
| 通用 AI 新闻不应因缺美业词被拒 | 采纳 | 美业词仅用于直接美业证据、解释标签和适用细分，不作为来源事实必要条件 |
| 复用 `scanIndustryTrends()`/WorkBuddy运行资产 | 拒绝 | BY-20 使用 Codex 正式采集器与 `ai_daily_brief@1.0.0`，候选路径引用0 |
| score降到8、放行 `public_unverified`、14–30天 | 拒绝 | 继续24h→72h、严格来源/事实/日期/状态失败关闭 |
| fallback/`trend_observation` 补满15条 | 拒绝 | 来源不足不发布、不调用模型；趋势观察不得冒充当日新闻 |
| 搜狗和美业垂直新域名清单 | 仅登记未来调研输入 | 当前不访问、不加白名单，不改变六域、36 HTTP、无登录/Cookie边界 |

### 第三次真实终验授权边界（随后已按下一节执行）

1. 仅原六域，逻辑列表≤6；详情和所有白名单跳转实际 HTTP≤30；单次总 HTTP≤36。首轮每个有候选域≤5，首轮完成后轮询重分配，单域逻辑详情≤10，每资源白名单内最多2跳。
2. 使用新的、明确授权且不可复用旧 grant 的受控终验 run；24h不足扩72h，候选最多40。外部每次请求前启用持久计数；任何来源/预算/终态失败立即停止。
3. 只有来源事实层得到≥15条且候选至少4域、含监管/研究/行业媒体、正式单域≤6/版块≥2域，并通过URL/日期/AI事实/去重/合规后，才调用 `deepseek-v4-pro` 1次。
4. 模型 thinking disabled，输入≤25,000 tokens、`maxPromptBytes≤100,000`，输出 `max_tokens≤5,120`；自动重试0、修复0、换模0、追加0；人民币最坏上限仍为 ¥0.13。
5. 成功门禁增加两层合同：15条 `sourceFacts/sourceIndustry` 全部接地，`beauty_interpretation` 全部有推断标签/适用条件/建议验证，fallback=false；唯一快照/任务/账本一次结算，Web/WorkBuddy一致。失败不发布、不部署、不启用09:00。

## 第三次同日人工真实终验（2026-08-26，已终止）

- 授权与红灯：用户明确新增最多36次HTTP及DeepSeek最高¥0.13；旧runner仍固定同日72上限，对101授权稳定返回 `same_day_http_limit_invalid`。最小修复只作用于无路由的一次性runner：grant显式声明既有累计65/模型0，创建前从数据库核对父快照36、前一人工29及模型0；每个新HTTP按全日既有manual日志原子计数，生产常规36上限未改。
- 受控身份：从已安全停止且保留65次审计的数据库建立全新根 `F:/思潼AI增长os/test-environments/beauty-industry-by20-manual-live3-20260826`。启动前3016/5176/55434均空闲；当前源码/runtime指纹 `4CCA349B…`，`/ready database/provider=true`、scheduler=false、媒体disabled。DeepSeek最坏预检 `¥0.122635≤¥0.13`。
- 唯一grant：`by20-manual-20260826-11987f9de6ee476a`，父日键仍为 `beauty-industry:2026-08-26:1.0.0`。grant创建即消费且不可重放，不清零或覆盖前两轮审计，不暴露为Web/WorkBuddy参数，`productionBudgetInherited=false`。
- 真实请求：本次列表6、详情/白名单跳转23、合计29；同日累计 `65+29=94≤101`。每域HTTP cac/miit/caict/jiqizhixin/leiphone/tmtpost=`1/2/1/1/13/11`；caict 412归因 `adapter_required`，雷峰网有限同域302，站外跳转0。
- 来源结果：24h合格0、72h合格2，且2条均来自雷峰网；miit详情1、雷峰网8、钛媒体10因文章合同拒绝，其余列表未形成详情候选。两层合同已移除“必须含美业词”的错误要求，故新证据表明当前六域列表/解析在固定72h与详情30预算内仍无法形成15条和至少4域多样性。
- 停止结果：来源门禁失败后立即停止，DeepSeek/其他Provider=0、tokens=0、费用¥0、AgentRun=0、CreditReservation/Transaction=0、未发布、未部署、未启用09:00；未执行四份兰琪资产P1或生产集成门禁。
- postflight与环境：postflight核对task=`failed`、新增29、累计94、模型0、AgentRun/账本0。停止前API `3016/PID18504`、Web `5176/PID29920`、PostgreSQL `55434/PID6492` 与runtime/监听/指纹一致；正式stop exit0，停止后三端口监听和三PID均0，审计数据库保留。
- 当前恢复点：QA-20260826-003/BY-20继续打开，P0=0、残余P1=1。旧grant与本grant均不可复用；scheduler、导航、WorkBuddy日报工具、生产和用户测试入口保持fail-closed。下一步必须先对六域列表/日期/正文parser做脱敏只读根因审计并提出不扩域、不增加HTTP预算的最小适配方案；未经新授权不得再联网或调用模型。

## 最后一次真实终验与暂停结论（2026-08-26）

- 唯一 grant：`by20-manual-20260826-28a0f3febeb14695`，关联原 `beauty-industry:2026-08-26:1.0.0` 失败日键；创建即消费、不可重放，没有清零/覆盖旧审计，也未暴露为 Web/WorkBuddy 参数。执行前前三轮累计HTTP=94、模型=0。
- 真实请求：新增列表6、详情/白名单跳转23、合计29；同日累计 `94+29=123≤130`。每域HTTP cac/miit/caict/jiqizhixin/leiphone/tmtpost=`1/2/1/1/13/11`。
- 来源结果：24h=0、72h=1。CAC列表网络失败；MIIT详情拒绝 `article_title_missing`；CAICT 412=`http_412_adapter_required`；机器之心列表0；雷峰网1条合格，其他拒绝为超72h4、日期无效1、日期缺失2、AI事实缺失1、未来日期1；钛媒体10条均 `article_date_invalid`。
- 停止结果：来源门禁前失败，`deepseek-v4-pro`/其他Provider=0、tokens=0、费用¥0、AgentRun=0、CreditReservation/Transaction=0、未发布、未部署、未启用09:00。postflight纯数据库审计PASS；首个postflight仅因调用者变量名写错查不到task，未触发网络或状态变化。
- 环境：受控根 `F:/思潼AI增长os/test-environments/beauty-industry-by20-manual-live3-20260826` 由正式 stop 脚本停止，exit0；停止后3016/5176/55434均无监听，审计数据库与日志保留。
- 最终状态：BY-20=`PAUSED / 业务阻塞`，QA-20260826-003继续P1，范围内P0=0、残余P1=1；绝不执行第五次，不再申请同类付费终验。scheduler、日报导航、WorkBuddy日报工具、live adapter生产配置和日报部署全部保持fail-closed。
- 下一恢复点：只搭建当前权威源码的本机免邀请码既有功能验收环境，验证BY-13/14/15/16/17/18、权限/租户/账本/幂等；文本为明确标识的controlled_mock，媒体disabled，费用¥0。不得恢复BY-19或开发新功能。

## PAUSED 后的本机既有功能验收环境（2026-08-26）

- 环境身份：复用已经正式停止并保留审计库的仓库外受控根，以默认零费用模式重启当前源码。PostgreSQL=`55434/PID22092`、API=`3016/PID24184`、Web=`5176/PID10556`；runtime PID与监听一致，源码/runtime指纹=`56957C79AD596D9BF5EEF4F37D6B8DA5D4F9FACED684D8639F6DBE94C75E4013`，`/ready database=true`、Web=200。
- 模式：`NODE_ENV=development`且仅绑定127.0.0.1；文本=`controlled_mock`，页面明确为测试输出；媒体=`disabled`，日报scheduler/live/导航/WorkBuddy日报工具仍fail-closed。实际外部文本/图片/视频/ASR/媒体Provider=0、费用¥0。
- 免邀请码边界：使用现有本地开发专用 `/auth/dev-login` 与产品限定 `productCode=beauty-industry` 创建全合成租户/用户、`local_standard`和仅beauty-industry entitlement；生产环境仍404。入口的一键按钮已由真实Chrome点击验证，刷新仍保持授权会话；没有改产品认证逻辑，token/secret未写URL、仓库、报告或日志。
- 模块门禁：`beauty-industry:web-contract-smoke`覆盖首页/导航、选题2/4、内容十件套、XHS事实保留、视频数据、视频内容视觉+ASR准入、直播八模块、WorkBuddy、租户/权限/账本/幂等并PASS；API/Web/Agent typecheck、`qa:regression`、build、diff PASS。
- 浏览器：Chrome桌面+390px导航/双租户、XHS生成保存/刷新/重复点击、视频内容预检/证据/刷新/返回、直播数据/证据/八模块/刷新/返回全部PASS，console error=0、external Provider=0；本机一键免邀请码与390px刷新恢复也PASS。选题旧Playwright脚本因仓库未安装其未声明依赖，在浏览器启动前报`Cannot find module 'playwright'`，不作为产品失败；正式选题专项和导航Chrome仍PASS。
- 全仓限制：`quality:assets`如实FAIL于四份范围外、未提交的兰琪总部正式包`lanqi-{compliance,content-diff,xhs,zhaoshang}/examples/sample-grade.md`缺“用户输入/样板输出”；因此`qa:fast/full`不得标PASS。本环境不修改这些资产。
- 用户入口：`http://127.0.0.1:5176/login/beauty-industry?apiBase=http%3A%2F%2F127.0.0.1%3A3016`，点击“本机直接开通并进入美业智能体”。环境保持在线；停止命令只能是 `& 'F:/思潼AI增长os/baolu-os-v2-source/scripts/acceptance/beauty-industry/stop.ps1' -AcceptanceRoot 'F:/思潼AI增长os/test-environments/beauty-industry-by20-manual-live3-20260826'`。
