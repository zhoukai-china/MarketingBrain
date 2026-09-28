# IP 定位工作台 · 开发问题记录

> 页面：`http://localhost:5174/agent/ipzone__ip-pos/workbench`
> 主文件：`apps/web/src/marketplace/IpPosWorkbench.tsx` + `apps/web/src/styles/ip-pos-workbench.css`
> 维护：2026-09-27 整理（涵盖改价、走马灯、计费承诺、体验红线等）
> 说明：本记录只针对 **workbench 这一个页面** 开发过程中真实踩到 / 拍板的问题，不含详情页 `IpPosDetailPage`（另行记录）。

## 0. 页面构成（便于定位问题归属）

| 区块 | 说明 |
|---|---|
| Topbar | 商城共用顶栏，余额走 `fetchMarketMe`；整页包 `<main className="app-wrap">` 提供两侧留白 |
| 左栏 | 真实对话（`MarketplaceAgentChatPage` workbench 模式），6 步访谈回答实时回抛右侧简报 |
| 右栏上 | 定位简报（6 字段可点改）+ 生成按钮 + 费用行 + 「🏅 失败不扣费」徽标 |
| 右栏下 | 全案画布，**三态切换**：`idle/error` 静态占位 → `generating` 走马灯 → `done` 报告 |

## 1. 问题总览

| # | 问题 | 状态 | 关键约束 |
|---|---|---|---|
| 1 | 价格口径 400 积分 → 99 算力，单位不统一 | 已解决 | 三处价格真源必须同改 |
| 2 | 生成前体检「补一项、其余追问消失」 | 已解决 | 按槽位精确勾销，不整份作废 |
| 3 | 生成中无「依次点亮」视觉 | 已解决（B 方案走马灯） | 结果返回才切报告 |
| 4 | 固定价 SKU 计费承诺/确认卡误导 | 已解决 | ip-pos 不按消耗结算 |
| 5 | 虚拟人头像来源 | 已解决 | 统一 `employeeAvatarPath` |
| 6 | 商城页通用红线（Topbar/app-wrap/reset/h1） | 约定 | 不可踩 |
| 7 | 交付结构 8 章 vs 6 字段口径 | 已拍板 | 统一 6 字段 |

---

## 1. 价格与计费口径（400 积分 → 99 算力）

**现象 / 需求**
- 原型要求「99 算力/次」，原工作台显示「400 积分」；且全站余额单位是「积分」，ip-pos 交付链路单位要「算力」，两套单位不能混。

**根因**
- 价格散落在三处真源，未对齐：发布文件 `marketplace-v3.json`、服务端价目表 `billing-consume.ts`、SKU 种子 `marketplace-catalog.ts`、前端文案多处硬编码。
- 任一处漏改都会回归漂移。

**解法**
- 后端三源 `ppu` 统一改为 `99`（`marketplace-v3.json` 的 `skills["ip-pos"].ppu` 是唯一落库真源）。
- 前端 `apps/web/src/marketplace/sku-model.ts` 新增单一常量 `IP_POS_PRICE=99` / `IP_POS_UNIT="算力"`，工作台所有文案引用常量、不写死数字。
- 生成按钮、费用行（含「本次交付」态）、生成中/占位 tag、交付头、hero ability 文案、版本 chip、注释全部 400→99 算力。
- 导出 Word 标注**免费**（导出不扣积分、前端不展示价格，无 402 分支）。
- 验收脚本锁一致性，防回归。

**涉及文件**
- `apps/api/src/data/marketplace-v3.json`、`apps/api/src/routes/billing-consume.ts`、`apps/api/src/services/marketplace-catalog.ts`、`apps/web/src/marketplace/sku-model.ts`、`apps/web/src/marketplace/IpPosWorkbench.tsx`、`apps/web/src/styles/ip-pos-workbench.css`

**验收**：`pnpm billing:cost-model-smoke`（ipPosCurrentPpu:99）、`pnpm marketplace:api-smoke`（余额 1000−99=901）、全包 `pnpm typecheck`、无头 `qa-ip-pos/price-99-20260927/verify.cjs` 9 断言 ALL PASS。

---

## 2. 生成前体检「补一项、其余追问消失」

**现象**
- 用户反馈：在简报里填充第一个字段，体检追问卡的其余提示就全消失了。

**根因**
- 原先任何一次编辑都 `setReview(null)` 把整份体检结论作废，导致补一项就看不到其余。

**解法**
- 新增 `resolved` 数组，按**槽位精确勾销**：只划掉用户刚补的那一条（标「✓ 已补充」留在卡里可回看），其余继续提示。
- 再点生成会重新体检，仍不达标的条目重新出现，不漏。

**涉及**：`IpPosWorkbench.tsx` 的 `markResolved` / `resolved` 状态。

---

## 3. 生成中「依次点亮」视觉（走马灯 B 方案）

**现象 / 需求**
- 9 格交付结构原本是**静态占位**：生成中只显示 3 行写死的 `genlog`（「→ 读取简报 / → 加载方法论 / ✓ 全案生成中」），没有任何逐格点亮。用户问「这里是依次点亮的逻辑吗」→ 确认**不是**。
- 用户拍板：**B 方案**（前端走马灯，纯视觉），并强调「自己控制好时间，等结果都返回了、点亮最后，才展示结果」。

**根因**
- `generating` 分支整块渲染 `genlog`，没有 `litCount` 状态机，CSS 也无逐格动画（`.ph` 只有 `transition`）。

**解法**
- 新增 `litCount` 状态 + `litTimer` ref；进入 `gen==="generating"` 时 `setLitCount(0)` 并按 **2.2s/格** 递增（9 格≈20s 全亮，远小于后端≈50s 真实返回）。
- `generating` 渲染分支由旧 `genlog` 改为 `.ph-grid` 走马灯：已点亮 `.ph.lit`（橙边 + 轻浮起 + `ipwPop` 动画）、未点亮 `.ph.dim`（置灰）。
- **关键约束**：走马灯纯视觉、与后端解耦；只有 `POST /run` 真实 resolve 才 `setGen("done")`。即便后端极快返回、自然走马灯未点满，成功分支也会先 `setLitCount(PIECES.length)` 把最后一格顶亮、再切报告——保证「全亮与结果同步出现」，绝不提前展示。

**涉及**：`IpPosWorkbench.tsx`（`litCount`/`litTimer`、generating 渲染分支、成功顶满）、`ip-pos-workbench.css`（`.ph.dim`/`.ph.lit`）。

**验收**：无头 `qa-ip-pos/lit-20260927/verify.cjs` 7 断言 ALL PASS——生成中 4.5s 采样 `dim=7 / lit=2`、无报告；结果返回后 `.dl-head` 出现、网格卸载、交付头「实际消耗 99 算力」。

---

## 4. 固定价 SKU 的计费承诺与确认卡

**现象 / 需求**
- ip-pos 是 `FIXED_PRICE_SKUS`（固定价，**不按消耗结算**）。若确认卡/提示写「预计消耗约 N 积分…按实际用量结算」会误导用户。

**解法**
- 对话页 `AgentChatPage` 确认卡：ip-pos 走固定价文案「交付 1 份 IP 定位全案（速览 + 8 章）共 99 算力，生成完成后告诉你本次实际消耗（校验不通过、生成失败不扣费）」。
- 工作台右栏加「🏅 失败不扣费」徽标（`.ipw-promise`，绿底绿字），明示这一单的定价承诺；交付成本单位统一「算力」。

**涉及**：`apps/web/src/marketplace/AgentChatPage.tsx`、`IpPosWorkbench.tsx`、`ip-pos-workbench.css` 的 `.ipw-promise`。

---

## 5. 虚拟人头像来源

**现象 / 需求**
- 页面需要虚拟人头像（对话窗、实拍面板），不要照片圆与字圆混用、不另行找图。

**解法**
- 统一用系统内置形象 `employeeAvatarPath(skuId)` → `public/avatars/ip-position.jpg`（即系统虚拟人头像），对话窗与详情页实拍共用，避免素材不一致。

**涉及**：`IpPosWorkbench.tsx` 的 `avatar = employeeAvatarPath(skuId)`。

---

## 6. 商城页通用红线（workbench 开发需遵守，踩过/必须守）

这些不是 bug，是项目对商城内嵌页的硬约束，workbench 已遵守：

1. **Topbar 不能丢**：用商城共用 `Topbar`（`active="chat"`），余额 `fetchMarketMe` 拉；不要自己写顶栏。
2. **两侧留白来自外层 `app-wrap`**：整页必须包 `<main className="app-wrap">`（桌面 `max-width:1200px` 居中、移动 100%）；不包这层顶栏会顶到屏幕两边。
3. **作用域 reset 不能盖 Topbar**：若页面 CSS 有 `.xxx *{margin:0;padding:0}` 这类通配 reset，Topbar 必须放在该作用域**外面**，否则同权重 + 后加载会清掉顶栏 padding。
4. **全局 h1 会盖继承色**：`sitong-design.css` 有全局 `h1{}`，深色块（hero）里要显式给 `h1` 写 `color`，否则标题不跟随父级文字色。

---

## 7. 交付结构口径（8 章 vs 6 字段）

**现象 / 需求**
- 原型写「定位简报 0/8」。

**解法（已拍板）**
- 工作台 2026-09-27 已确定 **6 字段**（商业模式并入「项目」、IP 目标并入「创始人」），不再用 8 字段。工作台、详情页统一以 6 字段为准，避免与真实工作台自相矛盾。
- 交付物仍是「速览 + 8 章」9 件（这是输出结构，与访谈 6 字段是两回事，不要混淆）。

---

## 验收脚本清单（防回归）

| 脚本 | 覆盖 |
|---|---|
| `qa-ip-pos/price-99-20260927/verify.cjs` | 改价：按钮/费用行/标签/交付头 = 99 算力、无 400 残留、徽标、版本标记 |
| `qa-ip-pos/lit-20260927/verify.cjs` | 走马灯：生成中逐格点亮、结果返回才出报告、99 算力口径 |
| `scripts/billing-cost-model-smoke.ts` | 三处价格真源一致性钉死（ipPosCurrentPpu=99） |
| `scripts/sitong-wallet-db-smoke.ts` / `marketplace-ip-pos-run-smoke.ts` / `marketplace-api-smoke.ts` | 余额/计费/运行层同步 |

## 未决 / 待办（非阻塞）

- 这些改动**均未 commit**（与改价、详情页同批在工区），需要单独提交时告知。
- `marketplace-foundation-smoke` 既有失败（coming_soon 内核计数 16 vs 13）与价格/工作台无关，未动。
- `scripts/tmp/lq-deploy-override/...` 是临时部署快照、含旧价，按红线不拿备份副本代替源码修复。
