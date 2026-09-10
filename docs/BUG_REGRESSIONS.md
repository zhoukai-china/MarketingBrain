# Bug 回归台账

## QA-20260911-001：发布脚本只在 `$STAGE` 生成 Prisma Client，生产运行时客户端缺 4 个新模型，兰琪驾驶舱/目标页/朋友圈历史全部 500（P1，生产已修复并复验）

- 现象（真实生产，非合成）：兰琪生产授权补齐后（`TenantProductEntitlement` 出现两条 `lanqi|active`，source `lanqi_launch_backfill_20260911`），兰琪租户 `GET /lanqi/stores`、`GET /lanqi/store-profile` 正常 200，但 `GET /lanqi/dashboard?month=2026-09`、`GET /lanqi/goals?month=2026-09`、`GET /lanqi/moments/upgrades` 全部 500：错误码分别为 `lanqi_dashboard_error` / `lanqi_goals_error` / `moments_history_error`，message 统一为 `Cannot read properties of undefined (reading 'findUnique')`（朋友圈历史是 `findMany`）。服务器本机 `http://127.0.0.1:3002/...` 与外部 `https://api.lcppch.top/os-v2/api/...` 表现一致。
- 根因（发布工具，单一根因）：`scripts/tmp/deploy-release.sh` 第 3 步在 `$STAGE` 里执行 `pnpm --filter @baolu/db run prisma:generate`（发布日志第 20 行确认生成路径为 `/opt/baolu-stage/<rel>/node_modules/.pnpm/@prisma+client@5.17.0_prisma@5.17.0/node_modules/@prisma/client`），但第 7 步 overlay 只 `for d in apps packages docs mcp-skills scripts` 并显式 `--exclude=./node_modules`——**生成结果从未进入运行目录 `$APP`**。于是 `schema.prisma` 与数据库都已有 `LanqiStoreGoal` / `LanqiMomentDraft` / `LanqiMomentUpgrade` / `LanqiMomentAsset`（迁移 `202609090005_lanqi_moments`、`202609100001_lanqi_store_goals` 均已应用、表存在），而运行中的客户端 `index.d.ts` 停在 `2026-09-09 17:03`，四个模型在客户端里完全不存在 → `prisma.lanqiStoreGoal` 为 `undefined`。属「本地/构建通过、线上静默失败」的部署产物类缺陷。
- 影响面（修复前实测，8 条路由矩阵）：**500** = `/lanqi/dashboard`、`/lanqi/goals`、`/lanqi/moments/upgrades`（`POST /lanqi/moments/wechat-group` 走同一模型）；**200** = `/lanqi/stores`、`/lanqi/store-profile`、`/beauty-industry/stores`、`/health`、`/ready`；匿名 `/lanqi/*` → 401 正常；对照租户（有 `founder-ip`、无 `lanqi`）`/lanqi/*` → 403 `product_entitlement_missing`，未越权。
- 修复前红灯（未改动生产即取得）：按 `schema.prisma` 的 `model` 清单逐个比对运行时客户端，确认缺 4 个模型；再把发布前客户端备份还原到 `/tmp/oldclient` 用新增守护脚本校验 → `FAIL 运行时客户端缺少 4 个模型：LanqiStoreGoal / LanqiMomentDraft / LanqiMomentUpgrade / LanqiMomentAsset`，并告警「客户端 2026-09-09T09:03:45Z 早于 schema 2026-09-10T12:56:01Z」，`exit=1`。
- 最小修复：
  - 生产（运行时修复，已完成）：先备份客户端目录 → `/opt/baolu-backups/prisma-client-fix-20260911-061132/prisma-client-before.tar.gz`（sha256 `50f589c9371d4abd6c4d3be843a2d30b27cdc9738b9b3d3a4ea3a84636a07f17`），在 `/opt/baolu-os-v2/packages/db` 用生产 env 就地 `prisma generate`，再 `systemctl restart baolu-os-v2`。不改代码、不改数据库。
  - 发布工具（防复发）：`scripts/tmp/deploy-release.sh` 新增第 7b 步——在 `$APP` 就地 `prisma generate`，随后按 `schema.prisma` 的 `model` 清单逐个校验运行时客户端，缺任一模型即 `false`，交由既有 `restore_on_failure` 自动回滚。
  - 仓库守护：新增 `scripts/check-prisma-client-models.mjs`（入口 `pnpm.cmd db:client-model-check`），兼容 pnpm / 扁平布局与 `PRISMA_CLIENT_DIR` 显式指定，接入 `qa:fast` 首条。
- 修复后验收（同批实测，服务器本机 + 外网）：`/lanqi/dashboard`、`/lanqi/goals`、`/lanqi/moments/upgrades` 全部 200（`/lanqi/goals` 返回 `dataSource=database`）；`/lanqi/stores`、`/lanqi/store-profile`、`/beauty-industry/stores`、`/health`、`/ready` 仍 200；匿名仍 401；对照租户仍 403；守护脚本绿灯 `PASS 全部 99 个模型均存在`（`exit=0`）；`journalctl -u baolu-os-v2` 自重启点 `2026-09-11 06:11:40` 之后无新增 `Cannot read properties of undefined`（仅有的两条在 `06:11:08`，属修复前）。
- 状态：**已关闭（生产已修复并复验）**。发布脚本第 7b 步与 `qa:fast` 守护尚未随发布包上线，将在下一次发布时随包生效。

## QA-20260910-021：开放注册下 `/auth/beta-login` 仍把邀请码当必填（400）＋ «无邀请码即放行» 会放过产品入口（P1，平台登录入口，TEST + PROD 已复验）

- 现象（真实测试实例，非合成）：产品拍板「去掉邀请码，只留微信一键登录 / 注册」并把 `INVITE_REQUIRED=false` 下发到实例后，`POST /auth/beta-login` 不带邀请码直接返回 `400 invalid_request`，根本走不到服务端的放行分支。也就是说「登录页说不需要邀请码、接口仍拒绝建号」的不一致态。
- 修复前红灯证据（`https://api.lcppch.top/lanqi-test/api`，本轮部署前实测）：
  - 空串 `{"inviteCode":""}` → `http=400 {"error":"invalid_request","details":{"fieldErrors":{"inviteCode":["String must contain at least 1 character(s)"]}}}`
  - 缺字段 `{}` → `http=400 {"fieldErrors":{"inviteCode":["Required"]}}`
  - 乱码邀请码 → `http=403 invite_code_not_found`
  - 带产品码且缺邀请码 → `http=400 {"fieldErrors":{"inviteCode":["Required"]}}`
- 根因（两层，缺一不可）：
  1. `apps/api/src/routes/auth.ts` 的 `betaLoginSchema.inviteCode` 是 `z.string().trim().min(1).max(200)`，schema 在 `validateInviteCode` 之前就把缺省值打成 400；服务端开关 `INVITE_REQUIRED` 的放行分支（`invite-codes.ts` 里的 `!inviteRequired`）永远拿不到无邀请码的请求。
  2. 自查发现的越权风险：`/auth/onboarding/create-workspace` 的 `inviteCode` 本来就是 `optional()`，如果把 `validateInviteCode` 改成「无邀请码即放行」，那么带 `productCode`（美业 / 兰琪 / 创始人 IP / 外卖）的请求就能**不填邀请码**拿到受控产品的租户与品牌归属。
- 最小修复：
  - `apps/api/src/routes/auth.ts`：`betaLoginSchema.inviteCode` 改为 `z.string().trim().max(200).optional()`；**产品入口专用的 `productInviteValidationSchema` 仍保持 `.min(1)` 必填**，两条路径语义分离。
  - `apps/api/src/services/invite-codes.ts`：放行条件由 `!inviteRequired && !normalized` 收紧为 `!inviteRequired && !normalized && !productCode`——开放注册只放开平台主入口，产品入口的凭证（产品邀请码）始终校验。
  - `apps/web/src/pages/LoginPage.tsx`（generic 平台入口分支）：`invitesNeeded` 为假时不再渲染任何邀请码入口与邀请码输入框，只保留「微信一键登录 / 注册」；微信不可用（`wechatReady===false`）时才回落到人工开通表单。产品入口（`product` 分支）未改动。
  - `scripts/product-login-entry-smoke.mjs` 增加 8 条契约断言（beta schema 可缺省、产品 schema 仍必填、`!productCode` 条件、`invite_code_required` 分支保留、登录页不得再出现「有邀请码？用邀请码开通」与「选填：用于记录邀请渠道」、`showInviteForm` 表达式、邀请码输入框只在 `invitesNeeded` 下渲染）。
- 修复后证据（同一实例，部署 `20260910-open-registration-test` 之后实测）：
  - `beta-login {}` → `200`，建号成功（`dataMode=database`，`plan=local_standard`，新账号 `creditBalance=0`，与「新用户不赠送积分」口径一致）。
  - `beta-login {"inviteCode":""}` → `200`。
  - `beta-login {"inviteCode":"bogus-code-xyz","productCode":"beauty-industry"}` → `403 invite_code_not_found`（产品入口未被绕过）。
  - `product-invite/validate {"productCode":"beauty-industry","inviteCode":""}` → `400`（产品 schema 仍必填）。
  - 真实浏览器（本机 production 构建 + 反代到测试实例，`scripts/tmp/local-prod-login-preview.mjs`）：开放注册下登录页只渲染「微信一键登录 / 注册」+ 文案「首次使用微信登录，会自动为你注册账号并开通工作区，不需要邀请码。」，`forms=0 / inputs=0 / 带邀请码按钮=0`；同一构建把 `/auth/wechat-config` 改写成 `inviteRequired=true` 做负向对照，邀请制路径仍渲染「使用邀请码开通」入口 + 邀请码必填表单。两次 `prod_login_entry_readonly_check:PASS`，console 0 错误。
- 回归命令：`pnpm.cmd auth:product-login-smoke`、`pnpm.cmd qa:fast`；实例级：`node scripts/tmp/prod-login-entry-readonly-check.mjs`（本机 production 预览实例）。
- 状态：**TEST + PROD 均已复验**。TEST：`/opt/baolu-os-v2-test`，发布 id `20260910-open-registration-test`；PROD：随兰琪 LQ-18 收口包 `release-20260910-lanqi-moments-wechat-asset.tar.gz` 于 2026-09-10 上线（发布 id `20260910-lanqi-lq18-closeout-prod1`，`DEPLOY_OK` + 健康 200（after 15s）/ ready 200）。生产只读复验：`https://api.lcppch.top/os-v2/api/auth/wechat-config` 返回 `{"configured":true,"inviteRequired":false}`，`scripts/tmp/prod-login-entry-readonly-check.mjs` → `prod_login_entry_readonly_check:PASS`（`invite_mode=open-registration`，`/os-v2/login` 只渲染「微信一键登录 / 注册」，无邀请码表单，console 0 错误）。**注意边界**：开放注册只放开平台主入口；产品入口（兰琪 / 美业）仍要求产品邀请码，而生产当前没有任何 `lanqi` 邀请码，见下方 QA-20260910-020 状态与 `docs/CURRENT_DEPLOYMENT_STATUS.md`。
- 补充复验（2026-09-10 21:2x，本轮收尾；同一实例、非合成）：
  - TEST（`https://api.lcppch.top/lanqi-test/api`，`scripts/tmp/open-registration-test-verify.mjs`）**6/6 PASS**：`wechat-config.inviteRequired=false`；`beta-login` 空串邀请码与缺省邀请码均 `200` 建号成功（修复前 `400 fieldErrors.inviteCode`）；无效邀请码 `403 invite_code_not_found`；**带 `productCode=lanqi` 且空邀请码 `403 invite_code_required`**（产品入口未被绕过）；`product-invite/validate` 空邀请码 `400`（产品 schema 仍必填）。
  - 部署产物核对（TEST，只读）：`/lanqi-test/index.html` 实际加载的 `assets/LoginPage-DD4lyfsO.js` 中已无「有邀请码？用邀请码开通」「选填：用于记录邀请渠道」字面量，同时存在「不需要邀请码」「微信一键登录」。注意 `dist/assets` 下仍留有历史 `LoginPage-*.js` 旧 chunk（全量叠加发布不删除历史文件），但 `index.html` 不引用它们。
  - 渲染复验（本机 production 构建，真实 Chromium）：新增 `scripts/tmp/probe-login-open-registration.mjs`，用 CDP 在**响应层**改写 `/auth/wechat-config` 的 `inviteRequired`，分别渲染两个分支——开放注册只留「微信一键登录 / 注册」；邀请制仍渲染「使用邀请码开通」+ 邀请码必填表单，两种模式 `consoleErrors=[]`。
  - PROD 只读 + **不建号**安全探针：`POST /os-v2/api/auth/beta-login {"inviteCode":"","tenantName":""}` → `400` 且 `fieldErrors` 只有 `tenantName`（若 `inviteCode` 仍必填，这里会同时出现 `inviteCode` 报错）；`{"inviteCode":"code-does-not-exist-0910"}` → `403 invite_code_not_found`；`prod-login-entry-readonly-check:PASS`，`/os-v2/login` 截图确认只剩「微信一键登录 / 注册」。
  - 本轮真实支付验收（chat-test，¥50 最小档）**部分完成**：用户本人扫码已确认「扫码 → 微信支付付款页面」正常，但**未实际付款**，因此「回调 → `RechargeOrder.paid` → 钱包入账」仍未验证（DB 实测 3 张单 `pending`、`paidBalance=0`、无 `WalletLedger` 充值流水，未产生资金损失）。明天续做见 `docs/CURRENT_DEPLOYMENT_STATUS.md` 本轮小节。

## QA-20260910-020：微信群营销话术「生成不了」——主题被当必填 + 按钮禁用不说明原因（P1，LQ-18，已关闭）

- 现象（用户报障，非合成）：用户在内测实例打开「私域营销 → 微信群话术」，填了内容却「生成不了」；同一时段朋友圈页 `POST /lanqi/moments/upgrade` 正常 200，说明不是整站或登录问题。
- 真实环境证据：`journalctl -u baolu-os-v2-test` 从打开该页到离开，**没有任何 `POST /lanqi/moments/wechat-group`**；同租户 `GET /lanqi/stores` 连续 200。后端没被调用过 → 症状在前端。另用探针直接打后端 `POST /lanqi/moments/wechat-group` → 200（约 2.0s，5/5 合规检查 ok），证明**接口本身是好的**。
- 根因（三层，缺一都还会复现）：
  1. `apps/web/src/pages/LanqiMomentsWechatGroupPage.tsx` 按钮条件是 `disabled={loading || !storeId || !topic || !detail}`——把「主题」当必填；老板只填「具体内容」时按钮永远灰着。
  2. 灰着**不告诉原因**：页面没有任何禁用说明，和 QA-20260910-014 Bug9 的「按钮禁用无原因」是同一类，只是这次落在微信群子页。
  3. 后端同样把主题当必填：`WechatGroupInput.topic` 必填、缺主题抛「请填写要聊的主题」；且 Provider 侧错误串（`deepseek_provider_http_error` / `llm_provider_not_configured`）会被前端 `readResponse` 直接渲染到页面，违反 LQ-18 验收条件 3「不暴露模型名/厂商名」。
- 修复前红灯（新增 `scripts/lanqi-moments-wechat-group-flow.mjs`，真实 Chromium 打内测实例，修复前的旧构建）：`3 passed, 3 failed`——`只填「具体内容」即可生成群话术（主题可为空）` FAIL（`fill=filled disabled=true reason=null`）、`具体内容为空时按钮禁用且写明原因（不得静默变灰）` FAIL（`blockedReason=null`）、`「具体内容」字段有可见必填提示` FAIL（`detailHint=""`）。
- 最小修复：
  - `apps/api/src/products/beauty-industry/moments-service.ts`：`WechatGroupInput.topic` 改可选；新增导出 `resolveWechatTopic(topic, detail, scene)`——填了用填的，没填就从「具体内容」按 `\n。！？!?；;` 取第一句截断 18 字当标题，实在没有才回落场景名；新增内部 `rawInputLength(topic, detail)`，主题留空时 `rawLen` **只算具体内容**，不把派生标题重复计入字数；`generateWechatGroup` / `generateWechatGroupLlm` 都去掉「请填写要聊的主题」抛错。
  - `apps/api/src/routes/moments.ts`：`WECHAT_SCHEMA.topic` 改 `z.string().trim().max(100).optional()`；新增 `userFacingGenerationError(kind)`，微信群/配图两类生成失败只回一句人话（「群话术这次没生成出来，稍后再点一次；刚才填的内容还在，不用重填。」），原始报错走 `request.log.error`；输入类（`INVALID_MSG`）仍按 422 原文回显，因为那是给老板看的填表提示。
  - `apps/web/src/pages/LanqiMomentsWechatGroupPage.tsx`：提交时 `topic: topic.trim()`；新增 `trimmedDetail` / `blockedReason` / `canGenerate`，loading、门店未就绪、具体内容为空三种情况分别给可见中文原因；主题 label 标「可选」+ placeholder「不填就按「具体内容」自动起标题」，具体内容 label 标「必填」；按钮 `disabled={!canGenerate}`，上方渲染 `data-lanqi-wechat-blocked` 原因行。
  - `apps/web/src/styles/lanqi-moments.css`：新增 `.lq-moments__opt` / `.lq-moments__req` / `.lq-moments__reason`。
- 回归测试：`scripts/lanqi-moments-wechat-smoke.ts` 删掉旧断言「缺主题拒绝」（那条断言锁的正是引发本 Bug 的旧语义），换成 5 条新断言：缺主题不再拒绝 / 缺主题时 `rawLen` 只算具体内容 / 显式主题优先 / 派生主题取第一句截断 18 字 / 无可派生文字回落场景名。新增页面级回归 `scripts/lanqi-moments-wechat-group-flow.mjs`（可机读断言，默认**不**点生成以免产生模型费用；`--generate` 才真出稿）。
- 绿灯：`pnpm.cmd lanqi:moments-smoke` → service 20/0、wechat 13/0（`MOMENTS_EXIT=0`）；`pnpm.cmd --filter @baolu/api exec tsc -p tsconfig.json --noEmit`、`pnpm.cmd --filter @baolu/web exec tsc --noEmit` 均 exit 0；本机页面级实测 `detailHint="具体内容必填"`、空内容 `blockedReason="还要填「具体内容」…"`（后两条红灯断言转为 PASS）。
- 测试实例复验（2026-09-10，`https://api.lcppch.top/lanqi-test`，发布包 `release-20260910-lanqi-moments-wechat-asset`）：页面级脚本 `scripts/lanqi-moments-wechat-group-flow.mjs`（命令 `pnpm.cmd lanqi:moments-wechat-group-flow --base https://api.lcppch.top/lanqi-test`）**6 passed / 0 failed**——① 微信群话术页可达并渲染四个字段 + 生成按钮；② 门店门禁无阻断（`gates=[]`）；③ 只填「具体内容」时按钮 `disabled=false`（本 Bug 原场景，修复前 `fill=filled disabled=true reason=null`）；④ 具体内容为空时按钮禁用并写明原因（`blockedReason="还要填「具体内容」——把要说的话写进来，就能生成。"`，修复前 `blockedReason=null`）；⑤ 「具体内容」字段有可见必填提示（`detailHint="具体内容必填"`、主题 `topicHint=""`）；⑥ console 0 / page 0 错误。证据 `%TEMP%\lq-wechat-group-flow\wechat-group-flow.json` + `wechat-group.png`。
- 状态：**已关闭（本地 + 测试实例；生产已上线待授权复验）**。生产发布 `20260910-lanqi-lq18-closeout-prod1`（2026-09-10）已把本修复带上线——只读核对生产 `dist`：`apps/api/dist/apps/api/src/routes/moments.js` 命中 `userFacingGenerationError`（3 处）、`.../products/beauty-industry/moments-service.js` 命中 `resolveWechatTopic`（3 处）。但生产 `/lanqi` 作用域仍无 `lanqi` entitlement（实测 0 行），**生产可用性待生产 `lanqi` 授权确认后复验**（见 `docs/CURRENT_DEPLOYMENT_STATUS.md` 与 `docs/agents/lanqi-beauty/STATUS.md`）。

## QA-20260910-022：AI 配图「没有正常生成」——资产 URL 落在美业单品作用域，兰琪租户取图 403 变成破图（P1，LQ-18，已关闭）

- 现象（用户报障，非合成）：点「生成配图」后按钮走完、也回了成功，但图片位置是破图。用户看到的是「AI 配图没有正常生成」。
- 真实环境证据：`journalctl -u baolu-os-v2-test` 同一时刻 `POST /lanqi/moments/image 200`（约 16.9s，真实生图确实成功），紧接着 `GET /beauty-industry/moments/assets/0410c034-… 403`。UA 是 `QuarkPC/7.1.5.968`，即真实浏览器，不是探针。
- 根因：`apps/api/src/products/beauty-industry/moments-image.ts` 里 `DEFAULT_ASSET_BASE_PATH = "/beauty-industry"`，返回的 `asset.url` 硬编码成美业单品作用域；而兰琪租户没有 `beauty-industry` entitlement，`server.ts` 给该作用域挂了 `requireProductEntitlement("beauty-industry")` → 取图必然 403。前端 `fetch(...).blob()` 不校验状态码，把 JSON 错误体塞进 `<img>`，于是表现为破图。**生图是好的，取图作用域错了**。
- 修复前红灯（`scripts/lanqi-moments-asset-scope-smoke.ts`，把 `assetBasePath` 改回 `undefined` 复现）：`5 passed / 4 failed`，`url=/beauty-industry/...`、取回 404/JSON。
- 最小修复：`moments-image.ts` 新增 `normalizeAssetBasePath()` 并让 `generateMomentImage({ assetBasePath })` 接受作用域；`apps/api/src/routes/moments.ts` 的 `POST {base}/moments/image` 传 `assetBasePath: basePath`（`/beauty-industry` 与 `/lanqi` 两条注册都自动正确）。
- 绿灯：`pnpm.cmd lanqi:moments-asset-scope-smoke` → `9 passed, 0 failed`（`ASSET_EXIT=0`）——返回 `/lanqi/moments/assets/<id>`，同作用域取回 `200` + `image/png` + 70 B 真 PNG 字节；反向断言「美业单品作用域对兰琪租户 403」「跨租户取图 404」仍然成立。
- 部署实例复验（2026-09-10，新增 `scripts/lanqi-moments-asset-deployed-check.mjs`，命令 `pnpm.cmd lanqi:moments-asset-deployed-check`）：本机 smoke 只能证明契约，看不到实例上真正注册的路由与真正生效的 entitlement，因此补一条打**已部署实例**的脚本——用 `POST {base}/api/auth/dev-login` 取两个不同兰琪租户，播一条 1×1 合成 PNG，断言四条对外契约，收尾按本轮 tenantId 精确回收合成资产与两个一次性租户。结果 **5 passed / 0 failed**：① 租户 A `GET /api/lanqi/moments/assets/<id>` → `200` + `image/png` + 70 B + PNG 魔数 `89504e470d0a1a0a`；② 同 token 打 `/api/beauty-industry/moments/assets/<id>` → `403`（**这就是用户当时看到的破图成因**，修复后仍然守着旧作用域边界）；③ 租户 B → `404`（租户隔离）；④ 匿名 → `401`（鉴权门禁仍在）；⑤ `/api/lanqi/stores` → `200`（兰琪租户自身作用域可用）。复跑后实例回到基线：`LanqiMomentAsset` 真实数据 5 条不变、`Lanqi Asset Scope Verify*` 一次性租户残留 0、`lq18-scope-verify-0001.png` 文件 0。
- 状态：**已关闭（本地 + 测试实例；生产已上线待授权复验）**。生产发布 `20260910-lanqi-lq18-closeout-prod1`（2026-09-10）已把本修复带上线——只读核对生产 `dist`：`.../products/beauty-industry/moments-image.js` 命中 `normalizeAssetBasePath`（2 处）。但生产 `/lanqi` 作用域仍无 `lanqi` entitlement（实测 0 行），**生产可用性待生产 `lanqi` 授权确认后复验**（见 `docs/CURRENT_DEPLOYMENT_STATUS.md`）。

## QA-20260910-019：交互式 SSH 会话中断导致生产发布脚本在备份阶段被打断，回滚报 `tar: Unexpected EOF`（P2，发布工具，已关闭）

- 现象：首次把 `20260910-copy-neutral-refcase` 发布到生产时，部署脚本跑到「第 5 步打包 200MB 备份」时，外层交互式 SSH 会话断开，脚本与 `tar` 一并被终止，回滚分支输出 `tar: Unexpected EOF`。
- 根因：`deploy-release.sh` 在前台运行，生命周期绑定在**交互式 SSH 会话**上；会话一断（网络抖动 / 终端超时 / 客户端关闭），正在跑的备份和后续步骤收到 HUP 被杀。备份包只写了一半 → `tar` 解包时 `Unexpected EOF`。这是**编排方式**缺陷，不是脚本逻辑或数据损坏。
- 影响与核验：发布未完成，但**未造成损坏**——事后只读核对生产 `dist` 哈希与 `dist-hashes-before.txt` **完全一致**，`baolu-os-v2` 服务 200 / `health` 200，业务无感知。
- 最小修复（操作口径，非代码）：长部署一律用**脱离会话**的方式跑——`sudo setsid nohup bash /tmp/deploy-release.sh <id> <app> … > /tmp/deploy-<id>-<app>.log 2>&1 < /dev/null &`，然后 `tail -f` 日志观察；不再用交互式 SSH 前台跑。
- 修复后复验：用 `setsid nohup` 重跑 → 日志结尾 `DEPLOY_OK 20260910-copy-neutral-refcase-prod2`，健康 200（after 15s）/ ready 200；备份目录 `/opt/baolu-backups/20260910-copy-neutral-refcase-prod2-before-baolu-os-v2/` 完整（`app-before.tar.gz` 204661382 B、`db-before.sql.gz` 7753579 B）。
- 自动化缺口：`tar: Unexpected EOF` 目前靠人眼识别；未加「备份包可完整解压」自检。补齐计划：在备份步骤后加 `tar -tzf app-before.tar.gz > /dev/null` 校验，失败即中止发布（下一轮发布工具任务）。
- 风险等级：P2（发布工具/运维流程；本次未造成数据或服务损坏）。**已关闭**。

## QA-20260910-017：通用「文案智能体」的输出参考案例串了美业样例（方案②，P1，**生产已发布并复验**）

- 现象（真实生产页面，非合成）：创始人 IP 专区（通用专区）的 `/agent/ipzone__copy` 点「👀 输出参考案例 · 不消耗积分」，弹窗里是美业样例——`输入：美业门店 · 卖点=不破皮项目 · 目标=引流到店`、`「做了 16 年美容，我最怕客人进门就问一句：你们这个会不会破皮？」`、话题标签 `#美业老板 #不破皮 #皮肤管理 #美容院经营`。同一内核在美业专区的 `meiye__copy` 弹窗内容**逐字相同**。用户反馈原话：「文案智能体的输出参考案例不对」。修复前截图：`%TEMP%\ref-case-prod-before-0910\{ipzone__copy,meiye__copy}.png`（两图内容一致）。
- 根因：`apps/web/src/pages/MarketplaceApp.tsx` 取样例用的是 `referenceCaseFor(coreSkuCode(sku.skuCode))`，`ipzone__copy` 与 `meiye__copy` 归一后内核都是 `copy`，于是共用同一条案例；而 `reference-cases.ts` 里那条通用案例写的就是美业内容。受影响的不止文案：同批共用内核共 4 条——`copy` / `topic` / `livescript` / `moments`（`topic` 的「美业连锁 / 一家店月耗卡 300 次 / 我们的新仪器」、`livescript` 的「美业门店 / 扣肤质领自测表 / 加赠一次护理」、`moments` 的「美业老板 / 床位利用率不到 40% / 复购周期」）。这不是模型或缓存问题，是通用样例与行业样例放在同一张表里。
- 方案②（用户 2026-09-10 拍板）：**通用样例中性化；行业专属样例放回各行业专区自己的内核**。这里的取舍是「不写行业词」而不是「删掉行业样例」，所以美业专区必须仍然拿得到美业样例。
- 最小修复（2 处生产源码 + 1 处守护）
  - `apps/web/src/marketplace/reference-cases.ts`：4 条共用内核中性化——`copy`→`本地门店 · 卖点=到店体验`；`topic`→`本地连锁门店 / 一家店一个月接待 300 组客人 / 新买的设备`；`livescript`→`本地门店 / 扣关键词领对比表 / 满 20 单加赠一次到店体验`；`moments`→`本地门店老板 / 预约档期空着大半 / 回访节奏`。文件顶部写明契约「通用案例不得出现行业词，行业样例走 `INDUSTRY_REFERENCE_CASES`」。
  - 同文件新增 `INDUSTRY_REFERENCE_CASES`（按**完整 SKU 代码**命中）+ `referenceCaseForSku(skuCode)`：`meiye__copy` / `meiye__topic` / `meiye__livescript` / `meiye__moments` 恢复为美业样例，内容从修复前生产包逐字取回（不是新写的内容）。
  - `apps/web/src/pages/MarketplaceApp.tsx` 改走 `referenceCaseForSku(sku.skuCode)`：行业专区取自己的样例，通用专区回落中性样例。
- 修复前红灯（两次，均在本机实测）
  - ① 本卡自身的红灯：新增 `scripts/marketplace-reference-case-neutral-smoke.ts` 后，把通用 `copy` 临时改回旧美业样例 → FAIL `ipzone__copy 的参考案例不得出现美业行业词`；把美业样例临时挂到通用专区键 `ipzone__copy` → FAIL，报错即用户投诉的那句 `FAIL: ipzone__copy 的参考案例不得出现美业行业词`。
  - ② 守护自检：脚本内置「历史红灯样例」（修复前生产上 `ipzone__copy` 真实渲染的那三行美业文案）必须被判为命中，否则直接 FAIL；把通用 `topic` 临时塞一个「美业」→ FAIL `topic: 通用参考案例出现行业词「美业」`。
- 绿灯（修复后）：`pnpm.cmd marketplace:reference-case-neutral-smoke` PASS（`通用内核 9 个：ip-pos, topic, copy, vidrev, livescript, liverev, sales, moments, ip-pack`）。断言覆盖：4 条共用内核无行业词；通用专区每个 SKU 解析出的样例都不得含任何非通用专区行业词；`INDUSTRY_REFERENCE_CASES` 不得挂在通用专区；每条行业专属样例必须命中本专区行业词（否则应并回通用中性样例）；`meiye__copy` 必须保留；`referenceCaseForSku` 必须按完整 SKU 命中。
- 页面复验（本机 `vite dev` 5174 + API 3011，真实 Chromium，非合成；`scripts/tmp/prod-reference-case-readonly-check.mjs`）：`ipzone__copy` → 弹窗 `输入：本地门店 · 卖点=到店体验 · 目标=引流到店`、正文「差的不在说法，在标准」、标签 `#本地生意 #开店日常 #到店体验 #门店经营`，无任何美业词；`meiye__copy` → 恢复 `输入：美业门店 · 卖点=不破皮项目`、「做了 16 年美容…会不会破皮」、`#美业老板 #不破皮 #皮肤管理 #美容院经营`；`ipzone__moments` 中性 / `meiye__moments` 美业，两边分别正确。截图：`%TEMP%\ref-case-neutral-0910e\*.png`（已逐张目视确认）。
- 测试：`pnpm.cmd marketplace:reference-case-neutral-smoke` PASS；`pnpm.cmd --filter @baolu/web typecheck` PASS；`pnpm.cmd qa:fast` PASS；`pnpm.cmd auth:product-login-smoke` PASS；`pnpm.cmd --filter @baolu/web build` PASS。
- 风险等级：P1（用户实际看到不属于自己行业的样例，且已反馈到生产）。
- 生产发布（2026-09-10）：发布 id `20260910-copy-neutral-refcase-prod2`，包 sha256 `c1ef1da392c2d60f2ce8b9d9e0da3a83b29b853c572cbe657a6560932bccf063`（与 `release-20260910-copy-neutral-refcase.tar.gz` 一致），`DEPLOY_OK` + 健康 200（after 15s）/ ready 200；同包先发 `chat-test`（id `20260910-copy-neutral-refcase-test`）。生产入口 `assets/index-D2Psnwlm.js`，货架 chunk 由旧包 `MarketplaceApp-DVvMwzZt.js` 换成 **`assets/MarketplaceApp-NXm7kVbh.js`（51282 B）**。
- 生产复验（线上只读，真实 Chromium，非合成；`scripts/tmp/prod-reference-case-readonly-check.mjs`）：`ipzone__copy` → `beautySample=false`，弹窗 `输入：本地门店 · 卖点=到店体验 · 目标=引流到店`、标签 `#本地生意 #开店日常 #到店体验 #门店经营`，**无任何美业词**；`meiye__copy` → `beautySample=true`，恢复 `输入：美业门店 · 卖点=不破皮项目`、`#美业老板 #不破皮 #皮肤管理 #美容院经营`。chunk 内容核对：同一份 `MarketplaceApp-NXm7kVbh.js` 内 `本地门店`/`#本地生意` 与 `美业门店`/`#美业老板` 共存，即通用走中性、美业保留行业样例。截图 `%TEMP%\ref-case-prod-0910b\`。
- 绿灯（生产复验同批）：`pnpm.cmd marketplace:reference-case-neutral-smoke` PASS；`pnpm.cmd auth:product-login-smoke` PASS；`deployed_marketplace_browser_check:PASS`（`shelf / credits_yuan / coming_soon_count=45 / detail_redo_copy / direct_test_entry / console_clean`）。
- 状态：**已关闭（本地 + 测试 + 生产全部复验）**。

## QA-20260910-018：已失效的本地 token 把用户从 `/login` 弹回货架 → 登录死循环；同批 `main.tsx` 重复声明导致前端整包编译失败（P1，**生产已发布并复验**）

- 现象（用户反馈，生产）：`https://api.lcppch.top/os-v2/login` 用微信打开**直接落到首页并显示「未登录」**，点「登录」又回到首页，进不去登录页；电脑端同样。用户描述为「点击登入之后还是直接到首页，并没有到登入页面」。
- 根因（两层）
  - ① 登录死循环：`main.tsx` 的路由门禁只看 `localStorage.getItem("store_os_token")` 是否存在，只要本地有 token 就把 `/login` 弹回 `/market`；token 过期/被吊销后该判断依旧成立，而货架又因为 token 无效显示「未登录 · 点击登录」——点一次弹一次，永远进不去登录页。**「有没有 token」不等于「会话是否有效」**。
  - ② 编译失败（阻断级）：`main.tsx` 里残留了一份旧的局部 `takePostLoginRedirect`，与 `lib/session.ts` 新导入的同名函数重复声明，Vite 报 `Duplicate declaration "takePostLoginRedirect"`，`/agent/ipzone__copy` 等页面直接白屏。这会掩盖 ① 的验证结果——用户看到的可能是「编译坏了」的空白页。
- 最小修复
  - 新增 `apps/web/src/lib/session.ts` 作为唯一会话工具：`readSessionToken()` / `clearStoredSession()` / `probeSession()`（只读探针 `GET /market/me`：200=valid、401/403=invalid、网络异常或 5xx=unknown 且**不清 token**）/ `readPostLoginRedirect()` + `takePostLoginRedirect()`（无 fallback 返回 null，有 fallback 返回 `getAppPath(fallback)`；本次把带参版本拆成原语 + 两个重载，避免与旧局部函数重名）。
  - `main.tsx` 新增 `LoginSessionGate`：仅当 `!DIRECT_TEST_LOGIN_ENABLED && isLoginRoute && readSessionToken()` 时先做服务端探针；`valid` → `window.location.replace(takePostLoginRedirect("/market"))`；`invalid` → `clearStoredSession()` 后正常渲染登录页；`unknown` → 渲染登录页但保留 token。**删掉了「只看 localStorage」的弹出逻辑**，并在原位留注释说明它是登录死循环的成因。
- 修复前红灯：`pnpm.cmd auth:product-login-smoke` FAIL —— `AssertionError: 已有会话访问平台登录页必须回平台首页，不能落进旧的单品诊断流程`，`expected: /!DIRECT_TEST_LOGIN_ENABLED && \(path === "\/login" \|\| path === "\/login\/"\) && localStorage\.getItem\("store_os_token"\)/`。即：旧断言锁的是**引发死循环的那段实现**，重构后必然失败。这是「断言过期」而不是功能回归——死循环语义恰恰是本卡要改掉的东西。
- 断言处理（不放宽门禁，改成锁更强的语义）：`scripts/product-login-entry-smoke.mjs` 把这条改写为 5 条断言——`isLoginRoute` 必须同时覆盖 `/login` 与 `/login/`；必须 `!DIRECT_TEST_LOGIN_ENABLED && isLoginRoute && Boolean(readSessionToken())` 才走探针；`valid` 必须回 `/market`（保留一次性安全回跳）；`invalid` 必须 `clearStoredSession()`；并用 `assert.doesNotMatch` **禁止**「只凭本地 token 就把 `/login` 弹回货架」的旧写法回来。另加守护自检：把修复前那段原样字符串喂回该正则，必须命中，否则断言已失效。
- 绿灯（修复后）：`pnpm.cmd auth:product-login-smoke` PASS；`pnpm.cmd qa:fast` PASS（含 7 个 workspace 的 `typecheck`，`apps/web`/`apps/api` 均 Done）；本机页面复验 `/agent/ipzone__copy` 正常渲染（不再白屏）。
- 风险等级：P1（核心登录入口不可用 + 前端整包编译失败，属阻断级）。
- 生产发布（2026-09-10）：随 `20260910-copy-neutral-refcase-prod2` 同包上线（sha256 `c1ef1da3…bccf063`，`DEPLOY_OK`）。
- 生产复验（线上只读，`scripts/tmp/prod-login-entry-readonly-check.mjs`）：`prod_login_entry_readonly_check:PASS`——`root_market`（点 `https://api.lcppch.top/os-v2/` 落货架）、`anonymous`（显示「🔒 未登录 · 点击登录」，属匿名访客预期行为，不再死循环）、`login_page`（`/os-v2/login` 渲染平台登录页 = 微信一键登录 / 注册 + 使用邀请码开通，**不再被弹回货架**）、`wallet_copy`、`wechat_button`、`wechat_config`（`configured=true`，appid `wxf405233d…`）、`invite_form`、`console_clean` 全 PASS。截图 `%TEMP%\login-readonly-*\`。
- 生产内测免登录门禁（P0 预检）：`/etc/baolu-secrets/baolu-os-v2.env` 不含 `VITE_DIRECT_TEST_LOGIN`；`scripts/tmp/prod-build-direct-test-login-runtime-check.mjs`（真实 Chrome 打本地生产构建 `/os-v2/login` 与 `/`）PASS。**生产是正常登录实例**。
- 仍未完成：**微信首次授权（扫码）那一跳的真人验证**。用户当前没有未注册过思潼 AI 的微信号，已授权 Codex 用真实浏览器代跑邀请码开通链路（与微信首登共用同一套 `/auth/beta-login` 建号逻辑）。
- 状态：**已关闭（本地 + 生产只读复验）**；真人微信扫码一跳记入 `docs/CURRENT_DEPLOYMENT_STATUS.md` 的未完成项。

## QA-20260910-016：新注册账号货架显示 0 积分——欢迎积分只发到租户级 `CreditAccount`，货架读的是用户级 `Wallet`（P1，**已关闭：2026-09-10 产品拍板改为「新用户不赠送任何积分」，生产已发布同包**）

- 现象（真实生产，非合成）：用一次性邀请码在生产走完注册链路后，服务端响应 `creditBalance: 300`，但货架钱包 pill 显示 `💎 0 积分 · ≈ ¥0 全平台通用`。这正是用户反馈里「进思潼AI 显示未登录 / 看不到积分」的一环：账号建好了、token 也签发了，但货架展示的余额是 0。
- 只读复现证据（生产 `baolu_os_v2`，`scripts/tmp/prod-qa-wallet-recon.sh`）：4 个 QA 工作区的 owner `Wallet.paidBalance=0 / bonusBalance=0`，同租户 `CreditAccount.balance=300`；对照老租户「兰琪」`CreditAccount.balance=208`、其 owner `Wallet` 同为 `0/0`；`WalletLedger` **全表 0 行**（从未有过钱包流水）。DB 总量：`Tenant 207 / User 201`。
- 根因：迁移 `202609090004_sitong_wallet_double_bucket` 引入按用户的 `Wallet` 后，PLAT-06（见 QA-20260910-001）把**货架**的展示（`/market/me`、访问态）与扣费（`/run`、`/ppu/consume`）统一到用户双桶钱包，但**注册发放欢迎积分**的路径没跟着迁移：`apps/api/src/services/database-bootstrap.ts` 的 `createTenantWorkspace` 仍然只写租户级 `CreditAccount(300)` + `CreditTransaction(300, welcome_credits)`。新用户的钱包是 `readWallet()` → `getOrCreateWallet()` 懒创建的，初始就是 `0/0`，没有任何 grant。与 QA-20260910-001 是同一次「货架迁到用户钱包」迁移遗留的**第二个缺口**（那次补的是「展示与扣费同源」，这次是「注册发币的同源」）。
- 影响面与并存关系：货架（用户主入口，登录后默认落 `/market`）全部走用户 `Wallet`；而 `/chat`、`/billing/*`、`/beauty-industry/*` 等仍在读租户级 `CreditAccount`（`chat-persistence.ts`、`billing-consume.ts`、`billing-effects.ts`）。`billing-effects.ts` 里 `credit_pack` 充值已只入 `Wallet`（`applyRechargeInTx`），subscription/project_package 仍入 `CreditAccount`——即**双钱包正在迁移中**，欢迎积分是唯一没跟上的入账点。
- 计费口径（这是本 Bug 修复里唯一需要用户拍板的点）：按 `docs/CURRENT_DEPLOYMENT_STATUS.md`「每个新工作区当前默认发放 300 体验积分」，这是一份**单一额度**。可选修法口径不同、计费结果不同，属 AGENTS 第十节要求「会改变计费规则时先询问用户」的范围：
  - 口径 A（单一额度，300 总）：欢迎积分只入用户 `Wallet`（`bonus` 桶），同时把 `/chat` 等遗留读取也切到 `Wallet`。改动大（要把 `chat-persistence`/`resolveRequestContext` 的余额源一起迁移），但符合文档里「300 体验积分」的原意。
  - 口径 B（最小改动，300 聊天 + 300 货架 = 600）：在 `createTenantWorkspace` 里**为新用户**增加一次 `Wallet` grant（`bonus` 桶 + `WalletLedger`），保留既有 `CreditAccount(300)` 不动，遗留 `/chat` 不受影响。改动小、无回归，但等于把免费额度提到 600，与现文档口径不一致，需同步改文案。
  - 共同注意点：`Wallet` 是**按 userId** 的唯一记录，grant 只能发生在**新用户创建**那一次（同一用户二次建工作区不得重复发），且必须与 `createTenantWorkspace` 在同一事务里，避免「建了工作区但没发币」的半成品态。
- 红灯回归（修复前失败，2026-09-10）：新增 `scripts/signup-welcome-wallet-smoke.ts`（`pnpm.cmd marketplace:signup-welcome-wallet-smoke`，跑在本机 `DATA_MODE=database` + 真实 PostgreSQL 上，非合成）。修复前断言 FAIL：`new user has a wallet row`——新用户建完工作区连 `Wallet` 行都不存在，货架的 `readWallet()` 懒创建 `0/0`。这就是本卡的红灯。
- 最小修复（本轮采用**口径 B**，改动 2 处生产源码）：`apps/api/src/services/sitong-wallet.ts` 新增导出 `grantSignupWalletCreditsInTx(tx, {userId, amount, source})`——发到用户级 `Wallet.bonusBalance`，写 1 条 `WalletLedger(bucket=bonus, type=bonus, source="signup")`；按 `userId + source="signup"` 查重保证**幂等**（同一用户二次建工作区不重复发），`amount<=0` 直接返回不发。`apps/api/src/services/database-bootstrap.ts` 在 `createTenantWorkspace` 的欢迎积分 `CreditTransaction` 之后、**同一事务内**调用它，返回值新增 `walletBalance` / `walletWelcomeGranted`（`creditBalance` 仍为租户级 300，未改）。
- 绿灯（修复后）：`pnpm.cmd marketplace:signup-welcome-wallet-smoke` PASS（断言「新用户有 Wallet 行 / `bonusBalance=300` / 恰 1 条 `source=signup` 流水 / 二次建区不重复发 / 既有 `CreditAccount` 仍 300」）；`pnpm.cmd marketplace:db-smoke` PASS；`pnpm.cmd billing:wallet-db-smoke` PASS；`pnpm.cmd qa:fast` PASS；`pnpm.cmd typecheck` PASS；`pnpm.cmd qa:regression` PASS。
- 部署复验（chat-test，2026-09-10）：发布 `20260910-signup-welcome-wallet`（包 sha256 `15c4fac1cbd0a4aaefa0746ef4f81826823681521fd14015608a2e3d3a81d042`，1416 文件）叠加到 `/opt/baolu-os-v2-test`，`DEPLOY_OK` + 健康 200/ready 200。随后在该环境**真实建号**验证（临时一次性邀请码 `qa-wallet-20260910-01`，`POST /auth/beta-login`）：`userId=cmtvf7sfi01e7f9mgllhz19qr` → `Wallet.paidBalance=0 / bonusBalance=300`，`WalletLedger` 恰 1 条 `delta=300, bucket=bonus, type=bonus, source=signup`；同租户 `CreditAccount=300` 未变。即部署环境里现象已消除。
- 未部署生产的原因：口径 B 会把新用户**实际可用免费额度从 300 提到 600**（货架 300 + 遗留租户账户 300），而且两桶**不可互换**：`/market` 货架与「下载精美 Word」（`EXPORT_PRICING.docxCredits=10`）扣 `Wallet`，而 `/chat` 与外部接入（WorkBuddy / billing access token，见 `billing-consume.ts`）仍扣租户级 `CreditAccount`，`/my-ai` 顶部「企业积分」也展示 `CreditAccount`。这是**计费/定价口径变更**，按 AGENTS 第十节必须先问用户，故生产保持原样。
- 风险等级：P1（新用户核心路径看不到自己应有的积分，直接影响首次体验与付费转化）。本地与 chat-test 已修复；**生产仍为 0 积分**，属于未放行状态。
- 最终口径（2026-09-10 产品拍板，已落地）：**新用户不赠送任何积分**。`getInitialWorkspaceCredits(tenantType)` 默认由 300 改为 **0**，`initialCredits > 0` 才写 `welcome_credits` 流水；`grantSignupWalletCreditsInTx` 保留但收到 `amount=0` 时按设计直接返回不发币。**「生产新账号余额 0」由 Bug 转为预期行为**，要开通用量就先充值。`NEW_USER_*_TRIAL_CREDITS` 仅作为隔离测试/内测环境的显式体验额度开关（生产/测试 env 均未配置）。
- 该口径随发布 id `20260910-copy-neutral-refcase-prod2`（包 sha256 `c1ef1da3…bccf063`，`DEPLOY_OK` + 健康 200 / ready 200，48 migrations / No pending migrations）上线到生产 `/opt/baolu-os-v2`，同包先发 `chat-test`。
- 已作废的备选（留档，不再执行）：口径 A（总量保持 300，把 `/chat` 等余额源统一到 `Wallet`）；口径 B（300 聊天 + 300 货架 = 600）。两者都因「不再赠送欢迎积分」而失去前提。
- 遗留（不阻塞，已记录）：`/chat`、`/billing/*`、`/beauty-industry/*` 仍读租户级 `CreditAccount`，货架读用户级 `Wallet`，双钱包迁移未完成；文档里旧的「每个新工作区默认发放 300 体验积分」口径已失效。
- 存量用户：本修复**只对新建工作区生效**。已有租户（含 4 个 QA 工作区与老客户）下次访问货架仍是懒创建 `0/0`。如要覆盖存量用户，需另开 backfill 脚本任务。
- 生产第二轮复验（2026-09-10 晚，设备无未注册微信号，用户授权 Codex 代跑，同上一轮口径）：临时一次性邀请码 `qa-signup-20260910-02`（id `cmtvffpxx00002buedkwlx163`）走真实浏览器注册链路，`prod_signup_acceptance:PASS` 11/11，新工作区 `cmtvfg6kn059qulvl97ohjred` / `userId cmtvfg6kr059rulvlttpshfl2` / `creditBalance=300`。**本缺陷在生产仍原样复现**：货架 pill = `💎 0 积分 · ≈ ¥0 全平台通用`，DB 只读复核 `Wallet(paid=0, bonus=0)`、该用户 `WalletLedger` 0 行（全表 0 行），同租户 `CreditAccount=300`。邀请码跑完 `isActive=false`。证据截图 `%TEMP%\prod-signup-acceptance-02\`。
- 状态：**已关闭**（口径变更 + 生产发布 + 只读复验）。本轮未改生产环境配置口径以外的业务参数、未产生客户费用、未删数据；代跑新增的 QA 工作区 `QA注册验收工作区-0910-02` 按「生产删 Tenant 属高危」保留未删。

## QA-20260910-012：合规门禁把「劝阻复述 / 渠道名词 / 序数用法」当成违规，整段输出被毙（P1，LQ-19 本地关闭）

- 红灯（真实大模型，非合成）：`POST /beauty-industry/acquire/live/segments` 稳定返回 HTTP 422 `invalid_live_input 生成内容未通过合规门禁：绝对化/疗效词（第一）`；同一批 `POST /beauty-industry/acquire/advisor` 返回「顾问回答命中绝对化/疗效词：特效；命中违规引导词：私信」。浏览器走查 21/23，两条失败均由此引起。
- 根因（抓原始模型输出定位，证据 `.debug/api-dev.err.log` 临时诊断打印）：① 模型写「第一部分／第二部分」讲直播流程，`ABS_FIRST_CLAIM` 的序数豁免只是一串单字类，漏掉「部」等量词；② 模型按要求写「不引导加微信」「不用特效滤镜」，即在**劝阻语境里复述**被禁词；③ 模型写「每天回复评论和私信」，是在平台内回复顾客消息的**渠道名词**，不是导流引导。三类都不是违规，却按整段 fail closed。
- 最小修复（`moments-rules.ts`，仅收紧误判、不放宽真违规）：序数豁免换成完整序数量词表（明确不收「名／位／梯队」，「第一名」继续拦）；新增语境判定 `hasRiskyUsage`——否定词与本词之间隔≤2 字且不跨句读才豁免（「不引导加微信」「不要用特效」豁免，「不管怎样私信我」仍拦），「私信」另加平台内回复/渠道并列的安全前缀。同步把四条提示词的「第一」口径改成「仅排名宣称」，减少模型无谓自我审查。
- 回归：`scripts/lanqi-moments-rules-smoke.ts` 新增 10 条、`scripts/lanqi-live-service-smoke.ts` 新增 1 条、`scripts/lanqi-advisor-service-smoke.ts` 新增 1 条，修复前新增断言全部 FAIL（证据见卡内记录），修复后全绿。
- 验证：`pnpm.cmd lanqi:acquire-smoke`（80/0）、`pnpm.cmd lanqi:moments-smoke`（47/20/9，0）、真实大模型 API 走查 16/16、真实浏览器走查 24/24、视频走查 25/25、`qa:fast` PASS。真实付费调用仅本轮开发走查，未新增生产费用。

## QA-20260910-011：文案改稿「成稿」步骤空白（P1，LQ-19 本地关闭）

- 红灯：真实浏览器走查 `.lq-cw__draft` 成稿编辑框为空，但同一页「合规/事实检查项」正常渲染，因此此前的接口级断言（只看返回体）完全没暴露。
- 根因：点击事件里先 `setStep(3)` 再同步写 `editorRef.current.textContent`；React 尚未挂载第三步编辑框，`editorRef.current` 仍指向上一步节点，写入丢失。
- 最小修复（`apps/web/src/pages/LanqiAcquireCopywriterPage.tsx`）：改成受控回填——`applyDraft(text)` 只登记文本 + revision，新增 `useEffect([step, draftSource, draftRevision])` 在步骤切换挂载后再写编辑器；三处调用点（初始改稿、重新生成、选开头、`goStep(3)`）统一走该入口，`goStep(3)` 仍优先恢复本机已存草稿。
- 验证：走查断言由「空白」变为「成稿步骤有真实正文 :: 253 字」并通过；`qa:fast`、Web/API typecheck PASS。

## QA-20260905-010：Seedance独立token上限遗漏交付阻断（P1，BY54开发中发现并本地关闭）

- 非线上/真实付费事故。新增执行fixture返回108001 completion，签名上限108000，但估算仍在总人民币预算内；修复前断言期望refunded实际charged，证据`by54-evidence-20260905/logs/token-cap-red.log`。单一货币比较不能替代签名token上限。
- 最小修复在单次下载前分别核对completion数量与微人民币预算，超token不下载/不交付，原reservation一次释放；BY51实际观察照实保留，未伪造Provider退款，不重置已消费请求额度。另补历史下载当前素材撤销重验，不改变wan默认URL政策。
- 同任务安全复查另捕获保存租约61s未覆盖60s下载后的30s ffprobe，`persist-lease-red.log`稳定失败；改120s且保留原终态CAS，迟到writer不能覆盖已释放/结算记录。新源码重跑同批PG/内存三轮与全门禁，不把旧PASS沿用到新修改。
- `beauty-industry:seedance-execution-smoke`三轮+独立PG三轮/三进程、qa:full含fast/regression/typecheck/build和diff PASS。覆盖SQL写失败共同回滚、POST已接受但观察DB故障不重发、迟到usage、MP4落盘后finish失败恢复无重下载、过期/撤权/跨owner与tenant、HTTPS DNS/IP/TLS选项/redirect边界。真实网络/Provider/费用0，完整局限与记录见BY54卡/SEEDANCE_EXECUTION。
- 调试期HTTP404→500为测试handler提前设置video/mp4再发送JSON造成，已修测试，不冒称产品越权Bug；内存nullable字段undefined与PG null统一断言也仅测试修正。未通过的过程不计PASS。

## BY53 Seedance新协议防错回归（非已发生线上Bug）

- 原仓只有wan协议与Seedance尚未开放guard，不能把wan的output.task_id/按秒计量当Ark id/completion token。新adapter缺失红灯保存在BY53日志；独立实现不删除旧guard，不称旧wan有Bug。
- 三轮合成回归覆盖HTTP200无id非成功、未知POST重放、GET状态/URL/过量重试、授权混用/跨租户、签名URL/原始异常泄露、total与completion双计、缺usage假免费。调用失败仅精确安全码/hash/bytes，不记录正文或凭据。Provider/外网/费用0，不生成AgentRun或积分交易。
- `pnpm.cmd beauty-industry:seedance-adapter-smoke`三轮PASS并加入qa:regression；qa:full含fast/regression/typecheck/build与diff PASS。真实平台授权/持久permit/预算接线未完成，保持disabled；不把合成port当PG/真实视频验收，范围证据见BY53任务卡。

## QA-20260905-009：我的AI无条件展示旧兰琪入口且丢失美业租户品牌（P1，BY52本地关闭）

- 真正路径为美业Shell→`/my-ai`→`/agents/me`已拥有目录，不是公开推荐；无条件lanqiAgentEntry导致默认/其他/无权/过期租户看到旧私有入口，兰琪美业自身卡缺品牌。独立PG+真实HTTP/Chrome红灯20项；旧私有API仍403/授权200，未发现数据越权。
- 最小修复：服务端当前tenantProductEntitlement active/expiry、beauty品牌注册表派生owned目录与productEntries；Agent授权与产品授权相交，独立旧lanqi产品不等于品牌。Web去硬编码专属卡、加载/错误未知余额—，公开catalog/购买与旧私有guard不改。原E2E漏掉返回MyAi，新增真实HTTP/DB/Chrome门禁。
- 新`owned-product-directory-smoke.ts`三轮接入品牌/导航专项；`beauty-directory-browser-e2e.mjs`最终六身份×1440/390×三轮、刷新/返回/加载/503/跨租户/伪造brand/撤权/旧授权入口PASS，截图确认可读、console0。`qa:full`含fast/regression/typecheck/build及diff PASS，证据/精确文件归属见BY52卡。
- 不调用Provider、不生成任务或扣费，AgentRun/CreditTransaction0；不修改Skill/知识、不开新权限、不放行暂停产品。运行环境已按正式身份停止，数据审计保留；范围P0/P1=0。

## QA-20260905-007：视频执行缺不可覆写的调用用量明细（P1，BY51本地关闭）

- 红灯：正式HTTP合成视频成功/结算后AuditLog无beauty_usage_v1记录，`red.log`断言稳定FAIL。原permit有计数但observe缺usage直接return，有usage只覆盖observedProviderCost；无法用其区分未决调用、缺数据和迟到证据。不是已证明真实费用丢失事件。
- 最小修复复用AuditLog主键，submit计数与started同事务，Provider关联hash与usage/status追加、不覆写；同call重复去重/冲突保留unknown。单位/模型/价格版本/币种分组，缓存不重复相加，估计成本与账单证据分开；客户账本不改，失败成本记录不伪造退款。
- 内存与owned PG各三轮、3进程重复append、restart/迟到、审计故障rollback、跨tenant/store/user、月边界/数值/单位/价格/数据污染拒绝PASS。正式视频HTTP失败一次释放、成功一次结算、退款后迟到usage不追扣。Provider/网络/费用0，qa:full含fast/regression/typecheck/build及diff PASS，见BY51任务卡。
- 初次PG测试自身name/nickname错误和主client故障注入未进入tx已修，不作为生产Bug。运行只接默认关闭的视频受控链，其他Provider单位为离线合同；不放行暂停产品、不造新定价/公共consume，不宣称全平台已完成。

## QA-20260905-008：不同PowerShell宿主的组合源码指纹口径不一致（P2，待独立审计）

BY51结束时相同核心文件SHA、同一Get-SourceFingerprint，Windows PowerShell5.1得`E12B1C24…153CCA7`，PowerShell7.6.5得`3B0FF2B9…AD7685`；具体编码/排序机制未查，不猜测归因。正式start/stop与本轮PG均使用WindowsPowerShell5.1、source/runtime一致、身份门禁和停止PASS。当前可用替代为固定同宿主与单文件SHA复核，禁止混用指纹认领进程。未在计量任务混改维护基础，不冒称该P2修复。

## QA-20260905-006：中断提交恢复终态未释放暂存（P1，BY50本地关闭）

- 正式HTTP+受控协议fixture：Provider接受提交后DB update和finish均失败，job留submitting；超过恢复阈值刷新后积分一次等额释放、job终态未知，但2个暂存对象仍存留。`interrupted-red.log`期望0实际2，未涉及真实云或客户内容。
- 根因：runtime.refresh的deadline/interrupted早返回直接finish，绕过常规终态cleanup；此前成功/普通失败测试没有覆盖同时DB故障窗口。最小修复仅补这两条终态及terminal cancel的既有cleanup，不追加Provider请求、不重置permit或账本。清理失败保持可恢复，不伪称外部取消成功。
- BY50同批三轮及独立PG三轮验证：中断恢复后objects0、submit计数1、一次释放、重放不再submit；三进程许可争抢仅1个胜者，预算/授权/跨租户/部分持久化/清理失败/迁移保留记录均PASS。qa:full含fast/regression/typecheck/build PASS；费用与真实Provider0。证据根`F:/思潼AI增长os/test-environments/by50-execution-offline-20260905`，最终PG根及文件归属见BY50卡。

## QA-20260905-005：授权撤销遗漏尚未建任务的暂存lease（P1，BY49本地范围关闭）

- 修复前正式授权/暂存集成+注入OSS：stage成功2对象，尚无job；revoke后仍2对象，自动期望0失败。根因是BY46撤销仅遍历reserved job，而stage在job/积分创建前发生；崩溃/部分流程可形成无job的有效lease。此前只测job存在的撤权，漏掉此时间窗。没有真实云数据泄漏或生产事故证据。
- 修复：先持久撤权，再按tenant及authorizationVersions包含该id查询未释放lease≤100并走原release；失败保留cleanup_failed，不盲删其他对象、不删除原素材、不改变历史账本。未来云签名已外发且删除失败时仍可能有效至TTL，不能声称立即撤回。
- 专项三轮验证未建job撤权、部分上传、清理失败/sweep、hash/版本、跨用户/店/租户、重复/未知终态/等额释放，云端HTTP0、Provider0、积分净0；qa:full含fast/regression/typecheck/build及diff PASS。新增JSON包含查询本轮为事务fixture，真实PG与真实云仍需后续验收。
- 同卡配置红灯：STS.合法格式被字母数字正则误拒，改为精确STS.临时凭据格式；长期AK/注入/过期仍拒绝。官方SDK签名3轮通过，无真实key/云请求。证据见BY49及`by49-oss-offline-20260905/revoke-red.log`、`sts-red.log`。

## QA-20260905-004：临时Word只按租户授权，同租户非创建者可下载并消耗文件（P1，BY-48本地权限范围关闭）

- 修复前正式注册HTTP handler+真实签名会话+合成membership存储：owner创建后colleague GET返回200/DOCX，期望404；无真实客户泄漏或生产事故证据。旧测试只验证租户品牌/正文输出，未覆盖文件创建者边界。
- 根因：ExportRecord只有tenantId；route依赖允许身份header的共享context，没有独立签名会话准入。同租户即下载并delete，造成越权和创建者后续404。
- 最小修复：创建/下载要求签名token，identity header从token派生；数据库模式逐次成员重验；tenant+user共同绑定。非owner404、异tenant保持403，未授权不consume；lookup/delete放在异步鉴权之后，并发只有一次下载；no-store，鉴权异常503/撤权403只输出安全code，不吞异常或回退匿名。
- 三轮`export:owner-isolation-smoke`、branding/delivery邻接、qa:full含fast/regression/typecheck/build、diff-check PASS。合成Word实际WPS1页/100%渲染可读且hash不变；标准LibreOffice渲染缺soffice未运行成功，不能冒称其兼容PASS。没有改版式/TTL/一次下载/业务正文，没有PG/Chrome/Provider调用；边界与精确证据见BY-48。

## QA-20260905-003：共享音视频解析仅凭配置key外发，缺少服务端ASR准入（P1，安全子范围已关闭；ASR业务未开放）

- 红灯：正式`/media/analyze` handler对匿名合成WAV返回200；注入transport收到1次ASR请求，真实网络/费用0。这是可复现入口风险，不是已证实客户录音外泄事故。
- 根因：server根路由无产品preHandler；Authorization只决定IP限额；`configured`仅检查key/base，随后进入`transcribeMedia`，无用途/租户/预算授权或账本路径。此前observer专项只调用adapter，未覆盖匿名multipart入口。
- 最小修复：在任何转码/视觉/ASR前对该共享入口音视频返回503 `asr_authorization_required`，明确未调用/未扣积分且不可盲重试。保留CSV/XLSX和美业正式元数据预检/手工转写证据；不新造ASR队列，不降低其他产品协议。
- 回归：`beauty-asr-admission-smoke.ts`正式HTTP handler注入，3轮31次拒绝+9次文档解析；假凭据/客户端用途/跨租户标识不放行、并发/重放、格式/体积、脱敏日志和transport0。已纳入qa:regression，qa:full含fast/regression/typecheck/build及diff全部PASS。未新建DB/环境/邀请、费用0，不称真实ASR/浏览器/数据库任务验收PASS；精确日志与恢复边界见BY-47。

## QA-20260905-002：素材授权只留admission接口与集成历史被无权任务阻断（P1，本地范围关闭，真实接入未开放）

- BY45有安全前置端口，但没有真实服务端文件/门店/用途/角色/依据/撤销记录；不能把客户端勾选当授权。BY46初始专项稳定报缺server-persisted admission；本轮无真实客户/Provider，不能称已发生泄漏。
- 新增持久声明与lease后，独立HTTP红灯发现列表先取整个tenant任务再调用admission：其他用户job的404让本人有效history整体失败。`history-red.log`保存404≠200与精确断言，无客户正文。修复在limit前按user过滤，逐项已撤销/缺失资源隐藏，数据库/审计/权限故障不吞。
- 最小实现：复用UploadedFile/Membership/Store/entitlement和BY45任务账本，新增声明/私有lease模型及最小接口；捕获本地bytes实测hash/类型/尺寸，固定角色/用途/expiry/version；本地签名TTL≤15分钟、提交前重验、撤权与清理失败可恢复、CAS释放一次。声明只标`user_declared_not_independently_verified`，不声称法务核验或云端开通。
- 回归：`beauty-industry:video-material-authorization-smoke`内存与独立PG连续3轮，真实本地HTTP15次；跨租户/店/用户、hash篡改、重复声明/任务、提交前撤权、外部已提交状态合成恢复、清理失败/过期、历史/下载/一次账本PASS。迁移升级与保留记录回退、相邻BY45、API/Web/Agent类型、qa:fast/regression/full含build、diff PASS。
- 当前本地P0/P1=0；真实端到端前置阻塞1。无真实云driver/视频预算/客户素材、没有页面E2E，本地`local_only`不能与真实执行器组装，默认任务/预留前fail-closed。Provider0、费用¥0，XHS/BY19/20保持PAUSED。详细归属、runtime/日志与回滚边界见BY-46。

## QA-20260905-001：视频换人协议漂移与远程URL即成功（P1，零Provider基础修复；业务能力未开放）

- 独立红灯：旧`buildAliyunReplicationRequest`输出wan-animate-mix/person_image_url；官方异步合同需要wan2.2-animate-mix/image_url/video_url/mode。原smoke仅断言旧字段而PASS，新模型钉死断言稳定失败。
- 静态关联风险：旧callback收到远程URL即succeeded，未验证本地视频；客户端consent缺服务端文件/门店授权证据；退款先读后写、提交终态不明被当未接受。不能把本项描述为新发生的真实扣费事故：未调用真实Provider、无客户数据测试。
- 修复：显式协议与server admission端口；默认缺授权/staging时422且无job/预留；固定request fingerprint、现有CreditReservation事务/CAS、一任务一次submit、恢复同task、回调不决定成功；落盘后ffprobe/H264/hash与本地授权下载，失败释放一次，Provider成本不伪称退款。
- 回归：`beauty-video-replication-foundation-smoke.ts`连续3轮，内存事务夹具及独立PostgreSQL均PASS；包括双确认/刷新、未知提交、崩溃恢复、429/5xx/no task、落盘失败、跨租户/门店、真实合成MP4下载和账本。原viral smoke更新正式字段后PASS；精确命令/全仓结果见BY-45。
- 残余：真实素材授权记录与staging适配尚未接通，客户端不能调用；真正视频生成质量、实际浏览器页面尚未验收，不能通知用户生成视频。暂停XHS不受影响。

## QA-20260903-003：兰琪经营问答合同失败可被保存结算，且安全拒绝被误判为 AI 套话（P1，已关闭）

- 现象：真实限额验收中，结构/质量不合格回答曾先保存 succeeded AgentRun 并结算积分；另一个包含合规“无法提供”的高风险回答被通用 `generic_ai_tone` 规则拒绝。真实页面还因同时要求 `lanqi` 与 `beauty-industry` entitlement 显示“服务暂时不可用”。
- 根因：经营问答输出合同位于持久化/结算之后；通用套话正则把“无法提供/我不能”与“我是一个 AI”混为一类；共用 executor 没有按 Web 与 MCP 的可信入口区分产品 entitlement。
- 修复前红灯：`lanqi-business-qa-live-contract-smoke.ts` 固化四段结构不合格、安全拒绝和显式 AI 身份样例，并静态断言双入口鉴权；安全拒绝修复前稳定命中 `generic_ai_tone`，页面请求稳定被错误产品权限拒绝。
- 最小修复：在保存/结算前执行 `assertBusinessQaOutputContract`；仅对固定 `beauty_business_qa/general_qa` 把 AI 套话收窄为显式 AI 身份，其他 capability 保持原规则；Web 校验 `lanqi`，WorkBuddy 校验凭据绑定的 `beauty-industry`，执行/结构/账本仍为同一份。
- 验收：DeepSeek V4 Pro 审计总计 3 次、媒体 0、保守费用约 ¥0.01754；普通 WorkBuddy 样例成功且只有一个 succeeded AgentRun/一次 5 积分结算，失败链积分释放/补偿且不留伪成功。`lanqi:business-qa-smoke`、API/Web/Agent typecheck、`qa:fast`、`qa:regression`、`qa:full`（含 build）与 `git diff --check` PASS；当前 5176/3016 桌面生成、追问、刷新及 console 0 PASS。
- 状态：LQ-17 受控流程范围 P0/P1=0。当前用户入口恢复 `controlled_mock`、media disabled；修复后高风险真实样例未追加调用，真实答案质量和外部 WorkBuddy Connector/OAuth 仍须后续独立授权验收，不能宣称生产已开放。

## QA-20260903-001：静态 Bearer 全工具路由被误当成 WorkBuddy OAuth 主链（本地范围已关闭；外部验收待前置条件）

- 风险：正式仓库原有 WorkBuddy MCP 使用数据库静态 Bearer 并暴露完整工具集，不能证明 OAuth 2.1 + PKCE、公共客户端、标准claims、逐调用重授权和最小单工具权限。
- 修复前红灯：新增专项第一次稳定失败于缺少隔离 OAuth PoC 模块；没有通过文字说明或复用旧 token 冒充主链。
- 最小修复：增加未注册生产 server 的隔离授权/MCP 模块，只暴露 `lanqi.get_profile_summary`；拒绝一切客户端自报 tenant/user/product，按401→400→404→403语义失败关闭；审计不可用返回503。候选目录没有运行引用。
- 回归：公共客户端无secret、PKCE、一次性code、token rotation/revoke、完整claims、30顺序/10并发、3轮高风险、限流、超时、幂等冲突、脱敏响应与非计费usage均PASS；Provider/媒体/积分/费用0。
- 状态：本地代码P0/P1=0。由于尚未在WorkBuddy开发者后台创建测试Connector，也没有公开非生产HTTPS OAuth/MCP地址和真实回调登录，本条只关闭本地协议缺口；真实WorkBuddy E2E继续BLOCKED，不得对外宣称第②层完整通过。


## QA-20260901-005：窗帘/窗框自然竖纹被条码检测误拒绝（检测子范围已关闭；产品真实3/3仍待验收）

- 现象：safety-v2.15修复后真实终验第1张已经是完整暖色门店咨询空间，人工只读未见文字、Logo、二维码、条码、水印、UI、人物、设备或包装，但自动门禁在左侧窗帘/窗框竖纹触发`qr_or_barcode_like / barcode_stripes`，整批按规则失败关闭。
- 脱敏证据：底图SHA短值`3d8fe077…84cd`；命中框`x=0,y=320,w=208,h=64`，`decoded=false`、edgeGroups=14、stripeScore=0.765、quietZone=1、density=0.136、directionConsistency=0.662、edgeIntervalVariation=0.451、confidence=0.892。不得保存Prompt、Provider正文或客户数据。
- 根因边界：v2.15的条纹间隔变化范围能排除等距木格栅，却仍允许部分窗帘/建筑竖纹进入条码证据；仅凭间隔变化、方向和静区不足。人工观察不能覆盖自动fail-closed。
- 失败语义：Provider任务1、技术成功1、客户资产0；第2/3张未提交，300测试积分一次预留后全额释放，保守费用¥0.20，无重试/repair/换模/补图/追加/第4任务。
- 下一红灯：以本次脱敏中间特征为安全Champion，加入真实QR/条码风险正例以及窗帘、窗框、木格栅、百叶和建筑竖线安全对照；一次只改一个联合证据变量，连续3次precision/recall=`1.000/1.000`且历史风险召回不下降后方可关闭。禁止SHA/路径白名单和付费重试。
- 环境：approval已删除，grant仅保留不可重放消费审计；正式stop/start恢复media disabled/max0，source/runtime短指纹`8DAAF013`一致、source_fresh=true、ready/database=true、Web200。
- 修复前红灯：v2.15 Champion除原指标外，横向静区`minorQuietZone=0`且边缘贯穿度`edgePersistence=1`；证明这是贯穿画面的窗帘/窗框自然结构，而不是有边界终止的编码标记。
- 被拒绝方案：仅将最小edgeGroups从14提高到16虽能让本图通过，却令相邻伪文字/Logo风险样例漏检；该Challenger未进入正式代码。
- 最小修复：`beauty-image-safety-v2.16`只增加`encodedStripeBoundaryEvidence`联合证据，要求足够的横向静区或非整段贯穿边界，并保留低密度伪标记分支。未使用SHA/路径白名单，未降低QR、条码、文字/Logo、UI、水印、人物或设备召回。
- 回归：窗帘专项安全18/18、风险12/12；建筑条纹专项安全12/12、风险18/18；全量精度集安全30/30、风险58/58连续3次，precision/recall=`1.000/1.000`。图片/XHS/composition/持久化/URL/观测专项、API/Web/Agent typecheck、`qa:fast/regression/full`含build及`git diff --check`PASS；Provider/网络/grant0、费用¥0。
- 状态：检测Bug关闭。产品仍为P1，因为当前source=`B13FB306`与runtime=`8DAAF013`不一致、media disabled/max0，且尚无v2.16真实三图3/3证据；不得创建邀请或让用户验收旧runtime。

## QA-20260901-004：空白木格栅被条码检测误拒绝（P1，已关闭）

- 用户影响：prompt-v1.7已经生成真实、完整的暖色门店咨询空间，但第1张安全底图被自动门禁误判，整批客户资产0，因此当前仍不能让用户验收图片。
- 真实红灯：底图SHA短值`2cf4738e…c205`、768×1024；人工只读未见文字、Logo、QR、水印、UI、人物或设备。`barcode_stripes`在空白竖向木格栅框`528,180,144,64`给出confidence=0.98，decoded=false、edgeGroups=27、stripeScore=1、quietZoneScore=0.6、edgeGroupDensity=0.38、directionConsistency=1，最终触发`qr_or_barcode_like`。
- 精确根因边界：当前条码联合证据可仅凭密集同向竖线和较弱quiet-zone成立，缺少真实条码的可解码/finder、条宽变化、边界静区及建筑材质排除证据。此结论只针对脱敏几何指标，不使用SHA/路径白名单，也不以人工判断覆盖自动门禁。
- 失败关闭与费用：新不可重放grant只创建第1个`wan2.7-image`任务，技术成功、质量拒绝；第2/3张未提交，Provider1、保守¥0.20，客户资产0。300测试积分一次预留后全额释放，重试/repair/换模/补图/追加/第4任务0。
- 下一回归：用真实QR/条码风险正例、该木格栅及其他建筑线条安全负例建立零Provider Champion/Challenger；一次只改一个联合证据变量，连续3次precision/recall=`1.000/1.000`且全部历史硬风险继续REJECT后才能考虑新付费批次。
- 当前环境：临时approval删除、grant已消费不可重放，正式stop/start恢复`safe_default / controlled_mock / media disabled/max0`；source/runtime=`28184266…`、fresh、ready/database=true、Web200。
- 修复前自动红灯：专属专项稳定复现v2.14在木格栅bbox上的误拒；其条纹edge interval variation为`0.232`，而真实/合成QR和条码风险夹具分别为`0.619`和`0.365`。
- 最小修复：v2.15只在条码条纹证据中增加`0.35–0.62`的间隔变化范围，要求候选既不能是近似等距建筑格栅，也不能是房间结构形成的高度不规则长边组合。未按SHA/路径放行，其他硬风险门禁不变。
- 回归关闭：专属12安全/18风险同批连续3轮、全量28安全/58风险均达到precision/recall=`1.000/1.000`；图片/XHS/持久化/URL/观测专项、API/Web/Agent typecheck、`qa:fast/regression/full`含build和diff-check全部PASS。Provider/外网/grant0、费用¥0。产品仍需另一个受权真实三图批次证明3/3客户可用，本条检测Bug本身已关闭。

## QA-20260901-003：XHS真实商业摄影图含伪文字/Logo/人像QR样式或展示台牌（P1，检测子范围已关闭）

- 用户影响：旧确定性图只有文字与简化场景；切回真实商业摄影链后，首张虽有完整门店空间，但墙面出现伪英文，桌面含设备Logo、带人像/二维码样式桌牌及包装文字，仍不可交付。
- 修复前/中间红灯：高级感专项证明旧新批次指向本地几何图；同页专项捕获Provider prompt缺3:4；真实quote-only捕获`3*0.2`浮点误差把合法¥0.60误判超限。三项已分别最小修复并转绿。
- 当前真实失败：新不可重放grant仅创建1个`wan2.7-image`任务，技术成功且形成768×1024最终PNG；`safety-v2.13`自动状态曾为passed、无风险证据，但人工只读明确发现上述四类风险，因此操作员reject并停止后续两张。
- 安全/账本：客户资产0；300测试积分一次预留后全额释放；Provider任务1、保守费用¥0.20，自动重试/repair/换模/补图/追加/第4任务均0。临时media approval已删除，环境恢复disabled/max0。
- 已通过门禁：XHS高级感、input preflight、同页、结构、客户交付、real-media合同、composition、persistence、URL、media-observability、API/Web typecheck、qa:fast/regression/full含build、diff-check和1440/390 quote-only。
- 未关闭根因：自动检测对同一场景中的伪展示文字、Logo、人像/QR样式桌牌和包装文字出现组合假阴性。下一步须以该资产脱敏几何/证据与真实正负例做零ProviderChampion/Challenger；禁止SHA白名单或降低既有召回。成功标准为连续3次precision/recall=1.000后再考虑新的真实批次。
- 零Provider根因：真实底图短SHA `aadedfc9…e1f` 的两行伪英文位于采样图中段，超出v2.13顶部文字带范围；通用glyph候选又被碎片化，自动证据为空。
- 最小修复：`beauty-image-safety-v2.14`新增中段双行对齐、高密度笔画带联合证据，只在两行位置、间距、中心漂移和转换密度同时成立时拒绝；无SHA/路径白名单，不改变其他硬风险门禁。
- 回归：真实失败图REJECT；7张真实安全图PASS、6张风险图REJECT，连续3次precision/recall=`1.000/1.000`。图片/XHS专项、API/Web/Agent typecheck、`qa:fast/regression/full`含build与diff-checkPASS，Provider0、费用¥0。
- v2.14修复后真实复验：零费用报价先发现受控启动上层标记real、底层`LANQI_MEDIA_EXECUTION_MODE`仍disabled；已把底层real/local storage加入正式启动硬校验。放行后第1张真实生成完整门店接待场景，但墙面仍含清晰伪英文招牌；v2.14正确以`qr_or_barcode_like / visible_text_or_brand_like`拒绝并停止第2/3任务。底图短SHA`b2fd41ed…3133`，Provider1、保守¥0.20、客户资产0，300积分全额释放。
- 上游构图根因红灯：两张真实失败图均为封面角色；v1.5三角色payload虽禁止文字/Logo，却继续要求正面接待区、中央主视觉墙和上方展示区域，模型有稳定的招牌承载面。Champion只保存脱敏SHA、质量原因和payload哈希，不保存图片正文、Prompt或Provider响应。
- 最小修复：`beauty-image-provider-prompt-v1.6`只增加一个`signage_carrier_free_composition`变量：侧向机位、材质墙由帘布/木格栅/绿植/阴影打断，并排除中央品牌墙、招牌墙、海报框、价目牌、展示板、台牌、屏幕和产品标签。没有修改safety-v2.14、账本、租户、角色或客户中文后期合成合同。
- 回归：新专项纳入`qa:fast`，三角色payload均满足新构图、保持互异/英文纯画面/3:4；图片生成、包装、互动、人物设备、高级交付、质量、real-media、XHS同页、API/Web/Agent typecheck与`qa:fast/regression/full`含build、diff-check全部PASS。Provider/网络/grant0、费用¥0。
- 新证据：prompt-v1.6批次第1张已生成完整暖色门店接待场景，但前台仍出现带伪文字/二维码样式的展示台牌；v2.14正确拒绝并停止第2/3张。Provider1、保守¥0.20、客户资产0、300积分全额释放。
- 展示台牌红灯：最新真实底图SHA `13211c9d…144b`证明v1.6已消除中央招牌墙且保留完整暖色门店空间，但接待台仍生成独立展示牌；正式safety-v2.14以`qr_or_barcode_like`正确拒绝。Champion三角色payload哈希证明缺口是正向构图仍允许可放置展示物的水平表面，不是检测漏报。
- 最小修复：`beauty-image-provider-prompt-v1.7`只新增`empty_horizontal_surface_composition`变量：封面以座椅/地面/帘布/木格栅/绿植构图且不出现前台柜台；角色确需桌面时要求整面空置、斜向拍摄，并在正负约束中排除桌牌、立牌、展示牌、价目/菜单/传单、二维码收款牌、屏幕、设备、产品和包装。没有改变三角色、商业摄影完整度、safety-v2.14、composition-v1.1、账本或租户边界。
- 回归：脱敏Champion/Challenger同批连续3次PASS；三角色payload互异、英文纯画面、3:4、高级光影材质与完整空间合同继续成立。图片生成/包装/互动/高级交付/real-media/media-observability、XHS同页、用户路径、WorkBuddy、API/Web/Agent typecheck、`qa:fast/regression/full`含build和diff-check均PASS，Provider/网络/grant0、费用¥0。
- 状态：展示台牌构图诱因的零Provider子范围已关闭；BY-43产品P1仍为1，因为尚无prompt-v1.7修复后3/3真实证据。media保持disabled/max0，不能邀请用户；下一唯一恢复点为新的精确不可重放grant下真实三图终验，不得追加本批调用或循环付费。

## QA-20260901-002：XHS三图把抽象渐变底图冒充门店场景（P1，已关闭）

- 用户影响：用户完成图文任务后只看到文字叠在近似空白的渐变/纹理底图上，无法辨识接待区、护理区或到店承接空间，却被页面当作三张图片交付。
- 修复前红灯：`beauty-deterministic-visual-v1`固定输出`soft_light_field / material_flow / spatial_ripple`，真实页面只读检查没有任何门店空间元素；专项钉死旧版本、场景类型和元素密度差距。
- 根因：零Provider策略只解决了自由图片的伪文字/Logo与稳定性问题，但确定性生成器没有消费“门店场景”产品合同，页面也没有区分通用场景与本店实景。
- 最小修复：版本化升级为`beauty-deterministic-visual-v2`，三角色显式绘制接待咨询区、护理空间、到店承接空间；回执持久化scene policy/scene/element count/hash。页面标明通用美业门店场景、非本店实景、默认不含人物。要求本店还原或人物出镜且无授权参考资料时，quote/confirm均在job/积分前422失败关闭。
- 回归：隔离合成租户真实Chromium创建全新文字任务与全新图片批次，3张768×1024最终PNG、逐图下载、刷新/历史、1440/390、双击单confirm、owner/跨租户404、console/网络0；图片300测试积分一次结算。未授权请求job0、积分不变。Provider0、费用¥0。
- 用户验收准备：当前合成验收租户原余额192不足一次三图确认，使用仓库正式幂等grant补308至500；页面刷新显示500，未调用Provider或产生人民币费用。
- 门禁：场景、确定性视觉、XHS同页、媒体观测专项，API/Web/Agent typecheck，`qa:fast`、`qa:regression`、`qa:full`含build及`git diff --check`全部PASS；范围P0/P1=0。

## QA-20260901-001：电脑重启后本机免邀请码入口停在旧登录页（P1，已关闭）

- 用户影响：用户打开已提供的本机XHS入口，只看到此前加载的登录页或无法继续开通，不能判断产品是否可测试。
- 修复前红灯：独立检查确认55434、3016、5176均无listener，API `/ready`与Web均connection refused；正式status同时报告database no response、api/web offline、pid_matches_listener=false。真实浏览器首次直达稳定`ERR_CONNECTION_REFUSED`。
- 根因：电脑重启后受控环境没有自动恢复；旧runtime/pid文件仍在，但对应进程不存在。不是用户输入、XHS Skill、登录回跳或Provider错误。
- 最小修复：在端口均空闲且没有未知进程的前提下，仅用同一AcceptanceRoot正式start重新启动当前仓库PostgreSQL/API/Web并生成新运行记录；没有新增匿名入口、生产免登录或业务代码绕过。
- 回归：source/runtime=`5C879173…72EB`且fresh，PID/listener/绝对命令一致、ready database=true、Web200；真实无会话/失效会话Chromium 1440/390px、原深链+apiBase、刷新/返回、双租户、console/网络0全部PASS。auth专项、API/Web typecheck、qa:fast/regression/full含build、diff-check均PASS。
- 状态：BY-42范围P0/P1=0，Provider0、费用¥0；BY-41仍是独立PAUSED图片场景任务，BY-19/BY-20继续PAUSED，不部署。


## QA-20260831-003：XHS缺必需任务事实仍进入付费生成并事后失败（P1，已关闭）

- 用户影响：用户只填主题即可点击生成，页面不说明还缺项目/服务和目标顾客；模型完成结构输出后才被事实保留合同拒绝，虽然积分退回，但用户只看到“没有生成”。
- 修复前红灯：脱敏真实运行固定route/Skill正确，参数只有`questionPresent=true`和`professionalOptionKeys=[imageCount]`；Provider完成3标题/7标签/3图方向适配后命中`rubric_fact_retention_weak`。新增专项在修复前因readiness API不存在稳定FAIL。
- 根因：Web只校验主题长度；服务端任务快照会从经营档案回退项目/顾客，但事实directive只读本次options/自然语言，导致同一任务存在两个事实源，且缺失资料没有在Provider/积分前失败关闭。
- 最小修复：新增统一XHS readiness与有效任务快照。主题、项目/服务、目标顾客为必填；后两项允许经营档案默认，本次字段优先且不回写。Web逐项提示/禁用；API和WorkBuddy共用执行层在Provider/预留前422，事实directive与持久化快照复用同一有效值。
- 回归：真实API缺项目/顾客返回`beauty_xhs_information_required`，AgentRun0、CreditReservation0；Chromium1440/390px覆盖缺失/补齐、刷新/返回、双租户、console/网络0。XHS相邻专项、typecheck、qa:fast/regression/full含build与diff均PASS。
- 状态：范围P0/P1=0，Provider0、费用¥0；受控环境source/runtime=`4A8B91E5`且fresh，未部署，BY-19/BY-20继续PAUSED。

## QA-20260831-002：本机 XHS 直达在浏览器残留失效会话时无法恢复（P1，已关闭）

- 用户影响：用户打开已提供的本机 XHS 直达链接，页面显示“当前页面暂时没有加载成功/请先完成微信登录和账号绑定”，看不到可恢复登录入口；有效 token 注入式 smoke 曾误报可验收。
- 修复前红灯：全新 Chromium 的无会话路径可正常登录，但写入失效 token 后，同一路径对工作台四个启动接口收到401并停在错误页；静态`auth:product-login-smoke`也因缺少401恢复门禁FAIL。
- 根因：`BeautyIndustryAcquisitionPage`只在本地完全没有 token 时跳产品登录；`loadWorkspace()`收到401后与普通API错误统一写入`loadError`，既不清旧 token也不保存回跳。并行启动请求还会放大鉴权失败噪声。
- 最小修复：先用overview验证会话，再并发读取历史/档案/连接；仅401清理旧 token并复用BY-36的安全同产品深链回跳。403/404/500、网络失败和跨租户拒绝不触发登录恢复。
- 回归：新增真实 Chromium 1440/390px失效/无会话回归，覆盖原XHS URL+apiBase、填写后主按钮、刷新、任务中心返回、双租户、登录后console/网络0，业务POST0、Provider0；既有navigation浏览器回归、auth静态门禁、Web typecheck、`qa:fast/regression/full`含build及diff-check均PASS。
- 状态：P0/P1=0，费用¥0；本机受控环境source/runtime=`6DDF9C2B`且fresh，未部署，BY-19/BY-20继续PAUSED。

## QA-20260831-001：XHS 图片交付依赖一次性 Provider 模式且无法稳定形成客户三图（P1，已关闭）

- 用户影响：固定 XHS 路由、文字 Skill 和图片计划均正确，但图片确认依赖可撤销的真实媒体 profile；自由生成底图又持续出现包装、伪品牌、文字或无法可靠自动判定的物体语义，受邀用户无法稳定完成三图交付。
- 修复前红灯：正式链缺少确定性视觉服务；controlled text 预览误禁图片确认；验收数据库缺少已提交品牌迁移；同步双击发出两个 confirm 请求。QA-20260830-003 已证明继续追加物体语义启发式或重复付费批次不能形成可靠闭环。
- 根因：产品交付把“品牌视觉”错误绑定到自由生成产品摄影及一次性 Provider 授权，而现有本地合同只能证明安全风险，不能可靠证明任意瓶罐场景可交付；前端又缺同步确认锁。
- 最小修复：新增 `beauty-deterministic-visual-v1`，服务端只从 tenant/product 品牌配置取得通用主题 token，确定性生成 768×1024 三角色无字抽象底图，经既有 safety 与 composition-v1.1 后原子持久化。无效版本、角色、尺寸、哈希、主题回执失败关闭；历史 Provider job 只读。前端增加同步确认锁，不改变固定 XHS Skill、租户、账本或媒体安全门禁。
- 回归：真实 Chromium 1440/390px 验证3图预览/下载、刷新/历史、双击单请求、owner/跨租户404、console0、external Provider0；文字8积分、图片300积分各一次结算。确定性视觉、图片URL/generation/composition/XHS同页/real-media、API/Web/Agent typecheck、`qa:fast/regression/full`含build全部PASS。
- 状态：QA-20260830-003由产品视觉合同调整一并关闭；P0/P1=0，费用¥0，WorkBuddy候选运行引用0，未部署。

## QA-20260830-003：XHS 内容图真实 Provider 忽略无包装单场景合同（P1，已由确定性视觉策略关闭）

- 用户影响：三图显式确认后，内容角色可能生成带瓶罐/标签承载物的拼贴画面；即使技术成功也不能作为客户图片交付。
- 修复前红灯：prompt-v1.3 的内容角色没有排除包装、瓶罐、容器和标签面；专项稳定FAIL。页面相邻红灯还证明历史/刷新并发quote可能以旧响应覆盖当前重生成任务。
- 零费用修复：独立升级`beauty-image-provider-prompt-v1.4`，只将内容角色改为中性材质单一摄影场景；封面/互动不变。页面用请求序列拒绝过期quote，并按当前文字任务/失败批次恢复重新报价。未知版本与旧通用fallback继续失败关闭。
- 零费用回归：内容包装、XHS媒体重试、generation-success、real-media、same-page、质量、持久化、URL、媒体观测、API/Web/Agent typecheck和`qa:fast/regression/full`含build全部PASS；Chrome 1440/390px、刷新/历史/跨租户/console0，Provider0。
- 真实证据：新不可重放批次最多3张，实际提交2张。封面PASS；内容底图SHA`e9af2a0e…2a803`被`qr_or_barcode_like`拒绝，第三张未提交。自动条码证据可能受自然竖线影响，但人工只读同时确认该图是三联拼贴并包含多处瓶罐，已经独立违反prompt-v1.4，故不能放行或按误报处理。
- 账本/费用：客户资产0；300积分一次预留、一次全额释放/补偿，净0；保守费用¥0.40；无重试、补图、文本、视频或ASR调用。
- 当前状态：prompt-only 未提高到可放行的一次成功率，P1保持打开。下一原子只做“内容角色单场景/包装承载物”的可解释post-generation合同可行性与`barcode_stripes`独立精度审计；不得继续相同prompt付费试跑、降低QR/条码门禁或堆无证据几何白名单。
- 后续零费用闭环：脱敏 Champion 证明 safety-v2.12 的 `barcode_stripes` 只凭11组自然竖线、密度0.058且无解码证据误报；v2.13 单变量要求密度≥0.080，连续3轮安全3/3、条码9/9拒绝，图片总集26安全/58风险 precision/recall=`1.000/1.000`。同时新增 `beauty-image-content-role-contract-v1`，真实三联拼贴明确拒绝并钉死新job/route/live runner。
- 可行性边界：当前仓库没有经过离线正负样本验证的物体语义能力，无法可靠判断瓶罐、包装、标签或品牌承载物。风险图与真实安全场景均保持 `manual_review_required`、客户不可见；这不是3/3成功率闭环，P1继续打开且不请求重复付费。下一步仅允许先做本地物体语义能力/许可证/离线资产的零网络审计。
- 环境：正式stop/start后source/runtime=`842B5645` fresh，PG55434、API3016/PID21472、Web5176/PID20636，已恢复safe_default/media disabled/max0；未创建邀请码。

## QA-20260830-002：维护重启丢失 XHS 本机真实验收模式（P1，已关闭）

- 用户影响：BY-35 已放行固定 DeepSeek 与用户显式确认后最多三图，但 BY-36 维护重启后即使 `source_fresh=true`，页面仍退回 controlled_mock/media disabled，用户无法验证真实模式与300积分确认。
- 修复前红灯：同一源码、相同configured文本下，把期望 runtime profile 从 `safe_default` 切到 `xhs_user_acceptance_v1`，旧启动决策仍Reuse；回归为 `PASS=56/FAIL=1`。
- 根因：受控启动/runtime只持久化并比较文本模式；媒体模式、产品开关、最大张数和完整验收profile均缺失，status还从调用者shell默认值推断媒体身份。
- 最小修复：AcceptanceRoot增加无密钥显式profile；start/status/runtime/start-decision完整记录并比较profile与媒体边界，启动时重新校验固定模型、approval、max3、300积分、本地存储和人民币上限，未知/缺失配置fail-closed。密钥仅从既有API配置加载到目标进程，不落新文件或日志。
- 回归：修复后 `PASS=60/FAIL=0`；二次正式stop/start仍为text configured/media real/max3且source/runtime=`E037402C` fresh。Chrome 1440/390px quote-only确认按钮可用，刷新/返回/跨租户/console通过，confirm0、Provider0、费用¥0；XHS/媒体专项、API/Web/Agent typecheck、qa:fast/regression/full含build及diff PASS。

## QA-20260830-001：本机免邀请码登录覆盖美业 XHS 原深链（P1，已关闭）

- 用户影响：受控环境离线时直达地址完全无法连接；按正式脚本恢复后，未登录用户虽可点击“本机直接开通”，但被送到产品首页而不是原 XHS 工作台，用户仍无法按收到的直达链接验收。
- 修复前红灯：先记录55434/3016/5176无监听与ready/Web连接拒绝；环境恢复后真实Chrome桌面路径稳定超时在原XHS URL断言，排除route不存在、API未ready和Provider因素。
- 根因：美业页保存`store_os_post_login_redirect`后，`LoginPage`产品挂载 effect 无条件用`defaultPath`覆盖；美业保存值仅有pathname，还会丢失本机已校验的`apiBase` query。
- 最小修复：只保留当前product允许前缀下的内部相对回跳，其他值重置为当前产品首页；美业页保存pathname/search/hash。没有放宽dev-login生产拒绝、租户授权或开放重定向门禁。
- 回归：静态产品登录门禁与真实Chrome 1440/390px覆盖直达、免邀请码、刷新、前进后退、双租户、overflow和console；Provider调用0。`qa:fast`、`qa:regression`、`qa:full`含build、Web typecheck和diff PASS。正式stop/start后source/runtime=`E037402C`、fresh/ready/database=true、Web200。

## QA-20260829-006：真实小红书文字正常返回但制作结构不稳定而无法保存（P1，已关闭）

- 2026-08-30最终闭环：修复前红灯证明live runner把专业字段错误作为WorkBuddy顶层参数发送，公开MCP只接受嵌套`professionalOptions`；同时API与postflight对`女性/女生`和年龄范围采用不同语义，可能在API结算后再由postflight拒绝。修复为嵌套传参，并让API/Agent统一执行“年龄范围必须保留、合理女性同义词可归一化、缺年龄为missing、男性或错误年龄为contradiction”。
- 修复后唯一真实终验：`deepseek-v4-pro`1次、stop/fallback=false、tokens `3685/841/0/4526`、约¥0.018677；Schema/Eval、事实/矛盾/第一人称/污染/合规、老板可用性全部PASS。唯一succeeded AgentRun、8积分一次预留一次结算、Web/WorkBuddy一致、重复请求无第二次调用；媒体Provider0。
- 页面/环境/邀请：真实Chrome桌面1440和390px、刷新/历史、兰琪/默认品牌、跨租户、console0和300积分图片确认入口PASS，未点击图片确认。环境source/runtime=`8AFCF24A`且fresh/ready/database；新24小时单次邀请仅存hash。全量门禁PASS，P0/P1=0，QA关闭。
- 2026-08-30第三次修复后终验：先以合成结构稳定复现`image_direction_1_post_text_multiline`，最小修复只将`postProductionText`中的运输换行/连续空白折叠为单个空格；正文与其他单行字段仍维持原门禁。专项与调用前qa通过后，新的不可重放grant仅调用`deepseek-v4-pro`1次，stop/fallback=false、tokens `3640/931/0/4571`、约¥0.019147；媒体0、无重试/repair/换模/追加。
- 新Champion（脱敏）：结构适配已PASS，正式postflight仅命中`rubric_fact_contradiction / target_audience`。目标顾客回执只保留hash/字节数与布尔特征：6 bytes、含“女生”口语同义词、不含男性词、不含25–45岁范围；不保存客户原文、模型正文、Prompt或凭据。该证据证明当前规则既可能把合理同义词当矛盾，也没有锁住年龄事实。
- 新路径P1：API用户路径在独立postflight拒绝前已经保存succeeded AgentRun并结算8积分，说明运行时与postflight使用的事实源/判定不一致。已使用`compensateSettledCreditReservation`幂等补偿一次，Run改为failed且output清空，reservation compensated/actual0，1 consume+1 refund、净0；不删除历史审计、不伪造Provider退款。
- 当前恢复点：先新增相同脱敏结构的API→合同→持久化/账本红灯，统一两侧任务事实源；目标顾客需保留明确年龄范围，“女生/女性”等合理同义词只参与语义匹配，缺少年龄应判missing而非contradiction，真正男性替换仍必须contradiction。修复前不得再付费调用或创建邀请。
- 2026-08-30修复后真实终验：新一次性grant严格调用`deepseek-v4-pro`1次，stop/fallback=false、tokens `3640/885/0/4525`、约¥0.018827，其他Provider0。新诊断精确为`field_validation / image_direction_1_post_text_multiline`：顶层7键、3标题、7标签、3图方向、6事实键均存在，但封面后期叠字值含换行，在正式workflow合同之前被单行字段校验拒绝。该次没有再命中`rubric_not_boss_usable`，也不能作为旧rubric修复的真实成功证据。
- 失败语义/postflight：AgentRun0，8积分恰好一次预留、一次consume与一次等额refund，reservation released、净额0；临时WorkBuddy凭据和entitlement均撤销，grant已consumed，环境恢复controlled_mock/media disabled。未保存模型正文、Prompt、密钥或客户原文。
- 新红灯/恢复点：下一原子任务应先用脱敏结构fixture稳定复现`postProductionText`换行，比较“单行输出指令”与“仅对该制作元数据做确定性空白归一化”的最小候选；不得改写客户正文、降低结构/事实/合规门禁或追加真实调用。
- 2026-08-30新证据：新的唯一真实复验已通过严格JSON适配与确定性Markdown渲染，`deepseek-v4-pro` 1次、stop、fallback=false、tokens `3585/801/0/4386`、约¥0.018051；正式质量合同仅命中`rubric_not_boss_usable`。AgentRun0、8积分一次预留一次释放、媒体0，未保存原始模型正文。
- 新根因：`hasDirectlyUsableAsset()`的通用关键词不包含XHS正式客户层“标题候选/正文/话题标签/互动与承接”，导致结构完整的长结果是否通过取决于正文是否偶然写出“文案”。这不是模型能力、JSON、route、万相链或账本问题。
- 新红灯：脱敏Champion记录适配成功、标题3/标签5–8/三图3/事实回执6键和唯一rubric；同一合成正式结构去掉非合同必需的“文案”一词后，旧实现稳定FAIL。不得读取或补造真实正文。
- 最小修复：只对固定XHS capability/Skill链识别正式客户层，并同时要求3标题、正文≥60、5–8标签、互动非空和客户层无内部术语。缺标题、缺标签、缺互动继续失败；事实、矛盾、第一人称、跨行业、合规及图片安全合同未改。
- 可观测补口：route/provider/adapter/quality/ledger/result改为结构化安全事件，记录请求/租户指纹、字段存在/计数/hash、目标host/path哈希、HTTP/耗时、response hash/bytes、usage/finish/fallback、适配阶段、精确flags和最终码；禁止客户原文、Prompt、Authorization、完整响应或可逆正文。
- 五用例replay：用户给出的5条直接生图文本均零Provider运行；4条只能进入固定XHS文字任务preflight并等待保存文字与显式图片确认，最短1条在Web Schema的question minLength失败。没有自由文本直接图片工具，也没有图片/文本调用或费用。
- 回归：XHS结构、safe trace replay、事实保留、controlled contract、客户交付、同页图片、fixed-route、WorkBuddy与workflow composition专项、API/Web/Agent typecheck、`qa:fast`、`qa:regression`、`qa:full`（含build）及`git diff --check`全部PASS；Provider/外网/grant0、费用¥0。无DOM/路由变化，未重复页面E2E。
- 当前状态：零Provider根因子范围关闭；仍须一次修复后真实DeepSeek相同输入证明唯一AgentRun、8积分结算、Web/WorkBuddy和页面恢复后，才关闭本产品P1。本轮不创建grant/邀请、不启用图片。

- 用户影响：同页本次需求完整、余额充足且浏览器无控制台错误，文字生成仍显示“系统未生成有效结果”，结果区与最近任务均为空，图片也无法进入显式确认。
- 精确证据：两次独立DeepSeek调用均`finish_reason=stop`、reasoning0、fallback=false；固定capability/scope/Skill 1.0.3链正确。第一次正式合同拒绝`xhs_deliverables_负向提示词_count`，第二次质量Eval拒绝`missing_contract_terms_负向提示词`。AgentRun0，每次8积分一次预留一次释放；图片任务与费用0。未保存Prompt、完整Provider输出、密钥或客户资料。
- 根因：配置Provider直接按长自然语言要求生成Markdown；Schema要求三套正/负提示、后期叠字与视觉参数，但单次输出传输层没有机器结构，且正式美业链按安全规则不允许第二次repair，因此可能正文合格而制作字段遗漏。
- 修复前红灯：`beauty-industry:xhs-provider-structure-p1-smoke`在旧实现因缺`beauty-xhs-provider-output-v1`稳定FAIL；红灯同时锁定本次项目、顾客、城市、门店事实与本次快照传入后端。
- 最小修复：配置DeepSeek强制一次`json_object`，严格校验标题、正文、5–8标签、互动、三角色五字段、事实回执与合规待补，再确定性渲染为原正式Markdown。缺字段直接失败关闭，不repair、不模板覆盖正文、不降低现有事实/第一人称/污染/合规门禁。
- 候选拒绝：WorkBuddy关于“万相同步接口错误、F盘无真实出图源码”的诊断来自旧快照，且与本次文字阶段不符。当前正式仓库已有DashScope异步submit/task_id/轮询及真实三图审计；本缺陷不修改图片异步链、不访问线上旧工程。
- 修复后证据：严格JSON传输、确定性Markdown渲染及结构/事实/污染/第一人称/WorkBuddy/25KB预算和全仓门禁均离线PASS。唯一真实DeepSeek调用为正常stop，tokens `3585/937/0/4522`、约¥0.018997；随后结构化适配器失败、API500，现有通用错误映射只留下`provider_failure:unknown`，没有正文可供事后读取。
- 失败关闭：AgentRun0；8积分一次预留一次释放、净0；媒体Provider0；临时凭据和entitlement撤销。此次授权已耗尽，不追加调用，不创建邀请。
- 零费用可观测修复：新增脱敏replay Champion；结构化适配器现在把JSON解析、顶层形状、字段校验、渲染分别映射为正式`invalid_response`和安全合同规则，只记录响应hash/bytes/代码围栏标记/顶层类型与键数/标题、标签、三图、事实回执数量。代码围栏与额外键用例修复前因`providerFailure`缺失稳定FAIL，修复后PASS；回调异常也不能替换fail-closed。
- WorkBuddy候选矩阵：采纳本地三阶段审计、脱敏结构指标和replay；拒绝原始输出/客户原文日志、远程生产归因、未经证据断言DeepSeek/共享能力/某个字段必为根因及放宽文字Logo/二维码/水印/UI安全门禁。`inspectProviderOutputsAgainstPrimaryContract`观察适配后的规范Markdown，适配失败时outputs=0，不是原始JSON的第三次复验。
- 回归：XHS结构、事实保留、controlled contract、客户交付、fixed-route、workflow composition、Web/WorkBuddy、API typecheck、`qa:fast`、`qa:regression`、`qa:full`（含build）与`git diff --check`PASS；Provider/外网/grant0、费用¥0。
- 状态：零费用可观测子范围已关闭，产品P1继续。历史真实响应未持久化，无法事后确定具体字段；下一唯一恢复点是在新的明确真实文本授权下至多一次相同脱敏复验。此前不得猜字段、放宽正式合同、创建邀请或修改无关万相异步链。

## QA-20260829-005：真实无字底图含可见中文但safety-v2.11自动门禁漏检（P1，已关闭）

- 用户影响：QA-004关闭后的精确批次runner已能只处理本次3个job，但第1张真实底图顶部出现可见中文；自动门禁返回passed并允许进入确定性叠字。若没有人工只读门禁，该底图会被误当客户可用成品基础，三图不可放行。
- 脱敏证据：底图768×1024、短SHA `e98c0d51…92dc`；最终PNG短SHA `7142a6df…d0f1`。safety-v2.11的`qualityStatus=passed`、证据数0；人工只读仅用于拒绝客户交付，没有覆盖或改写自动结论。未保存Prompt、Provider正文、密钥或客户数据。
- 安全处置：只创建第1个`wan2.7-image`任务；人工拒绝后第2/3任务未提交。整批`quality_failed`，客户资产/下载0；300测试积分一次预留、一次全额释放，净0；保守外部费用¥0.20，其他Provider0，无重试、补图、换模、追加或第4张。
- 精确根因：384×512采样图的顶部三字符形成一个`x166/y28/w51/h19`、fill0.589、aspect2.684的连通组件；v2.11把单字组件宽度限制为46，导致整个文字块在字形分组前被排除，后续stroke-band也未命中，因此evidence为空。
- 最小修复：`beauty-image-safety-v2.12`只在既有分离字形和顶部笔画带均未命中时，增加位置、宽高占比、fill与aspect同时成立的`connected_top_display_text_block`证据；不按SHA/路径放行，不改变二维码、条码、Logo、UI、水印、人物或总fail-closed。
- 关闭证据：26安全/58风险连续3次precision/recall=`1.000/1.000`；修复后唯一真实批次恰好3个`wan2.7-image`任务，三张最终PNG自动+人工3/3客户可用，300积分一次结算，保守¥0.60。刷新对象URL竞态由runner等待真实图片完成加载后零Provider恢复验证；桌面/390px、下载、刷新、跨租户、console及全量门禁PASS。
- 状态：QA-005与BY-35产品P1关闭，P0/P1=0；一次性开发grant已消费封存。本机单次邀请验收按既有授权启用固定DeepSeek V4 Pro与media real/max3，要求用户显式确认300积分且单任务≤¥1，生产未启用，历史失败批次不重判。

## QA-20260829-004：真实三图runner把历史终态批次误认成本次确认批次（P1，零Provider根因已关闭）

- 用户影响：prompt-v1.3/safety-v2.11真实终验已正确创建首张新图，但runner在confirm后读取同一AgentRun的历史`quality_failed`批次并触发job身份断言；若继续会使人工复核对象和Provider顺序不可审计，因此按首失败停止，不能交付3/3。
- 脱敏证据：本批仅1个Provider任务；底图`6b39f1cd…100d9`、最终PNG`0041cfef…87564`，自动与人工只读均PASS。第2/3 job无ProviderTaskId；300积分全额释放、客户资产0、保守费用¥0.20。没有记录Prompt、Provider正文、密钥或客户数据。
- 根因：live runner虽然在结束时检查job是否新建，却在轮询阶段仍依赖通用`/media/jobs`返回的“最新批次”，没有绑定页面本次confirm的精确job集合；复用含多个历史批次的正式文字run时可先看到旧终态。另有grant版本与源码正则断言v1.3/v2.11对v1.2/v2.10的不一致，会在Provider前误阻断。
- 最小修复：确认响应后用相同幂等键恢复精确3个job ID，终态与人工逐图复核只接受该集合；匹配不足继续等待。源码版本正则同步v1.3/v2.11，并在real-media smoke锁定两个版本与exact-job过滤。没有放宽图片安全、账本、租户或首失败停止门禁。
- 回归：真实失败批次Chrome只读1440/390px、刷新/历史、owner/跨租户404、console0、外部请求0、账本变化0；相关图片/XHS专项、API/Web/Agent typecheck、qa:fast/regression/full+build及diff-checkPASS。修复阶段Provider0。
- 状态：QA-004的runner根因已关闭；BY-35仍缺修复后真实3/3，产品P1=1。已消费grant不复用，media disabled/max0，不创建邀请码、不部署。

## QA-20260829-003：互动图生成手持手机/UI而显式风险门只以木纹glyph偶然拒绝（P1，已关闭）

- 用户影响：safety-v2.10真实终验的封面与内容最终成品均可用，但互动底图出现手持手机和界面设备构图，违反plan-v2/prompt-v1.2的纯摄影静物、无人、无UI合同，三图完整交付失败关闭。
- 脱敏证据：互动底图768×1024、SHA `350b1f39…b994a`。人工只读只用于确认手部与手机设备风险，不覆盖自动门禁；自动证据为`visible_text_or_brand_like/glyph_sequence`，bbox落在木桌纹理且`readableSequenceRecovered=false`，说明本次虽安全拒绝，但错误归因不能稳定替代对手持手机、空白屏幕、局部手部和UI设备的显式检测。
- 安全处置：恰好3个Provider任务，无重试/补图/第4张；整批客户资产/下载0，300测试积分一次预留一次全额释放、净0，保守费用¥0.60，其他Provider0。媒体已恢复disabled/max0，未创建邀请码。
- 下一红灯：以该资产作只读风险正例，分别锁定role→plan→payload确实禁止人物/手机/UI，以及detector对手持设备/局部手部/空白屏幕的明确风险原因；保留全部安全负例和真实文字/Logo/水印/UI/QR/人物召回，连续3次precision/recall=1.000。不得依赖木纹误报、SHA白名单或付费重试。
- 根因与修复：固定route/Skill/plan并未缺失；engagement的Provider适配没有显式禁止手部/手机/屏幕，safety-v2.10也没有手持设备联合证据。prompt-v1.3只增加互动角色约束；safety-v2.11要求亮色竖屏、暗框、边缘密度和邻近肤色区域同时成立后才输出`person_or_device_like`，不因单一矩形或木纹拒绝。
- 回归补口：旧浏览器runner把同一AgentRun的两个历史批次累计成6个任务，造成假失败；现按持久化`batchRequestId`验证最新批次，仍严格单批最多3张且全程只读。
- 关闭证据：26安全/57风险连续3次precision/recall=`1.000/1.000`；真实/合成手持设备拒绝，真实封面/内容安全图PASS。图片/XHS专项、API/Web/Agent typecheck、qa:fast/regression/full+build、diff-check及真实Chrome 1440/390px、刷新、跨租户、console0全部PASS；Provider/网络/grant0、费用¥0。QA-003关闭，但BY-35仍待修复后真实3/3终验，不创建邀请码。

## QA-20260829-002：自然瓶罐/毛巾/台面被safety-v2.9误判为角落水印和可见文字（P1，已关闭）

- 用户影响：BY-35最终真实三图终验的第2张底图技术成功且人工只读未见文字、品牌、Logo、水印、二维码、UI或人物，但自动门禁同时命中`interface_or_watermark_like`与`visible_text_or_brand_like`，三图批次按正确安全语义停止，不能交付。
- 精确证据：底图短SHA `df997146…f04c`、768×1024；`corner_watermark/edge_components`位于右下角毛巾/台面区域，`glyph_sequence`位于瓶罐/家具横向纹理区域。前者activeRows=31、inkDensity=0.135、activeCols=68；后者glyphCount=9、glyphLikeRatio=0.889、widthCoverage=0.641，但没有恢复可读字符序列。只保存脱敏几何/统计，不保存Prompt或Provider原始响应。
- 为何旧测试遗漏：QA-20260829-001只针对顶部低对比伪文字漏报新增fallback，并用此前25安全/56风险池证明旧风险召回；该安全池没有当前“毛巾褶皱+浅色台面+多瓶罐”联合几何，无法暴露corner/glyph双误报。
- 安全终态：第3图未提交，实际Provider任务2、保守费用¥0.40，客户资产/下载0；300测试积分一次预留一次全额释放、净0。人工判断没有覆盖自动fail-closed。
- 回归要求：以真实资产作只读脱敏Champion，补同类安全负例与真实文字/Logo/水印/UI/QR风险正例；一次只改一个联合证据变量，连续3次precision/recall=1.000/1.000后才允许升级safety。禁止SHA/路径白名单、全局降阈值或再次付费试错。
- 根因与修复：v2.9仍允许两个缺少显式文字结构的弱证据独立拒绝：corner bright-ink没有字形/解码支撑，通用glyph序列又允许8/9组件像字形。`beauty-image-safety-v2.10`删除前者并把后者的字形一致率固定为1.000；无SHA/路径白名单，不改变真实QR/条码、文字Logo、UI水印、人物或总fail-closed。
- 回归与状态：真实负例现PASS；26安全/56风险同批连续3次precision/recall=`1.000/1.000`，图片/XHS/持久化/URL/媒体观测、API/Web/Agent typecheck和qa:fast/regression/full+build通过。QA-002关闭、P0/P1=0；后续真实批次的新互动风险另记QA-20260829-003。

## QA-20260829-001 safety-v2.8 漏检顶部低对比伪中文（P1，零Provider检测闭环）

- 用户影响：BY-35 composition-v1.1真实终验的第1张底图技术成功且完成合成，但底图顶部含模型生成的低对比伪中文；自动safety-v2.8错误PASS，人工客户可用性门禁拒绝，三图不能交付。
- 脱敏证据：底图768×1024、SHA `e91ef4af…aa331`；v2.8 reasons/evidence为空。Champion只记录哈希和检测特征，不保存Prompt、Provider响应或用户资料。
- 安全处置：第1张人工拒绝后第2/3张未提交；客户资产/下载0，300测试积分一次消费一次全额退回、净0；Provider任务1、保守费用¥0.20，其他Provider0，无重试/补图/第4张。
- 根因：既有候选选择依赖连通edge components形成字形序列；这组顶部低对比字样在缩放后没有形成候选，旧分支遂只看见底部纹理。独立行特征显示顶部连续17行高密度横向明暗转换、峰值98，属于此前夹具未覆盖的新分布。
- 最小修复：`beauty-image-safety-v2.9`仅在既有字形候选不存在时补充顶部高密度笔画带证据，同时要求顶部位置、连续行、每行转换密度、20%–85%水平覆盖和亮度差；不改变任何既有风险阈值，不使用SHA/路径白名单。
- 回归：真实失败图现被`glyph_sequence/visible_text_or_brand_like`拒绝；25安全/56风险同批连续3次precision/recall=`1.000/1.000`，历史QR/条码/文字Logo/UI水印/人物继续拒绝。图片/XHS/real-media零调用/持久化/URL/媒体观测/合成专项、typecheck、qa:fast/regression通过，Provider/外网/grant0、费用¥0。
- 状态：检测子范围P0/P1=0；BY-35真实3/3仍须随后唯一受控终验验证，不以离线门禁冒充客户交付。

## QA-20260828-007 服务端合成允许重复超长标题被省略号截断（P1，已关闭）

- 用户影响：BY-35已能把无字底图安全合成为最终PNG，但唯一真实终验的封面叠字存在语义重复、超长和省略号截断，不是老板可直接使用的客户成品；三图完整交付因此失败关闭。
- 脱敏证据：唯一`wan2.7-image`任务技术成功，底图原子落盘并通过safety-v2.8，`beauty-image-composition-v1`完成最终PNG；最终图768×1024、SHA `2e7b888d…cea52`。人工只读仅用于客户可用性门禁，没有覆盖自动安全门禁。
- 安全处置：第1图拒绝后第2/3图未提交；客户资产/下载0，300测试积分一次消费一次等额退回、净0；Provider任务1、保守费用¥0.20，其他Provider0，无重试、修复、换模、补图、追加或第4张。未创建邀请码，隔离API/Web已停止且媒体撤权。
- 根因：选中标题只校验“属于正式标题候选”，合成器以固定字号/最大行数绘制并在超出时追加省略号；没有在Provider与积分预留前验证重复片段、客户可读长度和版面可容纳性。安全门禁没有错误，缺口位于合成输入合同与排版预检。
- 修复前红灯：专项以短SHA和脱敏重复标题分布固化Champion，在实现前稳定因缺少`preflightBeautyImageOverlay`失败；覆盖重复、超长、短标题、中英标点、emoji及三角色。
- 最小修复：`beauty-image-composition-v1.1`用实际CJK字形测量做完整换行、字号、行高、安全边距和最大行数适配；quote/confirm在积分预留与Provider前执行同一预检。只去掉“标题1：”等非语义展示前缀；不自动改写语义，不使用省略号，不能完整容纳则精确422要求缩短或另选。
- 回归：768×1024与390×520全部正例完整保留，重复/超长/不可靠符号全部失败关闭；三角色composition与真实Chrome桌面/390px同批连续3次，正向保存/刷新/双租户和重复标题精确422（图片资产0）均PASS；XHS/媒体零调用/持久化/URL/观测、API/Web/Agent typecheck与qa:fast/regression/full+build通过。Provider/外网/grant=0、费用¥0，未改safety-v2.8。
- 状态：QA关闭，本零费用范围P0=0、P1=0；旧真实批次保持历史FAIL-CLOSED，BY-35真实3/3仍待后续独立终验，本轮不创建邀请码。

## QA-20260828-006 safety-v2.7 未阻断图片中的明显展示文字（P1，已关闭）

- 用户影响：BY-34修复后真实三图仍不能交付；首图虽然自动检测为passed，但画面顶部出现明显中文展示文字，不符合“纯画面、文字仅作后期叠字元数据”的客户合同。
- 脱敏证据：`wan2.7-image`唯一技术任务成功并原子落盘，768×1024、SHA `66b9a75b…f199`；自动safety-v2.7 reasons为空，人工只读明确识别展示文字后通过正式operator gate拒绝。第2/3图未提交，客户资产/下载0。
- 安全处置：整批quality_failed；300积分一次consume、一次等额refund，净0；Provider 1次/保守¥0.20，其他Provider0，无重试、修复、换模、补图、追加或第4张。grant已消费封存，media恢复disabled/max0，未创建邀请。
- 漏测：既有54个风险夹具覆盖文字/Logo/QR/UI等合成与历史分布，但没有覆盖“大号稀疏中文展示文字位于纯色背景、与主体明显分离”的本次真实分布；人工门禁正确兜底，不能据此声称自动检测理解了画面。
- 修复前红灯：正式精度脚本稳定证明v2.7对同一SHA返回passed。脱敏Champion显示旧分支仅验证rank1候选，rank1因gap variation 2.422与edge density 0.028不合格后直接结束；真正展示文字候选位于rank10，glyph-like ratio=1、baseline=0、height variation=0.022、edge density=0.323，却没有进入判定。
- 根因与最小修复：`beauty-image-safety-v2.8`只新增高置信顶部展示文字候选选择，要求上部位置、合理覆盖、edge density>=0.25、baseline<=1.25、height variation<=0.12且全部构件宽高比像字形；没有SHA/路径白名单，不改变QR/条码、普通文字/Logo、UI/水印、人物或fail-closed。
- 回归：真实风险图现以`glyph_sequence/visible_text_or_brand_like`拒绝；安全25/25、风险55/55同批连续3次precision/recall=`1.000/1.000`。图片/XHS/real-media零调用/持久化/URL/媒体观测、API/Web/Agent typecheck及`qa:fast/regression/full`（含build）通过，Provider/外网/grant0、费用¥0。
- 状态：QA关闭，本检测原子P0/P1=0；无DOM/路由变化未重复E2E，media保持disabled/max0。未执行或自动开启新付费终验；BY-19/BY-20继续PAUSED，不部署。

## QA-20260828-005 历史正式XHS任务被当前运行模式重标为流程预览（P1，已关闭）

- 用户影响：正式Skill1.0.3文字任务、三图报价和媒体entitlement均正确，但历史恢复后确认按钮仍disabled，无法进入获批三图终验。
- 根因：history与幂等replay没有持久化结构化交付的preview/formal属性，而是按API当前Provider模式统一重建；controlled-mock验收环境因此把旧正式任务误标为preview。
- 修复：把`beauty_delivery_preview:yes/no`写入AgentRun质量标记；history/replay优先读取每任务证据，旧记录仅保留当前模式兼容回退。历史按钮增加稳定run-id，验收器精确选择目标任务；客户端继续消费持久化delivery属性，不放宽Skill/事实/媒体门禁。
- 回归：XHS工作台/同页图片、API/Web typecheck、qa:fast/regression/full+build均PASS；真实页面目标run quote=`initial_confirmation_ready`且确认按钮可用。Provider/积分调用发生在该前置P1关闭之后。
- 状态：已关闭，P0/P1=0。

## QA-20260828-004 safety-v2.6 将清水静物误判为二维码/条码（P1，已关闭）

- 用户影响：BY-33 状态机修复后的最终真实用户路径仍无法交付三图；首图被自动质量门拒绝后，后两图按顺序停止，用户不能查看或下载任何部分结果。
- 脱敏证据：唯一真实图片任务技术成功并原子落盘，768×1024、SHA `60f2ea68…68bb8d`；正式 detector=`beauty-image-safety-v2.6`，reason=`qr_or_barcode_like`、confidence=0.953。人工只读仅见清水玻璃碗、白毛巾和绿叶静物，没有识别出二维码、条码、文字、品牌、UI或人物；人工观察只建立误报候选，未覆盖自动fail-closed。
- 安全处置：第1图拒绝后第2/3图未提交，实际Provider task=1，无第4张、重试、修复、换模、补图或追加。客户资产/下载0；300测试积分一次预留一次等额释放，净0；保守外部费用¥0.20，DeepSeek/其他Provider0。未创建新邀请码，旧未使用邀请已停用；环境恢复text=controlled_mock、media=disabled/max0。
- 漏测：既有离线QR/条码precision/recall夹具没有覆盖“透明玻璃碗同心圆边缘、水滴和毛巾织物”这一真实Provider分布；静态fixture与此前3/3成功不能证明新采样不会误报。BY-32重构后的live runner还保留旧DOM selector，导致前置恢复检查假阴性；selector修复后真实请求才执行，前置失败均为Provider0。
- 下一红灯：保存该资产和safety evidence为只读脱敏负例，输出QR finder/decode、平行条纹、quiet-zone及组合几何中间证据；与真实QR/条码/文字Logo/UI/水印风险正例同批连续3次评估。只允许单变量Challenger；不得SHA白名单、不得用人工直放、不得降低真实风险召回。
- 根因：safety-v2.6 的 QR finder 只核对一维 `1:1:3:1:1` 横纵截面和三中心几何，未校验二维 7×7 finder 明暗结构，因而清水玻璃碗边缘/水滴构成误命中。
- 修复：`beauty-image-safety-v2.7` 仅增加 QR finder 二维模式平均一致度 `>=0.72`。真实安全负例平均 `0.510`通过，合成 QR 平均 `0.878`仍拒绝；条码、文字/Logo、UI/水印、人物与 fail-closed 均未改变，无 SHA/路径白名单。
- 回归：25 个安全例/54 个风险例同批 Eval 连续 3 次 precision/recall=`1.000/1.000`；图片质量、generation-success、real-media 零调用、持久化、URL、media-observability、XHS同页与全仓门禁通过。
- 状态：该精度子范围 P0=0、P1=0；Provider/外网/grant=0、费用¥0。真实 3/3 用户放行未在本轮执行，未自动开启付费终验。BY-19/BY-20继续PAUSED，不部署。

## QA-20260828-003 XHS旧失败图片批次锁死新文字任务且缺少本次需求快照（P1，已关闭）

- 用户影响：首个图文任务三图已因客户质量失败关闭并退积分；用户生成第二个文字任务后，三图处于等待确认但按钮不可点击且无可行动原因。旧失败页也只能告知不可查看/下载，没有“修改本次图片要求并再次确认”的安全路径；页面又只能跳到长期经营档案，无法表达每次变化的主题、目标和画面要求。
- 修复前证据：脱敏数据库证明旧任务有3个`quality_failed/refunded`媒体作业，第二个成功文字任务没有媒体作业；API却以租户历史总数执行`historicalCount + requested > maxPerTenant`而返回`quota_exhausted`。媒体读取与结算还按整个run合并所有作业，无法表达同一任务的后续显式批次。固定XHS route/Skill与文字输出均正常。
- 根因：把“每个受控批次最多3张”错误实现为“租户生命周期最多3个图片作业”；缺少稳定批次域键、图片要求哈希和重试状态机。同时本次可变信息没有独立任务快照，只能依赖长期档案或自由文本。
- 最小修复：新增`media-batch`与`xhs-task-snapshot`通用核心合同，以`AgentRun + batchRequestId`隔离查询、提交、终态、账本和资产；每个新文字任务独立获得一次确认。旧quality_failed仅在用户显式选择重试、修改图片要求并重新确认费用时创建唯一新批次；自动重试、未修改重试、重复请求和第4张继续阻断。页面新增本次需求编辑与“本次采用的信息”，档案只预填不回写。
- 防回退：新增`beauty-industry:xhs-media-retry-p1-smoke`覆盖历史3作业、新run、同run失败/要求变化/未变化、批次排序和候选0引用；更新真实媒体排序断言至批次模块，并把浏览器污染断言收窄到真实客户复制区域，避免导航说明假阳性。受控Chrome桌面/390px覆盖双击、保存/刷新、跨租户、console0、external provider0。
- 品牌/费用：实现属于beauty-industry通用核心，兰琪仅来自现有服务端品牌配置；WorkBuddy候选运行引用0。真实Provider0、费用¥0、媒体确认点击0、未部署。
- 状态：QA与BY-33已关闭，范围内P0/P1=0；真实图片模式仍须独立精确授权，不以controlled mock冒充付费路径。

## QA-20260828-002 XHS通用renderer暴露内部执行信息且可选邀请码丢失品牌授权（P1，已关闭）

- 用户影响：正式XHS固定路由与后端合同已存在，但Web仍复用通用工作区，不能选择标题，复制/结果层混入制作与质量信息，并直接展示模型/Provider等技术状态；同时本机`INVITE_REQUIRED=false`时，显式兰琪邀请码被当作disabled，兰琪租户错误显示默认品牌。
- 修复前红灯：`beauty-industry-xhs-workbench-v2-p1-smoke`稳定失败`xhs_workbench_v2_component_missing`；真实品牌Chrome E2E证明数据库邀请码为`brandCode=lanqi`但validate响应为default。两项均发生在正确固定workflow之外的Web呈现/邀请校验边界，不是Skill、路由或品牌配置缺失。
- 根因：XHS缺少专属客户renderer；通用页面面向多能力的折叠信息被直接暴露。邀请码服务又在检查显式code之前依据“邀请非必填”过早返回disabled，丢弃持久化品牌授权。
- 最小修复：新增beauty-industry通用核心XHS工作台，仅消费正式结构化合同并把客户成品、图片任务、历史分层；复制只含选中标题/正文/话题。邀请服务改为仅在“未提供code且邀请非必填”时返回disabled，显式code始终验证DB。不改固定Skill、媒体、账本、租户、幂等或三图整批合同。
- 品牌与候选隔离：组件/CSS只使用服务端品牌token，不含兰琪名称、商标色或品牌知识；兰琪包仍由tenant/product授权派生。WorkBuddy候选未复制为运行资产，candidates/intake/quarantine运行引用0。
- 防回退：真实Chrome桌面1440/390px验证兰琪/默认双租户、XHS结果、复制、三图卡、刷新与跨租户，console0、Provider0、media确认点击0。XHS/固定路由/品牌/WorkBuddy、API/Web/Agent typecheck、qa:fast/regression/full+build与diff-check全部PASS。
- 状态：QA与BY-32关闭，范围内P0/P1=0；费用¥0、未部署，BY-19/BY-20继续PAUSED。

## QA-20260828-001 DeepSeek真实XHS文案写入无依据第一人称体验（P1，已关闭）

- 用户影响：BY-31唯一真实文本smoke中，DeepSeek V4 Pro技术成功且正常结束，但输出含输入未提供的“我做过”。正式合同在保存前拒绝，用户无法取得可用文案；未向用户开放入口。
- 安全证据：Provider恰好1次，fallback=false，tokens=`3560/1098/0/4658`、耗时约25.7秒、保守¥0.020031；错误规则=`beauty_workflow_output_contract_failed:forbidden_我做过`。未保存Prompt/完整模型正文/原始响应/密钥。AgentRun0，8积分一次预留一次释放、净0，媒体Provider0。
- 漏测与根因：`wechat-xhs-content-line@1.0.2`虽要求事实边界，但没有明确约束标题、正文、制作说明、审核回执都不得使用无输入事实支持的第一人称体验；既有fixtures覆盖事实遗漏和污染，没有覆盖“结构完整但虚构亲历”的真实分布。不能归因路由或Provider失败。
- 最小修复：升级`wechat-xhs-content-line@1.0.3`，新增全输出层禁用“我做过/亲测/做完后”等无事实体验，缺少可核验第一人称经历时只能采用门店中性说明，且不得把禁词移入制作/审核层。正式合同继续拒绝违规词，不做模板覆盖、重试、换模或放宽Eval。
- 防回退：新增正式prompt composition红灯；XHS结构/事实/客户交付/同页图片、Skill admission、runtime manifest及WorkBuddy候选0引用均PASS。prompt最终24997/25000 bytes；qa:fast/regression/full+build、桌面1440/390px真实模式零调用页面检查与diff通过。
- 修复后真实证据：新增精确授权仅调用`deepseek-v4-pro`1次，thinking disabled、finish=`stop`、fallback=false、usage event1，保守费用¥0.019404≤¥0.13，媒体/文件上传/其他Provider0；正式Schema/Eval、任务事实回执、事实矛盾、跨行业污染与第一人称门禁全部PASS，唯一succeeded AgentRun，8积分一次结算，Web/WorkBuddy一致。
- 伴随验收脚本回归：MCP文本通道按产品合同仅返回客户复制稿，完整制作说明/审核回执在结构化字段与AgentRun。旧runner错误地以客户稿验完整workflow合同，造成`missing_contract_terms`假阴性。现分层验收并以同一持久化真实结果离线复核，禁止未来再次把客户复制稿当完整合同；这不是放宽正式合同或重算模型正文。
- 状态：QA关闭，BY-31范围内P0/P1=0。真实授权已消费并停止，无自动重试/修复/换模/追加；已在全量门禁通过后创建24小时/最多1次beauty-industry邀请记录，明文不写仓库或日志。

## BY-26 safety-v2.6 最终真实三图完整交付（业务P1已关闭）

- 最终证据：新的不可重放grant仅允许 `aliyun_bailian/wan2.7-image`、plan-v2/prompt-v1.2/safety-v2.6和3个顺序任务。实际封面、内容、互动图各1次，768×1024，SHA分别为 `3e4e59ee…fc3a9`、`c8173368…dbe21`、`1c145b97…b2643`；三图技术、落盘、自动质量与人工只读客户可用性均PASS，无第4次、重试、修复、换模、补图或追加。
- 客户/账本：batch=`succeeded`、客户资产/下载3，300测试积分一次预留一次结算；重复确认无新增Provider task或交易，owner可读且跨租户404。保守Provider费用¥0.60≤用户¥1，文本/视频/ASR/其他Provider0。
- 防回退：真实Chrome桌面1440/390px、刷新/历史、三图下载、console0；图片precision安全23/23、风险54/54、precision/recall=1.000，图片/XHS/持久化/URL/媒体观测、API/Web/Agent typecheck及`qa:fast/regression/full`（含build）全部PASS。
- 状态：BY-26三张客户合格图业务P1关闭，范围内P0/P1=0。一次性grant/approval已删除，环境恢复media disabled/max0并保持source_fresh=true；仅验收环境通过，不部署生产，历史失败批次不重判。

## QA-20260827-014 plan-v2/prompt-v1.2内容图被`ui_layout`误判（P1，检测精度子范围已关闭）

- 用户影响：最新受控三图终验中，封面图完整PASS；第2张内容图技术成功并原子落盘后被`interface_or_watermark_like/ui_layout`拒绝，第3张不再提交，整批客户资产与下载为0。
- 脱敏证据：内容图SHA `f00d1cb9…f8d8`、768×1024；detector=`ui_layout`、confidence=0.926、bbox=`(20,422,678,600)`，panelLikeRegions=5、horizontalLongEdges=4、verticalLongEdges=14、rowGroups=3、columnGroups=4、repeatedBarRegions=2、alignedPanelEvidence=true、bidirectionalLongEdgeEvidence=true。人工只读只见无字无标的米色泵瓶、圆托盘、窗边与木桌静物，未识别文字、Logo、二维码、条码、水印、UI或人物；人工观察只建立疑似误报证据，不覆盖自动门禁。
- 安全处置：没有SHA白名单、阈值放宽、人工直放或Provider重试。第2张拒绝后互动图未提交，实际Provider任务2且无第3/4次；batch=`quality_failed`、客户资产/download0，300测试积分全额释放、净0，保守Provider费用¥0.40，其他Provider0。
- 漏测：现有safety-v2.5离线安全22/22、风险54/54与连续3次precision/recall=1.000，没有覆盖“多件空白泵瓶+圆托盘+窗框/桌面长边”同时形成双向长边、面板与重复条带的真实Provider分布。此前`ui_layout`修复只排除了缺少横向长边的单向自然结构，不足以区分本次密集静物构图与真实界面网格。
- 伴随runner红绿灯：真实smoke先证明grant缺少plan-v2钉死；修复后grant必须同时匹配plan-v2/prompt-v1.2/safety-v2.5。Windows Chrome 151启动改用`DevToolsActivePort`，人工审核资产目录改为仓库绝对路径解析；两项只修验收编排，没有新增批次、重试Provider或改变业务合同。
- 验证：live postflight、桌面1440/390px、刷新/历史、重复确认、owner/跨租户404、console0、外部追加Provider0；图片/XHS专项、API/Web/Agent typecheck、precision受控集及`qa:fast/regression/full`（含build）全部PASS。grant/approval删除，媒体恢复disabled/max0，环境source_fresh=true。
- 修复前红灯：正式采样链稳定复现f00d的`ui_layout`拒绝；v2.5 Champion固定panel=5、横/纵长边=4/14、row/column groups=3/4、repeatedBars=2，并推导panel-grid occupancy=0.417。证明旧规则把分散在3×4位置中的5个自然轮廓直接当成规则UI网格。
- 根因与最小修复：旧panel-grid只要求面板数量、行列组和双向长边，没有要求有效面板高密度占据行列交点。`beauty-image-safety-v2.6`只增加`panels/(rowGroups×columnGroups) >= 0.60`单变量；repeated-bars、QR、条码、glyph、corner-watermark、真实文字/Logo、UI、人物和客户fail-closed均未改变，无SHA/路径白名单。
- Champion/Challenger证据：两份脱敏fixture保存相同几何指标、0.417实际值、0.60门槛及panel/repeated-bars分支结果；不保存图片正文、Prompt、Provider响应、凭据或租户标识。正式检测器、real-media smoke与live runner同步钉死v2.6；历史v2.5结果不重判。
- 扩展回归：安全集加入f00d后23/23 PASS；真实产品UI、真实人物+伪标签、历史二维码样式/伪品牌图与合成QR、条码、中英文/乱码、Logo、水印、角标、卡片、按钮、弹窗及变体共54/54 REJECT。同批连续3次precision/recall=`1.000/1.000`，Provider calls=0。
- 验证与状态：图片/XHS专项、API/Web/Agent typecheck、`qa:fast/regression/full`（含build）和diff全部PASS；Provider/外网/grant=0、费用¥0。无DOM/路由变化，按范围未重复E2E且未刷新环境，media继续disabled/max0。**QA-20260827-014检测精度子范围已关闭，P0/P1=0**；BY-26三张客户合格图业务P1仍为1，下一恢复点为既有≤¥1授权下的plan-v2/prompt-v1.2/safety-v2.6最多3张真实终验。BY-19/BY-20继续PAUSED，不部署。

## BY-26 safety v2.5真实终验：互动图含展示文字与卡片UI（P1，生成诱因子范围已关闭，完整交付未关闭）

- 用户影响：封面与内容图均达到自动和人工可用标准，但互动图真实包含中文展示文字和卡片式界面；三图完整交付合同因此失败，客户资产/下载为0。
- 脱敏证据：第三图SHA `acc26153…385d`、768×1024；`visible_text_or_brand_like/glyph_sequence`拒绝。画面人工只读确认有明显展示文字及UI布局，只用于证明该拒绝是真阳性，不覆盖自动门禁；未记录Prompt、Provider响应、凭据或测试租户标识。
- 安全处置：恰好3个Provider任务，无第4次、重试、修复、换模、补图或追加；整批`quality_failed`，300测试积分一次预留并全额释放，净0，保守费用¥0.60。两张安全图因完整三图承诺保持客户不可见。
- 回归：live postflight、桌面1440/390px、刷新/历史、重复确认、owner/跨租户404、console0、图片/XHS专项、API/Web/Agent typecheck及`qa:fast/regression/full`（含build）全部PASS；postflight追加Provider0。
- 修复前红灯：脱敏 Champion 固定真实 SHA、engagement 角色、风险原因与旧版本语义。专项初跑因当前仍返回 plan-v1/prompt-v1.1 稳定FAIL；相邻XHS专项进一步证明正式制作说明中的“画面下方留白”会原样进入Provider payload，不能只在角色常量末尾追加禁止项。
- 根因：旧 engagement role→plan→payload 同时使用“互动问题、后期互动短句安全区、下方留白”等正向排版语义，和已有非卡片/按钮负向约束冲突；真实模型产出的中文展示文字与卡片UI因此属于可解释的生成诱因，safety-v2.5 拒绝是正确真阳性。
- 最小修复：版本化为 `beauty-xhs-image-plan-v2` / `beauty-image-provider-prompt-v1.2`，只把互动角色改为与正文一致的完整纯摄影静物/环境细节，并在互动payload中移除留白/安全区/互动问题语义，显式排除海报、卡片、清单、信息图、社交UI、按钮、对话框、标题栏和文案区；互动文案只留在网页/后期元数据。封面/内容payload哈希保持v1.1 Champion，不改变safety-v2.5。
- 回归：Challenger连续3次PASS；图片安全22/22、风险54/54，precision/recall=`1.000/1.000`；XHS同页、媒体合同/持久化/URL/观测、API/Web/Agent typecheck和`qa:fast/regression/full`（含build）全部PASS，Provider/网络0、费用¥0。
- 状态：生成诱因零Provider子范围已关闭，P0/P1=0；BY-26三张客户合格图完整交付P1继续打开。下一步是按既有≤¥1授权以 plan-v2/prompt-v1.2/safety-v2.5 做一次最多3张、无自动重试的受控真实终验。

## QA-20260827-013 v2.4 将右下圆形棉片/织物纹理疑似误判为角落水印（P1，检测精度子范围已关闭）

- 用户影响：v2.4修复后的最终真实三图终验仅提交封面图；技术成功并落盘后被`interface_or_watermark_like`拒绝，后两图不再提交，整批客户资产和下载为0。
- 脱敏证据：SHA `19f36810…d946`、768×1024；detector=`corner_watermark`、method=`edge_components`、confidence=0.978、bbox=`(556,968,104,20)`，glyph=6/6、widthCoverage=0.577、edgePixelDensity=0.125、readableSequenceRecovered=false。人工只读仅见米色中性容器、毛巾、右下圆形棉片与织物纹理，未识别出文字、Logo、二维码、水印、UI或人物；人工观察只建立疑似误报证据，不覆盖自动门禁。
- 安全处置：无SHA白名单、阈值放宽或人工直放。首图拒绝后内容/互动图均未提交，总任务1且无第2/3/4次调用；batch=quality_failed、owner/跨租户资产404、download0，300测试积分全额释放、净0，保守Provider费用¥0.20，其他Provider0。
- 漏测：v2.4离线安全21/21、风险54/54与连续3次precision/recall=1.000，没有覆盖“圆形棉片边缘+桌布纹理在右下角形成紧凑基线构件序列”的真实Provider分布；此前修复的是通用glyph多数构件比例，不是corner-watermark的局部语义边界。
- grant门禁伴随修复：真实runner原先没有钉住prompt/safety版本，红灯先报缺prompt版本；现要求grant与当前源码同时为prompt-v1.1/safety-v2.4，且`real-media-smoke`固化该Provider前门禁。
- 本轮验证：live postflight、桌面1440/390px、刷新/历史、重复确认、owner/跨租户404、console0、外部追加Provider0；图片/XHS专项、API/Web/Agent typecheck、`qa:fast/regression/full`（含build）全部PASS。grant/approval已删除，环境正式恢复media disabled/max0。
- 修复前红灯：正式采样链稳定复现同一`corner_watermark/edge_components`拒绝；Champion补齐mean component height=4.333、sampled union height=10、ratio=0.433，证明旧规则把低矮自然纹理组件当成具有完整字符高度的角落水印序列。
- 根因与最小修复：旧corner sequence缺少组件相对联合框的垂直占比证据。`beauty-image-safety-v2.5`仅增加mean component height/union height≥0.55，且同时把实际值与门槛写入脱敏evidence；无SHA/路径白名单，不改变QR、条码、通用文字/Logo、真实水印/UI、人物、manual-review或客户fail-closed。
- 扩展回归：安全集新增该圆形棉片/桌布图后22/22 PASS；真实历史坏图、真实UI/人物风险及合成QR、条码、中英文/乱码、Logo、水印、角标、卡片/按钮/弹窗和变体共54/54 REJECT。相同Eval连续3次precision/recall=`1.000/1.000`。
- 验证：图片precision/quality/generation-success/real-media零调用/持久化/URL/media-observability/XHS、API/Web/Agent typecheck、`qa:fast/regression/full`（含build）和diff全部PASS；Provider/网络/grant=0、费用¥0。没有Web/DOM/路由变化，按范围未重复E2E，也未刷新或启用媒体环境。
- 状态：**检测精度子范围已关闭，P0/P1=0**。历史v2.4批次不重判、不开放下载；BY-26三张客户合格图业务P1仍为1。下一恢复点按既有单批≤¥1授权重新物化prompt-v1.1/safety-v2.5的最多3张真实终验；BY-19/BY-20继续PAUSED，不部署。

## QA-20260827-012 v2.3 将无字无标瓶罐静物误判为可见文字或品牌（P1，检测精度子范围已关闭）

- 用户影响：v2.3修复后的真实三图终验中，封面图完整PASS；第2张内容图技术成功并落盘后被`visible_text_or_brand_like`拒绝，第3张不再提交，整批客户资产和下载为0。
- 脱敏证据：内容图SHA `bc044be3…af61`、768×1024；自动质量=`rejected`、理由=`visible_text_or_brand_like`。人工只读仅见四个米色无标签瓶罐、木架与毛巾，未识别出可见文字、品牌、Logo、二维码、水印、UI或人物。人工观察只用于建立疑似误报P1，不能覆盖自动门禁。
- 安全处置：没有SHA白名单、阈值放宽或人工直放。第2张拒绝后立即停止，第3张未调用；batch=quality_failed、owner/跨租户资产404、下载0，300测试积分全额释放、净0。实际2个图片Provider任务、保守¥0.40，其他Provider0。
- 漏测：v2.3离线安全20/20、风险54/54与连续3次precision/recall=1.000，没有覆盖本次“多件空白哑光瓶罐+瓶身高光/轮廓+木架”构图在文字/品牌检测分支上的真实采样特征；离线总分通过不能替代真实Provider分布。
- 本轮验证：live postflight、重复确认、owner/跨租户404、桌面1440/390px、刷新/历史、console0、图片/XHS专项、API/Web/Agent typecheck、`qa:fast/regression/full`（含build）和diff均PASS；Provider额外调用0。grant/approval/临时续跑脚本已删除，media恢复disabled/max0。
- 修复前红灯：v2.3 Champion 稳定命中 `glyph_sequence`；5个对齐组件中仅3个 glyph-like，ratio=0.6，最长宽高比6.8，bbox=`(194,796,306,26)`，readableSequenceRecovered=false。证明瓶底/高光/木架长边只靠基线、间距、覆盖宽度和边缘密度即可误入文字分支。
- 根因与最小修复：通用 glyph sequence 缺少“多数构件自身像字形”的证据。`beauty-image-safety-v2.4` 只增加 glyph-like component ratio≥0.75，并输出构件数量、占比和宽高比摘要；没有SHA白名单，不改变QR、条码、真实文字/Logo、水印、UI、人物、manual-review或客户fail-closed。
- 扩展回归：安全集加入本次原始无字瓶罐/木架图后21/21 PASS；真实历史坏图、真实UI/人物风险与合成QR、条码、中英文/乱码、Logo、水印、UI及变体共54/54 REJECT，precision/recall=`1.000/1.000`且连续3次一致。极端人工缩小/低对比安全变体会触发其他既有分支，本原子未越界修改或宣称放行。
- 验证：图片precision/quality/generation-success/real-media零调用/持久化/URL/media-observability/XHS、API/Web/Agent typecheck、`qa:fast/regression/full`（含build）和diff全部PASS；Provider/外网0、费用¥0。无页面变化，未重复E2E。
- 状态：**检测精度子范围已关闭，P0/P1=0**。BY-26三张客户合格图业务P1仍为1；历史批次不重判、不开放下载，媒体继续disabled/max0，BY-19/BY-20继续PAUSED。

## QA-20260827-011 品牌若由页面硬编码或请求自报会造成跨租户漂移（P1，已关闭）

- 风险：原正式美业壳层把“美业智能体”和绿色写死在页面，邀请码、租户档案和WorkBuddy都没有版本化品牌上下文。直接为兰琪改页面会让默认租户串品牌，或允许客户端通过brand参数绕过租户归属；后端正式capability/Skill映射本身不是根因。
- 修复前红灯：`beauty-industry:brand-package-p1-smoke` 初次稳定失败，缺少 `brand-config.ts`；锁定默认/兰琪/未知品牌、未授权知识、伪造参数、Web/WorkBuddy同源和去掉兰琪注册后的核心可运行性。
- 最小修复：新增 `beauty-industry-brand-v1` 与独立 `brand-packages/lanqi.ts`；邀请码兑换在同一事务写入当前租户品牌归属，overview、Shell和WorkBuddy从同一RequestContext解析。业务/登录请求自报品牌在账本前400失败；知识保持空且不注入Prompt。没有复制页面、Agent、Skill、MCP、账本或业务表。
- 回归：默认租户无兰琪内容；兰琪租户桌面1440/390px、刷新、标题、纯文字logo、可访问橙色主题PASS；第三租户隔离、WorkBuddy brandContext一致、伪造brand无reservation、console0、Provider0。静态合同、工作流、MCP数据库及全仓门禁均纳入BY-30验证。
- 状态：**已关闭**。范围内P0/P1=0；兰琪知识资料仍未获授权，继续为空不是缺陷。

## QA-20260827-010 v2.2 将无字瓶罐与木架长边组合疑似误判为 UI 布局（P1，检测精度子范围已关闭）

- 用户影响：最新受控三图终验的封面图完整PASS；第2张内容图技术成功并落盘后，被确定性质量门禁以 `interface_or_watermark_like/ui_layout` 拒绝，导致第3张不再提交、整批客户资产与下载为0。
- 脱敏证据：资产SHA `63f63a70…3fe9`、768×1024；detector=`ui_layout`、confidence=0.936、bbox=`(2,364,764,658)`，联合摘要为panel-like regions=6、vertical long edges=7、repeated bar regions=2、aligned-panel evidence=true。人工只读仅见米色无字瓶罐/木架静物，未识别出文字、品牌、Logo、二维码、水印、UI或人物；该观察只用于建立疑似误报P1，不能覆盖自动门禁。
- 安全处置：没有SHA白名单、阈值放宽或人工直放。第2张拒绝后立即停止，第3张未调用；整批quality_failed、owner/跨租户资产404、下载0，300测试积分全额释放、净0。实际2个图片Provider任务、保守¥0.40，其他Provider0。
- 漏测：v2.2离线13个安全负例与41个风险正例precision/recall=1.000，没有覆盖“多瓶罐 + 木架/窗框长边 + 重复矩形”同时形成panel和vertical-edge联合证据的真实安全构图；静态fixture通过不足以代表真实HTTP用户路径三图成功。
- 根因：v2.2 `panelGrid` 要求panels≥5、rowGroups≥3、columnGroups≥2，但长边只校验horizontal+vertical≥3。真实安全图horizontal=0、vertical=7，说明它只有单向自然长边却仍被当作二维界面；这与QR、文字Logo、corner-watermark和Provider无关。
- 最小修复：`beauty-image-safety-v2.3`只将panel-grid长边证据改为horizontal≥1且vertical≥1；repeated-bars及其他检测分支不变。无SHA/任务白名单，不用人工结论覆盖自动门禁。
- 扩展回归：新增真实产品UI截图与卡片、按钮、边框布局风险夹具，以及真实无字瓶罐木架、瓶罐货架、建筑线条安全对照。安全20/20 PASS、风险54/54 REJECT，precision/recall=`1.000/1.000`且连续3次一致；真实UI、水印、二维码、文字Logo召回未下降。
- 验证：图片precision/quality/generation-success/real-media零调用/持久化/URL/媒体观测/XHS、API/Web/Agent typecheck、`qa:fast/regression/full`（含build）和diff均PASS，Provider/网络0、费用¥0。无Web变化所以未重复E2E，当前受控环境未为本次API变更刷新。
- 状态：**检测精度子范围已关闭，P0/P1=0**。BY-26三张客户合格图真实业务验收仍P1=1；不追加Provider、不部署，BY-19/BY-20继续PAUSED。

## QA-20260827-009 v2.1 将无标签瓶罐静物疑似误判为角落水印与字形序列（P1，检测精度子范围已关闭）

- 真实现象：`beauty-image-provider-prompt-v1.1` 最新受控终验的内容图技术成功并落盘；人工只读未见可见文字、品牌、Logo、二维码、水印、UI或人物，但确定性门禁同时以 `interface_or_watermark_like`、`visible_text_or_brand_like` 拒绝，导致第3张不再提交、整批客户资产0。
- 脱敏证据：资产SHA `fa9e11f9…2846`、768×1024。`corner_watermark` 使用右下 `edge_components`，证据摘要为 widthCoverage `0.291`、8个glyph-like components、`readableSequenceRecovered=false`；`glyph_sequence` 使用下部 `edge_component_sequence`，glyphCount `4`、widthCoverage `0.312`、`readableSequenceRecovered=false`。不保存Prompt、Provider正文、凭据或客户数据。
- 安全处置：没有放宽或绕过检测器；第2张拒绝后立刻停止，第3张未调用。整批quality_failed、owner/跨租户资产404、下载0；300测试积分全额释放、净0，Provider实际2次/保守¥0.40，其他Provider0。
- 漏测与门禁：现有离线12个安全负例/40个风险正例precision/recall=1.000仍未覆盖该“多组无字泵瓶 + 木柜纹理/边缘”的真实组合。下一修复必须以来源明确资产和真实水印/文字/UI对照建立零Provider红灯，不能按SHA放行、降低全局阈值或用人工目视替代自动门禁。
- 伴随测试修复：真实Chrome流程业务断言已通过，但最终DB快照比较因查询无序发生记录顺序互换；按job id稳定排序后同一路径PASS，不改变产品运行逻辑。
- 根因证据：Champion新增可重复的`edgePixelDensity`与组件fill摘要；角落edge序列密度0.077、下部glyph序列密度0.042，证明自然轮廓/木纹/采样断边可跨宽bbox，却没有形成真实字符或水印应有的连续边缘墨迹。历史坏图对应glyph密度0.131，风险与安全样例存在可解释分界。
- 最小修复：`beauty-image-safety-v2.2`只在corner bright/edge sequence与glyph sequence增加同一`edgePixelDensity>=0.09`证据；QR finder、条码、UI布局、文字/Logo、真实水印与manual-review均不变。媒体路由改用唯一导出版本常量，避免新任务或解码失败记录误写v2.1。
- 回归：真实/合成安全13/13 PASS、风险41/41 REJECT，precision/recall=`1.000/1.000`且连续3次一致；指定真实安全图PASS，历史二维码样式/伪品牌图及人物+伪标签图继续REJECT。图片/持久化/URL/媒体观测/XHS专项、API/Web/Agent typecheck、`qa:fast/regression/full`（含build）和diff均PASS，Provider/网络0、费用¥0。
- 状态：**检测精度子范围已关闭，P0/P1=0**。没有Web变化所以未重复E2E；历史批次不按v2.2重判。BY-26三张客户合格图业务P1仍未关闭，本轮未创建grant、未追加Provider调用。

## QA-20260827-008 图片正向主体允许模型自行设计包装标签面（P1，离线合同子范围已关闭）

- 用户影响：真实第2张图片虽然收到通用“无文字/无品牌”约束，仍在瓶身生成伪品牌与乱码，正式质量门正确拒绝并导致三图完整交付失败。
- 修复前红灯：脱敏 Champion 只保留 SHA `2e2b8dec…c9ad2`、content角色和拒绝类型；新专项初次稳定得到 `providerPromptVersion=undefined`。代码证据显示“皮肤管理产品/护理用品”正向主体没有规定瓶罐包装面如何表达，只有末尾通用禁止项。Provider内部采样原因不可观测，因此未直接归因模型能力。
- 最小修复：新增 `beauty-image-provider-prompt-v1.1`。只在主体包含产品/护理用品/包装/瓶罐容器等语义时追加无标签中性容器、纯色哑光、完整空白表面、无印刷/贴纸/浮雕字/品牌识别区以及避免正对镜头标签面的正向约束；原负向词、构图角色、质量检测、账本、租户和页面均不变。图片提示版本独立持久化，文字Skill版本继续保留。
- 回归：Champion/Challenger同批合同、非包装边界、客户不暴露内部提示/模型/Provider/成本通过；安全12/12、风险40/40，precision/recall=`1.000/1.000`。图片/XHS/持久化/媒体观测、API/Web/Agent typecheck、`qa:fast`、`qa:regression`、`qa:full`及diff通过，Provider/网络0、费用¥0。
- 状态：提示合同子范围已关闭；真实一次生成成功率仍需未来受控真实终验才能验证，BY-26业务P1保持打开，不以离线断言冒充三图成功。

## QA-20260827-007 真实图片预算未由运行时硬门禁约束且浏览器终验写死首张失败（P1）

- 用户影响：一次性grant虽记录¥0.60，但API quote/confirm原先没有独立的人民币运行时硬上限；浏览器恢复专项又只接受“第1张拒绝/Provider任务1个”，无法覆盖“第1张通过、第2张拒绝”的合法顺序失败，也可能以无美业权限租户得到403而误报资产隔离。
- 修复前红灯：`pnpm.cmd beauty-industry:real-media-smoke`稳定报“approved Provider estimate must be rounded to currency precision before budget comparison”；最新真实批次后浏览器专项先报`2 !== 1`，再因任意对照租户缺美业权限报`403 !== 404`。
- 根因：费用只存在于grant/runner审计，没有进入API运行时配置与Provider前readiness；浏览器脚本把一次历史首图失败写成固定产品语义，并在只读模式复用任意租户而没有保证产品entitlement。
- 修复：新增`BEAUTY_MEDIA_MAX_PROVIDER_COST_YUAN`，real模式必须为正；按人民币分精度估算并在积分预留/Provider前失败关闭。浏览器专项从受控环境读取期望Provider任务数（1–3），并创建独立全合成美业授权租户验证跨租户资产404；不改变产品质量/租户/账本门禁。
- 真实关闭证据：最新批次第1张PASS、第2张真实伪品牌/可见文字正确拒绝、第3张未调用；browser E2E报告provider_tasks=2、desktop/mobile/refresh/owner404/cross-tenant404/ledger/console/external均PASS。postflight确认2任务、2技术成功、1拒绝、1未提交、客户资产0、300积分净0、审计资产SHA不变。
- 验证：`beauty-industry:real-media-smoke`、`image-quality-live-postflight`、`image-quality-browser-e2e`、图片/XHS/持久化/URL专项、API/Web/Agent typecheck、`qa:fast`、`qa:regression`、`qa:full`、build、`git diff --check`。本缺陷关闭；BY-26三图完整交付业务P1因真实第2张不合格继续打开。

## QA-20260827-006 小红书同页图片交付暴露内部制作信息且缺少版本化文字关联（P1）

- 现象：小红书图文页虽已有 quote/confirm/jobs/assets/download，但主结果直接展开并可复制 `productionNotes`，报价区显示模型且报价 DTO 暴露 Provider/模型/人民币估算；图片批次只以 `previewId`/role关联文字，用户无法核验三图分别承接哪一部分文字成品。
- 修复前红灯：`beauty-industry:xhs-same-page-image-p1-smoke` 初次稳定失败 `buildBeautyImageDeliveryPlan is not a function`，并锁定页面会泄漏制作提示词、模型与费用核对字段。既有 Provider、路由、Skill 和媒体持久化并非根因。
- 根因：服务端只有内部三套正负提示词，没有独立的客户安全图片计划 DTO；页面复用了内部制作说明作为客户区；媒体 job 未保存文字标题hash与计划版本，报价响应也没有区分内部成本预检和客户积分确认。
- 最小修复：新增 `beauty-xhs-image-plan-v1`，从同一正式 XHS 运行派生默认标题、封面/内容/互动角色、3:4构图与中文后期叠字边界；Provider payload在服务端补齐纯画面、无人物/品牌/特定门店/文字/二维码/水印/UI/价格/疗效/案例约束。页面移除制作说明复制，报价 DTO移除 Provider/模型/人民币字段，job保存plan版本/标题hash/文字Skill版本。未改固定Skill链、账本、租户或三图完整交付门禁。
- 回归：XHS同页/客户交付/事实保留、媒体质量/precision/持久化/URL、WorkBuddy数据库隔离、API/Web/Agent typecheck、`qa:fast/regression/full`（含build）及真实Chrome桌面/390px全绿；候选引用0、console0、external Provider0、费用¥0。状态：**已关闭**，本QA范围P0/P1=0。

## QA-20260827-005 百炼图片技术成功但返回资产URL被严格出站白名单拒绝（P1）

- 根因关闭（2026-08-27）：仓库默认已登记官方 `oss-accelerate.aliyuncs.com`，但 `apps/api/.env` 的显式 allowlist 覆盖默认且漏域；持久化专项又用空validator替代真实策略，导致该漂移直到付费task成功后才暴露。没有根据未持久化URL猜域名，采用仓库既有百炼真实回归与版本化官方结果域证据。
- 修复前红灯：新增URL策略专项在模块缺失时稳定 `MODULE_NOT_FOUND`；运行配置夹具证明漏 `oss-accelerate.aliyuncs.com` 时real模式必须在Provider前失败。旧持久化夹具另证明默认fetch会隐式跟随跳转。
- 最小修复：新增 `beauty-provider-asset-url-v1`，仅接受HTTPS、无凭据、443且属于官方accelerate/北京OSS的精确域或子域；同时必须存在于runtime allowlist。下载改为最多2次、每跳重新验证，站外/伪后缀/IP/HTTP/异常端口失败关闭；real启动缺官方域直接报配置问题。本轮受控启动只在进程内补官方域，不修改或输出密钥。
- 真实关闭证据：修复后新grant的第1、2个Provider任务均技术成功且成功落盘，证明QA-20260827-005已关闭；第2张随后因真实视觉不合格被独立质量门拒绝，第三张未提交。该视觉失败不回退URL修复，也不允许追加调用。
- 回归：URL安全接受2/拒绝7、持久化失败夹具13、real-media、图片质量/precision、媒体观测、API/Web/Agent typecheck、`qa:fast/regression/full`（含build）PASS。状态：**已关闭**，本QA范围P0/P1=0；BY-26三张客户合格图仍为业务P1=1。

- 现象：BY-26 v2.1最终真实三图终验中，受控密钥预检与Provider提交成功，唯一`wan2.7-image` task到达`SUCCEEDED`；随后客户资产为0，整批失败，后两图未提交。
- 精确证据：数据库只保存脱敏安全码`beauty_media_asset_url_rejected`、stage=`url_validation`、retryable=`false`和Provider task哈希前12位`6bda15955b20`；没有保存完整URL、查询参数、Prompt、Provider原始响应或密钥。因此能确认“成功URL未通过当前严格allowlist/IP/协议验证”，不能无证据猜具体域名或重查已终止task。
- 安全结果：SSRF/出站门禁正确fail-closed；首图未下载/落盘，后两图Provider0，无第4张/重试/换模/补图。图片300测试积分一次预留一次全额释放、净0；保守Provider成本¥0.20，其他Provider0。
- 漏测原因：BY-27零网络夹具覆盖了允许URL和各持久化阶段，却没有一份来源明确、可版本化的百炼真实成功URL域名类别夹具；此前真实成功资产所用host没有被沉淀为脱敏适配契约。凭据位置修正只能恢复调用，不能修正资产URL安全适配。
- 下一红灯：在不访问外网、不查询旧task的前提下，为百炼输出增加仅保存`final-domain分类/allowlist规则版本/重定向分类`的脱敏观测，并用官方或已授权结构契约夹具验证协议、精确host、DNS/IP重绑定、白名单内有限跳转和站外拒绝。未知host继续拒绝，禁止通配域、关闭SSRF校验或记录完整URL。
- 回归：图片质量、precision/recall、11阶段持久化、real-media、media-observability、workspace API/Web/Agent typecheck、`qa:fast/regression/full`（含build）和diff均PASS；调用后Provider/外网0。
- 状态：**打开（P1）**。BY-26三张客户合格图未达成；本次grant已消费并删除、媒体进程已停止。未经新的精确授权不得追加真实调用。

## QA-20260827-004 真实三图runner缺少逐图人工可用性前置（P1）

- 现象：既有三图链只把本地确定性安全PASS作为下一Provider任务的前置；自动PASS后会立即提交下一张，无法满足“人工确认客户可用后才继续付费”的受控真实终验边界。
- 修复前红灯：`beauty-industry:real-media-smoke` 稳定命中缺少 `BEAUTY_MEDIA_ACCEPTANCE_OPERATOR_GATE`。这不是检测器召回放宽，也不是生产媒体默认行为变更。
- 根因：顺序状态机只有 `customerUsable=技术成功+持久化+自动安全PASS`，没有隔离验收专用的持久operator decision；第三张自动PASS还可能在人工查看前完成结算。
- 修复：增加默认`false`的隔离验收operator gate、租户鉴权且仅gate开启时存在的逐图review入口、持久`operatorQualityStatus`和交付终态；人工拒绝沿用质量失败、整批不可下载和幂等积分释放，人工批准后才提交下一张或完成结算。live runner逐图输出本地审计资产路径并等待approve/reject，不自动代替人工判断。
- 验证：real-media、图片质量/持久化/媒体观测、API typecheck、qa:fast/regression/full（含build）PASS。实际Provider终验因受控百炼密钥缺失在调用前停止，故本QA代码缺陷关闭；BY-26三张真实客户合格图业务P1仍打开。
- 安全：Provider0、费用¥0；临时approval/grant删除，不从日志或WorkBuddy恢复密钥，不部署。

## QA-20260827-003 角落自然纹理被两个弱证据串联误报为水印（P1）

- 现象：BY-27 后真实受控图 SHA `5181dade…653a` 人工只读目视无文字、二维码、品牌或水印，但 v2 在右下 bbox `(416,966,304,14)` 以 `corner_watermark/interface_or_watermark_like` 拒绝，阻断后三图流程。安全 fail-closed 正确，但客户完整交付被误报阻塞。
- 根因：`edge_components` 只要求组件数量、近似基线和跨区宽度，没有要求组件本身覆盖该宽度；5个叶片/枝条边缘的实际宽度覆盖率仅0.072仍被接受。收紧后，同一区域又落入 `corner_bright_ink_layout`，其密度0.043、每活跃行约4.5像素的稀疏自然高光仍满足旧兜底，形成两个弱证据串联。
- 修复前红灯：precision P1 smoke 对固定 SHA、尺寸和原因稳定 FAIL；同时加入二维码、条码、真实水印样式、亮色水印、界面角标/UI及自然纹理对照，禁止以单图白名单或全局降阈值修复。
- 修复：`beauty-image-safety-v2.1` 对角落组件要求宽度覆盖≥0.22、间距变化≤1.6、高度变化≤0.55且多数为字形比例；亮点兜底要求密度≥0.06、每活跃行≥8像素、活跃列覆盖≥0.36。证据指标持久化可解释，历史 v2 结果不重判。
- 回归：安全负例12/12 PASS、风险正例40/40 REJECT、precision/recall=1.000/1.000，专项连续3次一致；历史三张风险资产3/3拒绝，不确定夹具继续manual review。图片质量/持久化/real-media/media-observability、美业专项、API/Web/Agent typecheck、qa:fast/regression/full+build、diff和桌面/390px只读恢复全绿，Provider/外网0、费用¥0。
- 状态：**已关闭**。本缺陷范围P0/P1=0；三张真实客户合格图仍是独立、未恢复的付费业务终验，不因本修复自动放行。

## QA-20260827-002 直播复盘 Web/WorkBuddy 验收默认指向已停止旧 API（P1）

- 现象：当前正式受控环境为 API 3016 且 `source_fresh=true`，但 `pnpm.cmd beauty-industry:live-review-browser-e2e` 与 WorkBuddy 专项默认访问旧 3017。浏览器命令连续3次在创建合成租户前 `fetch failed`，WorkBuddy专项稳定 `ECONNREFUSED 127.0.0.1:3017`，导致已开放直播复盘无法由默认验收命令可靠复核。
- 根因：BY-16历史隔离环境端口被硬编码在两个验收 runner 中，后续正式验收环境统一回到3016时未同步；产品 `live_review_workflow_v1`、固定 Skill链和页面没有失败。显式设置3016后同一浏览器路径连续3次完整PASS。
- 修复前红灯：扩展 `beauty-industry-live-review-workbench-p1-smoke.mjs` 锁定默认3016及禁止3017，修复前稳定失败于 `live review browser E2E must default to the controlled acceptance API`；真实浏览器和WorkBuddy默认命令也分别稳定失败。
- 修复：Web与WorkBuddy runner默认目标统一为3016，仍允许显式本机验收端点；在任何租户、浏览器或业务写入前检查 `/ready ok=true/database=true`。不可用端点返回脱敏 `endpoint/stage` 并停止，不把连接问题误报为 workflow 或页面失败。
- 回归：默认浏览器E2E连续3次覆盖桌面/390px、数据文件、八模块、刷新/返回、跨租户、console0、external0；WorkBuddy覆盖共享Schema、权限、租户、幂等、单次账本、缺失与伪造身份失败关闭。错误端口在租户/浏览器/Provider前停止。API/Web/Agent typecheck、qa:fast/regression/full（含build）与diff均PASS。
- 状态：**已关闭**。Provider/外网0、费用¥0、未部署；BY-19/BY-20与BY-26付费三图均未恢复。

## QA-20260827-001 图片 Provider 成功后的本地资产失败被压平且允许重查（P1）

- 现象：BY-26 v2 检测器真实终验中，唯一 `wan2.7-image` 子任务已返回 `SUCCEEDED`，但任务只留下 `asset_persistence_failed`；无法区分 URL 安全校验、下载、HTTP、类型/大小、本地写入、元数据提交、落盘校验或质量筛查，并被 API 标为 `canRecover`。旧运行没有保存 URL/原始响应，具体子因保持未知。
- 根因：`persistBeautyProviderImage()` 以普通字符串异常覆盖多个子阶段；媒体路由用单一 `catch` 再次压平，并将该终态列入恢复轮询。技术终态、资产阶段与客户终态没有完整分层。
- 修复前红灯：`pnpm.cmd beauty-industry:image-persistence-observability-p1-smoke` 稳定 FAIL，命中“缺少显式阶段合同”；源码同时证明 `recoverableAssetFailure` 会让历史终态再次进入 Provider 查询路径。
- 修复：新增 14 阶段持久化合同与稳定安全码；图片和元数据先写独立临时文件，再分别原子提交，失败做受控清理。任务只保存 `assetPersistenceStage/code/retryable/httpStatus`，不保存 URL、查询参数、正文、Prompt、原始响应、密钥或绝对路径。Provider 成功后的本地失败改为不可重查、不可自动重试；历史合并码只显示 `legacy_unknown`，不事后改写。
- 回归：11 个零网络失败夹具和双文件原子成功夹具 PASS；真实 API+隔离数据库+Chrome 桌面/390px/刷新 PASS，旧失败批次客户资产/下载0、owner/cross-tenant404、Provider重查0、账本变化0、console/external request0。美业合同矩阵、API/Web/Agent typecheck、`qa:fast`、`qa:regression`、`qa:full`（含 build）和 `git diff --check` PASS。
- 状态：**已关闭**。本修复 Provider/外网0、费用¥0、媒体保持disabled/max0；不代表三张真实客户合格图已经完成，BY-26业务验收仍须另行精确授权。

## QA-20260826-006 视频数据复盘与销售在新鲜 runtime 仍被正式合同拒绝（P1）

- 现象：`source/runtime=DDA04BBF…` 且 `source_fresh=true` 的本机环境中，视频表已解析成功但复盘命中 `rubric_fact_retention_weak`；销售短句“客户犹豫不下单 怎么办”命中 `missing_contract_terms_话术`。两次均只预留一次并等额释放，AgentRun 0，Provider 0。
- 根因：第一层是视频确定性报告把长标题安全截为 52 字，事实 Eval 却比较完整原标题；第二层是用户同一 CSV 中的合法作品证据包含跨行业词，通用污染检查没有区分“当前事实源逐字证据”和“模板污染”，修完摘要后仍错误拒绝。销售 capability 专属 fixture 的栏目名缺“话术”，并且快速问法被包装成完整个性化方案，专业模式缺少预留前必要字段合同。
- 修复前红灯：三行长标题合成 CSV、用户同一文件安全哈希 `c87b4306…d1f` 与脱敏销售短输入分别走真实页面/HTTP/数据库，稳定复现 `rubric_fact_retention_weak`、`foreign_industry_or_internal` 与销售结构问题；失败均为一笔 consume + 一笔等额 refund、无伪成功历史。
- 修复：报告与 Eval 共用标题摘要并锁定核心指标；仅 `video_table_review_direct` 允许当前 `taskFactSource` 逐字支撑的行业词，内部标记、Provider 输出和其他 capability 仍严格阻断。销售引入 `beauty-sales-two-stage-v1`，快速结果只给通用可发送回复与补充方向，专业结果缺五类必要资料时在 reservation 前精确 422，补齐后才生成完整策略。
- 防漏测：新增真实 HTTP+隔离 PostgreSQL+Chrome 矩阵，不再只测内部函数或另一份合成 CSV；锁定上传→receipt→新requestId→API→DB→DOM、历史0→1、刷新、双击、双租户、桌面/390px、console和外部请求。WorkBuddy 与 Web 共用 sales structured delivery 和同一 preflight。
- 状态：**已关闭**。同一用户文件哈希和销售快速/专业三路径均 PASS；相关专项、Web/WorkBuddy、API/Web/Agent typecheck、qa:fast/regression/full（含 build）、真实 Chrome 与 diff PASS，文本/媒体 Provider 0、功能费用¥0、BY-25 两项功能残余 P0/P1=0。

## QA-20260826-007 三图 Provider 技术成功但客户视觉含二维码样式与伪品牌文字（P1）

- 2026-08-27 BY-27 后最终真实终验：在用户本次¥1硬上限内，runner仍采用更严格的3张/¥0.60边界。只创建1个`wan2.7-image`任务并技术成功、完成原子落盘；首图SHA `5181dade…653a`、768×1024，被v2在右下bbox `(416,966,304,14)` 以`corner_watermark/interface_or_watermark_like`、confidence0.96拒绝，后两图未提交，无第2/3/4次调用。
- 新真实回归：人工只读目视为无明显文字、二维码或品牌的护肤品静物，说明当前角落 glyph/watermark 规则仍可能把自然纹理误判为水印；人工不能代替自动门禁，所以批次继续fail-closed、客户资产/下载0。300测试积分一次预留一次全额释放、净0；Provider保守费用¥0.20，授权耗尽。
- 防回退证据：真实Web桌面/390px、刷新/历史、重复确认、双租户404、console0，postflight两次资产与账本不变；持久化阶段、precision/recall旧夹具、real-media、API/Web/Agent typecheck、qa:fast/regression/full+build与diff PASS。授权文件/grant删除，media恢复disabled/max0。
- 当前状态：**P1继续打开**。安全与费用门禁正确，但三张客户合格图未达成；下一修复必须先把该新SHA转成脱敏角落水印误报红灯，不能调低全局阈值或再次调用Provider。

- 2026-08-27误报精度原子修复：修复后真实终验首图 SHA `f408e29e…f24e` 经人工目视无字，却被旧检测器三类同时命中。根因是 QR/文字/UI 共用宽泛的局部对比度与 transition density，缺少 finder、条纹、字形和布局证据；自动 smoke 只覆盖极简纯色图，漏掉真实瓶罐、空白标签、托盘边缘和自然高光。
- 修复：升级 `beauty-image-safety-v2`，分别要求 QR `1:1:3:1:1` 三 finder 几何、条码平行条纹+quiet zone、字形序列基线/间距、角落水印或多行多列UI联合证据；每项写入置信度、bbox与有限指标。无法可靠区分时为 `manual_review_required` 且客户仍不可见，不再把三个无证据风险叠加成确定违规。
- 零费用回归：真实安全图PASS、三张历史风险图3/3 REJECT；9个安全变体误报0、32个风险变体漏报0，precision/recall=`1.000/1.000`；不确定夹具进入manual review。全仓门禁PASS、Provider/网络0、费用¥0。误报精度子问题关闭；真实三图完整交付仍需新授权，QA业务状态继续P1。

- 2026-08-27修复后真实终验：新grant只产生1个 `wan2.7-image` Provider任务；首图技术成功并落盘后被本地风险筛查拒绝，后两图未调用。客户资产/下载0、owner/cross-tenant404、300测试积分净0、保守Provider成本¥0.20，证明“不合格技术成功资产不能交付”和“首败立即停止”已真实生效。
- 新证据：首图SHA `f408e29e…f24e`，尺寸768×1024，风险码同时命中QR/条码样式、文字/品牌样式、界面/水印样式；人工目视为无可见文字的合成瓶罐静物。确定性筛查只允许做风险筛查，按授权边界仍须fail-closed；但其对瓶罐/空白标签过度敏感，导致完整三图交付为0。
- 防漏测补强：三占位任务持久化`batchIndex`并按序读取，下一Provider提交必须以前一图`customerUsable`为真；customer asset还必须要求整批`succeeded`。live runner改为从DB审计Provider task计数，避免依赖对客户隐藏的providerTaskId字段；postflight与Chrome锁定Provider1/技术成功1/拒绝1/未提交2/下载0/账本不变。
- 状态更新：安全泄漏根因已关闭，但客户三图交付真实门未通过，QA/BY-26业务P1继续打开（P0=0）。本次授权已耗尽，媒体恢复disabled；下一步先做零费用检测精度红灯，不得放宽合同或追加真实调用。
- v2 检测器授权后真实终验（2026-08-27）：新grant严格只产生1个`wan2.7-image`任务；Provider=`SUCCEEDED`，但本地落盘链返回`asset_persistence_failed`，未生成可供质量筛查或客户访问的资产，后两图未提交。当前catch把URL安全校验、下载、Content-Type/大小和文件写入合并为单一错误，日志没有保存可区分子阶段的脱敏码；因此只能确认“Provider生成成功后资产持久化失败”，更细根因保持未知，禁止猜测或重新查询已终止任务。
- 安全与账本：整批`quality_failed`、客户资产0；300积分consume/refund各一次、净0；图片Provider按1个成功任务保守记¥0.20，其他Provider0；无重试/补图/换模/追加。临时授权已删除且media恢复disabled/max0。QA继续P1，下一修复必须先用零Provider夹具建立下载安全校验/HTTP/类型/大小/写盘分段可观测红灯。

- 现象：用户授权内 `aliyun_bailian/wan2.7-image` 3 个顺序任务均成功并落入当前合成测试租户，但逐图视觉验收发现第二张含二维码样式和伪品牌文字，不满足“无品牌、无账号、客户可直接使用”的边界。
- 技术证据：3/3 均为 768×1024，未创建第4个任务，重试/修复/换模/追加均0；300积分一次预留并结算300、释放0，保守费用¥0.60。安全资产哈希已记录在 BY-25 任务卡，Provider原始响应、Prompt和密钥未持久化。
- 根因：现有媒体合同只验证 Provider 任务、尺寸、租户、账本与落盘，并以 `status=succeeded + assetStatus=persisted` 直接开放客户资产；制作说明的负向词没有增加统一纯画面/无文字/二维码/水印约束，Provider payload 默认还开启水印。技术成功与客户可用被错误合并。
- 修复前红灯：新增离线专项先稳定命中缺少 `assessBeautyImageSafety` 和路由缺少 `visual_quality_rejected`；同一三资产检查证明指定风险图及另外两图均须失败关闭，合成纯画面与QR fixture用于锁定不过宽/不漏放边界。
- 修复：Provider payload 固定纯画面正向约束、完整负向禁词和 `watermark=false`；原始资产落盘后逐图做确定性PNG风险筛查，只有 passed 才生成客户URL。拒绝图保留技术成功/原始文件审计事实，客户资产与下载404；三图不足三张合格则整批 `quality_failed`，不重试/补图/换模。页面分离技术状态、客户质量与折叠审核。
- 账本：已 settled 的三图批次通过 Serializable 幂等 compensation 事务净退300测试积分，只新增一条 refund，不改旧 consume、不声称Provider退款；重复审计/恢复不再变更余额或创建任务。
- 回归：三资产SHA不变、customerUsable=0、owner/cross-tenant404；真实API+DB+Chrome桌面/390px/刷新/历史/console=0/external0；媒体/账本/幂等/资产、API/Web/Agent typecheck、`qa:fast/regression/full`（含build）与diff全部PASS。本修复Provider0、费用¥0，媒体继续disabled。
- 状态：**已关闭**，QA范围残余P0/P1=0；任何下一次真实三图终验仍需新的精确授权。

## QA-20260826-005 美业固定路由后的受控输出矩阵与正式合同不一致（P1）

- 现象：本机 controlled mock 中，小红书/选题虽然能显示结果，但把流程回执、待补和 mock 术语混入用户成品；内容系统与视频数据复盘在保存前被正式结构/事实门禁拒绝并释放积分。用户随后逐页遇到相同问题，证明不是单页故障。正式 `status.ps1` 另证明用户所测 runtime 指纹 `56957C79` 落后于源码 `8F36BA23`，`source_fresh=false`；旧 runtime 放大了误导，但不替代源码根因。
- 根因：`BEAUTY_WORKFLOWS` 的固定 route/capability/scope/Skill 映射本身完整；映射后的 `buildMockReply()` 只有部分 capability 专属 fixture，内容、数据复盘和直播等输出不满足各自正式 Schema/Eval，未命中时还存在旧通用九件套 fallback。页面又没有稳定分离客户成品、制作说明与质量审核，系统合同错误统一提示用户重试。
- 修复前红灯：分别以 XHS、2/4 来源选题、内容十件套、视频数据复盘、视频内容复盘、直播复盘及销售的最小脱敏输入走固定链，锁定事实污染、结构缺失、错误归因和未知 capability 可接触旧 fallback；账本断言失败只允许一次预留/一次释放且无伪成功历史。
- 最小修复：八个 capability 各有独立、单次通过正式合同的 controlled fixture；未知固定美业 capability 在积分/保存前 fail-closed，不能进入旧通用模板。XHS、选题、内容系统把用户成品、门店制作/策略说明、默认折叠审核分层；预览不再称“可直接发布/正式生成”，复制内容拒绝 mock、回执、待补、Markdown 管道及内部术语。系统输出失败提示“积分已退回，无需重复点击”，不误报为用户资料不足。
- 连带根因：固定美业输出还会被通用 Agent 澄清、共享内容 normalizer 和确定性 fallback 二次改写；XHS 历史接口未重建三层结构；页面外部 Google Font 造成离线控制台错误。现已让固定美业结果单次交由产品 output contract 校验、历史按持久化输出重建 structuredDelivery，并移除外部字体依赖。
- 自动回归：八 workflow controlled routing、XHS/选题/内容/视频数据/视频内容/直播专项、fixed route、Web/WorkBuddy、账本/幂等、租户/权限、API/Web/Agent typecheck、qa:fast/regression/full（含build）、治理门禁和diff均PASS；未知 capability 门禁和 WorkBuddy candidates 0 引用已纳入 BY-24。
- 状态：**已关闭**。正式 AcceptanceRoot 安全刷新后 source/runtime=`DDA04BBF…`、`source_fresh=true`；真实 Chrome 桌面/390px 全矩阵、保存/刷新/历史/返回/重复点击/跨租户均 PASS，console=0、外部 Provider 请求=0、费用¥0。

## QA-20260826-004 美业日报整页 parser 误把导航 AI 词和页脚日期当文章事实（P1）

- 现象：旧 parser 对完整 HTML 清理文本并从任意位置取首个日期；脱敏离线页即使正文只是普通会议通知，只要导航含 AI 词、页脚含当天日期，也会被接纳为实时 AI 文章。真实终验详情失败又统一折叠为 `article_contract_rejected`，无法区分缺日期、缺正文、非 AI、过期或合规拒绝。
- 根因：列表、文章元数据、正文和站点模板没有结构隔离；meta 属性顺序、JSON-LD、`time datetime`、语义正文、链接前方日期和 canonical 没有确定性共享合同，也没有六域显式 adapter/阶段计数。
- 修复前红灯：`scripts/beauty-industry-daily-brief-parser-p1-smoke.ts` 首跑在“导航 AI 词与页脚日期不得冒充文章”稳定 FAIL，并显示错误候选指纹；随后锁定缺日期仍只得到通用拒绝、链接前日期漏失。
- 修复：六域各自注册授权入口/来源分类；共享 parser 仅承担 RSS/Atom/JSON-LD/meta/time 和语义 article/itemprop/main/body，剔除导航/页眉/页脚/侧栏/表单；同域 canonical、相对 URL 与最近日期安全归一化。按域记录列表状态、日期/正文/AI事实成功/失败及精确 rejection；缺日期不默认为当天、列表摘要不作正文、CAICT 412不绕过。
- 回归：六域正常/空/变体/缺日期/缺正文/站内302/412/404、历史0/2候选分布、live/人工grant、日报/DB、API/Web/Agent typecheck、`qa:regression`、build PASS，外部网络/Provider=0、费用¥0。`quality:assets` 的四份兰琪样例格式阻断属独立未提交资产，本修复未修改。
- 状态：**代码根因已关闭**；QA-20260826-003/BY-20 业务准入仍打开。旧真实日志没有日期/正文/AI分项，不能凭本修复宣称六域供给已达15；最终只允许再执行一次获授权终验。

## QA-20260826-003 美业日报规划页与静态回退无法保证实时来源和唯一调度（P1）

- 现象：美业日报只有规划页；既有通用日报在来源/模型失败时用静态库凑满 15 条，Web 失败后再生成离线日报和合成历史。该路径没有美业 entitlement、公开来源事实门禁、北京时间 09:00、持久日快照、多实例唯一执行或一次结算语义。
- 修复前红灯：`beauty-industry:daily-brief-p1-smoke` 首跑稳定命中 `美业日报仍使用旧规划名称`；源码审计保存通用 fallback/假历史证据，不把其当成美业实时能力。
- 根因：通用日报是早期内存缓存与可用性 fallback，没有产品级公开资讯合同；导航规划页也没有后端状态。直接复用会把无来源内容包装成实时新闻，并在多实例/重启时重复生成或扣费。
- 最小修复：新增独立 `beauty_daily_brief@1.0.0` 合同、持久快照、AutomationTask 唯一键/租约、09:00/补跑、24h→72h 来源门禁、严格 15/5/3 结构、状态/历史页面和 Web/WorkBuddy 共用服务；不改通用日报。controlled mock 只用全合成 URL 并显著标为测试，live/自动任务/导航/工具/请求/模型/费用默认 fail-closed。
- 回归：08:59/09:00/09:01、UTC/跨月年、5 并发单任务、2 worker 单 claim、租约中断/终态不明、来源不足/404/过期/重复/跨行业/医疗污染、双租户、桌面/390px/刷新/历史/console 0、API/Web/Agent typecheck、`qa:fast`、`qa:regression`、`qa:full`（含 build）与 diff PASS。外部来源/Provider=0，费用 ¥0。
- 放行状态：**零费用根因已关闭，正式业务仍 fail-closed**。2026-08-26 首次终验和获批的同日一次性人工终验都未形成 15 条严格来源，DeepSeek 均为 0；09:00 自动启用与生产部署未执行。BY-20 残余 P0=0、P1=1，不得用合成结果正式开放。
- 后续真实根因与红灯：公平配额复验读取到 21 个真实 AI 详情，但旧 parser 仍要求正文同时命中 `AI_TERMS + BEAUTY_TERMS`，导致全部 `article_contract_rejected`。离线红灯用不含美业词的通用 AI 模型新闻稳定返回 `undefined`；同一新闻仅添加美业词才通过，证明产品把“新闻事实”和“美业解释”错误合并。
- 最小修复：来源层只要求真实 AI 事件、六域 URL、日期、24h→72h、核心事实、去重、来源状态与合规；新增 `sourceFacts/sourceIndustry/directBeautyEvidence`。模型输出另设 `beauty_interpretation` 推断层，固定可能影响、思潼点评、适用条件、建议验证；通用 AI 的美业事实、未标记推断、无来源数字与跨行业冒充均失败关闭。RSS item、Atom entry 与通用链接只在同一六域/36 HTTP预算内解析，不扩源。
- 零网络回归：21/21 通用 AI 合成详情进入来源池，非 AI、虚构美业事实、未标记推断、事实无证据和跨行业冒充全部拒绝；日报/live/DB、fixed route、WorkBuddy共享路径、类型检查、`qa:regression`、独立 build PASS，外网/Provider/费用均为 0。`qa:fast/full` 仍被独立兰琪总部的四份既有样例格式阻断，未跨产品修改。
- 第三次真实终验：新的一次性grant在数据库核对既有同日65次HTTP/模型0后才消费；新增HTTP29、同日累计94/101。两层合同下72h仍仅2条合格AI来源且均来自雷峰网，未达到15条、至少4域和监管/研究/媒体组合，因此模型前停止。`deepseek-v4-pro` 0、费用¥0、AgentRun/账本0；QA-20260826-003继续P1，不发布、不部署、不启用09:00。
- 最后一次真实终验：parser修复后的一次性 grant `by20-manual-20260826-28a0f3febeb14695` 在既有94次基础上新增29次HTTP，同日累计123/130；72h仍仅1条合格。具体拒绝已拆为CAC网络失败、MIIT标题缺失、CAICT 412、雷峰网日期/时效/AI事实拒绝、钛媒体日期无效；DeepSeek/AgentRun/积分/费用均0。按用户硬停止条件，BY-20现为PAUSED，绝不第五次；QA保持打开，日报scheduler/导航/WorkBuddy工具/生产保持fail-closed。

## QA-20260826-001 美业选题 2/4 来源被内部污染并统一误报补来源（P1）

- 现象：用户在 controlled mock 有 2/4 来源时，固定选题链约 63ms 命中 `foreign_industry_or_internal`，页面却提示补来源；Provider 0、AgentRun 未保存、积分释放。
- 修复前红灯：指纹 `4e78048f026175e8` 的路由/Skill 链正确；新增专项首跑证明缺少 pollution 错误分类。合成 identity `验收A店` 的 raw 输出污染类别为 0，产品后处理后命中 `acceptance_tenant_marker`；数据库链又证明共享确定性模板把 2/4 改成 0/4。证据只保留来源阶段和安全类别，不保留用户内容、Prompt 或完整输出。
- 根因：结构化测试 identity 被拼入交付；controlled mock 未按正式来源合同生成；共享 Agent 模板不了解产品 payload；API 把所有输出失败映射到补来源。390px 结果下拉另缺宽度约束，页面被撑到 623px。
- 最小修复：内部/历史/合成 identity 中和但真实业务字段不变；controlled mock 生成正式 10 行 TOP10 并忠实标 2/4/4/4；版本化美业选题禁止共享模板覆盖；新增精确安全错误 taxonomy；结果 selector 增加移动端宽度边界。未删除污染/结构/事实门禁，未硬编码假 TOP10 覆盖真实 Provider。
- 回归：正常 2/4、4/4、零来源 preflight、污染、结构缺失、Provider/取消/超时、Web/WorkBuddy、租户/权限、账本/幂等、刷新/历史、桌面/390px与控制台 PASS；`qa:fast`、`qa:regression`、`qa:full`（含 build）及 diff PASS。真实 Provider/媒体 0、费用 ¥0。
- 放行状态：**已关闭**。BY-18/P1-B 范围 P0/P1=0，未部署生产；P1-C 与日报未启动。

## QA-20260825-009 美业小红书真实模型结果未保留脱敏任务事实（P1）

- 现象：P1-A controlled mock 与正式结构合同均已通过，但获批的唯一一次真实小红书调用没有形成可保存结果；WorkBuddy 返回失败，Web 历史没有该运行。
- 真实红灯：固定脱敏请求指纹 `2132b435a0a829a1`、空经营档案合成租户、`wechat-xhs-content-line@1.0.0 + beauty-industry-xhs@1.1.0 + beauty-industry-compliance@1.0.0`。`deepseek-v4-pro` 明确 `stop`，tokens `3525/1032/0/4557`、reasoning=0、24.389 秒，但正式质量门禁命中 `rubric_fact_retention_weak`。日志只保留脱敏指纹、usage、阶段和规则，没有保存 Prompt、Provider 原始响应或模型正文。
- 安全结果：授权范围内 Provider 只有 1 次，自动重试、修复调用、换模、追加与媒体调用均为 0；估算 ¥0.019450≤¥0.13。合同未放宽、无模板兜底、AgentRun=0；reservation `released/actualAmount=0`，8 积分预留 consume 与同额 refund 成对，净积分 0；临时凭据和 entitlement 已撤销。
- 回归：新增 `beauty-industry-by17-xhs-live-acceptance.mjs` 锁定模型、预算、一次调用、空档案、正式合同和脱敏日志；`beauty-industry-by17-xhs-live-postflight.mjs` 锁定失败不保存及账本释放。调用后的 XHS 合同、预算、fixed-route、Web contract、`qa:fast`、`qa:regression` 全部零 Provider PASS。
- 零费用根因红灯：`beauty-industry:xhs-fact-retention-p1-smoke` 首跑稳定证明：Web/WorkBuddy 与输入归一化完整保留“夏季、基础补水护理、附近女性顾客、小红书图文交付”，但正式 prompt 只有自然语言任务、Schema 无事实回执，产品合同会接受结构完整但事实为空/矛盾的输出；通用 `answer.includes` rubric 又会误拒合理同义表达。没有 Provider 正文证据可证明三套视觉结构挤压或模型能力不足，因此该子根因保持未知。
- 最小修复：主 Skill 升级 `wechat-xhs-content-line@1.0.1`；服务端注入通用任务事实清单，正式结构新增逐项事实回执，标题/正文/标签/相关配图共享同一事实约束；Agent rubric 与产品 postflight 区分漏项和矛盾，并对季节、地域、人群及不改变项目核心的合理同义表达做可解释归一化。没有自动重试、第二次修复、换模、模板覆盖或降低事实门禁。
- 回归：同一指纹完整保留 PASS；分别漏季节/项目/地域/人群、事实矛盾、跨行业污染、结构缺失全部 fail-closed；“夏天/周边女性客群/日常补水护理”PASS，另一条“秋季舒缓护理/周边上班族”证明不是只适配本句。controlled mock、prompt budget `23,434/25,000 bytes`、Web/WorkBuddy、MCP 租户/权限/账本/幂等、typecheck、`qa:fast`、`qa:regression`、`qa:full`（含 build）与 diff PASS，Provider=0、费用 ¥0。
- 修复后真实回归（2026-08-26）：新授权下严格 1 次 `deepseek-v4-pro`，thinking disabled、重试/修复/换模/追加=0；`finish_reason=stop`，tokens `3241/1039/0/4280`，23.146 秒，保守估算 ¥0.018510≤¥0.13。正式 1.0.1 结构、任务事实回执、事实保留/矛盾、污染、三套配图和 Provider 原始输出 postflight PASS，fallback 0；唯一 succeeded AgentRun、settled reservation、1 consume/0 refund，Web/WorkBuddy 输出哈希一致，临时权限已撤销。
- 验收脚本连带回归：首次二次检查错误地用原始短句和通用字面 Eval，要求“事实母版/逐张提示词”等方法论描述及整句 deliverable 出现在客户正文，形成保存后的假阴性；没有新增 Provider 调用。修复后通用 Eval仍检查全部正式栏目与字面术语，描述性交付由产品 postflight 的标题数、标签数、三套配图字段和任务事实逐项验证；已持久化合成结果离线审计、Web 恢复和账本 postflight PASS。
- 放行状态：**已关闭**。QA-20260825-009 与 P1-A 均关闭，P0/P1=0；本轮授权已耗尽，不启动 P1-B/P1-C/日报。

## QA-20260825-008 直播复盘通用输入无法约束三类证据与 Web/WorkBuddy 一致性（P1）

- 现象：直播复盘虽然已有稳定路由与正式 Skill 映射，页面仍只提供通用任务文本和 `platform/contentStructure`；无法分别证明后台数据、录音转写和原话术计划是否存在，也没有固定八模块结果视图。Web 页面补充字段若不进入后端合同，WorkBuddy 会走另一条事实边界。
- 修复前红灯：新增 `beauty-industry-live-review-workbench-p1-smoke.mjs` 首次因专属组件不存在以 `ENOENT` 失败；证明问题是正式旅程缺失，不是既有路由整体损坏。
- 根因：BY-10 只锁定 capability/scope/Skill，没有建立版本化直播复盘输入。首次实现又把 workflow directive 放在“用户这次说”分隔之后，Agent 的直播证据快速门禁看不到转写，WorkBuddy 转写-only 请求被误判为无证据。
- 最小修复：新增严格 `live_review_workflow_v1`、三类证据 readiness/缺失影响、专属页面、八模块展示和同租户历史；正式指令连同真实工作流事实放入当前用户证据区，再由产品档案/系统边界分隔。CSV/XLS/XLSX 只接受真实数值记录和绑定解析回执，文件解析零 Provider。
- 回归：workbench/runtime/WorkBuddy/浏览器专项覆盖正常、全缺、部分缺失、坏表/空表、错字段、重复键、失败/取消/超时释放、跨租户、无权限、刷新、返回、桌面/390px和控制台；MCP 隔离库、Web/API typecheck、`qa:fast`、`qa:regression`、`qa:full`（含 build）与 diff 均 PASS。Provider/媒体调用 0、费用 ¥0。
- 放行状态：已关闭；BY-16 范围无未解决 P0/P1，未部署生产。

## QA-20260825-007 视频内容复盘资料准备页可能被误当作已开放执行面（P1）

- 现象：BY-14 已建立视频内容复盘稳定规划路由，但正式输入合同、真实上传/预检和逐证据状态缺失；若直接复用旧通用单文本框或恢复退役 scope，用户可能把补充转写/模板结果误认成系统已读取视频，也会绕过 `QA-20260823-002` 的真实视觉+ASR准入门禁。
- 修复前红灯：新增 `beauty-industry-video-content-review-workbench-p1-smoke.mjs` 首次因正式 workflow/专属组件不存在以 `ENOENT` 失败；既有 invite/admission smoke 同时证明公开 scope 和工具必须继续拒绝。
- 根因：产品已有 `shooting_editing` 正式 Skill 与共享媒体底座，但页面层没有把“零费用资料准备”和“真实 Provider 成功证据”建模为两种不同状态；旧媒体输入只返回聚合失败，不能在不付费时重新证明真实视觉与 ASR。
- 最小修复：新增 `video_content_review_workflow_v1`、专属结构化页面与受权限保护的零费用 ffprobe 预检；临时文件请求后删除；固定双流合成资产完成 qwen-vl-max/qwen3-asr-flash 各一次真实准入后，才精确注册 WorkBuddy 工具并恢复 scope/capability。每个业务视频仍须当前可核验的口播与画面证据，元数据预检不构成内容成功回执。
- 回归：旧 1 秒夹具只有视频流，授权审计正确拒绝其作为 ASR 证据；runtime 专项先因双流 manifest 缺失红灯。新增固定哈希的 8 秒本地合成 H.264 + AAC mono 22050 Hz 资产，ffprobe/逐帧/频谱/来源清单 PASS；离线合同要求视觉命中已知色块事实、ASR 命中唯一合成句、两证据进入正式输入且无 fallback。错画面、错转写和 fallback 均失败关闭；Provider 调用 0、费用 ¥0。
- 二次红灯：真实浏览器按“预检→补证据”操作时，通用字段更新错误清除 `mediaPreflight`，按钮永远无法解锁；新增 BY-15 浏览器 E2E 修复前 FAIL。根因是组件 `update` 无条件清空回执，修复为只有重新选文件或刷新才清除，并补静态断言。
- 放行状态：真实视觉+ASR准入、正式证据落位、`fallbackUsed=false`、8 workflow/权限/租户/账本/幂等、桌面/390px及全仓门禁全部 PASS；`QA-20260823-002` 已关闭，精确公开执行面已恢复。

## QA-20260825-006 美业可见导航缺少稳定独立页面与统一产品识别（P1）

- 现象：BY-12 首页已有真实租户数据，但日报、知识、交付和经营诊断仍是 disabled；美业获客直接跳小红书而没有模块首页，任务/档案只是同组件局部切换，WorkBuddy 没有共享选中态；顶部仍把旧“企业经营工作台”等识别混入产品层，移动端没有可展开抽屉和焦点合同。
- 修复前红灯：新增 `beauty-industry:navigation-shell-p1-smoke` 后首次稳定 FAIL：`shared beauty navigation shell is missing`；同期 `beauty-industry:home-p1-smoke` PASS，证明正式首页真实数据合同未回退。
- 根因：旧产品文档要求规划项不可点击，BY-12 因而只补首页数据卡与部分深链，没有建立产品级共享路由壳层、模块/规划独立页、产品内 404、权限直达页和移动导航状态机；2026-08-25 新批准的信息架构已明确覆盖旧规划项行为。
- 最小修复：新增统一产品壳层与 10 条稳定主路由；获客首页/三分支、规划、无权限和 404 各自独立渲染；WorkBuddy 接入同壳层；移动端增加抽屉、遮罩、Escape 与焦点恢复。服务端权限仍为唯一开放依据，既有 capability/Skill、租户、账本和业务深链不变。
- 回归：桌面真实浏览器逐项验证主导航、旧深链、刷新、前进后退、404、断网重试和控制台；390×844 Chrome 实测 `innerWidth=390`、横向溢出 0、抽屉与焦点 PASS，双浏览器上下文租户隔离 PASS。静态/浏览器/Web/MCP 数据库专项、Web/API typecheck、`qa:fast`、`qa:regression`、`qa:full`（含 build）PASS。
- 放行状态：已关闭；BY-14 范围无未解决 P0/P1，Provider 调用 0、新增人民币费用 ¥0，未部署生产。

## QA-20260825-005 美业视频数据复盘未保留结构化证据与空数据边界（P1）

- 现象：视频数据复盘虽锁定正式 capability 并能上传文件，页面仍是通用单文本框/整页 Markdown；真实 CSV 解析后，Agent 执行看不到结构化记录而进入 Provider，且“有效咨询”未计入业务转化、仅表头文件可被误认为已有数据。
- 修复前红灯：专属工作台专项先因组件不存在 FAIL；运行时专项先证明真实文件路径发生 Provider 调用，再以平均完播率/业务转化断言捕获字段口径；空数据专项先因记录校验 helper 不存在 FAIL。同期既有 Web 合同保持 PASS，排除旧功能整体回退。
- 根因：产品页只复用通用 `question + professionalOptions`，没有正式数据复盘旅程；文件解析证据被拼在“当前产品上下文”分隔符之后，Agent 直连引擎只读取分隔符之前的用户证据；共享确定性解析缺“有效咨询”别名；后端只检查字段列表，未要求至少一条含数值的记录。
- 最小修复：新增 Skill 合同驱动专属页、后台导出指引、字段审计、缺失影响、正式指标/报告/历史；把解析记录移入 Agent 可见证据区，在预留和 Provider 前验证真实数值记录；补“有效咨询/有效咨询数”别名。Web/WorkBuddy 共用版本化工作流、权限、租户、账本和幂等链，不改 Skill 映射或版本。
- 回归：脱敏 2 行数据固定得到总播放 2060、平均完播率 36.5%、业务转化 7，Provider 调用 0；错类型、仅表头、缺字段、网络错误、刷新恢复、重复点击、跨租户/错 scope、账本/幂等、桌面/390px和控制台均 PASS。BY-13 专项、Web/MCP、typecheck、`qa:fast`、`qa:regression`、`qa:full`、build、`git diff --check` PASS。
- 放行状态：已关闭；BY-13 范围无未解决 P0/P1，新增人民币费用 ¥0，未部署生产。

## QA-20260825-004 美业根路由缺少真实经营首页与可恢复导航（P1）

- 现象：用户进入美业智能体后直接看到旧 Hero、档案和工作区纵向堆叠；已确认的正式首页视觉没有接入真实积分、档案完整度、连接状态、今日建议和最近任务，也没有任务中心及可刷新的子工作区深链。
- 修复前红灯：新增 `beauty-industry:home-p1-smoke` 后稳定 FAIL，首先命中 `beautyIndustryShell` 缺失；同期既有美业 Web 合同全绿，证明是正式首页层的独立缺口而不是 BY-11 执行链回退。
- 根因：BY-05 至 BY-11 只逐步完成真实任务工作区；BY-02 原型保持静态隔离，正式产品根路由尚未建立以鉴权 overview/profile/history/connections 为源的首页状态和浏览器路由合同。
- 最小修复：根路由新增深绿色侧栏和暖白经营首页；真实计算档案完整度并显示租户积分、服务端今日建议、服务端权限、WorkBuddy 有效连接和 AgentRun 最近任务；增加档案、任务中心和既有七工作区稳定深链、popstate/刷新恢复、加载失败重试与真实空状态。未改 Skill 映射、执行 API 或数据库 Schema。
- 回归：1440px、390px、真实空状态、3999 断网/重试、深链刷新/返回、任务恢复、档案与 WorkBuddy 导航、控制台均 PASS；隔离数据库档案 A/B 与 WorkBuddy 租户/账本回归、首页专项、美业专项、`qa:fast`、`qa:regression`、`qa:full`、build、`git diff --check` PASS。Provider 调用与费用为 0。
- 放行状态：已关闭；BY-12 范围无未解决 P0/P1，未部署生产。

## QA-20260825-003 美业内容十件套页面未按 V5 正式合同组织任务（P1）

- 现象：用户进入“视频获客 → 内容十件套”后仍看到通用单文本框和长 Markdown 结果；缺少正式 V5 所需的目标/人群/平台/拍摄资料、可操作追问、十件套卡片、Word 与历史收纳，TOP10 承接也没有结构化来源合同。
- 修复前红灯：新增 `scripts/beauty-industry-content-ten-workbench-p1-smoke.mjs` 后稳定 FAIL，首先命中专属组件不存在；首次实现后进一步命中 workflow 版本未进入幂等指纹。旧固定路由测试也因缺少新的 `contentWorkflow` 被正确拒绝，证明相邻夹具需同步正式合同。
- 根因：后端虽已锁定 `content_plan / baolu_content_creator@5.0.0`，产品 UI 和 Web/MCP 输入仍沿用通用 `question + professionalOptions`；页面结构没有以 Skill 正式输入/输出合同为源，导出读取也没有再次校验租户归属，同事件循环重复点击存在极短重复窗口。
- 最小修复：新增版本化 `content_workflow_v1`，Web/MCP 共用必填合同并进入幂等指纹；新增专属工作区、TOP10 来源承接、必填追问、V5 十卡、复制、租户受控 Word、历史收纳和同步重复点击 guard；其他工具误传合同 fail closed，FIP 只复用鉴权下载方式，不改变其业务合同。
- 回归：正式 `deepseek-v4-pro` Web 2 次 + MCP 1 次均 `stop`、reasoning=0、十件套完整、跨产品禁词 0；实际费用估算 ¥0.128965≤¥1。桌面真实生成/复制/Word/历史/断网与 390px 恢复 E2E PASS；Word 4 页逐页无裁切、乱码、空白或内部字段；专项、`qa:fast`、`qa:regression`、`qa:full`（含 build）PASS。
- 放行状态：已关闭；BY-11 范围无未解决 P0/P1，未部署生产。

## QA-20260825-002 美业内容十件套被跨产品示例和通用提示层污染（P1）

- 现象：美业用户显式选择“内容十件套”后，最终模型消息仍会混入餐饮招商示例、其他客户名称和演示经营数字，存在输出串产品事实的风险。
- 修复前红灯：`beauty-industry-workflow-composition-smoke.ts` 对真实 `buildAgentMessages` 结果稳定 FAIL，命中 `content-ten:cross_product_example_contamination`；最终 system 同时包含通用身份、跨产品 examples 和 product experience 层。
- 根因：`buildAgentMessages` 无条件按 `skillId` 加载排序前三个 examples；`baolu_content_creator` 的首批示例含餐饮招商演示事实。美业虽已用 `skillPromptOverride + capabilityLocked` 组装主 Skill、行业差异与合规约束，但 generic 组装器仍叠加跨产品层；正式 V5 Prompt 自身也包含不适用于美业工作流的历史示例段。
- 最小修复：新增显式 `locked_product_workflow` 组装策略，只允许已锁定的美业产品工作流启用；保留租户上下文、正式 Skill 版本、结构合同、事实/权限/外部动作硬门禁，跳过跨产品 example、通用身份和冲突 experience 层。内容十件套仅提取 V5 正式十项契约并叠加美业差异/合规，FIP clean branch 与 generic Agent 原样保留。
- 真实回归：同一脱敏生活美容输入以 `deepseek-v4-pro` 完成 Web 1 次、MCP 2 次，三次均 `finish_reason=stop`、reasoning=0、十件套完整、禁词 0；同幂等键恢复未重复调用。数据库 4 条近期成功记录全部合同通过、预留结算一致，3 枚临时 MCP 凭据已撤销。三次最终批估算约 ¥0.125，本轮含前置诊断累计约 ¥0.206≤¥1；图片/视频/ASR 调用 0。
- 页面与门禁：真实隔离库结果在 Chrome 1440×1000、390×844 完成显示、历史、刷新恢复，控制台错误 0；美业专项、MCP、FIP 相邻回归、`qa:fast`、`qa:regression`、`qa:full`、build、`git diff --check` 全部 PASS。
- 放行状态：本缺陷已关闭；BY-10 的四来源选题专属工作区也已由 QA-20260825-001 的二次验收关闭。

## QA-20260825-001 美业正常选题在正确路由下仍被合同拒绝（P1）

- 现象：用户显式选择“视频获客 → 选题系统”并输入普通皮肤管理选题需求，页面只有通用文本框；调用后因四来源合同不完整被拒绝，历史无结果。
- 修复前红灯：`beauty-industry-topic-workbench-p1-smoke.mjs` 稳定 FAIL 25 项，证明 Web/MCP 缺少结构化获客目标和四来源合同；真实 Provider 后续分别暴露 `rubric_fact_retention_weak`、合法内容承接误判为跨模块输出两类后置误拒绝。
- 根因：路由始终正确，但产品只挂接了 `baolu_topics` 输出合同，没有复用 FIP 已验收的获客目标、四来源资料采集/状态、证据核验、三关筛选、TOP10 和内容承接；通用 Agent 质量门禁又发生在服务端可信选题简报归一化之前，跨模块关键词检查无法区分“以后进入内容系统”与当前已生成拍摄脚本。
- 最小修复：语义复用 `TopicSystemWorkbench`，为美业增加明确展示文案而不复制业务逻辑；Web/MCP 统一传递 `topicWorkflow`，服务端重取当前租户已确认转写和最近视频复盘，支持 1/2/3/4 来源、全缺失才阻止。产品后置层只把服务端已验证的目标简报写回固定章节，并允许明确的下一步边界说明；真实跨模块章节、错租户、未确认/错行业证据仍失败关闭。未删除双重校验、未使用模板或关键词路由补丁。
- 回归：专项红灯转绿；正式 `deepseek-v4-pro` MCP 连续 3 次及真实 Web 1 次 PASS，固定 `baolu_topics@2.1.2` 与两层美业约束、fallback 0。桌面/390px完成四来源、TOP10、保存/刷新、重复点击、断网和进入内容系统；内容承接未新增 Provider 调用。MCP 数据库、预留/结算/释放、幂等、撤销、跨租户及 `qa:fast`、`qa:regression`、`qa:full`、build、`git diff --check` PASS。最终稳定 4 次估算 ¥0.131944；本任务已跟踪文本测试低于 ¥1，媒体调用 0。
- 放行状态：已关闭，无未解决 P0/P1；本机持久验收环境可用，未生产部署。

## QA-20260824-003 美业显式入口仍可能被共享路由或最终交付层替换（P1）

- 现象：用户在网页或 WorkBuddy 明确选择小红书/选题等功能后，输入里出现其他模块关键词时可能切到错误 Skill；即使 route 元数据仍正确，错误模块文本或确定性重建文本也可能被显示成成功。
- 修复前红灯：显式小红书 + “数字分身”被共享关键词路由覆盖；受控小红书 Provider 返回视频复盘/餐饮文本时旧产品层仍可形成完成态；真实选题 `deepseek-v4-pro` 的正式 Skill 输出被共享 FIP 扩展列检查重建为 `topic_final_delivery_rebuilt`。
- 根因：`capabilityLocked` 没有优先于共享硬编码路由；产品执行加载跨能力会话；产品层缺少原始/最终双重输出合同；美业输入未分隔用户原文与系统档案；共享 FIP 扩展交付错误应用到美业组合 Skill；直播普通请求被无条件套用整场 V3 结构；销售合同只在说明中要求“异议”但没有进入精确输出骨架。
- 最小修复：固定入口以 `requestedSkillId` 为唯一主 Skill；美业七工作流集中白名单并保持约束顺序；禁用跨能力整段历史；保存/扣分前校验 Skill 版本、正式合同、行业/模块、fallback 与 Provider 终态；增加脱敏 route receipt；美业组合版本按正式 `baolu_topics` 合同交付，FIP 扩展合同保持不变；直播按用户是否明确要求整场分流标准/整场合同；销售补齐异议结构；网页失败进入明确终态。
- 回归：`pnpm.cmd beauty-industry:fixed-route-output-p1-smoke`、`pnpm.cmd beauty-industry:web-contract-smoke`、隔离库 `pnpm.cmd beauty-industry:mcp-database-smoke`、`pnpm.cmd beauty-industry:mcp-platform-smoke`、`founder-ip-topic-final-delivery-smoke.ts`、桌面/390px Chrome E2E、`pnpm.cmd qa:fast`、`pnpm.cmd qa:regression`、`pnpm.cmd qa:full` 均 PASS。
- 放行状态：六个文本能力真实终验及七能力固定路由均 PASS，错合同/Provider/parser/fallback 失败不保存不结算；无未解决 P0/P1，状态已关闭。

| QA-20260824-001 | 2026-08-24 | P0 | 美业 BY-09 / 公网 WorkBuddy 与网页生成链 | 公网 `initialize` / `tools/list` 正常，但 6 个生成工具统一返回 `sitong_service_unavailable`；视频数据复盘无解析文件时返回 `beauty_video_data_not_parsed` 属正确边界。 | 独立 `beauty-industry-beta` 服务从共享 env 继承了 `127.0.0.1:3002/mcp`，正式美业 Skill 包被错误地从另一发布目录加载，实际终态为 `original_skill_not_found`；失败发生在积分预留与 Provider 之前。 | `beauty-industry-beta-self-mcp-config-smoke.mjs` 对修复前 systemd unit 稳定 FAIL；生产日志按 6 工具记录缺失 Skill，数据库聚合为余额 300、reservation/transaction/AgentRun 均 0。 | 为 beta unit 增加唯一最小覆盖 `SKILL_MCP_URL=http://127.0.0.1:3004/mcp`，保留独立 `ORIGINAL_SKILL_ROOT`；修复后 9 个所需 Skill 包加载 9/9，临时 0 积分凭据的 MCP 与 Web 六工具均到达 `insufficient_credits`，数据复盘继续失败关闭，reservation/transaction/AgentRun/Provider 均 0；临时凭据已撤销，401/401/401。真实文本终验待单独小额授权。 | 修复中 / 零费用链已关闭 |

| QA-20260824-002 | 2026-08-24 | P0 | 美业 BY-09 / 已泄露 MCP 凭据 | 用户截图中一次性 MCP secret 已暴露，若保持 active 可继续访问 7 个美业工具。 | 一次显示的 secret 被截图带入聊天；服务端哈希机制正常，但用户尚未在页面撤销。 | 以 product、创建时间、7 scopes、300 积分账户、经营主体、用户成员关系、Agent 与创建审计做联合唯一匹配，候选数 1。 | 依用户明确授权，将唯一记录更新为 `revoked` 并写撤销审计，保留 hash/prefix、不物理删除；数据库确认状态终止。临时凭据回归证明撤销后 initialize/tools/list/tools/call 均 401。 | 已关闭 |

| QA-20260824-003 | 2026-08-24 | P1 | 美业 BY-09 / 选题四来源正式契约 | 获批的首个真实 `deepseek-v4-pro` 美业选题调用终态成功，但结果没有使用已冻结的第一来源名称“私有知识与客户问题”，六工具终验因此在第一项停止。 | 原始 `baolu_topics` Skill 已升级为“私有知识与客户问题”，仓库运行时 Prompt、Agent 质量必填项和最终化 fallback 仍使用旧名称“AI录音卡”；三层版本漂移使模型/最终化无法交付统一契约。 | `beauty-industry-by09-topic-source-contract-smoke.mjs` 修复前稳定 FAIL：`runtime topic prompt missing: 私有知识与客户问题`；真实调用为 `finish_reason=stop`、5600 输入 token、4816 输出 token，Provider 模型正确但业务硬门禁失败。 | 最小同步运行时 Prompt、Agent 必填项和最终化用户可见第一来源名称；底层仍兼容 AI 录音卡输入，不改数据读取。专项、选题相邻回归、Agent/Skill typecheck PASS。获批复验已执行但在输出前超时，后续由 QA-20260824-004 跟踪。 | 已关闭（四来源契约） |

| QA-20260824-004 | 2026-08-24 | P1 | 美业 BY-09 / 真实选题超时终态 | 用户授权的修复后唯一选题复验在约 120 秒失败，日志只显示 `provider_failure:unknown`，无法区分超时、取消或 Provider 明确拒绝。 | Agent 的 120 秒包装器抛出普通 `Error`，失败提取器只读取结构化 `providerFailure`；固定美业选题还被通用单次调用 120 秒上限截断。 | `beauty-industry-by09-provider-timeout-classification-smoke.ts` 修复前 actual=unknown / expected=timed_out；真实复验为 120090ms 失败，按失败即停没有调用其余五工具。 | 从错误类型和安全消息归类 timed_out/cancelled；固定美业选题采用 180 秒主超时，beta unit 同步 180 秒。专项、选题契约和全量门禁 PASS；后续受控选题真实调用 `finish_reason=stop`、reasoning=0、账本 settled、费用估算 ¥0.030861。 | 已关闭 |

| QA-20260824-005 | 2026-08-24 | P1 | 美业 BY-09 / 公网子路径页面 | `/beauty-beta/login/beauty-industry` 返回 HTTP 200，但浏览器实际渲染为外卖产品，用户无法进入美业登录。 | 独立 beta 的 Vite 资源 base 正确，但 SPA 路由只剥离 `/os-v2`；`/beauty-beta/...` 未归一化，最终落入默认首页。旧 smoke 只验证 200，未验证已部署 chunk 和用户可见产品。 | 生产 Chrome 桌面红灯显示“枕水江南/外卖增长”；`beauty-industry-production-web-content-smoke.mjs` 修复前因缺少当前美业工作台契约 FAIL。 | 复用 `getAppRoutePath` 按实际 Vite base 归一化 Root/AppFlow；生产内容 smoke 核对主 bundle 与登录/工作台/WorkBuddy 三个 chunk。独立 beta 备份后重建；生产桌面/390px均显示美业邀请码页，无客户品牌/品牌中立、控制台 0，`/os-v2/` 未覆盖。 | 已关闭 |

| QA-20260824-006 | 2026-08-24 | P1 | 美业 BY-09 / 销售真实输出契约 | 真实销售调用终态成功但缺“当前判断/下一步动作”；确定性复现把生活美容效果咨询套成团购退款或企业项目。 | `beauty_sales` 未映射异议回复结构，fallback 又用混合系统上下文判断客户场景，公共预判段固定含企业预算和决策人。 | 真实 contract flags 与 `beauty_sales_objection_contract_not_enforced`、B2B 污染断言稳定 FAIL。 | 按当前用户事实锁定 B2C 美业效果咨询，B2C/B2B 预判、行动和待核实完全隔离；修复后真实复验 `stop`、reasoning=0、估算 ¥0.013207、账本 settled，全部契约与场景边界 PASS。 | 已关闭 |

| QA-20260824-007 | 2026-08-24 | P0 | 美业 BY-09 / 调用前费用硬界 | 历史选题成功后才发现 completion/reasoning 远超经验预算，无法在 Provider 调用前证明不越界。 | 终验脚本只做经验报价，Web/self-MCP 正式请求没有统一版本化的模型、输入和输出 token 预算预检。 | 历史 5601/9192/7548 usage 与旧实现的预算红灯稳定复现。 | 新增 `beauty-text-budget-v1`；六工具批次最坏 ¥0.999456，超限在 Provider started 前拒绝。六工具各 1 次真实终验累计估算 ¥0.196888≤¥1，无自动重试。 | 已关闭 |

| QA-20260823-006 | 2026-08-23 | P1 | 美业 BY-08 / 生产模型模式 | 生产配置校验没有拒绝 `LLM_MOCK_MODE=true` / `USE_MOCK_LLM=true`，误配时可能把受控模拟结果提供给内测用户。 | 模拟开关由 Provider 直接读取 `process.env`，未进入生产运行时或静态发布预检的禁止项。 | `beauty-industry:invite-beta-scope-smoke` 新断言修复前稳定 FAIL：`runtime config must reject mock text providers in production`。 | 运行时 `validateRuntimeConfig` 与 `prelaunch-check.mjs` 双层 fail closed；实际预检命令命中明确禁止文案，scope smoke、API typecheck 和全量门禁 PASS。 | 已关闭 |
| QA-20260823-005 | 2026-08-23 | P1 | 美业 BY-08 / 小红书图片费用预览 | 真实页面已生成 3 个配图方向，但一直提示“缺少完整的专业配图提示词”，无法进入清晰的图片报价/授权终态。 | 受控 mock 只输出“主体/构图/禁止”，没有遵守生产解析器要求的三套“角色标题 + 正向视觉提示词 + 负向视觉提示词”；页面与费用服务本身正常。 | 把 mock 实际输出交给 `parseBeautyImageDirections` 后，修复前稳定 FAIL：`beauty_image_direction_missing:cover`；真实浏览器复现 422。 | 只修 mock 为封面图/内容图/互动承接图三套正负提示词，不放宽生产解析器。回归与真实页面转绿，页面显示“真实图片生成尚未获得受控授权”，媒体任务/费用 0；独立新会话 console error 0。 | 已关闭 |

| QA-20260823-002 | 2026-08-23 | P1 | 美业 BY-07/BY-15 / 真实视频内容复盘 | 旧唯一一次合成视频上传后没有形成关键帧视觉结论或音频转写，真实复盘成功链无法继续。 | 旧实现丢弃 Provider 安全终态且 ASR 错误继承视觉 `temperature`；后续授权候选夹具又只有视频流，不能证明真实 ASR。 | 先保持 scope/tool/capability fail-closed；新增双流固定哈希合成资产、一次性无重试验收脚本、视觉/ASR已知事实硬判定和 activation 红灯。 | 用户授权后仅上传固定资产：qwen-vl-max 1 次 HTTP 200、813 tokens，命中全部画面事实；qwen3-asr-flash 1 次 HTTP 200、223 tokens/8秒，逐字命中合成句；两证据进入正式字段且 `fallbackUsed=false`，临时派生媒体删除。恢复后 8 workflow、Web/WorkBuddy、权限/租户/账本/幂等、浏览器和全仓门禁 PASS，无重试/换模/追加调用。 | 已关闭 |
| QA-20260823-003 | 2026-08-23 | P1 | 美业 BY-07 / 媒体 Provider 可观测性 | 视频视觉与 ASR 失败时只返回聚合 warning，页面无法说明失败阶段、官方错误码、超时/取消或是否开始计费，已结束请求也不能安全追踪。 | 调用层直接抛弃失败响应与请求头，没有统一 timeout/cancel 终态、请求指纹和安全 usage；页面仅消费 warning。 | `beauty-industry:real-media-smoke` 修复前精确 FAIL：`visual and ASR calls need safe provider terminal observations`；禁止真实重放。 | 新增统一观察层与安全页面状态；只保留阶段、model/region/media type、HTTP/官方码、脱敏请求指纹、timeout/cancel/finish/聚合 usage/billing，不保存响应正文、媒体、提示词、密钥或租户。纯 fixture 覆盖成功、部分/全失败、超时、取消及稳定指纹，Provider 调用 0。 | 已关闭 |
| QA-20260823-004 | 2026-08-23 | P1 | 美业 BY-07 / 持久验收环境源码新鲜度 | 获批的唯一一次真实视频上传仍只显示“Provider 未开始或未返回可观测终态”，无法得到刚新增的安全阶段码。 | 验收 API 进程启动于媒体观测修复之前；旧 `start.ps1` 只看 `/ready`，没有核对源码指纹；同时 `tsx` CLI 父进程 PID 与实际监听子进程 PID 分离，不能形成可靠运行身份。系统自带 Windows PowerShell 还会把无 BOM 的中文验收路径错误解码，形成假离线失败/假 PID 不一致。 | `SOURCE_BASELINE` 3/3 一致后语义合并；追加停止前身份二次核验时修复前 50 PASS / 1 FAIL，追加单进程启动时 51 PASS / 1 FAIL；最终轻量复核用 Windows PowerShell 精确复现无 BOM 解析失败。 | 增加源码/运行指纹、PID/端口一致性、Node 单进程 `tsx` loader、旧父子布局双重身份校验迁移，以及实际 `Stop-Process` 前再次解析身份；4 脚本补 UTF-8 BOM。最终 Windows PowerShell/PowerShell 7 离线 53/53、全量门禁 PASS。持久环境 `source_fresh=true`、运行指纹一致、记录 PID=监听 PID，页面刷新恢复且本轮 Provider 调用/费用为 0。真实视频成功链仍由 QA-20260823-002 单独阻断。 | 已关闭 |
| QA-20260823-001 | 2026-08-23 | P1 | 美业 BY-07 / 真实图片资产恢复 | 3 个 `wan2.7-image` Provider 任务成功后，资产域名未通过本地验收 allowlist；前端并发轮询任一 502 会使整批状态停止更新，用户看不到已生成图片。 | 验收环境缺少 `oss-accelerate.aliyuncs.com`；状态轮询使用整批 `Promise.all`，单项本地持久化失败会抛弃其他任务的成功状态；Provider 已成功但缺少显式同任务恢复动作。 | `beauty-industry:real-media-smoke` 先因缺少“恢复图片任务状态”和资产恢复断言 FAIL；真实页记录 2 次 502，数据库 Provider job 已存在且禁止创建第 4 个任务。 | 补最小 allowlist；状态逐项串行容错；`asset_persistence_failed` 只恢复同一 `providerTaskId` 落盘；批次已退款时晚恢复不补扣。真实 3/3 资产持久化、复制、下载、刷新恢复 PASS，Provider 任务仍为 3。 | 已关闭 |

| QA-20260822-004 | 2026-08-22 | P1 | 美业固定路由 / 受控模型 | 用户显式选择小红书时，受控模型仍返回视频数据复盘；真实输入中的其他分支关键词可能误导结果。 | 受控 `streamComplete` 只检查最后一条 user message，没有读取 system 中的固定 capability；通用下一步上下文又含复盘词。 | `scripts/beauty-industry-controlled-mock-routing-smoke.ts` 修复前小红书稳定得到视频复盘；新增 8 个显式工作流硬断言。 | workflow 在 system 上下文写入固定 capability；complete/streamComplete 都读取完整消息并优先按 capability 路由。8/8、网页/MCP contract、全量门禁 PASS。 | 已关闭 |
| QA-20260822-005 | 2026-08-22 | P1 | 美业视频内容复盘 / 文件失败 | 视频解析失败后页面仍停留在“正在解析文件”，用户无法判断是否会继续扣费或调用模型。 | 文件上传 catch 只标记 parseState=failed，没有同步恢复用户可见 notice。 | `beauty-industry-web-contract-smoke.mjs` 先新增失败终态断言；真实 390px 页面上传合成 MP4 复现。 | catch 明确显示“文件解析失败；已禁止复盘，不会调用模型或扣积分”，生成按钮保持 disabled；刷新后失败状态恢复。媒体调用/积分 0。 | 已关闭 |
| QA-20260822-006 | 2026-08-22 | P2 | 美业工作台 / 390px 布局 | 390px 页面出现横向滚动条，流程按钮把主页面宽度顶到 394px。 | 工作区和卡片沿用 content-box，移动端 padding/border 叠加到 100% 宽度；横向流程容器缺 `min-width:0`。 | 真实浏览器修复前 `document=394, viewport=390`，并把 `scrollWidth <= innerWidth` 固化进浏览器 E2E。 | 工作区/卡片改为 border-box + min-width:0，横向流程在卡内滚动；复验 `document=375, viewport=390`，控制台 0。 | 已关闭 |
| QA-20260822-001 | 2026-08-22 | P1 | 美业 Skill / 最终业务输出质量 | 8 个代表场景中，选题返回通用失败模板；小红书缺三张配图提示词并编造个人体验；生活美容短视频变成美甲；投流终稿截断；直播混入带货、美甲和餐饮字段；视频复盘丢失已提供的 3 秒留存和私信字段。 | 美业正式 contract 只覆盖结构和边界，没有把真实 Provider 终态、子行业映射和 CSV 字段保真作为统一硬门禁；通用美容拍剪 fallback 将美容/皮肤管理/护肤与美甲放入同一默认分支，直播 Skill 只覆盖带货/招商框架。 | `scripts/beauty-skill-output-quality-eval.ts` 保存零费用预检和真实 Pro 证据；真实 5 场景共 10 次规划/成稿调用、费用估算 ¥0.2765，`stop=6`、`length=4`；硬断言失败模板、缺段、截断、子行业污染、虚构体验和字段丢失。 | 本任务按约束不修改生产 Skill；验收包标记 0/8 无判断直用、2/8 待行业确认、6/8 P1。后续须按终态完整性、子行业拆分、生活美容直播模式、CSV 字段映射和小红书事实门禁分别做单变量修复。 | 待修复 |

| QA-20260822-004 | 2026-08-22 | P1 | 美业获客 / 内容系统正式交付契约 | 美业视频获客页面使用了错误的旧交付名称，仓库生产 `baolu_content_creator` 仍停在 V4.1.4 九项，缺少 WorkBuddy V5 已确认的第三项“访谈话术”，无法完整交付正式十件套。 | 产品页面沿用过时的口述名称；外部最新版与仓库生产 Skill 之间没有逐项版本同步回归，已有访谈附录未晋升为正式必交付项，解析器和确定性 fallback 也只接受九项。 | `scripts/baolu-content-creator-sync-smoke.mjs` 先在旧生产资产稳定 FAIL，精确断言缺少“访谈话术”及十项顺序；`content-system:batch-smoke` 随后暴露确定性 fallback 仍缺第三项。 | 以 WorkBuddy V5 为核对源做最小语义合并：保留仓库租户授权、事实边界、署名与 `PREVIEW_ONLY`，正式固定十项顺序并补安全访谈契约；同步 manifest、contract、解析器、fallback、美业适配和页面名称。专项 smoke、1440×1000/390×844 页面、`qa:fast`、`qa:regression`、`qa:full` 与 `git diff --check` 全部 PASS；媒体 Provider 调用和费用均为 0。 | 已关闭 |

| QA-20260821-011 | 2026-08-21 | P1 | 美业行业 MCP / 产品凭据与统一计费 | BY-01 已有行业 adapter/Skill/Eval，但共享 WorkBuddy 只能按 Agent 连接，不能按 product/scopes 过滤，且缺到期/轮换、调用前预留与 usage 关联。 | 产品专属能力与共享 MCP/凭据/账本分属串行任务，共享 product/Agent/Skill 注册和 schema 尚未合入。 | `beauty-industry-workbuddy-platform-smoke.ts` 修复前稳定 FAIL；隔离数据库协议 smoke 覆盖错误产品、跨租户、身份伪造、授权重查、scope、撤销/轮换、余额、幂等、失败/超时/取消。 | 在现有 WorkBuddy 加法实现产品凭据、薄路由、一次性 secret、授权重查与耐久积分预留/结算/释放。专项、迁移升级/幂等/回滚/再升级、`qa:fast`、`qa:regression`、`qa:full` PASS；生产未迁移/部署。 | 已关闭 |

| QA-20260821-010 | 2026-08-21 | P2 | 创始人 IP 获客 / 工作地图一级分支命名 | 工作地图把“选题系统→内容系统→投流系统→视频复盘系统”整条链标成“选题分支”，会误导用户把首个模块当成整条业务分支。 | 一级分支标签沿用了首节点名称，没有按产品拓扑表达完整视频内容链。 | `scripts/agent-work-map-smoke.ts` 先新增三条一级分支精确断言，旧实现因缺少“视频分支”失败；浏览器 E2E 同时检查四个视频链节点、直播链、独立答疑、连线方向和回流虚线。 | 仅把一级标签及侧栏说明改为“视频分支”，保留“选题系统”节点名称、路由、能力绑定和所有连线。桌面/390px Playwright、工作地图专项、FIP 专项和全量门禁 PASS。 | 已关闭 |
| QA-20260821-009 | 2026-08-21 | P1 | 创始人 IP 获客 / 选题证据与目标错配 | 美业加盟获客目标简报下的 TOP10 被同租户 AI 工具、企业 AI 改造录音主导，页面又没有持续标识合成验收数据，用户可能把错误选题继续带入内容系统。 | 本机验收夹具允许连接真实 GetNote 并调用生成；前端自动勾选最近录音，服务端只做租户/主体作用域，没有以已保存获客目标简报校验项目、行业、目标相关性与录音确认状态；最终选题门禁只检查结构，没有限制实际获准来源。 | `scripts/founder-ip-topic-evidence-guard-smoke.ts` 先锁定合成标签、行业一致夹具、未确认/错主体/错行业录音排除和服务端权威简报；`scripts/verify-founder-ip-topic-evidence-api.ts` 覆盖无合格证据 422、旧上下文 409、跨租户失败、重复请求以及 AgentRun/积分/Provider 调用为 0；浏览器 E2E 覆盖美业加盟、四目标切换、刷新返回和跨租户。 | 新增 FIP 选题证据服务端门禁：重新读取当前租户获客目标简报，按主体、确认状态、敏感性、资料类型、项目/行业/目标相关性筛选录音与公开证据，并把获准来源纳入幂等指纹和最终 TOP10 校验；无合格证据 fail closed。合成入口改为行业一致、持续标识、禁用 GetNote 与生成。取证确认错误 run/draft/source 均属同一隔离租户，无跨租户或跨账户泄露；后续 API 零模型回归为 AgentRun 0、积分交易 0、Provider 调用 0，桌面/390px、`qa:full` PASS。 | 已关闭 |

| QA-20260821-008 | 2026-08-21 | P1 | 兰琪统一小红书图文 / 正常终态与图片交付 | 统一页实际浏览器中，正常文案请求被返回 499；Provider fallback 时无关“直播话术”可能被当作小红书文案；成功图片区域又因受保护 URL 直接给 `<img>` 而被 ORB 阻断。 | 请求取消判定错误地把 Node 正常结束后的 `raw.destroyed` 当作用户中止；专业文案路径允许共享 fallback 内容继续解析；图片展示没有使用当前租户授权头获取二进制。 | 先在真实页面复现 499、错误内容和 ORB；`lanqi-xhs-package-contract-smoke.mjs` 增加取消判定、专业 fallback fail closed、鉴权 Blob 和下载契约断言，工作流 smoke 覆盖成功、部分失败、只重试图片、幂等、跨租户和下载。 | 取消只依据真实 `raw.aborted`，120 秒硬截止继续传播 AbortSignal；fallback 明确失败且不建图；Web 以租户鉴权 fetch 获取 Blob 后显示/下载。桌面/390px、刷新、断网、部分成功、只重试图片和新会话控制台回归 PASS；本轮付费图片调用 0。 | 已关闭 |

| QA-20260821-006 | 2026-08-21 | P1 | 创始人 IP 获客 / 内容草稿可读性 | 本机验收截图显示已保存内容草稿在桌面端几乎不可读；浏览器计算样式为浅色文字 `rgb(238, 244, 248)` 配近透明白底。 | FIP 轻色内容工作台的草稿 textarea 没有专属颜色与背景，继承了工作区外层的深色主题 textarea 回退样式。 | `verify-founder-ip-content-browser-playwright-e2e.mjs` 增加计算样式硬断言，修复前因文字色错误 FAIL；同时保留桌面、390px、四目标、刷新、返回、失败/取消、跨租户与零模型请求门禁。 | 仅为 `fip-content-editor` 增加深色文字、实色浅底与边框。修复后 Playwright 全路径 PASS，更新截图已人工确认清晰可读；`qa:fast`、`qa:regression`、`qa:full` PASS。 | 已关闭 |
| QA-20260821-007 | 2026-08-21 | P1 | 创始人 IP 获客 / AI 生成费用提示 | 选题和内容页面的真实生成按钮会调用 AI 模型，但本机验收页没有在点击前明确区分“生成会调用模型”和“查看、编辑、保存不会调用”。 | 两个工作台仅显示生成规则和按钮状态，没有面向用户的调用边界说明。 | `founder-ip-topic-workbench-smoke.mjs`、`founder-ip-content-page-acceptance-smoke.mjs` 先以缺失提示 FAIL；浏览器 E2E 再断言两处提示真实可见且全程 `model_requests=0`。 | 在 FIP 选题生成区和内容草稿区增加明确提示，不影响旧门店获客模式。两条专项与桌面/390px Playwright 全路径 PASS。 | 已关闭 |

| QA-20260821-005 | 2026-08-21 | P1 | 兰琪图片工作室 / 提示词终态、合成标签与付费动作 | 用户看到提示词长时间只有“正在增强”、合成 A/B 门店名进入可复制提示词，图片额度已用完时顶部生成和三张“重新生成”仍表现可点击且拒绝后无反馈。 | 图片预览缺少请求级状态机与晚到响应保护；合成验收档案被当作模型事实；报价只看静态执行开关而未统一检查余额/批次上限；`deepseek-v4-pro` 默认 thinking 使 4096 token 全被推理占用，`standard` 映射未显式关闭 thinking，且未启用官方 JSON Output。 | 修复前真实 Champion 81.734 秒、`finish_reason=length`、4096 reasoning tokens、硬失败；新增取消/晚到/超时/重复点击、合成标签、疗效词、额度耗尽、结构安全补齐和 Provider 参数回归。真实 Challenger 8 类×3。 | 页面 1 秒内显示阶段/耗时/取消并保留旧预览；合成名称不进提示词，“问题肌肤修复”规范为日常护理；所有付费入口共用服务端授权状态并在 3 图额度用尽时真实禁用。图片提示词保持 `deepseek-v4-pro`，改为 `standard + thinking disabled + 4096 + JSON Output`，Skill 1.0.1 补严格结构样例；真实 Challenger 24/24、硬失败 0、P50 17.118 秒、P95 20.935 秒、reasoning tokens 0、聚合文本成本约 ¥0.45；图片 Provider 任务和媒体交易仍严格为 3。 | 已关闭 |

| QA-20260821-004 | 2026-08-21 | P1 | 创始人 IP 获客 / 内容草稿租户隔离页面 | 跨租户草稿读取正确返回 404，但页面在安全错误下方仍渲染旧通用内容卡片和内容对话，可能误导用户认为其他内容可继续操作；草稿/简报恢复 effect 还因临时 headers 对象重复触发请求。 | FIP 草稿恢复失败时 `fipDraft` 为空，旧条件把它当成非 FIP 空态；effect 依赖整个 headers 对象，父组件每次渲染都会产生新引用。 | `founder-ip-content-page-acceptance-smoke.mjs` 增加 FIP 恢复/错误分支不得落入旧模块和对话区、依赖必须稳定的断言；Playwright E2E 真实触发跨租户 404 并检查页面、网络、控制台和截图。 | 以 `fipMode` 锁定 FIP 恢复/错误分支，失败时只保留安全错误与返回入口；依赖收敛到 `headers.Authorization`。桌面/390px、四目标、失败/取消/刷新/返回/重复点击/隔离全部 PASS，非预期控制台错误 0、模型请求 0；专项及 `qa:full` PASS。 | 已关闭 |

| QA-20260821-001 | 2026-08-21 | P1 | 创始人 IP 获客 / 真实 Pro 内容稳定性 | FIP 专属单请求可返回合格 2xx，但四目标各三次稳定性批测仍偶发 503 `provider_fallback_used`：产品 Prompt 精简后在学员第 3 次失败（前 8/8 成功），8192 token 对照在合作方第 3 次失败（前 11/11 成功），专属系统上下文隔离后在到店第 1 次失败（招商 3/3 成功）。 | 共享 Provider 原先丢弃 `finish_reason`、usage 和 reasoning token 元数据，并把所有异常统一折叠。补齐脱敏终态后稳定复现：`deepseek-v4-pro` 返回 `finish_reason=length`，4099 个 completion tokens 全为 reasoning tokens，最终 `content` 为空；4096 上限在 `reasoning_high` 产生正文前已耗尽。 | `fip:self-mcp-timeout-smoke` 先因缺少终态解析失败，再因仍为 4096 上限失败；合成覆盖 HTTP/timeout/cancel/invalid JSON/empty final/length/content filter/tool call/capacity 的安全分类，并锁定 FIP 阶段专属有界预算。真实脚本继续以任一 fallback、422、跨目标或租户隔离失败为硬失败。 | Provider/Agent/MCP/FIP route 仅记录安全分类、finish reason、token 计数与阶段时间，不记录正文、推理或密钥；FIP 保持 `deepseek-v4-pro + thinking enabled + reasoning_effort=high`，只把该阶段 `max_tokens` 提升为有界 16384，不重试、不降模型、不用模板。修复后同套四目标各 3 次 12/12 PASS，延迟 43.534–102.149 秒，fallback 0；13 条最终验证 trace 均为 Provider/route completed，Eval 关联 AgentRun 与积分交易均为 0。桌面/390px E2E 模型请求 0，页面、网络、控制台与租户隔离 PASS；`qa:founder-ip-acquisition`、`qa:fast`、`qa:regression`、`qa:full` PASS。 | 已关闭 |

| QA-20260820-002 | 2026-08-20 | P1 | Prisma 干净库迁移 / FIP Provider 联调前置 | 干净 PostgreSQL 库执行 `prisma migrate deploy` 在 `202607010003_distribution_rbac` 失败（P3018）：`202606270001` 已创建 enum `UserRole`，后续迁移又创建同名 RBAC 关联表。 | enum 与关联表共用 PostgreSQL 名称；Schema 模型未映射到独立物理表，两个历史生成器也保留旧表名。 | `scripts/user-role-assignment-migration-smoke.mjs` 修复前 FAIL，断言缺失 `UserRoleAssignment` 表/约束/Schema 映射、旧关联表仍创建且生成器未同步。 | 关联表、主键和两条外键改为 `UserRoleAssignment`，`model UserRole` 加 `@@map("UserRoleAssignment")`，保留 `MembershipRole @@map("UserRole")`。静态回归 PASS；重置后的 127.0.0.1:55432 隔离干净库执行 `pnpm.cmd --filter @baolu/db prisma:deploy` 完整 PASS。 | 已关闭 |

| QA-20260820-003 | 2026-08-20 | P1 | 创始人 IP 获客 / 原始 Skill 目录注册 | 隔离库可用后，从主检出区启动 database API 时，目录注册在请求模型前即报 `original_skill_not_found:baolu_ip_advisor`。 | `ensureAgentProductCatalog` 要求每个已注册 Skill 均有原始 `mcp-skills/skills/<skillId>/SKILL.md`；FIP 的 `baolu_ip_advisor` 只有 `packages/skills` 产品包资产。 | `scripts/founder-ip-baolu-advisor-smoke.ts` 补充原始 Skill 存在、ID 与不冒充边界断言，修复前 FAIL。 | 基于现有 FIP 产品包契约补齐 `mcp-skills/skills/baolu_ip_advisor/SKILL.md`；启动回归 PASS，主检出区 API 可启动并确认 Provider 配置。 | 已关闭 |
| QA-20260820-004 | 2026-08-20 | P1 | 创始人 IP 获客 / 真实 Provider 自 MCP 生成 | 隔离 API 已确认 database、MCP、deepseek-v4-pro 和 configured=true；首个 FIP 内容生成进入自 MCP 后超过预期仍无最终响应。 | 见 QA-20260820-007：FIP 路由缺少请求级硬截止与断连取消，MCP/Provider 的独立长超时不能形成端到端终态。 | `verify-founder-ip-content-live-provider-single.ts` 固定一次请求；4×3 脚本增加显式开关、ready/model 前置、超时、运行审计、最终证据/目标/CTA/差异度和跨租户断言；页面 E2E 固定桌面、390px、保存/刷新/返回及控制台网络证据。 | 网关终态、专属 Skill 路由和输出预算均已修复；真实单请求及四目标各三次 12/12、fallback 0，桌面/390px E2E 与全量门禁 PASS，未使用模板或低端模型。 | 已关闭 |

| QA-20260814-002 | 2026-08-14 | P1 | 创始人 IP 获客 / 选题到内容草稿 | 选题进入内容后，旧通用内容链路会把与当前获客目标无关的“到店”完整内容包写进草稿；超时文本也曾被当成草稿并开放投流预览。根因是最终用户页面只按最后一条 assistant 消息展示，未验证 FIP 选题、目标、人群与事实边界。回归：`scripts/founder-ip-content-draft-closure-smoke.ts`、`scripts/founder-ip-content-delivery-quality-smoke.ts` 均先失败。修复：FIP 草稿持久化、错误态、四目标 CTA 待补草稿与最终交付门禁；错题、跨目标 CTA、待验证却输出完整成品、超时均被阻断。验证：FIP 专项、`qa:fast`、`qa:regression`、`qa:full` PASS；桌面与 390px 页面保存/刷新恢复和控制台检查 PASS。 | 已关闭 |

| QA-20260814-001 | 2026-08-14 | P1 | 创始人 IP 获客 / 四源选题生成 | 用户在统一选题页点击生成后没有看到结果。除旧链路未等待交付外，最终发现用户可见消息是“从四大来源生成创始人 IP 选题”，但结果定位器只匹配“从四大来源生成选题”，使已写入会话的最终结果不回显。 | 结果定位正则与用户展示文案不一致；页面只从匹配到的用户消息之后查找结果。 | `scripts/founder-ip-topic-workbench-smoke.mjs` 新增用户展示文案与结果定位器的断言，修复前 FAIL。 | 定位器兼容“创始人 IP”间隔；桌面和 390px 页面实际点击均显示结果卡及五项字段，单来源、刷新恢复、内容入口和控制台 PASS；Web/API/Agent TypeScript PASS。 | 已关闭 |

| QA-20260813-003 | 2026-08-13 | P1 | 兰琪媒体生成 / 阿里云百炼 | 首次生图任务被百炼接受后失败，返回 `input.messages` 必填；任务结果的图片链接也不在旧的 `results[0].url` 字段。根因是接入沿用了旧图片请求和结果解析契约。回归：`scripts/lanqi-media-generation-smoke.ts` 增加图片 `messages` 请求结构及 `choices.message.content[].image` 返回解析断言。修复：请求改为百炼 `messages` 格式，结果解析兼容真实图片字段。验证：真实内部合成图第二次请求 `SUCCEEDED`、图片下载和视觉检查通过；API/Web TypeScript 检查通过。专项 smoke 受本机 esbuild `spawn EPERM` 阻断，待环境恢复后重跑。 | 待回归 |

| QA-20260813-002 | 2026-08-13 | P1 | 公共登录 / 产品授权 | 旧 `/login` 暴露经营类型并直接创建企业；邀请码无产品归属，开通会同时授权多个产品。根因是把租户类型当作产品入口、邀请码缺少 `productCode` 且授权使用固定多智能体列表；兰琪也缺少产品级 API 守卫。回归：`scripts/product-login-entry-smoke.mjs` 修复前 FAIL。修复后新增三个产品入口、内部开通页、产品邀请码、`TenantProductEntitlement` 与兰琪 API 守卫。验证：`pnpm.cmd auth:product-login-smoke`、`pnpm.cmd qa:lanqi-foundation`、`pnpm.cmd qa:full` PASS；真实浏览器桌面、390px 移动端、无效码、双击、刷新及控制台 PASS。 | 已关闭 |

| QA-20260812-014 | 2026-08-12 | P1 | IP positioning | Interview output containing multiple questions was rendered as a completed IP report. Root cause: a keyword-and-question-mark UI heuristic and a permissive interview quality bypass. Regression: `scripts/ip-positioning-workbench-smoke.mjs` (failed before fix). Verification: `node scripts/ip-positioning-workbench-smoke.mjs` PASS; `pnpm.cmd qa:full` PASS. Status: Closed. |
| QA-20260812-019 | 2026-08-12 | P1 | 品牌获客 / 选题系统 | 品牌获客任务地图把 IP 定位设为进入选题的必经步骤；资料不足的用户无法直接得到可执行选题，且选题请求没有显式收集本轮获客目标。 | 工作地图与页面入口把旧 IP 定位能力置于主流程；选题系统仅依赖资料和行业，缺少身份、目标客户与本轮获客目标的任务输入契约。 | `scripts/topic-brief-workbench-smoke.mjs` 先在旧实现失败，断言 Brief、页面传参、品牌获客地图和能力列表均不再暴露 IP 定位；`scripts/agent-work-map-smoke.ts` 覆盖新工作地图。 | `node scripts/topic-brief-workbench-smoke.mjs` PASS；`pnpm.cmd agent:work-map-smoke` PASS；`pnpm.cmd agent:smoke` PASS；前后端 typecheck PASS。完整回归与页面验收待执行。 | 待回归 |
| QA-20260812-021 | 2026-08-12 | P1 | 企业知识库 / 选题系统 | 选题页自动带入同一企业内其他资料夹的录音，运行接口随后以“资料属于其他主体”为由拒绝整次生成；普通客户无法完成选题。 | 前端未按当前资料夹筛选自动带入的录音；后端把资料夹误作为安全边界，对同一企业中用户明确选择的资料也一律拒绝。 | `scripts/topic-knowledge-selection-smoke.mjs` 先在旧实现失败，断言自动带入按当前资料夹筛选，且同企业内显式选材不被主体校验阻断。 | 修复前：`node scripts/topic-knowledge-selection-smoke.mjs` FAIL；修复后：待执行专项与完整门禁。 | 待回归 |
| QA-20260813-001 | 2026-08-13 | P1 | 创始人 IP 获客 / 问问保禄 | 四目标路由把普通“中式快餐 招商加盟 找加盟商”短输入改路由到 `fip_franchise`，绕过既有招商事实澄清；产品回归仍将能力数固定为旧值 15。 | 四目标招商正则未区分显式 Brief/目标与兼容招商内容请求。 | `scripts/agent-product-smoke.ts` 在新增能力后失败；`scripts/founder-ip-four-goal-contract-smoke.ts` 覆盖显式 Brief 路由。 | 修复为仅显式 Brief/目标进入 `fip_franchise`，普通招商短输入保留 `franchise_acquisition`；`pnpm.cmd qa:regression` PASS，`scripts/verify-founder-ip-baolu-advisor.ts` 三次硬门禁样例 PASS。 | 已关闭 |
| QA-20260813-002 | 2026-08-13 | P1 | 创始人 IP 获客 / 统一 Brief（demo） | 运行态验收中，租户 B 可以用租户 A 的主体 ID 读取 FIP Brief 接口。 | Brief 服务在 demo 分支跳过主体归属校验，只有数据库分支使用 `tenantId` 查主体。 | `scripts/verify-founder-ip-goal-briefs.ts` 修复前跨租户读取断言 404 失败（实际 200）。 | 路由在 demo 与数据库模式均先用 `findKnowledgeSubject(context, subjectId)` 校验当前租户，再由数据库服务层执行二次校验；`SITONG_API_BASE_URL=http://127.0.0.1:3012 pnpm.cmd verify:founder-ip-goal-briefs` PASS（save/update/restore/目标隔离/跨租户 404）。 | 已关闭 |

## 使用规则

- 每个确认并修复的 Bug 增加一行；不要只记录在聊天里。
- 优先先提交失败测试/Eval，再提交修复。
- 测试数据必须脱敏或合成。
- 同一根因的重复报告合并，并保留所有证据链接或文件路径。
- 状态只使用：`待复现`、`已复现`、`修复中`、`待回归`、`已关闭`、`暂缓`。
- `已关闭` 必须有自动测试或可重复人工验收证据，以及实际执行结果。

## 严重程度

| 等级 | 定义 | 放行规则 |
|---|---|---|
| P0 | 数据泄露/破坏、支付错误、严重安全问题、系统核心不可用 | 立即阻断发布 |
| P1 | 核心用户路径失败、主要 Agent 不可用、严重错误输出 | 修复并回归后放行 |
| P2 | 非核心错误或存在明确替代路径 | 记录负责人和计划 |
| P3 | 轻微 UI、文案、低频体验问题 | 可进入需求池 |

## 台账

| ID | 日期 | 等级 | 模块/环境 | 现象与复现 | 根因 | 回归测试/Eval | 验证命令与结果 | 状态 |
|---|---|---|---|---|---|---|---|---|
| QA-20260812-015 | 2026-08-12 | P1 | IP positioning | A task with no manually selected document showed 0 documents and blocked generation even when the current enterprise had confirmed auto-available knowledge. Root cause: the page only counted task-bound manual document IDs and did not pass a fallback subject ID to the run request. Regression: `scripts/ip-positioning-workbench-smoke.mjs` (failed before fix). Verification: `node scripts/ip-positioning-workbench-smoke.mjs` PASS; `pnpm.cmd --filter @baolu/web typecheck` PASS; `pnpm.cmd qa:full` PASS; production backup, build, `/ready`, `/health`, and source-marker verification PASS. | 已关闭 |
| QA-20260812-016 | 2026-08-12 | P1 | IP positioning | Generating from the knowledge drawer could send the prior/default subject instead of the subject just selected by the user, and a browser-disconnected MCP request could keep an orphaned model call alive. Root cause: the drawer relied on an asynchronous parent state update, while the internal MCP endpoint did not propagate its HTTP cancellation signal into the Agent runtime. Regression: `scripts/ip-positioning-workbench-smoke.mjs` and `scripts/mcp-request-cancellation-smoke.mjs` (new assertions failed before the repair). Verification: `node scripts/ip-positioning-workbench-smoke.mjs` PASS; `node scripts/mcp-request-cancellation-smoke.mjs` PASS; `pnpm.cmd qa:full` pending. | 修复中 |
|---|---|---|---|---|---|---|---|---|
| QA-20260812-009 | 2026-08-12 | P1 | 品牌获客智能体 / IP定位系统 | 未选择知识库资料时仍可点击“一键生成IP定位方案”，页面长期显示“正在生成”，用户不知道应先做什么也无法在模块内中止。 | 工作台只把资料数量作为提示，未作为生成前置条件；发送入口也没有对空资料做保护。 | `scripts/ip-positioning-workbench-smoke.mjs` 断言空资料点击先打开资料选择器、按钮文案明确、生成中有停止入口，且发送层再次拦截空资料。修复前 FAIL。 | 待执行。 | 待回归 |
| QA-20260812-008 | 2026-08-12 | P1 | 企业知识库 / 飞书接入 | App ID 与 Secret 可获取租户令牌时，页面就显示“已连接”；首次同步才因知识库/文档无权限失败，并仅显示笼统的“检查凭证”。 | 连接校验只验证 tenant access token；非 2xx 飞书响应丢弃了平台的错误码与原因。 | `scripts/platform-knowledge-connectors-smoke.ts` 断言无链接校验知识空间读取、指定链接校验文档读取，且 HTTP 400 转为可执行提示。修复前仅能验证令牌。 | 待执行。 | 待回归 |
| QA-20260812-009 | 2026-08-12 | P1 | 外卖智能体 / 14天每日回填与复盘 | 每日字段无法稳定定位；14天全部保存后，“生成复盘”只跳转任务卡、未实际发起复盘；复盘完成后又把原始回填整段堆入“判断依据”，未识别模拟回填和14/14完成状态。 | 字段缺少逐日稳定无障碍标识；复盘处理只调用 `onOpenCapability`，没有构建并发送 review prompt；确定性复盘兜底只截取人工补充原文，缺少回填完整度、数据性质和可比周期判断。 | `scripts/takeaway-workbench-smoke.ts` 断言字段唯一标识、结构化复盘摘要和 review 调用链；`scripts/takeaway-capability-output-smoke.ts` 覆盖14/14模拟回填，断言明确流程演练、禁止扩大投入且不再提示补齐每日回填。 | 待执行本次回归与生产验收。 | 待上线验收 |
| QA-20260812-010 | 2026-08-12 | P1 | 外卖智能体 / 新店任务地图 | 新店场景已经生成7/14/30天落地计划后，任务地图仍把下一步连到“AI找问题与路由”，使用户误以为要重新诊断。 | 新店分支与老店共用了“场景 → AI找问题”的地图边，没有按冷启动执行流拆分。 | `scripts/agent-work-map-smoke.ts` 断言“新店场景 → 单变量增长实验”且禁止“新店场景 → AI找问题”。 | 待执行本次回归与生产验收。 | 待上线验收 |
| QA-20260812-011 | 2026-08-12 | P1 | 外卖智能体 / 门店阶段与任务流 | 系统用“新店/老店”二选一和固定地图推断下一步，既不支持品牌自己的阶段定义，也可能把处于起量不达标的新店错误地直接送去执行或重新诊断。 | 门店分析路径、品牌经营阶段和任务状态没有分层；任务地图把新店分支写成单一固定箭头。 | `scripts/takeaway-workbench-smoke.ts` 覆盖品牌自定义阶段写入提示词、页面阶段/状态展示和新店“问题不明诊断 / 问题明确执行”双入口；`scripts/agent-work-map-smoke.ts` 覆盖两条新店分支。 | 待执行本次回归与生产验收。 | 待上线验收 |
| QA-20260812-007 | 2026-08-12 | P2 | 企业知识库 / CEO 驾驶舱 | 企业知识库页同时承载资料接入、资料权限和经营会诊，用户无法区分“存什么”与“由谁决策分析”。 | 资料层与决策层共用旧 `KnowledgeBasePage` 的分析组件，未在 CEO 驾驶舱提供基于同一主体、同一权限边界的会诊入口。 | `scripts/ceo-knowledge-analysis-location-smoke.mjs` 断言知识库不再渲染分析智能体/报告表单，CEO 驾驶舱渲染会诊组件并沿用受控 `/knowledge-base/analyses` 接口。 | 待执行。 | 待回归 |
| QA-20260812-006 | 2026-08-12 | P2 | 外卖智能体 / 任务结果展示 | 用户在诊断页补充调价、菜品上下架与活动调整后，新的诊断请求已携带补充信息，但结果页首先只展示未变化的原始导入图表，且没有标识哪些补充事实已被纳入判断，用户无法分辨判断是否更新。 | 补充信息只进入生成提示词，没有独立的提交快照和结果展示层；原始数据图表与更新后的判断未做证据边界分层。 | `scripts/takeaway-workbench-smoke.ts` 断言补充信息影响区、更新后的判断和原始数据图表边界存在；修复前缺少 `takeawaySupplementImpact`，专项 smoke 失败。 | `pnpm.cmd takeaway:workbench-smoke` PASS；`pnpm.cmd agent:zhenshui-pilot-smoke` PASS；`pnpm.cmd typecheck` PASS；`pnpm.cmd qa:full` PASS。 | Closed |
| QA-20260812-005 | 2026-08-12 | P1 | Enterprise knowledge base | A completed base crawl stopped after the initial candidate set, leaving the user no supported way to expand research when the total was below the 200-document cap. | Research used one fixed topic and cursor; it had no expanded query profile or user-supplied keyword batch. The cursor also advanced by the configured page size rather than the number of consumed candidates. | `scripts/enterprise-knowledge-expanded-crawl-smoke.mjs` asserts expanded mode, bounded keywords, and consumed-candidate cursor progress. It failed before the implementation because no expanded crawl controls existed. | `pnpm.cmd knowledge:expanded-crawl-smoke` PASS; `node scripts/enterprise-knowledge-industry-crawl-smoke.mjs` PASS; `pnpm.cmd qa:full` PASS. | Closed |
| QA-20260812-004 | 2026-08-12 | P1 | Enterprise knowledge base | Sync status reported 891 documents assigned to the current subject, while the asset card showed only the first 50 with no way to access the rest. | The frontend ignored the paginated API total and always requested only the default first page. | `scripts/enterprise-knowledge-pagination-smoke.mjs` asserts subject filtering, total-count rendering, a next-page request, load-more control, and the API page-size cap; it failed before the UI fix. | `pnpm.cmd knowledge:pagination-smoke` PASS; `pnpm.cmd --filter @baolu/web typecheck` PASS; `node scripts/enterprise-knowledge-industry-crawl-smoke.mjs` PASS; `pnpm.cmd knowledge:platform-connectors-smoke` PASS; `pnpm.cmd qa:full` PASS. | Closed |
| QA-20260812-003 | 2026-08-12 | P1 | 外卖智能体 / 新店起量任务页方案修订 | 用户在“修改方案”补充新店基线后，结果仍沿用旧方案的“待补”；当“100单、70单”被误填入开业日和平台上线日时，系统还把配送范围错误视为商圈已补齐。 | 方案修订没有把新店字段识别为定向基线更新；日期、配送范围和商圈没有做类型与语义校验，导致旧方案与补充信息并存。 | `scripts/zhenshui-internal-pilot-smoke.ts` 新增脱敏无效字段用例，断言订单量不能作为日期且配送范围不能替代商圈；新增有效字段用例，断言开业日、上线日、半径和商圈写回第1节，且保留未点名章节。修复前无效字段会被输出为“已提供”。 | 修复后：`pnpm.cmd agent:zhenshui-pilot-smoke` PASS；`pnpm.cmd typecheck` PASS；`pnpm.cmd qa:full` PASS。 | 已关闭 |
| QA-20260812-002 | 2026-08-12 | P1 | 外卖智能体 / 任务页“问问题、修改方案” | 新店任务中输入“开业日、平台上线日、配送半径和商圈待补，在哪里补充完整？”时，系统没有识别为字段填写入口追问，错误要求用户再指出页面对象；预算、周期、负责人等明确方案约束也可能交给模型自由理解。 | 快速对话通道只匹配“如何给/补数据”的窄句式，未识别字段名加“在哪里填/怎么录入”等表达；修改方案的明确约束未进入保留原方案的定向修订通道。 | `scripts/zhenshui-internal-pilot-smoke.ts` 新增脱敏字段位置用例，Provider 若被调用即失败，断言返回“补充本轮已知信息”、更新判断和新店基线流程；新增预算不变、7天周期、负责人用例，断言保留原方案并定向写入约束。修复前前者会调用 Provider 并失败。 | 修复后：`pnpm.cmd agent:zhenshui-pilot-smoke` PASS；`pnpm.cmd typecheck` PASS；`pnpm.cmd qa:full` PASS。 | 已关闭 |
| QA-20260812-001 | 2026-08-12 | P2 | 外卖智能体 / 任务页人机协作区 | 请求期间只显示一行“正在回复”，用户无法确认系统仍在处理；“数据是否够用”的回答为长段文本，不便快速执行。 | 外卖任务页未复用主对话的分阶段进度交互；数据可用性追问没有稳定的结构化输出契约。 | `scripts/takeaway-workbench-smoke.ts` 断言三个进度阶段、非内部推理提示和组件存在，修复前 FAIL；`scripts/zhenshui-internal-pilot-smoke.ts` 断言数据够用回答包含“结论、现在能分析、暂时不能下结论、接下来补什么”四个章节。 | 修复后：`pnpm.cmd takeaway:workbench-smoke` PASS；`pnpm.cmd agent:zhenshui-pilot-smoke` PASS；`pnpm.cmd typecheck` PASS。浏览器 E2E 待本地页面可访问后执行。 | 待回归 |
| QA-20260811-013 | 2026-08-11 | P1 | 品牌获客 / 任务地图输出 | 选题缺少来源与证据标签；内容会把皮肤管理误写成美甲且没有下一步；投流没有单变量测试和负责人；直播一键生成可能降级为简版。 | 确定性输出与质量判定没有完全对齐 WorkBuddy 样板和任务地图入口标记。 | `scripts/acquisition-workmap-output-quality-smoke.ts` 用脱敏皮肤管理主体，强制 Provider 降级，断言选题、内容、投流和直播的可交付字段；修复前 FAIL。 | `node apps/api/node_modules/tsx/dist/cli.mjs scripts/acquisition-workmap-output-quality-smoke.ts` PASS；`pnpm.cmd agent:work-map-smoke` PASS；`pnpm.cmd agent:input-smoke` PASS；`pnpm.cmd content-system:batch-smoke` PASS；`pnpm.cmd qa:regression` PASS；`pnpm.cmd qa:full` PASS，2026-08-11。 | 已关闭 |
| QA-20260811-012 | 2026-08-11 | P1 | 外卖智能体/本地工作台任务生成 | 已导入结构化经营数据后，在“老店增长 → 不知道问题在哪”生成任务，页面长时间停留在“正在生成当前任务结果”。 | 工作台已经提供固定模块、结构化数据快照、异常证据和固定输出契约，但服务端仍先等待深度模型调用，只有调用失败后才使用可控降级结果。 | `scripts/zhenshui-internal-pilot-smoke.ts` 新增脱敏工作台老店诊断用例，使用会抛错的 Provider 断言 Provider 调用次数必须为 0、保留异常证据和核验动作，并标记 `takeaway_workbench_direct`；修复前 FAIL。 | 修复前：`pnpm.cmd agent:zhenshui-pilot-smoke` FAIL（仍先调用 Provider）；修复后：`pnpm.cmd agent:zhenshui-pilot-smoke` PASS；`pnpm.cmd takeaway:workbench-smoke` PASS；`pnpm.cmd typecheck` PASS。浏览器本地验收：导入 16 份已授权文件后，老店诊断在约 6 秒内返回，不再显示“正在生成当前任务结果”，且包含老店基线、异常、核验、完成标准和下一步，2026-08-11。 | 已关闭 |
| QA-20260811-011 | 2026-08-11 | P1 | 品牌获客 / 企业知识库 | 行业抓取仅返回少量网页线索，未形成可在当前主体下持续积累的行业垂直知识库。 | 原接口只调用趋势扫描并返回临时结果，未读取正文、未写入 `KnowledgeDocument`、未保存主体级进度。 | `scripts/industry-public-knowledge-crawler-smoke.ts` 使用脱敏网页夹具验证白名单候选、正文提取、稳定来源标识和批次状态；`scripts/enterprise-knowledge-industry-crawl-smoke.mjs` 验证 200 篇上限、主体隔离和页面进度。 | `node apps/api/node_modules/tsx/dist/cli.mjs scripts/industry-public-knowledge-crawler-smoke.ts` PASS；`node scripts/enterprise-knowledge-industry-crawl-smoke.mjs` PASS；`pnpm.cmd qa:full` PASS，2026-08-11。 | 待线上回归 |
| QA-20260811-010 | 2026-08-11 | P1 | 品牌获客 / 企业知识库 | 得到大脑显示同步完成，但历史同步资料没有显示在当前主体知识资产中。 | 得到大脑的增量游标使历史资料不再返回；主体关联只写入本轮返回的资料，未回填同一连接已有资料。 | `scripts/enterprise-knowledge-industry-crawl-smoke.mjs` 断言同步会按当前租户、连接和主体限定，回填历史资料的主体关联，并显示归入数量。 | `node scripts/enterprise-knowledge-industry-crawl-smoke.mjs` PASS；前后端 typecheck PASS；`pnpm.cmd qa:full` PASS，2026-08-11。 | 待线上回归 |
| QA-20260811-009 | 2026-08-11 | P1 | 外卖智能体/新店起量任务页对话 | 在“问问题”中说明老店数据不能作为新店基线并追问“如何给你数据？”，回答复述背景后要求补充页面对象，没有说明需提交哪些新店资料。 | 确定性对话快捷通道只覆盖识别质量和数据够用性，未识别新店的数据提交意图，因而落入通用页面对象澄清兜底。 | `scripts/zhenshui-internal-pilot-smoke.ts` 新增脱敏“演示新店数据提交”用例，断言必填字段、老店数据边界和独立对话通道；修复前 FAIL。 | `pnpm.cmd agent:zhenshui-pilot-smoke` PASS；`pnpm.cmd takeaway:workbench-smoke` PASS；`pnpm.cmd typecheck` PASS，2026-08-11。 | 已关闭 |
| QA-20260811-008 | 2026-08-11 | P1 | Skill 质量门禁/本地与发布前 | 执行 `pnpm.cmd qa:full` 时，`quality:assets` 报 `takeaway-growth-advisor/contract.json` 的 `requiredSections` 为空，阻断所有发布。 | 外卖增长顾问 Skill 的样板已经定义七段输出，但质量合同遗漏了必填栏目。 | `scripts/check-skill-quality-assets.mjs` 覆盖所有生产 Skill 的非空质量合同检查；该项修复前 FAIL。 | 待执行 `pnpm.cmd qa:full`。 | 待回归 |
| QA-20260811-007 | 2026-08-11 | P1 | 品牌获客/企业知识库 | 飞书连接后仍要求逐条填写资料链接；得到大脑同步成功后资料没有归入当前主体，当前主体知识资产不显示新增内容。 | 飞书连接器仅支持单文档 URL；同步接口未接收当前 `subjectId`，入库文档没有建立主体关联。 | `scripts/platform-knowledge-connectors-smoke.ts` 覆盖飞书无链接一键读取已授权知识空间与企微授权通讯录；`scripts/enterprise-knowledge-industry-crawl-smoke.mjs` 断言同步请求、接口校验和主体归属关联；修复前飞书无链接用例 FAIL。 | 两个专项脚本 PASS；前后端 typecheck PASS；`pnpm.cmd qa:full` FAIL（既有 `takeaway-growth-advisor/contract.json` 的 `requiredSections` 为空）。 | 待回归 |
| QA-20260811-006 | 2026-08-11 | P2 | 品牌获客/企业知识库 | 点击“同步最新录音”时，飞书与企业微信按钮同时显示“同步中…”，使人误以为它们被自动同步。 | 三个来源共用了单一 `syncing` 前端状态；实际请求只发给得到大脑连接。 | `scripts/enterprise-knowledge-industry-crawl-smoke.mjs` 断言同步状态按连接 ID 独立保存，按钮不再共用 `disabled={syncing}`；修复前 FAIL。 | 回归脚本 PASS；Web typecheck PASS；`pnpm.cmd qa:fast` FAIL（既有 `takeaway-growth-advisor/contract.json` 的 `requiredSections` 为空）。 | 待回归 |
| QA-20260811-005 | 2026-08-11 | P1 | 品牌获客/企业知识库 | 在“AI 抓取的行业知识”卡片点击“补充行业与企业经验”会跳转到通用知识库页面，不能填写行业或开始公开资料抓取。 | 按钮硬编码了页面跳转，未接入已有受控行业公开线索抓取服务。 | `scripts/enterprise-knowledge-industry-crawl-smoke.mjs` 断言同页行业填写、抓取接口与受控抓取服务绑定；修复前 FAIL。 | `node scripts/enterprise-knowledge-industry-crawl-smoke.mjs` PASS；前后端 typecheck PASS；`pnpm.cmd qa:full` FAIL（既有 `takeaway-growth-advisor/contract.json` 的 `requiredSections` 为空）。 | 待回归 |
| QA-20260810-001 | 2026-08-10 | P2 | 测试契约/本地 | `pnpm.cmd qa:regression` 在 `agent:smoke` 失败；实际获客 Agent 已有 12 个能力，测试仍要求 11 个 | 新增 `ip_positioning` 后，首发能力数量和必需能力断言未同步 | `scripts/agent-product-smoke.ts` 现在要求 12 个能力并单独验证 `ip_positioning` Skill 绑定；修复前 FAIL | `pnpm.cmd qa:regression` PASS，2026-08-10 | 已关闭 |
| QA-20260811-002 | 2026-08-11 | P1 | 租户品牌/线上与本地 | 未配置企业白标时，`/my-ai` 仍显示“枕水江南”名称、Logo 字样和外卖智能体品牌 | 后端全局默认品牌被写成单一客户品牌，且 `isCustomized` 错误设为 `true`；旧缓存会继续覆盖前端正确默认值 | `scripts/tenant-branding-smoke.ts` 新增思潼默认、旧默认迁移、主动白标保留和跨智能体外显断言 | `pnpm.cmd qa:full` PASS；生产 `/api/public/tenant-branding` 返回“思潼”且 `isCustomized=false`；公网 `/api/health`、`/api/ready` 均 PASS，2026-08-11 | 已关闭 |
| QA-20260811-003 | 2026-08-11 | P1 | 获客智能体/IP定位系统 | 从IP定位系统打开经营资料库并选择资料后，底部仍显示“提炼获客选题”，提交后可能路由到选题 Skill | 共用资料抽屉把获客智能体全局 `knowledgeAction` 写死，未读取当前工作系统 | IP定位上下文增加独立动作标签、说明和 `ip_positioning` capability 锁定；选中资料 ID 随本次调用提交 | `pnpm.cmd qa:full` PASS；源码断言确认IP定位按钮、能力锁定和“不得转去生成获客选题”边界存在，2026-08-11 | 待线上回归 |
| QA-20260811-004 | 2026-08-11 | P1 | 品牌获客智能体/选题系统 | 得到大脑已同步且选题请求已携带录音资料 ID 与正文，但四大来源仍把“AI录音卡”判为“未发现/待补”，贡献为 0 | 选题确定性兜底复用了普通对话事实提取器；该提取器只保留 `用户这次补充：` 后的短指令，错误裁掉同一请求中位于标记前的 `【资料 N｜...】` 录音正文 | `scripts/verify-topic-inspiration.ts` 新增“已携带有效录音正文”用例；修复前 FAIL；`scripts/verify-production-topic-recording-e2e.mjs` 使用生产录音做端到端断言 | 回归脚本 PASS；`@baolu/agent` typecheck/build PASS；生产真实录音链路返回“AI录音卡已读取且贡献非零”，`knowledgeSources` 可回溯，2026-08-11 | 已关闭 |
| 示例-001 | YYYY-MM-DD | P1 | Agent/测试环境 | 输入、步骤、预期、实际、证据路径 | 根因，不写表面现象 | 测试文件与用例 ID；修复前 FAIL | `pnpm ...` PASS，运行日期 | 已关闭 |

> 示例行仅展示格式，不代表真实缺陷。登记首个真实 Bug 时可删除示例行。

| QA-20260814-002 | 2026-08-14 | P1 | 创始人IP获客/选题最终交付 | 四大来源中间结果已合格，但用户最终 API 收到旧表格，丢失选题/钩子、目标人群、来源依据、目标关系与下一步内容入口，并可能把禁用来源写成已读取 | 本机 demo 仍被 `.env` 的强制 MCP 配置导向旧 Skill 网关，绕过仓库当前 Agent 交付；最终边界也没有再次校验旧格式 | `scripts/founder-ip-topic-final-delivery-smoke.ts --api` 修复前 FAIL；同时保留 `scripts/founder-ip-topic-source-quality-smoke.ts` 的四单源、两组合、缺失与超时脱敏样例 | 源级和最终 API 回归各连续 3 次 PASS；租户/主体简报隔离、工作台、地图、桌面和 390px 移动端页面、控制台均 PASS。`qa:fast`、`qa:regression`、`qa:full` 被 pnpm 签名校验阻断，未跳过安全保护；等价结构、资产、Eval 和 TypeScript 检查 PASS。 | 已关闭 |

| QA-20260814-003 | 2026-08-14 | P1 | 兰琪 LQ-09 / 小红书栏目解析 | 专用 Skill 已返回“标题候选：”，但草稿标题退回用户主题，正文等栏目也存在同类风险。 | 栏目解析正则在多行标题与下一个标题的边界上不稳定，未按行识别固定栏目。 | `scripts/lanqi-content-studio-smoke.ts` 加入五段真实格式样例，修复前标题断言 FAIL。 | 改为逐行识别栏目及 Markdown 标题；专项 smoke、API TypeScript 和真实生成 PASS。 | 已关闭 |
| QA-20260814-004 | 2026-08-14 | P1 | 兰琪 LQ-09 / 小红书标签质量 | 第三个高风险真实样例只返回 3 个标签，低于质量合同要求的 5–8 个。 | 解析层只在“完全没有标签”时使用兜底，模型给出 1–4 个标签时不会补足。 | `scripts/lanqi-content-studio-smoke.ts` 增加三标签样例并要求 5–8 个；真实修复前样例 `tag_count=3`。 | 使用已确认城市/服务与安全通用标签确定性补足，最多 8 个；修复后真实样例 `tag_count=8`，诱导编造硬失败为 0。 | 已关闭 |
| QA-20260814-005 | 2026-08-14 | P2 | Agent 产品回归 / 门店获客能力清单 | LQ-09 新增专用能力后 `agent-product-smoke` 报门店获客边界缺失。 | 旧测试把能力数写死为 10，未同步验证第 11 个 `xiaohongshu_copy` 的 Skill 绑定。 | `scripts/agent-product-smoke.ts` 修复前 FAIL：`store acquisition agent boundary missing`。 | 断言升级为 11 个能力并强制 `xiaohongshu_copy -> xiaohongshu_ops`；Agent 产品回归 PASS。 | 已关闭 |
| QA-20260814-006 | 2026-08-14 | P1 | 本机产品登录 / API 路由 | `/lanqi/local?apiBase=...` 登录成功后跳转丢失 `apiBase`，内容页误连默认 3011 并显示草稿加载失败。 | `getAppPath` 只拼应用路径，没有保留已验证的本机 API 查询参数。 | `scripts/product-login-entry-smoke.mjs` 新增本机跳转保留受限 `apiBase` 断言，修复前 FAIL；浏览器复现登录后加载失败。 | `getAppPath` 只在开发环境和 localhost/127.0.0.1 下透传校验通过的本机 API；回归、Web 类型检查、真实登录与最终 `qa:full` PASS。 | 已关闭 |
| QA-20260814-007 | 2026-08-14 | P2 | 兰琪 LQ-09 / 网络失败 | API 不可达时页面直接显示浏览器英文 `Failed to fetch`，用户无法理解且不符合统一降级文案。 | 页面把所有 `Error.message` 原样展示，没有区分服务器业务错误与 fetch 的 `TypeError`。 | `scripts/lanqi-xhs-copy-contract-smoke.mjs` 新增网络错误安全文案断言，修复前 FAIL；浏览器 3999 端口复现。 | 网络 `TypeError` 统一映射为可重试中文提示，服务器 422/业务提示仍保留；浏览器失败与恢复 PASS。 | 已关闭 |
| QA-20260814-008 | 2026-08-14 | P1 | 兰琪 LQ-09 / AI 事实边界 | 真实模型会把用户要求的黄金补水、99 元、98% 疗效、1000 名案例、联系方式写成门店事实或营销承诺。 | 仅靠 Prompt 约束，解析层没有对模型结果做确定性事实与风险门禁。 | `scripts/lanqi-content-studio-smoke.ts` 加入恶意五段输出，修复前 FAIL；真实页面输出复现未确认服务声明。 | 服务端对标题、正文、标签、承接和披露统一做价格/疗效/案例/联系方式/服务事实硬门禁；最终 3 次高风险真实输出总硬失败 0。 | 已关闭 |
| QA-20260814-009 | 2026-08-14 | P1 | 兰琪 LQ-09 / 城市来源 | 门店档案未确认城市时，模型把通用租户画像的杭州写成门店所在地。 | Skill 输入使用 `context.profile.city` 作为门店城市后备，违反“仅门店已确认事实”契约。 | `scripts/lanqi-content-studio-smoke.ts` 新增禁止 profile.city 回退断言，修复前 FAIL；真实高风险样例复现“门店目前在杭州”。 | 移除通用画像城市回退，并对门店位置句按已确认城市确定性收口；专项、真实生成与 `qa:full` PASS。 | 已关闭 |
| QA-20260814-010 | 2026-08-14 | P1 | 兰琪 LQ-09 / 承接渠道 | 档案把承接渠道列为待补时，模型仍写“通过已确认的咨询方式”，暗示存在可用预约路径。 | 结果门禁只处理价格/服务，未覆盖“门店全名”和“已确认咨询方式”的语言变体。 | `scripts/lanqi-content-studio-smoke.ts` 先后加入带/不带“门店”字样的承接声明，修复前均 FAIL。 | 无已确认 `primaryChannels` 时统一改为“门店咨询与承接方式待确认”，并覆盖门店全名的服务/城市句式；最终 3 次真实输出总硬失败 0。 | 已关闭 |
| QA-20260814-011 | 2026-08-14 | P1 | 创始人 IP 获客 / 内容系统 | 招商加盟简报和选题进入通用内容链后可输出“杭州到店皮肤管理/团购”等错目标内容；FIP-04 后置门禁虽阻断写入，但用户只能拿到待补草稿。 | FIP 复用了通用 `send()` 会话历史与 `baolu_content_creator` 的通用 `content_plan` 降级；本机演示链又会返回与当前选题无关的通用内容。 | `scripts/founder-ip-content-context-isolation-smoke.ts` 在修复前因缺少 FIP 专属服务/路由失败；`scripts/founder-ip-content-target-quality-smoke.ts` 覆盖四目标各两例、同题四目标、错目标与编造硬失败；真实 4×3 Eval 与页面 E2E 覆盖最终链。 | FIP 专属入口使用空历史、专属 Agent/Skill、目标契约和最终保存门禁；真实 Pro 四目标各三次 12/12、fallback 0，桌面/390px 成功与失败路径、保存恢复、租户隔离、专项及全量门禁 PASS。 | 已关闭 |
| QA-20260814-012 | 2026-08-14 | P1 | 兰琪 LQ-10 / 文生图重复点击 | 桌面页面对同一输入连续点击两次后，历史从 1 条增至 3 条，违反幂等与未来计费安全边界。 | 前端在第一次成功后立即清空 `requestKeyRef`；第二次点击生成新键，服务端只能将其识别为新请求。 | `scripts/lanqi-image-studio-smoke.ts` 新增“成功后保留幂等键直至输入变化”断言，修复前 FAIL；真实浏览器保存数量复现。 | 只有任一输入变化才清空请求键；修复后第一次历史 +1、第二次保持不变，并显示“已恢复本次预览”。专项、浏览器与 `qa:full` PASS。 | 已关闭 |
| QA-20260814-013 | 2026-08-14 | P2 | 兰琪 LQ-10 / 独立工具入口 | 文生图直达页面可用，但兰琪已有小红书工作台没有入口，普通用户无法发现独立工具。 | LQ-10 新路由完成后未在现有兰琪工具导航加入链接。 | `scripts/lanqi-image-studio-contract-smoke.mjs` 新增小红书工作台必须包含 `/lanqi/image-studio`，修复前 FAIL。 | 小红书页新增独立“文生图”按钮，不改变 LQ-09 生成逻辑；浏览器点击正确进入文生图，专项与 `qa:full` PASS。 | 已关闭 |
| QA-20260814-014 | 2026-08-14 | P1 | 兰琪 LQ-10 / 提示词质量 | “最终提示词”把完整用户请求、禁止规则和管理式说明重复写入正向提示词，运行时还可能显示“方向 1 / 视觉方向”，无法直接用于文生图模型。 | 原零付费实现只有提示词预览字段，没有专用 enhancer 契约；确定性降级也直接引用完整请求，未分离视觉语言、负向约束、后期叠字和执行边界。 | `scripts/lanqi-image-prompt-enhancer-eval.ts` 建立 Champion 后覆盖 8 类 × 3 次、192 个评分项；`scripts/lanqi-image-studio-contract-smoke.mjs` 覆盖同页第二步禁用按钮与结构字段。修复前结构断言和页面按钮断言 FAIL。 | 新增 `lanqi-image-prompt-enhancer` 原始 Skill/运行时镜像/contract；正向提示词只保留主体、构图、场景、光线、色彩、镜头和材质，空泛方向名确定性规范化。专项、真实页面三组文本增强和 `qa:full` PASS；未进行真实成图。 | 已关闭 |
| QA-20260814-015 | 2026-08-14 | P1 | 兰琪 LQ-10 / 人物授权安全 | 输入“已获得肖像授权的美容师……不冒充顾客案例”仍被 422 拒绝为“不能模仿或冒充未经授权真人”。 | 未授权真人正则只匹配“冒充…顾客”，没有识别“不冒充、不要模仿、禁止换脸”等否定语义。 | `scripts/lanqi-image-prompt-enhancer-eval.ts` 新增“安全否定约束不能被误判”断言；真实页面修复前复现 422。 | 安全规则排除明确否定前缀，主动换脸/冒充样例仍连续 3 次 fail closed；授权美容师真实文本增强成功，`qa:fast`、`qa:full` PASS。 | 已关闭 |
| QA-20260814-016 | 2026-08-14 | P1 | 兰琪 LQ-10 / Skill 来源 | 当前 checkout 已注册新 Skill，但 demo 运行仍请求外部旧 MCP，返回 `original_skill_not_found:lanqi-image-prompt-enhancer`，页面无法完成提示词增强。 | `fetchSkillPackageFromMcp` 在演示模式仍优先外部 MCP，使当前源码的 Skill 被旧服务阴影覆盖。 | `scripts/lanqi-image-studio-smoke.ts` 与真实页面先复现外部旧包错误；`scripts/agent-product-smoke.ts` 验证能力到专用 Skill 绑定。 | demo 模式固定读取当前 checkout Skill，非 demo 保持受控 MCP；运行时镜像、Agent/Skill 注册和产品能力绑定通过专项及 `qa:full`。 | 已关闭 |
| QA-20260814-017 | 2026-08-14 | P1 | 兰琪 LQ-10 / 文本增强超时取消 | 真实文本增强超过前端 30 秒后页面先报超时，但服务端模型调用继续运行，既让用户误以为失败，也可能遗留孤儿请求。 | 文生图页面沿用通用 30 秒请求超时，API 路由没有把请求关闭信号传入 Skill/模型调用。 | `scripts/lanqi-image-studio-smoke.ts` 覆盖 240 秒超时与取消状态；`scripts/mcp-request-cancellation-smoke.mjs` 覆盖断开后取消传播。 | 前端文本增强超时调整为 240 秒并提供取消；API 把 request-close signal 传给运行时调用。真实页面长请求完成、网络失败可重试，`qa:regression`、`qa:full` PASS。 | 已关闭 |

## 无法自动化的缺陷

若暂时无法自动化，必须在“回归测试/Eval”列写明：

1. 无法自动化的具体原因。
2. 可重复的人工步骤和证据要求。
3. 计划补齐的自动化层级：单元、接口、Eval、浏览器 E2E 或监控告警。

仅写“人工验证通过”不足以关闭高风险 Bug。

### QA-20260820-001 兰琪图片任务动作路由与取消路由冲突

- 现象：首次注册 LQ-14 路由时，通用 `/:action` 与固定 `/cancel` 具有相同方法和路径形状，Fastify 拒绝启动，图片主链不可用。
- 根因：选择/保存动作直接挂在任务根路径，没有独立资源层级。
- 修复前证据：`lanqi-image-generation-workflow-smoke` 在路由注册阶段失败，报告重复路由。
- 修复：选择/保存调整为 `/lanqi/media/jobs/:jobId/assets/:action`；取消保持 `/cancel`，未知动作 404。
- 回归：LQ-14 专项连续 3 次、`qa:lanqi-foundation`、`qa:full` PASS。状态：已关闭。

### QA-20260820-002 受控模拟仍等待外部提示词模型

- 现象：零费用页面验收第一次点击提示词预览长期等待，无法进入同页图片任务。
- 根因：媒体执行虽为 `mock`，LQ-10 提示词路由仍调用外部 Skill/LLM；模拟链路没有完全隔离外部依赖。
- 修复前证据：桌面浏览器点击后超过前端等待窗口，取消后输入保留；API 无图片任务和积分流水。
- 修复：仅在非生产 `LANQI_MEDIA_EXECUTION_MODE=mock` 时使用已验收的确定性提示词降级，生产和真实模式不变；页面明确模拟不代表真实画质。
- 回归：桌面/390px 从普通需求到保存恢复 PASS；contract 强制模拟分支；提示词 Eval 192/192、硬失败 0；`qa:full` PASS。状态：已关闭。

### QA-20260820-003 图片成功回调与取消退款存在竞态

- 现象：代码审查发现，供应商成功与用户取消并发时，旧的无条件成功更新可能把已退款任务改回 `charged`；并发退款调用也可能由非所有者提前写终态。
- 根因：成功结算和退款分别无条件更新同一任务，缺少基于 `reserved` 的条件互斥与单一退款认领。
- 修复前证据：LQ-14 contract 新断言要求成功更新包含 `billingStatus=reserved + status notIn terminal`、退款 `claimed.count=0` 立即返回及孤立资产清理，旧实现 FAIL。
- 修复：成功仅能条件认领 `reserved` 且非终态任务；退款只有认领成功的事务返还；取消/退款竞态落下的资产立即按租户与任务清理。
- 回归：LQ-14 contract/smoke、租户资产隔离、三次高风险专项、`qa:fast`、`qa:regression`、`qa:full` PASS。状态：已关闭；真实三图已在后续 LQ-14 受控验收中完成。

### QA-20260820-005 兰琪专业文本在远程 MCP 路径仍被标为标准推理

- 现象：新增运行时模型策略 Eval 后，本地 Agent 映射可修为 `deep`，但远程 MCP 请求仍由 API 独立解析为 `standard`；专业小红书与图片提示词存在两条路径策略不一致。
- 根因：`packages/agent` 与 API `structured-delivery` 各自维护 reasoning 映射，旧映射都没有兰琪专业 capability/Skill。
- 修复前证据：`lanqi:runtime-model-policy-eval` 首次因模型策略服务缺失 FAIL；只读路径审计确认 API 解析器只对投流/视频复盘返回 `deep`。
- 修复：两条解析路径均将 `xiaohongshu_copy`、`image_prompt_preview`、`xiaohongshu_ops` 和 `lanqi-image-prompt-enhancer` 固定为 `deep`；API 在专业请求前校验精确 `deepseek-v4-pro`，降级结果明确标为受控草稿。
- 回归：`lanqi:runtime-model-policy-eval` 连续 3 次 PASS，覆盖本地/远程路径、Pro 拒绝低端模型及 Flash 未批准闸门；`qa:lanqi-foundation`、`qa:fast`、`qa:regression`、`qa:full` PASS。状态：已关闭。

### QA-20260820-006 图片任务缺少 Provider/prompt 版本追踪且信任客户端提示词

- 现象：媒体任务只有 model 字段，没有独立 Provider 与 promptVersion；报价/确认可直接采用客户端提交的 prompt，无法证明任务使用了本租户已确认预览。
- 根因：LQ-14 初版只绑定 `previewId`，没有在服务端恢复预览后校验正负提示词、比例和版本，也缺少审计字段。
- 修复前证据：模型策略 Eval 的 schema/route 断言在旧实现缺少对应字段与可信恢复路径。
- 修复：任务持久化 Provider、model、promptVersion；报价/确认从服务端按租户恢复 LQ-10 预览并核对关键字段，跨租户预览 404、篡改或过期输入 409。
- 回归：LQ-14 workflow smoke 连续 3 次 PASS，覆盖跨租户预览与过期/篡改 prompt；contract 覆盖任务追踪字段；桌面/390px 实际页面、`qa:lanqi-foundation`、`qa:fast`、`qa:regression`、`qa:full` PASS。状态：已关闭。

### QA-20260820-008 百炼真实图片结果域名被国内出站白名单阻断

- 现象：真实页面首个图片任务在百炼侧已经 `SUCCEEDED`，但页面刷新提示任务状态暂时不可用，任务保持处理中且租户资产未落盘。
- 根因：百炼结果地址使用 `dashscope-*.oss-accelerate.aliyuncs.com`，旧国内出站默认白名单只允许北京 OSS 域名，成功结果下载被安全边界拒绝。
- 修复前证据：`scripts/lanqi-image-studio-contract-smoke.mjs` 新增默认白名单必须包含 `oss-accelerate.aliyuncs.com` 的断言后实际 FAIL；真实页面复现安全错误，供应商任务指纹存在但资产仍待保存。
- 修复：默认 `DOMESTIC_OUTBOUND_ALLOWLIST` 最小增加 `oss-accelerate.aliyuncs.com`；隔离测试 env 只追加同一域名，未写入密钥、未改生产配置。修复后查询并恢复同一个 Provider 任务，没有创建付费重试或第四任务。
- 回归：修复后 contract、`lanqi:image-studio-smoke`、`lanqi:image-generation-workflow-smoke`、`qa:lanqi-foundation`、`qa:fast` PASS；同页真实三图、桌面/390px、刷新恢复、断网恢复、幂等、双租户隔离 PASS。共享获客 Agent 错误路由由 QA-20260821-002 关闭后，2026-08-21 原始 `qa:regression`、`qa:full` 再次运行均 PASS。状态：兰琪 Bug 已关闭；生产显式白名单与部署未执行。

### QA-20260821-003 百炼成功内容为单对象时图片 URL 未解析

- 现象：持久验收环境首张 `wan2.7-image` 任务在百炼侧已经成功，但页面刷新返回 502，任务不能进入租户资产落库；检查同一 Provider 任务发现 `output.choices[0].message.content` 为单个 `{ type, image }` 对象，而不是数组。
- 根因：媒体结果解析器只接受 `message.content[]` 数组，虽然请求和上层 `choices` 契约正确，仍把百炼合法的单对象内容误判为缺少输出。
- 修复前证据：`scripts/lanqi-media-generation-smoke.ts` 新增单对象返回样例后实际 FAIL，`outputUrl` 为 `undefined`，期望为合成图片 URL；沙箱内首次运行另因 `esbuild spawn EPERM` 失败，沙箱外同一原始命令取得上述真实断言失败。
- 修复：只在结果解析边界把单对象规范化为单元素数组，再沿用已有图片查找逻辑；不放宽内容类型、域名、租户资产或计费校验。修复后只刷新原 Provider 任务，没有创建付费重试。
- 回归：专项 smoke PASS；持久隔离环境重新完成真实三图 3/3，任务、Provider 任务和媒体交易均严格为 3，重复确认后仍为 3；桌面/390px、刷新、断网、终态取消 409、双租户列表与资产 404 均 PASS；`qa:lanqi-foundation`、`qa:fast`、`qa:regression`、`qa:full`、`git diff --check` PASS。状态：已关闭。

### QA-20260812-012 外卖增长主流程把经营阶段当分支并混淆问题验证与增长执行

- 现象：任务地图把“新店/老店”和菜单、投放、竞品作为主流程节点；新店计划或AI诊断后可直接进入单变量增长实验，缺少“验证原因是否成立、增长方案、真实执行、效果评估”四个独立阶段。AI诊断还把原因数量限制为最多3个，用户无法知道是否遗漏其他方向。
- 根因：工作地图按能力模块而非经营决策闭环组织；`takeaway_growth` 的 Prompt 与输出契约把“全面扫描范围”和“页面优先展示数量”混为同一个上限；问题验证实验和增长动作实验复用了同一任务。
- 修复：任务地图 V4 固定为“数据与经营阶段 → 数据质量 → AI经营诊断 → 问题验证 → 增长落地方案 → 真实执行与回填 → 增长效果评估 → 周期复盘与决策”。经营阶段改为诊断上下文，专业菜单/投放/竞品能力由AI按证据调用。AI经营诊断固定扫描12类原因并完整列出状态，只突出最多3个优先候选，每轮只验证1个；新增独立问题验证、执行和效果评估能力及页面入口。
- 不应发生：经营阶段不得绕过AI诊断；可能原因不得直接生成增长方案；模拟回填不得判定真实增长；“突出3个候选”不得被实现为“只扫描3个原因”。
- 回归：`scripts/agent-work-map-smoke.ts`、`scripts/takeaway-capability-output-smoke.ts`、`scripts/takeaway-workbench-smoke.ts`。
- 验证命令：`pnpm.cmd agent:work-map-smoke`、`pnpm.cmd takeaway:capability-output-smoke`、`pnpm.cmd takeaway:workbench-smoke`、`pnpm.cmd agent:smoke`、`pnpm.cmd qa:full`。

### QA-20260812-017 外卖增长首步将上传与数据可用性检查拆成两个任务

- 现象：用户上传经营文件后，还必须单独进入“数据质量门槛”并手动点击检查，才能知道数据是否可用、能分析什么和还缺什么；这与上传完成后立即核验的实际流程不一致。
- 根因：任务地图把数据导入和质量核验建成相邻节点，任务页也将质量结果隐藏在独立能力页的手动按钮后。
- 修复：任务地图 V5 合并为“数据与经营阶段”，上传后在同一页自动展示可用结论、文件质量、重复、口径风险、可判断边界与待补数据；保存经营阶段后直接进入 AI 经营诊断。
- 不应发生：任务地图不得再出现独立“数据质量门槛”节点；上传后不得要求用户手动点击质量检查；口径风险和缺失数据不得被隐藏或误写为增长结论。
- 回归：`scripts/agent-work-map-smoke.ts`、`scripts/takeaway-workbench-smoke.ts`、`scripts/takeaway-capability-output-smoke.ts`。
- 修复前证据：更新后的地图 smoke 在旧实现上断言失败，实际仍含 `takeaway_data_audit` 节点。
- 验证命令：`pnpm.cmd agent:work-map-smoke`、`pnpm.cmd takeaway:workbench-smoke`、`pnpm.cmd takeaway:capability-output-smoke`、`pnpm.cmd qa:full`。

### QA-20260812-018 AI经营诊断被拆成预览异常与二次“完整原因地图”操作

- 现象：进入 AI 经营诊断后，页面先展示少量显眼单点异常，用户还必须再点击“生成完整原因地图”才得到完整输出；单日订单低谷、单品成本偏高会被误当作优先增长原因，AI 没有体现跨平台、漏斗、时段、客单、货盘和经营动作之间的组合分析价值。
- 根因：诊断任务没有在任务入口自动发起一次完整调用；页面把数据看板里的原始异常卡与 Agent 诊断结果拆开呈现；异常检测只偏向单指标阈值，Fallback 也把所有异常直接放入优先候选。
- 修复：进入 `takeaway_growth` 即按当前数据版本自动生成一份完整诊断；补充经营变化后只需一次“更新完整诊断”。页面不再另列预览问题或要求生成完整原因地图。异常扫描新增订单与客单同步走弱、重复星期低位、同平台漏斗双断点、跨平台菜品价格差等组合信号；只有组合信号进入优先验证候选，单点异常明确标为线索。
- 不应发生：不得要求用户在 AI 诊断页重复点击两次才能看到完整结论；单日低谷或成本高不得在没有交叉证据时被写成优先增长根因；数据不足时必须明确没有形成组合证据链，而不是编造 AI 判断。
- 回归：`scripts/takeaway-workbench-smoke.ts`、`scripts/takeaway-data-dashboard-smoke.ts`、`scripts/takeaway-capability-output-smoke.ts`。
- 修复前证据：`pnpm.cmd takeaway:workbench-smoke` 报 `workbench_ux_contract_missing:进入即输出完整诊断`。
- 验证命令：`pnpm.cmd takeaway:workbench-smoke`、`pnpm.cmd takeaway:data-smoke`、`pnpm.cmd takeaway:capability-output-smoke`、`pnpm.cmd qa:full`。

### QA-20260812-019 问题验证对不同经营问题套用同一模板

- 现象：对“订单低谷”和“菜品成本偏高”点击生成本轮验证设计后，输出只有标题不同，均为笼统的验证周期、保持不变项和结论；用户不知道到哪个后台查看什么字段，也无法在完成核查后再填写结论。
- 根因：问题验证只透传候选的通用验证句，Fallback 没有按问题类型编排核查路径；页面在生成结果出现后立即展示结论表单，缺少“先现场核查、后回填结论”的交互边界。
- 修复：新增订单趋势、成本贡献、平台漏斗、投放和履约五类验证蓝图，分别输出去哪里看、必须记录、怎么比较与成立规则；将蓝图随任务上下文传给 Agent。验证结论改为完成现场核查后由负责人主动展开填写。
- 不应发生：成本问题不得使用订单低谷的同星期漏斗验证模板；订单低谷不得用成本核算替代；未完成现场核查不得暗示结论已经产生。
- 回归：`scripts/takeaway-capability-output-smoke.ts`、`scripts/takeaway-workbench-smoke.ts`。
- 验证命令：`pnpm.cmd takeaway:capability-output-smoke`、`pnpm.cmd takeaway:workbench-smoke`、`pnpm.cmd qa:full`。
# QA-20260812-004 外卖增长任务内部仍沿用旧状态机

- 现象：数据与经营阶段没有独立填写入口；AI诊断的问题不明确；原因地图把字段覆盖误写为“基本排除”；问题验证不能从候选逐项选择并登记结论；增长方案提前出现每日回填，旧模拟数据会自动带入；增长评估没有目标与实际值的结构化对比。
- 根因：任务地图已升级到八步，但 `TakeawayGrowthWorkbench` 仍复用旧五步状态与 `takeaway-daily-plan-v2` 本地草稿；诊断 fallback 又以关键词命中代替异常证据。
- 回归：`scripts/takeaway-workbench-smoke.ts`、`scripts/takeaway-capability-output-smoke.ts`。
- 修复前证据：新增回归会分别报 `total_diagnosis_semantic_rule_missing`、`workbench_ux_contract_missing`、`legacy_simulated_daily_plan_must_not_be_loaded` 或“只有字段覆盖不能写成基本排除”。
- 验证命令：`pnpm.cmd takeaway:workbench-smoke`、`pnpm.cmd takeaway:capability-output-smoke`、`pnpm.cmd agent:zhenshui-pilot-smoke`、`pnpm.cmd qa:full`。
# QA-20260812-020 品牌招商与门店获客混用同一智能体

- 现象：原“品牌获客智能体”同时面向连锁品牌招商和门店到店业务，选题、内容与投流容易输出团购、到店、消费者优惠等不属于品牌招商的内容，门店用户也没有独立工作流。
- 根因：产品定义、工作地图和通用选题 Brief 没有把“目标加盟商”和“目标消费者”作为互斥的业务边界。
- 修复：保留原 `acquisition` 路由和老客户权限，外显名称改为“品牌招商智能体”，将工作地图、Brief 和所有核心能力提示限定为招商加盟；新增独立 `store-acquisition` 门店获客智能体，提供门店选题、内容、团购到店投流与复盘流程。
- 不应发生：品牌招商智能体不得生成门店到店、团购券、消费者优惠、核销、菜品促销或门店复购方案；门店获客智能体不得生成招商加盟、加盟商招募或品牌考察方案。
- 修复前证据：`node apps/api/node_modules/tsx/dist/cli.mjs scripts/franchise-store-agent-split-smoke.ts` 断言“思潼·品牌招商智能体”失败，实际仍为“思潼·品牌获客智能体”。
- 回归：`scripts/franchise-store-agent-split-smoke.ts`、`scripts/topic-brief-workbench-smoke.mjs`、`scripts/agent-work-map-smoke.ts`、`scripts/agent-product-smoke.ts`。
- 验证命令：`pnpm.cmd qa:full`。

### QA-20260820-007 FIP 真实 DeepSeek 请求进入自 MCP 后无最终响应

- 现象：`DATA_MODE=database`、MCP 与 `deepseek-v4-pro` 均就绪时，FIP 内容生成进入自 MCP 后超过约 65 秒没有终态；调用端停止后可能留下仍在运行的 Provider 请求。
- 根因：FIP 专属路由没有拥有请求级硬截止与断连取消；MCP 客户端外层默认 420 秒、Provider 默认 180 秒，浏览器停止不能可靠终止下游。进一步实测表明 `deepseek-v4-pro` 的默认高推理模式在 2048 token 时约 56.8 秒耗尽预算但没有最终正文，4096 token 在 60 秒内无法完成，因此旧 60 秒窗口也不能容纳已批准的 `reasoning_high` 内容交付。
- 修复前证据：新增 `scripts/fip-self-mcp-timeout-smoke.ts` 后因请求执行作用域模块不存在而 FAIL；首个受控真实请求在 Provider 阶段于 60009ms 被人工窗口终止。
- 修复：FIP route → Agent runtime → MCP client → self MCP → Skill → Provider → response validation 统一使用脱敏关联 ID 与阶段计时；请求断连和 120 秒硬截止向下传播 `AbortSignal`，同一租户请求使用 single-flight 幂等且不自动重试；失败返回稳定 499/504，不写固定模板。FIP 调用显式固定 `deepseek-v4-pro`、`thinking=enabled`、`reasoning_effort=high`、`max_tokens=4096`，成功时返回并写入审计日志的实际 Provider、model 和 reasoning mode。
- 回归：`pnpm.cmd fip:self-mcp-timeout-smoke` PASS；`pnpm.cmd --filter @baolu/api typecheck` PASS；`pnpm.cmd skill:mcp-resilience-smoke` PASS；`node scripts/mcp-request-cancellation-smoke.mjs` PASS；`pnpm.cmd qa:founder-ip-acquisition` PASS。受控真实单请求在 67848ms 完成 Provider/MCP 全链并得到明确 422 终态，不再挂起或遗留孤儿；该 422 为 FIP 产品 Prompt/Skill 未逐字保留选题的新质量阻断，已交回 FIP 任务继续闭环，四目标各 3 次尚未放行。
- 状态：网关无终态/孤儿请求缺陷已关闭；FIP 产品内容质量仍为 P1 待回归，未宣称完整上线。

### QA-20260821-002 FIP 专属内容 Skill 未进入共享运行时激活集合

- 现象：共享 `agent:smoke` 期望 FIP 内容任务运行 `agent_founder_ip_acquisition / founder_ip_content_creator`，实际回退为 `agent_acquisition / baolu_content_creator`，从而阻塞兰琪 LQ-14 的全仓回归。
- 根因：共享类型、Skill manifest 和 Agent 定义已注册 `founder_ip_content_creator`，但 `packages/agent/src/index.ts` 的 `ACTIVE_BUSINESS_SKILLS` 漏掉该 ID；`routeSkill` 只接受运行时激活集合内的锁定 Skill，因此回退到通用内容 Skill。
- 修复前证据：`pnpm.cmd agent:smoke` FAIL，精确错误为“获客任务没有通过正确的 Agent/Skill 运行：agent=agent_acquisition skill=baolu_content_creator”。
- 修复：把 FIP 专属 Skill 加入运行时激活集合；回归用 `personal_ip + ip_standard` 上下文验证 FIP 两条内容路由，同时把旧门店获客 7 天计划、咖啡选题和作用域文案断言固定到 `agent_store_acquisition / baolu_content_creator`。未放宽租户产品权限，未给 Provider 失败增加模板降级。
- 回归：`pnpm.cmd agent:smoke`、`pnpm.cmd fip:self-mcp-timeout-smoke`、`pnpm.cmd skill:mcp-resilience-smoke`、`node scripts/mcp-request-cancellation-smoke.mjs`、`pnpm.cmd qa:founder-ip-acquisition`、`pnpm.cmd qa:fast`、`pnpm.cmd qa:regression`、`pnpm.cmd qa:full` 全部 PASS。
- 状态：已关闭。

### QA-20260821-011 美业行业 MCP 缺少产品级凭据与调用前耐久计费

- 现象：BY-01 已有品牌中立 adapter、3 个行业 Skill 和 24 项硬 Eval，但共享 WorkBuddy 只能按 Agent 连接；不能按 product/scopes 过滤工具，也没有到期/轮换、调用前余额预留或 product/channel/credential usage 关联。
- 根因：产品专属能力和共享 MCP/凭据/账本分属串行任务，共享 product/Agent/Skill 注册及 schema 尚未合入；旧路由若直接复用会暴露通用 `sitong.ask` 和任意 Skill 锁定入口。
- 修复前证据：新增 `scripts/beauty-industry-workbuddy-platform-smoke.ts` 后稳定 FAIL，首个红灯为 `beauty-industry product login is not registered`。
- 修复：在现有 WorkBuddy 服务器加法增加 product credential、scope 过滤、每次授权重查、一次显示 secret、撤销/轮换/限流/审计；新增耐久积分预留，在 Provider 前拒绝余额不足，成功按实际结算，失败/取消/超时释放；错误或未知 product fail-closed，禁止请求参数覆盖身份。未接支付、付费媒体或生产配置。
- 回归：共享平台 smoke、隔离 PostgreSQL JSON-RPC 协议 smoke、美业 8 类×3 Eval、迁移全量升级/幂等/回滚/再升级、`qa:fast`、`qa:regression`、`qa:full`、`git diff --check` PASS。真实 WorkBuddy/网页 E2E 交回 BY-01；生产未迁移、未部署。状态：共享底层已关闭，无 P0/P1。

### QA-20260821-012 美业产品登录落入旧诊断页且未建立产品工作区

- 现象：从 `/login/beauty-industry` 本地受控登录后进入旧的通用诊断页，无法到达品牌中立获客页面。
- 根因：产品登录映射只覆盖既有三个产品，美业路径未映射到 product login/目标路由；开发登录也没有透传 `productCode`。
- 修复前证据：`scripts/product-login-entry-smoke.mjs` 与 `scripts/beauty-industry-web-contract-smoke.mjs` 新断言在旧实现稳定 FAIL；真实浏览器复现登录后进入旧页面。
- 修复：增加美业登录和目标路由映射；本地受控登录显式携带 `productCode=beauty-industry`，服务端在同一事务授予该产品 entitlement 与 Agent access。
- 回归：两项 contract smoke、桌面/390px真实登录、刷新/返回、原始 `pnpm.cmd qa:full` PASS。状态：已关闭。

### QA-20260821-013 产品登录工作区错误保留其他产品 Agent 权限

- 现象：美业产品登录成功后，账户连接页可见 8 个 Agent，而不是仅有已购买的美业产品；存在错误创建其他产品连接的越权风险。
- 根因：开发/邀请码产品登录只做加法授予，复用了测试账号此前残留的跨产品 Agent access 和 entitlement，没有把当前产品工作区收敛到产品 Agent 集合。
- 修复前证据：真实浏览器在美业登录会话账户页看到 8 个 Agent；新增产品登录回归要求登录事务调用产品 Agent 收敛逻辑后旧实现 FAIL。
- 修复：产品登录事务在授予当前产品后调用 `restrictWorkspaceToProductAgents`，只保留该 productCode 对应 Agent access/entitlement；不改变平台管理员和非产品登录路径。
- 回归：新登录会话账户页实际只显示 1 个美业 Agent/连接；错产品、跨租户、伪造身份、scope、过期/撤销/轮换 MCP 回归 PASS；`auth:product-login-smoke`、真实 HTTP MCP E2E、原始 `pnpm.cmd qa:full` PASS。状态：已关闭。
### QA-20260822-001 美业输出出现空结果、子行业污染、截断和字段丢失

- 现象：BY-03 同一 8 案例中，选题为空；小红书虚构第一人称体验且缺 3 张配图；生活美容误分美甲；投流终稿截断；直播混入餐饮/电商带货；视频复盘丢失 3 秒留存和私信字段。
- 根因：美业选题/小红书没有受控完整性返工；通用关键词 fallback 的子行业边界过宽；直播通用节奏表含购买/核销语义；结构化解析未覆盖部分复盘字段别名；Provider 的 `finish_reason=length` 仍被当作可交付成功；完整短视频包被误路由到拍剪子能力。
- 修复前证据：`scripts/beauty-skill-output-quality-p1-smoke.ts` 在旧实现稳定产生 10 个失败断言；BY-03 真实 8 案例为 0 个可无判断直接使用。
- 修复：为美业选题/小红书增加完整交付检查和最多一次受控返工；收紧生活美容/皮肤管理子行业与事实边界；直播限定门店服务场景；复盘补齐字段别名和原始指标保留；任何输出 token 截断均失败关闭；投流持续只预览。没有接低端模型、模板降级或媒体 Provider。
- 回归：原 8 案例经当前生产最终化逻辑 8/8 PASS、硬失败 0；美业 8 类×3 policy Eval、MCP/web contract、`qa:fast`、`qa:regression`、`git diff --check` PASS。BY-03+BY-04 真实文本估算累计 ¥0.6851≤¥1；媒体调用 0。`qa:full` 留到美业 MVP 最终交付时只运行一次。
- 状态：输出质量 P1 已关闭；网页/WorkBuddy 完整 E2E 归入下一张 MVP 任务。

### QA-20260822-002 美业产品登录页加载旧共享构建名称

- 现象：真实经营工作台已显示“美业智能体”，但 `/login/beauty-industry` 仍显示“进入美业行业通用智能体”，与已确认产品名称不一致。
- 根因：`packages/shared/src/index.ts` 已更新，验收 Web 运行时仍读取未重建的 `packages/shared/dist/index.js`；旧构建产物保留历史名称。
- 修复前证据：`scripts/beauty-industry-web-contract-smoke.mjs` 增加源码/运行构建一致性断言后稳定 FAIL，实际运行构建仍为旧名称；真实浏览器复现同一文案。
- 修复：保留共享源码的“美业智能体”定义，重建 `@baolu/shared` 并重启持久验收服务；contract 同时检查源码与运行构建，防止以后只改源码未更新实际加载产物。
- 回归：美业网页 contract、产品登录 smoke、真实登录页、桌面/390px工作台、`qa:fast`、`qa:regression`、`qa:full` PASS；旧名称命中 0。状态：已关闭。

### QA-20260822-003 美业获客任务串线、下一步空转与连接入口错误

- 现象：普通美业内容需求会沿用直播复盘任务，页面展示 EDL/30 秒等无关字段并输出视频复盘；“下一步”只切换按钮而不继承结果生成；WorkBuddy 按钮跳通用 AI 分流页；断网时页面直接显示英文 `Failed to fetch`。
- 根因：网页用一套通用专业参数覆盖全部工具，当前工具会被恢复状态和自由文本污染；下一步没有 `sourceRunId` 或允许转移契约；产品缺少专属 WorkBuddy 页面；失败文案直接透传浏览器异常。
- 修复前证据：`scripts/beauty-industry-acquisition-journey-p1-smoke.mjs` 在旧实现稳定报告通用表单、获客问答工具及导航式下一步失败；用户截图复现内容需求进入复盘。
- 修复：获客首页收敛为图文、视频、直播三条锁定分支；每个工具独立 Schema；服务端校验同租户/用户/产品的来源运行与允许转移并把旧结果作为草稿上下文；增加美业专属 WorkBuddy 页；网络异常改为明确中文终态。图文真实生图、视频上传与视频 Provider 未获授权时全部 fail closed。
- 回归：三分支/参数/MCP contract、选题→内容系统真实受控生成、BY-04 8 案例零费用重放、Chrome 1440×1000 与 390×844 的刷新/断网/取消晚到/专属连接页均 PASS；控制台与非预期失败请求 0；`qa:full`、全仓 build、`git diff --check` PASS；媒体 Provider 调用 0。状态：已关闭。

### QA-20260824-001 生产数据库含有源码缺失的历史 Prisma migration

- 现象：BY-08 发布前 `prisma migrate status` 发现生产数据库已有 9 个迁移，但当前主检出区缺少对应目录；继续部署会破坏迁移历史可验证性并阻塞安全发布。
- 根因：历史源码迁移目录在后续工作树中遗漏，生产 `_prisma_migrations` 记录仍完整；不是数据库临时故障，也不能用 `resolve` 或手写 SQL 冒充修复。
- 修复前证据：生产状态明确列出 9 个 database-only migration；发布在任何迁移执行前停止。
- 修复：从受控历史源码找到 9 份原始 `migration.sql`，逐一用生产 `_prisma_migrations.checksum` 核对，9/9 完全一致后原样恢复到当前源码；没有重建、改写或标记已应用。
- 回归：恢复后生产识别完整 36 个迁移；10 个待处理迁移首次全部成功，第二次 `No pending migrations to apply`；迁移前 custom dump 可由 `pg_restore --list` 读取，既有服务发布前后健康。状态：已关闭。

### QA-20260824-002 非 `/os-v2` 子路径部署误入产品首页

- 现象：`https://api.lcppch.top/beauty-beta/login/beauty-industry` 返回 200 且 JS/CSS 均为 200，但真实 Chrome 页面进入外卖产品首页，无法显示美业邀请码登录。
- 根因：Vite 已按 `/beauty-beta/` 生成资源路径，前端路由却只硬编码剥离 `/os-v2`；新子路径的 pathname 无法匹配 `/login/beauty-industry`。
- 修复前证据：公网桌面和 390px 截图稳定复现错误首页；`beauty-industry:invite-beta-scope-smoke` 新增共享 base-path 断言后稳定 FAIL。
- 修复：新增 `getAppRoutePath`，统一根据 `import.meta.env.BASE_URL` 规范化运行时 pathname；Root 与 AppFlow 共用，不为美业复制第二套路由。
- 回归：专项从红转绿，Web typecheck、`/beauty-beta/` build、真实公网 Chrome 桌面/390px邀请码登录和工作台 PASS，控制台/资源失败 0；`qa:fast`、`qa:regression`、`qa:full` PASS。状态：已关闭。

### QA-20260824-003 后台测试积分脚本不兼容 pnpm 参数分隔符

- 现象：生产零费用 smoke 已完成邀请兑换和 entitlement，但通过 `pnpm beauty-industry:credits:grant -- --tenant-id ...` 人工发放测试积分时失败；直接 Node 调用可成功。
- 根因：CLI 参数解析器把独立的 `--` 当成需要取值的参数，提前抛出 `Missing value`；授权、积分账户与数据库均正常。
- 修复前证据：真实生产 smoke 在积分步骤稳定终止且 Provider/媒体任务仍为 0；专项新增“必须容忍 pnpm 分隔符”断言后稳定 FAIL。
- 修复：参数解析器显式跳过独立 `--`，不改变 entitlement、金额范围、grant id 幂等或账本事务。
- 回归：专项 PASS；生产以标准 pnpm 调用成功，重复 grant id 只保留 1 条流水；未调用 Provider、未创建支付订单。状态：已关闭。

### QA-20260824-007 美业选题真实终验无法在调用前保证费用硬上限

- 现象：BY-09 在已部署 180 秒超时下只调用 1 次美业选题，Provider 明确成功终态，但保守估算费用 ¥0.083468，超过用户批准的该次 ¥0.06 硬上限；按授权未调用其余 5 个工具。
- 根因：终验脚本仅用经验值 ¥0.06 做调用前预算检查，正式选题请求没有可证明的最大输出 token/费用上界；本次 completion 9192（其中 reasoning 7548）高于此前样例。另有观测脚本兼容性问题：生产旧版 `journalctl` 不接受带毫秒 ISO 时间，导致首次汇总在响应成功后报错。
- 修复前证据：安全 usage 事件为 `deepseek-v4-pro`、`finish_reason=stop`、prompt/completion/reasoning 5601/9192/7548；数据库仅 1 个 succeeded run、1 个 settled reservation、1 条 consume，临时凭据和 entitlement 均撤销、余额归零。
- 修复：新增 `beauty-text-budget-v1`，固定 `deepseek-v4-pro`、关闭无界 thinking，并为六工具设置输入字节和输出 token 上界；Web 与 self-MCP 都在 Provider started 前执行同一预检。六工具最坏批次 ¥0.999456，超限时 Provider/usage/扣费为 0；日志窗口改为 `__REALTIME_TIMESTAMP`。
- 回归：修复前历史 usage 红灯、超长请求、错误模型、单工具重复调用、Web/MCP 一致、失败释放、幂等和租户隔离均进入零费用回归；六工具各 1 次真实终验累计估算 ¥0.196888≤¥1，全部 stop/reasoning=0/settled。`qa:fast`、`qa:regression`、`qa:full`、build、`git diff --check` PASS。
- 状态：**已关闭**。真实销售输出的独立质量 P1 由 QA-20260824-006 跟踪。

### QA-20260824-006 美业销售把生活美容顾客咨询套入错误成交场景

- 现象：六工具真实终验中，美业销售 Provider 和账本成功，但输出缺少“当前判断/下一步动作”；确定性复现还会把“基础补水一次能否改善”错误套成团购退款或企业项目话术。
- 根因：`beauty_sales` 没有映射异议回复结构；fallback 依据混合系统上下文识别预约/退款和 B2B 关键词，而不是当前用户事实，公共预判段仍固定含企业预算、决策人和实施材料。
- 修复前证据：真实结果 contract flags 缺“当前判断/下一步动作”；新增 `beauty_sales_objection_contract_not_enforced` 与 B2B 污染断言后旧实现稳定 FAIL。
- 修复：按当前用户事实锁定 B2C 美业效果咨询，完整输出判断、异议、破局点、回复、预判、下一步和待核实；B2C/B2B 预判、行动和事实字段完全分支，保留疗效、价格、预约和隐私边界。修复后专项、Agent typecheck、Web/MCP contract、全量门禁 PASS并已部署，生产源码指纹一致且 `/beauty-beta/`、`/os-v2/` 均 200。
- 真实复验：只调用 `deepseek-v4-pro` 1 次，16.707 秒、prompt/completion/reasoning=2859/468/0、`finish_reason=stop`、估算 ¥0.013207≤¥0.12、预留结算 12。结果无团购/核销流程或企业预算/决策人话术；临时凭据和 entitlement 已撤销，余额归零。
- 状态：**已关闭**。

### QA-20260825-001 美业小红书受控 mock 被正式输出合同拒绝

- 现象：用户在 3017 输入脱敏需求后，固定小红书路由三次返回结构与事实校验失败；预留积分均释放，没有结果可保存。三个同指纹请求发生在前次 502 终态后，不是同一进行中窗口并发穿透。
- 根因：`beauty_xiaohongshu_package` 的受控夹具仍是旧最小结构，只含 4 个标签和三套正/负视觉提示；缺少正式合同的 `互动与承接、事实与合规待补、后期叠字、视觉参数、负向提示词、待补`，也没有充分原样保留用户场景或可直接使用文案。生产配图 parser 又只识别旧 `负向视觉提示词`，与正式字段名不一致。
- 修复前证据：`scripts/beauty-industry-xhs-controlled-contract-p1-smoke.ts` 用指纹 `2132b435a0a829a1` 首跑 FAIL，精确命中上述缺项以及 `rubric_fact_retention_weak / rubric_not_boss_usable`；`LLM_MOCK_MODE=true`，Provider/费用为 0。
- 修复：受控夹具补齐 3 标题、正文、6 标签、互动与承接、事实与合规待补和三套完整配图字段，同时明确不代表真实模型质量/客户成品；parser 接受正式负向字段并兼容旧字段；页面显示确定性 mock 边界。没有降低合同、添加模板兜底或修改 capability/scope/Skill 链。前端同步锁与服务端 requestId 幂等保留，终态后显式重试不被内容指纹误伤。
- 回归：P1 专项、受控 routing、fixed-route、8 workflow × 高风险 3 次、Web/WorkBuddy 隔离库、API/Web typecheck、桌面/390px Chrome 双击/保存/刷新/跨租户/控制台、`qa:fast`、`qa:regression`、`qa:full`（含 build）全部 PASS。浏览器只发 1 个运行 POST，数据库为 1 run/1 settled reservation/1 consume；Provider usage 0、费用 ¥0。
- 状态：受控验收缺陷已关闭；随后获批的唯一真实 `deepseek-v4-pro` 质量验证已执行并由 `rubric_fact_retention_weak` 失败关闭，新的真实质量 P1 由 QA-20260825-009 跟踪。

### QA-20260826-002 Get笔记同步长时间阻塞且无法解释进度

- 现象：连接接口约 1.131 秒成功，但同步 POST 约 53.616 秒后才返回；期间页面只有“同步中”，刷新丢失状态，无法区分 Get笔记列表/详情、350ms 节流、退避、数据库写入或大模型耗时。
- 根因：同步 HTTP 请求内串行执行最多 5 页列表与逐条详情、单请求最多 4 次退避，再逐条 upsert/主体绑定；没有持久任务、单飞约束、增量更新时间/指纹跳过和分段遥测。该路径没有模型调用，慢不是由大模型导致。
- 修复前证据：BY-19 专项首先因缺少 `KnowledgeSyncJob` 稳定 FAIL；现场仅有总耗时 53.616 秒，没有分段证据，不能进一步猜测占比。
- 修复：增加知识库域内持久同步任务、tenant+connection active partial unique、202 接收与稳定状态查询；Get笔记列表更新时间与内容指纹增量；列表/详情/节流/退避/解析/持久化/绑定分段计数；部分失败不推进 cursor，90 秒失心跳可恢复；四个 Web 入口共用轮询/刷新恢复合同。正文、凭证和原始请求不进日志。
- 回归：合成首次/无变化增量/单条变化、429、5xx、不可重试、部分失败、遥测脱敏与 20 次无变化 P95 专项，既有 Get笔记分类/凭据专项，API/Web typecheck、桌面/390px/console、`qa:fast`、`qa:regression`、`qa:full`（含 build）和 `git diff --check` PASS。真实 Get笔记请求 0、模型/媒体 Provider 0、费用 ¥0。
- 状态：零费用根因已关闭；用户已授权真实基线，但范围预检发现既有连接均为 99 文档且 CLI 凭据缺少可核验的测试账号/最多 10 条合成 note 清单，遂在外部读取前 fail-closed。实际任务 0、Get笔记网络请求 0、正文读取 0、费用 ¥0；BY-19/P1-C 继续保持业务验收。

### QA-20260826-003 美业日报详情预算集中单域导致真实来源终验覆盖不足

- 现象：BY-20 唯一真实终验按授权执行 6 个列表页与 30 个详情页，72 小时严格门禁最终只有 1 条合格候选，模型未调用。
- 根因证据：脱敏计数显示 cac/miit/caict/jiqizhixin/leiphone/tmtpost 请求分别为 `1/2/1/1/30/1`；采集器按标题美业关键词全局排序后截取 30 条，导致雷峰网候选占满详情预算。另有 caict 412 与 14 个站外 302 已正确失败关闭，但没有细分成页面可操作的来源阶段错误。
- 安全结果：总 HTTP=36，DeepSeek=0、AgentRun=0、费用 ¥0、未发布、未部署；没有通过扩域、重试、旧闻或模型常识补齐。
- 回归要求：先用六域合成列表建立每域有上限且预算可再分配的确定性红灯；覆盖单域大量候选、某域 412、站外 302、少量域无候选和总请求仍≤36。不得降低美业/AI/日期/来源合同。
- 修复前红灯：六域均有合成候选且首域含30条时，旧实现稳定得到详情 `30/0/0/0/0/0`；旧观测无法区分同域、白名单跨域、站外、循环/超限跳转，也不能把 412 归为需要人工维护的来源适配器问题。
- 修复：候选按域分桶、域内相关性/新鲜度排序并轮询；首轮每域最多5、首轮后才重分配、单域逻辑详情最多10。白名单内最多2跳并逐跳计入36次总预算，站外/循环/超限继续阻断；412 不绕过、不重试。模型前和正式输出增加至少4域、监管/研究/行业媒体组合、单域≤6及每版块≥2域的来源多样性门禁。
- 零网络回归：六域、部分空域、单域海量、同域/跨白名单/站外302、循环/超限、412/404/429/5xx、恰好36次和来源垄断均 PASS；真实 HTTP=0、Provider=0、费用¥0。
- 同日人工复验（2026-08-26）：新增一次性 grant 以 `AutomationTask.id` 创建即消费并关联旧失败日键/36 次计数，不暴露 Web/WorkBuddy 入口。实际新增 HTTP=29、同日审计累计65/72；每域 cac/miit/caict/jiqizhixin/leiphone/tmtpost=`1/2/1/1/13/11`，单域逻辑详情上限10生效，caict 412 明确归因。24h/72h 合格均0，故 DeepSeek/AgentRun/账本/费用均0、未部署。
- 新证据与根因边界：公平预算集中问题已由真实计数验证关闭，但原六域在当前列表适配与严格“72h+AI+美业+合规”合同下仍无法给出15条候选；没有证据允许把它归因于模型，也不能通过放宽事实/时效、反爬绕过或旧闻凑数解决。
- 状态：**打开（P1，归入 BY-20）**。人工 grant 已耗尽且不可重放；必须先完成真实来源适配/来源组合的零网络方案与专项门禁，再获新授权终验。正式 scheduler、导航/WorkBuddy 和生产继续 fail-closed。
## QA-20260903-001：Qwen 真实准入评测把“待确认”误判为缺失价格语义（P1，检测子范围已关闭）

- 现象：`qwen3.8-flash` 第 2 次受控低风险真实输出返回合法 JSON，`price-1.normalized` 为“待确认”，符合提示合同的“待确认或待补且禁止编造数字”，却被评测器额外的 `/价格/` 断言拒绝。
- 根因：真实 Eval 的提示合同允许简写，但后置断言又要求同一句重复出现“价格”二字，两处合同不一致；这不是 Provider、网络、JSON Schema 或模型调用失败。
- 修复前红灯：`pnpm.cmd lanqi:qwen38-flash-live-eval -- --execute` 在真实第 2 次调用后以 `The input did not match the regular expression /价格/. Input: '待确认'` 失败关闭；第 3 次未调用。
- 最小修复：删除多余的 `/价格/` 断言，继续要求“待确认/待补/未提供”且禁止任何数字；其余事实、标签、合规、格式、污染和 6 项结构门禁不变。
- 回归：`pnpm.cmd lanqi:qwen38-flash-live-eval-contract-smoke` 固化“待确认”安全样例；候选模型保持默认关闭，未使用原授权补跑。
## QA-20260903-002：兰琪经营问答缺少产品固定链而可能落入通用品牌与旧受控输出

- 现象：正式 `general_qa@0.2.0`、会话和 AgentRun 底座已存在，但兰琪产品没有经营问答 capability、薄 API、独立页面或专属 controlled fixture；若直接复用通用入口，会把通用品牌接待语和旧 fallback 带进兰琪用户路径。
- 修复前红灯：`scripts/lanqi-business-qa-smoke.ts` 首跑因缺少 `beauty_business_qa` 固定 capability、专属 fixture、API 与稳定页面路由而 FAIL。
- 根因：产品固定 route → capability → Skill → quality contract → renderer 链没有建立，不是 `general_qa` Skill 缺失，也不是 Provider 故障。
- 修复：新增美业通用核心的品牌无关输入装配和 XHS 无关的专属质量合同；兰琪 API 位于产品 entitlement 作用域，只注入当前租户 `confirmedFacts`；独立页面支持问答、追问、历史和刷新恢复。controlled mock 专属 fixture 不再落入旧模板，并明确标识非真实模型质量。
- 回归：`lanqi:business-qa-smoke` 覆盖空问题、固定映射、事实边界、顺序幂等、同键冲突、历史追问与跨租户 404；桌面/390px真实页面覆盖生成、刷新、追问和 console。外部 Provider 0、积分 0、费用 ¥0。
- 状态：**已关闭**。专项、兰琪领域门禁、`qa:fast/regression/full`（含 build）和桌面/390px真实页面全部 PASS；Provider/积分/费用均为 0。

## QA-20260910-001：思潼AI 货架「展示余额」与「按次扣费」不同源（P1，本地已关闭）

- 现象：数据库模式下 `GET /market/me` 返回用户双桶钱包余额，而 `POST /market/ppu/consume`（货架按次扣费公开接口）仍扣租户级 `CreditAccount`。同一租户会出现「页面显示有余额、按次扣费却判定不足」，或扣到了用户看不到的另一个钱包；`GET /market/skus/:skuId/access` 的访问态同样读 `CreditAccount`。
- 根因：迁移 `202609090004_sitong_wallet_double_bucket` 引入按用户的双桶 `Wallet` 后，货架只把 `/market/skus/:skuId/run`（真实生成路径）和 `/market/me` 切到新钱包，`consumeMarketplacePpu`、`accessStateFor`/`getCreditBalance` 仍留在旧 `CreditAccount`，同一模块双钱包分裂。`scripts/marketplace-db-smoke.ts` 是旧合约（播 `CreditAccount`、断言 `/market/me`），故先表现为测试失败。
- 修复前红灯（两次，均保留在脚本与本次运行记录中）：① 原脚本在 `database unified wallet starts at 300` 稳定 FAIL；② 只播种用户 `Wallet(paid=300)`、不建 `CreditAccount` 后，`/market/me` 返回 300 通过，但同一钱包的 `POST /market/ppu/consume` 返回 `insufficient_credits`，`database ppu consume completes` FAIL。另发现 `registerMarketplaceRoutes` 会按目录种子重建 SKU，测试改价必须放在路由注册之后，否则价格被种子重置。
- 最小修复：货架统一到用户双桶钱包——`getCreditBalance` 在数据库模式改读 `readWallet(context.userId)`；`consumeMarketplacePpu` 改用 `consumeWalletCredits({ requestId: "marketplace_ppu:<idempotencyKey>", skillId: sku.skuCode })`；保留租户级 `MarketplaceLedgerEntry` 幂等键与 `coming_soon` 409 前置拦截（不执行、不扣费）。未改动 billing/其它产品的 `CreditAccount` 计费。
- 回归：`pnpm.cmd marketplace:db-smoke` PASS（同源钱包 300→295、重复扣费幂等、订阅 mock-pay、owner 改价）；`pnpm.cmd marketplace:api-smoke`、`pnpm.cmd marketplace:foundation-smoke` PASS；`node scripts/marketplace-shelf-browser-e2e.mjs` PASS（货架 9 SKU / 7「开发中」/ 兰琪专区 / Word 按钮「⬇ 下载精美 Word · 10 积分」、真实模型 1 次、桌面 + 390px、console 0）；`pnpm.cmd qa:fast`、`pnpm.cmd qa:regression`、`pnpm.cmd build` PASS。
- 状态：**已关闭（本地）**。真实付款、生产迁移与生产配置未执行。

## QA-20260910-002：登录/注册回归在本机「内测免登录」实例上超时失败，被误读为登录功能故障（P2，已关闭）

- 现象：在本机 `vite dev` 默认实例（`http://127.0.0.1:5174`）上执行 `pnpm.cmd auth:login-entry-browser-smoke`，脚本以 `Error: waitFor timeout: () => window.location.pathname.split("/").filter(Boolean).pop() === "market"` 失败。报错语义指向「根路径没有落到平台首页」，容易被误判成登录/注册链路坏了。
- 根因：`apps/web/.env.development.local` 里的 `VITE_DIRECT_TEST_LOGIN=true` 会被 `vite dev` 默认加载，`main.tsx` 的 `DirectTestLoginGate` 先自动建立体验会话并把入口直达 `/lanqi/brain`，anon 未登录态在这类实例上不存在。脚本此前没有区分「干净实例」和「免登录实例」，把环境冲突暴露成了通用超时。这不是登录/注册功能缺陷（换干净实例同脚本 PASS），也不是 API 或邀请码问题。
- 修复前红灯（保留在本次运行记录中）：同一脚本在 5174 免登录实例上先以 `waitFor timeout ... === "market"` 失败；同一脚本指向 `VITE_DIRECT_TEST_LOGIN=false` 启动的 5178 干净实例时 PASS。
- 最小修复：`scripts/login-entry-browser-smoke.mjs` 增加根路径预检——进入 `/` 后若检测到自动会话或「内测实例 / 正在进入体验工作区 / 体验入口暂时打不开」文案，立即抛出明确环境错误并给出可复制的处理命令；未命中才继续原有断言。不改产品代码、不放宽任何登录断言。
- 回归：免登录实例（5174）→ 明确环境错误且非零退出（`环境错误：http://127.0.0.1:5174 是「内测免登录」实例…`）；干净实例（5178，`VITE_DIRECT_TEST_LOGIN=false`）→ `login_entry_browser_smoke:PASS root_to_home=PASS login_page=PASS signup_to_home=PASS wallet_visible=PASS session_redirect=PASS console_clean=PASS`。两条都在本地实测通过，未削弱原有正常路径覆盖。
- 状态：**已关闭**。若需要在本机跑登录/注册回归，先按脚本给出的命令用 `VITE_DIRECT_TEST_LOGIN=false` 启一个干净实例，再设 `LOGIN_SMOKE_WEB_URL` 指向它。

## QA-20260910-003：货架「免费重做 1 次」兜底缺归属/次数/额度约束（P1，本地已关闭）

- 现象：按结果付费合同要求「每个付费交付不满意可免费重做 1 次、不重复扣积分」，但实现前货架没有免费重做入口：任何一次重新生成都按次扣费；即使补上 `redoOf` 凭证，若只按 `idempotencyKey` 查账本，就会同时出现「用别人的凭证白嫖」「用重做产物的凭证无限链式免费」「跨低价内核的凭证去免费生成高价内核」和「余额被清零后连已购权益也无法重做」四类越权/计费漏洞。
- 根因：货架 `/run` 只有付费分支，扣费前一律做余额校验，没有「引用原单、限 1 次、限定归属与商品」的免费重做解析；`resolveFreeRedo` 的归属键（`tenantId`+`userId`）、跨 SKU 校验和链式回落（把重做产物的凭证回落到最初付费单计数）缺一即漏。
- 修复前红灯（保留在脚本与本次运行记录中）：临时移除 `resolveFreeRedo` 的 `tenantId`/`userId` 归属过滤后，`pnpm.cmd marketplace:free-redo-smoke` 稳定 FAIL（`FAIL: the second free redo returns the dedicated exhausted error`）——别人可用同租户凭证消耗本单免费额度；恢复归属过滤后 PASS。
- 最小修复：`apps/api/src/routes/marketplace.ts` 新增 `marketplaceRunSchema.redoOf` 与 `resolveFreeRedo`（数据库模式按 `tenantId`+`userId`+`idempotencyKey`+`refType=marketplace_run` 查账本，demo 模式 fail-closed 返回 not_found；`entry.skuId` 与原 SKU 不同返回 `sku_mismatch`；被引用订单本身是重做产物时回落到最初付费 `requestId`，保证每单仅免费 1 次）。`/run` 中 `freeRedoRoot` 存在时跳过 402 余额拦截，交付成功后调用既有 `recordRedo`（`WalletLedger` `type=redo`、`delta=0`，同 `refRequestId` 限 1 次），失败返回 409 `marketplace_redo_exhausted` 且不静默降级为扣费；免费重做写 `marketplaceLedgerEntry` `type=adjustment`、`amountCredits=0`、`metadata.freeRedoOf`，响应带 `freeRedo`/`freeRedoOf`/新 `requestId`。`packages/shared/src/index.ts` 新增 `creditsToYuan`/`formatYuanText`/`yuanLabelForCredits`，前端在积分旁统一显示人民币折算。
- 回归：`pnpm.cmd marketplace:free-redo-smoke` PASS——真实模型 0 次、Provider 费用 ¥0（模型出口指向本进程内 127.0.0.1 桩），11 组断言覆盖：付费扣一次/拿凭证 → 免费重做 0 积分余额不变并给新 `requestId` → `WalletLedger` 恰 1 条 `consume(-30)`+1 条 `redo(0)`、`MarketplaceLedgerEntry` 恰 2 条（`ppu_consume` 30、`adjustment` 0 且 `metadata.freeRedoOf`）→ 第二次重做 409 `marketplace_redo_exhausted` → 链式重做 409 → 跨账号 404 `marketplace_redo_not_found` 且对方账本为 0 → 跨 SKU 409 `marketplace_redo_sku_mismatch` → 未知凭证 404 → 余额清零后免费重做仍 200 且 `balance=0` → 余额清零后普通付费 402 → 租户隔离。
- 回归（页面）：`node scripts/marketplace-shelf-browser-e2e.mjs` PASS（干净实例 `VITE_DIRECT_TEST_LOGIN=false`）——货架「200 积分/次 · ≈ ¥10」「40 积分/次 · ≈ ¥2」、详情按钮「用一次 · 扣 200 积分（≈ ¥10）」、Word「⬇ 下载精美 Word · 10 积分（≈ ¥0.5）」、本次消耗「200 积分（≈ ¥10）」、交付完成后「😕 不满意 · 免费重做一次（不扣积分）」入口存在且可点、390px 无横向溢出、console 错误 0。`pnpm.cmd marketplace:api-smoke`、`marketplace:db-smoke`、`marketplace:foundation-smoke`、`marketplace:cost-smoke`、`pnpm.cmd qa:fast`、`pnpm.cmd qa:regression` 全 PASS。
- 状态：**已关闭（本地）**。真实付款、生产部署、价格配置化（ppu/充值档/汇率走接口 + version/effective_at + 订单记 price_version）未执行。

## QA-20260910-013：构建不复制 `apps/api/src/data/*.json`，部署后货架一直吃 dist 旧数据（P1，TEST 部署时发现，本地已关闭）

- 现象（真实部署环境，非合成）：把 PLAT-06/07 的货架目录改动发布到 `chat-test`（`/opt/baolu-os-v2-test`）后，`GET /market/skus` 仍返回旧目录——18 个 SKU 全部 `selling`、没有兰琪专区、创始人 IP 专区 7 个未完成内核没有「开发中」；无头 Chrome 打真实货架页，`开发中` 出现 0 处（断言要求 ≥7）。本地（读 `src/data`）一切正常，只有部署后复现，属于「本地通过、线上不变」的静默失败。
- 根因：`apps/api/src/services/marketplace-catalog.ts` 用 `readFileSync(new URL("../data/marketplace-v3.json", import.meta.url))` 在运行时读 JSON，而 `@baolu/api` 的 build 只有 `tsc -p tsconfig.json`；**tsc 不搬运非 TS 资源**，`dist/apps/api/src/data/marketplace-v3.json` 只能是历史残留（现场为 13:01 的 22506 B 旧文件，源码已是 23629 B），于是 API 永远读旧货架。不是文件权限、缓存或 nginx 问题，`apps/api/src/data/` 也是本次新增目录，属于「新增运行时资源但没进构建产物」这一类通用缺陷。
- 修复前证据：TEST 现场 `sha256(src)`≠`sha256(dist)`（`2eec39bd…` vs `9d3bc68f…`）；`docs/BUG_REGRESSIONS.md` 同批证据保存在部署日志 `/tmp/deploy-test.log` 与 `scripts/deployed-marketplace-browser-check.mjs` 的 `.txt` 文本快照里。本地红灯由新增探针 `pnpm.cmd api:runtime-data-check` 稳定复现（`stale_in_dist marketplace-v3.json`）。
- 最小修复：新增 `apps/api/scripts/copy-runtime-data.mjs`（构建后把 `src/data` 逐文件复制到 `dist/apps/api/src/data`；缺源目录或缺编译产物直接报错，用 `copyFileSync` 逐文件，避免 Windows 非 ASCII 路径下 `fs.cpSync` 崩 0xC0000409），并把 `apps/api` 的 `build` 改为 `tsc -p tsconfig.json && node scripts/copy-runtime-data.mjs`。不改 `marketplace-catalog.ts` 的读取方式、不改货架契约、不动其它包构建。
- 回归门禁：① 新增 `scripts/api-runtime-data-check.mjs` + `pnpm.cmd api:runtime-data-check`，比对 `apps/api/src/data` 与 `dist/apps/api/src/data` 的哈希（dist 不存在时明确 SKIP 并提示先构建）；② 接入 `qa:full`（`qa:fast && qa:regression && pnpm build && pnpm api:runtime-data-check`）——放在 build 之后，因为「dist 必须等于 src」只在刚构建完成立，放在开发中快速检查里会把「改了源码还没重建」误报成缺陷；③ 部署脚本 `scripts/deploy-credits-yuan-free-redo-test.sh` 增加两条发布期断言：src/dist JSON 哈希必须相等、`curl /market/skus` 必须含 `lanqi__lanqi-brain` 且 `coming_soon` ≥ 7（失败即自动回滚并重启旧版）。
- 回归：`pnpm.cmd --filter @baolu/api build` PASS（输出 `api_runtime_data_copied -> dist/apps/api/src/data`）、`pnpm.cmd api:runtime-data-check` PASS（`files=marketplace-v3.json`）、本地 dist 恢复为 `ip-pos=selling` + 7 个 `coming_soon` + `lanqi-brain=coming_soon`；`pnpm.cmd qa:fast`、`pnpm.cmd qa:regression`、`pnpm.cmd qa:full`（含 build 与新增探针）PASS；TEST 复部署后 `curl /market/skus` 出现 `lanqi__lanqi-brain` 与 7 个 `coming_soon`，真实浏览器 `node scripts/deployed-marketplace-browser-check.mjs` PASS。
- 复验（2026-09-10 全量发布，TEST + PROD）：发布包 `release-20260910-credits-yuan-free-redo-prod1.tar.gz`（8808083 B，sha256 `99ff9c78…6e1337`）。`chat-test`（`/opt/baolu-os-v2-test`，端口 3010）与生产（`/opt/baolu-os-v2`，端口 3002）两次部署的服务端校验均 `VERIFY_OK`：`src_data_sha = dist_data_matches_src = 2eec39bd…3752e4`（本次修复的 P1 探针）、`index_base_path` 正确（`/lanqi-test/`、`/os-v2/`）、`/market/skus` `skus_total=19` / `coming_soon=15` / `lanqi_brain_present=True`。生产修复前红灯证据保留在 `%TEMP%\deploy-check-prod-before\`（货架「全部 18」、无兰琪专区、无 `≈ ¥`），修复后同一脚本 `deployed_marketplace_browser_check:PASS`（含 `≈ ¥`、≥7 处「开发中」、详情页「免费重做」、console 0）。结论：**本缺陷确认已在本地、TEST、生产三处关闭**；生产受影响窗口为 2026-09-10 18:03 回滚后至本次发布完成之间，期间货架仍展示旧目录。
- 状态：**已关闭（本地 + TEST + PROD 全量发布复验）**。

## QA-20260910-014：兰琪「朋友圈获客」WorkBuddy 测试报告 9 条缺陷闭环（LQ-20，测试实例已复验）

- 来源：WorkBuddy《兰琪朋友圈获客测试体验报告》（2026-09-10，`stage1/final_draft.md` + `stage3/兰琪朋友圈获客测试报告.docx`），实测环境 `https://api.lcppch.top/lanqi-test/...`，共 9 条（P0×2 / P1×3 / P2×4）。
- 复核结论：**7 条成立并已修**（Bug1/2/3/6/7/8/9）；**Bug4 是呈现问题**——中文提示分支在 HEAD 就存在，但表单 `required` 让浏览器先弹原生气泡，无头浏览器看不到气泡才被记成「按钮无响应」，本回合改为页内提示；**Bug5 在当前源码已不成立**——带会话访问 `/my-ai` 正常渲染工作台（标题「思潼 AI 智能体工作台」+ 智能体卡片，0 console/page error），报告当时应是未登录或 catalog 请求失败导致的空白，未改代码。
- 共同根因：① 兰琪产品 entitlement 作用域只注册了 `/beauty-industry/*`，`/lanqi/moments|acquire` 一律 403；② 前端 `/lanqi/*` 未登记路由被全局 `AgentHomePage` 兜底成外卖产品落地页；③ 「未开通 / 无门店 / 无权限 / 接口失败」四种状态在前端被压成同一句「当前企业尚未开通此产品」，且没有 CTA。
- 修复前证据：报告内截图（`final-desktop-friend-circle.png` 按钮禁用、`m-guess-private-domain.png` 路由串产品、`final-mobile-my.png` 空白）；本机红灯为新增 `lanqi-store-gate-smoke` 的按原因分流断言（旧实现一律「尚未开通」）。
- 最小修复：
  - Bug1(P0)：`apps/api/src/server.ts` 在 `lanqi` 作用域补 `registerMomentRoutes(lanqi, "/lanqi")`、`registerAcquireRoutes(lanqi, "/lanqi")`；旧 `/beauty-industry/*` 注册保留兼容。
  - Bug2(P0)：`apps/web/src/main.tsx` 在全局兜底前登记 `/lanqi/dashboard`、`/lanqi/goal-setting`、`/lanqi/cases|customers|analysis|sales-sim|store`、`/lanqi/private-domain/moments`；`LanqiBrainShell.tsx` 8 项侧栏全部指向真实兰琪路由。
  - Bug3(P1)：`main.tsx` 对 `/lanqi/*` 前置未登录判断，`window.location.replace(getAppPath("/login/lanqi"))`（`DIRECT_TEST_LOGIN` 内测实例与 `/lanqi/local` 例外）。
  - Bug6(P2)：`LanqiBrainShell.tsx` 顶部「🔔 今日待办」由无 `onClick` 的 `<button>` 改为 `<a href="/lanqi/dashboard#today">`。
  - Bug7(P2)：`apps/api/src/services/access-guards.ts` 的 403 增加 `code`（`product_entitlement_missing|inactive|expired|required`，保留 `error` 兼容）；`apps/web/src/lib/lanqi-store-gate.ts` 按 `code` 产出 4 类不同文案。
  - Bug8/9(P2)：新增共享 `apps/web/src/lib/use-lanqi-store-gate.ts` + `apps/web/src/components/lanqi-brain/LanqiStoreGateBanner.tsx`，紧贴生成按钮上方渲染「状态 + 原因 + CTA」（`.lq-gate__reason`，带 `data-lanqi-gate` / `data-lanqi-gate-reason` 钩子），空门店给出「去完善门店档案 / 门店后台」CTA，禁用原因不再是空白。
  - Bug4(P1)：`apps/web/src/pages/LoginPage.tsx` 产品邀请码表单加 `noValidate`，空值走既有中文提示分支。
- 回归测试：新增 `scripts/lanqi-store-gate-smoke.ts`（44 条，锁 Bug7/8/9 契约，含 4 类 403 文案分流、空门店 CTA、网络失败可重试、新旧字段兼容）；`scripts/lanqi-page-check.mjs` 增加 `--token`（预置会话）与 `--click-text`（点击后取最终快照）用于真实浏览器复验；接入 `qa:lanqi-foundation`。
- 验证命令与结果（2026-09-10 本机）：`pnpm.cmd lanqi:store-gate-smoke` → 44 passed / 0 failed；`pnpm.cmd lanqi:moments-smoke` → 47/20/9，0 failed；`pnpm.cmd lanqi:store-access-smoke` → 14/0；`pnpm.cmd lanqi:dashboard-smoke` → 规则 60/0 + API smoke PASS；`pnpm.cmd -r typecheck` → 7/7 PASS；`pnpm.cmd qa:fast`、`pnpm.cmd qa:lanqi-foundation`、`pnpm.cmd qa:full`（含 `qa:regression` + web/api `build` + `api-runtime-data-check:PASS`，`QAFULL_EXIT=0`）全部 PASS；`git diff --check` 退出码 0（仅 Windows LF→CRLF 提示）。
- 浏览器复验（真实 Chromium + 本机 dev token，非合成）：`/lanqi/dashboard` 渲染兰琪经营驾驶舱（9 维雷达、今日指标、今日待办）；`/lanqi/moments/friend-circle`、`/lanqi/moments/wechat-group` 表单可提交，无门店时显示原因与 CTA，console 0 / page error 0；`/my-ai` 正常渲染工作台；关闭免登录的实例上匿名访问 `/lanqi/moments`、`/lanqi/dashboard` 直接落到 `/login/lanqi`；`/login/lanqi` 空邀请码点击「继续进入兰琪美业」→ 页内出现「请输入邀请消息中的邀请码。」（修复前此点击只触发不可见的原生气泡）。
- 测试实例复验（2026-09-10，`https://api.lcppch.top/lanqi-test`，构建时间 17:56）：新增可复跑验收脚本 `scripts/lanqi-test-instance-acceptance.mjs`（`pnpm.cmd lanqi:test-instance-acceptance`），同一组 14 项断言连续 3 轮 **14/14 PASS**。直接覆盖本卡缺陷的断言：Bug1——`/lanqi/moments/friend-circle` 无 `data-lanqi-gate` 阻断（`gates=[]`），填入 30 字原话后「生成朋友圈文案」`disabled=false`（报告原场景是「填好表单但按钮禁用」）；Bug2——驾驶舱/目标页/朋友圈/微信群/`/my-ai` 全部不出现「枕水江南」且侧栏为兰琪 8 项；Bug5——`/my-ai` 渲染「思潼 AI 智能体工作台 / 已开通产品 兰琪 AI / 进入兰琪 AI」，0 console/page error；Bug7/8/9——朋友圈页面无「未开通 / 无门店 / 未停用」红字阻断，`gates=[]`。接口层实测 `/lanqi/dashboard?month=2026-09` 21ms、`/lanqi/stores` 17–34ms，页面首屏 4–7 秒来自静态资源串行加载，不是接口 403 或超时。
- 不能在免登录实例上复验的两条（测试实例 `DIRECT_TEST_LOGIN=true`，`/lanqi/*` 免登录直达、`/login/lanqi` 直接跳驾驶舱）：Bug3 与 Bug4 改在本机非免登录实例（5178，`VITE_DIRECT_TEST_LOGIN=false`）复验——匿名访问 `/lanqi/dashboard`、`/lanqi/moments/friend-circle`、`/lanqi/goal-setting` 全部落到 `/login/lanqi` 且不渲染功能表单；`/login/lanqi` 空邀请码点「继续进入兰琪美业」出现页内「请输入邀请消息中的邀请码。」，均 0 console/page error。
- 状态：**已关闭（测试实例已复验）**。Bug5 记为「当前源码不成立（环境相关）」；生产 `os-v2` 未部署，本卡只主张测试实例已修复。

## QA-20260910-015：发布脚本固定 6 秒健康检查窗口，把「启动慢」误判成「发布失败」并触发自动回滚（P2，部署工具，本地已关闭）

- 现象（真实生产发布，2026-09-10）：首次执行生产全量发布时，第 9 步 `systemctl restart` 后用 `sleep 6` 加单次 `curl` 判定健康，得到 `connection refused`（health=000），脚本按设计自动回滚。但服务本身启动成功——`journalctl` 显示 `18:03:40` 开始启动、`18:03:53 Server listening at http://0.0.0.0:3002`，即生产冷启动（`pnpm --filter @baolu/api start` 经 pnpm 包一层再拉起 node）约需 12 秒，超过 6 秒窗口。
- 连带影响（比现象本身更严重）：本次自动回滚只还原代码，**不回滚数据库**——回滚前第 8 步已成功应用 `202609090005_lanqi_moments`、`202609100001_lanqi_store_goals` 两条迁移。回滚后一度出现「DB schema 领先于运行代码」的窗口；同时新增文件（`apps/api/src/data/marketplace-v3.json` 等）被 `new-files.txt` 逻辑删除，P1 修复在生产上短暂失效（货架仍是旧目录，服务 `/health`、`/ready`、`/os-v2/` 均 200，用户侧无中断）。
- 根因：发布脚本把「进程尚未完成冷启动」等同于「发布失败」。固定睡眠不适用于经 pnpm 包装的启动路径，且单次 curl 没有重试；`restart` 后的 `systemctl is-active` 在 node 退出前也可能瞬时为 active，不能替代端口探测。
- 修复前证据：`/tmp/deploy-prod-full.out` 第 9 步 `health=000` → `ROLLBACK_DONE`；同文件第 8 步 `All migrations have been successfully applied.`；`journalctl -u baolu-os-v2` 记录 `Server listening` 于 18:03:53。
- 最小修复：`scripts/tmp/deploy-release.sh`（发布工具，不入发布包）新增 `wait_http_ok` 轮询函数——health 最多 40 次 × 3 秒（120 秒）、ready 最多 20 次 × 3 秒，两者都拿到 200 才算成功；健康检查失败时先输出 `journalctl -n 60` 尾部再失败，便于区分「启动慢」与「真启动失败」；回滚路径同样改为轮询。另加 `BACKUP_TAG` 环境变量，允许重跑时使用独立备份目录，避免覆盖上一轮可用于回滚的备份。
- 回归：改用轮询后重跑生产发布，第 9 步输出 `health=200 (after 12s)` / `ready=200 (after 0s)` → `DEPLOY_OK`，不再误判回滚；`verify-deploy.sh` 全 PASS；数据库确认两条迁移已应用（`_prisma_migrations` 含 `202609100001_lanqi_store_goals`、`202609090005_lanqi_moments`），`LanqiMomentDraft`、`LanqiStoreGoal` 表存在。
- 状态：**已关闭**。发布脚本目前仍是 `scripts/tmp/` 下的临时工具（AGENTS 规定该目录不随发布包），若要长期使用应先补「基于端口就绪」的断言并落成仓库正式脚本。
