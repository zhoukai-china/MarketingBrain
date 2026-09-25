# 发版记录 · 后端 3002（文案十件套规则9移除）

- **发版时间**：2026-09-25 00:30 (GMT+8)
- **目标服务**：`baolu-os-v2.service`（生产 3002，`root@api.lcppch.top`）
- **部署来源**：本地工作区未提交改动（基于 origin/main `5ca3cb0`），非 git tag
- **操作人**：自动部署（zhoukai 触发）

## 一、本次改动内容
移除文案十件套（`秦文·金牌文案主笔` `copy` 能力核）后置校验中的**规则9「违禁词扫描」**分支。

- 原 `parseCopyTenContract` 用 `/(唯一|保证|100%|根治|彻底|永久)/` 等子串硬匹配，会误杀正常表达（如"保证画面通透""保证信息干净"），导致整单 422 不扣积分。
- 删除后，违禁词合规完全由 prompt 红线（`COPY_TEN_SYSTEM_PROMPT` 中"禁忌/严禁行豁免"指引）自律兜底。
- 详见 `apps/api/src/products/beauty-industry/copy-ten-contract.ts`：移除 `scanText` 预处理 + 引导类/绝对化/承诺类三行 `if` 拦截。

## 二、改动文件（仅后端，前端未动）
| 文件 | 类型 | 说明 |
|---|---|---|
| `apps/api/src/products/beauty-industry/copy-ten-contract.ts` | 修改 | 删除规则9校验分支 |
| `apps/api/package.json` | 修改 | `scripts` 增加 `"test": "tsx scripts/copy-ten-contract.test.ts"` |
| `apps/api/scripts/copy-ten-contract.test.ts` | 新增 | 纯 mock 回归测试，直接 import 真实校验器 |

构建方式：`pnpm --filter @baolu/api build` → tsc 编译到 `dist/apps/api/src/...`（dist 运行产物，非 tsx 热重载）。

## 三、线上备份（替换前已做，带 20260925 时间戳）
| 备份文件 | 原文件 |
|---|---|
| `/opt/baolu-os-v2/apps/api/src/products/beauty-industry/copy-ten-contract.ts.20260925bak` | 源码（旧，含规则9） |
| `/opt/baolu-os-v2/apps/api/dist/apps/api/src/products/beauty-industry/copy-ten-contract.js.20260925bak` | 编译产物（旧） |
| `/opt/baolu-os-v2/apps/api/package.json.20260925bak` | 旧 package.json |

回滚方式：将以上 `.bak` 还原为原名，重新 `pnpm --filter @baolu/api build` 并 `systemctl restart baolu-os-v2.service`。

## 四、动过的服务器目录
- `/opt/baolu-os-v2/apps/api/src/products/beauty-industry/`（源码替换 + 备份）
- `/opt/baolu-os-v2/apps/api/dist/`（重新构建）
- `/opt/baolu-os-v2/apps/api/package.json` + `/opt/baolu-os-v2/apps/api/scripts/`（替换/新增 + 备份）
- 服务 `baolu-os-v2.service` 重启（仅 3002；test 3010 / beauty-industry-beta 未重启，仍跑旧内存代码，下次各自重启后才会吃到新 dist）

## 五、验证结果
- ✅ `pnpm --filter @baolu/api build` 成功（dist mtime 00:30:14）
- ✅ `systemctl is-active baolu-os-v2.service` = active，`:3002` 监听（新 PID 2263318），日志 `Server listening at http://0.0.0.0:3002`
- ✅ dist 编译产物已无规则9（`grep` 验证为空）
- ✅ 服务器 `cd /opt/baolu-os-v2/apps/api && pnpm test` 全部断言通过（含正常"保证"用法不再误杀、故意违规样本不再拦截）

## 六、残留风险 / 待办（非本次阻塞）
1. **违禁词校验（原规则9三类）经用户决策改为"prompt 语义化约束"而非程序子串拦截**：00:43 二次调整已落地——①引导类（私信/加微信/电话留资）、③承诺类（包回本/稳赚/零风险）改成语义化表述留在 `COPY_TEN_SYSTEM_PROMPT`；②绝对化（唯一/保证/100%/根治/彻底/永久）词表从 prompt 也一并移除（用户判定"没语义、会误杀"）。程序校验层面三类均不再拦截，符合预期。
2. **规则7/8（访谈≥5组 / 投流本地推-DOU+）**：仍因 `copy-ten-contract.ts` 取值 `?.[1]` bug 实际未触发，与历史截图报错（口播字数/话题三词）一致；本次未改，待后续单独处理。
3. 本地工作区 `apps/api` 两处改动 + `scripts/` 测试尚未 git commit；前端改动（AgentChatPage/EcoMallHomePage/chat-flows/eco-mall-data/lib/api）本次未发，仍在工作区。

## 七、二次调整（2026-09-25 00:43）
用户在核对发版时发现：规则9 原为「引导类 + 绝对化 + 承诺类」三个子串检查，首次部署被整块删除，导致 ①引导类 也被移除。经确认，用户意图为：
- **②绝对化（唯一/保证/100%/…）**：子串匹配"没语义、会误杀正常表达（如'保证画面通透'）"，**彻底移除**（程序与 prompt 词表都不再拦）。
- **①引导类、③承诺类**：语义是明确的真实违规，不恢复子串程序校验，改为**写入 prompt 做语义化约束**，让模型靠理解规避。

改动（仅 `COPY_TEN_SYSTEM_PROMPT` 文案，无程序逻辑改动）：
- 第32行：删"绝对化用语"，保留并语义化"诱导用户离开平台私下交易或留资，如私信/加微信/留电话"。
- 第38行：拆为两句语义化约束——"严禁引导用户离开平台私下交易或留资（如私信/加微信/电话/…）"；"严禁做收益与回本承诺（如包回本/稳赚/月入过万/零风险/躺赚）"，**移除绝对化词表**。
- 新增备份：`copy-ten-contract.ts.20260925bak2` / `copy-ten-contract.js.20260925bak2`（本次调整前服务器状态，可作回滚点）。
- 重建 dist（mtime 00:43、新 PID 2264313）+ 重启 3002 + `pnpm test` 通过。
