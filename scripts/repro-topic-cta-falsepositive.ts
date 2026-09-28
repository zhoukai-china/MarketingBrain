// 复现：选题 CTA 违禁词校验的「整段扫描误杀」机制
// 用真实 parseTopicTable 验证：选题表本身合规，但分析段里顺带提到违禁词 → 仍被整段正则判失败。
import { parseTopicTable } from "../apps/api/src/services/topic-table-parser";

const ADVICE_CLEAN = "开头用钩子抛痛点，结尾引导用户看主页 / 评论区 / 关注，避免硬广";

function buildModelOutput(withMentionInAnalysis: boolean): string {
  const header = [
    "## 一、四个来源实拉结果",
    "| 来源 | 实拉情况 | 拿到什么 |",
    "| --- | --- | --- |",
    "| Get笔记 | 已选 7 条 | 行业认知素材 |",
    "| 行业热点 | 2 条 | 热点话题 |",
    "| 数据复盘 | 2 条 | 高表现标题 |",
    "| 同行爆款 | 未提供账号数据，2 条配额已并入①② | — |",
  ];
  const analysisNote = withMentionInAnalysis
    ? [
        "",
        "## 二、选题 10 条（三关已过）",
        "> 备注：观察同行爆款可见，不少账号靠「私信」引导成交，本表不采用此类做法。",
      ]
    : ["", "## 二、选题 10 条（三关已过）"];

  const tableHeader = [
    "",
    "| # | 选题 | 类型 | 来源 | 共识层级 | 客资准度 | 创作建议 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  const rows: string[] = [];
  for (let i = 1; i <= 10; i++) {
    rows.push(
      `| ${i} | 医美选题示例 ${i} | 认知型 | Get笔记 | 人性共识 | ★☆☆☆☆ | ${ADVICE_CLEAN} |`
    );
  }
  const tail = [
    "",
    "## 三、配比校验（起号期）",
    "| 层级 | 基线 | 本次 | 结论 |",
    "| --- | --- | --- | --- |",
    "| 人性共识 | 5 | 5 | 达标 |",
    "",
    "## 四、来源配额核对",
    "| 来源 | 目标 | 实际 | 说明 |",
    "| --- | --- | --- | --- |",
    "| Get笔记 | 3-4 | 4 | 达标 |",
  ];
  return [...header, ...analysisNote, ...tableHeader, ...rows, ...tail].join("\n");
}

const clean = buildModelOutput(false);
const withMention = buildModelOutput(true);

// 场景 C：分析段同样提到「私信」，但第 3 条创作建议里真的写了违禁 CTA
const realViolation = buildModelOutput(true).replace(
  "医美选题示例 3 | 认知型 | Get笔记 | 人性共识 | ★☆☆☆☆ | " + ADVICE_CLEAN,
  "医美选题示例 3 | 认知型 | Get笔记 | 人性共识 | ★☆☆☆☆ | 想做的私信我，留个联系方式发你资料"
);

const r1 = parseTopicTable(clean);
const r2 = parseTopicTable(withMention);
const r3 = parseTopicTable(realViolation);

console.log("=== 场景 A：选题表合规 + 分析段无违禁词（期望：通过）===");
console.log("解析出条数:", r1.rows.length, "| 失败项:", JSON.stringify(r1.failures, null, 2));

console.log("\n=== 场景 B：选题表合规，分析段顺带提到「私信」（期望：通过，不再误杀）===");
console.log("解析出条数:", r2.rows.length, "| 失败项:", JSON.stringify(r2.failures, null, 2));

console.log("\n=== 场景 C：分析段提到「私信」且第 3 条创作建议真含违禁 CTA（期望：仍判失败并定位行）===");
console.log("解析出条数:", r3.rows.length, "| 失败项:", JSON.stringify(r3.failures, null, 2));
