/**
 * 「待补」扫描单测（纯函数，不调 LLM、不碰网络）。
 * 跑法：apps/api/node_modules/.bin/tsx qa-ip-pos/ippos-completion-scan-check.ts
 *
 * 用例直接复刻 2026-10-02 用户截图里的脏数据：标记落在 Markdown 表格单元格里、
 * 同一列多行重复同一标记、以及模型把提示词尾句「」，不要编造。」一起写了出来。
 */
import { scanCompletions, groupBySection, shouldShowHint, GENERIC_INSTRUCTION } from "../apps/web/src/marketplace/ip-pos-completions.ts";

const PIECES = [
  { no: "一", title: "项目定位", sectionKey: "positioning" },
  { no: "六", title: "投流建议", sectionKey: "ads" },
  { no: "八", title: "执行建议", sectionKey: "execution" }
];

const sections: Record<string, string> = {
  // 截图同款：6.4 月预算分配表，3 行都是同一个标记（金额缺、占比给了）
  ads: [
    "六、投流建议",
    "### 6.3 本地推投放方案",
    "| 场景 | 目标 | 金额 | 范围 | 关键设置 |",
    "|---|---|---|---|---|",
    "| 城市定向 | 拉新 | 待补充：需用户确认目标城市」，不要编造。 | 5km | 日预算 100 |",
    "### 6.4 月预算分配",
    "| 项目 | 金额 | 占比 |",
    "|---|---|---|",
    "| DOU+ | 待补充：需用户确认月预算 | 60% |",
    "| 本地推 | 待补充：需用户确认月预算 | 40% |",
    "| **合计** | 待补充：需用户确认月预算** | **100%** |"
  ].join("\n"),
  // 散文里空壳标记 + 明确标记混用
  positioning: [
    "一、项目定位",
    "客单价与月营收：参考：行业常见做法是……（非你的数据，需确认替换）；待补充：需要用户提供……。",
    "门店数：待补充：门店数。",
    "本段无待补内容。"
  ].join("\n"),
  // 无标记章节
  execution: ["八、执行建议", "30 天执行清单照抄即可。"].join("\n")
};

const items = scanCompletions({ sections }, PIECES);
const labels = items.map((i) => i.instruction);
const fail: string[] = [];
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fail.push(msg); };

console.log("=== 扫描结果 ===");
for (const i of items) console.log(`  [${i.sectionKey}] ${i.instruction}${i.count > 1 ? ` ×${i.count}` : ""}  | hint=${i.hint}`);

console.log("\n=== 断言 ===");
// 1) 标签里不许残留表格竖线 / 提示词尾句 / 强调符
for (const bad of ["|", "｜", "」", "不要编造", "**", "60%", "40%", "100%"]) {
  ok(!labels.some((l) => l.includes(bad)), `标签不含垃圾片段「${bad}」`);
}
// 2) 三个核心缺口被正确归一
ok(labels.includes("月预算"), "「需用户确认月预算」→ 月预算");
ok(labels.includes("目标城市"), "「需用户确认目标城市」，不要编造。→ 目标城市（尾句已截掉）");
ok(labels.includes("门店数"), "「待补充：门店数」→ 门店数");
// 3) 表格 3 行同标记 → 去重成 1 张卡且计数 3
const budget = items.find((i) => i.instruction === "月预算");
ok(!!budget && budget.count === 3, "表格里 3 处月预算去重成 1 张卡（count=3）");
ok(!!budget && budget.fromTable, "月预算卡标记为来自表格（UI 会露原文）");
// 4) 空壳标记 → 通用话术 + 露原文，而不是「需要用户提供」这种看不懂的标签
const shell = items.find((i) => i.sectionKey === "positioning" && i.instruction === GENERIC_INSTRUCTION);
ok(!labels.includes("需要用户提供"), "空壳标记不再产出「需要用户提供」这种含糊标签");
ok(!!shell && shouldShowHint(shell), "空壳标记卡会展示原文片段供用户判断");
// 5) 无标记章节不出卡
ok(!items.some((i) => i.sectionKey === "execution"), "没有待补标记的章节不生成问题卡");
// 6) id 唯一（作为回答 form key 必须唯一）
ok(new Set(items.map((i) => i.id)).size === items.length, "问题卡 id 唯一");
// 7) 分组可用、且每组标题正确
const grouped = groupBySection(items);
ok(grouped.ads?.length === (items.filter((i) => i.sectionKey === "ads").length), "按章节分组不丢项");
ok(grouped.ads?.[0]?.sectionTitle === "六、投流建议", "章节标题取自 PIECES（六、投流建议）");
// 8) 老实现会漏掉的场景：`【待补：xxx】` 内联式
const inline = scanCompletions({ sections: { ads: "| 合作方 | 【待补：合作门店名录】 | 待定 |" } }, PIECES);
ok(inline.some((i) => i.instruction === "合作门店名录"), "「【待补：合作门店名录】」内联标记也能读出项名");
// 9) 原文片段里也不许留提示词泄漏
ok(!items.some((i) => i.hint.includes("不要编造")), "原文片段里没有提示词泄漏的「不要编造」");
ok(items.every((i) => !/[|｜]/.test(i.hint)), "原文片段里竖线已压成 ·");
// 10) 每个待补项都带「填空句」fillParts（≥2 段，段间即空位）与填空标签 fillLabel
ok(items.every((i) => Array.isArray(i.fillParts) && i.fillParts.length >= 2), "每项都生成填空句 fillParts（≥2 段）");
ok(items.every((i) => i.fillLabel === i.instruction), "填空标签 fillLabel 与归一后的 instruction 一致");
// 11) 填空句里不许残留标记本体 / 表格竖线 / 提示词尾句
const flatFill = items.map((i) => i.fillParts.join("")).join("");
ok(!flatFill.includes("待补充") && !flatFill.includes("待补："), "填空句里不含「待补充」标记本体");
ok(!/[|｜]/.test(flatFill), "填空句里竖线已压成 ·");
ok(!flatFill.includes("不要编造"), "填空句里没有提示词泄漏的「不要编造」");
// 12) 同一行里有两个标记（2026-10-03 用户截图右侧栏「挤在一起」的根因）：
//     旧实现只替换首个标记，第二个标记会以裸「待补充：xxx」留在填空句里
const twoInOne = scanCompletions(
  { sections: { positioning: "· 成本结构 · 供应链出身，设备物料成本可控（用户提供）· 待补充：竞品真实成本结构 · 待补充：用真实进货价对比建立信任 ·" } },
  PIECES
);
const twoFlat = twoInOne.map((i) => i.fillParts.join("")).join("");
ok(twoInOne.length === 2, "同一行两个标记 → 拆成两张卡");
ok(!twoFlat.includes("待补充") && !twoFlat.includes("待补："), "同行第二个标记不以裸「待补充：xxx」留在填空句里");
ok(!twoInOne.some((i) => i.hint.includes("待补充")), "原文片段里也不残留裸标记");
ok(!twoFlat.includes("· …·"), "抹除后的「· …·」粘连已整理");
// 13) 空位要连标记后面的标签文字一起吃掉，否则会「___竞品真实成本结构」与 placeholder 重复
ok(!!budget && !budget.fillParts.join("").includes("需用户确认月预算"), "空位整段吃掉「待补充：需用户确认月预算」，不再和 placeholder 重复");

console.log(`\n${fail.length === 0 ? "ALL PASS" : `${fail.length} FAILED`}  （共 ${items.length} 张卡）`);
process.exit(fail.length === 0 ? 0 : 1);
