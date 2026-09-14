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

## LQ-25 爆款复刻真实检索源（抖音 + 视频号，2026-09-12）— **已由 LQ-28 下线（2026-09-14）**

> **本节整体已成历史。** 用户 2026-09-14 明确要求「取消爆款复刻里面的搜索爆款功能，让用户自己添加链接或者上传视频文件」：
> 上线后实测该检索既证明不了「爆款」（接口字段只有 `icon/site_name/index/title/url`，**没有点赞 / 播放**），
> 又抓不到视频号视频（`site:channels.weixin.qq.com` 0 条）、混入图文与无关赛道（抖音 10 条里 0 条 `/video/`、3 条 `/note/`、3 条 `/user/`，含用户点名的「沐足保健」），
> 因此**整个检索链路（规则层 / 服务层 / 路由 / 环境变量 / 契约 smoke）连同页面入口一并删除**，爆款复刻改为门店自备参考素材（登记抖音链接 + 上传原片）。
> 下表保留为 LQ-25 当时的验收留痕，**不代表当前产品行为**；当前口径见下方「LQ-28」小节与 `docs/BUG_REGRESSIONS.md` QA-20260914-003。

| 检查项 | 结果 | 证据 |
|---|---|---|
| 检索源与用户口径一致 | PASS | 用户拍板「检索源 = 抖音和视频号两个平台」「开闸跑」「暂时只在兰琪用」；页面平台筛选 = 抖音+视频号 / 抖音 / 视频号，路由只在 `server.ts` 兰琪作用域注册 |
| 条目真实性（只给可点开页面） | PASS | `scripts/lanqi-viral-search-contract-smoke.ts` **55/0**：只认抖音 `/video`·`/note` 与微信生态站内页；账号主页 / 搜索页 / 开放平台文档 / 短链 / 第三方站点 / `http` 明文 / 带账号密码链接全部丢弃 |
| 不编造热度与结论 | PASS | 条目结构没有播放量 / 点赞字段；服务只读 `output.search_info.search_results` 来源页清单，不使用模型生成的正文结论；冒烟断言「条目没有编造的字段」 |
| 真实链路可用（非 mock） | PASS | 生产同一把凭据跑真实服务代码：关键词「皮肤管理门店获客」→ 抖音 3 条站内页、视频号侧 6 条微信生态页、全部平台 6 条合并（抖音在前），URL 全为 `www.douyin.com/{video|note}` 或 `mp.weixin.qq.com/s?...` |
| 失败关闭（未配置 / 上游失败 / 无有效条目） | PASS | 未配置 → `viral_search_unavailable`(503)；两平台都失败 → `viral_search_upstream_failed`(502)；上游只回第三方站点 → 空数组 + 「没有检索到可点开的抖音 / 视频号公开页面」；空关键词 → 400 |
| 平台筛选真实生效 | PASS | 冒烟断言「只搜抖音时只发抖音查询」「全部平台时两个平台各发一条查询」；条目侧按平台过滤不串台 |
| 租户与 RBAC | PASS | 路由复用公域获客同一套「每次请求重算 Membership + `assertStoreVisible`」；单店角色检索不到别的门店；参数非法 400、未开通 503 |
| 只在兰琪可用（结构约束） | PASS | 冒烟断言「检索路由挂在兰琪作用域」「没有注册到美业单品作用域」；`viral-video-replication` 老链路未改动 |
| 计费边界 | PASS | 一期不做积分：路由不扣费、不写流水、不落库（冒烟反向断言 `creditCost|billing|wallet|creditLedger|$transaction`） |
| 页面契约 | PASS | `pnpm.cmd lanqi:acquire-ui-contract-smoke` **53/0**（新增 7 条：真实接口 / 结果区可访问名 / 选它复刻 / 打开原页面 / 不做假数据 / 不再硬编码 fail-closed / 页面无厂商与模型名） |
| 类型检查与结构门禁 | PASS（当时） | `apps/api`、`apps/web` typecheck `EXIT=0`；`qa:fast` 当时含 `lanqi:viral-search-smoke`（LQ-28 已移除该项） |


## LQ-28 爆款复刻取消检索、改门店自备素材（2026-09-14）

| 检查项 | 结果 | 证据 |
|---|---|---|
| 搜爆款入口整体消失 | PASS | 测试实例真实浏览器（桌面 1440 + 移动 390）`lanqi:acquire-instance-acceptance`：`检索按钮=[] 关键词框=false 链接页签=true 上传页签=true`；生产线上产物 `assets/LanqiAcquireVideoPage-Cp5WhOXM.js` 内 `平台筛选`/`行业领域`/`lq-vd-kw` 命中 0 |
| 抖音链接只登记来源、不发请求不出片 | PASS | 测试实例：`抖音链接只登记参考来源，不发请求也不出片 :: 已登记=true 不出片=true 新增请求=0`；契约断言 `登记参考来源` / `不会出片` 均在位 |
| 非抖音链接本地拦截 | PASS | 测试实例：`非抖音链接本地拦截、不发请求 :: 本地拦截提示=true 新增请求=0`；契约断言 `parseReferenceLink` 本地校验 |
| 未上传原片 / 未授权时本地拦截（LQ-27 防线保持） | PASS | 测试实例：`面板=上传参考视频:true/授权:true/报价:true 确认按钮禁用=true 本地拦截提示=true 新增请求=0`；契约断言 `素材与肖像授权` + 报价/确认走既有 `viral-video-replication/quote|confirm` |
| 后端检索链路彻底移除 | PASS | 生产/测试源码树 `viral-search*` 4 文件已删；`POST /lanqi/acquire/video/viral-search` 生产发布前 **401** → 发布后 **404 `Route … not found`**；`server.ts` import 与注册已去、`env.ts` 五项 `LANQI_VIRAL_SEARCH_*` 与生产校验已去；`package.json` 不再含 `lanqi:viral-search-smoke` |
| 源码契约 + 门禁 | PASS | `pnpm.cmd lanqi:acquire-ui-contract-smoke` **65 passed / 0 failed**；`pnpm.cmd --filter @baolu/web typecheck` PASS；`pnpm.cmd qa:fast` exit 0 |
| 发布与回滚 | PASS | `release-20260914-lq28-self-material-v2.tar.gz`（sha256 `170d6fbf…`，1493 文件），发布 id `20260914-lq28-self-material-test2` / `-prod1`，两侧 `DEPLOY_OK` + health/ready 200 + 4 条删除全部生效；回滚＝`/opt/baolu-backups/20260914-lq28-self-material-prod1-before-baolu-os-v2/` + `systemctl restart baolu-os-v2` |
| 生产页面级浏览器验收 | 未跑（既有边界） | 生产 `/lanqi/acquire*` 需真人微信扫码登录，自动化停在 `/os-v2/login`（同 LQ-22）；页面级证据取自测试实例 33/0 + 线上产物断言 + 生产接口 401→404 |


## LQ-29 爆款复刻参考素材三条现场缺陷（2026-09-14）

| 检查项 | 结果 | 证据 |
|---|---|---|
| 抖音分享口令识别（缺陷①，先红后绿） | PASS | 新增 `scripts/lanqi-acquire-reference-link-smoke.mjs` **11 passed / 0 failed**（指向修复前源码时 9 条红；用 `LANQI_REFERENCE_PAGE_PATH` 可复现红灯）：覆盖分享口令 `7.32 复制打开抖音…https://v.douyin.com/xxxx/ 复制此链接…` / `http` 升级 `https` / 尾部粘连中文与标点裁剪 / 无协议头短链 / 图文笔记 / 保留查询参数 / 无链接 / 非抖音域名 / 账号主页 / 空输入 |
| 无链接与非抖音链接的失败口径 | PASS | 整段没有链接 → 页面明说「这段文字里没有链接」并给「分享 → 复制链接」步骤；非抖音 → 报出**实际识别到的域名**；旧提示 `这不像一条完整链接` 在源码与线上产物中命中 **0** |
| 已上传素材可删除 / 可替换（缺陷②） | PASS | 契约 smoke 新增结构断言；测试实例真实浏览器：`🔄 更换原视频` / `🔄 更换照片` 与 `🗑 删除这条原片` / `🗑 删除这张照片`（`data-lq-vd-remove`）可见可点，删除后 `data-lq-vd-remove` 消失、可重新上传；删除会换新幂等键并清掉上一次报价 / 任务 / 成片，重传即全新一次请求 |
| 出片主按钮状态机（缺陷③） | PASS | 测试实例：素材未齐 → `data-lq-vd-primary=missing` 且禁用并点名「还差：…」；素材齐但未报价 → `need_quote` **可点**，点击真的发起报价（`新增报价请求=1`）；报价可确认 → `ready`、文案「✅ 确认并出片（按报价扣 N 积分）」；**未确认前不建任务、不扣积分** |
| 403 说人话（第三层口径） | PASS | `replicationFailureNotice()`：`product_access_denied` → 「当前账号还没有开通这项出片能力…与素材、授权是否填对无关」，**不猜原因、不谎称成功**；线上产物含该文案 1 处 |
| 源码契约 + 门禁 | PASS | `pnpm.cmd lanqi:acquire-ui-contract-smoke` 新增 16 条结构断言（未改页面时全红）→ **82 passed / 0 failed**；`pnpm.cmd qa:fast` exit 0 |
| 测试实例真实浏览器验收 | 42 项 / 2 项预期失败 | `pnpm.cmd lanqi:acquire-instance-acceptance`（桌面 1440 + 移动 390，CDP `DOM.setFileInputFiles` 真实上传）：**42 项 / 失败 2 项**，两项均为权益门禁预期（免登录新建租户只带 `lanqi` 权益 → 报价被后端 403 挡下：「点主按钮真的走报价」`新增报价请求=1, 报价后状态=need_quote`、`无接口 4xx/5xx` 捕获 `403 …/api/viral-video-replication/quote`），**其余 40 项全 PASS**（含 390 无横向溢出、console / page 0 错误） |
| 发布与回滚 | PASS | `release-20260914-lq29-acquire-fixes-v2.tar.gz`（9,623,158 B / 1512 文件，sha256 `bf1a1bcb…`），发布 id `20260914-lq29-acquire-fixes-test2` / `-prod1`，两侧 `DEPLOY_OK` + health/ready 200 + `No pending migrations`，`verify-deploy.sh` 两侧 VERIFY_OK；回滚＝`/opt/baolu-backups/20260914-lq29-acquire-fixes-prod1-before-baolu-os-v2/` + `systemctl restart baolu-os-v2` |
| 生产只读产物与接口取证 | PASS | 线上 chunk `assets/LanqiAcquireVideoPage-BwFfTi2O.js`（HTTP 200 / 67,224 B，由 `index-DNYd7rb4.js` 引入）含 `data-lq-vd-primary` / `data-lq-vd-remove` / `还没有开通这项出片能力` / `这段文字里没有链接` / `更换原视频` / `删除这条原片` 各 1，旧串命中 0；`POST /os-v2/api/viral-video-replication/quote` 未登录 **401** |
| 生产页面级浏览器验收 | 未跑（既有边界） | 生产 `/lanqi/acquire*` 需真人微信扫码登录，自动化停在 `/os-v2/login`（同 LQ-22）；页面级证据取自测试实例 42 项 + 线上产物与接口只读探针 |
| 出片链路的权益门禁 | 未闭环（待老板拍板） | `apps/api/src/routes/viral-video-replication.ts` 的 `context()` 只认 `beauty-industry` active 权益，兰琪租户只带 `lanqi` → 一点即 403。二选一：① 给在用兰琪租户补 `beauty-industry`；② 放宽该路由接受 `lanqi`（属权限 / 计费口径变更，Agent 未擅自执行） |


## LQ-27 爆款复刻真样片 + 公域获客板块放开（2026-09-13）

| 检查项 | 结果 | 证据 |
|---|---|---|
| OSS 传输层（Node v20 lookup 形状） | PASS | `lanqi:video-oss-transport-smoke` 10/0；生产 confirm 成功、供应商受理任务；QA-20260913-008 |
| 真样片出片 | PASS | job `cmtzfsmry05iipoiavf5jrayp` `succeeded/charged`；3.000s / h264 / 816×1088 / 451,548 B / sha256 `a623237d…`；估算成本 ≈ ¥1.80/条（wan-std ¥0.60/秒），三次出片任务合计 ≈ ¥5.40 ≤ ¥10 |
| 结果主机任意 OSS 区域 + http→https | PASS | `beauty-industry:image-asset-url-policy-p1-smoke` PASS（wulanchabu / hangzhou / 子域 / 升级断言）；QA-20260913-010 |
| 样本脚本终态后才清理 | PASS | `lanqi-video-staging-cleanup-diag-smoke` 4/0；脚本轮询含 refresh、非终态保留许可/授权 |
| 直播话术偶发 422 | PASS | `lanqi-live-service-smoke` 49/0（段级重写 + 换写法）；同一输入真实模型 3/3 出稿 |
| 公域获客板块验收（测试实例） | PASS | `lanqi-acquire-instance-acceptance` **30/0**（桌面 + 移动 390；枢纽 5 卡 / 文案改稿 / 爆款复刻 / 一键成片 / 直播话术 / AI 顾问）；API 真实模型走查 17/17 |
| 生产只读接口 | PASS | `prod-lanqi-lq19-acquire-acceptance.sh` **16/16**（匿名 401 / 缺必填 422 / 跨门店 404 不回泄 / 无厂商名） |
| 门禁 | PASS | `qa:fast` exit 0；`lanqi:acquire-smoke` exit 0 |

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
