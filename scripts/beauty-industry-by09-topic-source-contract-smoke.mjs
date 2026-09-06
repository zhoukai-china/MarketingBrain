import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const agent = readFileSync(new URL("../packages/agent/src/index.ts", import.meta.url), "utf8");
const prompt = readFileSync(new URL("../packages/skills/skills/baolu_topics/prompt.md", import.meta.url), "utf8");
const original = readFileSync(new URL("../mcp-skills/skills/baolu_topics/SKILL.md", import.meta.url), "utf8");
const sources = ["私有知识与客户问题", "行业与用户热点", "自身账号数据复盘", "同行与对标内容"];

for (const source of sources) {
  assert.ok(original.includes(source), `original topic source missing: ${source}`);
  assert.ok(prompt.includes(source), `runtime topic prompt missing: ${source}`);
  assert.ok(agent.includes(source), `topic final delivery missing: ${source}`);
}
assert.match(agent, /\{ name: "私有知识与客户问题"/);
assert.match(agent, /requiredTerms: \[[^\]]*"私有知识与客户问题"/);
assert.doesNotMatch(prompt, /四个核心来源（AI录音卡\//);

console.log("beauty_industry_by09_topic_source_contract_smoke_passed");
