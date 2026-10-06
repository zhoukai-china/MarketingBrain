/* 单测：IP 定位工作台「生成前补问·填空题」的解析与作答组装（纯函数，不碰 DOM / 不调接口）。
 * 跑法：apps/api/node_modules/.bin/tsx qa-ip-pos/ippos-gap-fill-check.ts
 * 背景：2026-10-02 用户（截图）「这些最好是填空题」。例：
 *   原问句「招商获客每月能投多少预算，重点投哪些城市？」→ 填空句「我希望在【目标城市】投放，每月投入【月预算】用于获客」
 */
import {
  parseGapSentence, blankCount, isFillSentence, gapText, assembleGapAnswer, assembleGapSupplement, mergePrefills,
  type IpPosGap, type PrefillIssue
} from "../apps/web/src/marketplace/ip-pos-gaps.js";

let failed = 0;
const eq = (actual: unknown, expected: unknown, msg: string) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}${ok ? "" : `\n      got=${a}\n      exp=${e}`}`);
  if (!ok) failed += 1;
};
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failed += 1; };

const SENT = "我希望在【目标城市】投放，每月投入【月预算】用于获客";

// ---- parseGapSentence：切成「文本/空」段，空带序号 ----
eq(parseGapSentence(SENT), [
  { kind: "text", text: "我希望在" },
  { kind: "blank", label: "目标城市", blankIndex: 0 },
  { kind: "text", text: "投放，每月投入" },
  { kind: "blank", label: "月预算", blankIndex: 1 },
  { kind: "text", text: "用于获客" }
], "填空句切成 文本/空/文本/空/文本 五段，空序号 0、1");
eq(blankCount(SENT), 2, "一句话数出 2 个空");
ok(isFillSentence(SENT), "有【】→ 判定为填空句");
eq(parseGapSentence("招商获客每月能投多少预算？"), [{ kind: "text", text: "招商获客每月能投多少预算？" }], "无【】→ 退化为单段纯文本（走自由输入）");
ok(!isFillSentence("招商获客每月能投多少预算？"), "无【】→ 不是填空句");
eq(blankCount(""), 0, "空串 0 个空");
eq(parseGapSentence("【只有空】"), [{ kind: "blank", label: "只有空", blankIndex: 0 }], "整句就是一个空");
eq(parseGapSentence("前半【甲】中间【乙】后半").filter((p) => p.kind === "blank").length, 2, "两个空都解析出");

// ---- gapText：优先 sentence，退回 question ----
eq(gapText({ area: "预算/投放", sentence: SENT, question: "旧问句" }), SENT, "gapText 优先取填空句");
eq(gapText({ area: "预算/投放", question: "旧问句" }), "旧问句", "没填空句时退回旧问句");
eq(gapText({ area: "x" }), "", "两者都空 → 空串");

// ---- assembleGapAnswer：全空/全填/部分填/非填空 ----
const g: IpPosGap = { area: "预算/投放", sentence: SENT };
eq(assembleGapAnswer(g, []), "", "全空 → 不贡献");
eq(assembleGapAnswer(g, ["", ""]), "", "两个空都空 → 不贡献");
eq(assembleGapAnswer(g, ["上海、杭州", "3 万"]), "我希望在上海、杭州投放，每月投入3 万用于获客", "全填 → 还原成整句");
eq(assembleGapAnswer(g, ["上海", ""]), "目标城市：上海", "只填一个空 → 报「名词：值」，不拼病句");
eq(assembleGapAnswer(g, ["", "3 万"]), "月预算：3 万", "只填另一个空同理");
const g2: IpPosGap = { area: "团队/规模", question: "总部几个人？" };
eq(assembleGapAnswer(g2, ["5 人"]), "5 人", "非填空句 → 取自由输入值");
eq(assembleGapAnswer(g2, []), "", "非填空句且没填 → 空");

// ---- assembleGapSupplement：整体拼接，未填的跳过 ----
const gaps: IpPosGap[] = [
  { area: "预算/投放", sentence: SENT },
  { area: "团队/规模", sentence: "目前总部【人数】人，今年计划开到【门店数】家加盟店" },
  { area: "渠道/内容", sentence: "主阵地是【平台】" }
];
eq(assembleGapSupplement(gaps, {}), "", "全没填 → 补充串为空");
eq(
  assembleGapSupplement(gaps, { 0: ["上海", "3 万"], 2: ["抖音"] }),
  "预算/投放：我希望在上海投放，每月投入3 万用于获客；渠道/内容：主阵地是抖音",
  "只拼填了的（第 2 条整条跳过），分号连接"
);
eq(
  assembleGapSupplement(gaps, { 1: ["5", ""] }),
  "团队/规模：人数：5",
  "部分填的那条只出「名词：值」"
);

// ---- 含空白字符的脏数据也能容忍 ----
eq(parseGapSentence(" 我希望在【 城市 】投放 ").filter((p) => p.kind === "blank").map((p) => (p as { label: string }).label), ["城市"], "空里前后空白被 trim");

/* ---- mergePrefills：体检 issues + 运营缺口 折成同一个填空面板 ----
 * 2026-10-03 用户（截图）：「这两个合并成一个，都按第二个填空的方式。」
 * 即后端 issues 也要产出填空句，前端把两者合成一个面板；此处只测纯函数的合并规则。 */
const SLOT_CN: Record<string, string> = { stage: "现状与投入", competition: "竞争格局", user: "目标用户" };
const issues: PrefillIssue[] = [
  { slot: "stage", verdict: "weak", sentence: "我在抖音和小红书主要发【内容方向】，其中带来过加盟咨询的有【咨询数】条", followup: "这两个号分别发什么？" },
  { slot: "competition", verdict: "missing", sentence: "", followup: "竞品能不能再具体一点？" }
];
const merged = mergePrefills(issues, gaps, (s) => SLOT_CN[s] ?? s);
eq(merged.map((m) => m.area), ["现状与投入", "竞争格局", "预算/投放", "团队/规模", "渠道/内容"], "体检项排在前、运营缺口排在后");
eq(merged.map((m) => m.source), ["check", "check", "gap", "gap", "gap"], "来源标记：check=体检补强 / gap=运营缺口");
ok(isFillSentence(merged[0].sentence ?? ""), "体检项保留填空句（与 gap 同构，同一个填空题渲染）");
ok(!isFillSentence(merged[1].sentence ?? ""), "体检项没给填空句 → sentence 置空（走自由输入兜底）");
eq(merged[1].question, "竞品能不能再具体一点？", "没填空句时用 followup 兜底");
eq(merged[0].verdict, "weak", "保留 verdict 供标签配色");
eq(merged[3].slot, undefined, "运营缺口没有 slot");
// 同 area 只留第一条（体检优先）
eq(
  mergePrefills([{ slot: "stage", verdict: "weak", sentence: SENT, followup: "f" }], [{ area: "现状与投入", sentence: "另一条【甲】" }], (s) => SLOT_CN[s] ?? s)
    .map((m) => m.source),
  ["check"],
  "同 area 去重，保留体检项"
);
// 空项 / 无文本项被过滤
eq(
  mergePrefills(
    [{ slot: "user", verdict: "weak", sentence: "", followup: "" }],
    [{ area: "", sentence: "x【y】" }, { area: "空文本", sentence: "" }],
    (s) => SLOT_CN[s] ?? s
  ).length,
  0,
  "没文本 / 没 area 的项一律过滤"
);
// 合并后的列表可以直接交给 assembleGapSupplement（体检项的填空也进补充串）
eq(
  assembleGapSupplement(merged, { 0: ["探店口播", "3"] }),
  "现状与投入：我在抖音和小红书主要发探店口播，其中带来过加盟咨询的有3条",
  "合并列表可直接组装「预采集补充」（体检项照常生效）"
);
eq(assembleGapSupplement(merged, { 2: ["上海", "3 万"] }), "预算/投放：我希望在上海投放，每月投入3 万用于获客", "运营缺口那几条不受影响");

console.log(failed === 0 ? "\nALL PASS" : `\nFAILED ${failed}`);
process.exit(failed === 0 ? 0 : 1);
