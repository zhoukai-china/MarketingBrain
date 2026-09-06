# BY-07 美业 Skill 准入与固定业务编排

状态：部分完成（真实三图通过；真实视频内容解析 P1 阻塞，暂不可交给用户验收）

## 归属

- 产品：美业智能体
- 层级：美业产品专用编排，复用正式通用 Skill、共享 Agent/MCP/账本
- 风险：高（错误路由、虚构事实、文件伪解析、跨租户、重复计费、付费媒体误调用）
- 是否允许并行：否

## 唯一用户结果

用户在品牌中立的美业经营工作台或 WorkBuddy 中显式选择一个已开放业务工具后，调用同一套固定后端工作流，得到与该入口一致、事实受控、可保存恢复的结果；未开放或未获费用授权的能力保持关闭。

## 冻结产品结构

- 美业 AI 改造日报、美业知识问题：只显示以后开放，不注册工具。
- 美业获客只有图文获客、视频获客、直播获客三大板块。
- 图文获客：小红书图文生成，标题、正文、标签、图片属于同一任务；真实图片必须报价并明确确认。
- 视频获客：选题系统；内容系统仅有“内容十件套 / 文生视频（规划） / 图生视频（规划）”；视频复盘拆分数据复盘与内容复盘。
- 直播获客：直播话术、直播复盘。
- 投流、DOU+、巨量本地推从美业网页和美业 MCP 下架，底层 Skill 不删除。
- 美业销售正式开放；美业专属交付、经营诊断以后开放。
- `beauty-industry-compliance` 只作为内部自动护栏，不是用户工具。

## 阶段 1：上架准入

候选组合与顺序：

1. 小红书：`wechat-xhs-content-line` → `beauty-industry-xhs` → `beauty-industry-compliance`。
2. 选题：`baolu_topics` → `beauty-industry-content-diff` → `beauty-industry-compliance`。
3. 内容十件套：`baolu_content_creator` v5 → `beauty-industry-content-diff` → `beauty-industry-compliance`。
4. 视频数据复盘：`baolu_review_engine` → `beauty-industry-content-diff` → `beauty-industry-compliance`。
5. 视频内容复盘：`baolu_content_creator` 的 `shooting_editing` → `beauty-industry-content-diff` → `beauty-industry-compliance`。
6. 直播话术：`live_script_planner` → `beauty-industry-compliance`。
7. 直播复盘：`baolu_live_review_engine` → `beauty-industry-compliance`。
8. 美业销售：`sales_growth_advisor` → `beauty-industry-compliance`。

准入硬门禁：正式原始包、运行时 prompt、contract、样例/引用和注册版本一致；显式入口锁定 capability 与组合；缺资料不编造；不串行业/品牌/租户；医疗疗效、价格、案例和素材授权安全；失败、超时、取消有终态；文件未成功解析时不得声称看过；不得自动发布、投流、付款或调用未确认付费媒体。高风险案例重复 3 次，任何一次硬失败即拒绝上架。

## 阶段 2：固定业务编排

- 网页和 WorkBuddy MCP 只做薄适配，共用同一 workflow 定义、组合 Skill、门店档案、任务历史和账本。
- 组合约束在一次模型调用中作为受控 Skill 层加载，内部护栏不重复扣费；运行记录保留主 Skill 与约束 Skill 版本。
- CSV/Excel 必须完成受控解析后才能进入视频数据复盘；视频文件必须完成元数据、画面/关键帧、音频或转写解析后才能进入视频内容复盘。
- 真实图片生成保持两阶段报价确认、幂等、失败释放；新增真实费用需再次确认。

## 阶段 3：验收

- 桌面与 390px：正常、缺资料、加载、取消、超时、断网、重复点击、刷新恢复、返回、文件失败、余额不足、Provider 失败。
- WorkBuddy 协议：tools/list、tools/call、scope、产品凭据、跨租户、幂等、计费失败释放。
- 网页/MCP 对同一输入使用同一 workflow 与输出契约，允许措辞不同，不允许事实和边界不同。
- 运行美业专项、`qa:fast`、`qa:regression`、`qa:full`、`git diff --check`。

## 修复前证据

- 当前 MCP 暴露 `beauty.compliance_check` 与 `beauty.paid_traffic_preview`，违反冻结结构。
- 当前选题只绑定 `beauty-industry-content-diff`，没有执行 `baolu_topics`。
- 当前小红书只绑定 `beauty-industry-xhs`，`wechat-xhs-content-line` 缺正式原始包与注册。
- 当前各业务入口未把美业合规作为真实内部约束层执行。
- `baolu_content_creator` 注册/原始包为 v5.0.0，但运行时 contract 仍写 1.4.0。
- 当前视频数据复盘没有产品级 CSV/Excel 上传解析；视频内容复盘没有受控视频解析执行链。

## 费用与外部动作边界

- 阶段 1 和开发回归只使用零费用确定性 Provider/夹具。
- 不调用图片/视频 Provider，不充值、不发布、不投流、不付款、不部署生产。
- 如最终真实图片质量验收需要新增调用，先报告最小张数与费用硬上限并等待确认。

## 恢复点

如获批真实媒体费用，从同一小红书任务的“确认生成图片”两阶段链路继续；不得新增第四方 Provider 或拆回图片工作室。

## 2026-08-22 完成证据

- 阶段 1：8 个正式组合全部准入，高风险用例各重复 3 次；`wechat-xhs-content-line` 原始包、运行时 manifest/prompt/example 与共享 Skill/Agent 注册一致，`baolu_content_creator` 固定 V5 十件套。
- 阶段 2：网页与 WorkBuddy 共同调用 `workflows.ts + execution.ts`；8 个用户工具固定路由，`beauty-industry-compliance` 仅内部执行。投流、DOU+、巨量本地推已从美业工具、scope、页面表单和上下文下架，OS 底层 Skill 未删除。
- 文件链：CSV/Excel 成功解析后才能运行视频数据复盘；视频文件只有画面/音频/转写证据成功解析后才能运行内容复盘，受控 Provider 未配置时页面明确失败并禁用生成，未扣积分。
- 页面：桌面与 390×844 实际验证三分支、销售、刷新恢复、断网、取消、文件失败、专属 WorkBuddy 连接和 8 工具；移动端横向溢出由 content-box 根因修复，`scrollWidth <= innerWidth`，控制台 warning/error 0。
- 协议：真实 HTTP JSON-RPC 客户端完成 initialize/tools/list/tools/call；3 次 MCP 与 1 次网页受控调用，身份伪造、scope、跨租户、撤销/轮换/过期、余额不足、失败释放和幂等均 PASS；secret 未写入文档或日志。
- 门禁：Skill 准入、workflow composition、固定 mock 路由、网页/MCP contract、`qa:fast`、`qa:regression`、`qa:full`、全仓 build 均 PASS。媒体 Provider 调用 0、费用 0、无生产迁移/部署/外部动作。

## 未开放与残余边界

- 小红书文字、标签与 1/3 张专业配图方向可用；真实图片尚未在本轮新增付费调用，因此不宣称成图质量已验收，页面不展示占位图或假下载。
- 文生视频、图生视频保持规划状态；视频内容复盘的真实 Provider 成功链尚未做付费验收，但失败关闭和文件证据门禁已通过。
- WorkBuddy 已完成真实协议客户端 E2E，未在用户桌面 WorkBuddy 应用中写入 secret 或做生产公网部署。

## 2026-08-23 最终真实 Provider 验收

- 授权边界：本轮新增真实 Provider 总成本硬上限 ¥1；最多 3 张 `wan2.7-image`、最多 1 段不超过 10 秒的合成视频；禁止自动付费重试。未充值、未发布、未投流、未部署、未迁移生产。
- 小红书同页真实三图：3 个 `wan2.7-image` 异步任务全部成功，3 个本地租户资产全部持久化；标题、正文、标签、三张图片、复制、逐张下载和刷新恢复均在同一网页任务通过。真实图片 Provider 成本约 ¥0.60；图片积分曾预留 300，因首轮本地资产保存失败整批释放，恢复同一 Provider 任务后未二次扣费，最终 3 个 job 的 `billingStatus=refunded`。
- 已关闭 P1：Provider 成功后资产域名不在验收 allowlist，且前端并发轮询任一 502 会丢弃整批状态。修复前专项因缺少显式恢复和资产恢复断言 FAIL；最小修复后允许同一 `providerTaskId` 恢复落盘、轮询逐项容错、晚恢复不反向补扣，专项 PASS。没有创建第 4 个图片任务。
- 真实视频内容复盘：唯一一次 8 秒合成 MP4 经网页上传；`/media/analyze` 在约 102ms 返回 200，但没有得到可用的画面分析或音频转写证据。页面正确进入失败终态、生成按钮禁用，后续复盘模型调用 0、积分扣减 0，未声称看过视频。由于本轮明确禁止失败后再次付费调用，未重试。
- 当前放行结论：真实图片链 PASS；视频失败关闭 PASS；真实视频成功解析链 FAIL（P1，Provider/账号能力或请求终态缺少可恢复证据）。因此 BY-07 撤回最终用户验收链接，保留本地环境和三张历史资产用于后续零费用排查。
- 门禁：`beauty-industry:real-media-smoke`、`beauty-industry:journey-p1-smoke`、`beauty-industry:mcp-platform-smoke`、API/Web typecheck、`qa:full`（含 `qa:fast`、`qa:regression` 与 build）均 PASS；真实页面桌面刷新与 390×844（3 图、3 下载按钮、无横向溢出）PASS。自动门禁通过不能覆盖真实视频 P1。

### 准确恢复点

零费用诊断与最小修复已经完成，当前只差一次重新授权的真实合成视频复验：

- 修复前红灯：`beauty-industry:real-media-smoke` 精确失败于“视觉与 ASR 调用缺少安全 Provider 终态观测”。旧实现只保留聚合 warning，丢弃 HTTP/官方错误码、请求指纹、终态和是否开始计费，无法对已结束请求区分权限、地域、模型、请求结构或响应解析错误。
- 本地媒体排除：原 8 秒合成 MP4 可由 `ffprobe` 识别为 H.264 720×1280 + AAC mono 22050Hz；按生产等价命令抽取为 16kHz mono MP3 成功，排除损坏容器、缺音轨和本地抽取失败。
- 已证实契约偏差：ASR 请求错误继承了视觉请求的 `temperature` 参数；现已按 `qwen3-asr-flash` 音频输入契约移除。旧视觉请求的官方错误码没有被保存，不能在零费用条件下把其根因猜成账号权限、地域或模型名。
- 最小修复：视觉/ASR 统一记录安全终态（阶段、Provider/model/region、输入媒体类型、HTTP、官方错误码、脱敏请求指纹、超时/取消、finish reason、聚合 usage 与 `billingStarted`），不记录密钥、媒体/Base64、原始提示词、响应正文或租户标识；页面只显示安全阶段、错误码和指纹。
- 离线证据：纯注入 fixture 覆盖视觉/ASR 成功、部分失败、全失败、超时、取消、相同请求指纹稳定、未进入账本预留，Provider 调用 0；API/Web typecheck 及相邻 BY-07 回归 PASS。
- 尚未关闭：真实视频成功链仍为 P1。不得自动重试或复用旧授权；只有取得新的单次真实费用授权后，才可用同一 8 秒合成视频执行 1 次复验。
- 最终零费用门禁：`beauty-industry:media-observability-smoke`、`beauty-industry:real-media-smoke`、journey/MCP 专项、API/Web typecheck、`qa:full`（fast + regression + build）和 `git diff --check` 全部 PASS；本轮 Provider 调用 0、费用 ¥0。
- 下一次真实复验预算建议：仅 1 次网页上传，最多 2 个同步 Provider 调用（`qwen-vl-max` 视觉 1 次 + `qwen3-asr-flash` ASR 1 次），不自动重试；按 2026-08-23 百炼公开价与 8 秒合成素材保守设置新增费用硬上限 ¥0.20。达到上限、任一失败或终态不明即停止。

## 2026-08-23 单次真实视频复验结果

- 用户授权同一 8 秒合成视频执行 1 次网页上传，最多 `qwen-vl-max` 1 次、`qwen3-asr-flash` 1 次，新增费用硬上限 ¥0.20；任何失败禁止重试。
- 调用前基线：视频内容复盘 `AgentRun=0`、图片任务仍为 3、美业积分预留无悬挂 `reserved`；页面余额 484。验收环境为本地隔离库、受控文本模型。
- 唯一一次上传结果：`POST /media/analyze` 返回 200、约 82ms，但没有可用画面或转写证据；页面明确失败、生成按钮 disabled、复盘文本模型调用 0。控制台 warning/error 0；没有第二次上传。
- 新 P1 根因：验收 API 进程启动于 08:46，而 `media.ts` / `media-provider-observation.ts` 在 09:23–09:25 才更新；`start.ps1` 只检查 `/ready` 并复用旧进程，导致这次请求没有运行新安全观测链。旧进程只返回聚合失败，无法恢复 HTTP/官方错误码、请求指纹或是否开始计费。
- 调用与费用结论：旧路由按配置最多尝试视觉 1 次、ASR 1 次；是否被 Provider 受理及实际计费无法从旧终态证明，安全上按本轮硬上限记录为不超过 ¥0.20。积分预留/交易、视频 `AgentRun`、图片 job 均与调用前一致。
- 放行结论：真实视频成功链仍 FAIL/P1；不提供验收链接。本轮按照失败即停规则没有重启后重放。恢复前必须先修复/验证验收启动脚本会加载当前源码，再取得新的单次授权。

## 2026-08-23 源码新鲜度闭环与零费用恢复

- 外部候选包只作为审查证据逐行语义合并，没有整包覆盖。合并前 `SOURCE_BASELINE` 与主检出区 `start.ps1`、`status.ps1`、`stop.ps1` 的 3 个 SHA-256 基线全部一致，共享热点无漂移冲突。
- 修复前红灯 1：原候选的 50 项离线回归为 50/50 PASS；追加“实际 `Stop-Process` 前必须再次解析并核对进程身份”后稳定为 50 PASS / 1 FAIL。最小修复在停止前执行第二次身份解析，避免预检后 PID 被复用的极低概率窗口。
- 修复前红灯 2：验收 API 仍可能以 `tsx` CLI 父进程启动并把父 PID 写入运行记录，监听端口却属于子进程；新增单进程启动断言后稳定为 51 PASS / 1 FAIL。最小修复改为 Node 直接加载仓库内 `tsx` preflight/loader，使记录 PID、API 进程与监听 PID 为同一进程。
- 旧环境迁移：只在父进程、子进程、仓库根、入口文件和端口全部精确匹配当前验收环境时，才对旧 `tsx` 父子进程做两次身份复核后受控停止；任一不一致均 fail closed，不终止未知进程。
- 离线最终证据：源码指纹、运行记录、端口/PID、旧布局安全迁移、失败关闭与停止前二次身份核验共 53 项全部 PASS；4 个脚本补 UTF-8 BOM 后，系统自带 Windows PowerShell 与 PowerShell 7 均可正确读取中文验收路径，解析检查 4/4 PASS。
- 质量门禁：`beauty-industry:media-observability-smoke`、`beauty-industry:real-media-smoke`、`beauty-industry:journey-p1-smoke`、`qa:fast`、`qa:regression`、`qa:full` 和 `git diff --check` 全部实际 PASS。
- 零费用恢复：持久验收 API/Web/数据库恢复后，`source_fresh=true`、源码与运行指纹短码一致、API 记录 PID 与 3016 监听 PID 一致；`/ready` 返回数据库可用，页面 5176 返回 200。本地受控美业登录后工作台可打开、刷新恢复、三分支与“恢复上次任务”可见，控制台 warning/error 0；隔离库媒体 job 聚合仍为既有 3 条。
- 费用与边界：本阶段没有调用图片、视频、ASR 或文本 Provider，没有新增媒体任务或积分流水，新增费用 ¥0；未做生产迁移、部署、充值、发布或投流。
- 当前恢复点：`QA-20260823-004` 源码新鲜度 P1 已关闭；`QA-20260823-002` 真实视频成功链仍为唯一阻断。下一步必须重新取得单次授权，才可用同一 8 秒合成视频执行一次网页复验，最多 `qwen-vl-max` 1 次和 `qwen3-asr-flash` 1 次，新增费用硬上限 ¥0.20，任一失败或终态不明立即停止且不自动重试。
