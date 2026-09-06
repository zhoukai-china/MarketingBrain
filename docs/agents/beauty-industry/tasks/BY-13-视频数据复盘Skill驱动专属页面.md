# BY-13 视频数据复盘 Skill 驱动专属页面

状态：已完成（2026-08-25）

## 归属

- 产品：美业智能体（`productCode=beauty-industry`）
- 层级：产品专用页面，复用正式 `video_data_review → baolu_review_engine@2.0.0`、文件解析、AgentRun、租户、权限、积分与幂等合同
- 风险：高（真实数据文件、指标口径、租户历史、账本、刷新恢复与固定 Skill 路由）
- 预计修改热点：美业视频数据复盘专属组件、现有美业页面接线、样式、确定性回归与产品交接文档
- 是否允许并行：否；同一美业智能体只有本编码任务

## 用户结果

用户在美业视频获客中上传平台后台 CSV/Excel，核对真实字段和缺失维度，按正式 Skill 指标口径生成并保存视频数据复盘，再从同租户历史恢复结果或进入下一轮选题。

## 本次范围

- 以正式 `baolu_review_engine@2.0.0` 合同组织平台、周期、业务转化口径、文件、字段覆盖、缺失资料和复盘结果。
- CSV/XLS/XLSX 只经现有受控后端解析；解析成功前禁止运行，失败时明确补什么和去哪里重新导出。
- Web 与 WorkBuddy 继续使用同一 `beauty.video_data_review` capability/Skill/`professionalOptions` 合同，网页结构化字段真实进入后端与幂等指纹。
- 复用 AgentRun 保存、历史、刷新恢复、权限、租户、账本、取消和失败处理；结果只依据真实文件证据。
- 验证正常、缺失/错误/空文件、加载、错误/重试、超时、重复点击、刷新、返回、权限、租户隔离、桌面和 390px。

## 本次不做

- 不开发、开放或修改视频内容复盘、直播复盘及其他排队模块。
- 不修改正式 Skill 版本、输出方法论、自由文本路由或其他产品的品牌/example。
- 不调用收费文本、图片、视频或 ASR Provider，不部署生产。
- 不复制 FIP、餐饮或兰琪业务文案；只复用共享技术合同与已验证交互模式。

## 验收条件

1. 正常路径：用户选择真实平台/周期与转化口径、上传成功解析的 CSV/Excel，页面展示真实字段覆盖和证据边界；提交固定 `beauty.video_data_review`，结果保存并可从历史、刷新和 WorkBuddy 共用记录恢复。
2. 失败路径：错误类型、空文件、解析失败、缺失关键维度、接口错误、超时/取消和网络不确定状态均有明确补资料或重试说明；重复点击不重复运行或扣费。
3. 不应发生：不得出现通用单文本框切 Skill、硬编码演示指标、伪造已连接/已读取、把缺失值当零、混入视频画面/口播/剪辑结论、跨租户读取、自动 Provider 重试或自动外部动作。
4. 可观测结果事件：成功只生成一个当前租户 `AgentRun` 和一次幂等账本结算；文件解析、失败、取消和导航不创建付费运行；历史打开不再次调用。

## 基线与失败证据

- 基线命令：`pnpm.cmd beauty-industry:video-data-review-workbench-p1-smoke`。
- 修复前专属页面红灯：新专项首先因 `BeautyVideoDataReviewWorkbench.tsx` 不存在而 FAIL；同期既有 `beauty-industry:web-contract-smoke` PASS，证明是专属旅程缺口。
- 修复中运行时红灯：真实 CSV 已解析但结构化证据位于“当前产品上下文”分隔符之后，Agent 直连执行看不到文件记录并错误进入 Provider；失败预留已释放。新增运行时专项先稳定证明 Provider 被调用。
- 修复中口径红灯：正式数据含“有效咨询”时业务转化仍为 0；运行时专项稳定 FAIL，定位为共享确定性结果只识别“咨询数”。
- 修复中空数据红灯：仅有表头的 CSV 能通过旧“已解析”判断；先导入未实现的记录校验 helper，专项以 `TypeError` FAIL，随后实现并转绿。
- 现象、根因和连带影响：旧路由虽锁定正式 Skill 且能上传文件，但仍落入通用单文本框与整页 Markdown；页面没有呈现周期、转化口径、字段覆盖、缺失补数和专属历史。后端又未把结构化证据放进 Agent 可见区，字段别名和空记录边界不完整，可能造成无证据 Provider 调用或错误业务口径。

## 实现记录

- 专属页面：`apps/web/src/components/acquisition/BeautyVideoDataReviewWorkbench.tsx`、`apps/web/src/styles/beauty-video-review.css`；`apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx` 只增加视频数据复盘工作流、专属路由渲染、历史/刷新恢复与内容十件套承接保护；`apps/web/src/main.tsx` 只增加样式入口。
- 后端合同：`apps/api/src/products/beauty-industry/profile.ts` 只调整解析证据进入 Agent 可见区并增加“至少一条数值记录”校验；`execution.ts` 在预留/Provider 前失败关闭；`routes/beauty-industry.ts` 映射安全 422；`packages/agent/src/index.ts` 只补“有效咨询/有效咨询数”字段别名。
- 证据与回归：新增两个 BY-13 专项、两个脱敏 CSV fixture；`scripts/beauty-industry-workbuddy-mcp-smoke.ts` 只新增视频数据复盘同合同/同口径/零 Provider/账本幂等回归；`package.json` 只增加专项命令并纳入现有美业 Web 合同门禁。
- 文档归属：本任务卡、`tasks/README.md`、`STATUS.md`、`TEST_MATRIX.md` 和 `docs/BUG_REGRESSIONS.md` 的 BY-13 段落。上述已跟踪或未跟踪文件可能同时含 BY-11、BY-12 与其他既有未提交内容；BY-13 只拥有这里列出的新增文件和语义增量，不覆盖、不回退、不整体提交其他任务改动。
- 数据/接口/配置变化：未新增数据库 Schema、未改 Skill 版本、capability 映射或生产配置；Web 与 WorkBuddy 共用 `video_data_review_workflow_v1` 和现有 `beauty.video_data_review` 执行链。
- 兼容性和回滚点：专属组件、接线、前置校验、字段别名与 BY-13 回归可分别回滚；首页、选题、内容十件套及其他深链保持兼容。

## 验证

- 专项：`pnpm.cmd beauty-industry:video-data-review-workbench-p1-smoke`、`pnpm.cmd beauty-industry:video-data-review-runtime-p1-smoke`、`node apps/api/node_modules/tsx/dist/cli.mjs scripts/video-review-direct-smoke.ts`、`pnpm.cmd beauty-industry:web-contract-smoke` 均 PASS；运行时专项确认 Provider 调用 0、平均完播率 36.5%、业务转化 7。
- Web/WorkBuddy：在受控验收库显式加载 `.env.acceptance` 并设置 `BEAUTY_MCP_TEST_DATABASE_ALLOWED=true` 后，`pnpm.cmd beauty-industry:mcp-database-smoke` PASS，覆盖同合同、权限、租户隔离、账本、幂等、撤销/轮换。首次未提供隔离库授权变量时脚本按设计拒绝执行，不属于产品失败；补齐明确受控环境后通过。
- 类型、构建与门禁：Web/API typecheck、`pnpm.cmd qa:fast`、`pnpm.cmd build`、`pnpm.cmd qa:regression`、`pnpm.cmd qa:full`（含 build）与 `git diff --check` 均 PASS。
- 页面/E2E：`http://127.0.0.1:5176/agents/beauty-industry/acquisition/video/data-review?apiBase=http%3A%2F%2F127.0.0.1%3A3016` 在 1440×1000 和 390×844 实测 PASS。覆盖加载、真实 CSV、字段覆盖、缺日期/自然付费提示、正式报告、历史、刷新恢复、无效类型、仅表头空文件、3999 网络错误/重试、返回选题、直接深链和控制台；主路径控制台 error/warning 0。
- 受控环境身份：PostgreSQL `55434 / PID 12564`（验收目录 `F:/思潼AI增长os/test-environments/beauty-industry-acceptance-20260821/pgdata`），API `3016 / PID 31024`（当前仓库源码启动脚本），Web `5176 / PID 25232`；未停止未知进程。
- 费用：未调用任何文本、图片、视频或 ASR Provider，人民币新增费用 ¥0；两次确定性本机验收各结算 15 个内部验收积分，余额 488→458，另一次失败预留已释放，不代表外部付费。
- 未运行项：生产部署、生产配置预检、正式邀请码和任何收费 Provider 调用；均不在 BY-13 范围。

## 交接

- 残余风险：BY-13 范围无未解决 P0/P1；文件本体不写入浏览器持久化，刷新可恢复结果与历史，但新一轮运行必须由用户重新选择真实文件，页面已明确提示。
- 用户验收（不超过 5 步）：
  1. 打开上方测试链接，选择平台、周期、复盘目标和业务转化口径。
  2. 上传平台后台导出的 CSV/XLS/XLSX，核对字段覆盖和缺失资料提示。
  3. 点击“开始视频数据复盘”，核对指标卡、五段正式报告和行动建议。
  4. 刷新页面并从最近复盘打开结果，确认不会重新运行或重复扣分。
  5. 可选上传错误类型/仅表头文件验证失败关闭，再点击“返回视频获客”。
- 已批准下一阶段恢复点：按仓库编号顺序新建 BY-14“全局命名、导航与独立子页面框架”，统一主名称“美业智能体”、副标题“门店 AI 经营大脑”；所有可见导航（含规划中）进入稳定独立页面，保持深链/刷新/前进后退/权限/租户/390px和既有 Skill 映射。BY-14 未在本任务编码。
- 后续排期：BY-14 完成后才依次启动视频内容复盘、直播复盘；本任务现已停止并反馈总调度，不自行启动后续模块。
- 最后更新日期：2026-08-25
