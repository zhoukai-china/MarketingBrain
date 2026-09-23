# 文案智能体（货架）· 结构校验偶发拦截交付 — 交接文档

> 交付对象：北京技术合伙人
> 版本：v1.0 ｜ 日期：2026-09-23 ｜ 来源：用户实测报障（思潼AI商城，两次会话截图）
> 报障入口：`https://ai.lcppch.top/agent/ipzone__copy/chat`（货架 · 文案智能体，core=`copy`）
> 总体交接背景见 `docs/HANDOFF-tech-partner-20260922.md`（系统架构、发布纪律、回滚手册），本文档只讲这一个 Bug。
> 性质判定：**已知遗留风险的兑现，不是新代码引入的缺陷**——根因与 `docs/BUG_REGRESSIONS.md` QA-20260916-002 完全同源，当时只修了兰琪侧、货架侧被明确留作"另一条回归线"（见第 2 节第 4 层）。

---

## 0. 一句话任务

> 用户在货架「文案智能体」按访谈引导答完 5 项输入（行业/卖点 → 人群 → 平台=抖音 → 口播时长=60秒 → 内容类型），系统生成后**死在结构校验上**：两次使用分别被「口播稿字数 < 150」和「话题缺少『大流量』层级」两条硬门禁拦下，自动重试一次仍失败，最终返回「文案交付未通过技能校验，本次不消耗积分」。fail-closed 与不扣积分的行为是对的，要修的是：**把校验器的硬阈值写进货架提示词（兰琪侧已验证的同款修法），并把纠错重试补上达标写法**，让这类偶发拦截率降下来。

---

## 1. 现象（用户视角）

1. 用户走完访谈引导（截图可见最后三问：平台=抖音级慢号 → 口播时长=60秒 → 内容类型=教程型）。
2. 提交生成后，第一次收到：

```
文案交付未通过技能校验，本次不消耗积分：
口播稿过长（143 字 < 150）
```

   > 注：截图为小字，字样近似「过长」；源码文案实为 **「口播稿过短（N 字 < 150）」**（`copy-ten-contract.ts` L68），语义一致（净字数不足 150 被拦）。本地 `dist` 与源码字样一致，无版本漂移迹象；请以生产日志实际 message 为准顺手核实一眼（见 P1-4）。

3. 另一次使用（同入口、同流程）收到：

```
文案交付未通过技能校验，本次不消耗积分：
话题缺少「大流量」层级 话题缺少…
```

   （用户口述转写，可能三条层级词全缺；422 message 会 join 全部失败项，生产日志里有完整列表。）

4. 两次都是：自动纠错重试一次 → 仍失败 → 422，**未扣积分**（fail-closed 设计，符合预期）。

---

## 2. 根因（静态走查 + QA-20260916-002 既有证据，无需复现脚本）

### 2.1 完整链路

`/agent/ipzone__copy` → marketplace chat 路由：

- core 提取：`sku.skuCode.slice(lastIndexOf("__") + 2)` = `"copy"`（`apps/api/src/routes/marketplace.ts` L312）；
- system 提词：`marketplaceSkillSystemPrompt` 对 core=copy 返回 **`COPY_TEN_SYSTEM_PROMPT`**（同文件 L2176-2184）；
- 生成调用：provider wrapper 强制 `reasoningProfile="standard"`、`thinkingMode="disabled"`、`maxTokens` clamp 到 **≥8000**（同文件 L345-355；主调用传的 2048 会被抬到 8000，L516-525）；
- 结构校验：`parseCopyTenContract(answerText)`（同文件 L609-610）；
- 失败自动重试一次：corrective 只复述失败项（同文件 L613-639）；
- 仍失败 → 422 `marketplace_output_invalid`，message = "文案交付未通过技能校验，本次不消耗积分：\n" + 全部失败项（同文件 L644-654），**不扣积分**。

### 2.2 门禁 A：口播净字数 ≥150（本次 143，差 7 字）

`apps/api/src/products/beauty-industry/copy-ten-contract.ts` L63-68：

```ts
const cleanScript = scriptText.replace(/【[^】]*】/g, "").replace(/>B-roll[^\n]*/g, "").replace(/```/g, "");
const words = (cleanScript.match(/[\u4e00-\u9fa5a-zA-Z0-9]/g) ?? []).length;
if (words < 150) failures.push(`口播稿过短（${words} 字 < 150）`);
```

要点：**先剥掉【动作/情绪】标记、>B-roll 行、代码块，再数中英文字符**。而系统提示词恰好在第二节要求"按 0-3/3-15/…/55-60 六段，含【动作/情绪】与 >B-roll 切换点，每句≤40字"——提示词引导模型把内容写进这些**会被剥离的标记**里，且没有任何地方告诉模型"剥完之后正文仍须 ≥150 字"。模型按提示词写出的紧凑稿，净字数掉到 143。

### 2.3 门禁 B：话题三层词 = 全文字面包含检查

同文件 L77-79：

```ts
["大流量", "精准", "行业"].forEach((layer) => {
  if (!new RegExp(layer).test(text)) failures.push(`话题缺少「${layer}」层级`);
});
```

对**整份输出**做字面包含检查。模型只要把第七节话题写成真实 `#标签`、或用同义说法（如「泛流量」「垂直人群」）、没有**逐字**写出「大流量 / 精准 / 行业」三个层级词，就判缺。提示词里对应要求只是第七节括号里一句软描述（L34"三层话题：大流量1-2/精准2-3/行业1-2"），没有"必须逐字写出这三个词"的硬指令。

### 2.4 共同根因与历史出处（QA-20260916-002）

两个门禁是同一类缺陷的两张面孔：**校验器有硬阈值，货架提示词没写硬要求**。叠加 wrapper 强制 `thinkingMode="disabled"`（QA-20260916-002 第 2 轮实测：关思考后正文变短、结构失败率反而升高），偶发就漏。纠错重试只把失败原文念回去、system 不变、不给达标写法 → 重试也救不回来。

`docs/BUG_REGRESSIONS.md` **QA-20260916-002（L417-432）**：兰琪「美业文案十件套」当年撞的就是**这两类失败的组合**（口播过短 133 字 + 合规/结构项），修复是给兰琪提问壳 `apps/api/src/products/lanqi/copy-kit-service.ts` 补了 4 条硬要求（原话见 BUG_REGRESSIONS L429：口播正文 ≥150 汉字且每句 ≤40 字；第七节正好 3 行标题且**话题逐字写「大流量 / 精准 / 行业」**；获客型第三节 5-6 组【问·…】+ 第十节主投本地推；任何位置不得出现被禁词字面）+ 输出额度 8192→16384，修复后真实 Eval 3/3 全绿。当时明确（L430）：**不改 `parseCopyTenContract` / `COPY_TEN_SYSTEM_PROMPT`，货架「文案智能体」属另一条回归线，不在本任务范围**。

→ 本次货架两个报错，就是这条当年明确留下的未加固回归线的兑现。

### 2.5 已排除的原因

- **不是输出截断**：wrapper 把 maxTokens clamp 到 ≥8000（L345-355）；且两次失败都只有单条 failure——若正文被截断，会先挂「缺少『九、』章节」这类多条失败。
- **不是仓库/线上提示词漂移**：本地 `dist/apps/api/src/products/beauty-industry/copy-ten-contract.js` 与源码同字样。
- **不是积分误扣**：422 路径 `consumedCredits=0`，fail-closed 是设计行为。
- **不是数据库/租户问题**：同一校验器纯函数，输入输出可复算。

---

## 3. 修复建议（按优先级）

### P0-1 货架侧补「硬要求壳」（最小改动，推荐）

**给 core=copy 的 system 提词追加兰琪同款硬要求，不动兰琪侧任何文件。**

- 实现位置（二选一）：
  - `marketplaceSkillSystemPrompt`（marketplace.ts L2176-2184）：core=copy 时返回 `COPY_TEN_SYSTEM_PROMPT + "\n" + 硬要求后缀`；
  - 或主调用点（marketplace.ts L516-525）拼 system 时追加。
- 硬要求内容**直接照抄** `copy-kit-service.ts` 里已验证的措辞（QA-20260916-002 修复成果）：
  1. 口播逐字稿**剥掉【动作/情绪】与 >B-roll 标记后正文仍须 ≥150 汉字**（建议按 60 秒写足 180-240 字口语正文），每句 ≤40 字；
  2. 第七节标题正好 3 行（📌 主标题 + 🔁 备选×2），三层话题必须**逐字写「大流量 / 精准 / 行业」**并分层给标签；
  3. 获客型第三节 5-6 组【问·…】、第十节主投本地推；
  4. 任何位置（含禁忌说明、表格备注）不得出现被禁词字面，表达禁止时改写为「不做站外导流」「不做引流话术」等。
- **不要改** `apps/api/src/products/lanqi/copy-kit-service.ts`（兰琪行为保持不变）；也**暂不改**共享的 `COPY_TEN_SYSTEM_PROMPT` 本体（改本体会同时影响兰琪侧，改动面变大，如要做须连跑兰琪真实 Eval，见 P1-5）。

### P0-2 纠错重试附达标写法

corrective（marketplace.ts L615-619）对每类失败附标准示例，提高一次重试成功率。例如：

- 口播字数：附「口播正文（不含【动作】与 >B-roll 行）须 ≥150 汉字，请把六段的口语台词写足，动作标注只做提示」；
- 话题三层：附达标格式行 `大流量：#xxx ｜ 精准：#yyy ｜ 行业：#zzz`（三个层级词逐字出现）；
- 标题 3 行 / 访谈 5-6 组同理各附一行达标样例。

### P1-3 422 文案加行动指引

「文案交付未通过技能校验，本次不消耗积分：…」后面补一句「点下方重试再生成一次即可，本次未扣积分」（marketplace.ts L650）。低优先，纯文案。

### P1-4 核实线上字样与失败全量列表

生产 API 日志 grep `copy_output_invalid_retry` / `copy_output_invalid_retry_failed`（marketplace.ts L613/L638），确认：① 线上 message 究竟是「过短」还是「过长」（截图存疑，源码是「过短」）；② 两次失败的真实完整 failures 列表（422 message 是全量 join，截图只拍到首行）。若真为「过长」，说明线上 API bundle 比仓库旧，需先对版本再修。

### P1-5（可选，单独立项）把硬阈值收敛进共享合同本体

`COPY_TEN_SYSTEM_PROMPT` 是货架与兰琪的单一出处（copy-ten-contract.ts 文件头注释）。P0-1 的后缀壳属于"又长出一层"，长期应把硬阈值直接写进本体、兰琪壳去重。**须单独任务**：改完连跑 `lanqi:copy-kit-live-eval`（真实 Eval 3/3）+ 货架 Eval，避免再出"两侧漂移"。

### 红线：不许用放宽校验器来"修"

删 150 字阈值、删三层词检查、把全文包含改成只扫第七节、放宽失败后直接放行——都不允许（仓库 AGENTS.md：不放宽断言、不吞失败）。正确方向只有一个：**把达标写法给足模型**，QA-20260916-002 已验证有效。

---

## 4. 验收标准

1. **主用例（真实 Eval）**：同一组输入（本地生活/美业类目、平台=抖音、60 秒、获客型）连跑 ≥10 次，结构校验**一次通过率 ≥9/10**（基线：用户两次使用各撞一次）。
2. **失败路径不回归**：构造必败输出（如口播 100 字）→ 仍 422、**不扣积分**、失败项原文完整展示、文案含行动指引。
3. **重试有效性**：注入失败用例时 corrective 重试能通过（日志出现 `copy_output_invalid_retry_ok`），重试调用 maxTokens 走 wrapper clamp 后 ≥8000。
4. **兰琪零影响**：`apps/api/src/products/lanqi/copy-kit-service.ts` 无 diff；`pnpm lanqi:copy-kit-smoke` 28/0 全绿。
5. **门禁**：`pnpm typecheck`、`pnpm qa:fast` 全绿；涉及提示词/门禁改动，按仓库 AGENTS.md 追加 `pnpm qa:regression`。
6. **灰度顺序**：按 `docs/HANDOFF-tech-partner-20260922.md` 流程——备份 → 先发测试实例（`api.lcppch.top/lanqi-test`）→ 用户验收 → 双入口生产（`ai.lcppch.top` 与 `api.lcppch.top/os-v2`）→ 更新 `docs/CURRENT_DEPLOYMENT_STATUS.md` 台账。

**夹具红线**：测试夹具用合成行业数据，不得把用户真实经营信息写进仓库（AGENTS.md）。

---

## 5. 用户侧临时绕行（无需等修复）

- 校验失败**不扣积分**，直接点重试再生成一次，通常能过；
- 连败两轮就「重新开始」重答：内容类型尽量按选项原词回答（获客型/人设型/流量型），行业与卖点写具体些，模型素材越足稿子越容易写够字数。

---

## 6. 待核实（不影响本次根因，顺手确认）

- 线上访谈选项文案与仓库不一致：截图显示「内容类型：教程（步骤拆解/干货）/ 人设（立场占位）/ 流量型（爆款辩论）」，仓库 `apps/web/src/marketplace/chat-flows.ts` L62 为「获客型（引流到店/咨询）/ 人设型（立信任）/ 流量型（涨粉曝光）」。需确认线上 web bundle 版本来源。连带影响：`parseCopyTenContract` 的 contentType 识别（copy-ten-contract.ts L86）只认「获客型|人设型|流量型」，若模型输出写「教程型」，访谈 5-6 组与投流渠道两条检查会被跳过（偏宽松方向的偏差，非本次失败原因）。

---

## 附：关键代码位置速查

| 位置 | 说明 |
|------|------|
| `apps/api/src/products/beauty-industry/copy-ten-contract.ts` L25-42 | `COPY_TEN_SYSTEM_PROMPT`（货架+兰琪共享；硬阈值未写全的根源） |
| 同上 L63-68 | **门禁 A**：口播剥标记后 ≥150 字（本次 143 被拦） |
| 同上 L69-70 | 口播 >40 字单句检查（同类门禁，随时可能下一个冒头） |
| 同上 L77-79 | **门禁 B**：话题三层词全文逐字包含检查 |
| 同上 L86-94 | contentType 识别 → 访谈 5-6 组 / 投流渠道检查（只认三个型） |
| `apps/api/src/routes/marketplace.ts` L312 | core 提取（`ipzone__copy` → `copy`） |
| 同上 L345-355 | provider wrapper：强制 standard 推理档 + thinking disabled + maxTokens ≥8000 |
| 同上 L516-525 | 主生成调用（传 2048 被 wrapper 抬到 8000） |
| 同上 L609-654 | **copy 校验 + 一次纠错重试 + 422 不扣积分**（本次全部报错出处） |
| 同上 L615-619 | corrective 文案（只复述失败项，未附达标写法 → P0-2） |
| 同上 L2176-2184 | `marketplaceSkillSystemPrompt`（P0-1 建议改动点） |
| `apps/api/src/products/lanqi/copy-kit-service.ts` | 兰琪提问壳（已含 4 条硬要求 + maxTokens 16384，P0-1 措辞来源；**不要动**） |
| `docs/BUG_REGRESSIONS.md` L417-432 | QA-20260916-002：同源根因与兰琪侧修复证据 |
| `apps/web/src/marketplace/chat-flows.ts` L49-64 | 文案智能体访谈 5 槽位（见第 6 节待核实） |
