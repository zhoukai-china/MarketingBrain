# BY-15 视频内容复盘 Skill 驱动专属页面

状态：完成（2026-08-25；真实视觉+ASR准入、公开恢复及全部回归已通过）

## 归属与范围

- 产品：美业智能体（`productCode=beauty-industry`）；风险：高；禁止并行。
- 固定映射：`beauty.video_content_review / acquisition:video-content-review / shooting_editing / baolu_content_creator@5.0.0 / beauty-industry-content-diff@1.1.0 / beauty-industry-compliance@1.0.0`。
- Web 与 WorkBuddy 共用 `video_content_review_workflow_v1`，包含平台、账号/视频标识、标题/文案、目标、目标人群、转写、画面/时间轴证据、内容结构、事实边界和服务端预检回执；自由文本不得改路由。
- 本任务不开发直播复盘、文生/图生视频、投流或生产部署，不改变视频数据复盘、选题、内容十件套及首页合同。

## 用户结果

用户可从稳定路由 `/agents/beauty-industry/acquisition/video/content-review` 上传真实视频做零费用容器/双流元数据预检，看到缺失证据和影响，补齐当前租户确认的口播与画面证据后进入固定视频内容复盘 Skill。结果按视频基本信息、现有版本诊断和八段优化方案保存到同租户历史；元数据预检本身不冒充“已看过视频”。

## 验收条件

1. 正常：结构化资料、受支持视频预检、口播与画面证据齐全后，Web/WorkBuddy 进入同一 `shooting_editing` 合同并保持账本/幂等。
2. 失败：空输入、缺转写/画面、错格式/MIME、空/损坏/超限文件、错误/超时/取消/重复点击、刷新缺媒体、无权限、越权文件和跨租户均在调用前失败关闭并说明如何补齐。
3. 不应发生：自由文本切 Skill、元数据或模板冒充视觉/ASR、编造画面/口播/案例/疗效/价格/平台数据、持久化媒体、自动重试/换模、跨租户或重复扣费。
4. 真实准入：固定资产哈希匹配；qwen-vl-max 与 qwen3-asr-flash 各仅一次，视觉命中全部登记事实、ASR 命中合成句，两证据进入正式合同且 `fallbackUsed=false`；任一失败则不恢复公开能力。

## 红灯与根因

- 初始红灯：`beauty-industry-video-content-review-workbench-p1-smoke.mjs` 因正式 workflow/专属组件不存在以 `ENOENT` 失败，证明旧页面没有正式合同旅程。
- 资产红灯：旧夹具无音轨，双流固定资产断言先因 manifest 不存在失败；补充本地完全合成的 8 秒 H.264 + AAC 资产后转绿。
- 激活红灯：`beauty-industry-video-content-review-activation-p1-smoke.ts` 首次报 `video content review is not in the executable workflow registry`，证明准入通过前 scope/tool/capability 均未公开。
- 浏览器红灯：真实页面按“预检→补证据”操作时，所有文本更新错误清除 `mediaPreflight`，按钮无法解锁。根因是组件通用 `update` 无条件写入 `mediaPreflight: undefined`；修复为仅重新选择文件或刷新清除回执，并补静态与真实浏览器回归。

## 真实媒体验收

- 用户明确批准本次媒体上传和最高 ¥1 付费调用；实际范围仍严格限定为固定资产、两个指定模型各一次，无重试、换模或追加调用。
- 资产：`scripts/fixtures/beauty-video-content-av.mp4`，SHA-256 `bd613075b9b7044947809fd8bebab44bc7c488294c453dc030fae3a7a5e88c1a`（调用前再次匹配），63,191 bytes，8.000 秒，360×640，H.264；AAC mono 22050 Hz。
- 脱敏：完全本地合成；浅绿色竖屏背景、上方深绿色矩形、下方金色矩形；无人物、门店、账号、顾客、品牌、价格、疗效、真实文字或经营数据。合成语音为“这是美业视频内容复盘测试样本，不包含真实客户信息。”。
- `qwen-vl-max`：调用 1 次，HTTP 200，780 prompt + 33 completion = 813 tokens，1,812ms；全部画面事实命中，无人物/可见文字判断正确。
- `qwen3-asr-flash`：调用 1 次，HTTP 200，200 prompt + 23 completion = 223 tokens，音频 8 秒，530ms；忽略标点/空白后逐字命中。
- 正式合同：`visualEvidence` 与 `transcript` 均命中并进入输入，`fallbackUsed=false`。任一 Provider 后均停止对应流程；额外调用 0。
- 费用：精确 usage 已记录；官方最终账单未在本地生成，按批准前口径保守报告预计约 ¥0.10，最坏按 ¥0.20 计，低于用户绝对上限 ¥1。
- 安全报告：`F:\思潼AI增长os\test-environments\beauty-industry-acceptance-20260821\reports\by15-live-media-acceptance-safe.json`。仅保存脱敏状态、计量和指纹；不保存媒体正文、密钥或完整 Provider 原始响应。派生帧/音频请求结束删除，报告记录 `temporaryDerivedMediaDeleted=true`、`rawProviderResponsePersisted=false`。

## 实现与文件归属

- API/合同：`apps/api/src/products/beauty-industry/{video-content-workflow,workflows,mcp-adapter,execution,profile,output-contract}.ts`、`apps/api/src/routes/{beauty-industry,workbuddy-mcp}.ts`、`apps/api/src/services/{agent-definitions,domestic-chat-provider}.ts`。
- Web：`apps/web/src/components/acquisition/BeautyVideoContentReviewWorkbench.tsx`、`apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx`、`apps/web/src/styles/beauty-video-review.css`。
- 资产/验收：`scripts/fixtures/beauty-video-content-av.{mp4,fixture.json}`、`scripts/generate-beauty-video-content-av-fixture.ps1`、`scripts/beauty-industry-by15-live-media-acceptance.ts`、`scripts/beauty-industry-video-content-review-{workbench-p1-smoke.mjs,runtime-p1-smoke.ts,activation-p1-smoke.ts}`、`scripts/verify-beauty-video-content-review-browser-e2e.mjs`，以及本轮同步的 admission、route/output、MCP、media observability 和 composition 回归。
- 文档/命令：`package.json`、本任务卡、`STATUS.md`、`TEST_MATRIX.md`、`PRODUCT.md`、`WORKFLOW.md`、`CONTRACTS.md`、`tasks/README.md`、`docs/BUG_REGRESSIONS.md`。
- 无数据库 Schema 变更；BY-11 至 BY-14 和其他既有未提交改动未回退、未整体提交。

## 验证

- 真实准入：PASS；指定模型各 1 次、固定哈希、双证据命中、`fallbackUsed=false`、派生媒体删除、原始响应未持久化。
- 领域专项：workbench/runtime/activation、Schema/Eval、8 workflow composition × 高风险 3 次、fixed-route/output、media observability/real-media、Web contract、WorkBuddy platform/隔离库、权限/租户/账本/幂等、API/Web typecheck 均 PASS。
- 浏览器：桌面 1440×1000 与 390×844 的深链、真实预检、缺失门禁、返回、刷新、跨租户、无横向溢出 PASS；控制台错误 0、额外模型/媒体请求 0。
- 仓库门禁：`pnpm.cmd qa:fast`、`pnpm.cmd qa:regression`、`pnpm.cmd qa:full`、`pnpm.cmd build`、`git diff --check` 均 PASS（最终结果见本任务交接记录）。
- 环境：既有 PostgreSQL `55434 / PID 12564`、API `3016 / PID 31024`、Web `5176 / PID 25232` 未停止或替换。当前源码浏览器验收使用临时 API `3017`，完成后通过原前台会话安全停止并确认端口释放。
- 未运行：生产部署、直播复盘和任何额外 Provider 调用。

## 放行与交接

- `QA-20260823-002` 已关闭；精确恢复 `acquisition:video-content-review`、`beauty.video_content_review`、`shooting_editing`，旧/新凭据列出和轮换保持 8 个 scope。
- 每个业务视频仍必须提供当前可核验的转写与画面/分镜证据；本轮准入不等于自动理解任意后续视频。缺失时预检可做，但正式执行保持关闭。
- 残余 P0/P1：0。没有自行启动直播复盘；后续只由总调度另立任务卡。

## 用户验收（不超过 5 步）

测试链接：`http://127.0.0.1:5176/agents/beauty-industry/acquisition/video/content-review`。

1. 登录美业验收租户，从“美业获客 → 视频获客 → 视频内容复盘”进入独立页，确认状态为“已开放”。
2. 填写平台、标题、目标和目标人群，上传受支持视频，确认只显示真实时长/分辨率/双流元数据、Provider 0、费用 ¥0。
3. 补齐当前视频真实转写与画面证据，确认“开始正式内容复盘”才解锁；移除任一必填证据应重新关闭。
4. 刷新确认文字资料恢复但本地视频/预检回执清除；使用返回和浏览器后退核对稳定路由。
5. 用另一个租户和 390px 视口核对无数据串用、无横向溢出，WorkBuddy `tools/list` 包含且仅按权限显示 `beauty.video_content_review`。

- 最后更新日期：2026-08-25
