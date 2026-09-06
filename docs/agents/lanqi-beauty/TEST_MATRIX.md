# 兰琪智能体测试矩阵

## 当前基础阶段

```powershell
pnpm.cmd qa:lanqi-foundation
pnpm.cmd qa:fast
```

`qa:lanqi-foundation` 当前只证明产品文档、契约和知识治理结构齐全，不代表兰琪生产智能体已经完成。每落地一个 LQ 模块，都要把该模块的确定性回归加入此领域命令。

## 每个模块必测

- 正常资料、缺字段、冲突资料、过期知识和完全无资料。
- 兰琪总部、加盟商、被推荐门店、普通未授权账号的角色边界。
- 租户 A 不能读取、修改或影响租户 B 的档案、知识、会话、结果和钱包。
- 推荐方不能读取被推荐门店的私有数据。
- 内部定价有版本、适用条件与依据；无权限或过期时拒绝展示。
- 检索失败、模型超时、取消、部分失败、刷新和重复请求。
- 扣费幂等、失败处理、余额不足和审计流水。
- 不编造案例、效果、价格、授权、执行动作或门店事实。
- 高风险非确定性样例至少重复 3 次，任一次硬失败都不能放行。

## 页面模块追加验收

真实操作桌面与移动端主路径，并覆盖加载、空状态、错误、重试、重复点击、刷新、返回、权限不足和网络失败；检查控制台、关键请求和隐私信息展示。

## LQ-17 美业经营问答独立网页

| 检查项 | 结果 | 证据 |
|---|---|---|
| 固定 capability / Agent / Skill / version | PASS | `lanqi:business-qa-smoke`；`beauty_business_qa -> agent_beauty_acquisition -> general_qa@0.2.0` |
| 必填与事实边界 | PASS | 问题少于 2 字 API 400；正常问题只注入 `confirmedFacts`，估算和缺失资料不冒充事实 |
| 专属受控输出与旧 fallback 隔离 | PASS | capability 专属 fixture 通过同一正式质量合同；未知能力不能借该页面自由切换 |
| 历史、追问、刷新与幂等 | PASS | API smoke 覆盖新建、连续追问、顺序 replay、同 key 异输入 409；真实页面刷新恢复 |
| 租户与权限 | PASS | Web 要求 `lanqi` entitlement，WorkBuddy 要求可信 MCP 凭据绑定的 `beauty-industry` entitlement；跨租户会话 404，请求体不能切换产品/租户 |
| Web / WorkBuddy 共用合同 | PASS | `beauty.business_qa` 固定 `operations:business-qa`，复用同一 executor、四段结构、事实门禁、AgentRun 与 usage ledger |
| 失败前合同与安全拒绝 | PASS | 输出合同在保存/结算前执行；合规的“无法提供”不再命中 `generic_ai_tone`，显式 AI 身份套话仍拒绝 |
| 真实限额审计 | PASS（代码缺陷已闭环） | DeepSeek V4 Pro 共 3 次、媒体 0、保守约 ¥0.01754；普通 WorkBuddy 问答 1 次成功/唯一 run/一次 5 积分结算，失败链均释放或补偿；修复后未追加付费复验 |
| 当前费用与外部动作 | PASS | 用户入口为 `controlled_mock`，外部 Provider 0、积分 0、费用 ¥0；页面明确不代表真实模型质量 |
| 桌面与 390px | PASS | 当前 5176/3016 桌面完成生成、追问、刷新恢复，console warn/error 0；无 UI 变更，390px 沿用既有页面 E2E：`scrollWidth=375 <= innerWidth=390` |
| 全仓门禁 | PASS | `qa:fast`、`qa:regression`、`qa:full`（含 build）、`git diff --check` |

## LQ-09 小红书文案生成

| 检查项 | 结果 | 证据 |
|---|---|---|
| 专用 Skill 注册、能力锁定、MCP 原始包与只生成文案 | PASS | `node scripts/lanqi-xhs-copy-contract-smoke.mjs` |
| 五段输出解析、5–8 标签、无图片/视频提示词 | PASS | `node apps/api/node_modules/tsx/dist/cli.mjs scripts/lanqi-content-studio-smoke.ts` |
| Skill 包结构 | PASS | `python -X utf8 C:\Users\book\.codex\skills\.system\skill-creator\scripts\quick_validate.py mcp-skills\skills\xiaohongshu_ops` |
| 模糊需求追问 | PASS | 真实 API 返回 422；不保存草稿 |
| 高风险事实与授权边界 | PASS | 最终放行批次真实生成 3/3 成功、总硬失败为 0；未编案例、疗效、销量、优惠、保证效果、服务、城市、承接渠道或兰琪方法论 |
| 请求幂等、保存恢复、公开字段过滤 | PASS | 同一请求键第二次 `idempotent=true` 且 ID 相同；历史列表恢复 1 条；无 `storeFacts/imagePrompt/videoPrompt` |
| 租户隔离 | PASS | 门店 A 保存 1 条后门店 B 列表为 0；草稿 ID 包含租户哈希 |
| Agent/Skill 相邻回归 | PASS | Agent 产品、输入、编排器、MCP 韧性、门店/招商拆分、持续改进、Skill 合同及取消回归全部 PASS |
| 全仓类型检查与构建 | PASS | 7 个工作区 `typecheck`；7 个工作区 `build` |
| `qa:fast` / `qa:regression` / `qa:full` 精确包装命令 | PASS | 本机已安装且哈希一致的锁定 pnpm 9.15.0 原始执行，三项均 PASS；未关闭签名保护 |
| 桌面与移动端真实浏览器 E2E | PASS | `127.0.0.1:5186` 当前源码：登录、档案、422、重试、请求中禁用、生成、保存、复制、刷新、网络失败恢复、390px 无溢出 PASS；最终控制台错误/告警 0 |

LQ-09 已于 2026-08-14 达到本地正式放行线；生产部署前仍须在数据库模式复跑租户持久化、授权守卫和部署后 smoke。

## LQ-10 文生图零付费预览

| 检查项 | 结果 | 证据 |
|---|---|---|
| 独立入口、页面、预览 API 与供应商无关 capability | PASS | `lanqi:image-studio-smoke`；`/lanqi/content-studio` 可进入 `/lanqi/image-studio` |
| 专用提示词增强 Skill 与结构契约 | PASS | `lanqi-image-prompt-enhancer` 原始 MCP 包、运行时镜像、Champion 样板、contract 和 8 类 Eval；不复用语义重复 Skill |
| 意图理解、必要追问与三个差异方向 | PASS | 正向/负向/叠字/参数分离；空泛方向名规范化；普通“授权门店”不误追问实景 |
| 提示词纯净度与模型适配 | PASS | 正向提示词不含计费、权限、审核、系统说明或供应商；adapter 固定 `media.image.generate`、`renderText=false`、比例画布有效 |
| 用途、比例、视觉、文字与权利确认 | PASS | 桌面与 390px 表单真实操作；未确认授权时按钮禁用，API 缺授权返回 422 |
| 门店事实与知识边界 | PASS | 只注入已确认名称/城市/服务；未激活知识为 `not_loaded`；不注入营收、估计事实或通用方法论 |
| 高风险样例至少 3 次 | PASS | 离线 8 类 × 3 次、192/192；生产路径 3 次用户侧硬失败 0，其中 2 次运行时 Skill、1 次结构契约安全降级 |
| 零付费与供应商隐藏 | PASS | `billable=false`、媒体任务 0；页面未调用 `/lanqi/media/quote|confirm|jobs`，无供应商/模型/密钥外显 |
| 幂等、保存恢复与租户隔离 | PASS | 相同输入第二次恢复同一预览；A 租户 1 条、B 租户 0 条；刷新恢复 PASS |
| 失败、超时和网络降级 | PASS | 模糊/危险请求 422；12 秒超时与 3999 端口失败保留输入并可重试 |
| 桌面/移动浏览器与控制台 | PASS | 1280px、390px 真实页面；390px `scrollWidth=clientWidth=375`；创建、三方向、多轮、重复、422、网络失败、恢复和禁用真实生成 PASS |
| 领域及全仓门禁 | PASS | `qa:lanqi-foundation`、`qa:fast`、`qa:regression`、`qa:full` 全部 PASS；本轮使用已安装 fallback pnpm 11.19.0，锁定全局包装入口超时单列为工具限制 |

LQ-10 零付费版本已于 2026-08-14 达到本地放行线。真实图片生成仍须单独确认预算、账号模型权限、永久对象存储与计费结算，不能据此视为已开放。

## LQ-14 同页图片生成任务链路

| 检查项 | 结果 | 证据 |
|---|---|---|
| 专业预览绑定、报价与显式确认 | PASS | `lanqi:image-generation-workflow-smoke`；缺 `previewId` 422，报价不创建任务，确认后才创建 |
| 幂等、重复点击与冲突 | PASS | 同键同输入返回同一任务且列表仅 1 条；同键变更 409；页面请求中禁用 |
| 排队、处理、成功、失败、取消、重试 | PASS | 专项连续 3 次 PASS；桌面完成成功与即时取消；受控失败返回 `canRetry=true` |
| 积分与并发结算 | PASS | 模拟全程 `not_billed`；真实链 3 个任务各结算一次、3 笔媒体交易、测试积分 300 → 0，无重复结算、退款或第四任务；条件事务回归覆盖成功/退款互斥 |
| 资产归属、选择、保存与刷新恢复 | PASS | 成功后只返回租户资产 URL；选择/保存元数据落盘；刷新恢复结果；B 租户下载 A 资产 404 |
| 存储、供应商与隐私边界 | PASS | 用户侧未暴露密钥、内部成本或 Provider 临时 URL；真实结果写入租户哈希目录 3 图 + 3 元数据；无持久存储/真实批准时 fail closed，模拟图明确不代表画质 |
| 专业文本模型与推理路由 | PASS | `lanqi:runtime-model-policy-eval` 覆盖本地 Agent + 远程 MCP；小红书固定 Pro deep，图片提示词固定 `deepseek-v4-pro + standard + thinking disabled + max_tokens 4096 + JSON Output`；FIP `enabled/high/16384` 不变 |
| Flash 候选安全闸门 | PASS（未启用） | `deepseek-v4-flash` / `qwen3.8-flash` 仅在低风险分类/格式转换同时显式启用并通过同套 Eval 后才允许 `reasoning_standard`；当前均未激活，不能替代专业综合 |
| 媒体模型追踪与可信预览 | PASS | 服务端按本租户恢复 LQ-10 预览并核对 prompt/version/ratio；任务持久化 Provider、`wan2.7-image` model、promptVersion、负向提示词、参数、状态、费用预览和失败原因 |
| 知识与事实边界 | PASS | 沿用 LQ-10 正/负提示词、叠字、知识状态；未加载兰琪知识时明确待补，不编疗效、优惠、案例或门店实景 |
| 网络、超时与失败恢复 | PASS | 3999 端口实际显示中文安全提示并恢复；供应商/落库/超时回归走明确失败和单次退款 |
| 桌面与 390px 页面 | PASS | `127.0.0.1:5175` 当前源码：受控登录、门店恢复、普通需求、专业提示词、费用确认、异步进度、3 图成功、选择、保存、刷新、断网 3999 与恢复；390×844 恢复 3 任务和 3 个已保存结果，无明显横向溢出 |
| 高风险重复与全量门禁 | PASS | 模型策略 Eval 3/3、LQ-14 专项 3/3；提示词 Eval 连续 3 轮、192/192、硬失败 0；共享 FIP Skill 激活遗漏修复后，2026-08-21 原始 `qa:regression`、`qa:full` 再次实际运行均 PASS |
| 真实 `wan2.7-image` 三图 | PASS | 最高 ¥1 预算内经同页最终路径完成 3/3；任务指纹 `01eef63e5d78`、`9496cb265567`、`fb466c05ca48`，预计成本 ¥0.60，3 笔媒体交易、3 个租户资产，无自动付费重试，人工评分硬失败 0 |

LQ-14 兰琪专属产品链于 2026-08-20 完成真实三图受控验收，并于 2026-08-21 在共享路由修复后通过原始 `qa:regression`、`qa:full`，达到最终用户验收线；生产迁移、生产对象存储与生产部署均未执行。

## LQ-16 Qwen3.8-Flash 候选接入

| 检查项 | 结果 | 证据 |
|---|---|---|
| 候选身份与高能力隔离 | PASS | `qwen3.8-flash` 保持被共享高能力门禁拒绝，只能由兰琪专用低风险 allowlist 放行 |
| 双门禁与任务边界 | PASS（默认关闭） | 未启用或未批准均选择 `deepseek-v4-pro`；仅 `low_risk_formatting` 在两门禁同时成立时选择 Qwen；小红书策略仍为 Pro deep |
| 百炼请求合同 | PASS | OpenAI 兼容请求固定 `enable_thinking=false`、`preserve_thinking=false`，支持 `response_format=json_object`，输出硬上限 2048 tokens |
| 凭据与启动失败关闭 | PASS | 默认配置不开启候选；启用时缺百炼密钥/地址或两门禁不一致会被运行时与生产预检拒绝 |
| 稳定性与费用 | PASS（离线） | `lanqi:qwen38-flash-candidate-eval` 连续 3/3；使用进程内 fetch stub，外部网络 0、Provider 0、费用 ¥0 |
| 真实 Challenger | PASS（可激活、默认关闭） | 新授权批次严格 3/3；三次均 HTTP 200、stop、reasoning tokens 0；合计估算 ¥0.004184≤¥0.05，重试/换模/追加/额外调用 0 |
| 真实 Eval 合同回归 | PASS | `lanqi:qwen38-flash-live-eval-contract-smoke`；`待确认` 可表达未知价格，同时保留禁止编造数字、事实、污染和合规门禁 |
| 相邻与全仓门禁 | PASS | `lanqi:runtime-model-policy-eval`、`qa:lanqi-foundation`、`qa:fast`、`qa:regression`、`qa:full`（含 build）全部 PASS |

Qwen 已通过兰琪低风险通用准入，但只覆盖分类、标签、事实整理、合规标记和格式转换。具体能力启用前仍须建立该能力专项 Eval 和显式流量开关；不得扩大到专业知识综合、小红书文案或图片提示词。

2026-08-21 持久环境重跑再次 PASS：独立 PostgreSQL `127.0.0.1:55433` 迁移 26/26 且二次无待迁移；两个有效兰琪租户分别为 0/3 个图片任务，跨租户列表 0、资产读取 404；真实三图 `3:4 / 16:9 / 1:1` 均 `succeeded / charged / persisted / selected / saved`，重复确认后任务、Provider 任务和媒体交易仍严格为 3。桌面、390px（`scrollWidth=clientWidth=375`）、断网 3999 与恢复、刷新、终态取消 409、新页面控制台 0 错误/告警均 PASS；备份 dump 可读、15 项 SHA-256 清单 PASS；安全停止后 3015/5175/55433 均不监听，持久脚本重启后状态与新页面仍恢复 3/3；`qa:lanqi-foundation`、`qa:fast`、`qa:regression`、`qa:full`、`git diff --check` PASS。

## 2026-08-21 图片工作室 P1 与延迟回归

| 检查项 | 结果 | 证据 |
|---|---|---|
| 永久挂起、硬超时、取消、晚到成功、重复点击 | PASS | `lanqi:image-studio-resilience-smoke`；真实页面 1 秒内显示阶段/耗时/取消，取消立即恢复且旧预览保留 |
| 合成 A/B 标签、缺失门店名、疗效词规范化 | PASS | 用户可见文本无内部租户名；未确认门店用“本店”；效果性词改为“问题肌肤日常护理”并说明原因 |
| 额度用尽与所有付费入口 | PASS | 顶部确认、3 个重新生成入口均真实 `disabled`/`aria-disabled` 并显示需新授权；Provider 任务、媒体交易仍为 3 |
| Champion 延迟根因 | FAIL（基线证据） | 第 1 例 81.734 秒后 `finish_reason=length`，completion/reasoning 均 4096，未产出合格结构，按硬失败停止 |
| Standard Challenger 真实 Pro 8×3 | PASS | 24/24、硬失败 0；P50 17.118 秒、P95 20.935 秒；24 次 `stop`、reasoning tokens 0、聚合估算 ¥0.4458 |
| Skill 与结构化 Provider 参数 | PASS | Skill/contract 1.0.1；`thinking=disabled`、`max_tokens=4096`、`response_format=json_object`；过短构图和必需负向项有确定性安全补齐 |
| 桌面与 390px 页面 | PASS | 桌面真实 v1.0.1 保存约 25.3 秒，3 图恢复；390px 回归在 UI 修复后验证无横向溢出、3 图和所有禁用态，后续模型/Skill改动未改页面布局 |

## LQ-15 统一小红书图文生成

| 检查项 | 结果 | 证据 |
|---|---|---|
| 单入口与一个主按钮 | PASS | `/lanqi/content-studio` 同一表单完成需求、权利确认、报价确认和整包生成；主导航不再要求进入图片工作室 |
| 文案、提示词、图片统一关联 | PASS | `lanqi:xhs-package-smoke`；同一 `packageId/quoteId/requestId` 关联 3 标题、正文、标签、互动、预览和媒体任务 |
| 文案失败不建图片 | PASS | 专项受控失败返回明确终态，图片任务数不增加；固定模板/无关 Provider fallback 被拒绝 |
| 图片部分失败与只重试图片 | PASS | 390px 实际页面保留文案并显示失败原因；只重试图片后文案未重复生成，测试 Provider 文案调用计数不增加 |
| 素材权利前置 | PASS | 未勾选素材/人物权利时主按钮真实 disabled；确认后才允许整包提交 |
| 显示、复制与下载 | PASS | 受保护图片以鉴权 Blob 显示，下载端点返回正确 `image/svg+xml`；浏览器拒绝剪贴板权限时页面显示可见失败反馈并保留正文 |
| 幂等、刷新恢复与隔离 | PASS | 重复请求复用同作品；刷新恢复完整图文；专项覆盖跨租户列表/任务/资产 404 |
| 取消、超时、断网与重复点击 | PASS | 文案 120 秒硬截止和 AbortSignal 传播；3999 端口断网显示可重试并保留输入；请求中按钮锁定 |
| 桌面与 390px 页面 | PASS | 桌面完成成功/下载/刷新；390×844 `scrollWidth=390`、图片 768px 可用、部分成功/重试/恢复 PASS |
| 控制台与费用边界 | PASS | 新浏览器会话无应用错误；确定性 E2E `paidProviderCalls=0`，没有第四个百炼任务或新增媒体积分流水 |
| 领域及全仓门禁 | PASS | 锁定 pnpm 9.15.0 原始执行 `lanqi:xhs-package-smoke`、`qa:lanqi-foundation`、`qa:fast`、`qa:regression`、`qa:full` 全部通过；`git diff --check` 通过（仅现有 Windows 换行提示） |

LQ-15 的 mock/确定性链只证明统一工作流、状态、隔离和失败恢复，不冒充真实成图质量。新的真实图片必须取得新的明确费用授权。
