import assert from "node:assert/strict";
import { runAgent } from "../packages/agent/src/index.js";

async function main() {
  const result = await runAgent({
  tenantId: "by09-timeout-regression",
  userId: "by09-timeout-user",
  role: "owner",
  planCode: "ip_standard",
  requestedSkillId: "baolu_topics",
  capabilityId: "topic_inspiration",
  tenantProfile: {
    tenantId: "by09-timeout-regression",
    tenantName: "合成美业门店",
    tenantType: "local_business",
    industry: "生活美容"
  },
  channel: "h5",
  input: "为已确认的生活美容门店生成四个来源的获客选题；缺资料时明确待补。"
}, {
  name: "deepseek",
  async complete() {
    throw new Error("deepseek request timed out after 120000ms");
  }
  });

  assert.equal(result.providerFailure?.code, "timed_out");
  console.log("BY-09 provider timeout classification smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
