import { parseTopicTable } from "../apps/api/src/services/topic-table-parser";

function row(i: number, stage: string): string {
  return `| ${i} | 医美选题示例 ${i} | 认知型 | Get笔记 | 人性共识 | ★☆☆☆☆ | 开头抛痛点，结尾看主页/评论区/关注 | ${stage} |`;
}

// 场景 1：标准 8 列表格（含 适用阶段）
const t8 = [
  "## 二、选题 10 条（三关已过）",
  "| # | 选题 | 类型 | 来源 | 共识层级 | 客资准度 | 创作建议 | 适用阶段 |",
  "|---|---|---|---|---|---|---|---|",
  ...Array.from({ length: 10 }, (_, k) => row(k + 1, k % 2 === 0 ? "起号期" : "增长期+变现期")),
  "",
  "## 三、配比校验（起号期）",
  "| 层级 | 基线 | 本次 | 结论 |"
].join("\n");

// 场景 2：7 列回退（模型没产出 适用阶段）→ 不应判失败，stage 为空串
const t7 = [
  "## 二、选题 10 条（三关已过）",
  "| # | 选题 | 类型 | 来源 | 共识层级 | 客资准度 | 创作建议 |",
  "|---|---|---|---|---|---|---|",
  ...Array.from({ length: 10 }, (_, k) => `| ${k + 1} | 选题 ${k + 1} | 认知型 | Get笔记 | 人性共识 | ★☆☆☆☆ | 看主页/评论区/关注 |`),
  "",
  "## 三、配比校验（起号期）",
  "| 层级 | 基线 | 本次 | 结论 |"
].join("\n");

const r1 = parseTopicTable(t8);
const r2 = parseTopicTable(t7);

console.log("=== 场景1：标准 8 列 ===");
console.log("解析条数:", r1.rows.length, "| 失败:", JSON.stringify(r1.failures));
console.log("第1条 stage =", JSON.stringify(r1.rows[0].stage), "| 第2条 stage =", JSON.stringify(r1.rows[1].stage));

console.log("\n=== 场景2：7 列回退（无 适用阶段 列）===");
console.log("解析条数:", r2.rows.length, "| 失败:", JSON.stringify(r2.failures));
console.log("第1条 stage =", JSON.stringify(r2.rows[0].stage), "(应为空串，不误杀)");

const ok =
  r1.rows.length === 10 &&
  r1.rows[0].stage === "起号期" &&
  r1.rows[1].stage === "增长期+变现期" &&
  r1.failures.length === 0 &&
  r2.rows.length === 10 &&
  r2.rows[0].stage === "" &&
  r2.failures.length === 0;
console.log("\n结果:", ok ? "✅ 通过" : "❌ 未通过");
process.exit(ok ? 0 : 1);
