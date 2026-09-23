# 视频复盘智能体 · 抖音「按天汇总」导出识别异常修复 — 交接文档

> 交付对象：北京技术合伙人
> 版本：v1.0 ｜ 日期：2026-09-23 ｜ 来源：用户实测报障（思潼AI商城）
> 报障入口：`https://ai.lcppch.top/agent/ipzone__vidrev/chat`（江流 · 视频复盘智能体）
> 总体交接背景见 `docs/HANDOFF-tech-partner-20260922.md`（系统架构、发布纪律、回滚手册），本文档只讲这一个 Bug。

---

## 0. 一句话任务

> 用户把抖音创作者后台导出的 **「数据表现_短视频全量指标.xlsx」（按天汇总表，每行 = 一天，共 30 天）** 传给视频复盘智能体做深度复盘，系统没有明确拒绝，而是**伪装解析成功 → 生成两次 → 死在一条看不懂的 V7 校验上**（不扣积分但用户完全不知道该怎么办）。修复目标：**让这类「按天汇总」数据在入口处被识别并 fail-closed，给出明确的导出指引**；同时修掉两个连带缺陷（口语化兜底错位抓数、V7 与「数据缺失」口径自相矛盾）。

---

## 1. 现象（用户视角）

1. 用户上传 `数据表现_短视频全量指标.xlsx`（抖音后台导出），前端提示「已读取（已按标准请求填充）」，看起来一切正常。
2. 提交深度复盘后等待生成，最后收到：

```
视频复盘未通过技能校验，本次不消耗积分：
V7 第一章未给出互动率，无法用同一份数据复核加权口径。
```

3. 自动纠错重试了一次，两次都死在同一条 V7 上。用户不知道错在哪、该换什么数据。

---

## 2. 根因（已在本地用真实文件 + 生产同款代码复现验证）

根因是**数据形态不匹配**，叠加**三层缺陷**：

### 第 1 层：表头别名缺口 → 整张 30 行的表被静默丢弃

文件实际表头（Tab 分隔）：

```
日期	投稿量	总播放量	总点赞量	总分享量	总评论量	5秒完播率	2秒跳出率	封面点击率	平均播放时长
2026-08-14	1	9	-1	0	0	37.50%	62.50%	0.00%	16.63s
2026-08-15	1	26	1	0	0	35.71%	50.00%	0.00%	8.11s
…（共 30 行，每行 = 一天）
```

对照 `apps/api/src/services/video-review-engine.ts` 的 `FIELD_ALIASES`（约 L140-166）：

- `日期` → `published_at` ✔、`5秒完播率` → `completion_5s` ✔
- `总播放量 / 总点赞量 / 总分享量 / 总评论量` 因为带「**总**」前缀，全部不在别名表里 ✘
- `投稿量 / 2秒跳出率 / 封面点击率 / 平均播放时长` 也无别名 ✘

`parseVidrevRowsFromText`（同文件约 L369-399）要求表头至少命中 **3 列**（L382 `if (matched < 3) continue;`），实测只命中 2 列 → **整表丢弃，30 行日汇总数据一条都没进引擎**。

> 注意：这份表本质是**按天汇总**，不是逐条作品明细。就算把「总播放量」等别名补上让它解析成功，也会把「每一天」当成「一条视频」去做四象限 / 单条深拆——口径完全错误。所以**单纯加别名是错误修法**（见第 4 节 P0-2）。

### 第 2 层：口语化兜底 `parseInlineRow` 错位抓数 → 生成 1 条垃圾行骗过 V0

表格路径失败后落到同文件 `parseInlineRow`（约 L344-367）的口语化单行兜底。它把全部行 join 成一个字符串后逐正则抓数，实测抓出：

```json
{"comments":5, "completion_rate":0.02, "completion_5s":0.02}
```

错位原因：正则允许「表头词 + 分隔符 + 数字」即命中，而表头里**下一个列名恰好以数字开头**：

- `评论量` 后面是 `\t5秒完播率` → 抓到「5秒完播率」的 **5** 当评论数；
- `完播率` 后面是 `\t2秒跳出率` → 抓到「2秒跳出率」的 **2** 当完播率（toRate 归一成 0.02）；
- `播放量` 后面是 `\t总点赞量`（非数字）→ 播放没抓到。

结果：`computeVidrevMetrics` 收到 1 条 plays=0 的垃圾行 → `count=1 ≠ 0` → V0「没有识别到视频记录」的 fail-closed 分支（`apps/api/src/routes/marketplace.ts` 约 L463-474）**没有触发**，流程继续进了模型生成。

### 第 3 层：brief 说「互动率 缺失」，模型照写「缺失」，V7 判死

- 垃圾行 plays=0 → `engagementRate = null`（video-review-engine.ts L558、L707）；
- `vidrevMetricBrief`（同文件 L1651-1668）喂给模型的是「互动率 **缺失**」；
- 模型遵守系统提词的「空值不得当 0」（`apps/api/src/routes/marketplace.ts` L2313）规范，在第一章写「互动率：数据缺失」；
- 而 V7 校验（video-review-engine.ts **L1377-1387**）**无条件**要求第一章出现「互动率」+ 半角 `%` 百分数，不认「数据缺失」→ 首次失败；
- 纠错重试的 corrective（marketplace.ts L721-725）只复述「V7 第一章未给出互动率」，**没给达标示例行**，system 提词也不变 → 模型第二次同样写「数据缺失」→ 同样失败 → 422。

V7 正则只认半角 `%`、数字必须在「互动率」之后同行，兜底正则也要求同一行内「互动率…x.x%」，容忍度与提词的模糊措辞（L2300「总互动（含互动率，注明加权）」）不闭合。

### 本地复现证据（2026-09-23，生产同款链路）

用真实文件按 `media.ts extractWorkbookText`（L618-633，xlsx→TSV 文本）→ `AgentChatPage` 附件拼接（input 尾部追加【附件：…】文本）→ `parseVidrevRowsFromText` → `computeVidrevMetrics` 全链路跑一遍，输出：

```
rows.length = 1
notes = ["已按口语化单条数据解析 1 条记录。"]
first row = {"comments":5,"completion_rate":0.02,"completion_5s":0.02}
count = 1 | totalPlays = 0 | totalEngagement = 5
engagementRate = null
可复算数据：1 条 / 总播放 0 / 总互动 5（互动率 缺失，加权口径 Σ互动÷Σ播放）/ …
```

与线上截图的 V7 报错完全吻合。原始文件在用户本机 `C:\Users\book\Desktop\智能体培训讲课素材\视频复盘\数据表现_短视频全量指标.xlsx`，需要原件可向用户微信索取。

---

## 3. 修复建议（按优先级）

### P0-1 兜底解析防错位（最小改动，先堵住）

`parseInlineRow`（video-review-engine.ts L344-367）在「检测到疑似表头行但命中列 < 3」时**不得启用**——直接失败关闭，让 V0 的明确报错接住。或至少：

- 率值（completion_rate / completion_5s）必须带 `%` 才算数；
- 数值后必须跟边界（分隔符/行尾），不允许「数字+汉字」被截一半。

### P0-2 识别「按天汇总」形态，fail-closed 给明确指引

在 vidrev 入口（marketplace.ts L442-474 附近）加形态判定：**表头含「日期/投稿量」类列且无任何「标题/作品名称/视频描述」列** → 直接 422，报错文案明确告知：

> 检测到按天汇总数据，视频复盘需要逐条作品数据。请在抖音创作者中心 → 内容管理 → 作品数据 导出（每行一个作品，含播放/点赞/评论/分享），或另存为 CSV 上传。

不许再走「伪装解析 → 死在 V7」的路径。

### P0-3 禁止单纯给别名表加「总播放量」等前缀

不配合形态判定就加别名，日汇总表会被当成 30 条「视频」产出四象限报告——比现在更隐蔽、更危险。如产品后续要支持按天数据，应单独立项做「趋势复盘」分支（时序分析，不做四象限/单条深拆），与本修复解耦。

### P1-4 V7 与「数据缺失」口径自洽

`metrics.engagementRate === null` 时（数据本身没有互动/播放列），V7 应允许报告写「互动率：数据缺失」，与 V8（ROI 数据缺失）、V9（时间维度）同一口径。当前 brief 喂「缺失」、模型守规矩写「缺失」反而判死，门禁自相矛盾。位置：video-review-engine.ts L1377-1387。

### P1-5 纠错重试附达标示例

corrective（marketplace.ts L721-725）里对每类失败附标准写法，例如 V7 附：`| 互动率 | 3.34%（加权口径 Σ互动÷Σ播放） |`，提高重试成功率。

### P1-6 生产设置 `VIDREV_DEBUG_DUMP_DIR`

`dumpVidrevDebugOutput`（marketplace.ts L2046-2060）只在设置了该环境变量时落盘失败原文，生产一直没设，导致这次排查只能本地复现。建议生产 API 进程加上（目录如 `/opt/baolu-logs/vidrev-debug`），并纳入磁盘清理。

---

## 4. 验收标准

1. **主用例**：上传这份「数据表现_短视频全量指标.xlsx」→ 收到 P0-2 的明确指引报错，**不生成报告、不扣积分**，前端不再出现 V7 字样。
2. **正常路径不回归**：抖音创作者中心**逐条作品**导出（每行一个作品，列含 作品名称/发布时间/播放量/点赞量/评论量/分享数/完播率）→ 正常出完整报告并扣积分。
3. **视频号明细不回归**：视频号助手「动态数据明细.csv」→ 正常出报告。
4. **红灯回归用例**（补进 `scripts/marketplace-vidrev-contract-smoke.ts`，参照 checkModelFormatDrift 的写法）：
   - 「按天汇总表头」输入 → 必须解析出 0 条（不得再产出 `{"comments":5,...}` 垃圾行）；
   - 表头行存在但命中 < 3 时 → `parseInlineRow` 不得启用。
5. **V7 缺失口径**：构造 engagementRate=null 的合法输入 + 第一章写「互动率：数据缺失」的报告 → 不判 V7（其余规则照常）。
6. 质量门禁：`pnpm typecheck`、`pnpm qa:fast`、`pnpm marketplace:vidrev-contract-smoke` 全绿；涉及解析与门禁改动，按仓库 AGENTS.md 追加 `pnpm qa:regression`。

**夹具红线**：入库测试夹具必须用上面表头的**合成数据**，不得把用户真实文件放进仓库（AGENTS.md：真实客户数据不进源码/夹具）。

---

## 5. 发布纪律

按 `docs/HANDOFF-tech-partner-20260922.md` 的既有流程执行：备份 → 先发测试实例（`api.lcppch.top/lanqi-test`）→ 用户验收 → 双入口生产（`ai.lcppch.top` 与 `api.lcppch.top/os-v2`）→ 更新 `docs/CURRENT_DEPLOYMENT_STATUS.md` 台账。

---

## 6. 用户侧临时绕行（无需等修复）

培训/演示要用视频复盘时，改传**逐条作品明细**：抖音创作者中心 → 内容管理 → 作品数据 → 导出（每行一个作品）。按天的「全量指标」表在修复上线前传不了，报错是预期行为。

---

## 附：关键代码位置速查

| 位置 | 说明 |
|------|------|
| `apps/api/src/services/video-review-engine.ts` L140-166 | `FIELD_ALIASES` 表头别名表（缺「总」前缀与日汇总形态判定） |
| 同上 L344-367 | `parseInlineRow` 口语化兜底（错位抓数源头） |
| 同上 L369-399 | `parseVidrevRowsFromText` 表头门禁（matched < 3 丢整表） |
| 同上 L526-560 / L707 | `computeVidrevMetrics`（plays=0 → engagementRate=null） |
| 同上 L1377-1387 | **V7 校验**（无条件要求「互动率+百分数」，报错文案出处） |
| 同上 L1651-1668 | `vidrevMetricBrief`（喂给模型的重算口径，null 时写「缺失」） |
| `apps/api/src/routes/marketplace.ts` L442-474 | vidrev 入口：rows 解析与 V0 fail-closed 分支 |
| 同上 L721-749 | 纠错重试 corrective（未附达标示例） |
| 同上 L2283-2321 | `VIDREV_SYSTEM_PROMPT`（第一章要求在 L2300） |
| 同上 L2046-2060 | `dumpVidrevDebugOutput`（受 `VIDREV_DEBUG_DUMP_DIR` 门控，生产未设） |
| `apps/api/src/routes/media.ts` L618-633 | `extractWorkbookText`（xlsx→TSV，每表 120 行、全文 16000 字截断） |
| `apps/web/src/marketplace/AgentChatPage.tsx` L1031-1049 / L1091-1117 | 前端 xlsx 附件走 `/media/analyze` 转表格文本 |
