/**
 * 增强项目「填空 → 二次加工 → 零残留【待补充】」纯函数单测（不调 LLM、不碰网络）。
 * 跑法：apps/api/node_modules/.bin/tsx qa-ip-pos/ippos-enhance-check.ts
 *
 * 覆盖：用户填过的增强项，其标记位被替换成填写值；未填的保留标记；整体结果零残留已填项。
 */
import { applyFilledAnswers } from "../apps/web/src/marketplace/ip-pos-completions.ts";

const fail: string[] = [];
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fail.push(msg); };

// 模拟一份刚生成、还带【待补充】的全案（与真实模型输出同构：表格单元格 + 散文）
const sections: Record<string, string> = {
  ads: [
    "六、投流建议",
    "| 项目 | 金额 | 占比 |",
    "|---|---|---|",
    "| DOU+ | 待补充：需用户确认月预算 | 60% |",
    "| 本地推 | 待补充：需用户确认月预算 | 40% |",
    "| 城市定向 | 待补充：需用户确认目标城市」，不要编造。 | 5km |"
  ].join("\n"),
  execution: ["八、执行建议", "门店数：待补充：门店数。"].join("\n")
};

console.log("=== 场景 1：只填两个空，第三个不填 ===");
const answered1 = [
  { sectionKey: "ads", instruction: "月预算", answer: "8 万" },
  { sectionKey: "ads", instruction: "目标城市", answer: "上海、杭州" }
  // 门店数 未填
];
const r1 = applyFilledAnswers(sections, answered1);
ok(r1.ads.includes("8 万") && !r1.ads.includes("待补充：需用户确认月预算"), "月预算 标记被替换为填写值「8 万」");
ok(r1.ads.includes("上海、杭州") && !/待补充：需用户确认目标城市/.test(r1.ads), "目标城市 标记被替换为「上海、杭州」");
ok(/待补充：门店数/.test(r1.execution), "未填的「门店数」标记**保留**（用户没补，不强改）");
ok(!/需用户确认/.test(r1.ads), "填空标签前缀「需用户确认」已被抹掉");

console.log("\n=== 场景 2：全部填完 → 全案零残留【待补充】 ===");
const answered2 = [
  { sectionKey: "ads", instruction: "月预算", answer: "8 万" },
  { sectionKey: "ads", instruction: "目标城市", answer: "上海、杭州" },
  { sectionKey: "execution", instruction: "门店数", answer: "5 家" }
];
const r2 = applyFilledAnswers(sections, answered2);
const allText = Object.values(r2).join("\n");
ok(!/【?待补(?:充)?[:：]?/.test(allText), "整份结果里不再出现任何「待补充」标记（零残留）");
ok(r2.ads.includes("8 万") && r2.ads.includes("上海、杭州") && r2.execution.includes("5 家"), "三处填空值都已内联进正文");

console.log("\n=== 场景 3：空回答不应误删标记 ===");
const r3 = applyFilledAnswers(sections, [{ sectionKey: "ads", instruction: "月预算", answer: "  " }]);
ok(/待补充：需用户确认月预算/.test(r3.ads), "填写值为空时，原标记保留不被清掉");

console.log(`\n${fail.length === 0 ? "ALL PASS ✅" : `${fail.length} FAILED ❌`}`);
process.exit(fail.length === 0 ? 0 : 1);
