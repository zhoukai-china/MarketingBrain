# 当前部署状态

更新时间：2026-09-10（最近一次为兰琪 LQ-18 收口生产发布；下方 2026-08-03 清单保留为当时状态）

## 最新发布：20260910-lanqi-lq18-closeout-prod1（2026-09-10，生产）

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
