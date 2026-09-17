# 当前部署状态

## 最新发布：20260917-vidrev-readable-ids-prod1（2026-09-17，仅生产）— 视频复盘报告改用短编号（修「输出乱码」）+ 平台那一步不再被整句话占位

### 一、用户现场（同一份视频号文件，第三次反馈）

1. 下午截图（`/agent/meiye__vidrev/chat`）：在「平台」那一步没点选项、直接把「复盘（附件：视频号动态数据明细.csv）」发出去，随后三次都回「视频复盘目前只支持抖音和视频号…」——**文件没问题，是平台槽位被整句话占位**。
2. 同一轮截图（文案智能体）：在「补充缺失的信息」状态下打「重新开始」被当成补充内容走重新生成；用户要求「做一个重新开始的功能，每个智能体都要有一个」。
3. 本轮最新截图：报告能出了，但正文里出现 `export/UzFfBgAAxNurJEJiPn_2k8zT4DCaZ0Sq…` 这种 60+ 字符串——「这次输出为啥会乱码呢」。

### 二、根因

1. **平台**：前端把用户这一轮的整句话直接存进 `answers.platform`，服务端再拿它去比对「只支持抖音/视频号」→ 误拒（同一份视频号文件反复被拒）。
2. **重新开始**：页面上原本没有可见入口（只有输入框口令 + 交付完成后的按钮）；且更早一轮的 web 修复**被并行发布覆盖**过（生产 `AgentChatPage.tsx` 里 `isRestartCommand` = 0；教训：验证要看 `index.html` 真正引用的 chunk，`dist/assets` 里堆的旧 chunk 会骗过 `grep -rl`）。
3. **乱码**：为「逐字可验」把视频号后台导出的**原始视频 ID** 放进了报告与提示词——那串 base64 式字符对用户就是乱码。

### 三、改动

1. `apps/api/src/services/video-review-engine.ts`：`computeVidrevMetrics` 一律用短编号 `v1…vN`；原始 ID 只存 `video.rawId`（payload `videos[].raw_id` 供追溯），**不进模型上下文、不进报告**；校验器加 ID 归一（短编号与原始 ID 都能通过 V3/V4，历史报告仍可验证）。
2. `apps/api/src/routes/marketplace.ts`：新增 `resolveVidrevPlatform()`——平台名先从「这句话」解析，解析不到再看数据表本身，只有明确点名小红书 / 快手 / B站 才 fail closed。
3. `apps/web/src/marketplace/chat-flows.ts` + `AgentChatPage.tsx`：新增 `normalizeVidrevPlatform()`；平台那一步认不出平台就**停在原地追问**（不推进、不扣分）；发送键旁常驻「↺ 重新开始」按钮（补充信息 / 待确认 / 已交付全状态可见，19 个货架 SKU 共用该页 ⇒ 每个智能体都有）。
4. **未动计费 / 定价 / 钱包 / 数据库**。

### 四、发布与验收

| 环境 | 发布 id | 结果 |
| --- | --- | --- |
| 生产 | `20260917-vidrev-readable-ids-prod1` | **`DEPLOY_OK`**、`health=200 (after 15s)`、`ready=200`、`No pending migrations` |

发布包 `release-20260917-vidrev-readable-ids-prod1.tar.gz`（**10,048,580 B**，sha256 `a7be49007291e083957c3ca6be2fbbc007e6aaae596f3427f1e94c8dee91811b`）。

- 生产 `verify-deploy.sh` **VERIFY_OK（0 FAIL）**；近 6 分钟 `journalctl -u baolu-os-v2 -p err` **No entries**。
- 生产产物直检：`node /tmp/prod-vidrev-parse-check.mjs` → `PROD_VIDREV_PARSE_PASS` + `PROD_VIDREV_LONG_ID_PASS`（`reportUsesShortIds:true`、`rawIdsKeptInPayload:true`、V3/V4 失败 0）。
- 线上实际加载的 chunk（`index-Be6NZsSZ.js` → `MarketplaceApp-CdswQ-69.js`）里「↺ 重新开始」与平台追问文案各命中 1 处 ⇒ 用户看到的页面确实带按钮。
- 本地真机真模型：20 条真实视频号数据 → 200、报告 0 处 `export/`、90 处 `v*`。

### 五、发布纪律（本轮新增）

**服务器 `/tmp/deploy-release.sh` 的 `marketplace-v3.json` canary 已被另一条线改成他们尚未上线的值（`265cd9bb…`＝直播话术上架）**，而生产现值仍是 `e4d3f747…`：照那份脚本发布会把线上计费 / 上架口径回退。处理方式：不改别人的脚本，另存一份 `/tmp/deploy-release-vidrev.sh`（只把 canary 替换成本次实际发货文件的哈希）跑本单；打包继续沿用「只叠加本次文件 + 其余回灌生产现网版」（本次回灌 23 个文件，排除 3 个他人新增文件）。

### 六、未做

- 没有用你的账号在生产上代跑真实复盘（会真扣积分、需要你本人登录）；50 条以上单次生成上限仍是已知 P2 限制（现在会明确提示按 7/14 天分批，不扣费）。
- 「重新开始」按钮与平台追问属于 web 改动：**已打开的旧标签页仍持有旧 JS，需要硬刷新（Ctrl+F5）**才会加载新页面。

## 最新发布：20260917-chat-restart-prod1（2026-09-17，测试实例 + 生产）— 修「对话页输入阶段找不到『重新开始』」：常驻按钮 + 整行口令 + 清附件

### 一、用户现场问题

用户 2026-09-17 13:4x 打开 `https://api.lcppch.top/os-v2/agent/ipzone__copy/chat` 发截图：「输入中没看到有重新开始按钮」（截图里只有「Enter 发送 · Shift+Enter 换行」和「下一步」）。

### 二、根因（功能本身早就写好，是发布把它回退了）

1. 线上产物实证：入口 `assets/index-BBXeP2wT.js` → `assets/MarketplaceApp-Buu7bSIf.js`，命中 `重新开始` / `再问一次`，但 `↺ 重新开始`、`清空这次填写的内容`、`好，重新开始` **全 0**；现网源码 `AgentChatPage.tsx` 里 `hasProgress` 出现 **0 次** —— 现网是「只有交付完成后那颗按钮」的旧版。
2. 功能（整行口令 + 输入阶段常驻按钮 + 重开清附件）确实已在 `main` 工作树里（QA-20260917-006），但 13:04 `20260917-copy-monthly-restore-prod1` 与 13:10 `20260917-vidrev-report-contract-prod1` 都按「只叠加本次文件、其余回灌生产现网版」打包，`AgentChatPage.tsx` 被判成非交付文件、沿用旧版 —— **回灌名单里包含了本次真正要交付的文件**（与 QA-20260917-007 同类，第二次）。

### 三、改动（纯前端，不碰后端 / 库 / 计费）

1. `apps/web/src/marketplace/AgentChatPage.tsx`：新增 `hasProgress`（`step>0 || answers 非空 || attachments 非空 || done || awaitingSupplement || confirmPending`）；输入段落常驻「↺ 重新开始」（在「下一步/确认需求」左侧，`busy` 时禁用）；整行「重新开始 / 重来 / 重新填…」判为会话命令；`resetConversationState()` 把**已上传附件**、填写内容、本机留存一起清。
2. `apps/web/src/marketplace/chat-flows.ts`：只多一个纯函数 `normalizeVidrevPlatform()`（视频复盘「平台」这步从自由输入 / 附件名归一成抖音 / 视频号，认不出就停在该步追问，不推进不扣分），是新版 `AgentChatPage` 的 import 依赖。
3. `apps/web/src/marketplace/chat-commands.ts`（`isRestartCommand`）生产上早已存在且与工作树一致，本次未改动。

### 四、发布与验收

| 环境 | 发布 id | 结果 |
| --- | --- | --- |
| 测试实例 | `20260917-chat-restart-test1` | 走标准 `deploy-release.sh`（`/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 · `/lanqi-test/`）→ **`DEPLOY_OK`**、`health=200`、`ready=200`；用户真机验收通过 |
| 生产 | `20260917-chat-restart-prod1` | 单模块叠加（只叠 `apps/web/dist` + 上面两个源文件）→ 线上入口 `index-Be6NZsSZ.js` → `MarketplaceApp-CdswQ-69.js` 命中 `↺ 重新开始`；`health=200` / `ready=200`、近 10 分钟 `journalctl -p err` 无条目 |

**生产发布方式（与整包发布的差别）**：stage 用全量源码构建，但把 `AdminConsolePage.tsx`、`RechargePage.tsx` 回灌生产现网版，`apps/api`、`packages`、`prisma` 一律不叠加、不执行迁移；因为 nginx 直接 alias `/opt/baolu-os-v2/apps/web/dist/`，**静态替换即生效、无需重启服务**（本次未重启）。

验收证据：

- 公网产物：`/os-v2/agent/ipzone__copy/chat`、`/os-v2/agents`、`/os-v2/agent/ipzone__copy`、`/lanqi-test/agent/ipzone__copy/chat` 全 **200**；生产 chunk 命中 `↺ 重新开始` / `清空这次填写的内容与已上传文件，从第一轮重新开始` / `好，重新开始`。
- 离线门禁：`pnpm.cmd marketplace:chat-restart-smoke` → `MARKETPLACE_CHAT_RESTART_PASS`（11 条口令 / 6 条非口令 / 重开清附件 / 先重置再走 vidrev 闸门）；`pnpm.cmd --filter @baolu/web typecheck` PASS。

### 五、回滚与未做

- 回滚：`/opt/baolu-backups/20260917-chat-restart-prod1-before-baolu-os-v2/`（`web-dist-before.tar.gz` + `AgentChatPage.tsx.before` + `chat-flows.ts.before`）、`/opt/baolu-backups/20260917-chat-restart-test1-before-baolu-os-v2-test/`；静态还原即可，不需要重启。
- **未发**（并行在途、未验收）：`apps/api/src/routes/{marketplace,admin,workbuddy-mcp,workbuddy-settings}.ts`、`apps/api/src/services/{billing-cost-model,video-review-engine,workbuddy-connections}.ts`、`apps/api/src/data/marketplace-v3.json`、`packages/skills/**`、`packages/db/prisma/schema.prisma` 与新迁移 `202609170002_workbuddy_marketplace_mode`。
- 台账：`docs/BUG_REGRESSIONS.md` **QA-20260917-008**。

## 补记：当天「文案包月」第二次消失与恢复（2026-09-17 13:0x，生产）

12:5x 用户再报 `/agent/ipzone__copy` 看不到包月。取证结论：**09:10 已上线的入口被 12:18–12:19 的 `20260917-admin-recharge-detail-prod2` 第二次叠加发布回退**（该发布包 08:59 打好，早于 09:17 的修复提交 `d86c08d`），12:46 的 vidrev 发布按「非交付文件取现网版本」回灌，继续沿用旧文件（现网 `AgentDetailPage.tsx = 49b32c3b…`）。锁定证据 = 两次发布的 `app-before.tar.gz` 里该文件哈希不同（plat48 之前是 `49b32c3b…`、prod2 之前是 `8a8253a4…`）。

处置：13:04 单文件叠加发布 `20260917-copy-monthly-restore-prod1`（`/tmp/release-20260917-restore-copy-monthly-detail.tar.gz`，sha256 `e202236819c8d84b65247544b1b6c794c42cf7df606b1f76b60e224371eadbf9`；包内 1592 文件，逐文件比对与现网只有 `AgentDetailPage.tsx` 一处不同）→ `DEPLOY_OK`；13:10 `20260917-vidrev-report-contract-prod1` 基于同一基线继续推进，最终现网 `AgentDetailPage.tsx = 100caa65…`（含包月块）、`chat-flows.ts = 1d1eff5b…`（6 槽访谈）。

现网验收：`DEPLOY_CHECK_WEB_URL=https://api.lcppch.top/os-v2 node scripts/deployed-marketplace-browser-check.mjs` → **PASS**；线上 chunk 命中 `按月订阅`×1 / `subscriptionCredits`×2 / `竞争格局`×1 / `角色适配`×1。台账 QA-20260917-007。

运维注意：本次发布后生产磁盘可用 **5.3G（81%）**，已贴近发布闸门（`MIN_FREE_GB=5`），下次发布前建议先跑 `scripts/ops/prune-server-backups.sh` 干跑。

## 最新发布：20260917-vidrev-report-contract-prod1（2026-09-17，仅生产）— 修「视频号导出上传了却出不了报告」第二层：报告契约

### 一、用户现场问题

用户 2026-09-17 第二次截图（同一份 `视频号动态数据明细.csv`）：文件已经能识别，但报告被判「未通过技能校验，本次不消耗积分」，点名 `V3 视频四象限`（`视频 1/2/…/8 被归入多个象限`、`四象限条数之和 13 ≠ 总条数 20`）与 `V4 单条深拆条数不足（需 6 条，实际 0 条）`。

### 二、根因（提示词与校验器互相矛盾 + 解析器只认短 ID）

1. 技能提示词要求第二章分层表列名是「象限 | **#** | 标题 | …」，模型照做填 **1./2. 序号**；校验器 `parseQuadrantTable` 却把第二列当 `video_id` 读 → 同一批序号在两个象限重复出现 → V3 报「被归入多个象限」「条数之和 ≠ 总条数」。
2. 视频号真实 `video_id` 形如 `export/UzFfBgAAxNSrKEFAVBDxk8zT4DCaRvcgHAJgfcU5mnWT4aWqDQ`（**含斜杠、60+ 字符**）：`parseQuadrantTable` 的 `^[\w-]+$` 与 `parseDeepDive` 的 24 字符上限把它直接过滤掉 → 四象限判空、深拆「实际 0 条」。

### 三、改动

1. `apps/api/src/services/video-review-engine.ts`：ID 片段判定放宽为「字母数字 + `_ - / .`、≤80 字符」（仍挡住中文说明与「v1 播放12万」这类解释）；深拆 ID 上限 24 → 80；新增 `vidrevQuadrantTable()` 产出**可原样照抄**的分层表（列名 `象限 | video_id | 标题 | 播放 | 咨询 | 完播`，空象限写「无」，分布逐条等于重算）。
2. `apps/api/src/routes/marketplace.ts`：提示词把第二列钉死为 `video_id` 并写明「禁止用序号代替」，写入「输出前自检」；运行时把照抄表随需求单下发（模型只复制、不造表）；`output_token_limit` 单独给可执行人话（大导出被截断时提示按 7/14 天分批）。
3. **未动计费 / 定价 / 钱包 / 数据库**；回滚 = 还原备份目录 + `systemctl restart`。

### 四、发布与验收

| 环境 | 发布 id | 结果 |
| --- | --- | --- |
| 生产 | `20260917-vidrev-report-contract-prod1` | **`DEPLOY_OK`**、`health=200 (after 69s)`、`ready=200`、`No pending migrations` |
| 测试实例 | 未发布（本轮只发生产，用户就在生产上复测） | — |

发布包 `release-20260917-vidrev-report-contract-prod1.tar.gz`（**10,043,658 B**，sha256 `1c6abd39d6e75fea33dcd0dfec8beefa8c0efd653f741e0ace49a8bcad2f26f2`，本地与服务器一致，1592 文件）。生产 `verify-deploy.sh` **VERIFY_OK（0 FAIL）**；近 6 分钟 `journalctl -u baolu-os-v2 -p err` **No entries**。

### 五、验收证据（真机真模型，先红后绿）

- 红灯（本地生产同路由 + 真实 DeepSeek + 真实 Postgres，20 条真实数据）：**422 `marketplace_output_invalid`（V3 + V4）**，报错文本与用户截图逐字一致。
- 绿灯（同一入口、同一份数据）：**200**，11 章齐全，`payload.videos=20`、四象限 `0/12/0/8`（合计 20）、深拆 6 条、健康度 0 🔴、消耗 70 积分一次。
- 50 条真实导出：模型输出触顶（`finishReason=length`）→ **502 且 0 扣费**，提示改为「本次要复盘的视频有 N 条，超过单次报告篇幅上限，请按近 7/14 天分批」。
- 生产产物直检：`node /tmp/prod-vidrev-parse-check.mjs`（跑在 `/opt/baolu-os-v2/apps/api/dist`）→ `PROD_VIDREV_PARSE_PASS`（跨行引号字段 3 行）+ `PROD_VIDREV_LONG_ID_PASS`（照抄表 id 不重不漏、长 ID 报告 V3/V4 = 0 失败）。
- 自动化：`marketplace:vidrev-contract-smoke`（新增长 ID 契约）、`vidrev:excel-upload-smoke`、`marketplace:vidrev-platform-scope-smoke`、`marketplace:chat-restart-smoke` 全 PASS。

### 六、发布纪律与未做

- **并行任务共用工作树**：本次按「只叠加本次 3 个文件 + 其余回灌生产现网版」打包（回灌 20 个文件，含 `marketplace-v3.json`（本地 `265cd9bb…` ≠ 生产 `e4d3f747…`，照本地发会被第 4 步 canary 拦下或回退线上计费口径）、`admin.ts`、`AdminConsolePage.tsx`、`billing-cost-model.ts`、`live_script_planner/*`），排除 2 个他人新增文件（含未验收的 Prisma 迁移，故 `No pending migrations`）。
- **未做**：没有用你的账号在生产上代跑一次真实复盘（会真扣 60–70 积分且需要你本人登录）；50 条以上的单次生成上限仍是已知限制（P2，需后续做成两段并发生成），当前口径是「不交付、不扣费、明确告诉你怎么分批」。
- 台账：`docs/BUG_REGRESSIONS.md` **QA-20260917-006**（含上一轮 `release-20260917-vidrev-file-recognize-prod1` 的文件识别 + 重新开始修复）。

## 运维改动：磁盘告警改为「可节流」（夜间静默 + 常规告警最短每 6 小时一条）（2026-09-17，生产常驻任务，非发布）

用户 2026-09-17 06:47 发来「思潼系统告警」群截图（05:00、06:00 两条同内容磁盘告警），先要求「夜间不用一小时一推送」，随后追加「同一告警重复抑制为每 4–6 小时一条」。根因是水位越线属**持续状态**，而告警脚本只会「越线就推」。改动只在一个文件 `scripts/ops/disk-alert.sh`：**夜间静默** `QUIET_HOURS`（默认 23:00–07:00，窗口内常规越线只写 journal）+ **重复抑制** `REPEAT_HOURS`（默认 **6** 小时，记录在 `/var/lib/baolu-disk-alert/last-warn-push`，只在真的发出去之后才记，恢复正常即清空）+ **紧急线** `CRIT_FREE_GB`（默认 5G＝发布脚本拒绝发布的同一条线，不受任何抑制，文案升级为「磁盘紧急告警」）。**检查频率仍是每小时**（`baolu-disk-alert.timer` 未改），`QUIET_HOURS=off REPEAT_HOURS=0` 或 `REPEAT_HOURS=4` 可回退/调整。

生产落地：`/opt/baolu-ops/disk-alert.sh`（旧版备份 `.bak-20260917-quiet` 与 `.bak-20260917-repeat`）+ `/etc/systemd/system/baolu-disk-alert.{service,timer}`（备份 `.bak-20260917-quiet`，service 新增 `Environment=TZ=Asia/Shanghai`）+ 状态目录 `/var/lib/baolu-disk-alert`（`750 root:root`），`daemon-reload` + `restart baolu-disk-alert.timer`（`enabled`，下一次 13:00）；仓库与服务器脚本 sha256 一致 `6cae01f6…`。本次同时把这两个 unit **首次纳入仓库** `scripts/ops/systemd/` 并由 `install-storage-retention.sh` 一并同步（幂等）。回归 `scripts/ops/disk-alert-smoke.sh` **103/103 PASS**（离线，假 df/假 curl，覆盖夜间/边界/紧急线/6 小时时间线/坏状态/写不进状态）；真机端到端：`NOW_HOUR=3` 起服务只有 QUIET、**零 HTTP 请求**；`NOW_HOUR=7` → `alert sent`；12:29:31 首推后 12:29:33、12:30:23 再跑均 `suppressed=1` 且**无推送**，`NOW_EPOCH=+7h --dry-run` 放行、`+3h` 仍抑制，dry-run 前后状态文件不变。完整证据见 `docs/BUG_REGRESSIONS.md` **QA-20260917-004**。

## 最新发布：20260917-plat48-copy-monthly-detail（2026-09-17，仅生产）— 修「`/agent/ipzone__copy` 上看不到文案包月」（P1 体验断链）

### 一、用户现场问题

用户直接打开 `https://api.lcppch.top/os-v2/agent/ipzone__copy`，页面上没有任何包月字样：「这个网址下并没有文案包月功能」。

### 二、根因（信息全在，只是入口在错的页面上）

`/agent/<sku>` 命中的是 **SKU 详情页** `MarketplaceAgentDetailPage`，带 `/chat` 才走对话页；PLAT-45 的包月入口当初只加在**对话页**的「请先确认需求」确认面板里，用户要先答完 4–5 轮提问才看得到。生产接口层当时已经是对的：`GET /os-v2/api/market/skus/ipzone__copy` → `subscriptionCredits:4000, subscriptionDailyQuota:5`。

### 三、改动

1. `apps/web/src/marketplace/AgentDetailPage.tsx`：价格卡内新增 `.pc-block.sub`（复用 `sitong-design.css` 既有样式）。仅当 `subscriptionCredits > 0` 渲染，**套餐价与每日条数全部读 SKU 字段**（以后别的智能体加 `sub` 配置会自动出现）；「📅 开通包月」按钮走与对话页**同一个** `POST /market/subscriptions`——未登录 → 跳登录；401/403 → 清会话 +「本次不消耗积分」；402 → 提示 + 带 `next` 回跳的充值链接；成功 → 区分 `alreadySubscribed`（不重复消耗积分）与首次开通，并在块内显示「本次不消耗积分」专用按钮。
2. 门禁：`scripts/marketplace-credits-only-contract-smoke.mjs` 新增 6 条详情页断言（先红 28/5 → 后绿 **33/0**）；`scripts/deployed-marketplace-browser-check.mjs` 新增线上断言——从 SKU 接口**现取** `subscriptionCredits`/`subscriptionDailyQuota` 再比对页面文本（不写死），且**反向断言**只按次售卖的 IP 定位详情页不得出现「按月订阅 / 开通包月」，同时断言块内不出现「积分/次」「≈ ¥」。
3. **未动任何计费 / 定价 / 钱包 / 数据库代码**，回滚 = 还原 `AgentDetailPage.tsx` 一个文件。

### 四、发布与验收

| 环境 | 发布 id | 结果 |
| --- | --- | --- |
| 生产 | `20260917-plat48-copy-monthly-detail-prod1` | **`DEPLOY_OK`**、`health=200 (after 15s)`、`ready=200`、`No pending migrations`、发布后磁盘 `/` **6.8G 可用（76%）** |
| 测试实例 | 未发布（本次只发生产；用户要看的就是生产页） | — |

发布包：`release-20260917-plat48-copy-monthly-detail.tar.gz`（**10,024,762 B**，sha256 `43a59529c6af5c000369b12f3d67ffbd74647a0b74f9059674f6cb4da69add6a`，本地与服务器一致）。发布日志 `/tmp/deploy-20260917-plat48-copy-monthly-detail-prod1-baolu-os-v2.log`。

**发布纪律（本次踩到的坑）**：发布期间另一条线（管理员充值明细）已先发过一版生产，其本地工作树与生产上正在跑的 `AdminConsolePage.tsx` 互不一致。为保证**不覆盖线上别人的修复**，打包时把**生产现网版** `AdminConsolePage.tsx`（sha256 `b0327e665d6e3ec2…`）回灌进 stage 再打 tar；包内核对：`AgentDetailPage.tsx` = `8a8253a4289d7344…`（本次版本）、`AdminConsolePage.tsx` = `b0327e665d6e3ec2…`（生产原样）。这印证了 QA-20260916-016 的纪律：**叠加发布不会退回旧文件，但也可能顺手覆盖别人的在途修复**。

### 五、验收证据（生产真机，红线 → 绿线）

- 自动化：`node scripts/marketplace-credits-only-contract-smoke.mjs` → **PASS (33 passed / 0 failed)**；`pnpm.cmd --filter @baolu/web typecheck` → PASS；`pnpm.cmd qa:fast` → **EXIT=0**。
- 生产真机（Chromium CDP，非本地）：`DEPLOY_CHECK_WEB_URL=https://api.lcppch.top/os-v2 node scripts/deployed-marketplace-browser-check.mjs` → **`PASS`**，逐项 `shelf=PASS credits_only=PASS no_yuan_conversion=PASS detail_monthly_package=PASS no_monthly_on_ppu_only_sku=PASS direct_test_entry=PASS console_clean=PASS`；截图 `01-shelf-agents.png`、`02-agent-ip-pos.png`、`02b-agent-copy-monthly.png`、`03-lanqi-dashboard.png`。
- 手机 390×844 生产探针：包月块可见，文案「📅 也可以按月订阅… / 4000 积分/月 / 每天 5 条 / 📅 开通包月：4000 积分/月」，按钮 318×43 可见，无横向溢出，console 0 error。
- 补跑 `verify-deploy.sh`（app `/opt/baolu-os-v2`、service `baolu-os-v2`、port 3002、base `/os-v2/`）：服务 / 运行时数据 / web 构建 / 货架契约全 **PASS**（含 `ipzone__copy_subscription = 4000 credits / 5 per day`、`ipzone__ip-pos_ppu = 400`）；**唯一 FAIL 是 `public_web expected=200 actual=302`**——裸 `https://api.lcppch.top/os-v2` 被 nginx 302 归一成 `/os-v2/`（带斜杠即 200，浏览器自动跟随），非本次引入、也非产品缺陷。
- 已知既有红（非本次引入，未处理）：`pnpm.cmd marketplace:copy-scan` 仍 FAIL，命中项改动前即存在（`AgentChatPage.tsx` 的「扣积分」措辞、`AgentDetailPage.tsx` 的「兰琪」真实客户名，`git show HEAD:` 可证）；该脚本未挂进 `qa:fast`。

### 六、未做 / 边界

- **真实开通一次包月没有代跑**：会真扣 4000 积分（资金动作）+ 需要用户本人微信登录，留给你点一次。未登录点击会跳登录页，这是设计行为（已实测）。
- 台账：`docs/BUG_REGRESSIONS.md` **QA-20260917-003**；任务卡 `docs/agents/platform-tasks.md` PLAT-45「用户现场二次反馈」。

## 最新发布：20260916-lq34-wallet（2026-09-17，生产 + 测试实例）— 兰琪通用钱包打通：7 个扣费点收口到「老板钱包」+ 历史额度一次性迁移

### 一、用户口径

「**兰琪的用户只在兰琪里充值；在兰琪充的积分，可以同时在思潼 AI 里用其他智能体**——钱包是通用的」；多人门店「**不管谁操作，都扣租户老板（owner）的钱包，流水里记『谁操作的、扣的是老板的钱』**」。迁移选 **Phase 2**（不做双轨过渡，只留一本账），不显示人民币，兰琪不新增第二个充值入口。

### 二、改动

1. **计费主体收口**：新增 `apps/api/src/services/lanqi-wallet.ts`（`precheckLanqiWallet` / `chargeLanqiWallet` / `refundLanqiWallet` / `readLanqiWalletBalance`）——按 `tenantId` 解析 owner，解析不到 **fail closed**（`lanqi_wallet_owner_missing`，不扣费也不放行）；幂等键 `lanqi:{tenantId}:{requestId}`；扣费走 `consumeWalletCredits`（paid→bonus、Serializable、同键幂等）；退款按**原扣费流水分桶退回原桶**；操作人写进流水 `source`（`lanqi:operator=<userId>`）。
2. **5 个扣费点切到 owner 钱包**：文案十件套（`88f6f82`）、图片 / 视频确认（`f1b8057`）、爆款复刻出片 + 出片许可预算（`16d4a17`）、视频执行 seedance（`d3bb128`）——③④⑤ 同属一套「预留 - 结算」模型，**必须一次切完**；页面余额同步改读 owner 钱包。
3. **迁移口径收窄（QA-20260916-011）**：初版按「全库 `CreditAccount.balance > 0`」取数会搬走 **199 个与兰琪无关的租户 / 2,001,159,975 积分**（思潼 AI `founder-ip,takeaway` 190 个 + 美业 4 个）；已改为「只迁持 `lanqi` 权益 / 有 `LanqiStoreProfile` 的租户」，并加离线口径回归（20 断言，进 `qa:regression`）。
4. **数据迁移**：`scripts/lanqi-wallet-migrate.ts`（默认 dry-run，`--apply --backup <dir>` 先出迁移前 CSV，`--revert <tenantId,...>` 反做）+ `apps/api/src/services/lanqi-wallet-migration.ts`（每租户一个事务、事务内二次校验是否兰琪租户、`WalletLedger(refRequestId=lanqi-migrate:<tenantId>)` 保证幂等、`CreditAccount.balance` 置 0 **不删行**）。

### 三、发布与验收

| 环境 | 发布 id | 结果 |
| --- | --- | --- |
| 测试 | `20260916-lq34-wallet-test1` | `DEPLOY_OK`、`verify-deploy.sh` **VERIFY_OK**、health/ready 200 |
| 生产 | `20260916-lq34-wallet-prod1` | **`DEPLOY_OK` + `VERIFY_OK`（0 FAIL）**、`No pending migrations`、重启后 err 日志 0 条、health/ready 200 |

发布包：`release-20260916-lq34-wallet.tar.gz`（**1,584 文件 / 9,978,440 B / sha256 `2d4fa183e2bb478576d4061180101f98e67b1004078455b5cc74484739b52ff1`**，本地与服务器一致；生产与测试实例用同一份）。回滚＝`/opt/baolu-backups/20260916-lq34-wallet-prod1-before-baolu-os-v2/`（198M）。

### 四、历史额度迁移（本轮的「改账」动作）

- **测试实例**（schema `lanqi_test`，2026-09-16 21:01）：**43 个账户 / 12,520 积分**，迁移后对账 43 行 / 12,520、非兰琪 26 个 / 7,800 未动、重复 apply 幂等。
- **生产**（schema `public`，2026-09-17 06:42）：**2 个账户 / 508 积分**（`300` + `208`）；迁移前 CSV + 全库 dump 已留证；迁移后 `WalletLedger` **2 行 / 508**、`CreditTransaction` `adjust` **2 行 / 508**、两条候选 `CreditAccount` 归 0 且行保留、owner 钱包 300 / 208、**非兰琪 199 个 / 2,001,159,975 一分未动**、`Wallet` 合计 25→**26 个**（paid 11,048→11,556）、再跑 dry-run 计划为空。
- 生产只读复核：两个兰琪门店 `lanqi` 权益 `active`、`creditAccount=0`、owner 钱包 300 / 208；owner 钱包流水仅两条迁移入账，无重复 `refRequestId`。

### 五、未做 / 边界

- **老板门店实跑一次低价生成未执行**：需真人微信扫码登录，Codex 不能代持（同 LQ-22 / LQ-28 / LQ-29 既有边界）。建议登录后跑一次「美业文案十件套」（40 积分/次）验证「充值 → 兰琪可用 → 思潼货架同样可用」。
- ⑥`credit-reservations.ts` + 经营问答、⑦ 美业单品预留 / 结算线**本轮不动**（被美业线复用，需单独立卡 + 跨产品回归）。
- 思潼 AI 侧保持「谁登录扣谁的钱包」现状；不显示人民币；兰琪不加第二个充值入口。

## 最新发布：20260916-plat67（2026-09-16，生产 + 测试实例）— 修「我的 - 历史交付物 - 下载 Word 下载不了」（P1）+ 视频复盘后台导出文件编码兜底

### 一、用户现场问题

1. 「**我的-产物里-点击下载 word 下载不了**」（现场，最高优先级）；
2. 「视频复盘智能体还是没跑通：给了视频数据文件但还是没有识别到视频记录，本次不消耗积分。请上传视频号/抖音后台导出的 CSV/Excel」——后台导出常是 **GBK/GB18030**，此前按 UTF-8 解出乱码 ⇒ 表头识别不到 ⇒ 报「至少包含 1 条视频数据」。

### 二、改动

1. **P1 根因（下载 Word）**：`MinePage.tsx` 的 `downloadDeliverable()` 写的是 `headers: { ...authHeaders(true), "content-type": "application/json" }`，而 `authHeaders(true)` 本身就带 `Content-Type`；浏览器按规范把同名头合并成 `application/json, application/json`，Fastify 直接 **415 Unsupported Media Type**，导出未生成、前端把英文原文弹给客户。修复＝只用 `authHeaders(true)`，并按对话页同一口径补齐 401/403（清会话 +「登录状态已失效，请重新登录后再下载；本次不消耗积分。」）、402（积分不足）、415（刷新重试、本次不消耗积分）与中文兜底。计费不变（导出 10 积分/次，同内容重下不扣）。
2. **导出取件加固**：`GET /exports/docx/:id` 统一 `Cache-Control: private, no-store`；`?t=` 令牌只解决「浏览器导航带不了 Authorization」，**只要带会话仍必须过会话 + 租户 + 归属校验**；并发取件用 `claimed` 占位 + `releaseClaim()`，只允许一次读到字节。跨租户 / 同租户同事 / 被停用成员一律取不到。
3. **视频复盘文件编码兜底**：`apps/api/src/routes/media.ts` 新增 `decodeTextBytes()`（UTF-8 失败 → **GB18030** 兜底），前端 `apps/web/src/marketplace/text-attachment.ts` 用同规则探测编码后再喂给视频复盘的 `analyze` 链路。JSON 仍是 JSON 专属解析，不误吃。
4. **既有红灯清理**：`video-review-engine.ts` 去掉误加的「观看量/观看次数」别名（小红书观看量不得当播放量）；`scripts/export-owner-isolation-smoke.ts`、`scripts/referral-self-service-smoke.ts` 契约更新（推荐活动现为**下架**状态，脚本改为先断言 fail-closed，再自建临时活动窗并在 `finally` 里**先还原开关再删数据**）。

### 三、发布与验收

| 环境 | 发布 id | 结果 |
| --- | --- | --- |
| 测试 | `20260916-plat67-mine-docx-download-test1` | `DEPLOY_OK`、health=200（24s）、ready=200、`verify-deploy.sh` **VERIFY_OK**（0 FAIL） |
| 生产 | `20260916-plat67-mine-docx-download-prod1` | 同一份归档，见下方「发布流水线」说明 |

发布包：`release-20260916-plat67-mine-docx-download.tar.gz`（**1576 文件 / 9,930,886 B**，sha256 `7778da84aefc6e9d78d07eaff8562b8683a2a2933bd7f8de0c3ed597d6e1040b`，本地与服务器一致）。发布脚本 `deploy-release.sh` 未 stale（与仓库 MD5 一致 `247df7a3…`），服务器 `/` 发布前 **8.3G 可用（71%）**，高于 5G 底线。

### 四、发布流水线（本轮的服务器侧串联）

测试实例发布完成、`VERIFY_OK` 之后，**由服务器侧串联脚本**继续发生产（`setsid nohup` 脱离 SSH 会话，见 QA-20260910-019：交互式会话中断曾导致发布假回滚）。串联脚本 `scripts/tmp/plat67-deploy-chain.sh` → 日志 `/tmp/deploy-chain-20260916-plat67-mine-docx-download.log`；它先等测试实例发布结束、检测到 `DEPLOY_OK` 后**跳过重复发布**，再依次「校验测试 → 发生产 → 校验生产」，最后把生产近 10 分钟 `journalctl -p err` 一并写进同一份日志。**开发机断电/关机不影响该流水线**。

### 五、回滚

- 备份 `/opt/baolu-backups/20260916-plat67-mine-docx-download-{prod1,test1}-before-baolu-os-v2{,-test}/`（app-before / db-before / env / 服务单元 / 发布前 dist 哈希），`deploy-release.sh` 失败即自动回滚；发布日志 `/tmp/deploy-20260916-plat67-*.log`。
- 回滚＝还原对应备份目录 + `systemctl restart baolu-os-v2(-test)`，或重放上一包（`plat66`）。

### 六、本轮验收证据（红线→绿线）

- **红灯（修复前，真实页面）**：点击「下载 Word」只有 `POST /exports/docx` **415**，弹窗 `Unsupported Media Type: application/json, application/json`，`downloadWillBegin` 一次都没有。
- **绿灯（修复后，真实页面）**：`POST 200` → 无头 `GET ?t=` **200**（`…wordprocessingml.document` + `content-disposition: attachment`）→ `Page.downloadWillBegin` 拿到 `历史交付物-IP定位智能体.docx`；无弹窗、`consoleErrors/logErrors` 为空。二次点击 `redownload:true / consumedCredits:0`、余额不再变。
- **自动化**：新增 `pnpm marketplace:mine-docx-download-smoke`（已挂 `qa:fast`，含「全仓禁止再写重复 content-type」守卫）；`pnpm qa:fast`、`pnpm qa:regression`、`pnpm qa:full` 全 **EXIT=0**。
- 台账：`docs/BUG_REGRESSIONS.md` **QA-20260916-010**。

## 最新发布：20260916-plat66（2026-09-16，生产 + 测试实例）— 常用智能体独立页 + 产物进「我的」/ 新用户注册送 100 积分 / 页脚 ICP / 付费到账推送企业微信 / 手机端报告排版

本条目合并两批改动（`plat65-my-agents` 的代码在 `plat66` 归档里一起上线，未单独发过版）。

### 一、用户口径（2026-09-16）

1. 「**常用智能体**要不要做成独立的智能体列表页」→ **要**；
2. 「把输出的**产物**也放到**我的**页面里，并给用户保存 7 天」；
3. 「**新用户注册即赠送 100 积分，后面新用户注册都给送**」；
4. 「思潼平台页脚补 **ICP 备案号**：辽ICP备2025069273号」；
5. 「用户付费了我咋样才能知道呢？也给我**推送到企业微信**吧（跟服务器空间不足预警推送一样）」+「后台应该有客户的积分充值和消耗情况才对」；
6. 「手机端 IP 定位输出格式不行」（手机端报告表格被挤成竖排单字）。

### 二、改动

1. **「常用智能体」独立页**：一级导航「常用智能体」→ `/my-agents`（新路由，懒加载）。数据来自新接口 **`GET /market/me/agents`**——按扣费账本 `ppu_consume` 按 SKU 聚合出「用过几次 / 累计多少积分 / 最近一次」，按最近使用倒序；每张卡有「继续使用」（直达该智能体对话）与「看详情」；空态给「去货架逛逛」；未登录显式 401 + 登录引导。聚合**按租户隔离**。
2. **产物进「我的」**：「我的」页的「历史交付物 · 保存 7 天，请及时下载」段落**始终渲染**（以前是「有产物才显示」，客户看不到功能存在），无产物时给空态说明；服务端 7 天留存与 `/market/me/deliverables` 不变。原「近期使用记录」列表移除，改为「常用智能体」入口（同一份数据不重复列）。
3. **新用户注册送 100 积分**：新增 env `NEW_USER_SIGNUP_CREDITS`（默认 **100**），`getInitialWorkspaceCredits()` 默认值由 0 改为它；进 **bonus 桶**（赠送积分，不可退），同一用户只发一次（`source="signup"` 幂等）。类型专属 `NEW_USER_*_TRIAL_CREDITS` 仍可覆盖。回归脚本 `marketplace:signup-welcome-wallet-smoke` 的期望值同步改为「env → 默认 100」，并已挂进 `qa:regression`；本地跑 **PASS**，测试实例实测：新建工作区 → `{"paidBalance":0,"bonusBalance":100,"balance":100}`。
4. **页脚 ICP**：`apps/web/index.html` 在 `#root` 之外加站点页脚（「思潼 AI 行业智能体平台」+ 备案号，链接到 beian.miit.gov.cn）——所有页面一次覆盖，不用逐页改组件。两环境线上 HTML 实测命中 `辽ICP备2025069273号`。
5. **付费到账推送企业微信**：新增 `apps/api/src/services/ops-alert.ts`，复用磁盘告警同一条通道 `SITONG_ALERT_WEBHOOK`（该变量已同步写进两环境 API env，原文件已备份）；`applyPaidOrder()` 在**事务提交后**判断「本单是否刚从 pending 变 paid」（支付回调重放不会重复推送），推送「客户 / 金额 / 到账积分（含多送）/ 该客户当前余额 / 支付方式 / 订单号」。原则：**通知绝不阻塞入账**——未配置或网络失败只写日志、返回 false，不抛异常。
6. **手机端报告排版**：报告类消息（IP 定位全案 / 视频复盘）加 `.report` 类 → 手机上气泡占满屏宽；报告里的表格（含此前**没有样式**的 markdown 表格）在窄屏改为横向滚动 + 单元格不逐字换行。**后台客户经营数据**（每个客户充值 / 消耗 / 剩余 + 常用智能体）在 `20260916-plat61/62` 已上线，位置见下。

### 三、发布与验收

| 环境 | 发布 id | 结果 |
| --- | --- | --- |
| 测试 | `20260916-plat66-signup-icp-notify-test1` | `DEPLOY_OK`、health=200 |
| 生产 | `20260916-plat66-signup-icp-notify-prod1` | `DEPLOY_OK`、health=200 |

- **测试实例真机验收（合成租户，跑完按 id 精确清理、残留 0）**：
  - `/my-agents`：标题「常用智能体」，2 张卡数据与账本一致——「文案智能体 · 用过 2 次 · 累计 76 积分 · 创始人IP专区 · 最近 2026/9/16」、「IP定位智能体 · 用过 1 次 · 累计 118 积分」，按钮「继续使用 / 看详情」；
  - `/mine`：标题「我的」、产物段标题命中、1 张产物卡、有「下载 Word」与「剩余 N 天」、有「常用智能体」入口、不再有「近期使用记录」；
  - 导航：`货架 / 常用智能体 / 积分充值 / 我的`；
  - 注册送分：新工作区钱包 `bonusBalance=100`。
- **手机端报告排版（390，计算样式实测）**：报告气泡 `max-width:100%`、实测宽 354px（占满可用宽）；**普通气泡仍是 74%**（未连累）；报告表格 `display:block` + `overflow-x:auto` + 可横向滚动。
- **通知通道自检**：两环境各用线上同一套 `notifyOps()` 发了一条**明确标注「自检/非真实充值」**的企业微信消息，返回 `sent:true`（老板侧应各收到一条，含真实充值到账的文案样例）。
- **ICP**：两环境线上 HTML 均命中 `辽ICP备2025069273号` 与 beian.miit.gov.cn 链接。
- 离线门禁：`pnpm qa:fast`（新增 `marketplace:my-agents-contract-smoke`、`ops:recharge-notice-smoke`）exit 0；`pnpm marketplace:signup-welcome-wallet-smoke` PASS。

### 四、后台在哪看「客户充值 / 消耗 / 剩余」

`/os-v2/agents/admin` → 左侧「**客户**」→ 表头「客户名称 / 类型 / 行业 / 城市 / **剩余积分 / 累计充值 / 累计消耗 / 常用智能体** / 成员数」。生产实测（2026-09-16）：汽配信息网 2000/2000/157、杨萋萋 530/1000/470、正源堂 6740/6000/260。截图证据：`.debug/admin-customers-prod-cn.png`。

### 五、回滚

- 备份 `/opt/baolu-backups/20260916-plat66-signup-icp-notify-{prod1,test1}-before-…/`（含 app / db / env / 服务单元快照），发布日志 `/tmp/deploy-20260916-plat66-*.log`；失败自动回滚。
- env 追加前的原件备份：`/etc/baolu-secrets/baolu-os-v2{,-test}.env.bak-before-webhook-*`。注册送分若要回退，把 `NEW_USER_SIGNUP_CREDITS` 设为 0 即可（只影响之后新注册）。

## 最新发布：20260916-plat64-nav-mine-b1（2026-09-16，生产 + 测试实例）— 「我的」进入一级导航（积分充值之后）+ 修美业详情页重复前缀（B1）+ 空专区白屏（B2）+ 兰琪大脑假样例按钮（B4）

### 一、用户口径（2026-09-16）

- 「**我的**应该做到一级导航栏，积分充值的后面，增加一栏」；
- （WorkBuddy 全链路检测报告 B1/B2/B4/B5 一并处理）

### 二、改动

1. **一级导航新增「我的」**（`apps/web/src/marketplace/shell.tsx`）：`货架 / 常用智能体 / 积分充值 / 我的`，位置就在积分充值之后；「我的」是个人中心的**正名入口**（余额 / 常用智能体 / 历史交付物 / 积分退回 / 邀请链接），高亮归它。
   同时把「常用智能体」指到同一页的使用记录锚点（`/mine#recent` + `id="recent"` + 数据到齐后主动滚动），两条入口不再含义不明。`MinePage` 页内标题由「常用智能体」改为「我的」。
2. **B1 美业专区重复前缀**（P0）：`marketplace-catalog.ts` 构种子时剥掉历史前缀「一次使用 = 」（默认值同步改口），`AgentDetailPage.tsx` 渲染前再兜一次；另做**数据清洗**把两环境 meiye 的专区覆盖对齐（见下）。根因与红/绿证见 `docs/BUG_REGRESSIONS.md` QA-20260916-007。
3. **B2 空专区白屏**：`HomePage.tsx` 按专区总量判断，0 个 SKU 的专区统一显示「即将上线 / 待上线」+「🚧 该专区正在上新，敬请期待。」（`行业专家专区` 原先是 ready 但 0 SKU，点进去一片空白）。
4. **B4 兰琪大脑假样例按钮**：无参考案例就不渲染「输出参考案例」；品牌工作台入口改为「🧭 这是品牌工作台入口…」+「进入品牌工作台」（跳 `/lanqi`）。
5. **B5 console 404**：复测**不成立**（见 QA-20260916-008 证据），无改动。
6. **门禁**：`marketplace:foundation-smoke` 新增「DB 覆盖位带旧前缀 → 种子文案必须干净」的断言，并挂进 `qa:fast`。

### 三、数据清洗（两环境，可回滚）

- `node /tmp/plat64-clean-meiye-ov.mjs --apply`（默认 dry-run）：生产与测试各改 **1 行 / 9 个字段**，把 `meiye` 的「一次使用 = 交付…」还原为「交付…」；执行前备份原值到 `/tmp/plat64-meiye-ov-backup-{prod,test}.json`，执行后复核 `leftoverLegacy: []`。

### 四、发布与验收

| 环境 | 发布 id | 结果 |
| --- | --- | --- |
| 测试 | `20260916-plat64-nav-mine-b1-test1` | `DEPLOY_OK`、health=200 |
| 生产 | `20260916-plat64-nav-mine-b1-prod1` | `DEPLOY_OK`、health=200 |

- 真实浏览器逐项实测（**两环境结果一致**）：
  - 导航 = `["货架","常用智能体","积分充值","我的"]`；
  - 专区分类 = `["全部 19","创始人IP 9","餐饮 待上线","美业 9","品牌工作台 1","宠物 待上线","行业专家 即将上线"]`，点「行业专家」出现「🚧 该专区正在上新，敬请期待。」而不是空白；
  - 美业文案智能体详情页 = 「🎯 一次使用 = 帮你完成：交付 1 条美业合规、可直发的文案…」，「一次使用」在卡片内**只出现 1 次**（修复前 2 次）；
  - 兰琪大脑详情页 = `hasSampleButton=false`、`hasWorkbench=true`；
  - `/mine` 顶部导航高亮落在「我的」，页内 `#recent` 锚点存在（未登录访客看到登录引导，属既有行为）。
  - 线上接口复核：`meiye__*` 九个 `useCase` 的「一次使用」命中数均为 **0**。
- 离线：`pnpm typecheck`、`pnpm qa:fast`（含新增门禁）exit 0；`marketplace:foundation-smoke` 先红（临时撤掉剥离调用 → FAIL，输出与线上症状逐字一致）后绿。

### 五、回滚

- 备份：`/opt/baolu-backups/20260916-plat64-nav-mine-b1-{prod1,test1}-before-baolu-os-v2{,-test}/`（含 `app-before.tar.gz`、`db-before.sql.gz`、env 与服务单元快照），发布日志 `/tmp/deploy-20260916-plat64-nav-mine-b1-*.log`；失败自动回滚。
- 数据清洗回滚：`/tmp/plat64-meiye-ov-backup-{prod,test}.json` 是执行前的 `MarketplaceIndustryProfile` 原值，需要时按 `zoneKey` 原样写回。

## 最新发布：20260963b-draft-fp（2026-09-16，生产 + 测试实例）— 修「充值往返丢草稿」真因（草稿指纹 != token）+ 余额不足给「去充值 / 返回继续生成」闭环；并答复 WorkBuddy 验收报告的三条疑问

### 一、来源：WorkBuddy《思潼AI 本轮修复验收报告 20260916》

报告 10 项里 5 项通过、2 项部分验证、3 项「需真机/付费验证」，另列 3 条「需 Codex 关注/修复」。逐条复核结论：

| 报告条目 | 复核结论 | 证据 |
| --- | --- | --- |
| **P1 历史交付 API 全部 404** | **误判：探错了路径**（实现一直在） | 真实端点是 `GET /market/me/deliverables`（可选 `?skuCode=`），带会话实测 **200**：`{"retentionDays":7,"deliverables":[{…,"credits":117,"expiresAt":"2026-09-23T05:11:19Z"}]}`；报告探的 `/market/history`、`/market/deliveries`、`/market/orders`、`/market/skus/:code/history` 四个都不存在。对话页在「本机无草稿」时正是靠这个端点找回 7 天内交付物 |
| **P2 退款端点 404** | **误判：退款不是独立端点** | 退款随 `GET /market/me` 的 `recentRefunds[]` 返回，带会话实测 200 且含退款行；「我的」页渲染出「↩️ 积分退回 · +40 积分」（截图 `.debug/mine-refund-visible.png`）。报告探的 `/billing/refund` 不存在 |
| **P2 充值往返状态恢复未验证** | **确认是真问题，已修** | 真机验证发现草稿在刷新后**仍然丢**：根因是草稿指纹取的是 token 末 8 位，而 token 会被重新签发（重新登录 / 内测免登录门卫重建会话）→ 同一个人被判成「换了人」。详见 `docs/BUG_REGRESSIONS.md` QA-20260916-006 |

### 二、改动

1. **草稿指纹换成稳定身份**：`apps/web/src/lib/session.ts` 新增 `readSessionIdentity()`（会话 JWT 的 `tenantId:userId`，解不开时退回 token 尾巴兜底），`AgentChatPage` 的写入与恢复都改用它。
2. **余额不足给闭环**：402 时气泡里给出「**去充值（回来不用重填）**」，链接为 `/recharge?from=agent&skill=<sku>&next=<站内路由>`；充值页据此渲染「**返回继续生成**」，登录前后都在。
3. **开放跳转防护**：新增 `apps/web/src/lib/app-route.ts#toSafeAppRoute()`，`next` 只放行站内绝对路径（拒绝 `//host`、`http:`、`javascript:`、反斜杠、空白），再由 `getAppPath()` 补回 `/os-v2/`、`/lanqi-test/` 前缀——避免子路径部署下跳到站外或前缀拼两遍。
4. **回归门禁**：新增 `pnpm marketplace:recharge-roundtrip-contract-smoke`（白名单放行/拒绝用例 + 两页接线与文案断言），已挂进 `qa:fast`。

### 三、发布与验收

| 环境 | 发布 id | 结果 |
| --- | --- | --- |
| 测试 | `20260916-plat63b-draft-fp-test1` | `DEPLOY_OK`、health=200 |
| 生产 | `20260916-plat63b-draft-fp-prod1` | `DEPLOY_OK`、health=200；产物核对：`MarketplaceApp-DxoLedM-.js` 命中「去充值（回来不用重填）」，`RechargePage-a436WArV.js` 命中「返回继续生成」 |

- 真实浏览器端到端（测试实例，合成租户已按 id 精确清理、残留 0）：填 5 项 → 确认卡「预计消耗约 40 积分」→ 402 →「去充值」→ 充值页 URL `…/lanqi-test/recharge?from=agent&skill=ipzone__copy&next=%2Fagent%2Fipzone__copy%2Fchat` →「返回继续生成」→ 回到对话页，**5 个答案原样保留、进度条 5 步全 ✓**。
- 退化项对照（修复前 plat62 产物，同机同脚本）：填 2 格 → 刷新 → 草稿被清空、进度回第 1 步（红）。
- 离线：`pnpm typecheck` 通过；`pnpm marketplace:recharge-roundtrip-contract-smoke` PASS；`pnpm marketplace:chat-slot-numbering-contract-smoke` PASS。

### 四、给 WorkBuddy 的复测口径（可直接照用）

1. 历史交付：`GET {base}/api/market/me/deliverables`（可选 `?skuCode=ipzone__copy`）——未登录 401、有会话 200，`retentionDays=7`。
2. 退款可见：`GET {base}/api/market/me` → 读 `recentRefunds[]`；页面在「我的」页「积分退回」区块。
3. 充值往返：0 余额账号走完 5 步 → 确认 → 出现「去充值（回来不用重填）」→ 点它到充值页 → 点「返回继续生成」→ 断言 5 项仍在（**不要用 dev-login 顶掉会话**：测试实例的免登录门卫在会话不满足产品授权时会重建会话，验收租户需带 `lanqi` 产品授权，否则会把草稿按「换人」丢弃，属测试环境干扰）。

### 五、回滚

备份 `/opt/baolu-backups/20260916-plat63b-draft-fp-prod1-before-baolu-os-v2{,-test}/`（含 `app-before.tar.gz`、`db-before.sql.gz`、env 与服务单元快照），发布日志 `/tmp/deploy-20260916-plat63b-draft-fp-*.log`；失败自动回滚。

## 最新发布：20260916-plat61 + plat62（2026-09-16，生产 + 测试实例）— 后台客户经营数据 / 我的页历史交付物 / 文案步骤序号去重 / 后台中文列名；并**关闭误开的生产推荐有礼**

本条目补齐 `plat49`–`plat62` 的落地记录（此前文档只写到 `plat47/48`）。所有批次均为「先测试实例、后生产」的同一份归档，发布脚本 `deploy-release.sh` 失败即自动回滚，各环境保留最近 8 份备份。

### 一、用户口径（2026-09-16）

- 「管理员后台看不到每个客户的充值消耗剩余积分、经常使用哪些智能体的统计吗，做出来」；
- 「我建议把我的单独做一页，用户历史产物在我的下载（告知用户保存 7 天请及时下载）」；
- 「文案智能体有序号重复，同步检查其他智能体是否存在同样的情况」；
- 「邀请链接暂时不开放，等我通知，预计 10.1–10.7 搞活动再开放，先下架」；
- 视觉 `¥0.5/次`（= 25 倍成本口径）；计费一律「按实际成本 × 对应倍数、不加封顶」。

### 二、本批发布清单（同一工作树，逐版递增）

| 发布 id | 内容 | 生产 | 测试 |
| --- | --- | --- | --- |
| `20260916-plat49-copy-platforms` | 文案智能体平台选项：增「快手」、去「朋友圈」 | ✅ | ✅ |
| `20260916-plat50-ippos-gate` | IP 定位门槛对齐成本口径（参考价 200→130、视频复盘 60→70） | ✅ | ✅ |
| `20260916-plat51-graceful` | 优雅关闭：SIGTERM 不再打断在途生成 + `TimeoutStopSec=180`（**根治发布重启造成的 502**） | ✅ | ✅ |
| `20260916-plat52/53-ipretry` | IP 定位输出校验失败在**同一请求内自动重试一次**，且重试只按首次用量计费 | ✅ | ✅ |
| `20260916-plat54/55-docx` | Word 下载改一次性直链 `?t=` 令牌（手机/微信可直接交给 WPS）+ 同一份报告只扣一次 | ✅ | ✅ |
| `20260916-plat56-cache-refund` | 对话与交付物本机留存（退出/去充值回来不丢）+「我的」页积分退回可见 | ✅ | ✅ |
| `20260916-plat57-copy-buttons` | 一问一答两侧都能一键复制 | ✅ | ✅ |
| `20260916-plat58-refund-view` | 退款列表覆盖所有客户可见退款 | ✅ | ✅ |
| `20260916-plat59-retain7d` | 已付费交付物**服务端留存 7 天**（迁移 `202609160001_marketplace_deliverable_7d`，51 迁移 / 103 模型）+ `/market/me/deliverables` | ✅ | ✅ |
| `20260916-plat60-recover` | 本机无留存时自动从服务端找回 7 天内交付物 | ✅ | ✅ |
| `20260916-plat61-admin-mine` | 后台客户表补**真实充值/消耗/剩余 + 常用智能体**；「我的」页加历史交付物（7 天提示）；邀请链接按活动开关下架；文案序号去重 | ✅ | ✅（`-test1b`） |
| `20260916-plat62-admin-cn-columns` | 后台表格列名中文化（`walletBalance` → 剩余积分 等），未知字段保留原名并挂 `title`；新增步骤序号契约回归 | ✅ | ✅ |

### 三、验收证据（真实数据 / 真实页面）

1. **后台客户表（生产真实浏览器，admin 令牌 + 客户分区）**：表头为「剩余积分 / 累计充值 / 累计消耗 / 常用智能体」，逐客户数值与接口一致，例如
   - 汽配信息网：剩余 2000 / 累计充值 2000 / 累计消耗 157 / 常用智能体「IP定位智能体 ×1 117 积分」（= 已按服务问题全额退 157，余额回到充值全额）；
   - 杨萋萋：530 / 1000 / 470（IP定位 ×2 400 积分 + 文案 ×1 40 积分）；正源堂健康管理：6740 / 6000 / 260。
   - 修复前这些字段读的是报废字段、**恒为 0**；现在接口 `GET /admin/customers` 返回真实值，页面渲染一致（截图 `.debug/admin-customers-prod-cn.png`、`.debug/admin-customers-test.png`）。
2. **「我的」页（测试实例，合成租户 + 1 条 7 天交付物，跑完按 id 精确清理、残留 0）**：`历史交付物 · 保存 7 天，请及时下载` 与「剩余 7 天 / 下载 Word」正常渲染；`campaignActive=false` 时**邀请链接整张卡片不渲染**（修复前该卡片仍露出，见 QA-20260916-005）。
3. **步骤序号（契约 + 产物双向核）**：新增 `scripts/marketplace-chat-slot-numbering-contract-smoke.ts` 覆盖 **9 个智能体 / 31 个步骤**；对修复前版本跑 → FAIL 5 项（正是文案那 5 个 label），对当前版本跑 → PASS。生产/测试 bundle 均为 `label:"行业 / 产品卖点",q:"① 你的…"`。

### 四、事故与按用户口径的配置修正

- **推荐有礼误开（P0/P1，已关闭）**：生产与测试的 `PlatformSetting` 覆盖位里 `REFERRAL_REWARD_ENABLED=true`（2026-09-13 写入，活动窗 09-13→10-01），而两环境 env 文件里**没有**任何 `REFERRAL_*` 键——此前只核对了 env 就判定「未启用」，实际生产已跑了 2 天并发出 **1 笔 100 积分**（`referral_reward:new_user`，落在老板自用测试租户「保禄测试」；推荐人「首次使用 +100」未触发）。按用户明示「先下架」在两环境执行 `node scripts/enable-referral-campaign.mjs --apply --disable`（只写配置位，自检 8/8 一致），复核 `REFERRAL_REWARD_ENABLED=false`、页面邀请卡片消失。**用户 2026-09-16 答复：这 100 积分「可以保留」，不回收**（当日再次只读复核，两环境生效值仍为 `false`）。
- **服务器 `/tmp/deploy-release.sh` 陈旧**导致 `plat61-test1` 在第 4 步 canary 失败（改动前退出，服务未动、无需回滚）；同步仓库脚本后以 `-test1b` 重跑即 `DEPLOY_OK`。
- **磁盘清理**（用户已同意）：`bash scripts/ops/prune-server-backups.sh` dry-run → `KEEP=8 --apply`，删除 21 个历史备份目录，**5.9G → 9.6G 可用（80% → 66%）**；两环境各保留最近 8 份回滚点（共 16 份 / 3.1G）。

### 五、回滚

- 各环境备份目录：`/opt/baolu-backups/<release-id>-before-baolu-os-v2{,-test}/`（含 `app-before.tar.gz`、`db-before.sql.gz`、`dist-hashes-before.txt`、env 与服务单元快照），发布日志 `/tmp/deploy-<release-id>-<app>.log`；失败自动回滚。
- 推荐有礼若要立即回到「已开启」：`node scripts/enable-referral-campaign.mjs --apply --start 2026-10-01T00:00:00+08:00 --end 2026-10-08T00:00:00+08:00`（左闭右开，含 10-07 全天）。

## 最新发布：20260916-plat48-estimate（2026-09-16，生产 + 测试实例）— 使用前给预估积分、使用后给实际积分 + 对外统一链接改为货架首页

### 一、用户口径（2026-09-16）

- 「使用前给客户预估消耗的积分，使用之后给客户实际消耗的积分就可以了」；
- 「你给的链接应该是货架首页才对，不应该是积分页，重新给链接。用户第一眼打开就是积分充值，感受不好」；
- 「同时生成二维码版本」。

### 二、改动

1. **确认气泡加预估**（`apps/web/src/marketplace/AgentChatPage.tsx`）：点「确认需求」后的确认卡里新增一行
   「**预计消耗约 N 积分（按本次实际用量结算，可能略有出入；生成完成后会告诉你实际扣了多少）**」，
   N 用该 SKU 的参考价（`ppu`，即原固定价，现在只作参考值）。
2. **结果区改口径**：生成完成后顶部状态从「本次消耗 N 积分」改为「**本次实际消耗 N 积分**」（N = 本次真实扣费 `consumedCredits`）。
3. 同步两条被改动作废的契约/验收断言（`marketplace-credits-only-contract-smoke`、`vidrev-excel-upload-browser-e2e`）。
4. **对外统一链接改为货架首页**（原来是充值页）：

```text
https://api.lcppch.top/os-v2/agents
```

- 生产真实浏览器实测（匿名）：第一屏就是**货架**（顶部「货架 / 常用智能体 / 积分充值」+「🔒 未登录 · 点击登录」+ 各专区智能体），不再是充值页；没有推荐码、没有邀请码要求。
- 路径：点链接 → 先看货架 → 想用时点「未登录 · 点击登录」→ 微信一键登录（自动注册 + 开通工作区）→ **回到货架**开始用；要用时去充值页充值。
- 二维码（无推荐码、长期复用）：`scripts` 同源依赖生成，产物保存在 `.debug/sitong-ai-link-qr.png`（1024px）与 `.debug/sitong-ai-link-qr.svg`。

### 三、发布与验收

| 环境 | 发布 id | 结果 |
| --- | --- | --- |
| 测试 | `20260916-plat48-estimate-test1` | `DEPLOY_OK` + `VERIFY_OK` |
| 生产 | `20260916-plat48-estimate-prod1` | `DEPLOY_OK` + `VERIFY_OK`；产物核对：`预计消耗约` 命中当前 bundle `MarketplaceApp-ColHrhr-.js` |

- 发布包 `release-20260916-plat48-estimate.tar.gz`（sha256 `87dd43adfe8f0a25c1c514fd48b320b676532d8a4dac903e1c4d94f336459844`，1565 文件）。
- 本地真实浏览器验收（只走到确认气泡、不生成不扣费）：确认卡显示「预计消耗约 **40** 积分（按本次实际用量结算，可能略有出入；生成完成后会告诉你实际扣了多少）。」；门禁 `qa:fast` + `marketplace:credits-only-contract-smoke`(26/0) + `marketplace:copy-scan` 全绿。

## 最新发布：20260916-plat47-costall-t2v（2026-09-16，生产 + 测试实例）— 全部智能体按成本计费 + 文生视频接通百炼 t2v

### 一、用户口径（2026-09-16）

- 「不加封顶——按我们要的利润，该是多少就多少」；
- 「每个新增的智能体都可能涉及文字/图片/语音/视频/视觉，产生多少成本就按对应成本的倍数收费就可以了」；
- 「那 5 类无样本 SKU 上架之后测试，涉及哪些费用按对应倍数计算就可以了」（**不做上架前取样**）；
- 「选 A：用百炼现成的 t2v」。

### 二、改动

1. **成本计费白名单支持通配 `*`**：`BILLING_COST_BASED_SKUS=*` = **所有货架 SKU（含以后新增的）**一律按「本次真实用量算出的成本 × 对应倍数」扣费，不再需要每上一个智能体改一次配置。
2. **文生视频接通百炼 t2v**：`LANQI_MEDIA_TEXT_TO_VIDEO_MODEL=wan2.6-t2v`；计价与图生视频统一为**按秒 ×2 成本 = 12 积分/秒**（5 秒 = 60 积分；旧的 990/1690/1490/2690 固定包价作废）。成本常量暂用同门实测值 ¥0.30/秒，**百炼首张真实账单回来后校准**。
3. 视觉已按 2026-09-16 口径改完（¥0.5/次 = 10 积分；无真实视觉消耗不收费）——见上一轮 `20260916-plat46-vision05`。

### 三、发布与验收

| 环境 | 发布 id | 结果 |
| --- | --- | --- |
| 测试 | `20260916-plat47-costall-t2v-test1` | `DEPLOY_OK` + `VERIFY_OK`；进程内实查：`t2v_model=wan2.6-t2v`、`t2v_5s=60`、`t2v_10s=120`、`i2v_3s=36`、`image=20`、`usesCostBasedPricing(未来新增SKU)=true` |
| 生产 | `20260916-plat47-costall-t2v-prod1` | `DEPLOY_OK` + `VERIFY_OK`；进程内实查：`t2v_model=wan2.6-t2v`、`t2v_5s=60`、`i2v_3s=36`、`usesCostBasedPricing(未来新增SKU)=true`、`vision=25`；`journalctl -p err` 无条目 |

- 发布包 `release-20260916-plat47-costall-t2v.tar.gz`（sha256 `12f6d0735dae8dbb35644817af8d2a536cfc5a00630a8b92425b96773ebf8b21`，1565 文件）；env 备份 `env-{prod,test}-before-plat47-*.env`。
- 回滚：还原备份目录 + 把 `BILLING_COST_BASED_SKUS` 改回 6 个 SKU（或删空）+ `systemctl restart`。

### 四、对外统一客户链接（用户 2026-09-16：给所有客户同一条）

```text
https://api.lcppch.top/os-v2/login?next=/recharge
```

- **不带 `ref`** → 不计推荐、不产生任何归因；**新用户不赠送任何积分**（2026-09-10 产品口径：默认 0，需自己充值）；**不需要邀请码**。
- 生产真实浏览器实测（2026-09-16）：打开即渲染「微信一键登录 / 注册」，页面明写「首次使用微信登录，会自动为你注册账号并开通工作区，不需要邀请码」，`post_login_redirect=/os-v2/recharge`，页面无「已识别推荐码」。
- 路径：点链接 → 微信登录（首次自动注册 + 开通工作区，填企业/门店名）→ 落到充值页 → 自己充值 → 去货架用智能体（按成本 × 倍数扣分）。

## 最新发布：20260916-plat45-costbased（2026-09-16，生产 + 测试实例）— 货架按成本计费接线（先切 3 个有实测成本的 SKU）

### 一、用户口径（2026-09-16）

- 「我们都是几倍收费」——文字 100× / 图片 5× / 视频 2× / 语音 10× / 视觉 100×（2026-09-15 已拍板）；
- 货架按次价切成本口径：**只切有真实成本样本的三个**，其余等有数据再逐个定（用户原话「同意这个」）；
- 同日已执行：兰琪图生视频 **30 → 12 积分/秒**（成本 ×2，测试+生产已生效）。

### 二、改动（4 个文件）

- 新增 env **`BILLING_COST_BASED_SKUS`**（逗号分隔白名单）：列进去的 SKU 按「**实际 token 成本 × 100 倍**」扣费，没列进去的继续扣固定 `ppu`。空 = 全部维持固定价（默认）。
- `apps/api/src/routes/marketplace.ts` 的 run 扣费改为 `charge = costBased ? dynamicCredits : price`；账本与响应同步（新增 `pricingMode` / `listPpu` 便于对账，仍不含任何成本字段）。
- 为什么按 SKU 白名单而不是一个全局开关：没有真实成本样本的 SKU 贸然切价会把价格定偏——估低了贴近甚至低于成本、估高了客户不买。
- 契约：`pnpm.cmd billing:cost-model-smoke` 增加白名单解析 / 默认空 / 接线断言（`charge = costBased ? dynamicCredits : price`、账本 `pricingMode`）。

本轮切这三个（六个 SKU 码）：`ipzone__copy` / `meiye__copy`、`ipzone__ip-pos` / `meiye__ip-pos`、`ipzone__vidrev` / `meiye__vidrev`。

### 三、发布与验收

| 环境 | 发布 id | 结果 |
| --- | --- | --- |
| 测试 | `20260916-plat45-costbased-test1` | `DEPLOY_OK` + `VERIFY_OK`；真机跑文案 → `consumedCredits=35`、`pricingMode=cost_based`、账本 `amount=35 / mode=cost_based / listPpu=40` |
| 生产 | `20260916-plat45-costbased-prod1` | `DEPLOY_OK` + `VERIFY_OK`；真机跑文案 → `consumedCredits=38`、`pricingMode=cost_based`、账本 `amount=38 / mode=cost_based / listPpu=40`，钱包 400 → 362，合成数据残留 **0** |

- 发布包 `release-20260916-plat45-costbased.tar.gz`（sha256 `29cfd14d5693c065cda62fd3b4f6a57bc10bb466d7aa6d8534d7c0775fbc9ea1`，1564 文件）；env 备份 `env-{prod,test}-before-plat45-*.env`。
- 生产禁用 `dev-login`，因此生产真机验证用「合成租户 + 服务端签会话」（`createTenantWorkspace` + `createSessionToken`）跑一次真实生成，跑完按 id 精确删除并核对 `residue {users:0, tenants:0}`。
- 顺带取到的正向证据：当天测试实例上两次生成被**质量门禁 422 拦下**（文案区含绝对化用语），**两次都没有扣费**（0 条账本）——失败不收费是对的。
- 本地先验证一轮：白名单开启后同一次文案扣 **34 积分 / cost_based**（预期值用账本 usage 复算一致），不是固定 40。
- 回滚：`/opt/baolu-backups/20260916-plat45-costbased-{prod1,test1}-before-…` + 还原 env（删掉 `BILLING_COST_BASED_SKUS` 行即回到固定价）+ `systemctl restart`。

### 四、注意与后续

- **同一个 SKU 每次扣分不再固定**：文案实测 34 / 35 / 38 积分（固定价是 40），随真实 token 用量浮动；极端长输出理论上更高（受 8192 maxTokens 约束，上界约 146 积分）。若希望「永不超过现价」，可加一行封顶 `min(成本口径, ppu)`——需要用户点头。
- 其余 5 类（选题 / 销售话术 / 直播话术 / 直播复盘 / 朋友圈）**仍是固定价**，等有真实成交样本再逐个加进白名单。
- 服务器磁盘 `/` 剩 **6.2G**（78%），接近发布脚本 5G 底线，下轮发布前建议先跑 `scripts/ops/prune-server-backups.sh`。

## 最新发布：20260916-lq33-copy-kit（2026-09-16，测试实例 + 生产）— 兰琪公域获客新增「美业文案十件套」卡（独立计费）

### 一、用户口径与交付

- 用户口径（2026-09-15）：「**新增一张卡**（清晰、独立计费）」，内容是与货架「文案智能体」同一份「内容十件套 V5」（选题策划 / 口播逐字稿 / 访谈话术 / 拍摄脚本 / 拍摄注意事项 / 剪辑 EDL / 发布标题与话题 / 最佳发布时间 / 评论区引导 / 投流建议）。
- 门店结果：公域获客枢纽页第 1 张卡「美业文案十件套」→ 说清「主推什么项目 / 想让谁看到 / 顾客最怕什么」→ 一次拿到整套可直接复制 / 可导出 Markdown 的内容；缺关键信息时平台先反问，不编造门店事实。
- 计费：**独立口径，默认 40 积分 / 次**（与货架「文案智能体」同合同同档价），env `LANQI_COPY_KIT_CREDITS` 可覆盖，调价不必发版；`LANQI_COPY_KIT_MAX_TOKENS` 可调输出额度（默认 16384）。**没生成出来不扣积分；同一句话重复点不重复扣**（同 `requestKey` + 同输入复用结果，同键换输入返回 409）。

### 二、实现要点

- 合同唯一出处：新增 `apps/api/src/products/beauty-industry/copy-ten-contract.ts`（十节常量 + 提示词 + 结构校验），货架 `apps/api/src/routes/marketplace.ts` 改为引用它并删除本地副本——**没有第二份提示词**，两边不会漂移。
- 兰琪侧：新增 `apps/api/src/products/lanqi/copy-kit-service.ts`（只加「怎么问、缺信息怎么办」的提问壳）与 `POST /lanqi/acquire/copy-kit`（每次请求重算 Membership + `assertStoreVisible`、余额不足先 402 不调模型、模型失败 / 信息不足 / 结构不合格一律不扣积分、扣分用 `balance >= price` 条件更新并写 `creditTransaction` 流水、结果按租户哈希目录隔离）。
- 页面：新增 `apps/web/src/pages/LanqiAcquireCopyKitPage.tsx` + 路由 `/lanqi/acquire/copy-kit`；枢纽页 `LanqiAcquireHomePage.tsx` 增第 6 张卡。页面不出现供应商 / 模型名，也不暴露内部合同版本号。

### 三、验证证据

| 项 | 结果 |
|---|---|
| 离线回归 | `pnpm.cmd lanqi:copy-kit-smoke` **28 passed / 0 failed**（正常路径、信息不足不调模型、模型回【需补充信息】、结构不合格、违禁词、计费默认 40 与 env 覆盖、输入指纹、同键幂等、跨租户读不到、非法键写入拒绝） |
| 页面契约 | `pnpm.cmd lanqi:acquire-ui-contract-smoke` **131 passed / 0 failed**（新增 30 条：枢纽卡 / 独立路由 / 真实接口 / 复制导出 / 扣费与流水 / 409 冲突 / 合同唯一出处 / 不暴露模型名与合同版本） |
| **真实模型 Eval** | `pnpm.cmd lanqi:copy-kit-live-eval`（真实 `deepseek-v4-pro`，同一高风险样例 **3 次**）**15 passed / 0 failed**：三次 `finishReason=stop`，正文 3.1k–3.3k 字，十节齐全、与共享合同校验逐条一致、无样板门店 / 他人信息泄漏 |
| 仓库门禁 | `pnpm.cmd qa:fast` **exit 0**（含全仓 typecheck、`billing:cost-model-smoke`、`marketplace:*` 契约） |
| 测试实例页面级验收 | `node scripts/lanqi-acquire-instance-acceptance.mjs --base https://api.lcppch.top/lanqi-test` **46 项 / 失败 0 项**（新增 LQ-33 段 8 项：枢纽 6 卡、页面骨架、未生成不出现复制 / 导出、扣费与幂等说明、内容太短本地拦截不发请求、按钮可用、无厂商名、无 4xx/5xx 与控制台错误；移动端 390 十件套页无横向溢出） |
| 发布 | 包 `release-20260916-lq33-copy-kit.tar.gz`（1563 文件 / 9,834,521 B，sha256 `1a256ebf91f432febe435a597aebfed2bd3b07e6ae2cccd4fa2153c1818d40ee`，本地与服务器一致）→ 测试 `20260916-lq33-copy-kit-test1`；含门禁修复的二次包 sha256 `f2ef1bc7959b93f19d90ef91c40346f41dde627e532c89a1029170b1d8d42c2b` → 生产 `20260916-lq33-copy-kit-prod1`；两侧 `DEPLOY_OK` + `health=200` / `ready=200` + `50 migrations found / No pending migrations`，`verify-deploy.sh` **VERIFY_OK** |
| 生产只读取证 | 匿名 `POST /os-v2/api/lanqi/acquire/copy-kit` **401**；`GET /os-v2/lanqi/acquire/copy-kit` **200**（SPA 壳）；线上 chunk `assets/LanqiAcquireCopyKitPage-Ck9ZzJX2.js` 含 `data-lq-ck-submit`×1 / `data-lq-ck-content`×1，枢纽 chunk `LanqiAcquireHomePage-B-wYlAjy.js` 含「美业文案十件套」；API 产物 `dist/apps/api/src/routes/acquire.js` 含 `acquire/copy-kit` 与 `lanqi_copy_kit`，`products/lanqi/copy-kit-service.js` 已落盘 |

### 四、边界与未做

- **领域门禁 `pnpm.cmd qa:lanqi-foundation` 在 main 上本来就红**（不是本次引入）：3 处断言过期——2 处是 commit `0e7053a` 把产品路由装配从 `server.ts` 搬到 `products/register.ts` 后断言没跟着搬（**本次已修**：`lanqi-business-qa-smoke`、`lanqi-xhs-package-contract-smoke` 改查真实装配点 + 兰琪作用域），1 处是图片报价断言仍写旧价 100 积分（实际 20；且 `customerPriceYuan = creditCost / 100` 与「1 积分 = ¥0.05」不一致）——属图片/定价线，按 P2 登记待单独立项（QA-20260916-003），本任务未顺手改钱的口径。
- **生产页面级浏览器验收未跑**（生产需真人微信登录，自动化停在登录页，属既有边界）：生产侧只做了匿名探针 + 产物字符串取证；功能验收在测试实例完成（46/0）。
- **真实付费端到端未跑**：测试租户积分余额不足，未真实扣分走完整链路；扣费逻辑由离线回归（余额不足 402、条件更新、流水、幂等）覆盖。
- 本卡只出**文案与脚本**，不做图片 / 视频联动；不做 TTS。
- **积分账户口径待老板拍板**：兰琪所有能力（含本卡）扣的是**租户积分账户 `creditAccount`**，而 `/recharge` 钱包页充的是**用户钱包 `wallet`**——代码里目前没有把钱包余额同步到租户额度的链路。本卡按现状与兰琪视频 / 图片能力保持一致，**未擅自改账本**；若门店充值后仍提示「积分不足」，需单独立项打通。
- 合并注意：本任务在独立 worktree 分支 `codex/lanqi5` 完成（commit `fe7ba4c`），其中 `apps/api/src/routes/marketplace.ts` 只做了「搬迁 + 引用」，合并回 `main` 前需与平台线核对。

## 最新发布：20260915-lq33b-recharge-entry（2026-09-15，测试实例 + 生产）— 兰琪工作台接上充值入口

### 一、用户口径

- 老板问：「**兰琪智能体在哪里充值**」。核查发现兰琪顶栏「我的」还指向 `/my-ai`，而 `/my-ai` 已于同日随 `20260915-plat44b-legacy-ai` 下线并统一跳智能体货架 → 门店在兰琪里**点不到充值入口**（详细根因与回归见 `docs/BUG_REGRESSIONS.md` QA-20260915-006）。

### 二、改动（4 个文件）

1. `apps/web/src/components/lanqi-brain/LanqiBrainShell.tsx`：顶栏「我的」→ `getAppPath("/recharge")`（钱包页：余额 + 充值套餐 + 订单），文案改「我的 · 充值」并加 `title`。
2. `apps/web/src/pages/LanqiAcquireVideoPage.tsx`：两条积分不足文案改为「请点右上角「我的 · 充值」充值后再试」。
3. `scripts/lanqi-brand-nav-contract-smoke.mjs`：新增 3 条（顶栏必须直达 `/recharge`、文案含「充值」、**禁止再出现 `getAppPath("/my-ai")`**）。
4. `scripts/lanqi-acquire-instance-acceptance.mjs`：新增 1 条真实浏览器断言（顶栏 `.lq-pd__me` 的 href 必须以 `/recharge` 结尾）；`scripts/lanqi-acquire-ui-contract-smoke.mjs` 新增 1 条文案断言。

### 三、验证

- `pnpm.cmd lanqi:brand-nav-contract-smoke` **49/0**（含新增 3 条）；`pnpm.cmd lanqi:acquire-ui-contract-smoke` **102/0**；`pnpm.cmd --filter @baolu/web build` PASS。
- 测试实例真实浏览器 `lanqi:acquire-instance-acceptance --port 9377` **43 项 / 失败 0**（含新增的充值入口断言）。
- 生产只读：主包引用 chunk `LanqiBrainShell-n2ykxg9Y.js`（3220 B）内 `/recharge`×1、**`/my-ai`×0**、「我的 · 充值」命中；`GET /os-v2/recharge` **200**；`GET /os-v2/api/wallet` 匿名 **401**；`verify-deploy.sh` **VERIFY_OK**。
- 发布：包 `release-20260915-lq33b-recharge-entry.tar.gz`（1558 文件 / 9,808,983 B / sha256 `297da0fd60bab9946912dfa44a920e992f99258c08864653e53c212872cfb35d`），发布 id 测试 `20260915-lq33b-recharge-entry-test1` / 生产 **`-prod1`**，两侧 `DEPLOY_OK` + `health/ready 200`。
- 过程注意（如实记录）：生产部署命令在客户端被中断后，服务器侧部署**仍在继续**；按「不强杀、盯日志、跑完复核」处置，最终 `DEPLOY_OK` + `VERIFY_OK`，生产未被留在半成品状态。

### 四、门店现在怎么充值

登录兰琪工作台 → 右上角 **「我的 · 充值」** → 进入钱包页（余额 / 积分套餐 / 订单），或用直达地址：生产 `https://api.lcppch.top/os-v2/recharge`、测试实例 `https://api.lcppch.top/lanqi-test/recharge`（两处实测 200）。

## 最新发布：20260915-lq32b-audio-compose（2026-09-15，测试实例 + 生产）— 一键成片「音频接通 + 合成一条成片」

### 一、用户口径（2026-09-15）

- 老板在兰琪「公域获客 → 一键成片」看到音频卡写着「音频上传暂未接通（本期成片无声）」，问「为什么音频没接通？让用户上传一段音频，或者支持上传视频抽取音频也可以啊」。
- 同一轮确认两件事：① **音频 + 文案一起做**；② 新增的「美业文案十件套」要**新增一张卡**、**独立计费**（该卡见 `docs/agents/lanqi-beauty/tasks/LQ-33-公域获客文案十件套新卡.md`，本轮未开工）。

### 二、技术事实（先说清，不靠话术遮盖）

- 视频模型 `wan2.6-i2v-flash` **只出无声画面**（`parameters.audio=false`，且不下发 `audio_url`），所以「成片有声音」这件事不可能靠换模型解决，只能由平台**本地混流**补上。
- 改造前「一键成片」只按镜交付（每镜一个 mp4，各自下载），**没有拼接**，所以音频卡就算能上传也没有落脚点。
- 生产服务器已具备合成条件：`/usr/local/bin/ffmpeg`（7.0.2-static）+ `ffprobe`；合片与混音是**本机计算**，不调用外部付费接口 → **不额外扣积分**（页面已写明）。

### 三、改动（源码 5 个文件，含 3 个新增/1 个改脚本）

1. **后端新服务** `apps/api/src/services/lanqi-media-compose.ts`（新增）：按分镜顺序拼接（`scale+pad+setsar+fps=30` 统一画布后 `concat` 滤镜）、混入音轨（`-stream_loop -1` 循环补齐 + `-shortest` 以画面长度为准 + `-c:a aac`）、输出校验（`ftyp` 魔数 + 体积上限）、幂等（`requestKey` 索引）与租户隔离（镜次按 `tenantId` 查、音轨文件必须是本租户的 `UploadedFile` 且落在 `UPLOAD_DIR` 内、成片落盘路径由租户派生）。错误码：`audio_rights_required` / `audio_file_not_found` / `audio_file_unsupported` / `audio_file_too_large` / `audio_track_missing` / `shot_not_found` / `shots_not_ready` / `compose_tool_unavailable` / `compose_failed`。
2. **后端路由** `apps/api/src/routes/lanqi-media-generation.ts`：新增 `POST /lanqi/media/compose`（合成）、`GET /lanqi/media/compose/:composeId`（播放）、`GET /lanqi/media/compose/:composeId/download`（下载）；三条都先 `resolveRequestContext`，未登录 **401**。
3. **落盘链路** `apps/api/src/services/lanqi-media-assets.ts`：新增 `persistLanqiComposedVideo`（复用同一条租户隔离落盘链路，`source:"composed"`，带 `shotCount / audioIncluded / audioSource / durationSeconds`）+ 合成幂等索引读写。
4. **前端** `apps/web/src/pages/LanqiAcquireVideoPage.tsx`：音频卡由占位改为**真实上传**（`audio/*,video/*`，≤20MB；上传视频时平台抽其声音当音轨）；多段必须显式指定「本片音轨」；新增音轨使用权授权（未勾选不合成）；上传后「输出规格 / 成片区」显示「🔊 带音轨成片」或「🎧 抽音轨成片」；新增「🧩 合成成片（拼接 + 混音）」入口（未出片时禁用并点名「还差 N 镜没出片」）与整片播放 / 下载；删除「本期成片无声 / 音频上传暂未接通」旧文案。
5. **门禁**：新增 `pnpm lanqi:media-compose-smoke`（离线，真实 ffmpeg，**22/0**）；`scripts/lanqi-acquire-ui-contract-smoke.mjs` 新增 22 条结构断言（**101/0**）；`scripts/lanqi-acquire-instance-acceptance.mjs` 新增 4 条真实浏览器断言，并修掉它自己的一个假失败缺陷（见下）。

### 四、验证证据

- 离线：`pnpm.cmd lanqi:media-compose-smoke` **22 passed / 0 failed**（无音轨拼接 / 长音轨 / 短音轨循环 / 视频抽音 / 无声视频当音轨报错 / 跨租户 / 未出片 / 未授权 / 超大音轨 / 幂等 / 成片跨租户读不到）。
- 页面契约：`pnpm.cmd lanqi:acquire-ui-contract-smoke` **101 passed / 0 failed**。
- 全量快速门禁：`pnpm.cmd qa:fast` **exit 0**（含 typecheck 7 包）。
- 测试实例真实浏览器：`node scripts/lanqi-acquire-instance-acceptance.mjs --port 9371` **42 项 / 失败 0**（桌面 1440；含「音频卡真的能上传（`input.accept=audio/*,video/*`、`disabled=false`）」「上传带声音的视频 → 抽音轨 + 出现授权」「授权勾选可勾」「成片区有合成入口、未出片时点不动且不发合成请求」）。
- 生产只读取证：`POST /os-v2/api/lanqi/media/compose` 匿名 **401** `login_required`；`GET /os-v2/api/lanqi/media/compose/:composeId` 匿名 **401**；线上主包引用的 chunk `LanqiAcquireVideoPage-E9tMehS9.js`（72,803 B）内 `data-lq-vd-compose`=1、`上传音频`=1、`合成成片`=1、`音频上传暂未接通`=**0**、`本期成片无声`=**0**；`apps/api/dist/.../services/lanqi-media-compose.js` 12341 B 含 `stream_loop`；`verify-deploy.sh` **VERIFY_OK**（货架 19 SKU / coming_soon 13 / 两个 vidrev=selling）。
- 发布：包 `release-20260915-lq32b-audio-compose.tar.gz`（1558 文件 / 9,798,538 B / sha256 `b1f14f3e74f9efa06b10d6a4843d3f831b40a31b1bcfc02045c6cf068050b798`，本地与服务器 `/tmp` 实测一致），发布 id 测试 `20260915-lq32b-audio-compose-test1` / 生产 **`-prod1`**，两侧 `DEPLOY_OK` + `health=200` / `ready=200`。
- 顺带修掉的测试工具缺陷：`lanqi-acquire-instance-acceptance.mjs` 的 `findChrome()` 只看文件是否存在，选中了**启动即退出（exit 3）的 Playwright Chromium**，导致验收每次以「DevTools 端口未就绪」假失败；现改为 `--version` 探活后再选。详见 `docs/BUG_REGRESSIONS.md` **QA-20260915-005**。

### 五、边界与未做（如实说）

- **没用真实付费素材跑过整条合成**：测试实例只跑到「逐镜出片前」（真实出片要积分，测试租户 0 积分），所以「真实模型出片 + 真实音轨 → 一条成片」的端到端**尚未在实例上跑过**；合成链路本身用真实 ffmpeg + 合成素材离线验证（22/0）。老板账号充值后即可真实走一遍。
- **成片仍受两件事限制**：单条成片 ≤12 镜；音轨 ≤20MB（超出请先裁短），音轨来源只支持音频文件或带声音的 MP4 / MOV。
- **不做**：TTS 自动配音、多音轨混音 / 音量包络、字幕烧制；不改逐镜出片与计费口径；`VIDEO_RENDERING_READY=false`（门店素材成片 / AI 剪辑）保持 fail-closed。
- **LQ-33（美业文案十件套新卡，独立计费）本轮未开工**，任务卡已建，等排期；它要动平台热点文件 `apps/api/src/routes/marketplace.ts`（抽共享合同），必须与平台线串行。

## 最新发布：20260915-plat44b-legacy-ai（2026-09-15，生产 + 测试实例）— 旧「专业工作地图」工作台下线 + 视频复盘只做抖音/视频号

### 一、用户口径（2026-09-15）

- 旧「专业工作地图」工作台（`/my-ai`，含 CEO 驾驶舱 / 外卖 / 餐饮等历史智能体）**下线**：这条地址不再渲染历史页面，统一跳到智能体平台货架 `/agents`，老链接不 404 也不再有人误入历史页面。
- 视频复盘**只做抖音和视频号**：小红书 / 快手 / B站 的数据表不再解析，明确告诉用户不支持。

### 二、改动（19 个文件，含 1 个新增）

1. **旧工作台地址全部回货架**：`/my-ai` → `takePostLoginRedirect("/agents")`（`MyAiPage` 不再被路由渲染）；`/workbench`、`/app` 从「经 `/my-ai` 中转」改成**一跳** `/agents`。
2. **平台自有页面里指向已下线 `/my-ai` 的入口改到正确落点**：企业知识库「返回常用智能体」、工作台侧栏「常用智能体」、工作地图「切换智能体」、账户页「返回智能体」、未开通页「返回常用智能体」→ `/mine`（新的「常用智能体」页）；品牌按钮与 ClipLab / PersonaClipLab 品牌 → `/agents`；兜底页「去常用智能体」→ `/mine`。
3. **视频复盘服务端 fail closed**：平台识别先把 小红书 / 快手 / B站 判成「其他平台」（避免「分享数」等字段被抖音规则误吞）；`POST /vidrev/parse-preview` 返回 `ok:false` + 「只支持抖音和视频号」；`POST /market/skus/:sku/run` 对非支持平台 **422 `vidrev_platform_not_supported`**（`creditCost=0`，不解析、不扣费）；解析字段别名去掉小红书口径（`笔记标题` / `观看量`）。
4. **视频复盘前端收窄**：平台快捷选项只剩「抖音 / 视频号」，欢迎语写明支持范围，美业数据复盘页去掉小红书 / 快手 / B站 导出指南。
5. **门禁修复与新增**：修掉「保留网址契约」的 `mustNotInMain` 哑断言（见 `docs/BUG_REGRESSIONS.md` QA-20260915-004）；新增 `marketplace:vidrev-platform-scope-smoke`（真实路由 + 真实库目录同步、**0 Provider**）并挂进 `qa:regression`；`marketplace-vidrev-browser-e2e.mjs` 增加「平台范围」相位；`platform-route-browser-e2e.mjs` 的旧地址断言改为**每条独立浏览器上下文**。

### 三、发布与验收

| 环境 | 发布 id | 结果 |
| --- | --- | --- |
| 测试 | `20260915-plat44b-legacy-ai-test1` | `DEPLOY_OK` + `VERIFY_OK`；`platform:route-browser-e2e` **26/26 PASS** |
| 生产 | `20260915-plat44b-legacy-ai-prod1` | `DEPLOY_OK` + `VERIFY_OK`（`skus_total=19` / `coming_soon=13` / `vite_base=/os-v2/`）；`journalctl -p err` 近 12 分钟 `No entries` |

- 发布包 `release-20260915-plat44b-legacy-ai.tar.gz`（sha256 `d025c7b892943b0ade6d6b969d31f85f14f549e35b9437eb6bc33799a2551c99`，1554 文件）；上一个包 `release-20260915-plat44-legacy-ai.tar.gz`（首轮测试实例用，随后被 b 版覆盖）。备份：`/opt/baolu-backups/20260915-plat44b-legacy-ai-prod1-before-baolu-os-v2`、`…-test1-before-baolu-os-v2-test`。
- 生产真机只读实测（干净浏览器上下文）：`/os-v2/my-ai` → `/os-v2/agents`、`/os-v2/workbench` → `/os-v2/agents`、`/os-v2/app` → `/os-v2/agents`、`/os-v2/mine` 正常渲染「常用智能体」；`platform:route-browser-e2e` 生产 **26/26 PASS**。
- 生产/测试接口实测：`POST /vidrev/parse-preview` 小红书表 → `{"ok":false,"platform":"其他平台","rowCount":0,"notes":["视频复盘目前只支持**抖音**和**视频号**…"]}`；视频号表 → `ok:true`、`platform:"视频号"`、解析 1 行。
- 本地门禁：`qa:fast` **PASS**（7 包 typecheck）、`qa:regression` **PASS**（含新增 `marketplace:vidrev-platform-scope-smoke`）、`platform:route-contract-smoke` 106/0（并把反向断言改成能真红）、`marketplace:vidrev-contract-smoke`、`vidrev:excel-upload-smoke`、`agent:work-map-smoke` 全 PASS；本地真实 Chromium：返回入口落点 6/6、`platform:route-browser-e2e` 26/26、vidrev 平台范围相位 PASS（0 console error、0 模型调用）。
- 回滚：`/opt/baolu-backups/20260915-plat44b-legacy-ai-prod1-before-baolu-os-v2/`（测试实例对应 `-test1-`）+ `systemctl restart baolu-os-v2`。本轮**无数据库迁移、无 env 变更**。
- 包后修正（同一条记录，避免以后误判）：`scripts/marketplace-vidrev-platform-scope-smoke.ts` 在首次打包后才发现预检接口的真实路径是根路径 `/vidrev/parse-preview`（`/market/*` 只包住货架那组），已把修正版单文件同步到两个服务器源码树（sha256 `ca18473bc13c267c27d10c86116735ef42d8cea24288b3a34134519891d9a2da`，两侧一致；**只覆盖开发脚本、未重启、未重建**）。它不参与运行、不在构建产物里，因此不影响上线内容；其余文件与发布包一致。本轮发布后写的文档（`BUG_REGRESSIONS.md`、`platform-tasks.md`、`SCHEDULER.md`、本文件）按惯例不进包。

### 四、遗留与后续（不阻塞）

- 兰琪 / 美业自有页面里的「返回我的 AI」等入口仍指向 `/my-ai`（点击会跳货架，功能正常、标签语义不一致），已转派对应线自行决定改成 `/agents` 还是 `/mine`。
- `scripts/beauty-directory-browser-e2e.mjs` 仍断言 `/my-ai` 渲染 `.myAiPage`，美业线恢复活动前需同步改造。
- `MyAiPage` 组件本体仍保留在 `AgentProductsApp.tsx`（`agent:work-map-smoke`、`owned-product-directory-smoke`、美业 BY-52 仍引用），是否删除另立任务。

## 最新发布：20260915-plat43-copy（2026-09-15，生产 + 测试实例）— 客户可见文案「去计费感」

### 一、用户口径（2026-09-15）

- 取消「按次使用」这类描述；取消「从统一积分钱包扣 / 扣积分 / 扣费」这类描述；把不利于用户感受的表述一并换掉。
- 口径与既有方向一致：**不在使用前反复报价，只在交付后告诉用户这次消耗了多少积分**。

### 二、改动（18 个文件）

- 货架/详情/对话/我的/充值/登录：顶部横幅改为「积分全平台通用 · 创始人IP专区与各行业专区的所有智能体共用同一份积分」；「一个钱包，全平台通用」→「一份积分，全平台通用」；「按结果付费…会按次扣积分（免费重做已下线）」→「按结果交付…如需再要一份，重新发起一次即可，用量按实际消耗计算」；「近期按次使用」→「近期使用记录」；「本次消耗 N 积分 · 双桶钱包」→「本次消耗 N 积分」；首页条「一次使用 = 完成一件事」→「用一次，办成一件事」。
- `marketplace-v3.json` 全量 `use` 文案去掉「一次使用 = 」前缀（20 处），直接说交付物；视频复盘欢迎语「一次使用 = 交付」→「给你交付」。
- 接口用户可见提示：「未扣积分」→「不消耗积分」；「免费重做已下线…按次计费重新发起」→「需要再要一份时，重新发起一次即可（用量按实际消耗计算）」；「该智能体未配置按次价格」→「该智能体暂未开放使用」。
- 契约同步：`marketplace-foundation-smoke` 断言从「必须含『一次使用』锚点」改为「必须非空且**不得**出现按次/一次使用话术」；`deployed-marketplace-browser-check` 断言从「显示积分/次」「详情页出现免费重做已下线」改为「**不前置报价**且不出现按次/钱包/扣费话术 + 用中性表述说明再次生成」。

### 三、发布与验收

| 环境 | 发布 id | 结果 |
| --- | --- | --- |
| 测试 | `20260915-plat43-copy-test1` | `DEPLOY_OK` + `VERIFY_OK`；本轮 59 个新产文件里旧话术 **0 处**、新话术均命中 |
| 生产 | `20260915-plat43-copy-prod1` | `DEPLOY_OK` + `VERIFY_OK`（`skus_total=19` / `coming_soon=13` / `expert_zone_empty=True`）；`journalctl -p err` 近 10 分钟 `No entries` |

- 页面级验收（headless Chrome，测试 + 生产各一次）：`shelf=PASS credits_only=PASS no_yuan_conversion=PASS detail_redo_removed_copy=PASS console_clean=PASS`。
- 打包前门禁：受影响 8 个契约 smoke + `pnpm.cmd qa:fast`（含全仓 typecheck）全部 exit 0。
- 备注：`marketplace-v3.json` 哈希变更已同步到 `deploy-release.sh` / `deploy-prod1.sh` / `verify-deploy.sh` 三处 canary。

## 最新发布：20260915-pl41-charge（2026-09-15，生产 + 测试实例）— 语音/视觉接线扣积分 + 视频复盘文案与步骤精简 + 小红书/B站字段

### 一、计费接线（用户 2026-09-15「接」）

- 新增 `credit-charge.ts`：`reserveCreditsForCharge`（先预留扣钱）→ `settleCreditsForCharge`（按实际成本结算、差额按 paid/bonus 原桶退回）→ `refundAllCreditsForCharge`（失败全额退回）；`sitong-wallet` 新增 `refundWalletCredits`（`type=refund`，幂等、只加不扣）。
- **`POST /voice/transcribe`**：语音识别按 **10 倍**计费（先预留，余额不足在**调用 Provider 之前** 402，失败全额退回）。生产实测：0 余额账号 → `402 insufficient_credits`、`required: 1`、`providerCalls: 0`。
- **`POST /media/analyze`**：**图片解析**与**扫描版 PDF 页面识别**按视觉 **100 倍**计费（单图 1 次≈40 积分，PDF 预按 4 页上界预留）；纯文档（CSV / XLSX / TXT / DOCX）不调模型、**不收费**。
- 演示模式跳过计费（与其它业务一致）；前端两处语音入口（公共平台对话页 + 智能体工作台）上报录音时长，供服务端算预留额度。
- 新增 `pnpm.cmd credit:charge-smoke`（真库 6 项，已入 `qa:regression`）：预留/结算退差额/重复结算幂等/余额不足调用前拒绝且零账本行/失败全额退回/余额永不为负。
- 录音卡自动解析按用户口径**暂不收费**（等功能上架再定标准）。

### 二、视频复盘文案与步骤（用户 2026-09-15）

- 欢迎语去掉「60 积分/次」（与「不给单个智能体标价、按成本计费」口径一致）；「看下方导出指南」→「看上方导出指南」；美业专区欢迎语同步。
- **删除「统计周期」这一步**：流程从「平台 → 统计周期 → 数据」缩短为「平台 → 数据」，周期由表格里的日期自动推导；「数据」一步的提示精简为一句「把导出的表格拖进对话框上传，然后跟我说『复盘』就行」。

### 三、小红书 / B站（用户问「我们小红书和B站也能分析了吗」）

- 字段别名补上小红书口径：`笔记标题`→title、`观看量 / 观看次数 / 阅读量 / 阅读次数 / 笔记阅读量`→plays；B站原本就用「播放量」，可直接解析。
- 契约 smoke 增加小红书与 B站两组表头样例（解析行数 + 播放量映射），随 `marketplace:vidrev-contract-smoke` 一起跑。
- 仍需注意：小红书/B站后台的表头偶有差异（如 B站的「弹幕数」「投币」不做映射，避免把弹幕当评论、把投币当点赞而污染互动率），首次用某个平台的表格建议先看报告里的「受限维度」提示。

### 发布与验证

- 发布包 `release-20260915-pl41-charge.tar.gz`（sha256 `ef6060233561daf3488a01f2ee686a4b074b2f3f80d4aff483020385c4ce37a9`）；生产 `20260915-pl41b-prod1`、测试 `20260915-pl41b-test1` 均 `DEPLOY_OK`，生产 `verify-deploy.sh` **VERIFY_OK**、`journalctl -p err` 无条目。
- 过程记录：首次发布被「数据文件哈希 canary」挡下（改了 `marketplace-v3.json` 的欢迎语，三个发布脚本里的 sha256 常量需同步为 `8ab3b8f3…`）；**未改动任何文件、服务未受影响**，同步哈希后重发成功。
- 门禁：`qa:fast` + `credit:charge-smoke` + `plat33:voice-transcribe-admission-smoke` + vidrev 契约/标题契约 全绿（`PLAT41_GATES_OK`）。

## 最新发布：20260915-pl40-noredo（2026-09-15，生产 + 测试实例）— 取消免费重做 + 后台账号密码登录 + 计费口径定稿

### 一、取消智能体「免费重做」（用户 2026-09-15 拍板）

- 服务端：`POST /market/skus/:sku/run` 携带 `redoOf` 一律 **409 `marketplace_free_redo_removed`**（不扣费、不生成、不外发；老缓存前端也白嫖不到）；老的 `POST /billing/redo` 同样 **409 `billing_free_redo_removed`**（无页面调用，但仍是免费入口）。
- 客户端：交付完成后的「😕 不满意 · 免费重做一次（不扣积分）」按钮及其状态全部移除，改为一句「免费重做已下线：如需再生成一份，点『再问一次 / 重新开始』，会按该智能体价格正常扣积分」；详情页文案同步。
- 回归：`marketplace:free-redo-smoke` 改写为「已下线」口径（带 redoOf → 409、只留一条全价 consume 账本、无任何 redo/adjustment 行、跨账号/跨商品/未知凭证一律 409、零余额同样 409、正常再生成按全价扣费）；`marketplace:vidrev-run-smoke` 的重做相位改 409；货架浏览器 e2e 断言「免费重做」按钮**不存在**且出现新说明。

### 二、管理后台改成管理员账号密码登录 + 概览补齐业务数字（用户 2026-09-15）

- 新增 `POST /admin/login`（账号 + 密码 → 12 小时会话令牌，scrypt hash 校验、15 分钟 10 次限流、账号/密码错误文案一致防枚举）与 `GET /admin/session` 自检；`requireAdminToken` 同时接受「会话令牌」与旧的共享 `ADMIN_TOKEN`（脚本/运维向后兼容）。后台页面改成账号密码登录表单 + 退出登录，原「粘贴令牌」降级为折叠的高级选项。
- `/admin/ops/summary` 新增 `credit` 汇总，口径按生产数据校准：**累计按次消耗**（`MarketplaceLedgerEntry.ppu_consume`）、**客户剩余积分**（`Wallet.paidBalance + bonusBalance`），遗留 `CreditAccount` 余额单列不混算（此前 20 亿的假数字就来自混算）。概览页改成「关键数字（客户/订单/积分）」卡片。
- 生产实测：登录 200、错密码 401、无令牌访问数据接口 401；概览为 客户 223 / 用户 216 / 已支付订单 5（451 元）/ 待支付 24 / **累计消耗 720 积分 / 客户剩余 9,320（付费 8,220 + 赠送 1,100）**。

### 三、计费口径定稿（用户 2026-09-15 拍板）

- 倍数：**文字 100× / 图片 5× / 视频 2× / 语音识别（ASR）10× / 视觉（关键帧/图片/扫描件）100×**；公式 `积分 = max(1, ceil(成本 ÷ 0.05 × 倍数))`，先预留后按实际结算。
- 已落进 `apps/api/src/services/billing-cost-model.ts`（唯一出处）并被 `pnpm billing:cost-model-smoke` 钉住：文案 32 积分、IP 定位 116、视频 12 积分/秒、图片 20 积分/张、语音短句 1 积分地板（1 分钟 6 积分）、视觉 40 积分/次。
- **市场合伙人分润结构**已就位：`PARTNER_SHARE_PERCENT`（按能力配置，单位=对客营收百分比）+ `splitPartnerShare()`；比例未拍板时返回 `null`，不臆造分润。等老板给比例后只改这张表（后续再落「分润台账 + 结算单」）。
- **「有成本没收钱」摸底**（详见 `docs/PRICING.md` 第六节）：确认三条漏收 —— ①公共平台语音输入（ASR，免费）；②`/media/analyze` 的图片解析与扫描 PDF 页面识别（qwen-vl，免费）；③录音卡自动解析（模型调用，免费）。另有 clip-lab 渲染、daily-brief 主动日报、微信客服自动回复三条**待专项审计**。接线需要「先预留→结算→退回」改造（开关 `BILLING_COST_BASED_ENABLED` 默认关，线上价格一分未变）。

### 发布与验证

- 发布包 `release-20260915-pl40-noredo.tar.gz`（sha256 `69033700e3e45070d3f69c984928f0a926cc65fcd66119d8776fdea9cdad6b81`）；生产 `20260915-pl40b-prod1`、测试 `20260915-pl40b-test1` 均 `DEPLOY_OK`。
- 过程记录：首次生产发布在 step 3 因**环境变量文件里 `ADMIN_LOGIN_PASSWORD_HASH` 未加引号**（`scrypt$<salt>$<hash>` 里的 `$` 被 bash `set -u` 当变量）中止；**未改动任何文件、服务未受影响**，给两个 env 文件加单引号后重发成功（`source` 自检 `ENV_SOURCE_OK`）。

## 最新发布：20260915-plat38-plink（2026-09-15，生产 + 测试实例）— 「我的」页邀请链接 + 对外统一客户链接（注册+充值）

### 对外只发这一条链接（可长期复用，推荐码不是一次性的）

```text
https://api.lcppch.top/os-v2/login?ref=<你的推荐码>&next=/recharge
```

不带 `ref` 也能注册（只是没有归因）：`https://api.lcppch.top/os-v2/login?next=/recharge`。
用户点开 → 微信一键登录 / 注册 → 填企业 / 门店名完成开通 → **直接落到充值页**。
老板的推荐码在平台「我的」页（`/os-v2/mine`）点「生成我的邀请链接」复制（同一天上线的 PLAT-38 卡片，含二维码）。

### 本次内容

1. **PLAT-38「我的」页自助邀请链接**：新增 `GET/POST /market/me/referral-link`（身份取自服务端验签会话，只能操作自己的推荐码；未登录显式 401）。安全模型沿用 PLAT-28：**推荐码明文只在签发时返回一次**，已有码只给 preview + 「再生成一条」（旧链接仍有效）。链接与二维码均由**服务端**用 `PUBLIC_WEB_BASE_URL` 生成（不接受客户端 URL）；测试实例已把该变量指向 `/lanqi-test/`，避免生成指向生产的链接。
2. **PLAT-38 竞态修复**：首屏 GET 未回来时用户点「生成邀请链接」，POST 先返回 created+链接、随后 GET 的旧结果把状态覆盖回「已有推荐码」——用户看到「点了没链接」。改为状态版本号，POST（用户显式动作）永远优先；按钮语义确定化（点「生成…邀请链接」一律签新码）。
3. **plink 统一链接**：`main.tsx` 启动最早处捕获 URL —— `?ref=` 写入推荐码暂存（跨页面 / 跨微信授权往返不丢），`?next=` 写入注册后落地页（复用既有 post-login redirect）。

### 验证

- 生产真机只读：打开 `https://api.lcppch.top/os-v2/login?ref=ref-check-0615&next=/recharge` → 落地 `/os-v2/login`、显示「已识别推荐码 ref-ch****15」与「微信一键登录 / 注册」、`store_os_post_login_redirect=/os-v2/recharge`。
- 页面级验收 `scripts/acceptance/plat38-referral-link-browser-e2e.mjs`：本地 **10/10**、测试实例 **10/10**（卡片 / 链接 / 二维码 / 复制到剪贴板 / 用链接打开注册页认出推荐码 / 390px 无横向溢出 / 控制台 0 error）。
- 数据契约 `pnpm.cmd referral:self-service-smoke`（真库 6 项，已入 `qa:regression`）：未登录 401、首次签发返回明文、复读隐藏明文、再生成保留旧码、跨用户看不到别人的码、链接用服务端配置的站点拼。
- `qa:fast` 全绿；生产 `verify-deploy.sh` **VERIFY_OK**、`journalctl -p err` 无条目。

### 发布与回滚

- 发布包 `release-20260915-plat38-referral-link.tar.gz`（sha256 `eec56da4…`）、`release-20260915-plat38b-referral-link.tar.gz`（`9ce2494c…`，含竞态修复）、`release-20260915-plink.tar.gz`（`a71a7542681ed10165a037224cadb9b13d5609c54777dd5639e36cc28603eb65`）。
- 生产 `20260915-plat38-prod1` / `20260915-plat38b-prod1` / `20260915-plink-prod1`、测试 `20260915-plat38-test1` / `20260915-plat38b-test1` / `20260915-plink-test1` 均 `DEPLOY_OK`；备份在 `/opt/baolu-backups/20260915-<release>-before-baolu-os-v2*`。

## 最新发布：20260915-plat36-redlights（2026-09-15，测试实例 + 生产）— 清掉既有红灯 + 审计泄漏修复

- 发布包 `release-20260915-plat36-redlights.tar.gz`（sha256 `6975b25516291cd5376298a4ba9c0ca4e9b7eb5b0038be3cc63073d2a8148eb4`，1527 文件），从 commit `0df4a8a` 完整快照打包。
- 用户口径：「4 条既有红灯同意开卡修」。
- **实际是 2 条**：`beauty-industry:video-foundation-smoke` 与 `video-material-authorization-smoke` 在并行 LQ-30 线程收口后**当前 HEAD 已绿**（只做回归确认，未改代码）；仍红的两条已修：
  - `beauty-industry:web-contract-smoke`：断言过期——PLAT-32 把产品路由装配搬到 `products/register.ts`。改成断言 `server.ts` 走 `registerProductRoutes` **且** `products/register.ts` 真注册美业路由。
  - `beauty-industry:video-oss-staging-smoke`：① 断言旧的 `/cleanup_failed/` 文案（LQ-27 有意改成保留驱动具体错误码）→ 改钉契约（必须抛错 + 驱动具体码 + 租约 `cleanup_failed` + `errorCode` 记录 + sweep 可恢复）；② **修掉①后暴露一条 P1：审计把上游原始错误 message 落库**（合成夹具实测 `LEAK_MARKER SYNTHETIC_RAW_RESPONSE`，真实环境可能含签名 URL/桶名/AccessKeyId）→ `rawErrorDetail()` 改为「错误类名 + 错误码 + 12 位消息指纹」，两处回退分支统一走它。
- 验证：`REDLIGHT_ALL_OK`（4 条一次连跑全 PASS；oss-staging 连续 3 轮，每轮 124 次注入 SDK 请求、云端 0、Provider 0、费用 0）；`pnpm.cmd qa:regression` 全链路通过（`PLAT36_QA_REGRESSION_OK`）；**`pnpm.cmd qa:full` 首次全绿**（`PLAT36_QA_FULL_OK`，含 fast/regression/build/api_runtime_data_check）；生产产物核对：`beauty-video-oss-staging.js` 含 `messageFingerprint`、旧 `slice(0,120)` 原文路径为 0。
- 部署：测试 `20260915-plat36-test1`、生产 `20260915-plat36-prod1` 均 `DEPLOY_OK` + `VERIFY_OK`；`journalctl -p err` 无条目。备份/回滚：`/opt/baolu-backups/20260915-plat36-{test1,prod1}-before-baolu-os-v2*`。
- 登记：`docs/BUG_REGRESSIONS.md` QA-20260915-001（审计泄漏 P1）与 QA-20260915-002（断言过期）；任务卡 `docs/agents/platform-tasks.md` PLAT-36。
- 说明：OSS 暂存驱动在 `BEAUTY_VIDEO_STAGING_DRIVER` 未开启时不生效；本卡全程离线合成，未接真实云/真实素材。

## 最新发布：20260915-plat35-admin-console（2026-09-15，测试实例 + 生产）— 统一管理后台入口

- 发布包 `release-20260915-plat35-admin-console.tar.gz`（sha256 `69a16d42fd4d574f3ca7e83da3059531cb123c2eefd37940bc2537e05a5c32a4`，1527 文件），从 commit `3e751a1` 完整快照打包。
- 用户口径：「侧边导航把 5 个视图 + 客户 / 订单 / 积分干预串起来，复用已有 API」「后台只有我需要用，不需要给用户」。
- 内容：新增 `AdminConsolePage`（`/agents/admin`）——左侧 7 个分组：**概览 / 客户 / 订单与收款 / 积分干预 / 智能体与货架 / 推荐归因 / 质量与安全**；页头直接列出每个视图用到的接口（排障一眼可见）；写操作只保留后台本来就有的四类（发体验额度、建邀请码、SKU 上下架/改价、生成推荐码），其余只读。旧页面保留在 `/agents/admin/legacy`（推荐有礼配置位的可写编辑不在新后台里重造）。样式独立成 `styles/admin-console.css` 并随后台懒加载。
- 门槛（不给用户）：视图数据要**平台管理令牌**（`x-sitong-admin-token`）**且**当前账号是 owner/admin；缺哪个页面直说哪个，错误文案按后台口径重写（不再复用「体验额度发放」页的文案）。
- 验证：本地真机 18/18（7 个视图逐个切换、移动端 390 无横向溢出、控制台 0 error）；**测试实例真机 18/18**（真实部署产物 + 真实数据）；生产 `verify-deploy.sh` **VERIFY_OK**、产物含 `AdminConsolePage-*.js` 与「仅运营使用」文案、`/admin/customers` 无令牌 **401**（后台不对外开放）、`journalctl -p err` 无条目；`qa:fast` 全绿（`PLAT35_QA_FAST_OK`）。
- 部署：测试 `20260915-plat35-test1`、生产 `20260915-plat35-prod1` 均 `DEPLOY_OK`。备份/回滚：`/opt/baolu-backups/20260915-plat35-{test1,prod1}-before-baolu-os-v2*`。
- 未做：生产页面级（需要真人微信登录 + 平台令牌；生产不代老板登录）。老板入口：`https://api.lcppch.top/os-v2/agents/admin`，用平台账号登录后在页面顶部「平台管理令牌」里粘贴 `ADMIN_TOKEN`（服务器 `/etc/baolu-secrets/baolu-os-v2.env`）。
- 排队中：计费模型改为「按 token 成本 × 利润率、只告知消耗、不给单个智能体标价」（等利润率 / 取整 / 余额不足三处拍板）。

## 最新发布：20260915-plat34-unified-login（2026-09-15，测试实例 + 生产）— 统一注册链接（兰琪要邀请码，其他都不要）

- 发布包 `release-20260915-plat34-unified-login.tar.gz`（9,679,686 B / 1524 文件，sha256 `f869e1e0a8b5cd290495066391cbc8fddbacc5f8f967e1357fe2557bd5d2c1a3`），从 commit `8e07d7e` 完整快照打包。
- 用户口径：对外只发**一个**注册链接 `https://api.lcppch.top/os-v2/login?ref=<推荐码>`（`ref` 只做归因、可省略）；**兰琪**仍凭邀请码（`/login/lanqi?invite=…`），美业 / 创始人 IP / 外卖与统一链接都能直接注册。
- 实现：`invite-codes.ts` 受控产品清单显式=`lanqi`；缺码时兰琪 403、非兰琪产品放行且不写码归属，平台主入口仍由 `INVITE_REQUIRED`（生产/测试均 `false`）决定；**带无效码一律 403**；`auth.ts` 无 `inviteCodeId` 时跳过兑换、美业品牌只在码带品牌时写；`LoginPage.tsx` 邀请码表单只在兰琪出现，其他入口直达资料表单并保留微信通道，统一链接里的失效旧码会被清掉并提示（不挡注册）。推荐归因链路未改。
- 验证：新增 `auth:invite-gate-smoke`（真数据库 6 项，已入 `qa:regression`；红灯=回退后 `beauty-industry 无邀请码 → 403`）、`platform:referral-attribution-smoke` 60/0、`qa:fast` 全绿；测试实例真实 HTTP：无码建号 200 / 兰琪无码 403 `invite_code_required` / 美业无码 200（回带 `productCode`）/ 无效码 403 `invite_code_not_found`（验收租户已清理）；**生产只读页面验收 17/17**（统一链接无邀请码输入框且显示推荐码、兰琪保留必填、其余三个入口直达资料表单、控制台 0 error）。
- 部署：测试 `20260915-plat34-test1`、生产 `20260915-plat34-prod1` 均 `DEPLOY_OK` + `verify-deploy.sh` **VERIFY_OK**；`journalctl -p err` 无条目。生产再次实测兰琪无码 403 / 无效码 403（两条都不落数据）。
- 备份/回滚：`/opt/baolu-backups/20260915-plat34-{test1,prod1}-before-baolu-os-v2*`；回滚＝还原备份目录 + `systemctl restart baolu-os-v2(-test)`。
- 未做（用户已点名，排后续）：统一管理后台入口；计费模型改为「按 token 成本 × 利润率、只告知消耗、不给单个智能体标价」（需利润率 / 取整 / 余额不足三处拍板）。

## 最新发布：20260914-vidrev-online（2026-09-14，测试实例 + 生产）— 视频复盘验收通过后重新上架（含 P1 修复）

- 发布包 `release-20260914-vidrev-online-v5.tar.gz`（9,673,131 B / 1522 文件，sha256 `b79534fa3f2eb3ac01e3bf99e70eb62b1a27f9d9aa11ccb48f867e29ebaf200f`），从 commit `7e77301` 快照打包（完整文件集）。
- **验收（工单 2026-09-13 §四 十项）**：① 未传文件只打「复盘」→ 回复导出指南、不调模型不扣积分；② 界面无「快速诊断」；③ 视频号助手 / 抖音创作者中心网址可点；④ 抖音 CSV/Excel → 报告（测试实例真实模型 14–17 秒）；⑤ 视频号 Excel → 报告 / 受限维度；⑥ 空表 → 明确提示；⑦ 余额不足 → 402 引导充值（测试实例实测）；⑧ 「增强提示词」改成「✨ 一键填充标准请求」；⑨ 输出零 + 一~十共 11 段标题 + 数据质量审计；⑩ payload 契约 `kind=vidrev`。
- **验收中发现并修掉一条 P1（QA-20260914-006）**：引擎把空象限占位符「无」当成视频 ID，只要有一个象限为空就必然 422（`V3 视频 无 被归入多个象限`）——正是用户反馈的「上传数据后没有输出」。修复后测试实例真实复盘 **200 / 60 积分一次 / 6,029 字 / 两个空象限**；生产同版产物含该修复。
- **上架**：`marketplace-v3.json` 的 `ipzone.ov.vidrev` / `meiye.ov.vidrev` 由 `coming_soon` 改回 `selling`（新 sha256 `2d3684e26767f7f2ee000ba3e71280d0df79918cdf570a728d4d0d511ca3b566`，三个发布脚本与 foundation/api/sku-link 三处契约断言同步）。生产 `/market/skus` 实测两个 vidrev 均 `selling`（在售 6 / 开发中 13）；`verify-deploy.sh` **VERIFY_OK**。
- 新增能力：对话页支持平台后台导出的 `.xlsx/.xls`（走 `/media/analyze` 文档解析，**不**走 ASR 通道），附件含成交金额时置 `has_revenue_data`。新增 `vidrev:excel-upload-smoke`（已入 `qa:fast`，3 轮 / 0 Provider）与 `scripts/acceptance/vidrev-excel-upload-browser-e2e.mjs`（本地 15/15、测试实例 15/15）。
- 发布过程记录：首包（v1）因**误把 `package.json` 排除出文件清单**，服务器 corepack 装到 pnpm 11（要求 Node ≥22）构建失败（`ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`）；v3 漏打 `LanqiAcquireVideoPage.tsx` → stage 缺模块失败。两次都在**动任何文件之前**退出、服务未受影响，最终用完整文件集（v5）发布成功。
- 备份/回滚：`/opt/baolu-backups/20260914-vidrev-online-test4-before-baolu-os-v2-test/`、`…-prod1-before-baolu-os-v2/`；回滚＝还原备份目录 + `systemctl restart baolu-os-v2(-test)`。
- 磁盘：按用户 2026-09-14 点头执行备份保留策略（每环境留最近 8 份），删除 28 个旧目录、释放 4.83G，清单 `/opt/baolu-backups/.retention-deleted-20260914-193131.log`。

## 最新发布：20260914-lq30b-replicate-live（2026-09-14，测试实例 + 生产）— 兰琪爆款复刻「只支持上传原片」+ 出片链路真能跑通

- 发布包 `release-20260914-lq30b-replicate-live.tar.gz`（9,665,278 B / 1520 文件，sha256 `f340f0f119723f6d3e059961da77e5c1d2d7d23730c6441bbcd52da0e3a8e98c`）。**打包口径**：其他任务在途的 `apps/web/src/marketplace/AgentChatPage.tsx`、`scripts/marketplace-vidrev-run-smoke.ts` 以 HEAD 版本入包（其工作树版本当时编译不过 `vidrevHasData`），该任务新增的两个未跟踪脚本不入包。
- 内容：① 参考素材**只保留上传原片**——抖音链接页签 / 输入框 / 「登记参考来源」按钮 / 链接解析代码整体撤退（用户 2026-09-14「先取消抖音链接的爆款复刻，只支持上传视频」）；② 出片链路的产品权益清单抽到 `apps/api/src/services/video-replication-entitlement.ts`（`beauty-industry` + `lanqi`），路由准入 / 素材授权 `scope()` / 许可 `currentAccess()` 三处共用；③ 新增 env `VIDEO_REPLICATION_PERMIT_MODE`（默认 `operator`；生产与测试实例置 `auto`）——按同一套预算上限自动签一条绑定本次请求的单批许可；④ 页面报价前自动上传「在线勾选声明」并登记两份素材授权；⑤ 报价缺口翻人话（`insufficient_credits` 等），确认仍走既有 402 `insufficient_credits`。
- 测试实例 `20260914-lq30b-replicate-live-test1` / 生产 `20260914-lq30b-replicate-live-prod1`：均 `DEPLOY_OK` + `health=200` / `ready=200`（生产 after 15s）+ 无待应用迁移；生产 `verify-deploy.sh` **VERIFY_OK**（public_web 200 / public_market_skus 200 / skus_total=19 / coming_soon=15 / zones=ipzone,lanqi,meiye）。
- 页面级验收（测试实例真实浏览器，桌面 1440 + 移动 390）：`pnpm.cmd lanqi:acquire-instance-acceptance` **37 项 / 失败 0**。新增「爆款复刻只支持上传原片（无搜爆款入口、无贴链接入口）」；「点主按钮真的走报价」= 4 个请求（声明依据上传 + 两条素材授权 + 报价），报价后状态 `blocked`（该免登录租户积分不足）、未创建任务；`lanqi:acquire-ui-contract-smoke` **79 / 0**（含「不再有参考抖音链接 / lq-vd-ref-link / 登记参考来源 / 链接解析代码」四条反向断言）。
- 生产只读产物核对：入口 `assets/index-DtcU3loT.js` → `assets/LanqiAcquireVideoPage-CGvmZ2vi.js`（HTTP 200 / 54,372 B）：`参考抖音链接` **0**、`lq-vd-ref-link` **0**、`登记参考来源` **0**、`上传原片` 5、`更换原视频` / `删除这条原片` 各 1、`data-lq-vd-primary` / `data-lq-vd-remove` 各 2；匿名 `POST /os-v2/api/viral-video-replication/quote` → **401**。服务与配置复核：两个服务 `active`、两侧 health 200、两侧 env 各 1 行 `VIDEO_REPLICATION_PERMIT_MODE=auto`。
- 配置变更（含备份，可回滚）：`/etc/baolu-secrets/baolu-os-v2.env` 与 `baolu-os-v2-test.env` 各追加 `VIDEO_REPLICATION_PERMIT_MODE=auto`（备份 `.bak-20260914-lq30`）。回滚 = 还原该备份 env + 还原发布前备份目录 + `systemctl restart <service>`。
- 回滚点：`/opt/baolu-backups/20260914-lq30b-replicate-live-prod1-before-baolu-os-v2/` 与 `/opt/baolu-backups/20260914-lq30b-replicate-live-test1-before-baolu-os-v2-test/`。
- 未做：未给任何租户补权益（用户 2026-09-14 明确「不用给杨萋萋账号补权益」）；未跑真实付费样片（用户自行用真素材测验）；单条成本上限仍为 ¥10 → 只能出 ≤16 秒的片（更长需提高 `ALIYUN_VIDEO_REPLICATION_MAX_COST_FEN`）。
- 提交：`ed498ae`（LQ-30 主体）+ `881d7be`（并行提交 `cd37a6b` 把工作树页面覆盖回贴链接旧版后，重新落回只上传原片版）。**注意**：`docs/`、`scripts/tmp/deploy-*.sh` 仍可能有并行任务在途改动，本发布只针对上列文件。
## 最新发布：20260914-plat33-voice-input（2026-09-14，测试实例 + 生产）— 公共平台语音输入

- 发布包 `release-20260914-plat33-voice-input.tar.gz`（9,652,995 B / 1518 文件，sha256 `5e8c36da311f02e42aef5c581fc8059646c2db2b30dfb6cc7f3a0c3b6368060b`，本地与服务器实测一致）。**从「只含本提交」的干净快照打包**（`git worktree` 指向 commit `402769b`）：打包时同一工作树里并行线程正在改 `viral-video-replication*` / `beauty-video-*` / 新增 `video-replication-entitlement.ts` 与 LQ-30 卡，包内已核对**不含**这些在途文件（`tar -tzf | grep video-replication-entitlement|LQ-30` = 0）。
- 内容：用户口径「在公共平台里增加语音输入功能，支持用户语音输入内容」。① 公共平台对话页 `/agent/<sku>/chat` 新增「🎤 语音 / ⏹ 结束录音」，录音走新入口；② 录音逻辑抽成 `useVoiceInput` hook，智能体工作台 `ChatComposer` 复用同一入口（原先它打 `/media/analyze`，对音视频一律 503 `asr_authorization_required`，等于语音一直不可用）；③ 新增 `POST /voice/transcribe`：身份只认服务端验签会话（未登录 401 `voice_login_required`）、用途由服务端固定 `web_voice_input`、每小时次数上限（默认 60/租户+用户，超限 429）、体积上限（默认 10MB，超限 413）、非音频 415、缺 Key 503 `voice_transcription_not_configured`、超时 504 / 上游失败 502，全部 `creditCost: 0` 且明说未扣积分；④ 新增 `VOICE_TRANSCRIBE_MAX_MB` / `VOICE_TRANSCRIBE_HOURLY_LIMIT` / `VOICE_TRANSCRIBE_TIMEOUT_MS`（有默认值）；⑤ **不放开**共享入口 `/media/analyze` 的音视频闸门（QA-20260905-003 / BY-47 保持 fail-closed，本卡有反向断言）。
- 测试实例 `20260914-plat33-voice-input-test1` / 生产 `20260914-plat33-voice-input-prod1`：均 `DEPLOY_OK` + `verify-deploy.sh` **VERIFY_OK**（`marketplace-v3.json` canary `f986b5b7…` 一致、skus 19 / coming_soon 15 / 双 vidrev `coming_soon`）；两侧 `prisma migrate deploy` = `50 migrations found / No pending migrations to apply.`；`journalctl -p err` 无条目。
- 线上核对：生产 `POST https://api.lcppch.top/os-v2/api/voice/transcribe`（未登录）**401** `voice_login_required` 且 `providerCalls: 0`；生产/测试产物 `assets/ChatComposer-*.js` 与 `assets/MarketplaceApp-*.js` 均含 `voice/transcribe`，`🎤 语音` 各 1 处。
- 测试实例**真实转写**（服务端用测试库既有会话、只读）：8 秒真实中文录音 → **200**、`purpose=web_voice_input`、50 个中文字、706ms、`creditCost: 0`、`qwen3-asr-flash` `billingStarted=confirmed`。
- 真机浏览器（Chrome 假麦克风喂真实中文录音，只读不发送）：公共平台对话页 `/agent/ipzone__copy/chat` **7/7 PASS**、智能体工作台 `/agents/acquisition` **7/7 PASS**，两侧控制台 0 error，截图见 `test-environments/plat33-voice-input-20260914/`。
- 备份/回滚：`/opt/baolu-backups/20260914-plat33-voice-input-prod1-before-baolu-os-v2/`、`…-test1-before-baolu-os-v2-test/`；回滚 = 还原备份目录 + `systemctl restart baolu-os-v2(-test)`，或重放上一包。
- 发布前磁盘处置（非业务改动）：`/opt/baolu-stage` 历史构建暂存 16 个目录 **6.1G**（`deploy-release.sh` 每次重建，不是回滚资产）已清理，磁盘 **94% → 72%（1.8G → 7.9G 可用）**；本轮两个 stage 目录发布后也已清掉，当前 **75% / 7.1G 可用**。`/opt/baolu-backups`（7.0G，52 份）**未动**——保留策略脚本仍未执行，等老板点头。
- 既有回归红灯（**非本轮引入**，已在报告里标明）：① `beauty-industry:video-oss-staging-smoke`（`cleanup_failed` 实得 `oss_http_503`，2026-09-14 平台抽取批次已记录）；② `beauty-industry:video-foundation-smoke` / `video-material-authorization-smoke`（把 `env.ts` 回退到 HEAD 后同样失败，且并行线程正在改这些 `beauty-video-*` 文件）；③ `beauty-industry:web-contract-smoke` 断言 `server.ts` 含 `registerBeautyIndustryRoutes`，而该注册在 PLAT-32（commit `0e7053a`）已移到 `products/register.ts`，HEAD 上就已不成立。
- 未跑：生产页面级语音验收（生产对话页需真人微信登录，自动化停在登录态）；移动端真机录音（本机只跑了桌面 1440）。

## 最新发布：20260914-zd7d/zd7e-vidrev-fix（2026-09-14，测试实例 + 生产）— 视频复盘智能体按 2026-09-13 工单改造

- 包 `release-20260914-zd7d-vidrev-fix.tar.gz`（sha256 `357fad7a…`）+ `release-20260914-zd7e-vidrev-fix2.tar.gz`（sha256 `731d9a3d…`，收尾美业欢迎语与后端 agent 定义）。
- 内容（工单 2026-09-13）：① 未上传前展示「📥 视频数据导出指南」（视频号助手 / 抖音创作者中心真实网址 + 4 步导出步骤，常驻可折叠卡片）；② 删除「快速诊断」，只保留深度复盘 60 积分/次（前端交互、后端 quick 分支、快速诊断 system prompt、美业专区欢迎语、后端 agent 定义全部清理）；③ 新增 `POST /vidrev/parse-preview` 预检（返回 字段 / 平台 / 条数 / 日期范围 / 受限维度，不调模型、不扣积分）；④「增强提示词」在视频复盘下改为「✨ 一键填充标准请求」；⑤ 后端补视频号/抖音字段别名（发表时间 / 转发量 / 平均播放进度 / 播放次数 / 广告消耗 等）。
- 测试 `…-test1`、生产 `…-prod1`：均 `DEPLOY_OK` + `verify-deploy.sh` **VERIFY_OK**；生产 `parse-preview` 实测抖音表头 **200** 且字段/平台/周期解析正确；生产 `marketplace-v3.json` 已无「快速诊断」；`journalctl -p err` 无条目。
- 状态：**视频复盘仍处「开发中」（`coming_soon`），本次未上架**；上架按业务验收后再执行（改回 `selling` + 同步哈希与契约断言）。

## 最新发布：20260914-zd7c-vidrev-off（2026-09-14，测试实例 + 生产）— 视频复盘智能体下架成「开发中」（改好再上架）

- 发布包 `release-20260914-zd7c-vidrev-off.tar.gz`（9,627,767 B，sha256 `d3c817a520f6dc7ca6bf0da1e2799b69412e8733a7452237ad1ca3965bb59a06`，1512 文件）。
- 内容：用户口径「视频复盘智能体先改成开发中，改好后再上架给用户使用」。`apps/api/src/data/marketplace-v3.json` 把 `industries.ipzone.ov.vidrev.status` 与 `industries.meiye.ov.vidrev.status` 由 `selling` 改回 `coming_soon`；同步更新 `verify-deploy.sh`（两个 vidrev 必须 = `coming_soon`）、三个发布脚本的 `marketplace-v3.json` sha256 常量（`1dd5b672…` → `fe5b3ea7…`）、以及 `marketplace-foundation-smoke` / `marketplace-api-smoke` / `marketplace-sku-link-regression` / `marketplace-vidrev-browser-e2e` / `marketplace-vidrev-run-smoke` 的断言与注释。
- 测试实例 `20260914-zd7c-vidrev-off-test1` / 生产 `20260914-zd7c-vidrev-off-prod1`：均 `DEPLOY_OK` + `verify-deploy.sh` **VERIFY_OK**；生产 `/market/skus` 实测 `ipzone__vidrev` / `meiye__vidrev` 均 `coming_soon`，`coming_soon=15` / `selling=4`；`journalctl -p err` 无条目。
- 备份/回滚：`/opt/baolu-backups/20260914-zd7c-vidrev-off-prod1-before-baolu-os-v2/`（191M）。回滚 = 还原该备份并 `systemctl restart baolu-os-v2`。**磁盘提示：本轮后 `/` 已用 24G / 剩 4.1G（86%）**，建议尽快跑一次备份保留策略（每环境留最近 8 份）。
- 上架回滚（业务侧）：改好视频复盘后，把 `marketplace-v3.json` 两处 `status` 改回 `selling`、同步两个哈希常量与契约断言，再发一次即可。

## 最新发布：20260914-lq29-acquire-fixes（2026-09-14，测试实例 + 生产）— 兰琪爆款复刻三条现场缺陷修复（抖音分享口令 / 已传素材删除替换 / 出片主按钮点不了）

- 发布包 `release-20260914-lq29-acquire-fixes-v2.tar.gz`（9,623,158 B / 1512 文件，sha256 `bf1a1bcbad7760c138e2afa027f5704fdd0b01091b67dd063e6f9ac10bd5f29c`，本地与服务器 `/opt/releases/` 实测一致）。从「只含本提交」的干净快照打包：发布前逐字节比对确认与生产不同处的文件恰好只有本任务的 7 个源 / 脚本文件 + 2 个已提交文档，未夹带并行任务的在途改动。
- 内容（**只动前端**：`LanqiAcquireVideoPage.tsx` + `lanqi-moments.css`，未改后端路由 / 鉴权 / 计费）：① `parseReferenceLink()` 重写——从任意粘贴文本**抽出第一条链接**再校验（`http` 升级 `https`、裁掉链接后粘连的中文与标点、无协议头短链 `v.douyin.com/xxx` 也认），整段没有链接时明说「这段文字里没有链接」并给「分享 → 复制链接」步骤，非抖音链接报出实际域名，旧提示「这不像一条完整链接」彻底删除；② 上传区新增「🔄 更换原视频 / 🔄 更换照片」与「🗑 删除这条原片 / 删除这张照片」，删除时换新幂等键并清掉上一次报价 / 任务 / 成片；③ 出片主按钮改显式状态机（素材没齐点名缺口 / 齐了没报价时可点、点它就是先报价 / 报价可确认后变「✅ 确认并出片（按报价扣 N 积分）」），**未确认前不建任务、不扣积分**；④ 403 改说人话（`product_access_denied` → 「当前账号还没有开通这项出片能力，与素材、授权是否填对无关」）。详见 `docs/BUG_REGRESSIONS.md` QA-20260914-004。
- 测试实例 `20260914-lq29-acquire-fixes-test2` / 生产 `20260914-lq29-acquire-fixes-prod1`：均 `DEPLOY_OK` + `health=200` / `ready=200` + `50 migrations found / No pending migrations to apply.`；`verify-deploy.sh` 两侧 **VERIFY_OK**（`WEB_URL` 需带结尾斜杠，否则 `/os-v2` → `/os-v2/` 的 302 会被误判为 `public_web` FAIL）。
- 生产产物核对（直接下载线上 chunk）：`index.html` → `assets/index-DNYd7rb4.js` → `assets/LanqiAcquireVideoPage-BwFfTi2O.js`（HTTP 200 / 67,224 B）内 `data-lq-vd-primary` / `data-lq-vd-remove` / `data-lq-vd-primary-hint` / `还没有开通这项出片能力` / `这段文字里没有链接` / `更换原视频` / `更换照片` / `删除这条原片` 各 **1** 处，旧串 `这不像一条完整链接` **0**；`POST /os-v2/api/viral-video-replication/quote` 未登录 **401**（路由在、需登录）。
- 页面级验收：测试实例真实浏览器（桌面 1440 + 移动 390，CDP `DOM.setFileInputFiles` 真实上传）**42 项 / 失败 2 项**，两项均为权益门禁的**预期结果**（免登录新建租户只带 `lanqi` 权益 → 报价被后端 403 挡下），其余 40 项全 PASS。
- 备份/回滚：`/opt/baolu-backups/20260914-lq29-acquire-fixes-prod1-before-baolu-os-v2/`（190M）。回滚 = 还原该备份并 `systemctl restart baolu-os-v2`。
- 未跑（既有边界）：生产页面级浏览器验收——生产 `/lanqi/acquire*` 需真人微信扫码登录，自动化停在 `/os-v2/login`（同 LQ-22 / LQ-28）。
- **未闭环（需老板拍板，属权限 / 计费口径变更）**：前端放开按钮后仍拿不到报价——`apps/api/src/routes/viral-video-replication.ts` 的 `context()` 只认 `beauty-industry` active 权益，而兰琪租户只带 `lanqi`（生产只读实测：active 权益 `lanqi=9` 中仅 2 个同时持 `beauty-industry`，均为 2026-08-24 历史租户）。二选一：① 给在用兰琪租户补 `beauty-industry` 权益；② 放宽 `/viral-video-replication/*` 接受 `lanqi` 权益。另需确认在用的兰琪租户（可能与历史素材租户不是同一个）。
- 残留（非功能、无运行影响）：`/opt/baolu-os-v2/apps/web/dist/assets/` 未随发布清理，仍有 2026-09-12~14 的历史 `LanqiAcquireVideoPage-*.js` 残留（当前共 1044 个产物文件）；`index.html` 只引用新产物，旧 chunk 不在加载图里（`这不像一条完整链接` 只出现在 3 个已下线的旧 chunk 中）。

## 最新发布：20260914-zd7b-recharge-mcp（2026-09-14，测试实例 + 生产）— 充值页 WorkBuddy 区块改为可直接复制的 MCP 接入指令

- 发布包 `release-20260914-zd7b-recharge-mcp.tar.gz`（9,601,340 B，sha256 `9d40f32be07a98e6e466ce3893ece9f2f246d05c72bbfdc602b17428c2b26be5`，1510 文件）。从「只含本提交」的干净快照打包，未夹带并行兰琪线程的在途改动（已核对包内 `LanqiAcquireVideoPage.tsx` 逐字等于 HEAD）。
- 内容：充值页「WorkBuddy 访问令牌」（计费令牌）UI 换成「在 WorkBuddy 里接入思潼 AI」——一段可直接复制给 WorkBuddy 的 MCP 安装指令 + 「📋 复制安装指令」按钮；首次点击会按当前账号生成一条 `sitong_wb_` 专属连接，把 MCP 地址 + 密钥拼进指令一起复制（不再让用户手动改 JSON，也不会再用错计费令牌）。
- 测试实例 `20260914-zd7b-recharge-mcp-test1` / 生产 `20260914-zd7b-recharge-mcp-prod1`：均 `DEPLOY_OK` + `verify-deploy.sh` **VERIFY_OK**；生产产物核对 `请帮我在 WorkBuddy 中接入`=1、`integrations/workbuddy/mcp`=1、`复制安装指令`=1、旧 `WorkBuddy 访问令牌`=0；`journalctl -p err` 无条目。
- 备份/回滚：`/opt/baolu-backups/20260914-zd7b-recharge-mcp-prod1-before-baolu-os-v2/`（189M）。回滚 = 还原该备份并 `systemctl restart baolu-os-v2`。

## 最新发布：20260914-zd7-platform（2026-09-14，测试实例 + 生产）— 样例修复上线（文案「内容十件套」/ 视频复盘「深度复盘」/ 直播话术完整样例）+ 平台底座抽取重构 + 客户端拖拽上传/去前置报价

- 发布包 `release-20260914-zd7-platform.tar.gz`（9,600,317 B，sha256 `8084b8cd0103b018ebc5b7353a86befebdfb159429d4999ac0746905ca6f94dc`，1510 文件；canary `marketplace-v3.json` = `1dd5b672…`）。
- 内容：① 货架输出参考样例恢复到修复版——文案智能体「内容十件套（十栏全展开）」、视频复盘「深度复盘 · 完整报告样例（第零章数据质量审计 + 十章全文）」、直播话术「招商场景完整样例（2 小时连续逐字稿）」；② 客户端「对话框拖拽上传」与「去掉使用前前置报价」恢复；③ 「平台底座抽取」路由重构（`server.ts` 产品路由 → `products/register.ts`；`main.tsx` 兰琪路由 → `routes/lanqi.tsx`；`MarketplaceApp.tsx` 拆 5 组件 + `sku-model` + `shell`；`auth.ts` 拆 schemas/helpers）。
- 测试实例 `20260914-zd7-platform-test1`：`DEPLOY_OK` + health/ready 200；`verify-deploy.sh` **VERIFY_OK**；产物核对 `内容十件套`=4、`深度复盘`=10、旧 `单条视频复盘`=0、`onDragOver`=1。
- 生产 `20260914-zd7-platform-prod1`：`DEPLOY_OK` + health=200 (after 15s) / ready=200；`verify-deploy.sh` **VERIFY_OK**；产物核对同测试（`内容十件套`=4、`深度复盘`=10、旧 `单条视频复盘`=0、`约扣`=0）；`journalctl -p err` 近 10 分钟无条目。
- 备份/回滚：`/opt/baolu-backups/20260914-zd7-platform-prod1-before-baolu-os-v2/`（189M，含 app-before + db-before）；回滚 = 还原该备份并 `systemctl restart baolu-os-v2`。
- 说明：本轮修复了 9-14 兰琪发布时把 marketplace 相关文件按服务器旧版保留、导致样例修复未上线的问题。
- 已知残留：美业专区专属样例 `meiye__copy` 仍是旧版短样例（本次未改；属行业专属样例，待确认是否换成新格式）。

> **已收口（2026-09-14）**：`20260913-lq27-nav-online-prod1` 已部署生产（`DEPLOY_OK` + health 200 / ready 200；marketplace canary `1dd5b672…` 一致）；测试实例品牌导航浏览器 E2E **0 failed**（桌面 1440 + 移动 390：侧栏恰好 8 项、其中 6 项带「开发中」徽标，「私域营销」「公域获客」不带徽标；公域获客枢纽/爆款复刻按已上线页验收；驾驶舱等 6 个未上线板块仍占位；无横向溢出、应用侧 console 0）。已知：其他任务在途 `apps/web/src/marketplace/livescript-full-case.ts`（重复定义 + 语法错误）仍会让 `qa:fast` 的 web 步骤失败，属既有失败（非本任务改动），待相关任务修复。
## 最新发布：20260914-lq28-self-material-v2（2026-09-14，测试实例 + 生产）— 爆款复刻取消「搜索爆款」，改门店自备素材

- 发布包 `release-20260914-lq28-self-material-v2.tar.gz`（9,515,966 B / 1493 文件，sha256 `170d6fbf4d645c4dbd3998175fbc7683d4975e23fe9beae396e33ed9fdd1712a`；canary `marketplace-v3.json` = `1dd5b672…` 校验通过）。
- 内容：整条「搜爆款」检索能力下线（`apps/api/src/routes/lanqi-viral-search.ts`、`apps/api/src/products/lanqi/viral-search-{service,rules}.ts`、`scripts/lanqi-viral-search-contract-smoke.ts` 删除，`server.ts` 去注册，`env.ts` 去 `LANQI_VIRAL_SEARCH_*` 五项与生产校验，`package.json` 去 `lanqi:viral-search-smoke`）；页面 `LanqiAcquireVideoPage.tsx`（爆款复刻）改三段式自备素材：「🔗 参考抖音链接 / 🎬 上传参考视频」两页签 → 人物形象 → 素材与肖像授权 → 报价 → 确认 → 轮询 → 播放下载（沿用 LQ-27 计费与幂等）。详见 `docs/BUG_REGRESSIONS.md` QA-20260914-003。
- 发布方式：因工作树混有其他任务在途改动，用 `scripts/tmp/lq28-build-override.mjs` 生成「只含 LQ-28 差异」的 1493 文件清单 + 36 份生产同版覆盖文件（生产上 PLAT-28 的 `referral-*.ts` 三文件排除、保持原字节不变）。
- 测试实例 `20260914-lq28-self-material-test2`：`DEPLOY_OK` + 健康 200；真实浏览器页面级验收 **33 项 / 失败 0**（桌面 1440 + 移动 390）。
- 生产 `20260914-lq28-self-material-prod1`：`DEPLOY_OK 20260914-lq28-self-material-prod1`，`health=200 (after 15s)` / `ready=200`；删除清单 4 条 `viral-search*` 实测全部 `removed`；`prisma migrate deploy` = `50 migrations found` / `No pending migrations to apply.`；`POST /lanqi/acquire/video/viral-search` 发布前 **401** → 发布后 **404 `Route … not found`**；线上入口产物 `assets/LanqiAcquireVideoPage-Cp5WhOXM.js`（`index-_gkj3AXg.js` 引入）内 `平台筛选`/`行业领域`/`lq-vd-kw`/`viral-search` 命中 **0**。
- 备份与回滚：`/opt/baolu-backups/20260914-lq28-self-material-prod1-before-baolu-os-v2/`（189M：`app-before.tar.gz` + 生产 env）；回滚＝还原备份目录 + `systemctl restart baolu-os-v2`，或重新叠加上一包 `release-20260913-lq27-nav-online.tar.gz`。
- 残留（非功能、无运行影响）：`apps/web/dist/assets/` 下有 21 个 2026-09-12~14 的历史 `LanqiAcquireVideoPage-*.js` 构建残留与 `apps/api/dist/.../viral-search*.js`（overlay 不删 dist）；当前 `index.html` 只引用新产物，旧 chunk 不在加载图里。如需彻底清掉「产物里还能 grep 到」的疑虑，需单独授权做一次 dist 清理（属删除型操作）。
- 未跑（既有边界）：生产页面级浏览器验收——生产 `/lanqi/acquire*` 需真人微信扫码登录，自动化脚本停在 `/os-v2/login`（同 LQ-22）。

## 最新发布：20260913-lq27-moments-patch-v2（2026-09-13，测试实例 + 生产）— 朋友圈「补数字」交互 + 占位符前后端统一 + 爆款复刻定价 24 积分/秒

- 发布包 `release-20260913-lq27-moments-patch-v2.tar.gz`（9,573,861 B，1498 文件；canary `marketplace-v3.json` = `1dd5b672…`）。
- 内容：朋友圈结果卡片新增「✏️ 补数字」就地交互（示例：护理 40 分钟 / 清洁三遍 / 体验课参考价 99 元；红线：不写效果数字），占位串统一为「【这里补一个真实数字】」（push ×2 + 模型提示词 + 规则检测 + 前端四处一致，QA-20260913-011）；爆款复刻定价拍板 **对外 ¥1.2/秒 = 24 积分/秒**（成本 ¥0.6/秒），生产 env `ALIYUN_VIDEO_REPLICATION_CREDITS_PER_SECOND=24`（运行进程实测生效）。
- 测试实例 `20260913-lq27-moments-patch-v2-test1`：`DEPLOY_OK` + 健康 200；真实浏览器补数字探针 **14/0**。
- 生产 `20260913-lq27-moments-patch-v2-prod1`：`DEPLOY_OK` + 健康 200 / ready 200；源码/dist 均含新占位串与按钮标记；服务进程环境实测 `CREDITS_PER_SECOND=24`。
- 说明：前一包 `release-20260913-lq27-moments-patch-pricing`（v1）只改前端按钮与规则文案，模型提示词仍用旧占位串导致正文旧串；v2 修复提示词后前后端一致。

## 备份保留策略（2026-09-13 起生效，用户授权）

- 策略：`/opt/baolu-backups/` 按环境（生产 `*before-baolu-os-v2` / 测试 `*before-baolu-os-v2-test`）各保留最近 **8 份**（按目录修改时间倒序），其余删除；删除清单写入 `$ROOT/.retention-deleted-<时间戳>.log`。
- 脚本：`/opt/baolu-backups/retention.sh`（mtime 排序，幂等，重复运行不再多删）。
- 首轮执行（2026-09-13）：删除 60 份过期备份，释放约 10.6G（磁盘 100% → 12G 可用 / 60%）。首轮按目录名排序误删了几份当日回滚点（含 `lq27-acquire-board-prod1` 的 before 备份；该发布仍有 `/opt/releases` 归档 + git `5ae4d52`，且已补做当前健康态基线）。
- 当前基线：`/opt/baolu-backups/20260913-post-lq27-board-baseline-before-baolu-os-v2`（194M：app 代码包 + 生产 env + db dump），作为今日全部发布后的统一回滚点。
- 注意：常规回滚不依赖 before 备份（历史积压）；缺少 before 备份时回滚 = 还原基线 + 重新叠加目标 release 包。

## 最新发布：20260913-lq27-acquire-board（2026-09-13，测试实例 + 生产）— 兰琪公域获客板块验收放开 + LQ-27 爆款复刻真样片链路修复

- 发布包 `release-20260913-lq27-acquire-board.tar.gz`（9,558,110 B，1495 文件；canary `marketplace-v3.json` = `1dd5b672…`，与 20260913-zd5-storefront-ux 同代同哈希）。
- 内容：`LANQI_ACQUIRE_LAUNCHED=true` 放开 `/lanqi/acquire*`（经营驾驶舱仍按 `LANQI_MOMENTS_ONLY_LAUNCH` 占位）；直播话术偶发 422 段级重写修复；LQ-27 出片链路 OSS 传输层 / 结果主机族 / http→https / 样本清理时序修复（QA-20260913-008/009/010）。
- 测试实例 `20260913-lq27-acquire-board-test1`：`DEPLOY_OK` + 健康 200；页面级验收 **30/0**、API 真实模型走查 **17/17**。
- 生产 `20260913-lq27-acquire-board-prod1`：`DEPLOY_OK` + 健康 200 / ready 200；生产只读接口验收 **16/16**；线上源码含 `LANQI_ACQUIRE_LAUNCHED=true` 与三项修复标记。
- 同日先行修复：`20260913-lq27-oss-live-fix-prod1`（OSS transport）与 `20260913-lq27-result-hosts-fix-prod1`（结果主机放宽 + env 基域，定点源码覆盖 + 服务端单包构建 + 重启；该两包不含 UI 放行，仅修复链路）。
- 待老板拍板：爆款复刻正式积分定价（样片成本 ≈ ¥1.80/条，wan-std ¥0.60/秒；临时 600 积分仅为报价占位）。

## 最新发布：20260913-zd5-storefront-ux（2026-09-13，测试实例 + 生产）— 货架三项 UI 口径 + PLAT-25B 标题体系

发布包 `release-20260913-zd5-storefront-ux-full.tar.gz`（9,562,900 B，sha256 `19bdf5faaf898deac491a3bcd5cec52811a35ffd3fd850fab9d7452eb93cab05`，1495 文件；`marketplace-v3.json` 新哈希 `1dd5b672…`）。

| 环境 | 目录 / 服务 / 端口 | 发布 id | 结果 |
| --- | --- | --- | --- |
| 测试 | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | `20260913-zd5-storefront-ux-test2` | `DEPLOY_OK`（health=200 after 18s / ready=200）+ `VERIFY_OK`（skus 19 / coming_soon 13 / lanqi_brain present / 双 vidrev selling） |
| 生产 | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | `20260913-zd5-storefront-ux-prod1` | `DEPLOY_OK`（health=200 after 15s / ready=200）+ `VERIFY_OK` + 生产功能探针 PASS + `platform-route-browser-e2e` **24/24** + `journalctl -p err` 近 25 分钟无条目 |

内容：① 智能体页去掉「按次交付」表述；② 兰琪专区→「品牌工作台」，首个产品「兰琪美业门店经营大脑」；③ 平台搜索专区级命中（搜「美业」带出美业专区并隐藏无关待上线专区）；④ PLAT-25B chat 页标题体系（浏览器 `<title>` = 智能体名 · 专区名）。发布后生产实测：搜「美业」→ 货架 `美业专区 + 品牌工作台`、卡片无「按次交付」、详情页价卡无「按次交付」、控制台 0 错误。

**过程中的一次失败（磁盘满，已自动回滚，后成功）**：测试环境首次部署 `…-test1` 在 step 9 因 PostgreSQL `53100 No space left on device` 启动失败，部署脚本按设计自动回滚（服务恢复 active）；根因是部署瞬间 segment+备份把磁盘挤满（期间服务器定时任务清掉了 stage 释放空间）。处置：按库内 `scripts/tmp/server-disk-cleanup.sh` 清理 /tmp 传输产物 + 删除遗留 scratch stage `20260913-lq27-acquire-board-test1`（388M）后，`…-test2` 与 `…-prod1` 一次成功。**磁盘压力提示**：`/opt/baolu-backups` 已占 12G（30G 盘），建议后续单独任务评估备份保留策略或扩容。

备份与回滚：`/opt/baolu-backups/20260913-zd5-storefront-ux-{test1,test2,prod1}-before-<app>/`（含 app-before.tar.gz、db-before.sql.gz、env、dist-hashes）；回滚＝还原对应备份目录并 `systemctl restart baolu-os-v2(-test)`（既有流程）。



## 未发布小批（2026-09-13）：微信支付运行时读密钥探测（QA-20260913-001 加固）

`/ops/wechat-pay-check` / `/ops/launch-check` 新增 `probeWechatPayRuntimeKeys()`（真实读取商户私钥与平台公钥，复用支付路径读取函数）；生产且支付必需时 `/ready` 新增 `wechat_pay` 检查，密钥文件不可读/解析失败会 503 红灯。契约 smoke 14 条断言 PASS，`qa:fast` exit 0。未发布，待与后续批次一起打包。

## 本批改动详情（已随 20260913-zd5-storefront-ux 上线，见上方发布记录）

三项货架 UI 口径改动：

1. **去掉「按次交付」表述**：货架卡片价签与详情页定价卡不再显示「按次交付 / 扣 N 积分 / ≈ ¥」（详情按钮只剩「直接开始」），与 PLAT-31「不前置报价」口径一致。
2. **兰琪专区 → 品牌工作台**：`marketplace-v3.json` 的 `industries.lanqi.title` 改为「品牌工作台」，`lanqi-brain` 产品名改为「兰琪美业门店经营大脑」（品牌工作台当前唯一产品）。
3. **平台搜索专区级命中**：搜索时空闲时不再展示无关的「待上线」专区占位；搜「美业」直接把美业专区（及其 SKU）整组带出（`zoneHits` 匹配专区名/标语/前缀）。

验证：本地浏览器实测货架搜索（美业 → 美业专区 + 品牌工作台、占位专区隐藏）、详情页无「按次交付」、`marketplace:foundation-smoke` / `marketplace:api-smoke` / `marketplace:shelf-browser-e2e`（`MP_E2E_RUN_CHAT=false`）PASS、`pnpm qa:fast` exit 0。未发布未提交；发布按批次打包待总调度决策（工作树混有多个未提交批次）。


## 最新发布：20260913-remove-legacy-diagnosis（2026-09-13，测试实例 + 生产）— 清除旧版「9 轮经营诊断」页

用户 2026-09-13 报障并给出复现路径：复制已登录网址新开标签页 → 显示未登录 → 点登录 → 落到旧诊断页（Ubuntu… 地址栏停在 `/os-v2/login`，页面是「免费经营体检 / 单项快速诊断 / IP诊断 / 第1轮 共9轮」），要求清除。

根因：`main.tsx` AppFlow 的残留分支 `token && diagnosisDone ? "main" : token ? "diagnosis" : "login"` —— 有 token 且 `store_os_diagnosis_done ≠ "true"` 时，**任意流程页都会被渲染成旧诊断页**；每次登录又把它写回 `"false"`，于是反复触发。

修复：删掉 AppFlow 的诊断阶段（有 token 直接进主界面）；`/diagnosis`、`/d/` 老链接重定向到 `/agents`；清掉 `FlywheelDiagnosisApp` 引用、`handleReDiagnosis` 与 5 处「写回 false」。**没有**加「`/login` + token 直接弹回货架」的保险——那会复活 QA-20260910-018 登录死循环（被 `product-login-entry-smoke` 拦下后撤掉）。

| 环境 | 目录 / 服务 / 端口 | 发布 id | 结果 |
| --- | --- | --- | --- |
| 生产 | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | `20260913-remove-legacy-diagnosis` | `DEPLOY_OK` + `VERIFY_OK` + 复现探针转绿（旧页文字 false；`/diagnosis` → `/agents`） |
| 测试 | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | 同上 | `DEPLOY_OK` + `VERIFY_OK` |

回归：`platform:route-contract-smoke` 口径改为「旧诊断已下线 + 老链接重定向 + 不得复活」→ **101 passed / 0 failed**；`product-login-entry-smoke` PASS；`qa:fast` exit 0。发布包 `release-20260913-remove-legacy-diagnosis-full.tar.gz`（sha256 `003ae33b…`，1492 文件）。缺陷登记 **QA-20260913-006**；残留的不可达旧组件（`FlywheelDiagnosisApp` 等）等物理删除的独立任务处理。

**同日后续（2026-09-13 02:0x–02:1x，用户指令，无代码发布）**：

- **手机支付真人验证通过**：用户在手机微信内充值 → 直接弹出微信收银台（未扫码）→ ¥50 支付成功，订单 `cmtz4trww05dqxtez2ncm61yc` `paid` 09:25:31、钱包 +1000（QA-20260913-003 可关闭）。
- **「不满意重做」按用户口径先保留**（以后再取消该功能）：本批不改规则，四个候选口径留在 QA-20260913-004 等后续指令。
- **第二次清理历史微信绑定**（为推荐归因真机验收铺路）：备份 `/opt/baolu-backups/20260913-wechat-identity-clear-2/`（`wechat-identity-before.csv` 2 行 + `rollback.sql`），清空后 `users_with_openid=0`；同时清掉浏览器 E2E 留下的合成归因测试数据（1 条 binding + 其租户/用户/钱包），`ReferralBinding` 回到 **0 行**、各推荐码 `usedCount` 归零。
- **发链接前的生产自测**：用链接 B（`ref-1tckrmyfcuc5`）在同一生产链路跑通「带码注册 → 归因落库」（推荐人＝保禄ip账号、`source=platform_onboarding`），随后清理，残留 0。

## 最新发布：20260913-dragdrop-outer / 20260913-no-preprice-dragdrop（2026-09-13，测试实例 + 生产）— 客户界面不再使用前报价 + 对话框支持拖拽上传（PLAT-31）

用户 2026-09-13 两条口径，均已实现上线：

1. **「文字类智能体每次使用都要告诉扣多少积分，感受不好」** → 去掉**使用前**的扣积分文字，只在**交付完成后**告知本次消耗。去掉：货架卡片 `N 积分/次`、详情页价格块与「用一次 · 扣 N 积分 / 开始第 1 步 · 扣 N 积分」按钮、分步每步 `N 分`、按结果付费里的「不重复扣积分」、匿名引导「每生成一次扣 N 积分」、确认气泡「约扣 N 积分」、重做用尽「会按次扣 N 积分」。保留：聊天页 `本次消耗 {cost} 积分`（交付后）、Word 导出价格与「本次导出需 N 积分」、积分不足提示、失败路径「本次未扣积分」、充值页真实金额。
2. **「要支持文件直接拖拽进浏览器的对话框里（目前不支持）」** → 拖拽区挂在**整个对话框容器**上（多文件、拖拽提示、可移除），并新增粘贴文件；**文本类附件（txt/md/csv/tsv/json/log/srt）会真的读进需求单**（`【附件：文件名】` 拼进 `input`，2 万字上限），其它类型明确提示「暂不能自动读取，请粘贴关键内容」。

| 环境 | 目录 / 服务 / 端口 | 发布 id | 结果 |
| --- | --- | --- | --- |
| 生产 | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | `20260913-no-preprice-dragdrop` → `20260913-dragdrop-outer` | 两次 `DEPLOY_OK` + `VERIFY_OK`；真实浏览器原生拖拽探针 **通过**（拖真实 CSV → `📎 后台数据.csv（已读取）`）；详情页前置报价断言全 false |
| 测试 | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | 同上 | `DEPLOY_OK` + `VERIFY_OK` |

契约与回归：`marketplace-credits-only-contract-smoke` 把原先「必须出现前置报价」的 4 条断言改成**反向断言**（前置报价再回来就红），并新增拖拽 5 条断言 → **24 passed / 0 failed**（先红：改代码后旧断言先红 4 条）；`qa:fast` exit 0；`@baolu/web typecheck` exit 0。发布包 `release-20260913-no-preprice-dragdrop-full.tar.gz`（sha256 `21009997…`）与 `release-20260913-dragdrop-outer-full.tar.gz`（sha256 `defaac89…`）。任务卡 `docs/agents/platform-tasks.md` **PLAT-31**。

**当日支付复核（用户账号真实流水）**：`cmtz4trww…` ¥50 → `paid`（09:25:31），钱包 `1950`；两笔真实充值（08:45、09:25）与两笔扣费（文案 40、导出 Word 10）全部与流水一致。观测缺口：支付回调写 metadata 时会覆盖预下单写入的 `wechatTradeType`，**事后无法从库里区分这笔是微信内 JSAPI 还是扫码**；建议后续把回调改成 merge 而不是覆盖（未做）。

## 最新发布：20260913-mobile-pay-referral-fix（2026-09-13，测试实例 + 生产）— 手机微信内支付改走 JSAPI + 推荐归因两处断点补上

用户真机反馈两件事，都已修复上线：

1. **手机端付不了款**（QA-20260913-003）：充值页写死 `tradeType: "native"` 只出二维码，用户无法扫自己屏幕、长按识别又被微信拒绝。修复：微信内置浏览器 → **JSAPI 直接拉起收银台**（`WeixinJSBridge.getBrandWCPayRequest`），电脑/普通浏览器 → 仍用二维码，拉不起时回落并给明确文案。生产实测（用户账号 + 真实微信 UA）：请求体已变成 `{"tradeType":"jsapi"}`，接口返回完整收银台参数（appId/nonceStr/package/paySign/signType/timeStamp）。
2. **带推荐码注册但归因没落**（QA-20260913-002）：nginx 日志逐跳取证——`/login?ref=…` → 货架点登录 → `/login`（**query 丢弃**）→ 微信回调 state 无码 → 补资料页无码 → 提交时无码。服务端与带码链路本身正常（真实浏览器 E2E 已跑出归因）。修复：**码进微信 `state`** + **所有「去登录」跳转自动带码**（`loginPathWithPendingReferral`）。

发布包 `release-20260913-mobile-pay-referral-fix-full.tar.gz`（9526550 B，sha256 `e62f7a24367d0eb573e0f14f5460bd8a8c2c5049abf69cbf3fd2e1c32fee3425`，1488 文件）。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 生产 | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | https://api.lcppch.top/os-v2/ | `20260913-mobile-pay-referral-fix` | `DEPLOY_OK` + `VERIFY_OK` + 真实微信 UA 探测（请求 jsapi ✓ / 收银台参数 ✓） |
| 测试 | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | https://api.lcppch.top/lanqi-test/ | `20260913-mobile-pay-referral-fix` | `DEPLOY_OK` + `VERIFY_OK` |

回归：`auth:product-login-smoke` 新增 7 条断言（jsapi / WeixinJSBridge / native 兜底 / state 带码 / 回调还原 / 站内跳转带码）；`qa:fast` exit 0。线上产物：`RechargePage-*.js` 含 `getBrandWCPayRequest`、`LoginPage-*.js` 含 state 带码、`MarketplaceApp-*.js` 含带码登录跳转。

**待用户拍板：免费重做被当薅羊毛通道（QA-20260913-004）**。证据：用户账号流水 `-40 consume ipzone__copy` → `0 redo ipzone__copy`（免费第二份）。四个候选口径：

| 方案 | 做法 | 代价 |
| --- | --- | --- |
| A 重做替换原稿 | 重做后旧交付物不可再复制/导出，只留历史快照 | 需约定"导出配额随交付走" |
| B 重做须说明原因 | 必须勾选问题类型（可选填一句）才能重做 | 只是提高滥用成本 |
| C 重做打折收费 | 例如 40 → 20 积分 | 弱化"不满意可重做"的原有承诺 |
| D 月度免费重做上限 | 每账号每月 N 次，超出按 C | 规则稍复杂，但可解释 |

建议 **A + B（必要时叠加 D）**：保留"不满意可重做"的承诺，同时让第二份不再是可以自由使用的额外成品。等用户选定后实现（改动集中在前端交付物操作与导出入口，以及服务端 redo 校验）。

## 2026-09-13 上午：放行体检发现并修复「微信支付预下单不可用」（仅运维权限修复，无代码发布）

用户当天计划：给客户发链接 → 客户自助注册 → 客户充值积分 → 用智能体（分享奖励留到之后）。放行前做了三段实测体检，注册与用智能体两段正常，**充值一段红灯**：

- 现象：生产 `POST /billing/orders`（pack_50）200 建单正常，`POST /billing/orders/:id/wechat-prepay` **502 `wechat_pay_prepay_failed`**；日志根因 `EACCES: permission denied, open '/etc/baolu-secrets/wechatpay_apiclient_key.pem'`。
- 根因：**`/etc/baolu-secrets` 目录权限在 2026-09-12 18:56 被改成 `drwx------ root root`**（此前 `755`）。服务以 `User=admin` 运行，systemd 读 EnvironmentFile 不受影响，因此 `/ready`、`/ops/wechat-pay-check` 都显示配置齐全，只有运行时读 PEM 的支付路径会失败。
- 修复：`chown root:admin /etc/baolu-secrets && chmod 750 /etc/baolu-secrets`（比原 755 更严；服务用户可读，其他用户不可读不可列）。修复后实测：预下单 **200 + 真实 `weixin://wxpay/bizpayurl?p…`**；0 积分用智能体 **402 `insufficient_credits`**（含充值引导）；`billing:paid-order-wallet-smoke` **PASS**（付款进用户钱包 paid/bonus 双桶）；合成验收数据清理后残留 0。
- 顺带查清历史疑点：2026-09-12 「真实 ¥1 付款后未入账」的那单是**通道验证用合成订单**（`pay-verify-channel-tenant`，无 userId、无 creditPackCode），不满足入账条件（`credit_pack` 入账要求 userId + pack code），与本次故障无关（详见 `docs/BUG_REGRESSIONS.md` QA-20260913-001）。
- 待用户拍板：给 `/ops/wechat-pay-check` 增加「运行时实际读取私钥/平台公钥」探测，并把 `WECHAT_PAY_REQUIRED=true`（让支付不可用时 `/ready` 直接红灯）。

当日放行结论（发放链接前）：**可发**；在售 SKU 6 个（创始人IP专区与美业专区各自的 IP定位 200 / 文案 40 / 视频复盘 60），其余 13 个仍标「开发中」；人工发体验额度默认停用（需要送积分要先在 `/agents/admin` 打开该开关）；推荐有礼只落归因、不发奖（第②批未上线）。

**当日真人端到端验收（生产，用户本人账号，2026-09-13 08:42–08:49）**：

| 步骤 | 证据 |
| --- | --- |
| 注册 | 新用户 `cmtz3atc905bl9axxjymwezyr`（08:42:37）+ 新工作区「杨萋萋」（08:42:46），`/auth/wechat-login` 与 `/auth/onboarding/create-workspace` 均 200 |
| 充值 | 订单 `cmtz3eguh05dc9axxu3v842ei`（pack_50 / ¥50 / 1000 积分）→ `paid` 08:45:40；`POST /billing/wechat/notify` 正常处理 |
| 入账 | 用户钱包 paid 桶 **+1000**，流水 `type=recharge, bucket=paid`（08:45:40） |
| 用智能体 | `POST /market/skus/ipzone__copy/run` 08:49:40 → 扣 **40** 积分，流水 `type=consume, skill=ipzone__copy`；余额 **1000 → 960** |
| 健康 | 近 10 分钟 `journalctl -p err` **无条目**；服务 active、`/health` 与 `/ready` 均 200 |

结论：**注册 → 充值 → 入账 → 用智能体扣费 全链路在真实微信 + 真实付款下跑通**，可以开始给客户发链接。注意：用户本轮先后建了两张 ¥50 订单，第一张 `cmtz3chz105d59axxnzlm2n8y` 未付款（仍 pending，会自动过期，无需处理）。

## ✅ `/my-ai` 路由 E2E 红灯已关闭（2026-09-13 总调度5，产品无问题、测试脚本修复）

- 结论：**产品行为正常**——匿名访问 `/my-ai` 被带到登录页（该页需要会话）是预期；红灯是测试脚本「断言过时 + 采集时序脆弱」。
- 根因：E2E 用干净环境（=匿名）访问受保护页，客户端路由先闪过中间态再 `replace` 到 `/login`；旧 `openPath` 等首屏有字后固定只观察 1.2 秒，正好落在「旧 DOM 卸载、新文档还没渲染」的空窗，抓到空 body 报成 `len=0`；且旧断言没把「落到登录页」当作合法结果。
- 修复（`scripts/platform-route-browser-e2e.mjs`，与其余平台批次同在未提交工作树）：① `openPath` 改为等到终态页面渲染出正文（最多 15 秒）再快照，不再抓跳转空窗；② 登录判据放宽为「`pathname` 以 `/login` 结尾」或页面出现「微信一键登录」即视为通过，保留反向断言（不得是兜底页、不得串产品、控制台 0 error）。
- 验证（2026-09-13，总调度5）：
  - 生产匿名：`PLATFORM_ROUTE_WEB_URL=https://api.lcppch.top/os-v2` → **24 passed / 0 failed**；`/my-ai` 明细「匿名 → 落在登录页（该页需会话，属预期）」，控制台 0 error。
  - 本地登录态（`VITE_DIRECT_TEST_LOGIN=true` + 本地 API 3011 + vite 5174）：**24 passed / 0 failed**；`/my-ai` `render_len=143`（真实渲染工作台）、`/agents/clipper` `pathname=/agents/clipper`（登录态不落登录页），控制台 0 error。
- 历史定位（原第③步）：git 历史显示 `/my-ai` 的登录守卫在 4054f59（LQ-23，09-12 10:06）的父提交里就已存在，早于 13:0x 全绿那次运行——**没有哪次并行发布改变匿名行为**，13:0x 全绿只是当时抓到了中间态文本；6f0e2e5（同日 15:48 登录过渡页 1.5s 兜底）改变的是登录页过渡时序，不是产品回归。

更新时间：2026-09-13（最近一次为 **总调度5：`/my-ai` 路由 E2E 红灯收口**；其下为 **PLAT-31**、**QA-20260913-001~006 系列**、**2026-09-12 的 PLAT-28/29 推荐有礼与样例系列**）

## 最新发布：20260912-plat31-referral-carry-contrast（2026-09-12，测试实例 + 生产）— 推荐码跨授权往返不再丢 + 平台登录页输入框可读性修复

用户 2026-09-12 真机反馈两件事，都已修复上线：

1. **「填了品牌名，字体太浅 看不清」**（QA-20260912-021）：平台登录页「完成注册」表单实测为「深底深字」——输入文字 `rgb(18,32,58)`（亮色主题的 `--text` 深蓝）落在近黑底色 `rgba(9,13,20,.8)` 上，对比度 **1.23:1**（要求 ≥4.5:1）。修复：`.loginPage:not(.productLoginPage) .loginForm` 固定深底浅字（`#f2f2f4`）+ `-webkit-text-fill-color`（防微信/安卓强制深色模式改色）+ placeholder/标签提对比度。修复后实测文字对比度 ≈ **15:1**、标签 ≈ 11:1、placeholder ≈ 7:1。
2. **「带推荐码注册成功但归因没落」**（QA-20260912-022）：老板 19:52 真机注册成功（用户 204→205、工作区「蓝册」211→212），但 `ReferralBinding` 为 0。**先在生产复现证明服务端是对的**：合成用户 + 合法 onboarding token 走 `/auth/onboarding/create-workspace` 带码 → `state=bound`、归因落库（随后按 id 清理，残留 0）。根因在前端：推荐码只存 `sessionStorage`，微信授权往返 + 回调 `replace("/login")` 丢 `?ref=` 两件事叠加后码就没了。修复：新增 `lib/pending-referral.ts`（session + local 双写，24h TTL），两条补资料回跳路径的 URL 继续带 `ref=`；注册成功后清码。

发布包 `release-20260912-plat31-referral-carry-contrast-full.tar.gz`（9516529 B，sha256 `445b40caf59279c9b4b38af139571e1d8a7168a6f673e185c8982a0514c8ef78`，1487 文件）。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 生产 | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | https://api.lcppch.top/os-v2/ | `20260912-plat31-referral-carry-contrast` | `DEPLOY_OK` + `VERIFY_OK` + 对比度实测 **15:1** + 样例/提示/推荐码探针 **17/17 PASS** |
| 测试 | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | https://api.lcppch.top/lanqi-test/ | `20260912-plat31-referral-carry-contrast` | `DEPLOY_OK` + `VERIFY_OK` |

回归：`auth:product-login-smoke` 新增 7 条断言（输入框浅字 / `-webkit-text-fill-color` / 标签颜色 / 双保险模块 / 两条回跳带 `ref=`）→ PASS；真实浏览器探针扩到 **17 项**（两个完整样例 10+11 栏目、老账号提示、推荐码双保险 session+local）→ 本地与生产**均 0 failed**；`qa:fast` exit 0。文档：缺陷 **QA-20260912-021 / 022**；任务卡 PLAT-29 第二轮与 PLAT-30（新增「发布后删自己的 stage」条目）。

**同轮磁盘处置（重要）**：发布后 `/` 到 **97%（968M 可用）**。在确认**无部署进程在跑**后，清理了 `/opt/baolu-stage/*` 全部历史构建暂存（**5.0G → 4.0K**，可从包重建，不是回滚资产），`/opt/baolu-backups` 9.1G **原样未动**；清理后磁盘 **79%（5.9G 可用）**，两侧服务仍 active、health 200。这也是 PLAT-30 新增第 5 条（发布成功后自动删自己的 stage）的直接依据。

**待用户决定（未执行）**：老板 19:52 那次真实注册（工作区「蓝册」）没有归因行。① 用另一个尚无工作区的微信重测（修复已上线，证据最干净）；② 用户批准后按证据人工补录该条归因（metadata 标注 backfill；活动窗尚未开始，不产生奖励）。

## 上一轮：20260912-plat29b-full-samples（2026-09-12，测试实例 + 生产）— 输出参考案例改成**完整交付物全文** + 老账号带推荐码提示

用户 2026-09-12 晚两条口径：①「**输出样例就是完整的输出样例，不是概况**」；②「老账号带着推荐码登录时，页面给一句『你已有工作区，推荐关系只在被推荐人首次开通时建立』——**加**」。

改动（均在 `apps/web`，不动提示词 / 扣费 / 路由 / 模型）：

- 新增 `marketplace/content-ten-full-case.ts`：文案智能体样例＝**内容十件套十栏全部展开**（选题策划 / 口播逐字稿（可照读全文，含 0–3 秒钩子分段）/ 访谈话术 3 组 / 拍摄脚本 5 镜号表 + B-roll + 构图 / 拍摄注意事项 / 剪辑 EDL（时间线 + 字幕 + BGM + 转场）/ 发布标题与话题 / 最佳发布时间 / 评论区引导话术 / 投流建议三方案 + 日历 + 待确认项）。
- 新增 `marketplace/vidrev-full-case.ts`：视频复盘样例＝**一份真实深度复盘报告全文**（零、数据质量审计 → 一、数据总览 → 二、视频分层 → 三、内容结构健康度 → 四、单条深拆 TOP3+BOTTOM3 → 五、完播率深层归因 → 六、互动深度分析 → 七、趋势预警 → 八、规律总结 → 九、方法论沉淀 → 十、下个周期选题建议），含全部表格与口径。
- 新增 `lib/referral-notice.ts` + `LoginPage` / `WeChatCallback` 打标 + 货架落地页可关闭提示：老账号带推荐码登录时明确告知「已有工作区不产生推荐关系」；登录页推荐码说明改为「只有首次开通工作区的新账号才会登记推荐关系」。

发布包 `release-20260912-plat29b-full-samples-full.tar.gz`（9502545 B，sha256 `4bec73662546c257045564d8daa1f165eb8e41a6da128d2aaa0ca44eff24b1c6`，1485 文件）。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 生产 | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | https://api.lcppch.top/os-v2/ | `20260912-plat29b-full-samples` | `DEPLOY_OK` + `VERIFY_OK` + 样例/提示探针 **13/13 PASS** |
| 测试 | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | https://api.lcppch.top/lanqi-test/ | `20260912-plat29b-full-samples` | `DEPLOY_OK` + `VERIFY_OK` |

验证：`scripts/tmp/plat28-sample-probe.mjs` 扩到 13 项（文案十栏 + 视频复盘十一章 + 老账号提示可见/可关闭/标记清除），本地与生产**均 13 passed / 0 failed**，控制台 0 错误，截图 `%TEMP%\plat28-samples-*\copy-modal.png` / `vidrev-modal.png`；`marketplace:reference-case-neutral-smoke` PASS（完整样例仍不含行业词，中途因样例出现「到店率」被守护拦下一次后已改词）；`auth:product-login-smoke` 新增 6 条断言 PASS；`qa:fast` exit 0。发布后标记核查（两侧一致）：PLAT-28 三项 + 完整样例两项 + 老账号提示 + LQ-25 + LQ-30 + PLAT-23 + 微信支付验签**全部在线**。缺陷登记 `docs/BUG_REGRESSIONS.md` **QA-20260912-019（第二轮）** 与 **QA-20260912-020**；回滚 `/opt/baolu-backups/20260912-plat29b-full-samples-before-baolu-os-v2{,-test}/`。

**同轮生产数据操作（用户指令，非代码）**：清空 17 个历史微信绑定（`User.wechatOpenid` / `wechatUnionid`），以便用户用新微信完成推荐有礼真机注册验收。备份与回滚：`/opt/baolu-backups/20260912-wechat-identity-clear/`（CSV 17 行 + `rollback.sql`）；用户/租户/会员（204 / 211 / 211）未改动，归因表仍 0 行、推荐码 1 活跃。另为用户补发第二张推荐码 `ref-1tckrmyfcuc5`（码主＝保禄ip 账号），避免用户所用微信正好是原码码主而触发自荐拒绝。

## 上一轮：20260912-plat28d-sample-fix（2026-09-12，测试实例 + 生产）— 货架「输出参考案例」与真实交付契约对齐（PLAT-29）+ 补带 LQ-25

用户 2026-09-12 晚截图报障「**文案智能体的输出样例不对 / 视频复盘的输出样例不对**」（货架详情页「输出参考案例 · 不消耗积分」弹层）。逐条对权威契约后确认是**交付物结构层面**的不符，不是文案风格问题：

- 文案（`ipzone__copy` → `content_plan`）：旧样例是「1 条抖音口播文案（钩子/正文/结尾动作/话题标签）」，真实契约是**分级交付** —— 只要一条文案给「标题+正文+话题（多平台适配）」，要执行包给**内容十件套**（选题策划→口播逐字稿→访谈话术→拍摄脚本→拍摄注意事项→剪辑EDL→发布标题与话题→最佳发布时间→评论区引导话术→投流建议）。
- 视频复盘（`ipzone__vidrev` → `video_data_review`）：旧样例只有「数据/归因/下一条动作」3 行，真实契约是**两种模式同价** —— 快速诊断（判定+3–5 条要点+恰好 1 条立即动作+「补齐数据升级不重复扣费」边界说明）／深度复盘（**第零章数据质量审计 + 十章**，`CHAPTER_LABELS` 权威定义）。

改动仅限 `apps/web/src/marketplace/reference-cases.ts` 两条静态样例（不动提示词、不动扣费、不动路由、不调模型）。发布包 `release-20260912-plat28d-sample-fix-full.tar.gz`（9467268 B，sha256 `10c631c5bf2596e272c8a1cdab4da15a5c2f9f86a64704a5baafcfd82d824e0e`，1479 文件）。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 生产 | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | https://api.lcppch.top/os-v2/ | `20260912-plat28d-sample-fix` | `DEPLOY_OK` + `VERIFY_OK` + 样例探针 **8/8 PASS** + 过期授权探针 **5/5** + 带码登录页探针 **12/12** |
| 测试 | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | https://api.lcppch.top/lanqi-test/ | `20260912-plat28d-sample-fix` | `DEPLOY_OK` + `VERIFY_OK` |

回归证据：新增 `scripts/tmp/plat28-sample-probe.mjs`（打开 `/agents/ipzone__copy`、`/agents/ipzone__vidrev`，点开弹层断言**线上用户真正看到的那段文字**）→ 修复前生产 **4 passed / 4 failed**（缺十件套/第零章+十章等 16 个关键结构词，且旧标题仍在），修复后本地与生产均 **8 passed / 0 failed**；`marketplace:reference-case-neutral-smoke` PASS（通用样例中性守护未被破坏）；`qa:fast` exit 0。线上 entry `index-DE0Qu9i7.js` → `MarketplaceApp-gklPuVgX.js` 内含「内容十件套」「数据质量审计」。缺陷登记 `docs/BUG_REGRESSIONS.md` **QA-20260912-019**，任务卡 `docs/agents/platform-tasks.md` **PLAT-29**。

同包补带并行任务**已提交但生产尚未上线**的 LQ-25（爆款复刻真实检索源）：发布前核查生产 `LANQI_VIRAL_SEARCH_DRIVER` = **0** 处、`routes/lanqi-viral-search.ts` 不存在，发布后两侧均为 **4 处 + 路由存在**。发布后标记总核查：PLAT-28（人工发放闸门/归因服务/配置面板/登录过期修复）+ 新样例两项 + LQ-25 + LQ-30 + PLAT-23 常量 + 微信支付验签 **全部在线**。回滚：`/opt/baolu-backups/20260912-plat28d-sample-fix-before-baolu-os-v2{,-test}/`。

## 上一轮：20260912-plat28c-merged-fix（2026-09-12，测试实例 + 生产）— 过期授权不再锁死注册入口（P1 真机修复）+ 合并重发（PLAT-28 × LQ-30）

**事故与修复的经过（先看这段，再看下面的 §PLAT-28 第①批）**：用户 18:25 用手机微信打开推荐链接做真机验收时，页面停在「完成注册」并连撞 7 次 401 `invalid_onboarding_token`（截图见用户消息）。取证：18:24:52–18:25:20 `POST /auth/onboarding/create-workspace` 7 次全部 401，且**当天 0 次微信授权回调** —— 这次点按根本没走微信授权：手机里残留着 2026-09-11/12 更早一次授权留下的 `store_os_onboarding_token`（服务端签发，30 分钟有效），登录页只看「有没有值」就渲染成补资料形态、把「微信一键登录 / 注册」藏了起来，提交永远撞过期。

修复（P1，已上线）：`LoginPage.tsx` 解析 token 的 `exp`，过期/损坏**当场清掉**并把登录入口还给用户；过期提示改用独立 sessionStorage 标记（React StrictMode 双调用 `useState` 初始化函数会让提示丢失，本地实测踩到）；服务端 401 补中文 message（不再把错误码当文案）。回归：生产真实浏览器探针修复前 **1 passed / 4 failed**（与截图一致）→ 修复后 **5 passed / 0 failed**；源码契约对 `git show HEAD:` 跑同一组断言修复前 5 条全 FAIL；带推荐码登录页探针生产 **12 passed / 0 failed**；生产 API 复核 **6 PASS / 0 FAIL**。缺陷登记 `docs/BUG_REGRESSIONS.md` **QA-20260912-018**。

**并发发布覆盖事故（同轮）**：17:45/17:51 另一条并行任务发 `20260912-lq30-video-budget` 时，用的是**不含 PLAT-28 的包**，把生产/测试的 `routes/marketplace.ts`（人工发放闸门）、`pages/LoginPage.tsx`（推荐码提示）、`pages/MarketplaceApp.tsx`（配置面板）与 `data/marketplace-v3.json` 一起回退；同时把服务器 `/tmp/deploy-release.sh` 覆盖成旧副本（旧 marketplace-v3.json 哈希常量），我随后用新包发布时被这个旧常量在第 4 步拦下（**未改任何文件、服务未动**）。处置：按 PLAT-23 事故的既定做法，**从当前合并后的工作区重新打包**并重传脚本后发布。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 生产 | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | https://api.lcppch.top/os-v2/ | `20260912-plat28c-merged-fix` | `DEPLOY_OK` + `VERIFY_OK` + 过期授权探针 **5/5 PASS** + 带码登录页探针 **12/12 PASS** + 生产 API 复核 **6/6 PASS** |
| 测试 | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | https://api.lcppch.top/lanqi-test/ | `20260912-plat28c-merged-fix` | `DEPLOY_OK` + `VERIFY_OK` |

发布包：`release-20260912-plat28c-merged-fix-full.tar.gz`（9437321 B，sha256 `2d95769e5c82aee1f5807b7611e23b47cc77d3d04d937bf8b0632d1910c48e0e`，1474 文件）。发布后标记核查（两侧一致）：PLAT-28 的 `trial_grant_disabled` / referral 服务与配置面板 / 登录页推荐码提示 / 过期授权修复 **全在**，LQ-30 的 `ALIYUN_VIDEO_REPLICATION_MAX_COST_FEN` **在**（没有被我这轮回退），PLAT-23 常量、微信支付验签、LQ-24 重新生成、`marketplace-v3.json` 新哈希（`8a1f7bb7…`）**全在**。

事故期间数据干净度（只读核对）：17:50–18:45 `WalletLedger` 中 `trial_grant:*` 新增 **0** 条（人工发放虽短暂放开但无人调用），`ReferralBinding` 全程 0 行，两张推荐码未丢（1 活跃 `ref-****v5` + 1 停用）。备份：`/opt/baolu-backups/20260912-plat28c-merged-fix-before-baolu-os-v2{,-test}/`。

## 上一轮：20260912-plat28b-refcode-alnum（2026-09-12，测试实例 + 生产）— 推荐有礼第①批：人工发放默认停用 + 推荐归因 + 配置位后台可读写

用户 2026-09-12 把「思潼AI 推荐有礼」拆成三批，要求一批一件事。第①批只做三件事：**关闭人工发放入口**、**推荐归因**、**10 个配置位后台可读写**（本批**不实际发奖**）。冻结口径（三段奖励 100/100/200、奖励只能用于文字类智能体、bonus 桶 90 天、月无上限只告警、活动窗左闭右开、首充必须真实 paid 且未退款、同一微信只能被推荐一次）全部写进任务卡 PLAT-28 与 `references`，未做任何变更。

发布包：`release-20260912-plat28b-refcode-alnum-full.tar.gz`（9431218 B，sha256 `59d76e808d88869089ce5b6649dfb6efdafd7f698f42dd43642811f255e9b382`，1474 文件，服务器侧逐字一致）。前序包 `release-20260912-plat28-referral-attribution-full.tar.gz`（9428112 B，sha256 `311b44ca…`）已先上两侧，因推荐码字符集修正被替换。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 生产 | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | https://api.lcppch.top/os-v2/ | `20260912-plat28b-refcode-alnum` | `DEPLOY_OK` + `VERIFY_OK` + 生产功能核查 **38 PASS / 0 FAIL** + 登录页带码探针 **12 PASS / 0 FAIL** |
| 测试 | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | https://api.lcppch.top/lanqi-test/ | `20260912-plat28b-refcode-alnum` | `DEPLOY_OK` + `VERIFY_OK`（`No pending migrations to apply`） |

改动：`env.ts` 新增 `MARKETPLACE_TRIAL_GRANT_ENABLED`（默认 false）；`POST /market/admin/trial-grants` 停用时返回 **403 `trial_grant_disabled`** 且零写入（历史流水只读保留），后台面板停用态不渲染发放表单，运维 CLI 退出码 2；新增 `ReferralCode` / `ReferralBinding` / `PlatformSetting` 三张表（迁移 `202609120001_referral_rewards_plat28`，纯新增、可回滚）与 `GET/PATCH /market/admin/referral-config`、`POST /market/admin/referral-codes`、`GET /market/admin/referrals`；`/login?ref=<推荐码>` 的码随注册链路（`beta-login` / `onboarding/create-workspace`）提交，注册事务提交后落归因，**归因失败只拒绝归因、不阻断注册**（无码注册行为与上线前一致）。

生产实证（`scripts/tmp/plat28-prod-verify.sh`，真实生产接口 + 生产库）：人工发放 403 `trial_grant_disabled`；配置位 10 项全部可读（默认 `source=env`）；带码注册 → `ReferralBinding` 落库（推荐人 `cmtvilv2a…`（兰琪美业 owner）/ 被推荐人 / `boundAt` / `tenantId` / `source=beta_web_login`）；无码注册 `referral.state=none`；无效码注册成功且 `invalid_code`；三重唯一索引（userId / unionid / openid）在生产库存在；**零推荐奖励流水、零余额**；合成验收数据按 id 精确清理后逐表核对**残留 0**。当前生产验收链接：`https://api.lcppch.top/os-v2/login?ref=ref-mxow3bifnsv5`。

**推荐码字符集修正（发布中途）**：第一版用 base64url 生成推荐码，本次生产验收码正好以 `_` 结尾（`ref-…zpo_`）——分享到聊天工具或手抄时结尾的下划线/连字符最容易被截断。已改为 `ref-` + 12 位小写字母+数字，并加断言 `^ref-[a-z0-9]{12}$`；旧码已 `isActive=false`。

**并发发布核查（用户特别提醒）**：发布前后各做一次标记核查。核查中发现 **PLAT-23 的 `MARKETPLACE_TARGET_COST_TO_REVENUE_MULTIPLE` 在 16:01 那轮发布后已从两侧源码中消失**（并发叠加覆盖），本次包内该文件是含该常量的版本，发布后两侧恢复正常（`plat23=2` 处）。其余标记（PLAT-21/22/24/27、微信支付验签 `verifyWechatPaySignature`、LQ-24 重新生成按钮、图片默认 20 积分）逐项确认仍在。

发布后运行面：两侧 `active`、`health=200` / `ready=200`；生产 `journalctl -p err` 近 6 分钟 `No entries`；`/` 剩余 6.2G（78%）。回滚：`/opt/baolu-backups/20260912-plat28b-refcode-alnum-before-baolu-os-v2{,-test}/`。

第①批**刻意不做**：不发奖励（第②批）、不做推荐明细后台（第③批）、不做同设备/IP 批量注册限频（第②批风控）。活动窗在第①批仍为空（口径：开始 = 上线第②批那一刻），因此第①批期间产生的归因记录在奖励计算时属「窗外」，不会产生奖励——这是口径要求，不是缺陷。

## 上一轮：20260912-plat23b-merged-prod1（2026-09-12，生产）— 积分换算常量口径统一（方案 A），并处理一次并发发布互相覆盖

用户 2026-09-12 对 PLAT-23 选定**方案 A：不改任何数字，只让常量说真话**。改动：`apps/api/src/services/marketplace-cost.ts` 的 `MARKETPLACE_CREDIT_MARKUP = 20`（注释称 20 倍、实际 100 倍）换成 `MARKETPLACE_TARGET_COST_TO_REVENUE_MULTIPLE = 100` + `MARKETPLACE_CUSTOMER_PRICE_CNY_PER_CREDIT = CREDIT_PRICING.customerPriceCnyPerCredit`（¥0.05）+ `MARKETPLACE_CREDITS_PER_COST_CNY = 100 ÷ 0.05 = 2000`（浮点精确），换算改为单次乘法；新增口径文档 `docs/PRICING.md`（三条报价线、两套模型价表分工、变更规则）；新增契约 `scripts/credits-cost-consistency-contract-smoke.ts`（24 条，含 20 万点逐点比对）并挂 `qa:fast`。

**一个必须写在案上的精度事实**：纯表达式重写无法逐位一致——实测 300 万个成本值，旧式与任何自洽写法都有差异（对比单次乘法 459 处），**全部落在「成本 × 2000 正好是整数」的边界**，方向固定为旧式多送 1 积分；只影响内部 `estimatedCredits` 与账本 metadata，**对客扣费（SKU `ppu`）一分未变**（真实深度复盘复核 `consumedCredits=60`）。契约把「差异 ≤1 且只落在整数边界」写成了断言。

发布包（当前线上）：`release-20260912-plat23b-merged-full.tar.gz`（9367676 B，sha256 `2b6c6501b0c3224b54becf4a10b43c11d7a7e96a79da863bcb1cf25a7dd0fda5`，1465 文件）。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 生产 | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | https://api.lcppch.top/os-v2/ | `20260912-plat23b-merged-prod1` | `DEPLOY_OK` + `VERIFY_OK` + 匿名探针 **PASS** + `deployed-marketplace-browser-check` **PASS** + `platform:route-browser-e2e` **PASS 24/24**；`journalctl -p err` 近 6 分钟 `No entries` |
| 测试 | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | https://api.lcppch.top/lanqi-test/ | `20260912-plat23b-merged-test1` | `DEPLOY_OK`（`health=200 after 45s`）+ `ready=200` |

**并发发布事故与处置（重要）**：我第一轮生产发布完成后，另一个并行任务的 `20260912-lq24-needs-regen-prod1`（兰琪朋友圈重新生成）也在发生产，它的包来自不含本次修改的树，覆盖后生产 src/dist 里新常量变成 **0 处**（被回退）。处置方式：把两个包逐文件比对（差异全集 10 个文件，运行时代码 3 个），从**当前合并后的工作区**重新打包（`plat23b-merged`，包内同时含我的新常量与对方的 lq24 标记）再发生产。**经验**：`deploy-release.sh` 是叠加覆盖，多任务并行时谁最后发谁说了算；发布前后都要做一次标记核查，发现被覆盖就用「当前合并后的工作区」重打包，不要用旧包互相覆盖。

## 最新发布：20260912-plat24-chat-login-gate-prod1（2026-09-12，生产）— 视频复盘 chat 页匿名用户不再白填 4 步

用户 2026-09-12 提供 WorkBuddy《OSv2 视频复盘 agent QA 报告》（07:24 快照）。报告三条 P1 我在当前生产上独立复现（新增只读探针 `scripts/vidrev-chat-anonymous-probe.mjs`，2 个 SKU × 桌面 1440 / 移动 390 = 4 视口 × 4 断言，修复前**全红**）：chat 页顶栏只有「货架 / 对话」（没有登录入口），匿名用户直接进 4 步向导、填完＋确认后才在 `/run` 撞 401，而且提示他去点一个页面上根本不存在的「右上角『未登录 · 点击登录』」，文案还写成「登录状态已失效」。

改动（纯前端，`apps/web/src/pages/MarketplaceApp.tsx`）：① chat 页顶栏改用全局 `Topbar`（登录入口 / 积分钱包 / 主题切换 / 退出登录），顺带补齐报告 P2 的「chat 页缺主题切换」；② 新增 `hasSession` + 钱包读取，**未登录直接渲染登录引导**（说明「登录后才能使用、每次扣 N 积分、结果存进自己账号」+「🔒 立即登录」带回跳 + 回详情看参考案例），不再渲染 4 步向导；③ 掉登录文案由「登录状态已失效」改为「登录已过期」。任务卡 `docs/agents/platform-tasks.md` **PLAT-24**，缺陷 `docs/BUG_REGRESSIONS.md` **QA-20260912-011**。

发布包：`release-20260912-plat24-chat-login-gate-full.tar.gz`（9348144 B，sha256 `170c6dab0b4fbf37cb70dab30f7737c8e50f99a0f7735baa31c8ad687e9a52f9`，1461 文件；服务器侧逐字一致）。无删除文件、无迁移、无 env 变更。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 测试（内测免登录实例） | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | https://api.lcppch.top/lanqi-test/ | `20260912-plat24-chat-login-gate-test1` | `DEPLOY_OK` + `VERIFY_OK` + `PROBE_EXPECT=auto-login` **PASS**（免登录体验未被弄坏） |
| 生产 | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | https://api.lcppch.top/os-v2/ | `20260912-plat24-chat-login-gate-prod1` | `DEPLOY_OK` + `VERIFY_OK` + 匿名探针 **PASS** + `deployed-marketplace-browser-check` **PASS** + `platform:route-browser-e2e` **PASS 24/24** + `marketplace-sku-link-regression` **ALL PASS**；`journalctl -p err` 近 8 分钟 `No entries` |

老路径不回归（本地带登录 + 真实模型 1 次深度复盘）：`MP_E2E_WEB_URL=http://127.0.0.1:5175 node scripts/marketplace-vidrev-browser-e2e.mjs` → **PASS**（`chatRun=true`、11 章节、导出按钮、`本次消耗 60 积分`、移动 `overflow=0`、`consoleErrors=0`）。

**PLAT-25 收口（2026-09-13 总调度5）**：A（meiye 欢迎语顺序）已上线；B（标题体系——浏览器 `<title>` 与页内标题，QA-20260913-007）已完成 + 已回归（新增 `vidrev-chat-title-contract-smoke` 挂进 `qa:fast`；本地带登录浏览器实测两 SKU 标题正确、匿名探针 4 视口 PASS、`qa:fast` exit 0），代码与回归在未提交工作树，**发布待总调度决策**（当前工作树还混有其他未提交批次，需按发布批次打包，避免 PLAT-28 覆盖事故重演）。

## 最新发布：20260912-plat22-cliplab-cost-prod1（2026-09-12，生产）— 剪辑台响应不再返回本地算力成本

用户 2026-09-12 要求把「成本字段外泄」与「换算常量口径」分别开成任务卡、按「每批只动一件事」推进。本批（**PLAT-22**，缺陷登记在 QA-20260912-010「第三处」）只清一处：`POST /clip-lab/render`（`/agents/clipper` 工作台智能体，租户可打开）在 `result.measurement.estimatedLocalCostYuan` 里回传本机渲染成本（`renderMs / 3_600_000 × 2.4`，¥2.4/小时口径），而前端从未渲染它。

改动：`apps/api/src/routes/clip-lab.ts` 删除该字段；同一 `measurement` 里不含钱的效率口径（`totalMs` / `renderMs` / `realtimeFactor` / `machineVideosPerHour` / `estimatedHumanMinutes` / `humanReviewVideosPerHour`）全部保留；契约 `scripts/response-cost-contract-smoke.mjs` 新增第 ⑥ 段（4 条断言）从 29 条扩到 **35 条**。先红后绿：修复前 `FAIL (34 passed / 1 failed)` exit=1，修复后 `PASS (35 passed / 0 failed)` exit=0；`pnpm.cmd qa:fast` exit=0。

发布包：`release-20260912-plat22-cliplab-cost-full.tar.gz`（9333118 B，sha256 `c0a65060b663c31642df90eee188f7f338ed3bb25101e1d6f9242acc7cabdce4`，1460 文件；服务器侧 `sha256sum` 逐字一致）。无删除文件、无迁移、无 env 变更。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 测试 | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | https://api.lcppch.top/lanqi-test/ | `20260912-plat22-cliplab-cost-test1` | `DEPLOY_OK` + `VERIFY_OK`；部署产物 `clip-lab.js` 中 `estimatedLocalCostYuan` = 0 次 |
| 生产 | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | https://api.lcppch.top/os-v2/ | `20260912-plat22-cliplab-cost-prod1` | `DEPLOY_OK` + `VERIFY_OK` + 浏览器 `deployed-marketplace-browser-check` **PASS** + `platform:route-browser-e2e` **PASS 24/24** + `marketplace-sku-link-regression` **ALL PASS**；`journalctl -p err` 近 8 分钟 `No entries` |

**PLAT-23（已做，见上方最新发布）**：积分 ↔ 人民币 ↔ 成本换算常量口径统一。用户选定方案 A（只让常量说真话，不改数字），已落地 `MARKETPLACE_TARGET_COST_TO_REVENUE_MULTIPLE = 100` + `CREDIT_PRICING.customerPriceCnyPerCredit` 推导、`docs/PRICING.md` 口径文档与新契约。**仍待用户点头的是后续两批**：三条线倍数区间（30–100× / 10–20× / 4–8×）与两条地板是否写入正式价目；是否对齐 `livescript` 200→60、图片 100→20（属动钱）。

## 最新发布：20260912-lq25-invite-keep-test1 / -prod1（2026-09-12，测试实例 + 生产）— 兰琪扫码登录不再丢邀请码

用户 2026-09-12 反馈「已扫码 但是需要邀请码 还是登入不了」。只读取证结论：生产日志里 `10:04:44 POST /auth/wechat-bridge/complete` 表明**那次扫码授权已经成功**；该微信号 active memberships = 0；两张兰琪邀请码 `usedCount` 均为 **0**。根因是**扫码链路只带 `productCode`、不带 `inviteCode`**：`resolveWechatLogin()` 对「新用户且无产品授权」只会返回 `needsTenant`，前端整页 `replace` 回 `/login/lanqi` 补资料时把刚填的邀请码丢掉，老板看到的就是「扫码成功了却还要邀请码」。缺陷与红/绿证见 `docs/BUG_REGRESSIONS.md` **QA-20260912-013**。

改动（纯前端）：`apps/web/src/pages/LoginPage.tsx` 在开始微信授权前把产品邀请码暂存到 `sessionStorage["store_os_pending_invite"]`，`needsTenant` 回跳带 `?invite=<码>`，产品入口对 `?invite=` 自动核验一次（`submitProductInviteCode()`，与表单提交共用实现）并直接进入「门店资料」表单；`apps/web/src/pages/WeChatCallback.tsx` 手机微信内回跳同口径。**不动服务端**：不建租户、不改授权模型、不碰计费与积分。

验收：源码契约红灯（新断言打在修复前版本上命中数 0）→ 绿灯 `node scripts/product-login-entry-smoke.mjs` **PASS**（该脚本已挂 `qa:fast` 的 `auth:product-login-smoke`）；`pnpm.cmd --filter @baolu/web typecheck` exit 0；`pnpm.cmd qa:fast` → `QAFAST_EXIT=0`；**生产真实浏览器**（headless，不需要真人扫码、不消耗邀请码）打开 `https://api.lcppch.top/os-v2/login/lanqi?invite=<兰琪产品邀请码>` → 页面出现「邀请码已验证 / 门店名称* / 行业 / 所在城市 / 邀请码有效，请完成工作区资料。」，截图 `scripts/tmp/lq25-prefill-prod.png`。

发布包 `release-20260912-lq25-invite-keep-full.tar.gz`（**9359687 B**，sha256 `fae6538168b5e405bc842b8ed6c9a2a06e7d1cb05aca6a42a22fdb5778a3cbed`，1462 文件，服务器 `sha256sum` 与本地一致）。测试实例与生产均 `DEPLOY_OK`（`health=200 (after 15s)` / `ready=200`，48 迁移无待应用）+ `VERIFY_OK`。备份 `/opt/baolu-backups/20260912-lq25-invite-keep-{test1,prod1}-before-*`；回滚 = 还原备份 + `systemctl restart`，或只回滚这两个前端文件重发包。

**已知边界**：① `needsTenant` 的 onboarding token 在 localStorage，换浏览器重扫会再走一次「补资料」，但邀请码已由本修复带回并自动核验；② ~~同一微信号若已开通别的产品，产品入口仍返回 `403 product_membership_required`~~ —— **用户 2026-09-12 拍板「一个账号可以使用全平台」，该 403 已移除**：已开通其他产品的微信号再进兰琪入口会走「补资料」开第二个租户，兰琪仍靠产品邀请码把关（无码 403 `invite_code_required`）。见 QA-20260912-014。

**真人端到端复验（2026-09-12，老板本人，生产）**：用户按「带邀请码的兰琪入口链接」成功开通并进入，回复「能进入，私域营销页正常可用」。后台佐证：新租户 `cmtxwo0ib057y1161bdr27l84`（`createdAt 2026-09-12 12:49 +08`）＋ owner `Membership` 1 条 ＋ `lanqi` 授权 `active` ＋ 默认门店 1 个；兰琪邀请码 `la****p7` 由 `usedCount 0 → 1`。残留：该新账号未绑定微信，换设备需重走同一链接；如需「扫码直达」，需把老板微信号绑为该租户 owner（一次性、可回滚，待用户确认）。

## 最新发布：20260912-lq24-needs-regen-test1 / -prod1（2026-09-12，测试实例 + 生产）— 兰琪私域营销「素材信息不够」分支补齐重新生成

用户交来 WorkBuddy《兰琪私域营销页回归复测报告（第3轮）》并指示「参考修复」。**先复核报告**：报告标为待处理的两条 P2（结果面板缺「复制 / 重新生成」、顶栏「多端实时同步」点击无反馈）**在 2026-09-11 已修并已上线**——本轮真实浏览器实测 `tools.labels=["📋 复制文案","🔄 重新生成"]`、`syncToast="已同步 · 10:26（同一账号在手机和电脑看到的是同一份数据）"`，属**旧构建时效差异**；报告澄清的「422 是正确空值校验」与既有结论一致。**但顺报告反查出一条真实残留**：素材被判「还不够具体」（`result.needsInput`，规则层 `isInputRich`）时，结果面板是另一套 JSX，**只有一句提示、没有任何按钮**——这才是「结果卡片没有按钮」的真实现场。任务卡 `docs/agents/lanqi-beauty/tasks/LQ-24-私域营销信息不足分支补齐重新生成.md`，缺陷与红/绿证见 `docs/BUG_REGRESSIONS.md` **QA-20260912-012**。

最小修复（纯前端，两页各 +6 行）：`apps/web/src/pages/LanqiMomentsPage.tsx` 与 `LanqiMomentsWechatGroupPage.tsx` 的 needsInput 分支补「🔄 重新生成」（`data-lanqi-moments-regen` / `data-lanqi-wechat-regen`，含「重新生成中…」进行态）；**刻意不放**「复制文案」（该分支没有正文，避免让老板复制到一句提示）。验收脚本同步补分支作用域的断言：`scripts/lanqi-moments-ui-contract-smoke.mjs`（新增 `branchOf()`，只在 needs 分支内断言，避免被 else 分支的按钮蒙混）与 `scripts/lanqi-moments-retest.mjs`（用 20 字「不具体」素材触发规则判定，**不调用模型、不花钱**地复现 needsInput）。

**先红后绿**：契约 smoke `23 passed / 3 failed` → **26 passed / 0 failed**；真实浏览器（内测实例）`9 passed / 1 failed`（`needsPanelShown=true` 而 `needsRegen={"found":false}`）→ **11 passed / 0 failed**（含 `点「重新生成」真的又发起了一次升级请求 :: upgradePosts 2 -> 3`、`console=0 page=0`）；`pnpm.cmd qa:fast` → `QAFAST_EXIT=0`。

发布包 `release-20260912-lq24-moments-needs-regen-full.tar.gz`（**9353793 B**，sha256 `671423ad9029ca4962d508b993f6a651783de1679722af924083565609cf372a`，1462 文件，服务器 `sha256sum` 与本地逐字一致）。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 测试 | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | https://api.lcppch.top/lanqi-test/ | `20260912-lq24-needs-regen-test1` | `DEPLOY_OK`（`health=200 (after 15s)` / `ready=200`，48 迁移无待应用）+ `VERIFY_OK` + 浏览器 **11/0** |
| 生产 | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | https://api.lcppch.top/os-v2/ | `20260912-lq24-needs-regen-prod1` | `DEPLOY_OK`（同上）+ `VERIFY_OK`（`skus_total=19` / `coming_soon=13` / 两个 `vidrev` = `selling`）+ 线上 chunk 实测含新标记 |

线上产物核对（只取 index.html 当前引用的 chunk，两侧）：生产 `LanqiMomentsPage-5xwsyia7.js` / `LanqiMomentsWechatGroupPage-D-XnfouP.js`、内测 `LanqiMomentsPage-DQOUUrpU.js` / `LanqiMomentsWechatGroupPage-Cy8fRwom.js`，均含 needs 分支标记。备份 `/opt/baolu-backups/20260912-lq24-needs-regen-{test1,prod1}-before-*`；回滚 = 还原备份目录 + `systemctl restart`（无接口 / 无迁移 / 无数据变更）。

**打包方式的一处工程说明**：工作区当时存在**另一条并行工作线未提交的在途改动**（`marketplace-cost.ts` 等）。为避免把他的半成品打进发布包，本次不在工作区直接打包，而是 `git worktree add --detach <temp> HEAD` 检出干净树后按 `scripts/tmp/filelist-lq24-prod.txt`（1462 文件）打包——发布包只含已提交内容，不含任何未提交改动。

## 最新发布：20260912-plat21-cost-leak-prod1（2026-09-12，生产）— 客户侧响应不再返回内部算力成本

用户 2026-09-12 指出「**我们把成本直接暴露给客户了**」：`/marketplace/run` 的成功响应里带了 `modelCostCny`（本次真实算力成本，人民币），客户打开 DevTools 就能看到我们每次赚多少，违反「不向普通用户暴露供应商、密钥或内部成本」，要求「抓紧摘掉，内部审计继续走账本 `metadata` 就够了」。任务卡见 `docs/agents/platform-tasks.md` **PLAT-21**，缺陷与红/绿证见 `docs/BUG_REGRESSIONS.md` **QA-20260912-010**。

改动：① `apps/api/src/routes/marketplace.ts` 成功响应删除 `modelCostCny` 与成本折算积分 `estimatedCredits`（后者 = `ceil(成本 × 2000)`，客户可反推成本，属同一泄露）；账本 `MarketplaceLedgerEntry.metadata` 的 `modelCostCny` / `estimatedCredits` / 三个 token 计数**全部保留**。② 同轮只读扫描发现第二处同类泄露并一并修复：`apps/api/src/routes/beauty-industry-media.ts` 的 `/media/quote` 响应删除 `estimatedProviderCostYuan`（供应商成本，人民币），`apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx` 类型同步删除该字段；服务端的成本闸门（`estimateBeautyImageProviderCostYuan` + `resolveReadiness`）与 job 参数里的成本审计字段**保留**。新增契约 `scripts/response-cost-contract-smoke.mjs`（**29 条**离线断言，挂进 `qa:fast` 的 `platform:response-cost-contract-smoke`），三个真实运行 smoke 补缺席断言 + 账本审计断言。兰琪报价页 `/lanqi` 的 `estimatedCredits` 是**对外公开单价**（30 积分/秒、每镜 90 积分），按用户口径保留；美业 job `serialize()` 的 `provider` / `model`（供应商与模型名）本轮未动，单独等用户定。

发布包（当前线上为第二轮）：`release-20260912-plat21-cost-leak2-full.tar.gz`（9327277 B，sha256 `b6d922a58bac4525e39f21e837e1296e584d2b93d4768896cfeb19fb518647ac`，1460 文件；服务器侧 `sha256sum` 与部署日志逐字一致）；第一轮为 `release-20260912-plat21-cost-leak-full.tar.gz`（9326080 B，sha256 `dcd156437143c2bfcdc2d7c1fdcf59d447ea4c782511682ee6b7658ccf9dd21f`）。两轮都无删除文件、无迁移、无 env 变更。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 测试 | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | https://api.lcppch.top/lanqi-test/ | `20260912-plat21-cost-leak-test1` | `DEPLOY_OK`（`health=200 (after 15s)` / `ready=200`，48 迁移无待应用）+ `VERIFY_OK` + 浏览器 **PASS** |
| 生产 | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | https://api.lcppch.top/os-v2/ | `20260912-plat21-cost-leak-prod1` | `DEPLOY_OK`（同上）+ `VERIFY_OK`（`skus_total=19` / `coming_soon=13` / 两个 `vidrev` = `selling`）+ 浏览器 **PASS** + `marketplace-sku-link-regression` **ALL PASS**；`journalctl -p err` 近 10 分钟 `No entries` |
| 测试 | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | https://api.lcppch.top/lanqi-test/ | `20260912-plat21-cost-leak2-test1` | 含美业报价一处；`DEPLOY_OK` + `VERIFY_OK` + 浏览器 **PASS** |
| 生产 | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | https://api.lcppch.top/os-v2/ | `20260912-plat21-cost-leak2-prod1` | 含美业报价一处；`DEPLOY_OK` + `VERIFY_OK` + 浏览器 **PASS** + `marketplace-sku-link-regression` **ALL PASS**；`journalctl -p err` 近 8 分钟 `No entries` |

验收证据：本地真实端到端 `VIDREV_SMOKE_ONLY=deep pnpm.cmd marketplace:vidrev-run-smoke` → `costFieldsAbsent=true` / `ledgerModelCostCny=0.029529` / `consumedCredits=60`；上线后直接查生产部署产物，`marketplace.js` 里 `modelCostCny` 与 `estimatedCredits` 各只出现 1 次且都在账本 `metadata` 内、响应对象已无成本字段，`beauty-industry-media.js` 的 `/media/quote` 响应对象已无 `estimatedProviderCostYuan` 而成本闸门仍在。备份：`/opt/baolu-backups/20260912-plat21-cost-leak{,-2}-{prod1-before-baolu-os-v2,test1-before-baolu-os-v2-test}/`。

## 最新发布：20260912-lq23-video-prod2（2026-09-12，生产）— 兰琪「文案转片」真实出片接通 + 构建垃圾回收 + 备份保留策略

用户 2026-09-12 指令「开始接视频」并逐项拍板（爆款复刻方案 A `wan2.2-animate-mix` std；文案转片 `wan2.6-i2v-flash` 720P 无声 = 30 积分/秒、每镜 90 积分；首次联调上限 ¥10；素材桶方案 B；定价 10 倍口径）。任务卡见 `docs/agents/lanqi-beauty/tasks/LQ-23-文案转片真实出片接通.md`，缺陷与红/绿证见 `docs/BUG_REGRESSIONS.md` **QA-20260912-008**。**本轮只放行「文案转片」一条线；门店素材成片 / AI 剪辑仍由 `VIDEO_RENDERING_READY=false` 关着，付费生图继续关闭。**

发布包：`release-20260912-lq23-video-prod-full.tar.gz`（9307742 B，sha256 `a9c27e4867bc700abb964cd7d310afbbcee2d225613ed98a8c7e8e5f1cea427a`，1458 文件；服务器侧实测一致）。删除清单 6 条（PLAT-18 已下线页面）。

生产 env 新增 9 行（102–110 行，备份 `/opt/baolu-backups/env-lq23-prod-20260912-083231/baolu-os-v2.env.before-lq23`）：`LANQI_MEDIA_EXECUTION_MODE=real`、`LANQI_MEDIA_REAL_EXECUTION_APPROVED=true`、`LANQI_MEDIA_ASSET_STORAGE=local`、`LANQI_MEDIA_IMAGE_TO_VIDEO_MODEL=wan2.6-i2v-flash`、`LANQI_MEDIA_VIDEO_CREDITS_PER_SECOND=30`、`LANQI_MEDIA_PUBLIC_BASE_URL=https://api.lcppch.top/os-v2/api`、`LANQI_MEDIA_STAGING_SECRET=<openssl rand -hex 32>`、`LANQI_MEDIA_FIRST_FRAME_TTL_MINUTES=240`、`LANQI_MEDIA_FIRST_FRAME_MAX_MB=6`。**未设** `LANQI_MEDIA_IMAGE_REAL_EXECUTION_APPROVED`（付费生图仍关）。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 生产 | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | https://api.lcppch.top/os-v2/ | `20260912-lq23-video-prod2` | `DEPLOY_OK`（`health=200 after 15s`、`ready=200`、48 迁移无待应用）+ `VERIFY_OK`（`src_data_sha=dist=a668b642…`、`index_base_path=/os-v2/`、`skus_total=19`/`coming_soon=13`、`lanqi_brain_present`、`ipzone__vidrev`/`meiye__vidrev` 均 `selling`） |
| 测试 | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | https://api.lcppch.top/lanqi-test/ | `20260912-lq23-video-dual-test`（同日早先） | `DEPLOY_OK` + nginx 两处 `client_max_body_size 20m`；视频页浏览器 E2E 桌面 1200 / 移动 390 各 16 项、0 failed |

**同日顺手做完的三件运维收尾（均用户已授权）：**

1. **历史构建产物回收**。首次 `verify-deploy.sh` 报 `web_credits_rmb_copy_absent` 红灯，追下去发现**不是客户页面退回了人民币折算**（PLAT-19 口径成立）——`/opt/baolu-*` 的发布是「只叠加、不删除」，`dist/assets` 累积了 2253 个历史 hashed 产物 / 123.8 MB，其中 14 个还带着旧文案，被全目录 grep 误判成当前问题。新增 `scripts/gc-web-dist-assets.sh`（从 `index.html` 走 import 图求可达集，先干跑再移动到 `/opt/baolu-backups`，可回滚），生产回收 **2253 文件 / 123.8 MB**、测试回收 **693 文件 / 29.5 MB**，两侧可达集都收敛到 **53 个**。同时把 `verify-deploy.sh` 的口径改成**只看 import 图里的产物**，并容错 `API_BASE` 漏结尾斜杠（此前会把 `/os-v2/api` 拼成 `/os-v2/apimarket/skus`，落回 SPA index.html 假报 `market/skus parse error`）。
2. **`/opt/baolu-backups` 保留策略 + 清历史**。`scripts/prune-baolu-backups.sh` 新增 `gc` 分组（构建垃圾隔离区只留最新 1 个），按「每组留最新 4 个 + 超过 14 天无条件删」执行：**删除 17 个目录 / 2381 MB**，磁盘 `67% → 58%`，清单 `/opt/baolu-backups/.prune-log/20260912-084740.tsv`，剩余备份 13 个。
3. **回收内测试用额度**。删掉 `/etc/baolu-secrets/baolu-os-v2-test.env` 的 `NEW_USER_LOCAL_TRIAL_CREDITS=300`（备份 `/opt/baolu-backups/env-lq23-trial-recycle-20260912-084631/baolu-os-v2-test.env.before`），重启内测服务后 `health=200`/`ready=200`。生产 env **从来没有**该变量（`grep -c` = 0），无需处理。

**LQ-23 生产登录门槛收口（2026-09-12 追加）**：生产浏览器级 E2E 第一次运行**未通过**（桌面 1200 视口 900s 未扫码，16 项里 12 项停在登录页；移动 390 视口扫码成功离开登录页，但只拿到平台登录态，视频页断言全未通过）。根因确认**不在发布包**：`/os-v2/api/auth/wechat-config` 实测 `inviteRequired=false`（平台入口不强制邀请码），但**兰琪产品入口 `/os-v2/login/lanqi` 必须先填产品邀请码**（前端「产品邀请码 *」必填 + `/auth/product-invite/validate` 服务端校验），用户扫码后被拦在这一层。已在生产新建一次性兰琪产品邀请码（`InviteCode cmtxqpx0f0000jcq47ge1joxd`、`codePreview=la****p7`、`maxUses=3` / `usedCount=0`、`expiresAt=2026-10-12`、`label=lanqi-prod-verify-20260912`；明文只线下交付不入库，撤销＝`isActive=false`），并实测该码 `POST /auth/product-invite/validate` → `200 {"valid":true,"productCode":"lanqi","productName":"兰琪美业经营增长系统"}`。验收脚本补 `--invite-code` 后已重开窗口重跑，**仍未取得「扫码后全部断言通过」的生产页面级证据**。详见 `docs/agents/lanqi-beauty/STATUS.md`。

## 最新发布：20260912-plat19-credits-only-test1 / -prod1（2026-09-12，测试实例 + 生产）— 客户界面只显示积分，去掉「≈ ¥」人民币折算

用户 2026-09-12 要求：「每次生成提示用户消耗多少积分就可以了 不要告诉花了多少钱 比如：约扣 60 积分 · ≈ ¥3 去掉 ≈ ¥3 平台每个智能体页面都只显示消耗多少积分 不显示消耗多少元」。任务卡见 `docs/agents/platform-tasks.md` **PLAT-19**；缺陷红/绿证见 `docs/BUG_REGRESSIONS.md` **QA-20260912-009**（P2）。**纯展示口径改动，未动计费、定价、钱包余额计算。**

发布包：`release-20260912-plat19-credits-only-full.tar.gz`（**9311332 B**，sha256 `e4d70513e51286d60134c0f5a522178ccadfa5e96e2891a6f758eeab4c057076`，1458 文件；服务器侧 `sha256sum` 与本机逐字一致）。

关键改动：

1. `apps/web/src/pages/MarketplaceApp.tsx`：删掉 `yuanLabelForCredits` import 与 13 处「≈ ¥」渲染（顶栏钱包、专区封面副标题、分步链路、单品货架卡、余额卡、已购列表、导出 402 alert、聊天页消耗、生成确认气泡、免费重做提示、Word 导出按钮）。所有「N 积分」表述保留。
2. `apps/web/src/components/chat/ChatMessages.tsx`：删掉 import；Word 导出按钮改为「下载精美 Word · N 积分」。
3. `packages/shared/src/index.ts`：`yuanLabelForCredits` 加「仅供内部/管理端使用」注释 + 指向新契约 smoke（函数本体保留，内部/管理端仍可用）。
4. **充值页 `/recharge` 刻意保留 `¥`**——那是真实付款金额，不是积分折算。
5. 新增 `scripts/marketplace-credits-only-contract-smoke.mjs`（19 条只读源码断言，挂进 `qa:fast`）；`scripts/deployed-marketplace-browser-check.mjs` 断言由「同时展示积分与人民币折算」改为「只显示积分 + 不得出现 `≈ ¥`」。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 测试 | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | https://api.lcppch.top/lanqi-test/ | `20260912-plat19-credits-only-test1` | `DEPLOY_OK`（`stale files removed: 0`）+ `VERIFY_OK`（`web_credits_rmb_copy_absent = no` / `web_credits_copy = yes`）+ 浏览器 **PASS** |
| 生产 | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | https://api.lcppch.top/os-v2/ | `20260912-plat19-credits-only-prod1` | `DEPLOY_OK`（`health=200 (after 15s)` / `ready=200`）+ `VERIFY_OK` + 浏览器 **PASS**；`journalctl -p err` 近 15 分钟 `No entries` |

**验收口径（真实浏览器，非类型检查）**：生产 `DEPLOY_CHECK_WEB_URL=https://api.lcppch.top/os-v2 node scripts/deployed-marketplace-browser-check.mjs` → `shelf=PASS credits_only=PASS no_yuan_conversion=PASS detail_redo_copy=PASS console_clean=PASS`。货架卡片实际文本只剩「200 积分/次」「40 积分/次」「60 积分/次」，整页 `¥` 出现 **0 次**（修复前同一位置是「200 积分/次 · ≈ ¥10」「60 积分/次 · ≈ ¥3」）；详情页「200 积分/次」「用一次 · 扣 200 积分」。构建产物导入图探针（`index.html` 出发 53 个可达资源）：`≈ ¥` 已消失，`¥` 与「基准 1 元 = 20 积分」仍在（充值页正对照）。未受波及：`platform:route-browser-e2e` 生产 **PASS 24/24**、`marketplace-sku-link-regression` 生产 **ALL PASS**。截图 `%TEMP%\deployed-marketplace-check-1789174651795\`。

部署前备份：生产 `/opt/baolu-backups/20260912-plat19-credits-only-prod1-before-baolu-os-v2/`；测试 `/opt/baolu-backups/20260912-plat19-credits-only-test1-before-baolu-os-v2-test/`。发布日志 `/tmp/deploy-20260912-plat19-credits-only-prod1-baolu-os-v2.log`、`/tmp/deploy-20260912-plat19-credits-only-test1-baolu-os-v2-test.log`。

回滚：还原上述 `-before-*` 备份并 `systemctl restart baolu-os-v2`；或只恢复本轮 3 个前端/共享文件重新发包。

## 最新发布：20260912-plat18-route-cleanup-test1 / -prod1（2026-09-12，测试实例 + 生产）— 历史路由清理第一/二批 + 输错网址不再掉进外卖首页

用户 2026-09-12 同意「每批只删一组、独立可回滚，删前先加『保留网址清单』契约，删后跑 `qa:fast`」的推进方式，并明确第一批（`/legacy-diagnosis`、`/v4-preview`、`/industry-prototype`）、第二批（`/clip-lab`）+ 清构建垃圾。**第三批 `/internal/*` 本轮未动**（用户原话「我不擅自删」，需单独点头）。任务卡见 `docs/agents/platform-tasks.md` **PLAT-18**；缺陷与红/绿证见 `docs/BUG_REGRESSIONS.md` **QA-20260912-007**（输错网址掉进外卖增长智能体首页，P2）。**只删路由分支与已下线页面文件，未改任何在售智能体逻辑。**

发布包：`release-20260912-plat18-route-cleanup-full.tar.gz`（sha256 `92a36b4f391dd2eb92957b43ede7430eb9a945745e2cd00cb8260b385cd21551`，1456 文件 / 1871 条目；服务器侧实测一致）。

关键改动：

1. 新增 `apps/web/src/pages/NotFoundPage.tsx` + `apps/web/src/styles/not-found.css`：统一兜底页，标题「这个页面不存在，或者已经下线」、回显 pathname、出口 `/agents` 与 `/my-ai`，并设 `document.title="页面不存在 - 思潼AI 行业智能体平台"`。
2. `apps/web/src/main.tsx`：删掉 `SitongV4App` / `BaoluDiagnosisApp` / `ClipLabApp` 三个路由分支与常量，全局兜底由 `return <AgentHomePage />` 改为 `return <NotFoundPage />`。**保留 `import "./styles/clip-lab.css"`**（在售 `/agents/clipper` 仍在用）。
3. 第二批口径修正：用户原话要删 `/clip-lab` 的两个页面组件，但实测 `ClipLabApp` 被**在售** `/agents/clipper` 复用（`AgentProductsApp.tsx` import + `agent.slug === "clipper"` 分支），故**只删路由，保留 `ClipLabApp.tsx` / `PersonaClipLabApp.tsx` / `clip-lab.css` / `apps/api/src/routes/clip-lab.ts`**，并把这条写成契约硬断言。
4. 新增 `scripts/platform-route-contract-smoke.mjs`（挂进 `qa:fast`）+ `scripts/platform-route-browser-e2e.mjs`：把「保留网址能打开 / 已删网址落统一兜底页且不显示其他产品页 / 在售入口不受影响」固化为可重复回归。
5. `scripts/tmp/deploy-release.sh` 新增**可选第 8 参数**（删除清单）与第 `7a` 步：只允许 `apps/` `packages/` `docs/` `mcp-skills/` `scripts/` 前缀，拒绝绝对路径与 `..`；**不传参数时行为与旧版完全一致**。

删除清单（两侧服务器实测均已 `REMOVED`，删除清单留档 `/tmp/plat18-deleted-paths.txt`）：

```
apps/web/src/pages/BaoluDiagnosisApp.tsx
apps/web/src/pages/IndustryWorkbenchPrototypePage.tsx
apps/web/src/pages/SitongV4App.tsx
apps/web/src/styles/industry-workbench-prototype.css
apps/web/src/styles/sitong-v4.css
scripts/industry-workbench-prototype-smoke.mjs
```

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 测试 | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | https://api.lcppch.top/lanqi-test/ | `20260912-plat18-route-cleanup-test1` | `DEPLOY_OK`（`stale files removed: 6`）+ `VERIFY_OK`（`health`/`ready=200`、`src_data_sha=dist=a668b642…`、`skus_total=19`/`coming_soon=13`、两个 `vidrev` = `selling`）+ `platform:route-browser-e2e` **PASS 24/24** |
| 生产 | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | https://api.lcppch.top/os-v2/ | `20260912-plat18-route-cleanup-prod1` | `DEPLOY_OK`（`stale files removed: 6`）+ `VERIFY_OK`（同上全部 PASS）+ `platform:route-browser-e2e` **PASS 24/24**（部署前同脚本对生产为 **FAIL 12/24**，即用户报的 Bug 已当场复现并被修掉） |

**验收口径（真实浏览器，非类型检查）**：保留网址 `/agents`、`/my-ai`、`/lanqi/moments` 打开成功且控制台 0 error；`/legacy-diagnosis`、`/v4-preview`、`/industry-prototype`、`/clip-lab`、`/__platform-route-check-not-exist` 全部落到「页面不存在 - 思潼AI 行业智能体平台」兜底页；`/agents/clipper`（在售视频剪辑工作台）不受 `/clip-lab` 下线影响；移动端 390×844 兜底页标题与两个出口可见、无横向溢出。截图存于 `%TEMP%\platform-route-check-*`。

**同日踩到的两个工程坑（已修，非产品逻辑）**：

1. `scripts/tmp/*.ps1` 是「UTF-8 无 BOM + LF」，Windows PowerShell 5.1 按 ANSI 解码后**中文注释会把紧随的换行吞掉、静默注释掉下一行代码**，这是首次打包时 6 个已删文件没被过滤掉的真正根因。已把 `build-prod-filelist.ps1` 与 `build-release-archive.ps1` 的注释全部改为 ASCII 并加显式警告；**其余 `.ps1` 仍有同类风险，未一并处理**（记入残余风险）。
2. `package.json` 曾被并发任务清空过一次（07:40 变成 90 字节），07:45 由另一任务恢复但**丢了 `marketplace:credits:trial-grant` script**，已补回；现 219 个 scripts、JSON 合法。

部署前备份：生产 `/opt/baolu-backups/20260912-plat18-route-cleanup-prod1-before-baolu-os-v2/`（212M，含 `app-before.tar.gz`、`db-before.sql.gz`、`dist-hashes-before.txt`、`new-files.txt`、`deleted-paths.txt`）；测试 `/opt/baolu-backups/20260912-plat18-route-cleanup-test1-before-baolu-os-v2-test/`。发布日志 `/tmp/deploy-20260912-plat18-route-cleanup-prod1-baolu-os-v2.log`、`/tmp/deploy-20260912-plat18-route-cleanup-test1-baolu-os-v2-test.log`。

回滚：还原上述 `-before-*` 备份并 `systemctl restart baolu-os-v2`；或单独恢复 6 个已删文件 + 把 `main.tsx` 兜底改回 `<AgentHomePage />` 重新发包。

**未运行**：本轮未跑 `pnpm qa:full`（跨模块改动面小、以 `qa:fast` + 契约 smoke + 双实例真实浏览器 E2E 覆盖；`qa:full` 期间工作区有并发任务改 `package.json`、`lanqi-media-generation.ts`，跑出来无法区分归因）。`/internal/*` 第三批按用户要求**未删**。

**服务器清垃圾（2026-09-12 当日执行，非业务改动）**：删掉 `/opt/baolu-stage/20260911-*` 共 13 个历史构建暂存目录（5.0G scratch，`deploy-release.sh` 每次发布会重建，不是回滚资产）+ `/tmp` 41 个发布传输产物（`overlay-*.tar.gz` / `release-*.tar.gz` / `rel-files-*.txt` / `filelist-*.txt`）。磁盘 **77% → 59%（6.5G → 12G 可用）**。删除保护：完全未触碰 `/opt/baolu-backups/**`（3.0G 回滚备份原样保留，含本轮两个 `20260912-plat18-*` 备份）、保留当日 `20260912-plat18-route-cleanup-{prod1,test1}` 暂存目录；执行前已确认无正在进行的部署进程，删除后复核 `systemctl is-active=active` / `health=200` / `web=200` / `skus=200`。

**仍未做**：`/opt/baolu-os-v2/apps/web/dist/assets` 历史产物清理（2263 文件 / 131M）**按工程判断暂缓**——只有 131M 收益，但要精确算出「当前 `index.html` 经全链路 import 可达的产物集合」才算安全，做错会直接把线上打白屏。磁盘已回到 59%，不急，建议随下次发布改为「构建期先生成可达清单、再原子替换」一起做。

## 最新发布：20260911-lq22-nav-white-text-test1 / -prod1（2026-09-11，测试实例 + 生产）— 兰琪一级导航改白字（品牌橙底不变）

用户 2026-09-11 问「一级导航页的字体从黑色改成白色会好看些吗」，看过带真实截图的对比后定稿：**保留兰琪品牌橙底 `#F37021` + 导航字改白 + 10px「开发中」徽标底色加深**。口径、AA 例外声明与红/绿证见 `docs/agents/lanqi-beauty/tasks/LQ-22-侧栏导航白字配色.md`。这是用户主动要求的视觉调整，**不是 Bug 修复，故未登记 `docs/BUG_REGRESSIONS.md`**（同 PLAT-15 只改文案不登记的做法），但对比度已被固化成回归断言。

发布包：`release-20260911-lq22-nav-white-text-full.tar.gz`（**9287379 B**，sha256 `a80b9a08c3d31c1b75c8d2c90ac255df76789a588546380cf07c1a4ce879e268`，1455 文件；服务器侧 sha256 实测一致）。关键改动仅 `apps/web/src/styles/lanqi-moments.css` 4 条规则：`.lq-pd__brand` / `.lq-pd__brand-name` / `.lq-pd__item` 字色 `#2D1A10` → `#fff`、`.lq-pd__item:hover` 蒙层 `rgba(45,26,16,.10)` → `rgba(255,255,255,.18)`、`.lq-pd__badge(--dev)` 底色 `rgba(45,26,16,.14/.10)` → `rgba(45,26,16,.30)` 且字色改白；外加两个回归脚本加断言（契约 smoke 35→42、浏览器 E2E 加 3 条/视口）。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 测试 | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | https://api.lcppch.top/lanqi-test/ | `20260911-lq22-nav-white-text-test1` | `DEPLOY_OK`（`health=200 (after 15s)` / `ready=200`，`48 migrations found` / `No pending migrations to apply.`）+ `lanqi-brand-nav-browser-e2e --base .../lanqi-test` **PASS 0 failed**（桌面 1440 + 移动 390：`nav=rgb(255,255,255)` / `bg=rgb(243,112,33)` / 白字对比度 **2.94:1** / 徽标白字 **4.79:1**，其余「开发中」占位与已上线页面断言全绿） |
| 生产 | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | https://api.lcppch.top/os-v2/ | `20260911-lq22-nav-white-text-prod1` | `DEPLOY_OK`（`health=200 (after 33s)` / `ready=200`）+ 线上 CSS 产物 `assets/index-C-muJ3eY.css` 实测五条全部命中：`.lq-pd__item{…color:#fff}` / `.lq-pd__brand-name{…color:#fff}` / `.lq-pd__item:hover{background:#ffffff2e}` / `.lq-pd__badge{background:#2d1a104d;color:#fff}` / `.lq-pd__side{background:#f37021}` |

**已知口径（重要）**：这条生产发布与 `20260911-vidrev-open3-prod1`（两个视频复盘 SKU 开卖）时间上相邻，已当场核查**没有互相覆盖**——生产 `/opt/baolu-os-v2/apps/api/dist/apps/api/src/services/marketplace-catalog.js` 仍在（`MARKETPLACE_SKU_STATUS_OVERRIDES` 命中 3 次、`vidrev` 命中 2 次），`apps/api/src/data/marketplace-v3.json` 仍有 4 处 `selling`，即两个视频复盘 SKU 的「已开卖」状态与发布文件读取修复都还在。

**未运行 / 残余风险**：生产侧**没有**跑 `lanqi-brand-nav-browser-e2e`——生产要求真人微信扫码登录，脚本会在登录页等待超时（测试实例有免登录门所以能跑）；生产改用「抓取线上 CSS 产物做规则与取值断言」替代，并另有测试实例真实浏览器截图佐证。要补生产页面级证据，需用户**本人扫码登录后再跑一次**该脚本。回滚 = 还原上述 4 条 CSS 规则重新发包，或还原 `/opt/baolu-backups/20260911-lq22-nav-white-text-{test1,prod1}-before-*` 并 `systemctl restart`。

## 最新发布：20260911-vidrev-open3-test1 / 20260911-vidrev-open-prod1（2026-09-11，测试实例 + 生产）— 两个视频复盘智能体开卖（`coming_soon` → `selling`）

用户 2026-09-11 明确同意「把这两个 SKU（两个视频复盘智能体）从『开发中』改成开卖」后执行。缺陷、根因链与红/绿证见 `docs/BUG_REGRESSIONS.md` **QA-20260911-016**；按人审计与历史页面清理分别记在 `docs/agents/platform-tasks.md` **PLAT-17 / PLAT-18**。

发布包：`release-20260911-vidrev-open3-full.tar.gz`（**9288547 B**，sha256 `e797080cac4a74963517c0c43c39635affb5d37654c52fd662fb5c54ec8eee17`，1455 文件）。关键改动：`apps/api/src/data/marketplace-v3.json` 给 `ipzone.ov.vidrev` / `meiye.ov.vidrev` 写 `status: "selling"`；`apps/api/src/services/marketplace-catalog.ts` 新增 `MARKETPLACE_SKU_STATUS_OVERRIDES`，让 SKU 状态从**发布文件**读取（此前被数据库历史 `ov` 静默覆盖，是本轮线上「改了却没生效」的根因）。三个部署脚本硬校验 `marketplace-v3.json` sha256 `a668b642…`，`verify-deploy.sh` 新增「两个 `vidrev` 必须 = `selling` 否则 `SystemExit`」。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 测试 | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | https://api.lcppch.top/lanqi-test/ | `20260911-vidrev-open3-test1` | `DEPLOY_OK` + `VERIFY_OK`（`PASS ipzone__vidrev_status = selling` / `PASS meiye__vidrev_status = selling` / `coming_soon = 13`）+ `deployed-marketplace-browser-check` PASS + `marketplace-sku-link-regression` ALL PASS |
| 生产 | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | https://api.lcppch.top/os-v2/ | `20260911-vidrev-open-prod1` | `DEPLOY_OK`（`health=200 (after 15s)` / `ready=200`）+ `VERIFY_OK`（同上两条 PASS）+ `marketplace-sku-link-regression --base https://api.lcppch.top/os-v2` **ALL PASS**（桌面 1440 / 手机 390，两个 SKU 渲染「已开卖」，`200 /api/market/skus/<sku>`，无 5xx、无 console 错误） |

回滚：还原 `/opt/baolu-backups/20260911-vidrev-open*-{test1,prod1}-before-<app>/` 并 `systemctl restart`；或把 `apps/api/src/data/marketplace-v3.json` 里两个 `status` 改回 `coming_soon` 重发包（发布文件是唯一口径来源）。

注意：本轮部署期间另有一条不同任务的生产发布（`20260911-lq22-nav-white-text-prod1`）也在跑，它的包里带 `marketplace-v3.json` 新版本但没有本修复的代码，因此**那次 `DEPLOY_OK` 之后线上仍是「开发中」**，容易被误读成部署没生效。

## 最新发布：20260911-qa015-sku-link-test1 / -prod1（2026-09-11，测试实例 + 生产）— 货架 SKU 分享链接不再兜底成「服务暂时不可用」

发布包：`release-20260911-qa015-sku-link-full.tar.gz`（**9270737 B**，sha256 `32d40b128ddbea2b3057e4045c3e71e48d1eb53757cbe2cf4c72380bcc1a68fc`，**1453 个文件**）。测试实例与生产共用同一份产物，两侧部署日志第 3 行 `archive sha256` 实测与本机一致（`32d40b12…`，均为 1453 文件）。发布 id 按环境分别记为 `20260911-qa015-sku-link-test1` / `20260911-qa015-sku-link-prod1`。策略同前：stage 构建 → 备份 → 全量叠加（不删除历史文件）→ 就地 `prisma generate` → migrate → 重启 → 健康轮询 → 校验 → 失败自动回滚。

起因：用户 2026-09-11 反馈「① 创始人IP专区 https://api.lcppch.top/os-v2/agents/ipzone__vidrev ② 美业专区 https://api.lcppch.top/os-v2/agents/meiye__vidrev 上面两个网址显示服务暂时不可用」。缺陷、根因、红/绿证与回归脚本见 `docs/BUG_REGRESSIONS.md` **QA-20260911-015**。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 联调 `chat-test` | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | `https://api.lcppch.top/lanqi-test/` | `20260911-qa015-sku-link-test1` | `DEPLOY_OK` + `health=200 (after 15s)` / `ready=200` |
| 生产 `chat` | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | `https://api.lcppch.top/os-v2/` | `20260911-qa015-sku-link-prod1` | `DEPLOY_OK` + `health=200 (after 15s)` / `ready=200` |

- 本包内容（前端路由 1 处 + 1 个回归脚本；发布包是工作区全量快照，同时带上了并行工作线已发布的产物）：
  - `apps/web/src/main.tsx`：新增 `isMarketplaceSkuCode(slug)`（判据：slug 含 `__`）与一条分支——`/agents/<zone>__<capability>`（如 `/agents/ipzone__vidrev`）交给货架详情页 `MarketplaceAgentDetailPage`，与单数 `/agent/<skuCode>` 同一个组件；其余 `/agents/<slug>` 仍走工作台智能体页 `AgentWorkspacePage`，行为不变。
  - `scripts/marketplace-sku-link-regression.mjs`：真实 Chromium 回归（桌面 1440 + 手机 390 × 货架 SKU），断言「不出现服务故障话术 / 不被强跳登录页 / 渲染出详情正文与『开发中』/ 详情数据来自 `200 /api/market/skus/<sku>` / 无 5xx / 无 console 错误」，失败时额外打印本轮 `/api/` 请求与页面异常。
- 迁移：两侧 `48 migrations found in prisma/migrations` / `No pending migrations to apply.`（无 schema 变更）；运行时守护 `prisma delegates OK: lanqiStoreGoal,lanqiMomentDraft,lanqiMomentUpgrade,lanqiMomentAsset,lanqiStoreProfile`。
- 备份与日志：生产备份 `/opt/baolu-backups/20260911-qa015-sku-link-prod1-before-baolu-os-v2/`（211M），测试备份 `/opt/baolu-backups/20260911-qa015-sku-link-test1-before-baolu-os-v2-test/`（181M）；日志 `/tmp/deploy-run-prod1.out` / `/tmp/deploy-run-test1.out`。**回滚**＝把对应备份目录还原回 `$APP` 并 `systemctl restart`，或直接重发上一包 `release-20260911-common-agents-label-full.tar.gz`。
- 发布后复验（2026-09-11 20:0x–20:1x，外网 + 服务器只读；未改数据）：
  - **产物一致性（生产）**：`verify-deploy.sh` → **VERIFY_OK**（`systemd_active=active`、`health/ready=200`、`src_data_sha` 与 `dist_data_matches_src` 均 `2eec39bd…`、`index_base_path=/os-v2/`、`market/skus` 契约 `skus_total=19` / `coming_soon=15` / `lanqi_brain_present=True`；`api-base` 记得以 `/` 结尾）。
  - **用户的原始链接（生产，真实 Chrome，匿名与手机都跑）**：`node scripts/marketplace-sku-link-regression.mjs --base https://api.lcppch.top/os-v2` → **ALL PASS（24 条断言 0 failed）**：`https://api.lcppch.top/os-v2/agents/ipzone__vidrev` 与 `.../agents/meiye__vidrev` 都直接渲染货架详情页（`📊 视频复盘智能体` + `创始人IP专区` / `美业专区` + 「开发中」），不再出现「服务暂时不可用」、不再被强跳登录页，`200 /api/market/skus/<sku>`，无 5xx、`console=0`；修复前同命令为 **12 failed**（详见 QA-20260911-015）。截图 `%TEMP%\sku-link-green-prod\`。
  - **同产物内测实例稳定性**：`--base https://api.lcppch.top/lanqi-test` 连跑 **5 轮 ALL PASS**（每轮 18 条断言）。
  - **生产页面探针**：`DEPLOY_CHECK_WEB_URL=https://api.lcppch.top/os-v2 node scripts/deployed-marketplace-browser-check.mjs` → **PASS**（`shelf` / `credits_yuan` / `coming_soon_count=45` / `detail_redo_copy` / `direct_test_entry` / `console_clean`）。
  - **运行面**：`systemctl is-active` 两侧 `active`，`NRestarts=0`，`journalctl -u baolu-os-v2 -p err --since '15 min ago'` = **No entries**。
  - **门禁**：`pnpm.cmd qa:fast` **PASS**；`pnpm.cmd --filter @baolu/web typecheck` / `build` 均 **PASS**。
- **尚未验收（需用户本人执行）**：手机上用真人微信扫码登录后，从分享链接点进这两个专区页的目视确认——生产走真人扫码，无法无人值守进入登录后页面；本轮已把「未登录打开链接」这一条真实浏览器路径覆盖（修复前会被强跳登录页，修复后直接看到详情页）。
- 运维提示：根分区 `/dev/vda3` 当前 **24G / 30G（84%，剩余 ≈4.7G）**，`/opt/baolu-backups` 与 `/opt/baolu-stage` 是主要占用方；下次发布前建议先清理过期备份与旧 stage 目录（本轮未删任何服务器文件）。

## 最新发布：20260911-common-agents-label-test1 / -prod1（2026-09-11，测试实例 + 生产）— 货架导航「我的智能体」改为「常用智能体」

发布包：`release-20260911-common-agents-label-full.tar.gz`（**9263958 B**，sha256 `0a90888775ddf484f396f040226bdd3ea8907f33f7fdee4a46bef1f9394a1540`，**1452 个文件**）。测试实例与生产共用同一份产物，两侧部署日志第 3 行 `archive sha256` 实测与本机一致（`0a908887…`）。发布 id 按环境分别记为 `20260911-common-agents-label-test1` / `20260911-common-agents-label-prod1`。策略同前：stage 构建 → 备份 → 全量叠加（不删除历史文件）→ 就地 `prisma generate` → migrate → 重启 → 健康轮询 → 校验 → 失败自动回滚。

起因：用户 2026-09-11 要求「我的智能体 改成 常用智能体」。这是**纯用户可见文案变更，不是缺陷修复**，因此未登记到 `BUG_REGRESSIONS.md`；验收证据见下方。**只改显示文案，`/mine`、`/my-ai` 路由路径一律不动**，既有链接与回归断言不受影响。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 联调 `chat-test` | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | `https://api.lcppch.top/lanqi-test/` | `20260911-common-agents-label-test1` | `DEPLOY_OK` + `health=200 (after 15s)` / `ready=200` |
| 生产 `chat` | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | `https://api.lcppch.top/os-v2/` | `20260911-common-agents-label-prod1` | `DEPLOY_OK` + `health=200 (after 15s)` / `ready=200` |

- 本包内容（5 个文件；发布包是工作区全量快照，同时带上了并行工作线已发布的产物）：
  - `apps/web/src/pages/MarketplaceApp.tsx`：顶栏 Tab 与 `/mine` 页标题由「我的智能体」改为「常用智能体」（两处，唯一面向用户的主口径）。
  - `apps/web/src/pages/KnowledgeBasePage.tsx`：企业知识库返回按钮「返回我的智能体」→「返回常用智能体」。
  - `apps/web/src/pages/AgentProductsApp.tsx`：智能体侧栏底部入口与「尚未开通」页返回按钮同步改为「常用智能体」/「返回常用智能体」。
  - `apps/web/src/styles/sitong-design.css`：仅更新分区注释，无样式行为变化。
  - 回归：`scripts/marketplace-mobile-layout-check.mjs` 的 Tab 文案断言与文件头注释同步为 `货架|常用智能体|积分充值`（不改断言强度，仍逐条校验 3 个 Tab 的宽度/高度与横向溢出）。
- 迁移：两侧 `48 migrations found in prisma/migrations` / `No pending migrations to apply.`（无 schema 变更）；运行时守护 `prisma delegates OK: lanqiStoreGoal,lanqiMomentDraft,lanqiMomentUpgrade,lanqiMomentAsset,lanqiStoreProfile`。
- 备份与日志：生产备份 `/opt/baolu-backups/20260911-common-agents-label-prod1-before-baolu-os-v2/`；测试备份 `/opt/baolu-backups/20260911-common-agents-label-test1-before-baolu-os-v2-test/`。**回滚**＝把对应备份目录还原回 `$APP` 并 `systemctl restart`；因是纯文案改动，也可以重发上一个包 `release-20260911-lq21-brand-launch-full.tar.gz`。
- 发布后复验（2026-09-11 19:3x–19:4x，外网 + 服务器只读；未改数据）：
  - **产物一致性（两侧）**：`bash /tmp/verify-deploy.sh <app> <service> <port> <web-url> <api-base> <vite-base>` → 两侧 **VERIFY_OK**（`systemd_active=active`、`health/ready=200`、`src_data_sha` 与 `dist_data_matches_src` 均等于 `2eec39bd…`、`index_base_path` 分别 `/lanqi-test/` 与 `/os-v2/`、`market/skus` 契约 `skus_total=19` / `coming_soon=15` / `lanqi_brain_present=True`）。**注意 `api-base` 必须以 `/` 结尾**（脚本会直接拼 `market/skus`）；漏掉斜杠时 nginx 的 SPA 兜底会返回 200 HTML，而后半段 JSON 解析必然 `VERIFY_FAILED`，这不是产品故障。
  - **手机布局 + Tab 文案（生产 + 测试实例，真实 Chrome 390×844 + 微信 UA）**：`MARKETPLACE_LAYOUT_CHECK_URL=… node scripts/marketplace-mobile-layout-check.mjs` → 生产 **PASS**（`topbar=390x100 tabs=货架:89x31|常用智能体:89x31|积分充值:89x31 overflowX=0 landscapeOverflowX=0`）、测试实例 **PASS**（`topbar=390x105`，同一组文案）；举证 `scrollWidthWithVisibleOverflow=390 / offenderCount=0`，截图 `%TEMP%\sitong-marketplace-mobile.png`（顶栏第二行实测渲染「常用智能体」）。
  - **生产页面探针**：`DEPLOY_CHECK_WEB_URL=https://api.lcppch.top/os-v2 node scripts/deployed-marketplace-browser-check.mjs` → **PASS**（`shelf` / `credits_yuan` / `detail_redo_copy` / `direct_test_entry` / `console_clean` 全 PASS）。
  - **登录入口渲染（生产）**：`pnpm.cmd auth:login-entry-production-check` → **PASS**（`root_to_home` / `legacy_market_redirect` / `login_page` / `open_registration_no_invite_code` / `mobile_login_button=301x46` / `legacy_paths` / `console_clean`）。
  - **运行面**：`systemctl is-active baolu-os-v2` = `active`，`NRestarts=0`，`journalctl -u baolu-os-v2 -p err --since '5 min ago'` = **No entries**。
  - **门禁**：`pnpm.cmd qa:fast` **PASS**；`pnpm.cmd qa:full` **PASS**（含 `qa:regression`、`build`、`api:runtime-data-check: PASS files=marketplace-v3.json`）。
- 同轮一并处理的非仓库动作：按用户要求删除三条 Codex 自动化（「微信手机与桌面端登录60分钟巡检」cron、「保禄每日AI增长执行与复盘」heartbeat、「美业底层能力开发接力」heartbeat）；删除前已把三份配置原文留档在 `scripts/tmp/automations-archive-20260911/`，需要时可手工重建。
- **尚未验收（需用户本人执行）**：手机上用真人微信扫码登录后，逐页确认「常用智能体」在真机微信内的显示与点击跳转（生产走真人扫码，无法无人值守进入登录后页面）。

## 最新发布：20260911-lq21-brand-launch-test1 / -prod1（2026-09-11，测试实例 + 生产）— 兰琪品牌 Logo 修正 + 上线板块收口

发布包：`release-20260911-lq21-brand-launch-full.tar.gz`（**9248209 B**，sha256 `24c61595407be94ee6c3d576f7fceb830485182400c7c79a1e49f6f1b7988d08`，**1451 个文件**）。测试实例与生产共用同一份产物，两侧部署日志第 3 行 `archive sha256` 实测与本机一致（`24c61595…`，均为 1451 文件）。发布 id 按环境分别记为 `20260911-lq21-brand-launch-test1` / `20260911-lq21-brand-launch-prod1`。策略同前：stage 构建 → 备份 → 全量叠加（不删除历史文件）→ 就地 `prisma generate` → migrate → 重启 → 健康轮询 → 校验 → 失败自动回滚；部署以 `setsid nohup` 后台运行。

起因：用户 2026-09-11 反馈「兰琪 logo 头像不对」以及「目前私域营销可以正常上线 其他板块显示开发中即可」。对应缺陷、根因与回归见 `docs/BUG_REGRESSIONS.md` **QA-20260911-014**（含修复前 5 passed / 30 failed 的红证与修复后 42 条真实浏览器断言的绿证）；任务卡 `docs/agents/lanqi-beauty/tasks/LQ-21-兰琪品牌标识与上线板块收口.md`。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 联调 `chat-test` | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | `https://api.lcppch.top/lanqi-test/` | `20260911-lq21-brand-launch-test1` | `DEPLOY_OK` + `health=200 (after 15s)` / `ready=200` |
| 生产 `chat` | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | `https://api.lcppch.top/os-v2/` | `20260911-lq21-brand-launch-prod1` | `DEPLOY_OK` + `health=200 (after 15s)` / `ready=200` |

- 本包内容（本轮新增 1 个静态资源 + 1 个回归脚本 + 1 个浏览器探针；发布包是工作区全量快照，同时带上了并行工作线已发布的产物）：
  - `apps/web/public/lanqi-logo.jpg`（**新增**，154399 B / 1920×1509，sha256 `b9e649195a6879c4244f0b425ef40e2d9c0f14130f470e6f64f01fce0f417c0f`，与 0909 原型 `assets/logo/lanqi-logo.jpg` 逐字节一致）。
  - `apps/web/src/components/lanqi-brain/LanqiBrainShell.tsx`：左上角品牌位由纯文本 `<span>兰琪</span>` 改为 `<img src={getAppPath("/lanqi-logo.jpg")} alt="兰琪·爱美荟" />`；`NAV` 每项新增 `status: "online" | "dev"`，**只有「私域营销」是 `online`**，其余 7 项渲染「开发中」徽标。
  - `apps/web/src/main.tsx`：新增单点开关 `export const LANQI_MOMENTS_ONLY_LAUNCH = true`——`/lanqi/acquire*`、`/lanqi/dashboard`、`/lanqi/goal-setting` 由「开发中」占位页接管；真实页面组件与路由分支**全部保留**，改回 `false` 即整体回滚。默认落地 `/lanqi` → `/lanqi/moments`（入口重定向 + 免登录门 `DirectTestLoginGate` + `packages/shared` 的 `defaultPath` 三处一致）。
  - `apps/web/src/pages/LanqiBrainHomePage.tsx`（板块总览只有「私域营销」`done=true`）、`LanqiPlaceholderPage.tsx`（新增 `LanqiDashboardInDevelopmentPage` / `LanqiAcquireInDevelopmentPage`，删掉「（已可用）」口径）、`LanqiMomentsHomePage.tsx`（返回链接改「板块总览」）、`apps/web/src/lib/lanqi-store-gate.ts`（门店弹窗返回入口改 `/lanqi/brain`）、`apps/web/src/styles/lanqi-moments.css`（`.lq-pd__logo` 对齐原型 `.sh-icon` 48×40/圆角/白底/`object-fit:contain`，新增 `.lq-pd__badge--dev`）、`packages/shared/src/index.ts`（兰琪 `defaultPath`）。
  - 回归：`scripts/lanqi-brand-nav-contract-smoke.mjs`（新增，35 条只读源码契约，已接入 `pnpm.cmd qa:fast` 的 `lanqi:brand-nav-contract-smoke`）、`scripts/lanqi-brand-nav-browser-e2e.mjs`（新增，真实 Chromium 桌面 1440 + 移动 390，42 条断言）。
- 迁移：两侧 `48 migrations found in prisma/migrations` / `No pending migrations to apply.`（无 schema 变更）；运行时守护 `prisma delegates OK: lanqiStoreGoal,lanqiMomentDraft,lanqiMomentUpgrade,lanqiMomentAsset,lanqiStoreProfile`。
- 备份与日志：生产备份 `/opt/baolu-backups/20260911-lq21-brand-launch-prod1-before-baolu-os-v2/`，部署日志 `/tmp/deploy-run-20260911-lq21-brand-launch-prod1.log`；测试备份 `/opt/baolu-backups/20260911-lq21-brand-launch-test1-before-baolu-os-v2-test/`，日志同名 `-test1-`。**回滚**＝把对应备份目录还原回 `$APP` 并 `systemctl restart`（或仅把 `LANQI_MOMENTS_ONLY_LAUNCH` 改回 `false` 后重发一个包）。
- 发布后复验（2026-09-11，外网 + 服务器只读；未改数据）：
  - **产物一致性（生产）**：`verify-deploy.sh` → **VERIFY_OK**（`systemd_active=active`、`health/ready=200`、`src_data_sha` 与 `dist_data_matches_src` 均 `2eec39bd…`、`index_base_path=/os-v2/`、`market/skus` 契约 `skus_total=19` / `coming_soon=15` / `lanqi_brain_present=True`）。
  - **兰琪工作台页面（内测实例，真实 Chrome）**：`node scripts/lanqi-brand-nav-browser-e2e.mjs --base https://api.lcppch.top/lanqi-test` → **PASS (0 failed，42 条断言)**——品牌位真图 `naturalWidth=1920`、侧栏 8 项其中 7 项带「开发中」徽标、「私域营销」无徽标、默认落地 `/lanqi/moments`、9 个未上线路由逐个落在兰琪自己的「开发中」占位页、桌面/移动无横向溢出、`console=0 / page=0`；截图 `%TEMP%\lanqi-brand-nav-e2e\desktop-1440.png`、`mobile-390.png`。
  - **生产产物级**：`curl https://api.lcppch.top/os-v2/lanqi-logo.jpg` → `200 image/jpeg 154399 B`；服务器 `apps/web/dist/lanqi-logo.jpg` sha256 `b9e64919…` 与源码资源一致；生产首页实际引用的 `assets/index-BxB8zc9L.js` → `assets/LanqiBrainShell-B8lFNuCX.js`（3168 B）内含 `lanqi-logo` / `开发中` / `/lanqi/moments`；生产 `/etc/baolu-secrets/baolu-os-v2.env` 无 `VITE_DIRECT_TEST_LOGIN`（免登录门关闭，渲染路径不变）。
  - **登录入口渲染（生产）**：`pnpm.cmd auth:login-entry-production-check` → **PASS**（`root_to_home` / `legacy_market_redirect` / `login_page` / `open_registration_no_invite_code` / `mobile_login_button=301x46` / `legacy_paths` / `console_clean`）。
  - **运行面**：`systemctl is-active baolu-os-v2 baolu-os-v2-test` 均 `active`，`NRestarts=0`，`health` 两侧 `200`。
  - **门禁**：`pnpm.cmd qa:fast` **PASS**；相邻回归 `lanqi:moments-ui-contract-smoke` **19/0**、`lanqi:acquire-ui-contract-smoke` **45/0**、`lanqi:test-splash-contract-smoke` **14/0**。
- **尚未验收（需用户本人执行）**：生产实例上「真人微信扫码登录后进入兰琪工作台」的目视确认——生产走真人扫码，无法无人值守进入工作台，故生产侧证据只到「产物 + 首页渲染」层；真页面证据取自内测实例（与生产同一份产物，`VITE_DIRECT_TEST_LOGIN=true`）。另：用户此前提出的「爆款复刻接真实检索」「文案转片出片（`VIDEO_RENDERING_READY=false`）」「真人微信扫码给我链接」与 `git push` 重试，属另行跟进项，不在本包范围。

## 最新发布：20260911-mobile-topbar-prod1（2026-09-11，测试实例 + 生产）— 手机端顶栏布局修复 + 货架「退出登录」

发布包：`release-20260911-mobile-topbar-full.tar.gz`（**9101971 B**，sha256 `1d9744ed1882d33c11ca9d2fc37e2c4d3f4a7eab5f868d810436db143f3d3dfc`，**1448 个文件**）。测试实例与生产共用同一份产物，两侧部署日志第 3 行 `archive sha256` 实测与本机一致（`1d9744ed…`）。发布 id 按环境分别记为 `20260911-mobile-topbar-test1` / `20260911-mobile-topbar-prod1`。策略同前：stage 构建 → 备份 → 全量叠加（不删除历史文件）→ 就地 `prisma generate` → migrate → 重启 → 健康轮询 → 校验 → 失败自动回滚；部署以 `nohup` 后台运行。

起因：用户 2026-09-11 反馈「手机端显示页面不完整 还是得调调」与「已注册登入，登入之后如何要退出登入然后重新登入呢？」。对应缺陷、根因与回归见 `docs/BUG_REGRESSIONS.md` **QA-20260911-012**（含修复前 12 条 FAIL 的红证与修复后截图）。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 联调 `chat-test` | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | `https://api.lcppch.top/lanqi-test/` | `20260911-mobile-topbar-test1` | `DEPLOY_OK` + `health=200 (after 15s)` / `ready=200` |
| 生产 `chat` | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | `https://api.lcppch.top/os-v2/` | `20260911-mobile-topbar-prod1` | `DEPLOY_OK` + `health=200 (after 15s)` / `ready=200` |

- 本包内容（3 个源码文件 + 1 个回归脚本；发布包是工作区全量快照，同时带上了并行工作线的 2 个新脚本 `scripts/lanqi-test-instance-splash-browser-e2e.mjs`、`scripts/lanqi-test-splash-contract-smoke.mjs`）：
  - `apps/web/src/main.tsx`：新增 `MOBILE_MAX_WIDTH = 900` 与 `resolveDevice()`，`applyDevice()` 在启动 / `resize` / `orientationchange` 重算，替换原来写死的 `document.body.setAttribute("data-device", "desktop")`。**这是本次三处根因里最关键的一处**——写死 desktop 让 `sitong-design.css` 的 `body[data-device="mobile"]` 整套规则在真机上永不生效。
  - `apps/web/src/styles/sitong-design.css`：手机断点下 `.app-wrap` 去掉原型手机外壳改满宽 + `overflow-x:hidden`；顶栏改两行（`.topbar{flex-wrap:wrap}`、`.topnav` 折行、`.nav-link{flex:1 1 0;white-space:nowrap}`、钱包胶囊 `margin-left:auto;white-space:nowrap`）；新增 `.logout-link`；`:root[data-theme="light"]` 补 `--topbar-bg` / `--toast-bg` / `--ovl-bg` 浅色 token。
  - `apps/web/src/pages/MarketplaceApp.tsx`：`Topbar` 新增登录态与「退出登录」按钮（`clearStoredSession()` + 清 `sessionStorage.sitong_admin_token` + 写回跳 `/agents` + 跳 `/login`）。
  - 回归：`scripts/marketplace-mobile-layout-check.mjs`（修复前该脚本自身还有语法错误、完全跑不了；本轮先修脚本再修产品，并把「货架未加载完也放行」「`overflow-x:hidden` 藏溢出」两处假绿补成真断言）。
- 迁移：两侧 `48 migrations found in prisma/migrations` / `No pending migrations to apply.`（无 schema 变更）。
- 备份与日志：生产备份 `/opt/baolu-backups/20260911-mobile-topbar-prod1-before-baolu-os-v2/`（209M），部署日志 `/tmp/deploy-20260911-mobile-topbar-prod1-baolu-os-v2.log`；测试备份 `/opt/baolu-backups/20260911-mobile-topbar-test1-before-baolu-os-v2-test/`（179M）。**回滚**＝把对应备份目录还原回 `$APP` 并 `systemctl restart`。
- 发布前磁盘（观察项）：根分区 30G，本次发布期间最低到 **2.1G 可用（93%）**，未触发 ENOSPC，发布未被回滚。stage 目录仍占 ~6.8G、备份 ~6.9G；下次发布会前需要再腾挪。
- 发布后复验（2026-09-11 18:2x–18:3x，外网 + 服务器只读；未改数据）：
  - **产物一致性（两侧）**：`verify-deploy.sh` → **VERIFY_OK**（`systemd_active=active`、`health/ready=200`、`src_data_sha` 与 `dist_data_matches_src` 均等于 `2eec39bd…`、`index_base_path` 分别 `/lanqi-test/` 与 `/os-v2/`、`market/skus` 契约 `skus_total=19` / `coming_soon=15` / `lanqi_brain_present=True`）。
  - **手机布局（生产 + 测试实例，真实 Chrome 390×844 + 微信 UA）**：`node scripts/marketplace-mobile-layout-check.mjs` → 生产 **PASS**（`topbar=390x100 tabs=货架:89x31|我的智能体:89x31|积分充值:89x31 overflowX=0 landscapeOverflowX=0`），测试实例 **PASS**（`topbar=390x105`）。同一支脚本在修复前对生产是 **12 条 FAIL**（顶栏 222px、Tab 竖排 46px 宽、钱包 `right=418`、顶栏近黑）。新增取证 `scrollWidthWithVisibleOverflow=390 / offenderCount=0`。
  - **退出登录链路（测试实例，真实浏览器点按钮）**：`scripts/tmp/shelf-logout-browser-check.mjs` → **PASS**：`.logout-link` 文案「退出登录」、可见且不越界；点击后 `tokenAfter=""` / `onboardingToken=""` / `adminToken=""` / `postLoginRedirect="/lanqi-test/agents"` / URL = `/lanqi-test/login`。
  - **部署产物**：生产 `apps/web/dist/assets/MarketplaceApp-OReuTtMJ.js` 含 `logout-link`；主包 `assets/index-DpGo1cKf.js` 含 `MicroMessenger` / `900` / `data-device` / `orientationchange`。
  - **运行面**：`systemctl is-active baolu-os-v2 baolu-os-v2-test` 均 `active`，`NRestarts=0`；`journalctl -u baolu-os-v2 --since '-40 min' -p err` 与测试实例同口径均 **No entries**。
  - **门禁**：`pnpm.cmd qa:fast` **PASS**（结构检查 / Skill 质量资产 / Eval 结构 / 7 包 `typecheck`）。
- **尚未验收（需用户本人执行）**：真机上用另一个微信号重新登入后的完整体验（退出 → 重新扫码 → 回到货架）；以及 PLAT-13 的真人扫码闭环 7 条（清单见 `docs/agents/platform-tasks.md` PLAT-13）。

## 最新发布：20260911-all-inflight-full-prod1（2026-09-11，测试实例 + 生产）— 工作区在途改动全量发布（含 PLAT-13 电脑端微信扫码登录）

发布包：`release-20260911-all-inflight-full.tar.gz`（**9088300 B**，sha256 `95c169e6dabebc46d5a57c20edf290aa2e3ffd61f4316f0668e67de8d26b38c6`，**1446 个文件**）。测试实例与生产共用同一份产物，两侧部署日志首段 `archive sha256` 实测与本机一致（`95c169e6…`）。发布 id 按环境分别记为 `20260911-all-inflight-full-test1` / `20260911-all-inflight-full-prod1`。策略同前：stage 构建 → 备份 → 全量叠加（不删除历史文件）→ 第 7b 步在 `$APP` 就地 `prisma generate` 并按 `schema.prisma` 逐模型校验 → migrate → 重启 → 健康轮询 → 校验 → 失败自动回滚；部署以 `setsid nohup` 后台运行（规避 QA-20260910-019 的交互会话中断回滚）。

**这是用户拍板的「全量发布」，不是最小修复集**：按用户 2026-09-11 的决定，把工作区全部在途改动一次打包发到两个环境（此前提供的「只发登录扫码的最小包」选项被用户否决）。因此本包含多个互不相干的工作线，验收按各线各自的验收条件分别执行。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 联调 `chat-test` | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | `https://api.lcppch.top/lanqi-test/` | `20260911-all-inflight-full-test1` | `DEPLOY_OK` + `health=200 (after 12s)` / `ready=200` |
| 生产 `chat` | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | `https://api.lcppch.top/os-v2/` | `20260911-all-inflight-full-prod1` | `DEPLOY_OK` + `health=200 (after 15s)` / `ready=200` |

- 本包内容（23 个已跟踪文件修改 + 14 个新文件）：
  - **PLAT-13 电脑端微信扫码登录（新能力）**：新增 `apps/api/src/services/wechat-login-bridge.ts`、`apps/web/src/pages/WeChatBridgePage.tsx`、`apps/web/src/lib/wechat-bridge-session.ts`；`apps/api/src/routes/auth.ts` 新增 `/auth/wechat-bridge/session|status|qrcode|complete` 四条路由；`apps/web/src/pages/LoginPage.tsx`（电脑端出码 + 轮询自动登录）、`WeChatCallback.tsx`、`main.tsx`、`styles/store-growth.css` 配套改造。根因是电脑端此前把用户直接甩到 `open.weixin.qq.com` 的「请在微信客户端打开链接」死页。
  - **视频复盘引擎 + 货架改造**：新增 `apps/api/src/services/video-review-engine.ts`、`apps/web/src/marketplace/vidrev-report.tsx`；`apps/api/src/routes/marketplace.ts`（+332 行）、`apps/web/src/pages/MarketplaceApp.tsx`（+452 行）、`apps/web/src/marketplace/chat-flows.ts`、`apps/web/src/styles/sitong-design.css`。**注意：本次未改开卖状态**，`apps/api/src/data/marketplace-v3.json` 的 `ipzone__vidrev` 仍为 `coming_soon`（该文件 sha256 与部署脚本硬编码期望值 `2eec39bd…` 一致，开卖与否仍待用户单独确认）。
  - **试用积分发放**：新增 `apps/api/src/services/marketplace-trial-grant.ts`、`scripts/grant-marketplace-trial-credits.mjs` 及两个 smoke。
  - **兰琪顾问规则**：`apps/api/src/products/beauty-industry/advisor-rules.ts`、`advisor-service.ts` 及其 smoke。
  - **登录/会话与货架回归脚本**：`apps/web/src/lib/session.ts`、`RechargePage.tsx`、`LanqiAcquireMethodsPage.tsx`、`apps/web/index.html`；`scripts/login-entry-browser-smoke.mjs`、`login-entry-production-render-check.mjs`、`deployed-marketplace-browser-check.mjs`、`marketplace-shelf-browser-e2e.mjs`、`product-login-entry-smoke.mjs`。
  - 质量资产：`packages/agent/evals/sample-grade-cases.json`、`packages/skills/skills/baolu_review_engine/contract.json`、`package.json`（新增并接入 `qa:fast` 的登录/扫码相关 smoke）。
- 迁移：`48 migrations found in prisma/migrations` / `No pending migrations to apply.`（两侧一致，无 schema 变更）。运行时客户端守护：两侧 `prisma delegates OK: lanqiStoreGoal,lanqiMomentDraft,lanqiMomentUpgrade,lanqiMomentAsset,lanqiStoreProfile` + `prisma client model coverage OK: 99 models`。
- 备份与日志：生产备份 `/opt/baolu-backups/20260911-all-inflight-full-prod1-before-baolu-os-v2/`（208M，db=baolu_os_v2），部署日志 `/tmp/deploy-20260911-all-inflight-full-prod1-baolu-os-v2.log`（运行日志 `/tmp/deploy-run-20260911-all-inflight-full-prod1.log`）；测试备份 `/opt/baolu-backups/20260911-all-inflight-full-test1-before-baolu-os-v2-test/`（178M），日志同名 `-test1-` 两份。**回滚**＝把对应备份目录还原回 `$APP` 并 `systemctl restart`。两侧本次新增文件清单见各备份目录 `new-files.txt`（均 14 个，含 `wechat-login-bridge.ts`、`WeChatBridgePage.tsx`、`video-review-engine.ts`、`vidrev-report.tsx`、`marketplace-trial-grant.ts`）。
- 发布前磁盘腾挪（必做，否则 build 阶段会 ENOSPC 并触发回滚）：发布前根分区 30G 已用 26G/**1.9G 可用（94%）**。清理了 14 个历史构建暂存目录（`/opt/baolu-stage/20260910-*` 与 `ip-positioning-*`，纯 scratch，回滚资产在 `/opt/baolu-backups` 不受影响）与 `/tmp` 下已应用完的历史 `overlay-*` / `rel-files-*` / 旧 release 包，共释放约 3.4G；发布后为 **4.2G 可用（86%）**。
- 发布后复验（2026-09-11 13:56–14:02，外网 + 服务器只读；未改数据、未再发布）：
  - **产物一致性（两侧）**：`verify-deploy.sh` → **VERIFY_OK**（`systemd_active=active`、`health/ready=200`、`src_data_sha` 与 `dist_data_matches_src` 均等于 `2eec39bd…`、`index_base_path` 分别 `/lanqi-test/` 与 `/os-v2/`、`market/skus` 契约 `skus_total=19` / `coming_soon=15` / `lanqi_brain_present=True`）。
  - **PLAT-13 扫码登录（生产，真实外网只读）**：`scripts/tmp/prod-login-desktop-deadend-probe.mjs` → 点「微信登录」后 **`url_after_click=https://api.lcppch.top/os-v2/login`、`host_after_click=api.lcppch.top`、`dead_end_text=false`、`qr_shown=true`、`console_errors=[]`**，页面文案出现「请用微信扫这个码登录 / 等待扫码授权…」，截图 `C:\Users\book\.codex\visualizations\2026\09\11\01a08e77-df24-7b60-953b-7afda42f815a\prod-login-qr\prod-login-desktop-after-click.png`（修复前为跳 `open.weixin.qq.com` 死页，`dead_end_text=true` / `qr_shown=false`）。
  - **二维码落点与出码接口防护（生产实测）**：前端实际取的图 `https://api.lcppch.top/os-v2/api/auth/wechat-bridge/qrcode?u=https%3A%2F%2Fapi.lcppch.top%2Fos-v2%2Fwechat-bridge%3Fb%3D…%26s%3D…`，二维码内容仍是**同一站点**的中转页（无开放重定向）。`scripts/tmp/prod-wechat-bridge-qrcode-probe.sh` → 本站会话地址 `200` + `Content-Type: image/svg+xml`（真返回 SVG）；外部域名 `400 invalid_qrcode_target`；`javascript:` scheme `400`；真实主机 + 伪造会话 `404 wechat_bridge_not_found`（中文提示「登录二维码已失效，请回到电脑刷新二维码后重新扫码」）。测试实例与生产 `POST /auth/wechat-bridge/session` 均 `200` 且返回 `{id, secret, expiresAt, ttlSeconds:300}`。生产 `apps/web/dist/assets/` 存在 `WeChatBridgePage-CVOI36xW.js`、`wechat-bridge-session-DOVEjPNz.js`，`apps/api/dist/.../services/wechat-login-bridge.js` 存在。
  - **货架页页面级验收（生产，真实浏览器）**：`DEPLOY_CHECK_WEB_URL=https://api.lcppch.top/os-v2 node scripts/deployed-marketplace-browser-check.mjs` → **PASS**（`shelf=PASS credits_yuan=PASS coming_soon_count=45 detail_redo_copy=PASS direct_test_entry=PASS console_clean=PASS`），截图目录 `%TEMP%\deployed-marketplace-check-1789106649187\`；货架显示「全部 19 / 创始人IP 9 / 美业 9 / 兰琪 1」，`IP定位智能体 200 积分/次 · ≈ ¥10` 在售，`视频复盘智能体` 仍标「开发中 · 上线后按次计费」——与未改开卖状态一致。
  - **登录入口渲染**：`pnpm.cmd auth:login-entry-production-check` → **PASS**（`root_to_home` / `legacy_market_redirect` / `login_page` / `open_registration_no_invite_code` / `legacy_paths` / `console_clean` 全 PASS）。
  - **运行面**：`systemctl is-active baolu-os-v2 baolu-os-v2-test` → 两者 `active`，`NRestarts=0`；`journalctl -u baolu-os-v2 --since '-15 min' -p err` 与测试实例同口径均无条目。
- **尚未验收（需用户本人执行）**：真机微信扫码后的完整登录闭环（电脑端出码 → 手机扫码授权 → 电脑端自动进入并落到 `/agents`）。测试实例免登录、无法用于扫码验收，因此只能在生产由用户真人执行；清单在 `docs/agents/platform-tasks.md` 的 **PLAT-13「真人扫码验收清单」**（7 条），验收链接 `https://api.lcppch.top/os-v2/login`。对应的脱敏回归台账为 `docs/BUG_REGRESSIONS.md` **QA-20260911-011**。


## 最新发布：20260911-lq19-advisor-source-note-prod1（2026-09-11，测试实例 + 生产）— 兰琪 LQ-19 顾问「来源」标签口径修复

发布包：`release-20260911-lq19-advisor-source-note.tar.gz`（**8935546 B**，sha256 `88ff356f019439233c288eb81f5be2278d3315da67d9a47e94c14e414d1a0a50`，**1428 个文件**）。测试实例与生产共用同一份产物，两侧部署日志第 3 行 `archive sha256` 实测与本机一致（注：服务器 `/tmp` 上的该归档随后被并行任务的清理动作移除，sha256 证据留在两份部署日志与仓库本地归档中）。发布 id 按环境分别记为 `20260911-lq19-advisor-source-note-test1` / `20260911-lq19-advisor-source-note-prod1`。策略同前：stage 构建 → 备份 → 全量叠加（不删除历史文件）→ 第 7b 步在 `$APP` 就地 `prisma generate` 并按 `schema.prisma` 逐模型校验 → migrate → 重启 → 健康轮询 → 校验 → 失败自动回滚；部署以 `setsid nohup` 后台运行（规避 QA-20260910-019 的交互会话中断回滚）。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 联调 `chat-test` | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | `https://api.lcppch.top/lanqi-test/` | `20260911-lq19-advisor-source-note-test1` | `DEPLOY_OK` + `health=200 (after 12s)` / `ready=200` |
| 生产 `chat` | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | `https://api.lcppch.top/os-v2/` | `20260911-lq19-advisor-source-note-prod1` | `DEPLOY_OK` + `health=200 (after 15s)` / `ready=200` |

- 起因：用户在兰琪公域获客页 `#/lanqi/acquire/methods` 指着 AI 运营顾问回答底部的 `来源：xxx` 问「这个智能回复的来源是哪里？我们有蒸馏抖音/视频号/美团平台官方信息做 RAG 检索资料库吗？」。**核实结论：没有。** 顾问没有任何 RAG 检索链路、没有三家平台官方语料库、也没有对官方信息做过蒸馏；标签只有两处来源（模型在 `sources` 字段自拟，或 `buildSources()` 用 `ADVISOR_TOPICS` 六个话题的通用打法名补齐）。原写法会让门店误以为标签有真实出处，模型还可能写出「抖音官方算法文档」这类编造的权威出处。
- 本包内容（相对上一生产版本的最小修复集，共 5 个源码文件 + 3 个回归脚本）：
  - `apps/api/src/products/beauty-industry/advisor-rules.ts`：版本 `advisor_rules_v1` → **`advisor_rules_v2`**；新增出处红线 `SOURCE_OFFICIAL_CLAIM`（`官方|公告|通知|白皮书|算法文档|规则文档|内部资料|内部文件|红头|政策原文|平台文件`）与 `sanitizeSourceLabels()`；`buildSources()` 对**模型标签与确定性补齐标签都**过滤官方字样。
  - `apps/api/src/products/beauty-industry/advisor-service.ts`：版本 `advisor_service_v2` → **`advisor_service_v3`**；系统提示词 sources 行改为「2~3 个参考**方法**标签……严禁出现「官方、公告、算法文档、内部资料」这类字样——我们没有接入平台官方资料库」。
  - `apps/web/src/pages/LanqiAcquireMethodsPage.tsx`：标签前缀 `来源：` → `参考：`；notice `已附参考来源` → `已附通用打法参考`、`未附来源` → `未附参考`；标签块新增固定声明 `<p data-lanqi-advisor-source-note>以下为通用打法标签，按本店情况整理，不是平台官方发布</p>`。
  - `apps/web/src/styles/lanqi-moments.css`：新增 `.lq-adv__source-note`（11.5px / `#9A8B7D`）。
  - 回归：`scripts/lanqi-advisor-rules-smoke.ts`（**53/0**）、`scripts/lanqi-advisor-service-smoke.ts`（**39/0**）、`scripts/lanqi-acquire-ui-contract-smoke.mjs`（**45/0**）。红灯证据：修复前 `FAIL - 规则版本已声明` + `TypeError: sanitizeSourceLabels is not a function`。
- 迁移：`48 migrations found in prisma/migrations` / `No pending migrations to apply.`（两侧一致，无 schema 变更）。运行时客户端守护：两侧 `prisma delegates OK: lanqiStoreGoal,lanqiMomentDraft,lanqiMomentUpgrade,lanqiMomentAsset,lanqiStoreProfile` + `prisma client model coverage OK: 99 models`。
- 备份与日志：生产备份 `/opt/baolu-backups/20260911-lq19-advisor-source-note-prod1-before-baolu-os-v2/`（208M，db=baolu_os_v2），部署日志 `/tmp/deploy-run-20260911-lq19-advisor-source-note-prod1.log`；测试备份 `/opt/baolu-backups/20260911-lq19-advisor-source-note-test1-before-baolu-os-v2-test/`（178M），日志 `/tmp/deploy-run-20260911-lq19-advisor-source-note-test1.log`。**回滚**＝把备份目录还原回 `$APP` 并 `systemctl restart baolu-os-v2`；代码侧最小回滚点是 `advisor-rules.ts` + `advisor-service.ts` + `LanqiAcquireMethodsPage.tsx`。
- 发布后复验（2026-09-11 13:4x–13:5x，真实 Provider / 外网只读；未改业务数据、未再发布）：
  - **测试实例页面级（真实浏览器）**：`scripts/tmp/lq19-advisor-source-note-browser.mjs` 桌面 1440 + 移动 390 → **23/0**（标签 2~3 条、`参考：` 前缀、声明可见、notice「已附通用打法参考」、无横向溢出、console/page 错误 0）；截图 `scripts/tmp/lq19-browser-out/{desktop-1440,mobile-390}.png`。
  - **测试实例接口级**：`scripts/tmp/lq19-advisor-source-note-probe.mjs --rounds 3` → **17/0**（3 轮 dy/sph/mt 各 3 条 `sources`，无官方口径、无厂商名）。
  - **生产接口验收**：`scripts/tmp/prod-lanqi-lq19-acquire-acceptance.sh` → **16/16 PASS**（匿名 401 `login_required` / 无 entitlement 403 `product_entitlement_missing` / A 租户 `video/storyboard`、`video/shot`、`live/plan`、`copywriter` 全 200 / 缺必填 422 中文反问 / 跨门店 404 `store_not_found` 不回泄 B 门店 id / 全部响应不含模型厂商名）。
  - **生产顾问标签只读探针（本轮新增脚本）**：`scripts/tmp/prod-lq19-advisor-source-check.sh` → **16/16 PASS**（生产无 `dev-login`，改为按 `prod-lanqi-lq19-acquire-acceptance.sh` 同口径从生产 env 现场签发存量兰琪租户短时 token；dy/sph/mt 三问实测 `sources` 各 3 条如 `["本地推投放要点","抖音起号要点","AI模拟销售"]`、无官方口径、标签 ≤20 字、无厂商名）。首跑曾因 `/tmp` 存在 root 遗留的 `lq19-acquire-acceptance.json/.mjs` 导致写结果 `EACCES`（16/16 断言本身全 PASS），清理后 exit 0。
  - **部署产物**：生产 `apps/web/dist/assets/LanqiAcquireMethodsPage-BfHXCbQi.js` 实测含 `data-lanqi-advisor-source-note`、「不是平台官方发布」、「已附通用打法参考」、「参考：」；`apps/api/dist/apps/api/src/products/beauty-industry/advisor-rules.js` 含 `advisor_rules_v2` / `SOURCE_OFFICIAL_CLAIM`，`advisor-service.js` 含 `advisor_service_v3`；`systemctl is-active baolu-os-v2` = `active`。
- 与上一版的关系：本包是 LQ-19 公域获客页在 `20260911-lq19-acquire-fixes-prod1` 之后的**文案口径收口包**，只含兰琪顾问标签相关改动；服务器上并行的 marketplace / 视频复盘改动**未**进入本包（打包时用 `scripts/tmp/lq-deploy-override/` 把 17 个非兰琪文件替换为服务器已部署版本），保持上一版内容。

## 最新发布：20260911-lq19-acquire-fixes-prod1（2026-09-11，测试实例 + 生产）— WorkBuddy 报告核验后的 LQ-19 公域获客修复

发布包：`release-20260911-lq19-acquire-fixes.tar.gz`（**8935166 B**，sha256 `641b9807fb1363be5bffde749441c0578601faa26868e8100952e73eb8a34d4f`，**1429 个文件**）。测试实例与生产共用同一份产物，两侧部署日志第 3 行 `archive sha256` 实测与本机一致。发布 id 按环境分别记为 `20260911-lq19-acquire-fixes-test1` / `20260911-lq19-acquire-fixes-prod1`。策略同前：stage 构建 → 备份 → 全量叠加（不删除历史文件）→ 第 7b 步在 `$APP` 就地 `prisma generate` 并按 `schema.prisma` 逐模型校验 → migrate → 重启 → 健康轮询 → 校验 → 失败自动回滚；部署以 `setsid nohup` 后台运行（规避 QA-20260910-019 的交互会话中断回滚）。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 联调 `chat-test` | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | `https://api.lcppch.top/lanqi-test/` | `20260911-lq19-acquire-fixes-test1` | `DEPLOY_OK` + `health=200 (after 12s)` / `ready=200` |
| 生产 `chat` | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | `https://api.lcppch.top/os-v2/` | `20260911-lq19-acquire-fixes-prod1` | `DEPLOY_OK` + `health=200 (after 15s)` / `ready=200` |

- 起因：用户交来 WorkBuddy 两份走查报告（登录授权 + 公域获客），要求核验测试是否正确并修真 Bug。逐条核验结论见 `docs/BUG_REGRESSIONS.md` **QA-20260911-005**（登录 3 条「关键发现」全部是测试方法错误，登录链路不改代码；公域 9 条成立 3 条），并**由 #1 的 502 线索反向查出一个真 P1**：直播/顾问间歇性 422（实测 live 5/6、端到端走查 14/16）。
- 本包内容（相对上一生产版本的最小修复集）：
  - `apps/api/src/products/beauty-industry/moments-rules.ts`：新增 `PROMISE_CLAIMS`、否定语境判定 `isDisclaimedClaim()` 并导出 `containsPromiseClaims()`——不再把「我**不**敢保证」「没法**保证**」这类合规免责说法判成效果承诺（门禁不放宽）。
  - `apps/api/src/products/beauty-industry/live-service.ts`：`MAX_ATTEMPTS` 2 → **3**（软违规重写从 1 次增到 2 次）；改用 `containsPromiseClaims`；回灌提示点名违规词并要求「逐字删掉、不要换近义词保留」。
  - `apps/api/src/products/beauty-industry/advisor-service.ts`：`ADVISOR_MAX_ATTEMPTS` 2 → **3**。
  - `apps/web/src/pages/LanqiAcquireLivePage.tsx`：直播表单 5 个输入默认改为空、示例改 placeholder、新增「填入示例」按钮（避免默认生成别人家门店的逐字稿）；分批生成对 5xx/网络做有界退避重试并把 HTTP 状态告诉用户（`describeHttpFailure`）。
  - `apps/web/src/pages/LanqiAcquireMethodsPage.tsx`：快捷问题标点 `）` → `？`；`apps/web/src/styles/lanqi-moments.css`：新增直播页示例/错误块样式。
  - 新增/加强回归：`scripts/lanqi-acquire-ui-contract-smoke.mjs`（**37/0**，源码静态契约，不连网）并接 `package.json` 的 `lanqi:acquire-ui-contract-smoke`；`scripts/lanqi-live-service-smoke.ts`（43/0）/`scripts/lanqi-advisor-service-smoke.ts`（35/0）新增 4 组断言；`scripts/lanqi-acquire-instance-acceptance.mjs` 新增 2 条页面级断言。
- 迁移：`48 migrations found in prisma/migrations` / `No pending migrations to apply.`（两侧一致，无 schema 变更）。运行时客户端守护：两侧 `prisma delegates OK: lanqiStoreGoal,lanqiMomentDraft,lanqiMomentUpgrade,lanqiMomentAsset,lanqiStoreProfile` + `prisma client model coverage OK: 99 models`。
- 备份与日志：生产备份 `/opt/baolu-backups/20260911-lq19-acquire-fixes-prod1-before-baolu-os-v2/`（206M，db=baolu_os_v2），部署日志 `/tmp/deploy-20260911-lq19-acquire-fixes-prod1-baolu-os-v2.log`（运行日志 `/tmp/deploy-run-20260911-lq19-acquire-fixes-prod1.log`）；测试备份 `/opt/baolu-backups/20260911-lq19-acquire-fixes-test1-before-baolu-os-v2-test/`，日志同名 `-test1-` 两份。**回滚**＝把备份目录还原回 `$APP` 并 `systemctl restart`；代码侧最小回滚点是 `moments-rules.ts` + `live-service.ts` + `advisor-service.ts` + `LanqiAcquireLivePage.tsx`。
- 发布后复验（2026-09-11 08:2x，真实 Provider / 外网只读；未改业务数据、未再发布）：
  - **测试实例（`https://api.lcppch.top/lanqi-test/api`）**：端到端走查 `scripts/lanqi-acquire-llm-walkthrough.mjs` → **16/16 PASS**（顾问、直播第 1 批、垫场、文案转片全 200，输出不含模型/厂商名）；重复运行探针 `scripts/tmp/lq-422-probe.mjs --live=6 --advisor=3` → **live 6/6 · advisor 3/3**（修复前同口径为 live 5/6，第 1 次 422）；页面级探针 `scripts/lanqi-acquire-instance-acceptance.mjs` → **30/0**（含「默认不预填示例门店」「『填入示例』可一键回填」两条新断言）。
  - **生产（`https://api.lcppch.top/os-v2/`）**：接口验收 `scripts/tmp/prod-lanqi-lq19-acquire-acceptance.sh` → **16/16 PASS**（匿名 401 `login_required` / 无 entitlement 租户 403 `product_entitlement_missing` / A 租户 `video/storyboard`、`video/shot`、`live/plan`、`copywriter` 全 200 且分镜与直播骨架口径正确 / 缺必填 422 中文反问 / 跨门店 404 `store_not_found` 不回泄 B 门店 id / 全部响应不含模型厂商名）。
  - **部署产物**：生产 `apps/web/dist/assets/LanqiAcquireLivePage-*.js` 实测含 2 处「填入示例」；生产服务 `ActiveState=active`、`NRestarts=0`，`https://api.lcppch.top/os-v2/` 200。
- 与上一版的关系：本包是 LQ-19 公域获客页在 `20260911-lanqi-lq19-acquire-prod1` 之后的**收口修复包**，只含兰琪公域获客相关改动；服务器上并行的 marketplace/视频复盘改动**未**进入本包，保持上一版内容。

## 最新发布：20260911-wechat-login-failure-paths-prod1（2026-09-11，测试实例 + 生产）— 微信登录失败路径修正

发布包：`release-20260911-wechat-login-failure-paths.tar.gz`（**8916973 B**，sha256 `3bfebb5817cf45e965f0ad2184570270760c898a0f67e684ebf770b64dccfae3`，**1427 个文件**）。测试实例与生产共用同一份产物，两侧部署日志第 3 行 `archive sha256` 实测与本机一致。发布 id 按环境分别记为 `20260911-wechat-login-failure-paths-test1` / `20260911-wechat-login-failure-paths-prod1`。策略同前：stage 构建 → 备份 → 全量叠加（不删除历史文件）→ 第 7b 步在 `$APP` 就地 `prisma generate` 并按 `schema.prisma` 逐模型校验 → migrate → 重启 → 健康轮询 → 校验 → 失败自动回滚；部署以 `setsid nohup` 后台运行（规避 QA-20260910-019 的交互会话中断回滚）。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 联调 `chat-test` | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | `https://api.lcppch.top/lanqi-test/` | `20260911-wechat-login-failure-paths-test1` | `DEPLOY_OK` + `health=200 (after 9s)` / `ready=200` |
| 生产 `chat` | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | `https://api.lcppch.top/os-v2/` | `20260911-wechat-login-failure-paths-prod1` | `DEPLOY_OK` + `health=200 (after 15s)` / `ready=200` |

- 本包内容：`apps/api/src/services/wechat-auth.ts`（新增 `WechatOAuthExchangeError`，区分 `invalid_code` / `upstream_unavailable`）、`apps/api/src/routes/auth.ts`（401 `wechat_code_invalid` / 502 `wechat_upstream_unavailable` 分类映射，上游 `errmsg` 只进服务端日志）、`package.json`（新增并接入 `qa:fast` 的 `auth:wechat-login-failure-paths-smoke`）、`scripts/wechat-login-failure-paths-smoke.ts`。详见 `docs/BUG_REGRESSIONS.md` QA-20260911-004。
- 迁移：`48 migrations found in prisma/migrations` / `No pending migrations to apply.`（两侧一致，无 schema 变更）。运行时客户端守护：两侧部署日志第 132 行 `prisma client model coverage OK: 99 models`。
- 备份与日志：生产备份 `/opt/baolu-backups/20260911-wechat-login-failure-paths-prod1-before-baolu-os-v2/`，部署日志 `/tmp/deploy-20260911-wechat-login-failure-paths-prod1-baolu-os-v2.log`（运行日志 `/tmp/deploy-run-prod1.log`）；测试备份 `/opt/baolu-backups/20260911-wechat-login-failure-paths-test1-before-baolu-os-v2-test/`，日志同名 `-test1-` 两份。**回滚**＝把备份目录还原回 `$APP` 并 `systemctl restart`；代码侧最小回滚点是 `wechat-auth.ts` / `auth.ts` 两个文件。
- 发布后复验（2026-09-11 07:2x，外网只读；未改数据、未再发布）：
  - **失败路径**：`scripts/tmp/prod-lanqi-wechat-failure-paths.mjs` → 测试实例 **8/8 PASS**、生产 **8/8 PASS**；生产 A4 实测 `401 {"error":"wechat_code_invalid","message":"微信授权已失效，请返回登录页重新授权。"}`（修复前为 500 `internal_server_error`）。
  - **正路**：`scripts/tmp/prod-lanqi-login-readonly-check.mjs` → 兰琪品牌在、`/auth/wechat-config` = `{"configured":true,"appid":"wxf405233d62ec376a","inviteRequired":false}`、`consoleErrors=[]`。
  - **运行面**：`systemctl is-active baolu-os-v2 baolu-os-v2-test` → 两者 `active`；`journalctl -u baolu-os-v2 --since "-90 min" -p err` 无条目。
- 与真人扫码（③）的关系：失败路径已固化成可重复探针（无需真人、不消耗邀请码席位）；正常路径仍待 WorkBuddy/用户用 `cmengtv` 微信完成 `snsapi_userinfo` 授权并补门店资料。

### 生产数据动作：一次性验收租户回收（2026-09-11 07:15，生产 `baolu_os_v2`，可回滚）

- 回收对象：上一条目「② 产品邀请码注册 E2E」新建的一次性验收租户 `Tenant cmtw4ovd1057y13ka0xmza9n9`「兰琪注册验收门店-20260911」及其 `User cmtw4ovd7057z13ka4sj3osqw`。属**用户明确要求**的破坏性数据动作，执行前先全量备份。
- 删除前备份：`/opt/baolu-os-v2/.qa/qa-tenant-rollback-20260911-071559/`（122 个文件；按 `tenantId`/`userId` 导出所有含该列的表 CSV，非空 15 份，含 `Tenant` / `User` / `Membership` / `Store` / `TenantProfile` / `TenantProductEntitlement` / `TenantAgentEntitlement` / `CreditAccount` / `Wallet` / `InviteCodeRedemption` 等，另有 `InviteCode__before.csv`）。
- 执行（单事务）：`delete from "Tenant" where id='…'` → `DELETE 1`（指向 `Tenant` 的 59 个外键均为 CASCADE/SET NULL，无 RESTRICT 阻挡）；`delete from "User" where id='…'` → `DELETE 1`；`update "InviteCode" set "usedCount" = greatest("usedCount" - 1, 0) where id='…'` → 席位 `1 → 0`。**踩坑**：`InviteCodeRedemption` 只外键到 `InviteCode`、不级联 Tenant/User，首轮留下 1 行孤儿（`id=cmtw4ovh9059713kau9w1knzi`、`planCode=local_standard`），已按 `tenantId` 显式 `DELETE 1` 清掉。
- 回收后实测（2026-09-11 07:2x，生产只读复核）：`Tenant` 目标行 0、`User` 目标行 0、`InviteCodeRedemption` 0、`LanqiMomentUpgrade` 目标行 0、`LanqiMomentAsset` 目标行 0；`InviteCode` = `usedCount 0 / maxUses 5 / isActive true`（**席位从剩 4 恢复到满 5**）；`Tenant` 总数 208。
- **回滚**：按备份目录里的 CSV 逐表 `COPY` 回插（含 `InviteCode` 恢复 `usedCount=1`）。

## 发布：20260911-identity-p0-prod1（2026-09-11，测试实例 + 生产）— P0 身份头冒充修复

发布包：`release-20260911-identity-p0-prod1.tar.gz`（**8900152 B**，sha256 `5e5ca99d123133bcdd8b88a9eef895329c61ab059c983afa77cc220055299e5f`，**1426 个文件**）。本地构建产物 `%TEMP%\release-20260911-identity-p0-prod1.tar.gz` 与服务器 `/tmp/release-20260911-identity-p0-prod1.tar.gz` sha256 一致（部署日志第 3 行 `archive sha256` 复核）。测试实例与生产共用同一份产物，发布 id 按环境分别记为 `20260911-identity-p0-test1` / `20260911-identity-p0-prod1`。策略同前：stage 构建 → 备份 → 全量叠加（不删除历史文件）→ 第 7b 步在 `$APP` 就地 `prisma generate` 并按 `schema.prisma` 逐模型校验运行时客户端 → migrate → 重启 → 健康轮询 → 校验 → 失败自动回滚。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 联调 `chat-test` | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | `https://api.lcppch.top/lanqi-test/` | `20260911-identity-p0-test1` | `DEPLOY_OK` + `health=200 (after 9s)` / `ready=200` |
| 生产 `chat` | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | `https://api.lcppch.top/os-v2/` | `20260911-identity-p0-prod1` | `DEPLOY_OK` + `health=200 (after 15s)` / `ready=200` |

- 本包内容：`apps/api/src/services/request-context.ts` 的 P0 修复（database 模式身份只来自验签会话令牌；新增 fail-closed 的 `x-sitong-ops-token` 运维通道，见 `docs/BUG_REGRESSIONS.md` QA-20260911-002 / `docs/agents/platform-tasks.md` PLAT-08），随包上线 10 个夹具改真会话令牌、6 个运维脚本改显式运维凭证、新回归 `scripts/identity-header-spoof-smoke.ts`（已接 `qa:fast`）。QA-20260911-001 的仓库守护 `scripts/check-prisma-client-models.mjs` 与发布脚本第 7b 步一并生效。
- 迁移：`48 migrations found in prisma/migrations` / `No pending migrations to apply.`（两侧一致，无 schema 变更）。
- 运行时客户端守护：生产部署日志第 132 行 `prisma client model coverage OK: 99 models in /opt/baolu-os-v2/node_modules/.pnpm/@prisma+client@5.17.0_prisma@5.17.0/node_modules/.prisma/client`。
- 备份与日志：生产备份 `/opt/baolu-backups/20260911-identity-p0-prod1-before-baolu-os-v2/`（部署前目录快照），发布日志 `/tmp/deploy-20260911-identity-p0-prod1-baolu-os-v2.log`；测试备份 `/opt/baolu-backups/20260911-identity-p0-test1-before-baolu-os-v2-test/`，日志 `/tmp/deploy-20260911-identity-p0-test1-baolu-os-v2-test.log`。**回滚**＝把备份目录还原回 `$APP` 并 `systemctl restart`；代码侧最小回滚点是 `request-context.ts` 单文件。
- 发布后复验（2026-09-11 07:0x，服务器本机 + 外网；未改数据、未再发布）：
  - **正路仍通**（本机 `127.0.0.1:3002`，用生产 `JWT_SECRET` 现签真实会话令牌——令牌与密钥只在本机进程内使用，不落仓库/文档）：`/lanqi/stores` 200（返回兰琪租户真实门店）、`/lanqi/store-profile` 200、`/lanqi/dashboard?month=2026-09` 200、`/lanqi/goals?month=2026-09` 200、`/lanqi/moments/upgrades?storeId=…` 200、`/beauty-industry/stores` 200、`/market/skus` 200。
  - **运维通道**：正确 `x-sitong-ops-token` + 裸 `x-sitong-*` 头 → `/lanqi/stores` 200；错误 ops 令牌 → 401。
  - **冒充被拒**（外网 `https://api.lcppch.top/os-v2/api/lanqi/stores`）：匿名 401、裸身份头 401、裸头 + `Bearer not-a-real-token` 401、裸头 + 错误 ops 令牌 401、对照租户裸头 401；对照组（有 `founder-ip`、无 `lanqi`）真实令牌 → 403 `product_entitlement_missing`。
  - **公开面**：`/health`、`/ready`、`/auth/wechat-config`（`{"configured":true,"appid":"wxf405233d62ec376a","inviteRequired":false}`）、`/market/skus` 均 200。
  - **运行面**：`systemctl show baolu-os-v2` → `ActiveState=active` / `SubState=running` / `NRestarts=0`（`ExecMainStartTimestamp=Fri 2026-09-11 07:03:18 CST`）；`journalctl -u baolu-os-v2 --since "2026-09-11 07:00:00" -p err` 无新增条目（仅本次复验自己发起的匿名请求走既有 `missing_tenant_or_user` → 401 路径留下的 err 级记录），无 `Cannot read properties of undefined`。
- 真人微信扫码（本条目未执行，可由用户随时补做）：二维码已生成于本机 `%TEMP%\wechat-login-acceptance\login-qr.png`（平台入口）与 `lanqi-login-qr.png`（`/os-v2/login/lanqi`），待用户用未登录过思潼 AI 的微信扫码走完「授权 → 注册 → 落 `/os-v2/market`」；微信登录配置、`inviteRequired=false` 已就绪。
  - 扫码前的前置只读复验（2026-09-11 07:0x，真实 Chromium 打生产，`pnpm.cmd auth:login-entry-production-check`）：`PASS`——根路径落 `/os-v2/market`、`/login` 是平台登录/注册页、**手机视口 375×812 下「微信一键登录 / 注册」按钮 301×46 可见可点且在首屏内、页面无横向溢出**、开放注册下不出现邀请码入口、历史路径不 404、console 0 错误。截图 `%TEMP%\wechat-login-acceptance\login-mobile.png`（390×844，`innerWidth=390 / scrollWidth=390`）与 `login-lanqi-mobile.png`、`login-desktop.png`。该脚本原先断言「必须保留使用邀请码开通」（旧口径）导致误报，已按现行合同修正，见 `docs/BUG_REGRESSIONS.md` QA-20260911-003。

## 生产数据收尾：LQ-18 验收残留清理 + 产品邀请码注册 E2E（2026-09-11，仅数据/文档，无代码发布）

本轮**没有**代码发布，也不改任何应用代码；只做两件生产数据动作 + 一次生产端到端验收，因此没有新发布包、没有 migrate、没有重启服务（`baolu-os-v2` / `baolu-os-v2-test` 全程 `active`）。

### ① LQ-18 验收残留清理（生产 `baolu_os_v2`，可回滚）

- 删除 `LanqiMomentUpgrade cmtw353it057x12k47vkr6pux` 与其关联 `LanqiMomentAsset b0e32259-cc00-4bc0-a694-d502ad18bbde`，单事务执行，两行各 `DELETE 1`。
- 删除前核对：`LanqiMomentUpgrade=1`、`LanqiMomentAsset=1`、`assets_pointing_to_upgrade=0`；删除后两表 `=0`，2026-09-11 07:0x 只读复核仍为 0。
- 配图文件不删除，移到 `/opt/baolu-os-v2/.qa/lq18-cleanup-backup-20260911/`（原路径 `/opt/baolu-os-v2/uploads/moments/cmt6idd1c04v62hgb86gvh7pz/b0e32259-cc00-4bc0-a694-d502ad18bbde.png`，1957870 B，sha256 `fb665985f197dd5a05aa2f172cb44aa64995d146d858d429d6cac70e7cd62b9c`）；同目录含 `LanqiMomentUpgrade.csv`（1587 B）、`LanqiMomentAsset.csv`（414 B）。
- **回滚**：两条 CSV `COPY` 回表 + png 移回原路径。
- 库口径更正（再次确认，沿用上一轮结论）：生产 `DATABASE_URL` 指向 `baolu_os_v2`（取自 3002 进程环境）；仓库 `.env` 里的 `Sitong_os_v2` 凭据已失效。

### ② 兰琪产品邀请码生产注册端到端（消耗 1 席位，全项 PASS）

- 新建一次性验收租户：`Tenant cmtw4ovd1057y13ka0xmza9n9`「兰琪注册验收门店-20260911」（`local_business`／美业／上海，`2026-09-10 22:58:14 +08`）、`User cmtw4ovd7057z13ka4sj3osqw`、`Membership cmtw4ovdk058313kavgpgk7g2`（owner）、默认门店 `cmtw4ovdd058113kaggcmkfti`、`TenantProductEntitlement cmtw4ovi5059913ka9vkd5uxk`（`lanqi|active`、`source=product_invite`、`expiresAt 2026-10-10 22:58:14 +08`）。
- 席位账：生产 `lanqi` 产品邀请码 1 条（`maxUses=5`），核销后 `usedCount=1`，**剩余 4 席**。邀请码明文只在本机 `%TEMP%\lanqi-prod-auth-20260911\`，不入库/文档/报告。
- 脚本（本轮新增，提交 git，**不入发布包**——`build-prod-filelist.ps1` 按规则排除 `scripts/tmp/`）：`scripts/tmp/prod-lanqi-signup-acceptance.mjs`（页面级真实 Chromium 打生产，全项 PASS）、`scripts/tmp/prod-lanqi-new-tenant-browser-verify.mjs`（会话态页面复验 PASS，`consoleErrors=[]`）。**重复运行会再消耗 1 个席位**，运行前需重新确认。
- 只读接口复核（生产 3002，**服务端路由不带 `/api` 前缀**）：新租户 6 条读接口全 200；存量兰琪租户 A 只看到自己的门店；匿名 → 401 `login_required`。

### ③ 真人微信扫码（未执行）

- 生产微信登录配置只读核对正常：`/os-v2/api/auth/wechat-config` → `{"configured":true,"appid":"wxf405233d62ec376a","inviteRequired":false}`；链路为网页授权 `snsapi_userinfo`（非扫码登录）→ `/wechat-callback` → `POST /auth/wechat-login`。
- 2026-09-11 07:0x 复核：生产近 3 天新建 6 个租户全部来自邀请码/开放注册，**没有微信授权新建的租户**；`User.wechatOpenid` 非空 17 人（均为历史）。需 WorkBuddy/用户用 `cmengtv` 微信在浏览器完成授权 + 补门店资料。

### 本轮 git 与同步状态

- 仓库**无任何 git 远端**：`git remote -v` 空、`.git/config` 无 `[remote]`、无 `refs/remotes`、无 `FETCH_HEAD`；本机 GitHub Desktop（3.6.4/3.6.5）日志显示该目录只是「adding repository at …（本地添加）」，从未 clone/fetch/publish，日志中无任何 `github.com` URL；`gh` CLI 未安装。本机 git 身份 `renpolu123-png <renpolu123@gmail.com>`。
- 因此本轮只做**本地提交**（HEAD 见 `git log -1`），无法 push；要上远端需先 `git remote add origin <url>`（用户在 GitHub Desktop 点 Publish repository 或自建空仓库后提供 URL）。
- 服务器侧文档同步：`docs/` 属发布清单内容，本轮改动随下次发布进生产/测试实例，也可按需手工同步；`scripts/tmp/` 按设计不进服务器树（服务器上 `scripts/tmp` 为空目录）。

## 最新发布：20260911-lanqi-lq19-acquire-prod1（2026-09-11，测试实例 + 生产）

发布包：`release-20260911-lanqi-lq19-acquire-test1.tar.gz`（8876681 B，sha256 `7272985e6e3ac50b6060085a1f0466828af4046cabd7830e5dd07b4b683d4879`，1422 个文件）。**测试实例与生产共用同一份产物**：服务器上只有这一份归档（`/tmp/release-20260911-lanqi-lq19-acquire-test1.tar.gz`），两侧部署日志第 0 步打印的 `archive sha256` 与该值一致；发布 id 按环境分别记为 `20260911-lanqi-lq19-acquire-test1` / `20260911-lanqi-lq19-acquire-prod1`。文件清单由 `scripts/tmp/build-prod-filelist.ps1` 从当前工作树（tracked + 未忽略 untracked）生成，比上一轮 1421 个多出 `scripts/check-prisma-client-models.mjs`（QA-20260911-001 的仓库守护）。策略同前：stage 构建 → 备份 → 全量叠加（不删除历史文件）→ migrate → **第 7b 步在 `$APP` 就地 `prisma generate` 并按 `schema.prisma` 逐模型校验运行时客户端** → 重启 → 健康轮询 → 校验 → 失败自动回滚。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 联调 `chat-test` | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | `https://api.lcppch.top/lanqi-test/` | `20260911-lanqi-lq19-acquire-test1` | `DEPLOY_OK` + 健康 200（after 9s）/ ready 200 |
| 生产 `chat` | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | `https://api.lcppch.top/os-v2/` | `20260911-lanqi-lq19-acquire-prod1` | `DEPLOY_OK` + 健康 200（after 15s）/ ready 200 |

- 本包内容（兰琪 LQ-19 公域获客，板块3）：枢纽 `/lanqi/acquire` + 四个子页 `video` / `copywriter` / `live` / `methods`；后端 `/lanqi/acquire/*`（短视频文案改稿、AI 运营顾问、直播话术「规则 5 轮 23 段骨架 + 19 批分批生成 + 5 类救场话术库」、文案转片分镜与单镜重写）。**两条 LQ-19 P1 收口随包进生产**（`docs/BUG_REGRESSIONS.md` QA-20260910-011 成稿步骤空白、QA-20260910-012 合规门禁误拦）。生产侧的实际增量还有部署守护 `scripts/check-prisma-client-models.mjs`——**上一轮记录里「第 7b 步与守护脚本尚未随包上线」的边界在本轮解除**：两份部署日志第 131/132 行分别打印 `prisma delegates OK: lanqiStoreGoal,lanqiMomentDraft,lanqiMomentUpgrade,lanqiMomentAsset,lanqiStoreProfile` 与 `prisma client model coverage OK: 99 models …`。
- 生产入口产物（线上只读复验）：`assets/index-Ugq-Ml5W.js`（与上一轮同名——LQ-19 的 web 代码在上一轮全树快照中已随包进生产，本包 web 侧无新增改动）；`apps/api/dist/apps/api/src/routes/acquire.js` 已在运行目录（14184 B，`2026-09-11 06:32`），`products/beauty-industry/video-script-service.js` 命中服务版本串 `lanqi-video-script/1.0`。测试实例产物为 `assets/index-D3_TBbMw.js`（base path 不同故哈希不同）。
- 生产迁移：`prisma migrate deploy` → 48 migrations found / No pending migrations to apply，本包不含新增 schema 变更（测试实例同为 48 / 无待应用）。
- 接口复验（**生产真机，本轮首次对 `/lanqi/acquire/*` 取证**，脚本 `scripts/tmp/prod-lanqi-lq19-acquire-acceptance.sh`，服务器本机 `http://127.0.0.1:3002`，**16/16 PASS**）：
  - 匿名 `POST /lanqi/acquire/{video/storyboard,video/shot,live/plan}` → `401 {"error":"login_required"}`（3/3）；无 `lanqi` entitlement 的对照租户 → `403 product_entitlement_missing`。
  - 兰琪租户 A：`video/storyboard` 200（`shotCount=1`、每镜 `prompt` 非空、`totalSeconds=11`、`sourceChars=50`、`serviceVersion=lanqi-video-script/1.0`）；`video/shot` 200（重出提示词含素材名）；`live/plan` 200（`rounds=5`、`segments=23`、`batches=19`，批次段号 1–23 全覆盖且无重复）；`copywriter` 200（走真实 Provider，正文非空，输出不含模型/厂商名）。
  - 失败路径：缺必填 `live/plan` → `422 invalid_live_input`「还差必填：店名 / 主播身份、主打项目 / 产品名、真实卖点、带货标的、平台」；空口播文案 `video/storyboard` → `422 invalid_video_script_input`「还差必填：口播文案」。
  - 租户隔离：A 用 B 的门店 id 请求 `video/storyboard` 与 `live/plan` → 均 `404 store_not_found`，响应体不含 B 的门店 id。
- 测试实例验收（`https://api.lcppch.top/lanqi-test`，全部实测 PASS）：`pnpm.cmd lanqi:acquire-instance-acceptance`（**本轮新增页面级探针**，28 项 0 失败：枢纽 5 张卡与链接指向含 `mode=script`／copywriter 四步骨架 + 清空后本地拦截／video 四页签 + 爆款复刻 fail-closed／门店素材成片与 AI 剪辑 offline／文案转片四步走通 +「确认并生成」走肖像授权弹层后仍 fail-closed（捕获「视频生成服务暂未开通」、出片请求 0）／live 必填缺失本地反问／methods 空输入禁用 + 6 chips／移动 390×844 无横向溢出／全页无模型厂商名／无 4xx5xx、console 与 page 0 错误）；`pnpm.cmd lanqi:acquire-smoke` 80/0；`pnpm.cmd lanqi:test-instance-acceptance` 14 项 0 失败（驾驶舱 / 目标设置 / 朋友圈 Bug1 / 工作台入口既有回归）。
- 未执行（口径说明）：生产没有 `DIRECT_TEST_LOGIN`（`/auth/dev-login` 404），依赖免登录的兰琪专项脚本不能打生产，生产侧改用上面的自签 JWT 只读接口取证；`VIDEO_RENDERING_READY` 未配置 → 真实出片仍 fail-closed（设计内行为，不是缺陷），爆款复刻无真实检索源同样 fail-closed。真人微信扫码注册端到端验收仍未执行（仍缺「从未登录过思潼 AI」的微信号）。
- 备份与回滚：生产 `/opt/baolu-backups/20260911-lanqi-lq19-acquire-prod1-before-baolu-os-v2/`（`app-before.tar.gz`、`db-before.sql.gz`、`dist-hashes-before.txt`、`new-files.txt`、`baolu-os-v2.env`、`baolu-os-v2.service.txt`）；测试 `/opt/baolu-backups/20260911-lanqi-lq19-acquire-test1-before-baolu-os-v2-test/`。发布日志 `/tmp/deploy-20260911-lanqi-lq19-acquire-prod1-baolu-os-v2.log`、`/tmp/deploy-20260911-lanqi-lq19-acquire-test1-baolu-os-v2-test.log`（结尾分别为 `DEPLOY_OK 20260911-lanqi-lq19-acquire-prod1 app=/opt/baolu-os-v2`、`DEPLOY_OK 20260911-lanqi-lq19-acquire-test1 app=/opt/baolu-os-v2-test`）；回滚由 `deploy-release.sh` 失败时自动执行。部署后 `df -h /opt` 余量 7.7 G。

## 上一轮：20260910-lanqi-lq18-closeout-prod1（2026-09-10，生产）

发布包：`release-20260910-lanqi-moments-wechat-asset.tar.gz`（8865072 B，sha256 `58ee722de78497ec810f5c52257080c28756b313e8b56203258d903740ad763c`，1421 个文件）。文件清单由 `scripts/tmp/build-prod-filelist.ps1` 从当前工作树（tracked + 未忽略 untracked）生成，比上一轮 1420 个多出 `scripts/lanqi-moments-asset-deployed-check.mjs`。策略同前：stage 构建 → 备份 → 全量叠加（不删除历史文件）→ migrate → 重启 → 健康轮询 → 校验 → 失败自动回滚；本地包与服务器 `/tmp/release-20260910-lanqi-lq18-closeout.tar.gz` 的 sha256 一致。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 生产 `chat` | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | `https://api.lcppch.top/os-v2/` | `20260910-lanqi-lq18-closeout-prod1` | `DEPLOY_OK` + 健康 200（after 15s）/ ready 200 |

- 本包内容（兰琪 LQ-18 收口）：① **QA-20260910-020** 微信群营销话术「生成不了」（主题不再必填 + 按钮禁用写明原因 + 生成失败只回人话，不暴露模型名）；② **QA-20260910-022** AI 配图「没有正常生成」（资产 URL 跟随注册作用域，兰琪取图不再 403 破图）；③ 同批带上此前只在 TEST 验证、生产尚未部署的 **QA-20260910-021** 开放注册修复。清单为全树快照，因此同时包含兰琪公域获客（LQ-19）本机已完成、尚未在测试实例验收的改动。
- 生产迁移：`prisma migrate deploy` → 48 migrations found / No pending migrations to apply，本包不含新增 schema 变更。
- 生产入口产物（线上只读复验）：`assets/index-Ugq-Ml5W.js`（上一轮 `assets/index-D2Psnwlm.js`）；`apps/web/dist/index.html` sha256 `25af41ba5d05b35207ba39ca6ba8d76dd0bbd1bf54f43e747b03975f54fc2f77`。
- 修复已在生产 dist 生效（只读关键字核对）：`apps/api/dist/apps/api/src/routes/moments.js` 命中 `userFacingGenerationError`（3 处）；`.../products/beauty-industry/moments-service.js` 命中 `resolveWechatTopic`（3 处）；`.../products/beauty-industry/moments-image.js` 命中 `normalizeAssetBasePath`（2 处）。
- 接口复验（线上只读，非合成）：外部 `https://api.lcppch.top/os-v2/` → 200；`/health` 200、`/ready` 200；匿名 `GET /os-v2/api/lanqi/stores` → `401 {"error":"login_required"}`（鉴权门禁正常）；兰琪 10 条 SPA 路由（`lanqi/brain`、`lanqi/moments`、`lanqi/moments/wechat-group`、`lanqi/acquire` 及 `video/copywriter/live/methods`、`lanqi/dashboard`、`lanqi/goal-setting`）全部 200。
- 页面复验（生产只读，真实 Chromium，非合成）：`prod_login_entry_readonly_check:PASS`（`root_market / anonymous / login_page / wallet_copy / wechat_button / wechat_config / invite_form / console_clean` 全 PASS，`invite_mode=open-registration`）；`prod-reference-case-readonly-check:PASS`（`ipzone__copy` 中性样例 / `meiye__copy` 美业样例）；`deployed_marketplace_browser_check:PASS`（`shelf / credits_yuan / coming_soon_count=45 / detail_redo_copy / direct_test_entry / console_clean`）。兰琪品牌入口 `https://api.lcppch.top/os-v2/login/lanqi` 渲染「兰琪美业…微信授权登录…产品邀请码*」，`/auth/wechat-config` 返回 `{"configured":true,"inviteRequired":false}`，console 0 错误（`scripts/tmp/prod-lanqi-login-readonly-check.mjs`，截图 `%TEMP%\lanqi-login-readonly-*\01-lanqi-login.png`）。
- 备份与回滚：`/opt/baolu-backups/20260910-lanqi-lq18-closeout-prod1-before-baolu-os-v2/`（`app-before.tar.gz` 205149881 B、`db-before.sql.gz` 7764158 B、`dist-hashes-before.txt`、`new-files.txt`（2 条）、`baolu-os-v2.env`、`baolu-os-v2.service.txt`）。发布日志 `/tmp/deploy-20260910-lanqi-lq18-closeout-prod1-baolu-os-v2.log`（结尾 `DEPLOY_OK 20260910-lanqi-lq18-closeout-prod1 app=/opt/baolu-os-v2`）；回滚由 `deploy-release.sh` 失败时自动执行。
- **兰琪生产授权现状（更新 2026-09-11，用户确认后已处理）**：`apps/api/src/server.ts:163` 给 `/lanqi` 作用域挂了 `requireProductEntitlement("lanqi")`。生产库 `TenantProductEntitlement` 现为 `takeaway|active 190`、`founder-ip|active 190`、`beauty-industry|active 6 / revoked 7`、**`lanqi|active 2`**（source `lanqi_launch_backfill_20260911`，`createdAt=2026-09-11 06:06:59 +08`，覆盖两个既有兰琪租户 `cmt6idd1c04v62hgb86gvh7pz`、`cmt6wlw7w0517pou3005wvk8o`，`expiresAt` 各自继承 `beauty-industry` 的 `2026-09-23`）。门禁验收（服务器本机 + 外网，实测）：兰琪租户 `/lanqi/stores`、`/lanqi/store-profile` → 200；对照租户（有 `founder-ip`、无 `lanqi`）`/lanqi/*` → 403 `product_entitlement_missing`；匿名 → 401。**同批暴露并已修复一个 P1（`docs/BUG_REGRESSIONS.md` QA-20260911-001）**：`/lanqi/dashboard`、`/lanqi/goals`、`/lanqi/moments/upgrades` 曾全部 500（`Cannot read properties of undefined`），根因是发布脚本只在 `$STAGE` 跑 `prisma generate`、第 7 步 overlay 排除 `node_modules`，生产运行时 Prisma 客户端缺 `LanqiStoreGoal` / `LanqiMomentDraft` / `LanqiMomentUpgrade` / `LanqiMomentAsset`；已在 `/opt/baolu-os-v2/packages/db` 就地 `prisma generate` + 重启修复（客户端备份 `/opt/baolu-backups/prisma-client-fix-20260911-061132/`），三个接口恢复 200。发布脚本已新增第 7b 步「就地生成 + 按 schema 校验运行时客户端」，`scripts/check-prisma-client-models.mjs`（`pnpm db:client-model-check`）已接入 `qa:fast`；两者**尚未随包上线**，下次发布随包生效。**边界（2026-09-11 06:07 +08 复核更正；本条 2026-09-10 21:07 版「没有任何 `lanqi` 邀请码」的记录已被生产实况推翻）**：`InviteCode.productCode` 分布现为 `<null> 129`、`beauty-industry 7`、**`lanqi 1`**（`id=cmtw2vdk1000014cb2gpbccn2`、`codePreview=la****2t`、label「兰琪美业生产首批开通 20260911」、`maxUses=5`、`usedCount=0`、`isActive=true`、无到期、`createdBy=codex:lanqi-prod-launch-20260911`、`createdAt=2026-09-11 06:07:18 +08`）——**该邀请码不是本轮创建的**（本轮只做 entitlement 补齐与 P1 收口）；产品邀请码兑换会按 `source=product_invite` 给新租户建 `lanqi|active` 授权（`apps/api/src/routes/auth.ts:725`），故 `/os-v2/login/lanqi` 的邀请码通道已有可用凭据，可开通席位上限 `maxUses-usedCount=5`。但**真人扫码注册端到端验收仍未执行**（当前没有「从未登录过思潼 AI」的微信号），且 `LanqiReferral` 仍 0 行。
- 本次未执行：依赖 `DIRECT_TEST_LOGIN` 的兰琪专项脚本（`lanqi:moments-asset-deployed-check`、`lanqi:moments-wechat-group-flow`、`lanqi:test-instance-acceptance`）**不能打生产**——生产无 `DIRECT_TEST_LOGIN`、`/auth/dev-login` 为 404，脚本还会创建真实一次性租户；生产侧改用上面的只读接口 + 真实 Chromium 入口复验。

## 本轮：开放注册（去掉邀请码）+ chat-test 真实支付验收（2026-09-10，仅 chat-test）

发布包：`release-20260910-open-registration-test.tar.gz`（8855012 B，sha256 `5dfa250edb035a6020f7417d920fa88513dd387f45237ff3413b57a90730a9dc`，1420 个文件）。文件清单取自测试环境上一轮发布的服务端清单 `/tmp/rel-files-20260910-lanqi-moments-wechat-asset-test.txt`（1420 条，本地逐条核对 0 缺失），策略同前：stage 构建 → 备份 → 全量叠加（不删除历史文件）→ migrate → 重启 → 健康轮询 → 校验 → 失败自动回滚。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 联调 `chat-test` | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | `https://api.lcppch.top/lanqi-test/` | `20260910-open-registration-test` | `DEPLOY_OK` + 健康 200（after 9s）/ ready 200 |
| 生产 `chat` | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | `https://api.lcppch.top/os-v2/` | `20260910-lanqi-lq18-closeout-prod1` | 已于 2026-09-10 随兰琪 LQ-18 收口发布上线（见上一节），本包的开放注册修复同批进生产 |

- 本包内容：① QA-20260910-021 的开放注册修复（`apps/api/src/routes/auth.ts` 的 `betaLoginSchema.inviteCode` 改可选、`apps/api/src/services/invite-codes.ts` 放行条件加 `!productCode`、`apps/web/src/pages/LoginPage.tsx` 开放注册下只留「微信一键登录 / 注册」）；② `scripts/product-login-entry-smoke.mjs` 新增 8 条契约断言；③ `scripts/tmp/prod-login-entry-readonly-check.mjs` 按 `INVITE_REQUIRED` 分流（开放注册必须断言无邀请码入口 / `forms=0` / `inputs=0`）。清单为全树快照，因此**同时包含另一任务（兰琪朋友圈微信群）自 20:15 之后的在途改动**，非本线程成果。
- 迁移：`prisma migrate deploy` 无待应用迁移（48 migrations found / No pending migrations），本包不含 schema 变更。
- 测试环境配置修复（本轮同批，非代码）：`/etc/baolu-secrets/baolu-os-v2-test.env` 第 29 行 `WECHAT_PAY_NOTIFY_URL` 原指向**生产**回调 `https://api.lcppch.top/os-v2/api/billing/wechat/notify`，测试订单支付后回调会打到生产 API 而订单只存在测试库（生产侧 404 `ORDER_NOT_FOUND`），测试单永不入账。已改为 `https://api.lcppch.top/lanqi-test/api/billing/wechat/notify`，备份 `/etc/baolu-secrets/baolu-os-v2-test.env.bak-20260910-notify-url-lanqi-test`（5036 B，root:root）。同批把测试环境 `INVITE_REQUIRED` 由 `true` 改为 `false`，与生产一致，用于验证开放注册链路。
- 接口复验（测试实例实测，修复后）：`POST /auth/beta-login` 空 body → `200`（建号成功，`dataMode=database`，新账号 `creditBalance=0`）；`{"inviteCode":""}` → `200`；`{"inviteCode":"bogus","productCode":"beauty-industry"}` → `403 invite_code_not_found`；`POST /auth/product-invite/validate` 带空邀请码 → `400`（产品入口 schema 仍必填）。
- 页面复验（**本机 production 构建 + 反代到测试实例**，`scripts/tmp/local-prod-login-preview.mjs`，真实 Chromium）：开放注册下 `/login` 只渲染「微信一键登录 / 注册」+「首次使用微信登录，会自动为你注册账号并开通工作区，不需要邀请码。」，`forms=0 / inputs=0 / 带邀请码按钮=0`，console 0 错误；`prod_login_entry_readonly_check:PASS`（`invite_mode=open-registration`）。负向对照（把 `/auth/wechat-config` 转写成 `inviteRequired=true`）仍渲染「使用邀请码开通」+ 邀请码必填表单，`prod_login_entry_readonly_check:PASS`（`invite_mode=invite-required`）。
  - 说明：测试实例 `/lanqi-test` 是 `DIRECT_TEST_LOGIN=true` 内测免登录实例，`/login` 会被免登录网关直接接管跳到工作区（实测 `https://api.lcppch.top/lanqi-test/login` → 302 到 `/lanqi-test/lanqi/dashboard`），因此登录页渲染验收**不能**在该实例上做（脚本第 0 步按 `QA-20260910-002` 明确拒绝）。本机 production 构建走的是与线上相同的 `mode="production"` 分支。
  - 本机渲染复验（2026-09-10 21:2x，真实 Chromium，`scripts/tmp/probe-login-open-registration.mjs`，用 CDP 在响应层改写 `/auth/wechat-config`）：`INVITE_REQUIRED=false` → 登录页正文只有「微信一键登录 / 注册」+「首次使用微信登录，会自动为你注册账号并开通工作区，不需要邀请码。」，无邀请码输入框、无「使用邀请码开通」入口，`consoleErrors=[]`；负向对照 `INVITE_REQUIRED=true` → 正文出现「（需邀请码）」与「使用邀请码开通」，并渲染邀请码必填表单。截图 `%TEMP%\login-open-registration.png`、`%TEMP%\login-invite-required.png`。（该脚本存在的必要性：本机 3011 端口被本地 dev API 占用，其 `.env` 为 `INVITE_REQUIRED=true`，production 构建又把 `?apiBase=` 覆盖限制在 `import.meta.env.DEV`，所以只能在浏览器响应层改写才能验开放注册分支。）
- 生产入口复验（2026-09-10 21:2x，只读 + 安全探针，线上非合成）：`prod_login_entry_readonly_check:PASS`（`invite_mode=open-registration`，`root_market / anonymous / login_page / wallet_copy / wechat_button / wechat_config / invite_form / console_clean` 全 PASS），`https://api.lcppch.top/os-v2/login` 渲染截图确认只有「微信一键登录 / 注册」+「不需要邀请码」，无任何邀请码入口（`%TEMP%\prod-login-check-0910\02-login-page.png`）。接口侧安全探针（**不建号**）：`POST /os-v2/api/auth/beta-login {"inviteCode":"","tenantName":""}` → `400` 且 `fieldErrors` **只有** `tenantName`（证明 `inviteCode` 已非必填，修复前这里会同时报 `inviteCode: Required`）；`{"inviteCode":"code-does-not-exist-0910"}` → `403 invite_code_not_found`（邀请制语义保留）；`GET /auth/wechat-config` → `{"configured":true,"inviteRequired":false}`。
- 真实支付验收（chat-test，真人微信扫码，¥50 = 最小档 `pack_50`）：准备脚本 `scripts/tmp/test-real-payment-prepare.mjs` 在测试实例真实下单并取到真实 `code_url`，凭证输出在 `%TEMP%\realpay-test-0910b\`（`wechatpay-qr.png` / `wechatpay-qr.svg` / `prepare-report.json`）。本轮共生成 3 张真实预支付订单，均为 `pack_50`（¥50 / 1000 积分）、钱包支付前 `paidBalance=0`：
  1. `cmtviwh0x023hdi46x84tfjyc`（租户 `cmtviwgug0220di46yaj070fx`，20:48 建，未支付过期）
  2. `cmtvjczst02b69efxfs2kha8y`（租户 `cmtvjczn4029p9efxx6ar3ri9`，`code_url=weixin://wxpay/bizpayurl?pr=5QQN4nlEwMO93MFB`，21:01 建）
  3. 兰琪任务同批另建 1 单（见下）
  **用户实测结论（2026-09-10 21:2x，用户本人微信扫码）**：扫码后正常进入微信支付付款页面，可正常付款 → **真实预支付链路（下单 → `code_url` → 微信收银台）已验证通过**。用户**未实际付款**，因此以下仍未验证：微信支付异步回调落地、`RechargeOrder` 转 `paid`、钱包 `paidBalance 0 → 1000` 入账、`WalletLedger` 流水。
- **本轮真实支付未完成的部分（明天继续）**：需要用户完成一次真实 ¥50 付款才能验收「回调 → 入账」。DB 实测（`lanqi_test` schema）3 张单均 `pending`、`Wallet.paidBalance` 全为 0、`WalletLedger` 无充值流水，与「未付款」一致，未产生资金损失。若原二维码已过期（订单建后 30 分钟失效），重跑：`$env:REALPAY_OUT_DIR="$env:TEMP\realpay-test-0911"; node scripts/tmp/test-real-payment-prepare.mjs`；付款后跑 `scripts/tmp/test-real-payment-verify.mjs` 复核入账。
- 支付回调配置说明：`mock-pay` 在 `NODE_ENV=production` 返回 404，两个实例都是 production，不能用 mock 代替真实回调。
- 本节当时未部署生产（本包是全树快照，会带上另一任务的在途改动，需先确认放行）；该批改动已于同日随 `20260910-lanqi-lq18-closeout-prod1` 上线生产，生产入口复验见上一节。

## 最近一次发布：20260910-copy-neutral-refcase-prod2（2026-09-10，生产 + 测试同包）

发布包：`release-20260910-copy-neutral-refcase.tar.gz`（8842136 B，sha256 `c1ef1da392c2d60f2ce8b9d9e0da3a83b29b853c572cbe657a6560932bccf063`，1419 个文件）。策略为「stage 构建 → 备份 → 全量叠加（不删除历史文件）→ migrate → 重启 → 健康轮询 → 校验 → 失败自动回滚」，两个环境同一份包，本地包与服务器 `/tmp` 上的 sha256 一致。

| 环境 | 目录 / 服务 / 端口 | 入口 | 发布 id | 结果 |
| --- | --- | --- | --- | --- |
| 联调 `chat-test` | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | `https://api.lcppch.top/lanqi-test/` | `20260910-copy-neutral-refcase-test` | `DEPLOY_OK` + 健康 200 / ready 200 |
| 生产 `chat` | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | `https://api.lcppch.top/os-v2/` | `20260910-copy-neutral-refcase-prod2` | `DEPLOY_OK` + 健康 200（after 15s）/ ready 200 |

- 本包内容（三处改动）：① QA-20260910-017 方案②（`reference-cases.ts` 4 条共用内核中性化 + `INDUSTRY_REFERENCE_CASES` 按完整 SKU 命中 + `MarketplaceApp.tsx` 改走 `referenceCaseForSku`）；② QA-20260910-018 登录死循环修复（`lib/session.ts` + `main.tsx` 的 `LoginSessionGate` + `/auth/wechat-config` 下发 `inviteRequired`）；③ **新用户不赠送任何欢迎积分**（`getInitialWorkspaceCredits` 默认返回 `0`，见下方口径变更）。
- 生产迁移：`prisma migrate deploy` 无待应用迁移（48 migrations found / No pending migrations），本包不含 schema 变更。
- 生产入口产物（线上只读复验，非合成）：入口 `assets/index-D2Psnwlm.js`，货架懒加载 chunk `assets/MarketplaceApp-NXm7kVbh.js`（51282 B）。该 chunk 内同时含通用中性样例（`本地门店` / `#本地生意`）与美业样例（`美业门店` / `#美业老板`），即「通用专区走中性样例、美业专区保留美业样例」的方案②在线上生效。
- 页面复验（`scripts/tmp/prod-reference-case-readonly-check.mjs`，真实 Chromium）：`ipzone__copy` → 弹窗 `输入：本地门店 · 卖点=到店体验 · 目标=引流到店`、标签 `#本地生意 #开店日常 #到店体验 #门店经营`（无行业词）；`meiye__copy` → 恢复 `输入：美业门店 · 卖点=不破皮项目`、`#美业老板 #不破皮 #皮肤管理 #美容院经营`。`deployed_marketplace_browser_check:PASS`（`shelf / credits_yuan / coming_soon_count=45 / detail_redo_copy / direct_test_entry / console_clean` 全 PASS）。
- 登录入口复验（生产只读，`scripts/tmp/prod-login-entry-readonly-check.mjs`）：`prod_login_entry_readonly_check:PASS`——`root_market / anonymous / login_page / wallet_copy / wechat_button / wechat_config / invite_form / console_clean` 全 PASS；`/os-v2/login` 渲染「微信一键登录 / 注册」+「使用邀请码开通」。
- 生产内测免登录门禁（P0 预检）：`/etc/baolu-secrets/baolu-os-v2.env` **不含** `VITE_DIRECT_TEST_LOGIN`（测试环境有 2 处），故生产不是免登录内测实例；另加运行时门禁 `scripts/tmp/prod-build-direct-test-login-runtime-check.mjs`（真实 Chrome 打本地生产构建）PASS。
- 备份与回滚：生产 `/opt/baolu-backups/20260910-copy-neutral-refcase-prod2-before-baolu-os-v2/`（`app-before.tar.gz` 204661382 B、`db-before.sql.gz` 7753579 B、`dist-hashes-before.txt`、`new-files.txt`）与 `…-prod-before-baolu-os-v2/`（首次尝试）、测试 `…-test-before-baolu-os-v2-test/`。发布日志 `/tmp/deploy-20260910-copy-neutral-refcase-prod2-baolu-os-v2.log`（结尾 `DEPLOY_OK 20260910-copy-neutral-refcase-prod2`）。回滚由 `deploy-release.sh` 失败时自动执行。
- 本轮发现的**发布缺陷**：首次经交互式 SSH 会话跑部署时，会话在第 5 步打包 200MB 备份时中断，脚本回滚报 `tar: Unexpected EOF`。事后核对生产 `dist` 哈希与 before 完全一致、服务 200，**未造成损坏**。改用 `setsid nohup` 脱离会话后成功。详见 `docs/BUG_REGRESSIONS.md` **QA-20260910-019**。

### 口径变更（2026-09-10 产品拍板）：新用户不赠送任何积分

- `getInitialWorkspaceCredits(tenantType)` 默认由 **300 改为 0**，仅在显式配置 `NEW_USER_*_TRIAL_CREDITS` 时才发体验额度；`initialCredits > 0` 才写 `welcome_credits` 流水。生产/测试 env 均**未配置** `NEW_USER_*`。
- 影响：**生产新注册账号余额为 0 是预期行为，不是 Bug**。这使 `docs/BUG_REGRESSIONS.md` **QA-20260910-016** 里的「口径 B（300 聊天 + 300 货架 = 600）」失效——该修复的 `grantSignupWalletCreditsInTx` 现在收到 `amount=0`，按设计直接返回不发币。要开通用量就先充值。
- 遗留：`/chat`、`/billing/*`、`/beauty-industry/*` 仍读租户级 `CreditAccount`，货架读用户级 `Wallet`，双钱包迁移未完成（总量口径已不再承诺 300，故不阻塞发布）。

## 上一轮发布：20260910-credits-yuan-free-redo-prod1（2026-09-10）

发布包：`release-20260910-credits-yuan-free-redo-prod1.tar.gz`（8808083 B，sha256 `99ff9c7863c7992760105d03ea19061e9fa4c3bbab2ba3090c8541a7626e1337`）。策略为「stage 构建 → 备份 → 全量叠加（不删除历史文件）→ 迁移 → 重启 → 校验 → 失败自动回滚」，两个环境同一份包。

| 环境 | 目录 / 服务 / 端口 | 入口 | 结果 |
| --- | --- | --- | --- |
| 联调 `chat-test` | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | `https://api.lcppch.top/lanqi-test/` | `DEPLOY_OK` + `VERIFY_OK` |
| 生产 `chat` | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | `https://api.lcppch.top/os-v2/` | `DEPLOY_OK` + `VERIFY_OK` |

- 两个环境校验一致：`apps/api/src/data` 与 `dist` 的 `marketplace-v3.json` 哈希均为 `2eec39bd…3752e4`（P1 修复生效）；`/market/skus` 返回 19 个 SKU，`ipzone 9/7 开发中`、`meiye 9/7`、`lanqi 1/1`，`lanqi__lanqi-brain` 为 `coming_soon`（兰琪「私域营销」不在本线程上架）。
- 生产迁移：`202609090005_lanqi_moments`、`202609100001_lanqi_store_goals` 已应用（累计 48 条），`LanqiMomentDraft`、`LanqiStoreGoal` 表存在。
- 真实浏览器验收（无头 Chromium，非合成）：两环境 `deployed_marketplace_browser_check:PASS`——品牌区、`≈ ¥` 折算、`开发中` ≥ 7 处、详情页「免费重做」、console 0 错误。
- 备份与回滚：`/opt/baolu-backups/20260910-credits-yuan-free-redo-prod1-before-baolu-os-v2/`（含生产 `app-before.tar.gz`、`db-before.sql.gz`）与 `…-r2-before-baolu-os-v2/`（重跑备份）、`…-before-baolu-os-v2-test/`。回滚命令在发布日志 `/tmp/deploy-<rel>-<app>.log` 同级流程内（`deploy-release.sh` 失败即自动执行）。
- 本轮顺带修复的发布缺陷见 `docs/BUG_REGRESSIONS.md` **QA-20260910-015**（固定 6 秒健康检查窗口把生产冷启动 12 秒误判为失败并触发回滚）。
- 登录/注册入口（生产只读复验，`scripts/tmp/prod-login-entry-readonly-check.mjs`）：匿名落货架并提示未登录；`/os-v2/login` 渲染「微信一键登录 / 注册」+「使用邀请码开通」；`/auth/wechat-config` 返回 `configured=true`（appid `wxf405233d…`）；OAuth 回调落地 `/os-v2/wechat-callback` 返回 200；console 0 错误。已实现：微信一键登录/注册、邀请码开通工作区；**未实现**：手机号验证码、密码注册与找回（PLAT-01 明确不做）。
- 注册链路生产验收（2026-09-10，一次性邀请码代跑，非合成）：`node scripts/tmp/prod-signup-acceptance.mjs` 对生产 `https://api.lcppch.top/os-v2` 端到端走通「匿名落货架 → 邀请码开通 → 签发 token → 进 `/os-v2/market`」，**11 项全部 PASS**（`anonymousShelf / anonymousGate / loginPage / signupSubmit / walletPill / betaLoginResponse / sessionPersists / freshContextAnonymous / inviteCodeSingleUse / consoleClean`）。真实服务端响应：`tenantId=cmtvee4uq0585ulvli9zsozd9`、`userId=cmtvee4uu0586ulvlbah3dotb`、`dataMode=database`、`plan=local_standard`、`invite={source:"database",redeemed:true}`、`tokenIssued=true`；注册后 token 落 `localStorage.store_os_token`，已登录再访问 `/login` 直接回 `/market`，全新浏览器上下文（等同新设备）仍为未登录；一次性邀请码复用被拒（HTTP 403 `invite_code_exhausted`）；console 0 错误。截图与报告：`%TEMP%\prod-signup-acceptance\{01-anonymous-market … 05-session-persists}.png`、`signup-acceptance-report.json`。
- 货架匿名渲染复验（只读，`node scripts/tmp/prod-shelf-render-readonly-check.mjs`）：`prod_shelf_render_readonly_check:PASS`——匿名货架 19 张智能体卡、`loadingGone=true`、pill「🔒 未登录 · 点击登录」、console 0；截图 `%TEMP%\prod-signup-acceptance\shelf-loaded.png`。
- 临时邀请码 `qa-signup-20260910-01`（`id=cmtve7g3g0000z9gftrhc7qvp`，`maxUses=1`、`usedCount=1`）跑完即作废：`isActive=false`。本次代跑新建 4 个 QA 工作区（`cmtve9p5k053iulvl5w4gu3x8` / `cmtveangd0551ulvlz409rr56` / `cmtvedbff056kulvl0p8vco4t` / `cmtvee4uq0585ulvli9zsozd9`），各含 `User` + `InviteCodeRedemption` + `CreditAccount(300)` + `CreditTransaction(300, welcome_credits)`；生产库由 `Tenant 203 / User 197` 增至 `207 / 201`。按「生产删 Tenant 属高危」的规则**保留未删**。
- 仍未完成：**微信首次授权（扫码）一跳仍未真人验证**（本地无未注册过思潼 AI 的微信号，`chat-test` 是 `DIRECT_TEST_LOGIN=true` 内测免登录实例，登录回归在该实例上会按 `QA-20260910-002` 明确拒绝）。上面代跑走的是邀请码开通链路，与微信首登共用同一套 `/auth/beta-login` 服务端建号逻辑（建租户/建用户/发 token/建钱包/核销邀请码），但 OAuth 回跳落 `localStorage` 的那一跳仍需真人扫码确认。步骤：手机微信扫生产 `/os-v2/login` 的二维码 → 授权 → 确认落到 `/os-v2/market` 且钱包 pill 离开未登录态；用同一微信再点一次应为已登录。
- 注册链路暴露的 P1：新注册账号的用户级钱包（`Wallet`）为 0，货架 pill 显示「💎 0 积分 · ≈ ¥0」，而租户级 `CreditAccount` 是 300；`WalletLedger` 全表 0 行。详见 `docs/BUG_REGRESSIONS.md` **QA-20260910-016**。**当前状态：本地已修复、chat-test 已部署复验、生产未部署**（该修复会把新用户实际可用额度从 300 提到 600，属计费口径变更，需用户确认后再上生产）。

## 最近一次联调环境发布：20260910-signup-welcome-wallet（2026-09-10，仅 chat-test）

发布包：`release-20260910-signup-welcome-wallet.tar.gz`（8824721 B，sha256 `15c4fac1cbd0a4aaefa0746ef4f81826823681521fd14015608a2e3d3a81d042`，1416 个文件）。仅在联调环境叠加，**生产未变更**。

| 环境 | 目录 / 服务 / 端口 | 入口 | 结果 |
| --- | --- | --- | --- |
| 联调 `chat-test` | `/opt/baolu-os-v2-test` · `baolu-os-v2-test` · 3010 | `https://api.lcppch.top/lanqi-test/` | `DEPLOY_OK` + 健康 200 / ready 200 |
| 生产 `chat` | `/opt/baolu-os-v2` · `baolu-os-v2` · 3002 | `https://api.lcppch.top/os-v2/` | **未部署（等待计费口径确认）** |

- 内容：只含 QA-20260910-016 的最小修复（`apps/api/src/services/sitong-wallet.ts` 新增 `grantSignupWalletCreditsInTx`；`apps/api/src/services/database-bootstrap.ts` 在 `createTenantWorkspace` 同事务内补发用户级钱包欢迎积分）。
- 部署校验：stage 构建通过（`marketplace src=dist=2eec39bd…3752e4` 硬校验一致）、`prisma migrate deploy` 无待应用迁移（本包不含 schema 变更）、服务重启后健康轮询 9s 通过。
- 部署后功能复验（该环境真实建号，非合成）：临时一次性邀请码 `qa-wallet-20260910-01` → `POST /auth/beta-login` 建 `tenantId=cmtvf7sff01e6f9mgn258ospr / userId=cmtvf7sfi01e7f9mgllhz19qr`；`Wallet.paidBalance=0 / bonusBalance=300`，`WalletLedger` 恰 1 条 `delta=300 bucket=bonus type=bonus source=signup`，同租户 `CreditAccount=300` 未变。修复目标达成。
- 生产侧只读复验（未部署，只读）：`prod-shelf-render-readonly-check:PASS`（匿名货架 19 张卡、pill「🔒 未登录 · 点击登录」、console 0）、`prod-login-entry-readonly-check:PASS`（落货架 → `/login` 渲染微信一键登录/注册 + 邀请码开通、`/auth/wechat-config configured=true`、OAuth 回调 200、console 0）。**「点链接直接到首页且显示未登录」是匿名访客的预期行为**，不是故障。
- 回滚：`/opt/baolu-backups/20260910-signup-welcome-wallet-before-baolu-os-v2-test/`（含 `app-before.tar.gz`、`db-before.sql.gz`）；发布日志 `/tmp/deploy-20260910-signup-welcome-wallet-baolu-os-v2-test.log`。
- 生产发布就绪度：同一份包已可直接叠加到 `/opt/baolu-os-v2`（备份/回滚/健康轮询/`marketplace-v3` 哈希硬校验均已在脚本内），**只等计费口径确认**。

## 生产「新用户开通」第二轮代跑复验（2026-09-10 晚，只读 + 一次性代跑）

触发：用户反馈「点 `https://api.lcppch.top/os-v2/` 直接到首页且显示未登录」，且用户没有未注册过思潼 AI 的微信号，授权 Codex 代跑验收。

- 结论：**「点链接直接落首页 + 显示未登录」是匿名访客的预期行为，不是故障**。生产只读复验 `prod_shelf_render_readonly_check:PASS`（19 张智能体卡、pill `🔒 未登录 · 点击登录`、`loadingGone=true`、console 0）与 `prod_login_entry_readonly_check:PASS`（`root_market / anonymous / login_page / wallet_copy / wechat_button / wechat_config / invite_form / console_clean` 全 PASS）。
- 微信入口链路（只读）：`/os-v2/api/auth/wechat-config` 返回 `{"configured":true,"appid":"wxf405233d62ec376a"}`；`/os-v2/wechat-callback` 200；`open.weixin.qq.com/connect/oauth2/authorize` 可达。前端在 `handleWechatLogin()` 里直接跳 `scope=snsapi_userinfo`，因此**必须在微信内打开并扫码**，无法用无头浏览器代替。
- 代跑（真实浏览器，与服务端微信首登共用同一套 `/auth/beta-login` 建号逻辑）：临时一次性邀请码 `qa-signup-20260910-02`（id `cmtvffpxx00002buedkwlx163`）→ `prod_signup_acceptance:PASS` **11/11**：`anonymousShelf / anonymousGate / loginPage / signupSubmit / walletPill / betaLoginResponse / sessionPersists / freshContextAnonymous / inviteCodeSingleUse / consoleClean`。新工作区 `cmtvfg6kn059qulvl97ohjred`、`userId cmtvfg6kr059rulvlttpshfl2`、`plan=local_standard`、`creditBalance=300`、`invite={source:"database",redeemed:true}`、`tokenIssued=true`。截图 `%TEMP%\prod-signup-acceptance-02\01-anonymous-market.png … 05-session-persists.png`。
- 仍然复现 **QA-20260910-016**：同一次复验里货架 pill = `💎 0 积分 · ≈ ¥0 全平台通用`；DB 只读复核新用户 `Wallet(paidBalance=0, bonusBalance=0)`、`WalletLedger` 该用户 0 行（全表仍 0 行）、同租户 `CreditAccount=300`、`CreditTransaction(300, welcome_credits)`。即**生产仍未部署钱包修复，问题在生产依旧存在**。
- 货架状态（只读）：`/os-v2/api/market/skus` 共 19 个 SKU，`selling=4` / `coming_soon=15`；浏览器实测渲染 `🚧 开发中` 角标 **15 张卡**（创始人 IP 专区 6 个内核 + 1 个套装 = 7，美业 7，兰琪 1），`去看看 ›` 4 张卡。即「未完成内核改成『开发中』」在生产已生效。
- 环境健康与规模：`/os-v2/api/health` 200、`/os-v2/api/ready` 200（`dataMode=database`、`llm=deepseek-v4-pro`）、`/lanqi-test/api/health` 200；`baolu-os-v2` 与 `baolu-os-v2-test` 两个 systemd 服务 `active`。生产库 `Tenant 208 / User 202 / Wallet 6 / WalletLedger 0`。
- 一次性邀请码跑完即作废：`isActive=false`（`usedCount=1 / maxUses=1`）。本轮代跑新增 1 个 QA 工作区 `QA注册验收工作区-0910-02`，按「生产删 Tenant 属高危」**保留未删**。
- 仍未完成：微信首次授权（扫码）那一跳的真人验证——需在微信内打开 `https://api.lcppch.top/os-v2/login`，点「微信一键登录 / 注册」完成授权，确认落回 `/os-v2/market` 且钱包 pill 离开未登录态。

## 核心结论

本地最新版已于 2026-08-01 部署到：

```text
https://api.lcppch.top/os-v2/
```

- `GET /os-v2/api/health`：通过
- `GET /os-v2/api/ready`：通过
- 运行模式：`NODE_ENV=production`
- 数据模式：`DATA_MODE=database`
- PostgreSQL：连接正常
- 国内大模型：DeepSeek `deepseek-v4-pro`，已配置
- Original Skill MCP：状态正常
- Prisma migration：10个迁移全部完成
- 微信登录：配置检查通过
- 微信支付：预下单检查通过，正式收费开关仍可保持人工控制
- 生产 `launchMode`：`customer_ready`
- 品牌获客四场景：4/4通过
- 一次性邀请码并发：1个成功、1个拒绝，通过
- 双账号数据隔离：通过
- 后台运营、账务、质量、客户、邀请码审计：通过
- 长会话继续追问：通过；上一轮长交付物自动压缩，不再触发 `history` 过长的 400 错误
- 枕水江南招商续问验收：招商获客、直播话术、朋友圈私域 3/3 通过
- 企业入驻页测试报告整改：错误/加载状态互斥、防重复提交、空格名称拦截、表单可访问性与移动端排版通过
- 服务条款、隐私政策：独立公开页面已上线
- 美业行业 Agent 产品边界：仅保留“消费者到店增长”和“招商加盟增长”两条主线；培训招生、招店长合伙人、合伙人培养不作为美业标准能力
- CEO经营驾驶舱：已上线“推、看、决、令”四模块，支持经营资料就绪度、待老板审批的行动令草案、批准/驳回、完成/受阻和执行回流
- CEO经营驾驶舱视觉层：已上线动态经营雷达、经营中枢状态条和右侧经营态势图；图中数量只使用真实系统状态，未接入数据明确标为“待接入”
- 企业经营知识库对外命名已调整为“企业经营资料库”；底层知识分层、主体隔离和智能体共享机制保持不变

## 本地最新版已验证

- 品牌获客四场景自动验收：4/4 通过
- Agent 多 Skill 编排和复杂任务回归：通过
- 本地完整 Beta 冒烟：通过
  - 登录
  - 账户与套餐
  - 订单和积分
  - 真实模型聊天
  - 文件上传和分析
  - 录音卡分析
  - 报告生成
- 前端、API、数据库包类型检查：通过
- 生产构建：通过
- 一次性邀请码并发核销保护：通过
- 静态生产配置检查：在“邀请码登录＋手动开通”模式下通过

## 本次已收口的上线风险

1. 创建工作区和数据库邀请码核销已放入同一个数据库事务。
2. 一次性邀请码并发请求只能成功一次，失败请求不会留下半创建的工作区。
3. `prelaunch:check` 已补充 `KNOWLEDGE_CREDENTIALS_KEY` 强度检查。
4. 微信支付私钥、平台公钥同时支持“环境变量 PEM”和“服务器 PEM 文件路径”两种配置。

## 已完成的生产收口

1. 实际目录确认为 `/opt/baolu-os-v2`，systemd 服务为 `baolu-os-v2`。
2. 已补齐 `KNOWLEDGE_CREDENTIALS_KEY` 和 `SKILL_MCP_TOKEN`。
3. 已轮换生产 `ADMIN_TOKEN` 和 `OPS_TOKEN`。
4. 数据库、旧代码、生产 env、systemd 和 nginx 均已备份到 `/opt/baolu-backups/20260730-132320`。
5. 历史100次共享邀请码和历史5次邀请码均已停用。
6. 已创建两个新的内部A/B一次性邀请码，有效期至2026-08-29。
7. 内测邀请码明文交接保存在本地 `.deploy/思潼AI内部体验邀请码-20260730.txt`，不写入代码和公开文档。
8. 已于 2026-07-30 部署长会话热修复，回滚备份位于 `/opt/baolu-backups/20260730-143500-long-history-hotfix`。
9. 已于 2026-08-01 完成企业入驻页测试报告整改，补齐服务条款、隐私政策、favicon、页面说明及前后端字段校验。
10. 已于 2026-08-01 上线 CEO经营驾驶舱 MVP；部署前应用与数据库备份位于 `/opt/baolu-backups/20260801-ceo-cockpit-before-01`。
11. 已于 2026-08-01 上线 CEO经营驾驶舱视觉升级；部署前前端备份位于 `/opt/baolu-backups/20260801-ceo-visual-before-01`。
12. 已于 2026-08-03 上线 CEO驾驶舱正向平衡建议；老板建议默认按约一半问题优化、约一半优势放大组织，录音亮点必须带证据、放大动作和验证指标。部署前备份位于 `/opt/baolu-backups/20260803-ceo-positive-balance-before-01`。

## 下一步

1. 先使用内部A完整体验最新工作台。
2. 再使用内部B复核第二账号数据隔离。
3. 内部人工体验无问题后，分别为枕水江南、三禾糖水铺、初颜秘集创建客户专属一次性邀请码。
4. 客户邀请码不共用，`maxUses=1`。

## 不阻塞首批内测

- 微信网页授权：可以先保持 `WECHAT_AUTH_REQUIRED=false`，使用一次性邀请码登录。
- 微信支付：可以先保持 `WECHAT_PAY_REQUIRED=false`，采用人工收款、人工开通。
- 客户真实经营数据：先按 `[待补]` 运行，客户体验后再补，不阻塞开发和上线。
- OSS、小程序、自动投流、自动发视频：放到后续版本。

## 首批账号建议

先开两个内部账号，再开三个客户账号；全部使用一次性邀请码、`maxUses=1`。

| 批次 | 账号 | 套餐 | 用途 |
| --- | --- | --- | --- |
| 内部 | 内测A | `chain_premium` | 完整功能验收 |
| 内部 | 内测B | `chain_premium` | 与内测A做数据隔离 |
| 客户 | 枕水江南 | `chain_premium` | 沈阳7家外卖店线上订单增长 |
| 客户 | 三禾糖水铺 | `chain_premium` | 约30家门店招商加盟增长 |
| 客户 | 初颜秘集 | `chain_premium` | 3家美业门店消费者到店增长；后续可按实际需求评估招商加盟 |

每个新工作区当前默认发放 300 体验积分，足够完成一轮场景体验；正式套餐仍按产品定价和人工开通规则执行。
> **2026-09-12 真人验收（用户本人，生产）**：① **PLAT-13 电脑端扫码登录 — 通过**：用户打开 `https://api.lcppch.top/os-v2/login` 实测可用（先出现一层「正在确认登录状态」过渡页再进入微信登录页，用户确认无问题）；② **PLAT-14 退出→换账号重登 — 通过**：用户实测退出后换微信号重新登录可正常进入。**关于那层过渡页的说明**：它是 `LoginSessionGate` 的有意设计（仅当浏览器里**已存在会话 token** 且路由恰好是 `/login` 时触发；先探一次会话有效性——有效直接跳工作台、失效清 token 后渲染登录页、网络异常按未登录渲染），用于修掉历史缺陷 QA-20260910-018「token 失效后点一次登录被弹回首页一次」。它不会出现在无 token 的首次访问路径上。若日后仍嫌闪，可选优化：探针超过约 1.5 秒就直接渲染登录页（背景继续探），本轮未改。
