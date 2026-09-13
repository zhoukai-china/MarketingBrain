# 当前部署状态
> **明日待办（2026-09-13 关机交接）**：`release-20260913-lq27-nav-online`（侧栏「公域获客」摘掉「开发中」徽标 + 八板块总览/说明同步 + 品牌导航契约/浏览器 E2E 更新）已在测试实例 `DEPLOY_OK`（health 200）；**生产 `-prod1` 尚未部署**，明天先 `bash /tmp/deploy-release-lq27f.sh 20260913-lq27-nav-online-prod1 /opt/releases/release-20260913-lq27-nav-online.tar.gz /opt/baolu-os-v2 baolu-os-v2 /etc/baolu-secrets/baolu-os-v2.env 3002 /os-v2/`，随后跑 `node scripts/lanqi-brand-nav-browser-e2e.mjs` 验收。另外：其他任务在途 `apps/web/src/marketplace/livescript-full-case.ts`（重复定义 + 语法错误）当前会让 `qa:fast` 的 web 步骤失败，属既有失败，本任务改用「HEAD 快照 + 本任务文件 + 已上线 marketplace-v3.json(1dd5b672…)」的干净发布包规避。
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
