# 兰琪美业经营增长智能体状态

> **2026-09-09（0909 总纲）**：本产品方向已由《兰琪美业门店 AI 经营大脑·Codex 开发总纲》覆盖，当前唯一交付单元为 8 个一级导航板块，一块板一批交付。旧 LQ-* 任务卡批量标记「暂停 / 由 0909 覆盖」（详见 `tasks/README.md`），仅保留证据不再续做。新开发任务自 LQ-18 起。**当前状态（2026-09-11 更新）：LQ-18 私域营销（板块4）已于 2026-09-10 收口并发布生产（发布 id `20260910-lanqi-lq18-closeout-prod1`）；LQ-19 公域获客（板块3）已在 2026-09-11 完成测试实例部署与专项验收（新增页面级探针 28/0、接口冒烟 80/0，既有回归 14/0），并随发布 id `20260911-lanqi-lq19-acquire-prod1` 上生产（`DEPLOY_OK` + 健康 200，生产 `/lanqi/acquire/*` 接口 16/16 PASS），本轮收口。LQ-20 经营驾驶舱（板块1）本轮「不验收」——按用户指示留到经营驾驶舱专项开发时再验收，现有测试实例结果只作既有回归。二期连锁（`chain.html`）本期不实现。生产收尾三项：① LQ-18 验收残留已清、② 产品邀请码注册 E2E 已通过且**该一次性验收租户随后已按要求回收（席位恢复到满 5）**、③ 真人微信扫码**改由用户本人人工执行**（WorkBuddy 测不了微信），其**失败路径已补自动化探针并修真一个 P1（无效 code 由 500 改 401，已上生产）**，详见下方「生产收尾三项（2026-09-11）」。**本轮验收脚本与文档已提交并推送 git：本地 `main` = 远端 `origin/main` = `427df85`。**

> **2026-09-11 追加（WorkBuddy 走查报告复核）**：用户交来 WorkBuddy 的《兰琪登录授权走查报告-cmengtv》与《兰琪公域获客测试报告》，要求核验测试是否正确、修掉真 Bug。**核验结论：登录报告 3 条「关键发现」全部是测试方法错误（`cmengtv` 是微信号、被当成产品邀请码；`inviteRequired` 是平台主入口口径；`dev-login` 生产禁用是设计内 fail-closed），登录链路无需改代码。** 公域报告 9 条中成立 3 条（2 条已修、1 条登记为体验残留），另由报告 #1 的 502 线索**反向查出一个真 P1：直播/顾问间歇性 422（合规门禁把「我**不**敢保证」这类免责说法误判成效果承诺 + 重写次数只有 2 次）**。已最小修复：语境感知 `containsPromiseClaims()`、live/advisor 重写次数 2→3、回灌提示点名违规词并要求逐字删除；随发布 id `20260911-lq19-acquire-fixes-test1` / `-prod1` 上测试实例与生产（`DEPLOY_OK` + 健康 200；测试实例走查 **16/16**、重复探针 **live 6/6 · advisor 3/3**、页面探针 **30/0**；生产接口验收 **16/16 PASS**）。详见 `docs/BUG_REGRESSIONS.md` QA-20260911-005 与下方「LQ-19 公域获客」。

> **2026-09-11 追加（私域营销页复测报告复核）**：用户交来 WorkBuddy《兰琪私域营销页复测报告》，要求核验是否合理并修复。**核验结论：报告 2 条 P1 都不成立（测试方法问题）**——① 「快速模式默认示例文本被判定为空」：文本框本来就是 `placeholder` 提示 + 初始 `value=""`，空输入给「请先写一句你的原话」是**正确的负路径**，不是「默认值没生效」；② 「专业模式点『生成真实 AI 配图』清空已有结果」：真实浏览器实测点击后文案正文与结果元信息仍在（`hasResultMeta=true`、正文 135 字）、`store_os_token` 在、URL 未跳转、配图请求 200 出图，报告截图抓的是**出图等待期的中间态**。**2 条 P2 成立并已修**：「结果卡片缺少复制 / 重新生成」「顶栏『多端实时同步』点了没有任何反馈」（后者原本是纯 `<span>`，连 `onClick` 都没有）。P3「案例中心 / 客户管理仍是占位页」按用户本轮口径（其他页面暂时显示开发中）**保留占位**。**另由报告线索反向查出一个真 P1**：快速模式空输入 `POST /lanqi/moments/upgrade` 返回 **HTTP 500**（`INVALID_MSG` 漏了「请先写一句你的原话」，且 500 分支把原始报错直接回显给前端，会暴露 `deepseek_provider_http_error` / `llm_provider_not_configured` 这类内部串）——已最小修复并加三层回归（`lanqi:moments-input-error-paths-smoke` **18/0**、`lanqi:moments-ui-contract-smoke` **19/0**、`lanqi:moments-retest` 真实浏览器回归），详见 `docs/BUG_REGRESSIONS.md` QA-20260911-007 与下方「LQ-18 私域营销（板块4）复测收口（2026-09-11）」。

> **2026-09-11 追加（顾问「来源」标签口径纠正——回答用户「我们有没有做 RAG / 平台官方语料库」）**：用户在兰琪公域获客页 `#/lanqi/acquire/methods` 指着 AI 运营顾问回答底部的 `来源：xxx` 问「这个智能回复的来源是哪里？我们有蒸馏抖音/视频号/美团平台官方信息做 RAG 检索资料库吗？」。**结论必须一次说清：没有。** 兰琪顾问**没有任何 RAG 检索链路，没有抖音 / 视频号 / 美团官方语料库，也没有对这三家平台官方信息做过蒸馏**；标签只有两处来源——模型在 `sources` 字段自拟，或模型给不全时由 `buildSources()` 用 `ADVISOR_TOPICS` 六个话题的**通用打法名**补齐（例如「本地推投放要点」），该区块 UI 本来就只是对齐 demo `methods.html` 的硬编码标签陈列。原写法「来源：」+「已附参考来源」会让门店误以为这是有出处的资料，模型还可能写出「抖音官方算法文档」这类**编造的权威出处**。**已最小修复**：`advisor-rules.ts` 升 `advisor_rules_v2`，新增出处红线 `SOURCE_OFFICIAL_CLAIM` 与 `sanitizeSourceLabels()`（模型标签与确定性补齐标签都先过滤官方字样）；`advisor-service.ts` 升 `advisor_service_v3`，系统提示词写明「严禁出现「官方、公告、算法文档、内部资料」这类字样——我们没有接入平台官方资料库」；页面标签前缀改 `参考：`，并在标签上方固定渲染声明「以下为通用打法标签，按本店情况整理，不是平台官方发布」。三层回归：`lanqi:acquire-smoke` 顾问规则 **53/0**、顾问服务 **39/0**，`lanqi:acquire-ui-contract-smoke` **45/0**。**刻意不做的事**：不接一个假的「官方资料库」把「来源」坐实——真要接入平台官方信息 / 爆款检索，需要外部数据源与授权，是独立任务；与「爆款复刻的爆款检索未接通」「文案转片出片服务未开通（`VIDEO_RENDERING_READY=false`）」同属**设计内 fail-closed**，本轮不假装可用。详见 `docs/BUG_REGRESSIONS.md` QA-20260911-010。

> **2026-09-11 页面级验收（QA-20260911-010 收口）**：内测实例 `https://api.lcppch.top/lanqi-test` 真实浏览器探针（桌面 1440 + 移动 390，`scripts/tmp/lq19-advisor-source-note-browser.mjs`）**23/0** —— 两档都实测到 `参考：本地推投放要点` 等 2~3 条标签、声明「以下为通用打法标签，按本店情况整理，不是平台官方发布」可见、前缀为「参考：」、提示为「… · 已附通用打法参考」、无横向溢出、console/page 错误 0；接口级 3 轮 dy/sph/mt 真实 Provider 探针（`scripts/tmp/lq19-advisor-source-note-probe.mjs`）**17/0**。已把「顾问参考方法标签为 2~3 条且不含官方/公告/内部资料口径」沉淀为仓库内真实模型走查脚本 `scripts/lanqi-acquire-llm-walkthrough.mjs` 的常驻断言（该脚本需真实模型调用，不进 `qa:fast`）。

> **2026-09-11 发布（QA-20260911-010 上测试实例与生产）**：发布包 `release-20260911-lq19-advisor-source-note.tar.gz`（`8935546 B`，sha256 `88ff356f019439233c288eb81f5be2278d3315da67d9a47e94c14e414d1a0a50`，1428 个文件），发布 id `20260911-lq19-advisor-source-note-test1` / `-prod1`，两侧 `DEPLOY_OK`（测试 `health=200 (after 12s)`、生产 `health=200 (after 15s)` / `ready=200`），迁移 `48 migrations found` / `No pending migrations to apply.`。包内容为顾问来源标签口径修复的 5 个源码文件 + 3 个回归脚本（`advisor-rules.ts` / `advisor-service.ts` / `LanqiAcquireMethodsPage.tsx` / `lanqi-moments.css` / 三个 smoke）。生产复验：`scripts/tmp/prod-lanqi-lq19-acquire-acceptance.sh` **16/16 PASS**（含匿名 401、无 entitlement 403、跨门店 404 不回泄 B 门店 id、响应不含模型厂商名），新增生产只读探针 `scripts/tmp/prod-lq19-advisor-source-check.sh` **16/16 PASS**（dy/sph/mt 三问实测 `sources` 各 3 条、无官方口径、无厂商名），生产产物 `LanqiAcquireMethodsPage-BfHXCbQi.js` 含 `data-lanqi-advisor-source-note` / 「不是平台官方发布」/「已附通用打法参考」，`advisor-rules.js` 含 `advisor_rules_v2` / `SOURCE_OFFICIAL_CLAIM`。备份 `/opt/baolu-backups/20260911-lq19-advisor-source-note-prod1-before-baolu-os-v2/`（208M）；回滚＝还原备份目录 + `systemctl restart baolu-os-v2`。

> **2026-09-11 追加（兰琪品牌标识修正 + 上线板块收口，LQ-21）**：用户 2026-09-11 口径「兰琪 logo 头像不对；目前私域营销可以正常上线，其他板块显示开发中即可」。**已最小修复并上测试实例与生产**：① 侧栏左上角品牌位由纯文本 `<span class="lq-pd__logo">兰琪</span>` 换成真实品牌图 `apps/web/public/lanqi-logo.jpg`（154399 B / 1920×1509，与 0909 原型 `assets/logo/lanqi-logo.jpg` 逐字节一致），样式对齐原型 `.sh-icon`（48×40 / 圆角 11px / 白底 / `object-fit:contain`）；② **当前只有「私域营销」算已上线**——侧栏 8 项里只有它不带徽标，其余 7 项挂「开发中」徽标；经营驾驶舱（`/lanqi/dashboard`、`/lanqi/goal-setting`）与公域获客（`/lanqi/acquire*`，含 LQ-19 已验收页面）本轮也一律按「开发中」占位页接管，真实组件与路由分支**全部保留在仓库**，由 `apps/web/src/main.tsx` 的单点开关 `LANQI_MOMENTS_ONLY_LAUNCH` 控制（改回 `false` 即整体回滚）；③ 默认落地页 `/lanqi` → `/lanqi/moments`（入口重定向 / 免登录门 / `packages/shared` 的 `defaultPath` 三处一致）。回归：新增 `scripts/lanqi-brand-nav-contract-smoke.mjs`（修复前 **5 passed / 30 failed**，修复后 **35/0**，已进 `qa:fast`）与 `scripts/lanqi-brand-nav-browser-e2e.mjs`（内测实例真实 Chromium，桌面 1440 + 移动 390，**42 条断言 0 failed**）；`pnpm.cmd qa:fast` **PASS**。发布包 `release-20260911-lq21-brand-launch-full.tar.gz`（9248209 B，sha256 `24c61595407be94ee6c3d576f7fceb830485182400c7c79a1e49f6f1b7988d08`），发布 id `20260911-lq21-brand-launch-test1` / `-prod1`。**刻意不做**：不删驾驶舱 / 公域获客组件与 API、不动租户隔离与计费、不动「爆款复刻真实检索」「文案转片出片（`VIDEO_RENDERING_READY=false`）」两项设计内 fail-closed。右上角「我的」头像 `🧑` 与 0909 原型 `daily.html:542` 一致，本轮保留。详见 `docs/BUG_REGRESSIONS.md` QA-20260911-014 与任务卡 `tasks/LQ-21-兰琪品牌标识与上线板块收口.md`。

> **2026-09-11 追加（LQ-22 侧栏一级导航白字配色）**：用户问「一级导航页的字体从黑色改成白色会好看些吗」，看真实截图对比后定稿：**保留品牌橙 `#F37021` + 导航字改白 + 10px「开发中」徽标底色加深**。只动 `apps/web/src/styles/lanqi-moments.css` 4 条规则（品牌位/导航项字色 `#2D1A10`→`#fff`、hover 深棕蒙层→`rgba(255,255,255,.18)`、徽标底 `.14/.10`→`.30` 且字改白），`.lq-pd__side` 底色与激活项反白**未动**。**口径说清**：白字在品牌橙上只有 **2.94:1**（原深棕字 5.64:1），即**白字降低了 AA 达标度**，属用户明确选择品牌观感优先的**已声明 AA 例外**；但 10px「开发中」徽标改前只有 **2.71:1**（本就不达标），改后白字在加深底色上 **4.79:1**，反而达标且更好。回归：契约 smoke 35→**42/0**（红灯：只加断言不改样式时 **37 passed / 5 failed**）、`pnpm.cmd qa:fast` PASS、`pnpm.cmd --filter @baolu/web build` PASS、内测实例真实浏览器 `lanqi-brand-nav-browser-e2e` **0 failed**（桌面 1440 + 移动 390，白字/橙底/2.94:1/4.79:1/无溢出/console 0）；生产侧用线上 CSS 产物断言 5 条全部命中。发布 id `20260911-lq22-nav-white-text-test1` / `-prod1`，两侧 `DEPLOY_OK`（生产 `health=200 (after 33s)`）。**生产未跑浏览器 E2E**（生产需真人微信扫码登录，脚本卡在登录页），要补该证据需用户本人扫码后再跑。**不是 Bug**，故不登记 `docs/BUG_REGRESSIONS.md`（同 PLAT-15 只改文案不登记），但对比度已固化为回归断言。详见任务卡 `tasks/LQ-22-侧栏导航白字配色.md` 与 `docs/CURRENT_DEPLOYMENT_STATUS.md` 顶部条目。

> **2026-09-11 视频侧授权（2026-09-12 落地为 LQ-23）**：用户已拍板 ① 爆款复刻用 **A：`wan2.2-animate-mix` std**；② 文案转片 **`wan2.6-i2v-flash` 720P 无声 = 30 积分/秒、每镜 90 积分**；③ 首次真实联调费用上限 **¥10**；④ 素材桶方案 **B（素材只进自己的桶）**——四项均有用户明确「同意」。
>
> **2026-09-12 更正一处旧结论**：本节原先写「接通前必须先修 `apps/api/src/services/viral-video-replication.ts` 的 endpoint 白名单缺陷」——**这个判断是错的，代码侧白名单没有问题**。`replicationApiOrigin()` 刻意只放行 `https://dashscope.aliyuncs.com` + `/api/v1/services/aigc/image2video/video-synthesis`，并拒绝 query / hash / 账号信息，属 fail-closed 设计。**真正错的是生产 `/etc/baolu-secrets/baolu-os-v2.env` 里 `ALIYUN_VIDEO_REPLICATION_ENDPOINT` 被配成了 `.../aigc/video-generation/video-synthesis`**，是**配置写错**，不是代码缺陷。因此爆款复刻**一行代码都不用改**，只差：① 把该变量改回 `.../aigc/image2video/video-synthesis`；② 用户侧 OSS 信息（Bucket / Region 须 `cn-beijing` / Prefix / 结果 hostname / STS 临时凭据，方案 B）。**这两件都还没有做**，爆款复刻仍 fail-closed。
>
> **2026-09-12 LQ-23 文案转片真实出片已接通并上生产**：生产中 `LANQI_MEDIA_EXECUTION_MODE=real` + `LANQI_MEDIA_REAL_EXECUTION_APPROVED=true`（图片侧 `LANQI_MEDIA_IMAGE_REAL_EXECUTION_APPROVED` **未设**，付费生图仍关闭）。发布 id **`20260912-lq23-video-prod2`**（首次 `-prod1` 被 deploy 脚本一条过期断言拦在改文件之前，`service untouched`；已修断言后重发），包 `release-20260912-lq23-video-prod-full.tar.gz`（9307742 B，sha256 `a9c27e48…427a`，服务器实测一致，1458 文件）。两侧结果：`DEPLOY_OK`（`health=200 (after 15s)` / `ready=200`，48 个迁移无待应用）+ `VERIFY_OK`（`src_data_sha=dist=a668b642…`、`index_base_path=/os-v2/`、`skus_total=19` / `coming_soon=13`、两个 `vidrev=selling`）。**生产浏览器级 E2E 仍需真人微信扫码**（未登录访问 `/lanqi/acquire/video` 实测 302 到 `/os-v2/login/lanqi`，登录页为「微信授权登录」二维码；扫码跑通后回填本节）。详见 `tasks/LQ-23-文案转片真实出片接通.md` 与 `docs/BUG_REGRESSIONS.md` QA-20260912-008。

> **2026-09-12 追加（上一条「扫码跑通后回填本节」在此收口）**：生产浏览器级 E2E 第一次运行**未通过**——桌面 1200 视口 900s 内无人扫码（16 项里 12 项停在 `/os-v2/login/lanqi`），移动 390 视口扫码成功、确实离开了登录页，但只拿到**平台级**登录态，视频页断言全未通过（`path=blank`）。根因查清且**不在发布包**：① 平台入口 `/os-v2/login` 实测 `/auth/wechat-config → {"configured":true,"appid":"wxf405233d62ec376a","inviteRequired":false}`，平台层**不**强制邀请码；② **兰琪产品入口 `/os-v2/login/lanqi` 的产品邀请码是硬要求**（前端「产品邀请码 *」必填 + 服务端 `POST /auth/product-invite/validate`），用户扫码后正是被这一层拦住（原话「扫码也登入不了…需要邀请码才能登入」）。已按 `docs/BETA_RELEASE_CHECKLIST.md` §4 在**生产**补一个一次性兰琪产品邀请码（`InviteCode cmtxqpx0f0000jcq47ge1joxd`、`codePreview=la****p7`、`productCode=lanqi`、`planCode=local_standard`、`maxUses=3` / `usedCount=0`、`expiresAt=2026-10-12`、`label=lanqi-prod-verify-20260912`、`createdBy=codex:lq23-verify`；**明文只线下给用户，不入仓库**），并用只读接口实测 `POST /os-v2/api/auth/product-invite/validate` → **200 `{"valid":true,"productCode":"lanqi","productName":"兰琪美业经营增长系统"}`**；撤销＝把该行 `isActive=false`。验收脚本 `scripts/tmp/lq23-video-page-browser-e2e.mjs` 补 `--invite-code`（扫码前先填产品邀请码）后已重开窗口重跑。**截至本次记录仍未取得「扫码后全部断言通过」的生产页面级证据**；已实测通过的生产鉴权证据是：未登录访问 `/lanqi/acquire/video` → 302 `/os-v2/login/lanqi`。

> **2026-09-12 追加（LQ-24：WorkBuddy 第 3 轮报告收口 + 一条真实残留修复）**：用户交来《兰琪私域营销页回归复测报告（第 3 轮）》并指示「参考修复」。**先复核**：报告标为待处理的 2 条 P2（结果面板缺复制 / 重新生成、顶栏「多端实时同步」无反馈）**在 9-11 已修并已上线**——本轮真实浏览器实测 `tools.labels=["📋 复制文案","🔄 重新生成"]`、`syncToast="已同步 · 10:26（同一账号在手机和电脑看到的是同一份数据）"`，属**旧构建时效差异**（与第 2 轮两条 P1 同一性质）；报告澄清的「422 不是 bug」与我们的结论一致。**但顺报告反查出**一条真实残留：素材被判「还不够具体」（`result.needsInput`，规则层 `isInputRich`）时，结果面板走的是**另一套 JSX**，只有一句提示、**没有任何操作按钮**——这才是报告「结果卡片没有按钮」的真实现场，老板被判定素材不够后没有任何下一步出口。**最小修复（纯前端，两页各 +6 行）**：`LanqiMomentsPage.tsx` / `LanqiMomentsWechatGroupPage.tsx` 的该分支补「🔄 重新生成」（含进行态），**刻意不放**「复制文案」（该分支没有正文）。**先红后绿**：契约 smoke **23 passed / 3 failed → 26 passed / 0 failed**；真实浏览器（内测实例，规则判定复现、不花钱）**9 passed / 1 failed → 11 passed / 0 failed**（含 `needsRegen={"found":true,"disabled":false}` 与 `点「重新生成」真的又发起了一次升级请求 :: upgradePosts 2 -> 3`），补齐报告点名的**微信群话术页**断言后 → **14 passed / 0 failed**；`pnpm.cmd qa:fast` → `QAFAST_EXIT=0`。发布包 `release-20260912-lq24-moments-needs-regen-full.tar.gz`（9353793 B，sha256 `671423ad…372a`，1462 文件），发布 id `20260912-lq24-needs-regen-test1` / `-prod1`，两侧 `DEPLOY_OK` + `VERIFY_OK`，线上 index.html 引用的 chunk 实测均含 needs 分支新标记。**刻意不做**：「多版本切换」（报告标注可选，涉及额外模型调用与计价口径）；P3「其他板块显示开发中」按用户口径保留。详见 `docs/BUG_REGRESSIONS.md` **QA-20260912-012** 与任务卡 `tasks/LQ-24-私域营销信息不足分支补齐重新生成.md`。

## 生产收尾三项（2026-09-11，用户授权执行）

> 用户本轮明确授权：「① 清掉 LQ-18 验收残留（`LanqiMomentUpgrade cmtw353it057x12k47vkr6pux` + `LanqiMomentAsset b0e32259-…`）；② 用现有 `lanqi` 邀请码在生产跑一次注册端到端（新增 1 个一次性租户、占用 5 席位中的 1 个）；③ 真人扫码」。①② 已在生产执行并留证（可回滚）；③ 必须真人持 `cmengtv` 微信在浏览器完成 `snsapi_userinfo` 授权，Agent 无法代持微信凭据。**2026-09-11 用户补充：WorkBuddy 测不了微信，③ 改由用户本人「晚点人工来测试」**；Agent 侧只需把入口、席位状态与失败路径探针准备到「用户一次操作即可闭环」。

### ① LQ-18 验收残留清理（生产，可回滚）

- 目标：删除两条验收残留——`LanqiMomentUpgrade cmtw353it057x12k47vkr6pux` 及其关联的 `LanqiMomentAsset b0e32259-cc00-4bc0-a694-d502ad18bbde`。
- 前置核对：删除前 `LanqiMomentUpgrade=1`、`LanqiMomentAsset=1`，且**没有任何** `LanqiMomentAsset` 指向该 upgrade（`assets_pointing_to_upgrade=0`），删除不破坏引用完整性。
- 执行：单事务 `delete`，两行各 `DELETE 1`；删除后 `LanqiMomentUpgrade=0`、`LanqiMomentAsset=0`、目标行各 `0`（2026-09-11 07:0x 复核仍为 0）。
- 配图文件不删除，移到备份目录：`/opt/baolu-os-v2/uploads/moments/cmt6idd1c04v62hgb86gvh7pz/b0e32259-cc00-4bc0-a694-d502ad18bbde.png`（1957870 B，sha256 `fb665985f197dd5a05aa2f172cb44aa64995d146d858d429d6cac70e7cd62b9c`）→ `/opt/baolu-os-v2/.qa/lq18-cleanup-backup-20260911/`。
- 回滚包：`/opt/baolu-os-v2/.qa/lq18-cleanup-backup-20260911/`（`LanqiMomentUpgrade.csv` 1587 B、`LanqiMomentAsset.csv` 414 B、上述 png）。回滚 = 把两条 CSV `COPY` 回表 + 把 png 移回原路径。
- 生产库口径更正（本轮再次确认）：生产 `DATABASE_URL` 指向 **`baolu_os_v2`**（从 3002 进程环境读取）；仓库 `.env` 里的 `Sitong_os_v2` 凭据已失效，**不得**用仓内 `.env` 连生产。

### ② 兰琪产品邀请码生产注册端到端（消耗 1 席位，已通过）

- 新建一次性验收租户（用于证明真实注册链路可用，后续可单独回收）：
  - `Tenant cmtw4ovd1057y13ka0xmza9n9`「兰琪注册验收门店-20260911」，`local_business`／美业／上海，`createdAt 2026-09-10 22:58:14 +08`；
  - `User cmtw4ovd7057z13ka4sj3osqw`（负责人，无微信 openid）、`Membership cmtw4ovdk058313kavgpgk7g2`（owner）、默认门店 `cmtw4ovdd058113kaggcmkfti`「默认门店」；
  - `TenantProductEntitlement cmtw4ovi5059913ka9vkd5uxk`：`lanqi|active`、`source=product_invite`、`expiresAt 2026-10-10 22:58:14 +08`。
- 席位账：生产 `lanqi` 产品邀请码 1 条（label「兰琪美业生产首批开通 20260911」、`maxUses=5`、`isActive=true`、无到期），核销后 `usedCount=1`，**当时剩余 4 席**。邀请码明文只保存在本机 `%TEMP%\lanqi-prod-auth-20260911\`，不写入仓库/文档/报告。
- **回收（2026-09-11 07:15，用户要求，可回滚）**：该一次性验收租户已完成使命，删除 `Tenant cmtw4ovd1057y13ka0xmza9n9` + `User cmtw4ovd7057z13ka4sj3osqw`，并把邀请码 `usedCount` 由 1 退回 0（`maxUses` 仍 5）→ **席位恢复到满 5**。删除前全量备份 `/opt/baolu-os-v2/.qa/qa-tenant-rollback-20260911-071559/`（122 个文件，按 `tenantId`/`userId` 导出全部相关表 CSV，另有 `InviteCode__before.csv`）；回收后只读复核：目标 Tenant/User/`InviteCodeRedemption` 全 0、`Tenant` 总数 208、`InviteCode` = `usedCount 0 / maxUses 5 / isActive true`。回滚＝按备份 CSV 逐表 `COPY` 回插。踩坑已记录：`InviteCodeRedemption` 不级联 Tenant/User，需按 `tenantId` 显式删除，否则留孤儿行。详见 `docs/CURRENT_DEPLOYMENT_STATUS.md` 顶部条目。
- 页面级验收脚本（本轮新增，提交 git）：`scripts/tmp/prod-lanqi-signup-acceptance.mjs`，真实 Chromium 打生产 `https://api.lcppch.top/os-v2`，**全项 PASS**：匿名无 token → 产品入口渲染「微信授权登录 + 产品邀请码」→ 随机假邀请码被拒（页内中文提示、不发 token、停留原页）→ 真码校验通过 → 门店资料提交 → 落地 `/os-v2/lanqi/dashboard` → `POST /auth/beta-login` 回执 `invite={"source":"database","redeemed":true}` → 主会话刷新仍在工作台（不再出邀请码表单）→ 新租户 `GET /lanqi/stores`、`/account/status` 均 200 → 全新浏览器上下文仍匿名。报告与截图：`%TEMP%\lanqi-prod-auth-20260911\signup-shots\`。
- 会话态页面复验（`scripts/tmp/prod-lanqi-new-tenant-browser-verify.mjs`，注入服务端同密钥签发的短时 token）：驾驶舱加载完成（6 个标题 / 12 个 section+article）、刷新不丢会话、门店档案页渲染正常，`consoleErrors=[]`；截图 `verify-shots\01-lanqi-dashboard.png` 视觉确认为兰琪橙色工作台 + 经营驾驶舱 + 9 维健康度 + 本月目标卡。
- 只读接口复核（生产 3002；**服务端路由不带 `/api` 前缀，nginx 才加**）：新租户 `/lanqi/dashboard`、`/lanqi/stores`、`/account/status`、`/lanqi/store-profile`、`/lanqi/execution-plan/current`、`/lanqi/diagnosis/current` 全 200；存量兰琪租户 A `/lanqi/stores` 只看到自己的门店，无跨租户串数据；匿名 `/lanqi/stores`、`/account/status` → 401 `login_required`。
- 与「真人扫码」的关系：微信首次授权成功后会回到同一个补资料页，其后调用的仍是同一个 `/auth/beta-login` 建号逻辑（建租户、发 token、建钱包、核销邀请码）。因此本 E2E 是扫码路径的确定性等价验收，只差「微信 `snsapi_userinfo` 授权」这一步。

### ③ 真人微信扫码（未执行，阻塞在需要真人）

- 生产微信登录事实（只读核对）：`WECHAT_AUTH_APPID=wxf405233d62ec376a`、`WECHAT_AUTH_REDIRECT_URI=https://api.lcppch.top/os-v2/wechat-callback`；线上 `/os-v2/api/auth/wechat-config` → `{"configured":true,"appid":"wxf405233d62ec376a","inviteRequired":false}`。
- 入口与链路：`https://api.lcppch.top/os-v2/login/lanqi` → 点「微信授权登录」→ `open.weixin.qq.com/connect/oauth2/authorize?scope=snsapi_userinfo&state=…`（**网页授权，不是扫码登录**）→ 回 `/wechat-callback` → `POST /auth/wechat-login`。
- 服务端行为（`apps/api/src/routes/auth.ts:363` 起）：无 membership 且无 `productCode` → 200 `{needsTenant:true, onboardingToken}`；有 membership 但无该产品权限 → 403 `product_membership_required`；`productCode=lanqi` 且账号已在别的租户 → 403（不会自动开兰琪）。
- 截至 2026-09-11 07:0x 复核：生产近 3 天新建 6 个租户全部来自邀请码/开放注册，**没有任何微信授权新建的租户**；`User.wechatOpenid` 非空共 17 人，均为历史记录。即「没有从未登录过的微信号」这一前提在当前口径下仍成立，需用户本人用 `cmengtv` 微信在浏览器完成授权并补门店资料。
- 执行方式（用户人工；2026-09-11 09:1x 更正为「不再交 WorkBuddy」）：手机/浏览器打开 `https://api.lcppch.top/os-v2/login/lanqi` → 「微信授权登录」→ 用 `cmengtv` 确认授权 → 回到补资料页填门店名 + **产品邀请码**（明文只在本机 `%TEMP%\lanqi-prod-auth-20260911\`，不入仓库/文档/报告）→ 应落到 `/os-v2/lanqi/dashboard`；完成后回填落地截图/结果，本轮即可闭环。该路径**会新建 1 个租户并消耗 1 个席位**；2026-09-11 09:1x 生产只读复核：`maxUses=5`、`usedCount=0`、`isActive=true`（一次性验收租户已回收，席位满 5 可测）。若只想验微信授权本身，也可走开放注册主入口 `https://api.lcppch.top/os-v2/login`（无需邀请码，但不带 `lanqi` 授权，需后续补授权）。
- **失败路径已自动化（2026-09-11，用户要求补探针）**：新增 `scripts/tmp/prod-lanqi-wechat-failure-paths.mjs`（只读探针，不建租户、不消耗邀请码席位，可在生产直接跑）：A1 缺 `code`→400；A2 空 `code`→400；A3 非法 `tenantHostname`→400 `invalid_tenant_domain`；A4 无效 `code`→明确业务错误（不得 5xx）；B1 缺 `state`→页内拒绝且 0 次请求 `/auth/wechat-login`；B2 `state` 不匹配→同上；B3 用户取消授权→提示取消且 0 次请求；B4 无效 `code`→页面中文可读错误、不泄露内部信息。**首跑即红灯，揪出一个 P1 真缺陷**：`POST /auth/wechat-login` 传无效 code 返回 500 `internal_server_error`（「授权已失效」被说成「服务器故障」，并污染 5xx 告警）。已最小修复（`wechat-auth.ts` 区分 `invalid_code`/`upstream_unavailable`；`auth.ts` 映射 401 `wechat_code_invalid` / 502 `wechat_upstream_unavailable`，上游 `errmsg` 只进服务端日志），新增仓库回归 `scripts/wechat-login-failure-paths-smoke.ts`（红灯 22 passed / 12 failed → 修复后 **34 passed / 0 failed**，已接 `qa:fast`），并随发布 id `20260911-wechat-login-failure-paths-test1` / `-prod1` 上测试实例与生产；发布后探针**两侧各 8/8 PASS**。详见 `docs/BUG_REGRESSIONS.md` QA-20260911-004。
- 人工扫码时只需回归**正常路径**：失败路径已由上述探针覆盖，无需人工复现。
- **git 远端复核（2026-09-11 09:17）**：用户在 GitHub Desktop 完成 Publish 后，本机 `main` HEAD = `427df85f277cc01c3f48a8d322774acc7b564113`；`git push origin main` 输出 `d70ae5c..427df85  main -> main`；网络恢复后 `git fetch origin` + `git rev-parse HEAD origin/main` 两者同为 `427df85…`、`git status -sb` 为 `## main...origin/main`（无 ahead/behind）、`git ls-remote origin refs/heads/main` 连测 3 次均为 `427df85…` → **本地与远端 `https://github.com/renpolu123-png/baolu-os-v2-source.git` 一致**。本轮新增的验收脚本与文档（`docs/BUG_REGRESSIONS.md` QA-20260911-007/-008、`docs/CURRENT_DEPLOYMENT_STATUS.md` 台账、`scripts/lanqi-moments-retest.mjs`、`scripts/lanqi-moments-input-error-paths-smoke.ts`、`scripts/lanqi-moments-ui-contract-smoke.mjs`、`scripts/tmp/prod-lq18-empty-input-probe.mjs`、`package.json` 脚本入口）均已随本轮 3 个提交入库。工作区保留的 PLAT-09「视频复盘」改动**未混入**本次提交。部署侧同步核对：测试实例 `/lanqi-test` 入口 `index-C-em82Xd.js` 指向 `LanqiMomentsPage-U9HP08oR` / `LanqiMomentsWechatGroupPage-Duyi1NZJ`；生产 `/os-v2` 入口 `index-D50kxUAT.js` 指向 `LanqiMomentsPage-zrH-5AAR` / `LanqiMomentsWechatGroupPage-Dz_JXLy-`，均含本轮修复。
- 验收数据现状（2026-09-11 07:2x，生产只读，已含一次性租户回收）：`LanqiMomentUpgrade=0`、`LanqiMomentAsset=0`、`Tenant=208`、`TenantProductEntitlement(lanqi,active)=3`、`LanqiReferral=0`。

## LQ-18 私域营销（板块4）复测收口（2026-09-11）

> 用户 2026-09-11：「这个是 workbuddy 的测试（《兰琪私域营销页复测报告》）你看看是否合理及修复。今天的兰琪智能体要把私域营销页**全部测试通过**；公域获客页尽可能开发完；其他页面暂时显示开发中；私域和公域开发完之后我们先内部测试，没问题之后让用户来内测。」

- 核验：报告 2 条 P1 **都不成立**（测试方法问题）、2 条 P2 **成立并已修**、1 条 P3 按用户口径保留占位；另由报告线索反向查出**一个真 P1**（快速模式空输入被判 500）。详见 `docs/BUG_REGRESSIONS.md` **QA-20260911-007**。同轮另修掉一个**检查资产 P3**：`lanqi-moments-wechat-group-flow.mjs` 真实生成断言引用了产品从未渲染的标题「发布前检查」，见 **QA-20260911-008**。
- 「私域营销页全部测试通过」实测（打测试实例 `https://api.lcppch.top/lanqi-test`）：
  - `pnpm.cmd lanqi:moments-retest --generate --image` → **14/0**（现场证伪两条 P1：空输入给「请先写一句你的原话」不是 500；点 AI 配图后文案仍在 `bodyLen=93`、token 在、出图 200、`imageShown=true`）。
  - `pnpm.cmd lanqi:moments-wechat-group-flow --generate` → **8/0**（真实出稿 `27 字 → 96 字` + 5 条发布前检查项；证明原始反馈「微信群营销话术生成不了」已不存在）。
  - `pnpm.cmd lanqi:moments-asset-deployed-check` → **5/0**（兰琪作用域 200 + 真 PNG / 美业 403 / 跨租户 404 / 匿名 401）。
  - `pnpm.cmd lanqi:test-instance-acceptance` → **14/0**；`pnpm.cmd lanqi:acquire-instance-acceptance` → **30/0**。
  - 本地门禁：`pnpm.cmd qa:fast` PASS、`pnpm.cmd lanqi:moments-input-error-paths-smoke` 18/0、`pnpm.cmd lanqi:moments-ui-contract-smoke` 19/0。
- 「其他页面暂时显示开发中」：`/lanqi/cases`、`/lanqi/customers`、`/lanqi/analysis`、`/lanqi/sales-sim`、`/lanqi/store` 全部路由到 `LanqiPlaceholderPage`，页面明写「开发中 · 后续板块」，本轮**保留占位**，符合用户口径。
- 「公域获客页尽可能开发完」：LQ-19 已在 2026-09-11 上生产并专项验收（见下节）。四模式里 `copywriter` / `live` / `methods` 可用；`video` 的 `replicate`（真实爆款检索未接通）与 `assets` / `clip`（出片服务未开通，`VIDEO_RENDERING_READY=false`）为**设计内 fail-closed**，页面明确提示缺口、不假装成功——属「能跑 / 待外部条件」，非缺陷。测试实例实测 **30/0**。
- 生产发布：包 `release-20260911-lq18-moments-retest-fixes.tar.gz`，发布 id `20260911-lq18-moments-retest-fixes-test1` / `-prod1`，结果与 sha256 见 `docs/CURRENT_DEPLOYMENT_STATUS.md`。
- **生产只读复验 + 当日二次独立复跑（2026-09-11 09:0x–09:2x）**：新增 `scripts/tmp/prod-lq18-empty-input-probe.mjs`（生产机只读探针，自签会话借用存量兰琪租户，只发在调用模型前就被校验拦下的非法请求，不写数据、不产生费用、不建租户）→ 生产 **8 passed / 0 failed**（空原话 422 +「请先写一句你的原话」、专业模式空字段 422 点名、群话术空 detail 400、跨租户 storeId 404，四类响应均无内部串泄露），即「空输入被判 500」的 P1 在**生产实况**已关闭。生产 dist 取证：`LanqiMomentsPage-zrH-5AAR.js` 命中 `data-lanqi-moments-copy/-regen`、`LanqiMomentsWechatGroupPage-Dz_JXLy-.js` 命中 `data-lanqi-wechat-copy`。当日重跑（非沿用上轮数字）：`lanqi:moments-retest --generate --image` 14/0、`lanqi:moments-wechat-group-flow --generate` 8/0、`lanqi:moments-asset-deployed-check` 5/0（一次性租户回收后残留 0）、`lanqi:test-instance-acceptance` 14/0、`lanqi:acquire-instance-acceptance` 30/0、`lanqi:acquire-ui-contract-smoke` 37/0、`qa:fast` 退出码 0、`qa:lanqi-foundation` EXITCODE=0。残留 P3：群话术空 `detail` 的 400 响应 `details.fieldErrors` 仍是 zod 英文原文（页面已禁用按钮并给中文原因，正常用户走不到），下一批一并收。

## LQ-18 私域营销（板块4）本轮收口（2026-09-10）

- 用户本轮 7 条要求与落地：① 修「微信群营销话术生成不了」；② 修「AI 配图没有正常生成」；③ 私域营销页本轮开发完即收口；④ 下一步开发公域获客页（LQ-19）；⑤ 经营驾驶舱两页本轮不验收；⑥ 需要上生产；⑦ 本轮新增验收脚本与文档更新要提交 git。
- 两个 P1 已修并闭环（详见 `docs/BUG_REGRESSIONS.md` **QA-20260910-020 / -022**）：
  - **QA-020 微信群话术「生成不了」**：前端把「主题」当必填 → 只填「具体内容」时按钮永远灰着且不说明原因；后端同样把主题当必填，且 Provider 错误串会直接渲染到页面（会把模型名/厂商名暴露给老板）。修复：主题改可选 + 缺主题时按「具体内容」首句自动起标题（截断 18 字，字数口径只算具体内容）；按钮禁用给可见中文原因；生成失败只回人话，原始报错进服务端日志。
  - **QA-022 AI 配图「不显示」**：`moments-image.ts` 把 `asset.url` 硬编码成 `/beauty-industry/moments/assets/...`，兰琪租户没有该 entitlement → 取图 403 → 前端不看状态码，把 JSON 错误体塞进 `<img>` 变成破图。**生图是好的，取图作用域错了。** 修复：新增 `normalizeAssetBasePath()`，配图 URL 跟随注册作用域。
- 本轮新增验收脚本（提交 git）：`scripts/lanqi-moments-wechat-group-flow.mjs`（页面级，测试实例 **6/0**）、`scripts/lanqi-moments-asset-deployed-check.mjs`（**已部署实例**取图作用域 **5/0**，含"兰琪 200+真 PNG / 美业作用域 403 / 跨租户 404 / 匿名 401"，收尾精确回收合成资产与一次性租户）、`scripts/lanqi-moments-asset-scope-smoke.ts`（本机契约级 **9/0**）、`scripts/lanqi-test-instance-acceptance.mjs`（测试实例总验收 **14/14**），均已在 `package.json` 立脚本入口。
- 本轮自动验证：`pnpm.cmd lanqi:moments-smoke` PASS、`pnpm.cmd lanqi:moments-asset-scope-smoke` 9/0、`pnpm.cmd lanqi:moments-wechat-group-flow` 6/0、`pnpm.cmd lanqi:moments-asset-deployed-check` 5/0、`pnpm.cmd lanqi:test-instance-acceptance` 14/14、`pnpm.cmd qa:fast` PASS（退出码 0）。
- **生产授权已落地 + 同批修复一个 P1（2026-09-11，用户确认后处理）**：用户拍板「确认要处理生产 `lanqi` 授权」后，生产 `public` schema 已存在两条 `lanqi|active` 授权（`TenantProductEntitlement`，source `lanqi_launch_backfill_20260911`，`createdAt=2026-09-11 06:06:59 +08`），覆盖两个既有兰琪租户（`cmt6idd1c04v62hgb86gvh7pz`、`cmt6wlw7w0517pou3005wvk8o`），`expiresAt` 各自继承其 `beauty-industry` 的到期时间（`2026-09-23`）——即上面候选修法 (a)。门禁验收：兰琪租户 `/lanqi/stores`、`/lanqi/store-profile` → 200；对照租户（有 `founder-ip`、无 `lanqi`）`/lanqi/*` → 403 `product_entitlement_missing`；匿名 → 401，未越权。**同批暴露并已修复一个 P1**：`/lanqi/dashboard`、`/lanqi/goals`、`/lanqi/moments/upgrades` 一度全部 500（`Cannot read properties of undefined`），根因是发布脚本只在 `$STAGE` 生成 Prisma Client、overlay 排除 `node_modules`，生产运行时客户端缺 `LanqiStoreGoal` / `LanqiMomentDraft` / `LanqiMomentUpgrade` / `LanqiMomentAsset` 四个模型；已就地 `prisma generate` + 重启修复（备份 `/opt/baolu-backups/prisma-client-fix-20260911-061132/`），并给发布脚本加第 7b 步「就地生成 + 模型清单校验」、把 `pnpm db:client-model-check` 接入 `qa:fast`，详见 `docs/BUG_REGRESSIONS.md` **QA-20260911-001**。**边界（2026-09-11 06:07 +08 复核更正）**：生产已存在一条 `lanqi` 产品邀请码（`id=cmtw2vdk1000014cb2gpbccn2`、`codePreview=la****2t`、label「兰琪美业生产首批开通 20260911」、`maxUses=5`、`usedCount=0`、`isActive=true`、无到期、`createdBy=codex:lanqi-prod-launch-20260911`、`createdAt=2026-09-11 06:07:18 +08`）——**不是本轮发的，本轮未创建也未使用**（本条 2026-09-11 首版「生产仍没有任何 lanqi 邀请码」的记录已被生产实况推翻）。平台主入口（开放注册）注册出来的租户仍不带 `lanqi` 授权；走 `/os-v2/login/lanqi` + 产品邀请码才会按 `source=product_invite` 给新租户建 `lanqi|active` 授权（`apps/api/src/routes/auth.ts:725`），席位上限为 `maxUses-usedCount=5`。真人扫码注册端到端验收仍未执行（当前没有「从未登录过思潼 AI」的微信号）；`LanqiReferral` 仍 0 行。

- **生产发布（2026-09-10 完成）**：包 `release-20260910-lanqi-moments-wechat-asset.tar.gz`（8865072 B，sha256 `58ee722de78497ec810f5c52257080c28756b313e8b56203258d903740ad763c`，1421 文件）已发布生产，发布 id `20260910-lanqi-lq18-closeout-prod1`，`DEPLOY_OK` + 健康 200（after 15s）/ ready 200，migrate 无待应用迁移（48 migrations found）。生产入口产物 `assets/index-Ugq-Ml5W.js`；dist 内 `userFacingGenerationError`（3 处）/ `resolveWechatTopic`（3 处）/ `normalizeAssetBasePath`（2 处）均已命中。备份 `/opt/baolu-backups/20260910-lanqi-lq18-closeout-prod1-before-baolu-os-v2/`，发布日志 `/tmp/deploy-20260910-lanqi-lq18-closeout-prod1-baolu-os-v2.log`。**上线不等于可用**：同批实测生产仍无 `lanqi` entitlement 与 `lanqi` 邀请码，`/lanqi/*` 仍会被 `requireProductEntitlement("lanqi")` 挡住，见上一条与 `docs/CURRENT_DEPLOYMENT_STATUS.md`。

## LQ-20 经营驾驶舱（板块1）与目标设置（2026-09-10，**本轮不验收**）

> 用户 2026-09-10 指示：**经营驾驶舱那两页（`/lanqi/dashboard`、`/lanqi/goal-setting`）本轮不验收**，留到「经营驾驶舱开发」时再验收。下面这节保留的是当时已跑的开发期证据，本轮**不作为验收主张**，也不代表老板已验收。

- 已交付并可体验：`/lanqi/dashboard` 经营驾驶舱（结论条 → 本月目标与达成 + 右上角「⚙ 设置目标」→ 9 维经营健康度雷达 → 门店健康度红绿灯 → 今日关键指标 → 工具入口，顶部「🔔 今日待办」）；`/lanqi/goal-setting` 目标设置页（说明条 + 4 张目标卡 + 保存/取消 + 数据来源 8 行）。
- **数据口径（按 WorkBuddy 补充）**：只有「本月 4 个目标」（业绩 / 新客 / 升单 / 唤醒）手输，按 `store_id` + 月份存（`LanqiStoreGoal`，一月一条、同月只更新当前月、历史不覆盖）；已完成 / 会员数 / 沉睡率 / 卡耗率 / 预收负债 / 今日指标 / 9 维雷达全部自动统计、界面只读，不设任何录入框。月初未设目标不显示 0 或 NaN：显示「未设置 · 去设置目标」；上月有目标时显示「沿用上月」并标明来源月份。
- 9 维雷达按 0909 文档 `radarScore` 公式纯 SVG 渲染（≥85 绿 / 70–84 橙 / <70 红），不引图表库、不加动画、不可拖拽缩放。
- 一期只单店：UI 不出现「全部门店 / 门店切换器 / 多店聚合」；`chain.html`（二期连锁：多店聚合 + 总部视角 + 门店健康度列表）只在任务卡与本节登记，**本期不实现**。
- 同轮修掉 WorkBuddy《兰琪朋友圈获客测试体验报告》（2026-09-10）9 条：**7 条成立已修**——Bug1(P0) `/lanqi` 作用域下 moments/acquire 接口 403、Bug2(P0) `/lanqi/*` 路由 fallback 到外卖落地页、Bug3(P1) 未登录仍渲染功能入口、Bug6(P2)「今日待办」按钮无响应、Bug7(P2) 403 文案不分原因（后端加 `code`，前端分 4 类）、Bug8(P2) 无门店无 CTA、Bug9(P2) 按钮禁用无原因；**Bug4(P1)** 复核为原生 `required` 气泡在无头浏览器不可见，本回合给产品邀请码表单加 `noValidate` 改走页内中文提示；**Bug5(P1)** 复核为**当前源码不成立**（带会话访问 `/my-ai` 正常渲染工作台，0 console/page error），未改代码。详见 `docs/BUG_REGRESSIONS.md` QA-20260910-014。
- 自动验证（2026-09-10 本机实跑，全部 PASS）：`lanqi:dashboard-smoke`（规则 60/0 + API smoke PASS）、`lanqi:store-gate-smoke`（44/0）、`lanqi:moments-smoke`（47/20/9，0 failed）、`lanqi:store-access-smoke`（14/0）、`pnpm.cmd qa:fast`、`pnpm.cmd qa:lanqi-foundation`、`pnpm.cmd qa:full`（含 `qa:regression` + web/api `build` + `api-runtime-data-check:PASS`，`QAFULL_EXIT=0`）、`pnpm.cmd -r typecheck` 7/7、`git diff --check` 0。
- 页面验收（真实 Chromium，`scripts/lanqi-page-check.mjs`）：驾驶舱/朋友圈/微信群/`/my-ai`/登录页全部渲染正确，无门店时显示原因 +「去完善门店档案 / 门店后台」CTA，匿名实例 `/lanqi/*` 直接落 `/login/lanqi`，空邀请码点击出现「请输入邀请消息中的邀请码。」；console 错误 0、page error 0。
- **测试实例复验（2026-09-10，`https://api.lcppch.top/lanqi-test`）**：新增 `scripts/lanqi-test-instance-acceptance.mjs`（命令 `pnpm.cmd lanqi:test-instance-acceptance`），同一组 14 项断言连续 3 轮全 PASS（驾驶舱完整渲染含「本月结论/今日关键指标」、无 NaN、无「全部门店/门店切换」、无外卖串页、无 4xx/5xx、console/page 0 错误、目标页 4 个手输目标 + 未设目标显示「待设置」+ 数据来源表、朋友圈门店门禁无阻断、填好原话后「生成朋友圈文案」`disabled=false`（Bug1 场景）、`/my-ai` 兰琪已开通 + 进入入口）。Bug4（空邀请码页内提示）与 Bug3（未登录跳转）在非免登录实例（本机 5178）复验通过；免登录实例看不到登录页，故不在该实例验证。
- 已知边界：其余五个导航板块（门店AI使用案例 / 客户管理 / AI客户分析 / AI模拟销售 / 门店后台）仍是兰琪「开发中」占位页（本轮只保证不再 fallback 到其他产品）；真实 POS/收银/扣卡流水未对接，一期驾驶舱用带 `dataSource` 标记的演示数据源；仪表盘首次冷启动可见约 4–7 秒（静态资源逐个串行加载，接口本身 20–35ms），属体验优化项、不阻塞验收。

## LQ-19 公域获客（板块3，2026-09-10 开发 / 2026-09-11 上测试实例 + 生产并收口，**待业务验收**）

> 用户 2026-09-10 指示：私域营销页（LQ-18）收口后，**下一步开发公域获客页**。该板块代码本机已完成（免登录），测试实例部署 + 专项验收已于 2026-09-11 补齐，并同日上生产。

### WorkBuddy 走查报告复核 + 收口修复上生产（2026-09-11，收口本板块）

- 起因：用户交来 WorkBuddy 两份报告（`兰琪登录授权走查报告-cmengtv.docx` 打生产 `/os-v2/login/lanqi`；`兰琪公域获客测试报告.docx` 打测试实例 `/lanqi-test/lanqi/acquire`），要求「看下测试是否正确、要修改哪些 bug 就修」。逐条核验见 `docs/BUG_REGRESSIONS.md` **QA-20260911-005**。
- **登录报告 3 条「关键发现」全部是测试方法错误，登录链路未改一行代码**：① `cmengtv` 是用户给的**微信号**（用于真人扫码），被填进了**产品邀请码**框，403 `invite_code_not_found` 是正确负路径；② 「前后端 `inviteRequired` 不一致」是入口口径误读（产品入口 `/login/lanqi` 恒要产品邀请码，`inviteRequired:false` 是平台主入口开放注册的开关，即 QA-20260910-021 收紧后的既定行为）；③ `dev-login` 生产禁用是 fail-closed 设计。
- 公域报告 9 条：**成立 3 条**——#2 直播表单默认预填示例门店（真 Bug，**已修**：5 输入默认空 + 示例改 placeholder + 新增「填入示例」按钮）、#8 顾问快捷问题标点 `）` 错用（**已修**：改 `？`）、#3 `/my-ai` 加载 10–15 秒（体验，**登记残留**）；#1 直播 502 为**假阳性**（nginx `connect() failed (111)` 与 07:00 测试实例重启窗口重叠，07:36 重跑 16/16）；#5/#6/#7 是设计内 fail-closed 占位（不做假数据），#4 已有 `LOADING_TEXTS` 轮播、#9 锚点高亮属可选优化，均**未修/不改**。
- **由 #1 的 502 线索反向查出的真 P1（本轮主修）**：直播/顾问**间歇性 422**（真实大模型实测 live **5/6**、端到端走查 **14/16**）。根因两条缺一不可——① 合规门禁把「我**不**敢保证」「效果没法**保证**」这类**合规免责说法**判成效果承诺（与 0909「第一部分」误判同类：只看词、不看语境）；② live `MAX_ATTEMPTS` / advisor `ADVISOR_MAX_ATTEMPTS` 只有 2，模型偶发软违规时单次重写不足以稳定纠正。修复：新增语境感知 `containsPromiseClaims()`（否定线索 `不/没/别/难/无法`，≤2 字且不跨句才算免责；**门禁本身不放宽**）、重写次数 2→3、回灌提示点名违规词并要求「逐字删掉、不要换近义词保留」。**修的是误拦与重试预算，不是把合规检查放宽。**
- 发布：测试实例 `20260911-lq19-acquire-fixes-test1`、生产 `20260911-lq19-acquire-fixes-prod1`，同包 `release-20260911-lq19-acquire-fixes.tar.gz`（**8935166 B**，sha256 `641b9807fb1363be5bffde749441c0578601faa26868e8100952e73eb8a34d4f`，**1429 文件**）；两侧 `DEPLOY_OK` + 健康 200 / ready 200，migrate 48 / 无待应用，第 7b 步 `prisma delegates OK`（5 个兰琪模型）+ `client model coverage OK: 99 models`。备份 `/opt/baolu-backups/20260911-lq19-acquire-fixes-{test1-before-baolu-os-v2-test,prod1-before-baolu-os-v2}`。
- 修复后验收（全部实跑）：`scripts/lanqi-acquire-ui-contract-smoke.mjs` **37/0**（新增源码静态契约，不连网）；`pnpm.cmd lanqi:acquire-smoke` 全绿（acquire_rules 49/0、acquire_service 13/0、advisor-rules 48/0、advisor-service 35/0、live-rules 58/0、live-service 43/0、video-rules 80/0）；`pnpm.cmd qa:fast` PASS；测试实例真实大模型走查 **16/16**、重复探针 **live 6/6 · advisor 3/3**、页面级探针 `lanqi:acquire-instance-acceptance` **30/0**（含两条新断言）；生产接口验收 `scripts/tmp/prod-lanqi-lq19-acquire-acceptance.sh` **16/16 PASS**；生产产物 `apps/web/dist/assets/LanqiAcquireLivePage-*.js` 实测含「填入示例」，服务 `NRestarts=0`。
- 本包只含兰琪公域获客修复；服务器上并行的 marketplace/视频复盘改动未进包，保持上一版内容。

### 测试实例部署 + 生产发布 + 验收（2026-09-11）

- 发布包 `release-20260911-lanqi-lq19-acquire-test1.tar.gz`（8876681 B，sha256 `7272985e6e3ac50b6060085a1f0466828af4046cabd7830e5dd07b4b683d4879`，1422 文件）**测试实例与生产共用同一份产物**（服务器归档唯一，两侧部署日志第 0 步 `archive sha256` 一致）。
- 测试实例：发布 id `20260911-lanqi-lq19-acquire-test1`，`/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010，`https://api.lcppch.top/lanqi-test/`，`DEPLOY_OK` + 健康 200（after 9s）/ ready 200，migrate 48 / 无待应用。
- 生产：发布 id `20260911-lanqi-lq19-acquire-prod1`，`/opt/baolu-os-v2` · `baolu-os-v2` · 3002，`https://api.lcppch.top/os-v2/`，`DEPLOY_OK` + 健康 200（after 15s）/ ready 200，migrate 48 / 无待应用；入口产物 `assets/index-Ugq-Ml5W.js`，运行目录已有 `apps/api/dist/.../routes/acquire.js`（14184 B）。备份 `/opt/baolu-backups/20260911-lanqi-lq19-acquire-prod1-before-baolu-os-v2/`，日志 `/tmp/deploy-20260911-lanqi-lq19-acquire-prod1-baolu-os-v2.log`。
- **QA-20260911-001 的部署守护随本包上线并实际生效**：两份部署日志第 131/132 行打印 `prisma delegates OK: lanqiStoreGoal,lanqiMomentDraft,lanqiMomentUpgrade,lanqiMomentAsset,lanqiStoreProfile` 与 `prisma client model coverage OK: 99 models`，上一轮「守护脚本尚未随包上线」的边界解除。
- 测试实例验收（全部实测 PASS）：新增页面级探针 `pnpm.cmd lanqi:acquire-instance-acceptance`（`scripts/lanqi-acquire-instance-acceptance.mjs`，**28 项 0 失败**：枢纽 5 张卡 + 链接指向含 `mode=script`／copywriter 四步骨架与清空后本地拦截（新增请求 0）／video 四页签、爆款复刻 fail-closed 不编造条目、门店素材成片与 AI 剪辑 offline、文案转片四步走通、点「确认并生成」走肖像授权弹层后仍 fail-closed（弹窗「视频生成服务暂未开通」、出片请求 0）／live 必填缺失本地反问（新增排段请求 0）／methods 空输入禁用 + 6 chips／移动 390×844 无横向溢出／全页无模型厂商名／无 4xx5xx、console 与 page 0 错误）；`pnpm.cmd lanqi:acquire-smoke` 80/0；`pnpm.cmd lanqi:test-instance-acceptance` 14 项 0 失败（驾驶舱 / 目标设置 / 朋友圈 Bug1 / 工作台入口既有回归）。
- 生产接口验收（**本轮首次对生产 `/lanqi/acquire/*` 取证**，`scripts/tmp/prod-lanqi-lq19-acquire-acceptance.sh`，自签 JWT 只读，**16/16 PASS**）：匿名三接口 401 `login_required`；无 entitlement 对照租户 403 `product_entitlement_missing`；租户 A `video/storyboard` / `video/shot` / `live/plan` / `copywriter` 全 200（分镜 `shotCount=1` 且每镜 prompt 非空、直播 `rounds=5 segments=23 batches=19`、文案走真实 Provider 正文非空且不含模型名）；缺必填 422 反问；A 用 B 门店 → 404 `store_not_found` 且不回泄 B 门店 id。
- 残余边界：`VIDEO_RENDERING_READY` 未配置（minimax 未首充）→ 真实出片 fail-closed；爆款复刻无真实检索源 → fail-closed；两条均为设计内行为，不是缺陷。生产无 `DIRECT_TEST_LOGIN`，依赖免登录的兰琪专项脚本不能打生产。

- 已交付并可体验（本机免登录）：枢纽 `/lanqi/acquire`；子页 `/lanqi/acquire/video`、`/copywriter`、`/live`、`/methods`。小红书图文按 demo 无独立入口，由 video 四模式覆盖。
- 真实大模型接入：文案改稿、AI 运营顾问、直播话术逐字稿、文案转片分镜均由平台 `createRuntimeLlmProvider` 走真实 Provider（开发阶段消耗），输出后仍过结构 + 合规门禁，不合格 fail closed 不兜底。
- 本轮修两个 P1：①「成稿」步骤空白（`setStep` 与同步写编辑器竞态，改受控回填）；② 合规门禁误拦——序数用法「第一部分」、劝阻复述「不引导加微信／不用特效」、渠道名词「回复评论和私信」被当成违规导致整段/整批被毙，已改成语境感知判定（真违规仍拦）。详见 `docs/BUG_REGRESSIONS.md` QA-20260910-011 / -012。
- 免登录仅测试实例：`VITE_DIRECT_TEST_LOGIN`（前端）+ `DIRECT_TEST_LOGIN`（后端），本机直达不跳登录；账号密码登录统一由思潼 AI 平台设计后接入，本机不做登录页。
- 自动验证：`lanqi:acquire-smoke`（80/0）、`lanqi:moments-smoke`（47/20/9，0）、真实大模型 API 走查 16/16、真实浏览器走查 24/24、视频走查 25/25、`qa:fast` PASS、Web/API typecheck exit 0。
- 已知边界：minimax 未首充，真实出片 fail closed；爆款复刻检索源待定；`/my-ai` 首屏加载 10–15 秒、文案改稿等待偏长（已登记体验残留）。**（原「未部署测试实例」已于 2026-09-11 作废：本板块已上测试实例与生产，见上方两节。）**

## 思潼AI 货架（2026-09-10，开发中占位）

- 兰琪美业经营大脑已作为**品牌专属内核**上架思潼 AI 货架，独占「🧠 兰琪专区」（SKU `lanqi__lanqi-brain`）。
- 当前状态是「🚧 开发中」（`coming_soon`）+ 徽标「兰琪品牌 · 需授权」：货架可见、不显示价格、不可购买、不可运行；即使误改成可售，货架 `/run` 也只返回 409 `marketplace_skill_not_configured`，不执行、不扣积分（fail-closed）。
- 专区与内核都带 `zones:["lanqi"]` 白名单，不会出现在创始人 IP 或通用美业专区；兰琪品牌专属知识不下放给通用美业租户。
- 真正开放使用仍走兰琪自己的 8 板块工作台与产品授权（LQ-18 等），不是货架对话流；开放前需另立任务补 capability 与专项 Eval。
- 验证：`node scripts/marketplace-shelf-browser-e2e.mjs` PASS（断言兰琪专区仅 1 张卡、标「开发中」、详情「开发中 · 敬请期待」、无价格、console 错误 0）；`marketplace:foundation-smoke`、`marketplace:api-smoke`、`marketplace:db-smoke`、`qa:fast`、`qa:regression`、`build` PASS。

## LQ-18 私域营销（板块4，2026-09-09，待业务验收）

### 测试环境部署（2026-09-10）

- 独立测试实例已部署并外部可达：web `https://api.lcppch.top/lanqi-test/`、API `https://api.lcppch.top/lanqi-test/api/health`、私域营销入口 `https://api.lcppch.top/lanqi-test/lanqi/moments`。
- 隔离：目录 `/opt/baolu-os-v2-test`、systemd `baolu-os-v2-test`（端口 3010）、env `/etc/baolu-secrets/baolu-os-v2-test.env`、数据库同库独立 schema `lanqi_test`（47 项迁移已应用，含 `LanqiMoment*`）。
- nginx：`/etc/nginx/snippets/lanqi-test.conf`（`/lanqi-test/` + `/lanqi-test/api/` → 3010）；原配置备份 `qiwx-bot.conf.bak-lanqi-test-20260910`。
- 未改动生产 `baolu-os-v2`（3002，`/os-v2/*`）。原 `/chat-test` 属旧版页面，故测试实例用 `/lanqi-test/`。
- 免邀请码直登（仅测试实例）：新增 env 开关 `DIRECT_TEST_LOGIN`（后端，默认 false）+ `VITE_DIRECT_TEST_LOGIN`（前端）；测试实例设 true 后，登录页出现「本机直接开通并进入美业智能体」，无需邀请码直接进入，登录后落地 `/lanqi/brain`。生产未设=不变（`/os-v2/api/auth/dev-login` 仍 404）。
- DeepSeek 平台密钥接入（2026-09-10）：核对发现**生产 env 的 `DEEPSEEK_API_KEY` 已失效（直连 DeepSeek 返回 401）**，测试实例沿用同一把 key 因此报 `deepseek_provider_http_error`。已按用户提供的平台 DeepSeek key 更新 **生产 env + 测试 env + 本地 dev `.env`**（`DEEPSEEK_BASE_URL=https://api.deepseek.com/v1`、`DEEPSEEK_MODEL=deepseek-v4-pro`、`LLM_PROVIDER=deepseek`），重启 `baolu-os-v2` 与 `baolu-os-v2-test`；验证两环境直连 DeepSeek 均 200、`/health` 200、外部 `os-v2` 与 `lanqi-test` 均 200。密钥仅存于服务器 env（640 root:admin）与本地后端 `.env`，未写入代码/日志。

- 已交付并可体验：`/lanqi/moments`（朋友圈 fast/pro 双模式 + 配图建议下载）与 `/lanqi/moments/wechat-group`（微信群话术子页）。
- 后端：朋友圈规则引擎、升级服务、门店列表、升级/历史/微信群话术接口（beauty-industry 授权门禁内、`store_id` 隔离、`requestKey` 幂等落库）；新增 `LanqiMomentDraft/Upgrade/Asset` 表迁移。
- 文案生成已接入**真实大模型**（DeepSeek 经百炼，开发阶段消耗）：`upgradeMomentsLlm` 经平台 `createRuntimeLlmProvider` 调用，输出自然 AI 文风；生成后仍套诊断/评分/合规/结构门禁，结构不合格或含违规词 fail closed。
- 自动验证：`lanqi:moments-smoke` PASS（24/15/9）、`qa:fast` PASS、Web 构建 PASS、真实 LLM 端到端调用 PASS（钩子/占位/CTA/合规门禁全部命中）、浏览器真实点走 fast/pro/微信群主流程、干净刷新无新增控制台错误。
- 快速模式已补「传图片 · 本地预览」入口（对齐 Demo；真实文件选择的上传 E2E 需真实浏览器/bsk，本 in-app 浏览器不支持 setFiles）。
- 微信群话术已接真实大模型（`generateWechatGroupLlm`）；与朋友圈同一套 Provider，虚素材走「请补充」不编造。
- Phase 0a 门店 RBAC 已落地：`services/store-access-guard.ts`（老板=owner/admin 全店+agg；店长=manager/前台=staff 仅绑定店），moments 各接口逐请求重算，冒烟 14/14。
- 真实 AI 配图已落地（无积分直连）：`moments-image.ts` 直连百炼 wan2.7-image，OSS 结果下载落 `apps/api/uploads/moments/<tenant>/`，经鉴权接口读取下载；真实生成验证 PASS（HTTP 200、PNG 签名正确）；每张约 ¥0.2 开发成本。
- 已知边界：文案与微信群话术已接真实大模型（开发阶段消耗）；真实 AI 配图已可用（无积分直连，每张约 ¥0.2 开发成本）；RBAC 核心矩阵已落地，但「老板/店长/前台」的管理页（配置成员/角色）与 agg 看板接口尚未交付（属后续板块/Phase 0a 管理面）；移动 390 真机验收待补；未部署 chat-test/chat 生产环境。

## 全产品暂停停点（2026-09-03）

- 用户最新明确要求兰琪/美业智能体整体暂停开发，经营问答也停止对外验收；等待用户提供新的原型后再恢复。小红书图文、经营问答、WorkBuddy外部接入、视频及所有暂停任务均不得继续。
- LQ-17代码与既有验证证据完整保留，但任务状态改为 **PAUSED（代码已完成，停止对外验收）**；不创建邀请、不提供新的测试入口、不调用任何Provider、不部署。
- 本次暂停收口新增Provider调用0、费用¥0；不存在本轮active grant。当前环境仍为PostgreSQL55434/API3016/Web5176，source/runtime短指纹`450056B9`一致、source_fresh=true、ready/database=true、Web200，text=controlled_mock、media disabled/max0。
- 下一唯一恢复点：用户提交新的原型后，从权威任务卡和STATUS重新建立一个明确的原子任务；不得自动恢复旧排期。

## LQ-17 美业经营问答独立网页（2026-09-03，PAUSED）

- 用户已要求暂停小红书图文后续开发，当前唯一编码任务切换为经营问答独立网页；BY-19/BY-20 与媒体能力没有恢复。
- 固定链路为 `beauty_business_qa -> agent_beauty_acquisition -> general_qa@0.2.0`；兰琪薄路由只使用当前租户经营档案已确认事实，不加载估算字段或未授权知识。
- 已新增 `/lanqi/business-qa` 页面和 API，支持新问题、继续追问、历史和刷新恢复；空输入在运行前拒绝、同键幂等、同键异输入冲突、跨租户 404。
- Web 与 WorkBuddy 已接入同一执行/结构/账本合同：Web 按 `lanqi` entitlement，WorkBuddy 按绑定凭据的 `beauty-industry` entitlement；请求体不能切换租户、产品或 Skill。
- 真实限额验收共调用 `deepseek-v4-pro` 3 次、媒体 0、保守费用约 ¥0.01754：普通 WorkBuddy 问答成功并仅保存一个 succeeded AgentRun/结算 5 积分；两条失败链暴露并修复“输出合同校验晚于保存”和“安全拒绝被 `generic_ai_tone` 误判”，失败积分已释放/补偿。授权用完后未追加调用。
- 当前用户入口保持 controlled mock 并明确显示流程预览，不代表正式模型质量；问题只强制至少 2 个字，无其他必填资料，经营档案仅作为可选已确认背景。
- 专项、兰琪领域门禁、API/Web/Agent typecheck、`qa:fast/regression/full`（含 build）全部通过；桌面页面完成生成、追问、刷新恢复且 console warn/error 0；本轮无 UI 变更，390px 沿用同页面既有 E2E 无横向溢出。LQ-17 受控流程范围 P0/P1=0。
- 当前受控环境为 PostgreSQL 55434、API 3016、Web 5176，source/runtime 短指纹 `450056B9`、`source_fresh=true`、ready/database=true、Web 200；text=`controlled_mock`、media disabled。

- 正式版入口路线（2026-08-24）：已确认兰琪品牌版将复用美业智能体的产品介绍、微信/手机号登录注册、首次体验码验证、门店向导和会话保持链路，仅通过品牌配置替换名称、Logo、品牌色、独立入口与专属知识。当前仅记录路线，不修改源码、内测入口或生产环境；正式实施时再建立独立任务卡、原型和桌面/移动端 E2E。
- 产品状态：产品与开发架构、LQ-01/LQ-02 受控知识底座、LQ-03 推荐独立开通、LQ-04 门店经营档案、LQ-05 资料型经营诊断、LQ-06 执行方案草案、LQ-09/LQ-10/LQ-14 底层阶段及 LQ-15 统一小红书图文页面均已完成本地实现与受控验收；LQ-14 三张真实图片已成功，尚未生产部署。
- 已确认定位：所有授权门店使用兰琪方法论与内部定价，不建设去兰琪化的通用版本。
- 已完成基础：产品定义、开发顺序、业务契约、知识分层、测试矩阵和任务入口。
- 当前编码任务：全部PAUSED并进入idle；下一任务只能在用户提供新原型并重新明确范围后创建，不自行恢复经营问答、WorkBuddy、小红书、视频或BY-19/BY-20。
- 当前协作方式：思潼主导产品与开发；兰琪按需提供其专属方法论、内部定价、业务案例和业务校对，不承担技术方案逐项审批。
- 当前阻塞：LQ-17 受控流程范围无未解决 P0/P1。真实 WorkBuddy Connector/OAuth 与高风险真实答案重复验证、生产对象存储、生产迁移和生产部署均未执行；未获得真实资料前不激活任何兰琪方法论或内部定价。小红书图文按用户要求暂停，不得邀请继续测试其文案或图片。
- 当前检查：模型/推理策略、LQ-14 专项、提示词确定性 Eval、真实 Pro 8×3 Challenger、桌面/390px、断网恢复、可信 prompt 绑定、保存/刷新恢复、幂等与双租户隔离均 PASS；真实 Challenger P50 17.118 秒、P95 20.935 秒、24/24、硬失败 0。真实 `wan2.7-image` 三图仍为 3/3 成功、3 笔媒体交易、预计供应商成本 ¥0.60、租户本地资产 3 图 + 3 元数据；本次未新增图片任务或图片费用。

## LQ-16 Qwen3.8-Flash 候选接入（2026-09-03）

- `qwen3.8-flash` 已通过阿里云百炼 OpenAI 兼容接口接入兰琪专用模型工厂，但默认 `enabled=false / evalApproved=false`；当前客户路径、运行环境和专业输出均不使用它。
- 2026-09-03 受控真实 Challenger 最多 3 次、¥0.05 授权下实际调用 2 次后停止：首轮完整 PASS；第二轮 HTTP/JSON/usage 正常，但被评测器与提示合同不一致的“必须重复价格二字”断言误拒绝。该断言已离线修复并登记 `QA-20260903-001`，本次未补跑第 3 次；累计估算 ¥0.002923，重试/换模/追加 0。
- 用户重新批准全新受控批次后，修正后的同一脱敏 Eval 严格 3/3 PASS：三次均 HTTP 200、`finish_reason=stop`、思考 tokens 0，合计估算 ¥0.004184≤¥0.05，重试/换模/追加/额外调用 0。Qwen 已标记为低风险候选“真实准入通过”，但默认开关和当前客户路径仍保持关闭。
- 候选只允许 `low_risk_formatting`，且必须“显式启用 + 同套 Eval 批准”同时成立；知识综合、小红书策略/文案、专业图片提示词和视觉修改即使开启候选仍固定 `deepseek-v4-pro`。
- Qwen 请求固定非思考、`preserve_thinking=false`、`reasoning_standard` 与最多 2048 输出 tokens，支持 JSON Output；缺密钥、缺地址、未知候选或门禁不一致均在网络调用前失败关闭。
- 共享国内模型 Provider 只增加供应商无关的显式模型校验钩子与百炼参数序列化；候选策略仍归兰琪产品，不因一个产品验证就沉为全平台默认能力。
- 新 Eval 修复前稳定红灯，修复后连续 3/3 PASS；`qa:lanqi-foundation`、`qa:fast`、`qa:regression`、`qa:full`（含 build）全部 PASS。外部网络 0、真实 Provider 0、费用 ¥0，未修改页面、路由、数据库或媒体状态。
- 尚未做真实 Qwen Challenger，因此当前只完成“安全接入”，不宣称它已达到兰琪业务质量或成本替代线；真实对比需新的明确预算授权。

## LQ-15 统一小红书图文页面收口（2026-08-21）

- 用户入口统一为 `/lanqi/content-studio`：一次输入、素材权利确认和按钮旁整包报价确认后，同页完成文案、内部图片提示词、图片任务、复制、下载和刷新恢复；`/lanqi/image-studio` 仅保留兼容/内部调试，不进入主导航。
- 浏览器强制闭环修复三项 P1：正常 HTTP 被 `raw.destroyed` 误判 499、无关 Provider fallback 冒充小红书文案、受保护图片直接 `<img src>` 被 ORB 阻断。现在取消只依据真实 aborted，专业文案 fallback fail closed，图片经租户鉴权获取 Blob 后显示/下载。
- 桌面和 390×844 受控 E2E PASS：成功作品、三标题/正文/标签/互动、图片显示、下载、刷新恢复、部分成功、只重试图片、断网和恢复均有明确状态；复制权限被测试浏览器拒绝时显示可见失败提示；新浏览器会话无应用控制台错误。
- 费用与隔离边界：确定性 E2E `paidProviderCalls=0`，没有创建第四个百炼任务或新增积分流水；真实新增图片仍需新的明确授权，mock 只证明工作流与失败路径，不冒充真实成图质量。
- 最终门禁：锁定 pnpm 9.15.0 原始执行 `lanqi:xhs-package-smoke`、`qa:lanqi-foundation`、`qa:fast`、`qa:regression`、`qa:full` 全部 PASS；`git diff --check` PASS（仅现有 Windows 换行提示）。无未解决 P0/P1。
- 下一步：停止独立网页扩展，建立兰琪 WorkBuddy MCP v1 任务卡；MCP adapter 只复用同一 Agent/Skill/知识、租户权限、计费与图文工作流。

## 图片工作室 P1 与提示词延迟收口（2026-08-21）

- 撤回旧可验收状态后完成强制 Bug 闭环：请求状态机支持阶段、耗时、取消、硬超时、晚到响应丢弃和旧预览保留；网络失败保留输入并恢复按钮。
- 合成验收 A/B 门店名、tenant 标记和城市不再作为真实事实进入模型或可复制提示词；未确认门店名使用“本店”。“问题肌肤修复”规范为日常护理/舒缓护理，不表达治疗或效果承诺。
- 图片批次额度已用完时，顶部“确认并生成图片”、三张任务卡“重新生成”和调整后生成共用服务端授权状态，真实禁用并显示需要新授权；同幂等键只恢复原任务。当前图片 Provider 任务、媒体任务和媒体积分交易仍严格为 3。
- Champion 第 1 例 81.734 秒后 `length` 硬失败；根因为 V4 Pro 默认 thinking 在 4096 上限内耗尽输出。图片提示词保持 `deepseek-v4-pro`，采用 `standard + thinking disabled + max_tokens 4096 + JSON Output`，Skill/提示词版本 1.0.1。真实 Challenger 8 类×3 为 24/24、P50 17.118 秒、P95 20.935 秒、reasoning tokens 0、硬失败 0，估算文本成本 ¥0.4458。
- 真实页面在持久验收环境保存 1.0.1 专业预览，3 张历史图片完整恢复；桌面主路径、既有 390px 布局、断网、取消、刷新、返回和付费禁用态 PASS。验收链接保持 `http://127.0.0.1:5175/lanqi/image-studio?apiBase=http%3A%2F%2F127.0.0.1%3A3015`。
- 本节后续顺序已由 LQ-15 与最新 MCP 优先级覆盖；当前顺序见文首 LQ-15 收口。独立网页与 WorkBuddy MCP 仍必须共用同一兰琪后端、知识、权限、积分账户和 usage ledger；商业充值参数未确认前不实现兰琪专属钱包或生产充值。

## LQ-14 持久验收环境重建（2026-08-21）

- 新隔离环境位于 `F:\思潼AI增长os\test-environments\lanqi-acceptance-20260821`；数据库只监听 `127.0.0.1:55433`，26 个迁移首次部署 PASS、第二次无待迁移。API `127.0.0.1:3015` 与 Web `127.0.0.1:5175` 当前保持运行。
- 两个合成租户均有未过期 `lanqi` 产品授权；A 租户任务 0，B 租户三图任务 3。A 列表为 0 且读取 B 资产返回 404，B 的 3 个任务均 `succeeded / charged / persisted / selected / saved`。
- 经新 ¥1 上限授权再次完成三张真实 `wan2.7-image` 图片，Provider 任务严格为 3、媒体交易严格为 3、无第四次任务、无自动付费重试；公开价估算累计 ¥0.60，供应商账户最终账单未查询。
- 修复 QA-20260821-003：百炼 `message.content` 为单对象时旧解析器漏取图片；先建立失败回归，再最小规范化为单元素数组。同一 Provider 任务刷新恢复，未重复付费。
- 三图与元数据已保存；逻辑数据库 dump 可读，资产/备份/脚本共 15 项 SHA-256 清单全部匹配。已实际执行安全停机，3015/5175/55433 全部停止监听，再由 `start.ps1` 恢复；状态脚本报告 `database=True`、3/3 成功并落库，重启后的新浏览器页面恢复三图且控制台 0 错误/告警。
- 当前门禁：`qa:lanqi-foundation`、`qa:fast`、`qa:regression`、`qa:full`、`git diff --check` 全部 PASS；桌面与 390px、断网/恢复、重复确认、终态取消 409、刷新恢复、控制台与双租户隔离 PASS。无未解决 P0/P1。

## LQ-14 同页图片任务链路完成（2026-08-20）

- 统一入口：`/lanqi/image-studio`；用户确认专业提示词后在同页创建任务并查看进度、结果、失败、取消、重新生成、选择和保存。
- 默认真实执行仍关闭；本轮仅在隔离测试环境以已批准的 ¥1 上限临时启用真实模式，未改生产配置。受控模拟仍不调用外部模型、不计费，模拟图明确不代表真实画质。
- 成功只在供应商结果落入租户资产区后成立；成功/取消/退款事务互斥，失败或取消只退一次，临时供应商 URL 不对用户暴露。
- 模型与费用：2026-08-20 通过当前百炼账号模型目录只读查询确认华北 2（北京）`wan2.7-image`、IG 能力和公开价 ¥0.20/张；同页真实三图 3/3 成功，预计模型成本 ¥0.60，低于 ¥1 上限，无第四次提交、无付费重试。
- 真实链证据：3 个任务均 `succeeded / charged / persisted / selected / saved`，提示词版本 `1.0.0`；租户测试积分 300 → 0，任务数与媒体交易数均为 3。结果只保存到该租户本地资产目录，未持久化 Provider 临时 URL。
- 已修复真实 Bug：百炼成功结果使用 `dashscope-*.oss-accelerate.aliyuncs.com`，旧默认白名单未包含 OSS 加速域名，导致首图已成功但无法落库；先建立修复前失败 contract，再最小补充域名，同一 Provider 任务恢复成功，没有付费重试。
- 专业文本模型仍固定 `deepseek-v4-pro`：小红书文案保持 `reasoning_high/deep`；图片提示词与多轮视觉修改经同套 Eval 后采用 `reasoning_standard + thinking disabled + JSON Output`。`deepseek-v4-flash` 尚未通过兰琪同套 Eval 和显式激活，只登记为低风险结构化候选。
- 图片任务新增实际 Provider/model、promptVersion 等内部审计字段；DeepSeek 不生成图片。`packages/agent` 与 API 只做兰琪图片提示词 standard 映射的最小共享修复，兰琪专属 Skill 更新到 1.0.1；`packages/shared`、`agent-definitions` 未因本项修改，也未读取、复制、注册或依赖桌面待审计 WorkBuddy Skill。
- 共享热点已释放：`packages/agent` 与 API reasoning 映射本轮不再修改；`packages/shared`、`packages/skills`、`agent-definitions` 继续保持释放，可供底层网关和 Skill 治理串行使用。

## 开发模型策略

- 当前 LQ-14：高能力编码模型 + high 推理，任务标签 `reasoning_high`；适用于跨租户、授权、异步 Provider、计费幂等和架构/安全根因。
- `reasoning_standard` 只用于纯 UI 微调、机械测试和文档整理，不得替代复杂根因分析，也不能跳过浏览器 E2E 与完整门禁。
- Codex 自主选择：按以上规则自动切换；若升级预计会显著增加消耗或任务存在两种同样合理的商业方向，再先向你说明并征求选择。
- 最近更新：2026-08-20。

## LQ-06 更新（2026-08-13）

- 已完成本地“项目、获客与成交”准备页：`/lanqi/execution-plan`。
- 当前只提供资料齐备度、授权知识待接入项和草案阶段状态；不展示项目、内部定价、话术、案例或效果承诺。
- 正式方案仍依赖兰琪提供并确认：项目定义、内部定价版本、获客与成交 SOP、适用范围与审核规则。
- 下一项编码任务：接入经授权的兰琪方法论与内部定价资料，并建立可审计的版本、适用范围和审批流程。

## 已登记需求：LQ-08 小红书内容与视频创作工作台（2026-08-13）

- 范围：小红书营销文案、配图生成、文生视频、图生视频，以及爆款视频复刻。
- 开发顺序：先图文与视频创作，稳定后接入爆款视频复刻；不自动发布、投流、发消息或付款。
- 爆款复刻复用现有阿里云换人/换头链路，不重复建设供应商、授权确认、幂等扣费、退款和回调能力；兰琪仅做独立入口和租户/内容边界。
- 兰琪方法论资料由业务方后续提供。资料到位前可做基于门店自身事实与素材的通用草案，但不得冒充兰琪方法论、案例、价格或效果承诺。
- 详细任务卡：`tasks/LQ-08-小红书内容与视频创作工作台.md`。

## LQ-08 第一批完成（2026-08-13）

- 已实现小红书文案、配图提示词、文生视频提示词与图生视频前置状态：`/lanqi/content-studio`。
- 未配置媒体供应商时只保存本店草案，不调用外部生成服务或扣费。
- 下一项：接入经确认的图片、文生视频与图生视频供应商，补齐报价确认、幂等计费、取消/退款、回调和媒体下载验收；之后接入既有阿里云爆款复刻入口。

## LQ-08 媒体生成接入（2026-08-13）

- 已接入阿里云百炼图片、文生视频和图生视频的确认式任务链路：先报价，用户点击确认后才扣积分并提交供应商。
- 已支持横屏/竖屏、720P/1080P、5/10 秒，默认门店售价和积分成本均可由环境变量配置。
- 媒体任务、积分流水和结果查询均按当前租户隔离；供应商提交失败或返回失败时自动原路退回积分。
- 尚未执行真实生成请求；真实验收需由业务方在非演示租户亲自确认一笔可接受的测试生成费用。

## 验收环境状态（2026-08-13）

- 已修复兰琪档案页在前端登录态与 API 不一致时继续展示不可编辑表单的问题：接口返回未登录时清除失效登录态并回到登录页。
- 公共登录/鉴权任务已完成产品入口与授权回归；已在当前源码服务（5175 前端、3013 API）完成“产品入口 → 兰琪登录页 → 内部演示登录 → 门店档案保存 → 资料型诊断 → 内容创作页”的浏览器验收，页面控制台无新增错误。
- 内容创作页在没有草稿时保持媒体生成禁用；本轮没有点击确认生成、没有调用阿里云、没有扣积分或产生真实费用。
- 媒体生成改为同时要求“百炼 API 密钥 + 当前类型已开通的模型配置”；任一缺失时确认接口拒绝且不扣积分，避免配置不完整却展示为可生成。
- 当时阻塞（后续已解除）：本地开发目录没有非空百炼密钥，无法进行只读模型目录检查或真实生成验收；后续已使用受控配置完成只读模型核验和 LQ-14 三图验收，未输出或提交密钥。

## 本机固定体验入口（2026-08-14）

- 本机固定入口已启用：`http://localhost:5175/lanqi/local?apiBase=http://localhost:3013`。仅 `localhost` / `127.0.0.1` 的开发模式可自动进入兰琪内容创作工作台，不需要邀请码；正式环境与非本机地址仍执行正常登录和产品授权。
- 已实际浏览器验证入口自动进入 `/lanqi/content-studio`，页面显示小红书图文与视频创作、草稿创建和媒体任务空状态；本次未确认生成、未扣积分、未调用外部服务。

## 百炼凭证与模型核验（2026-08-13）

- 已在当前项目 API 私密环境文件找到有效百炼密钥；密钥内容未读取、未输出、未写入版本库。
- 已完成只读模型目录检查：账号可用 `wan2.7-image` 与 `wan2.7-image-pro`；当前未返回文生视频、图生视频模型。
- 下一步：经用户确认单笔测试费用后，用 `wan2.7-image` 做一张内部合成提示词图片的受控真实联调；视频能力等待账号开通模型后再接入和验收。

## 生图真实联调（2026-08-13）

- 经用户逐笔确认后，已用不含客户数据的内部合成提示词完成 1 张 `wan2.7-image` 生图：供应商任务 `SUCCEEDED`、结果图片可下载、视觉检查通过，并带有 AI 生成水印。
- 首次请求因旧接口缺少 `input.messages` 被百炼拒绝，未产生图片结果；已修复请求与结果解析，第二次受控请求成功。回归登记为 `QA-20260813-003`。
- 生图链路可进入用户验收；文生视频和图生视频仍因当前账号未返回对应模型而保持关闭，不能向用户承诺可用。

## 内容工具拆分决策（2026-08-14，历史决策，已由 LQ-15 覆盖）

以下记录只用于说明演进过程，不再代表当前用户产品地图；当前小红书文案、图片提示词与图片任务已统一为 LQ-15。

- 原 LQ-08 综合工作台已停止作为编码任务，保留为历史总卡；用户确认改为五个相互独立的功能入口，点击哪个就进入哪个功能区。
- `LQ-09 小红书文案生成`：当前唯一编码任务，只输出文案；用户如需图片，主动进入文生图，不自动串联。
- `LQ-10 文生图`：独立生成图片；公共真实生图链路已验证，仍需完成独立页面和全流程回归。
- `LQ-11 文生视频`：独立生成视频；当前因账号未返回文生视频模型而阻塞。
- `LQ-12 图生视频`：独立选择有权使用的图片生成视频；当前因账号未返回图生视频模型而阻塞。
- `LQ-13 直播话术`：独立调用 `live_script_planner`，只输出直播话术，等待 LQ-09 完成后串行开发。
- 跨功能只允许用户主动跳转并带入内容；禁止一键自动生成文案、图片和视频整套内容。
- LQ-09 已完成专用 `xiaohongshu_ops` 的共享 SkillId、manifest、Agent 运行时、门店获客能力和 MCP 原始包注册；兰琪页面与 API 已从通用 `baolu_content_creator` 切换为固定专用 Skill，只生成并保存文案，不创建媒体任务。
- 门店已确认事实、城市、目标客群和兰琪知识版本状态会显式注入；无激活知识时说明未引用兰琪专属方法论或内部定价。租户级幂等、保存恢复、公开字段过滤和 `requested/succeeded/needs_input/failed` 事件已建立。
- 专项 smoke、Skill 校验、全仓类型检查、完整回归组件和全仓构建 PASS；真实文本生成高风险样例最终 3 次硬失败为 0，重复提交复用草稿，门店 A/B 隔离 PASS。
- LQ-09 已达到正式可验收：本机登录、档案、422 待补、重试、真实生成、重复点击保护、保存/刷新恢复、网络失败恢复、桌面/390px、控制台与关键 API 均 PASS；最终 3 次高风险真实输出总硬失败为 0。
- 原始 `qa:fast`、`qa:regression`、`qa:full` 已由本机安装的锁定 pnpm 9.15.0 实际运行并全部 PASS，未绕过签名与完整性保护。
- LQ-09 对四个公共热点的改动已收口并释放；LQ-10 已成为下一张串行任务，但尚未执行任何新的真实图片调用或付费动作。
- 最新媒体串行顺序：LQ-09 小红书文案（完成）→ LQ-10 文生图零付费预览（完成）→ LQ-12 图生视频 contract/mock/E2E → LQ-11 文生视频 contract/mock/E2E。LQ-13 直播话术仍为独立任务，由总调度在媒体任务间另行排期；两项视频不得冒充已接通。

## LQ-10 零付费版本完成（2026-08-14）

- 独立页面：`/lanqi/image-studio`；小红书文案页提供“文生图”主动入口。
- 独立 API：`GET/POST /lanqi/image-studio/previews`；复用 `LanqiContentDraft` 保存，按 `tenantId + platform` 隔离，不新增迁移。
- 页面只生成提示词、门店事实摘要、知识状态、100 积分产品预估及 `media.image.generate`/存储/计费依赖；不调用付费媒体接口，不创建 `LanqiMediaJob`，不扣积分。
- 422 覆盖缺授权、模糊需求、夸大疗效、未授权真人和内部信息诱导；网络失败与超时保留输入。
- 浏览器发现并修复重复点击重复保存：成功后保持请求键直至输入变化；修复后第二次点击恢复同一预览，历史数量不增加。
- 真实接口证据：同请求幂等，A 租户 1 条、B 租户 0 条，媒体任务 0；桌面和 390px 页面、刷新恢复、网络失败、导航、登录及控制台全部 PASS。
- 放行门禁：`lanqi:image-studio-smoke`、`qa:lanqi-foundation`、原始 `qa:fast`、`qa:regression`、`qa:full` 均 PASS。

## LQ-10 专业提示词增强收口（2026-08-14）

- 新增并固定调用 `lanqi-image-prompt-enhancer`，将普通需求拆为可编辑意图、必要待补问题、三个不同变量的方向、正负提示词、后期叠字、视觉参数、知识/事实边界和 `media.image.generate` adapter。
- 正向提示词已与计费、权限、系统说明和管理式规则分离；运行时输出不合约时自动降级为可执行视觉提示词，不创建图片任务。
- 同页已放置第二步“确认并生成图片”，但在真实授权、永久存储和图片模型放行前保持禁用；用户无需去其他页面复制提示词。
- 真实页面发现并修复：空泛方向名、授权门店误追问实景、安全否定语句被误判为冒充请求，以及演示模式被旧外部 MCP 覆盖；均已有回归。
- 三次生产路径文本增强用户侧硬失败 0；2 次运行时 Skill、1 次结构契约降级。真实成图未执行，因此只放行提示词契约质量，不宣称成图质量。
- `packages/agent`、`packages/shared`、`packages/skills`、`agent-definitions` 公共热点已释放；不得开始新的兰琪共享注册改动，直至下一张串行任务正式建立。

## LQ-14 共享回归解锁（2026-08-21）

- 底层网关已修复共享 Agent smoke 的 FIP 专属 Skill 激活遗漏；FIP 与门店获客分别固定在各自产品上下文和 Agent，未改变兰琪运行路径。
- 当前主检出区已原样执行 `pnpm.cmd qa:regression`、`pnpm.cmd qa:full` 并全部 PASS；LQ-14 不再受共享 Agent 路由阻塞，可完成最终用户验收和状态归档。
- 本次共享修复没有调用付费媒体、没有重复兰琪三图任务，也没有修改兰琪数据库、文件或计费记录。
> **2026-09-12 追加（QA-20260912-013：兰琪登录「扫码成功却进不去」真缺陷已修并上生产）**：用户反馈「已扫码 但是需要邀请码 还是登入不了」。**现场取证（只读）**：生产日志 `10:04:44 POST /auth/wechat-bridge/complete` 说明那次扫码**授权已经成功**；库内该微信号 active memberships = 0；两张兰琪邀请码 `usedCount` 均为 0（从未核销）。**根因**：扫码链路的载荷只有 `productCode`、**没有 `inviteCode`**，`resolveWechatLogin()` 面对「新用户无授权」只会回 `needsTenant` 让前端弹回 `/login/lanqi` 补资料，而整页 `replace` 把老板刚填的邀请码丢掉了——于是「扫码成功了却还要邀请码」。**最小修复（纯前端）**：授权前把邀请码存进 `sessionStorage`，回跳带 `?invite=`，产品入口对 `?invite=` **自动核验一次**并直接进入门店资料表单；手机微信内 `/wechat-callback` 同口径。**先红后绿**：新断言打在修复前版本上命中数 0（修复后 4/3/1）；`product-login-entry-smoke` PASS（已挂 `qa:fast`）、web typecheck exit 0、`qa:fast` `EXIT=0`；**生产真实浏览器**打开 `/os-v2/login/lanqi?invite=<码>` 实测出现「邀请码已验证 / 门店名称* / 邀请码有效，请完成工作区资料。」。发布 id `20260912-lq25-invite-keep-test1` / `-prod1`，两侧 `DEPLOY_OK` + `VERIFY_OK`。已知边界：一个微信号已开通别的产品时仍按设计 403；换浏览器重新扫码会再走一次补资料但不再需要手填邀请码。详见 `docs/BUG_REGRESSIONS.md` **QA-20260912-013**。
> **2026-09-12 真人验收（老板本人，生产）**：用户在修复后按「带邀请码的兰琪入口链接」成功开通并进入工作台，明确回复「能进入，私域营销页正常可用」。后台实况佐证：新租户 `cmtxwo0ib057y1161bdr27l84`（名称 `lanqi meiye`，`createdAt 2026-09-12 12:49 +08`）、`Membership` 1 条（owner）、`TenantProductEntitlement productCode=lanqi status=active`、默认门店 1 个；兰琪邀请码 `la****p7` 由 `usedCount 0 → 1`（核销成功）。**由此 QA-20260912-013 的修复在生产由真人端到端验证通过，LQ-18「私域营销」板块也取得老板本人可用确认。** 待办：该新账号的 `User` 未绑定微信（`wechatOpenid` 为空），换设备/清缓存后需重走同一链接；如需「扫码直达」，可由 Codex 把老板扫码用的微信号绑为该租户 owner（一次性、可回滚，需用户确认）。
