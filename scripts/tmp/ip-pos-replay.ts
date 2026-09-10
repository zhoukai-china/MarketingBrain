// 临时探针：把 .debug 里的真实模型输出回放进 parseIpPosFull，核对结构化字段。用完即删。
import { readFileSync } from "node:fs";
import { parseIpPosFull } from "../../apps/api/src/routes/marketplace.js";

const file = process.argv[2] ?? ".debug/ip-pos-answer.txt";
const raw = readFileSync(file, "utf8");
const answer = file.endsWith(".json")
  ? (JSON.parse(raw) as { answer: string }).answer
  : raw;
const input = [
  "- 品牌名：某手机后市场连锁品牌",
  "- 行业：手机后市场连锁加盟",
  "- 现状：抖音 1w+ 粉，几百家门店",
  "- 目标：招商加盟"
].join("\n");
const { failures, payload } = parseIpPosFull(answer, input);
console.log(JSON.stringify({
  failures,
  stats: payload.stats,
  passed: payload.validation.passed,
  top10: payload.topics.top10.length,
  calendar: payload.topics.calendar30.length,
  homepage: payload.homepage,
  tone: {
    positiveChars: payload.tone.positive.length,
    negativeChars: payload.tone.negative.length,
    positiveHead: payload.tone.positive.slice(0, 60)
  }
}, null, 2));
