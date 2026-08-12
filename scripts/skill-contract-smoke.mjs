import { routeSkill } from "../packages/agent/dist/agent/src/index.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const cases = [
  ["帮我写明天朋友圈和短视频文案", "baolu_content_creator"],
  ["给我写一条能引流的朋友圈文案", "baolu_content_creator"],
  ["客户问价不成交怎么办", "sales_growth_advisor"],
  ["帮我做老板IP定位", "ip_positioning"],
  ["直播怎么播", "live_script_planner"],
  ["短视频完播率低怎么复盘", "baolu_review_engine"],
  ["怎么做食欲增长", "baolu_content_creator"],
  ["怎么做销售", "sales_growth_advisor"],
  ["员工执行力差怎么办", "hr_director_consultant"],
  ["交付SOP怎么做", "delivery_standardization"],
  ["美团外卖订单下降，想看菜单、补贴和退款", "takeaway-growth-advisor"]
];

const failures = [];
for (const [input, expected] of cases) {
  const actual = routeSkill(input);
  if (actual !== expected) failures.push(`${input}: expected ${expected}, got ${actual}`);
}

const contentSkill = readFileSync(
  join(process.cwd(), "packages", "skills", "skills", "baolu_content_creator", "prompt.md"),
  "utf8"
);
const requiredContentTerms = [
  "完整内容执行包",
  "选题",
  "文案",
  "拍摄脚本",
  "拍摄注意事项",
  "剪辑EDL",
  "发布标题",
  "发布时间",
  "评论区引导",
  "投流建议"
];

for (const term of requiredContentTerms) {
  if (!contentSkill.includes(term)) failures.push(`baolu_content_creator missing term: ${term}`);
}

if (/八件套|内容八件套/.test(contentSkill)) {
  failures.push("baolu_content_creator still contains 八件套 wording");
}

if (/完整报告（内容九件套）/.test(contentSkill)) {
  failures.push("baolu_content_creator still contains user-facing 内容九件套 report title");
}

if (failures.length) {
  console.error("Skill smoke failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Skill smoke passed.");
