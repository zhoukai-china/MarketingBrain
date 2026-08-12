import assert from "node:assert/strict";
import { runAgent } from "../packages/agent/src/index.ts";

const profile = {
  tenantId: "acquisition-workmap-quality-test",
  tenantName: "Synthetic Skin Management",
  tenantType: "local_business" as const,
  industry: "skin management",
  city: "Shenyang",
  data: { offer: "skin management service [pending]", customer: "women aged 25-35 with oily or acne-prone skin" }
};

const provider = {
  name: "forced-workmap-fallback",
  async complete(): Promise<string> {
    throw new Error("force_workmap_deterministic_fallback");
  }
};

async function check(params: {
  skillId: "baolu_topics" | "baolu_content_creator" | "optimize_local_push_ads" | "live_script_planner";
  capabilityId: "topic_inspiration" | "content_plan" | "paid_traffic" | "live_script";
  input: string;
  required: string[];
}): Promise<void> {
  const result = await runAgent({
    tenantId: profile.tenantId,
    userId: "acquisition-workmap-quality-user",
    role: "owner",
    planCode: "chain_premium",
    requestedSkillId: params.skillId,
    capabilityId: params.capabilityId,
    deliveryPolicy: "draft_with_placeholders",
    channel: "workbench",
    input: params.input,
    tenantProfile: profile
  }, provider);
  for (const term of params.required) assert.ok(result.answer.includes(term), `${params.capabilityId} missing ${term}`);
  assert.ok(!result.qualityFlags.some((flag) => /^(?:too_short|missing_contract_terms|rubric_not_boss_usable|rubric_scene_mismatch)/.test(flag)), `${params.capabilityId} quality flags: ${result.qualityFlags.join(",")}`);
}

async function main(): Promise<void> {
  await check({
    skillId: "baolu_topics",
    capabilityId: "topic_inspiration",
    input: "\u3010\u9009\u9898\u7cfb\u7edf\u81ea\u52a8\u8fd0\u884c\u3011\u3010\u9009\u9898\u7cfb\u7edf\u56db\u6e90\u8fd0\u884c\u3011\n\u672c\u8f6e\u670d\u52a1\u4e3b\u4f53\uff1a\u6f84\u89c1\u76ae\u80a4\u7ba1\u7406\uff08\u8131\u654f\u6d4b\u8bd5\uff09\n\u672c\u8f6e\u660e\u786e\u884c\u4e1a\uff1a\u76ae\u80a4\u7ba1\u7406\n\u76ee\u6807\u5ba2\u6237\uff1a25-35\u5c81\u6cb9\u75d8\u808c\u5973\u6027\n\u672c\u8f6e\u8f6c\u5316\u76ee\u6807\uff1a\u79c1\u4fe1\u54a8\u8be2\u5e76\u9884\u7ea6\u5230\u5e97\n\u884c\u4e1a\u70ed\u70b9\u3001\u5bf9\u6807\u8d26\u53f7\u3001\u5f55\u97f3\u548c\u8d26\u53f7\u590d\u76d8\u5747\u5f85\u8865\u3002",
    required: ["\u4e09\u5173\u7b5b\u9009\u540e\u7684TOP10", "\u6765\u6e90\u6807\u7b7e", "\u7b2c\u4e00\u5173\u8bc1\u636e\u72b6\u6001", "\u5171\u8bc6\u5c42\u7ea7\u6807\u7b7e", "\u5ba2\u8d44\u7cbe\u51c6\u5ea6\u6807\u7b7e", "\u8d26\u53f7\u9636\u6bb5\u914d\u6bd4\u5efa\u8bae", "\u5f85\u9a8c\u8bc1\u52a8\u4f5c\u4e0e\u8bc1\u636e\u8fb9\u754c"]
  });
  await check({
    skillId: "baolu_content_creator",
    capabilityId: "content_plan",
    input: "\u3010\u5185\u5bb9\u7cfb\u7edf\uff5c\u6279\u91cf\u5185\u5bb9\u751f\u6210\u3011\n\u672c\u8f6e\u670d\u52a1\u4e3b\u4f53\uff1a\u6f84\u89c1\u76ae\u80a4\u7ba1\u7406\uff08\u8131\u654f\u6d4b\u8bd5\uff09\n1. \u76ae\u80a4\u7ba1\u7406\u9884\u7ea6\u524d\uff0c\u5148\u786e\u8ba4\u9700\u6c42\u3001\u670d\u52a1\u8fb9\u754c\u548c\u5230\u5e97\u65f6\u95f4\u3002\n\u6bcf\u4e00\u4e2a\u9009\u9898\u5fc5\u987b\u72ec\u7acb\u8f93\u51fa\u4e00\u4efd\u5b8c\u6574\u5185\u5bb9\u6267\u884c\u5305\uff0c\u4ef7\u683c\u3001\u6848\u4f8b\u548c\u5730\u5740\u5747\u3010\u5f85\u8865\u3011\u3002",
    required: ["\u5b8c\u6574\u5185\u5bb9\u6267\u884c\u5305", "\u53e3\u64ad\u9010\u5b57\u7a3f", "\u62cd\u6444\u811a\u672c", "\u526a\u8f91EDL", "\u660e\u786e\u7684\u4e0b\u4e00\u6b65\u52a8\u4f5c"]
  });
  await check({
    skillId: "optimize_local_push_ads",
    capabilityId: "paid_traffic",
    input: "\u4e3a\u6f84\u89c1\u76ae\u80a4\u7ba1\u7406\uff08\u8131\u654f\u6d4b\u8bd5\uff09\u505a\u6295\u6d41\u8bca\u65ad\uff0c\u76ee\u6807\u662f\u6709\u6548\u54a8\u8be2\u548c\u9884\u7ea6\u5230\u5e97\u3002\u8d26\u6237\u3001\u9884\u7b97\u3001\u7d20\u6750\u6570\u636e\u5747\u3010\u5f85\u8865\u3011\uff1b\u53ea\u751f\u6210\u9884\u89c8\uff0c\u4e0d\u6267\u884c\u6295\u653e\u3002",
    required: ["\u6295\u6d41\u7ed3\u8bba", "\u53ef\u6267\u884c\u7684\u5355\u53d8\u91cf\u6d4b\u8bd5\u65b9\u6848", "PREVIEW_ONLY\u53d8\u66f4\u5355", "\u8d1f\u8d23\u4eba"]
  });
  await check({
    skillId: "live_script_planner",
    capabilityId: "live_script",
    input: "\u3010\u76f4\u64ad\u7cfb\u7edf\uff5c\u77e5\u8bc6\u5e93\u4e00\u952e\u751f\u6210\u3011\u4e3a\u6f84\u89c1\u76ae\u80a4\u7ba1\u7406\uff08\u8131\u654f\u6d4b\u8bd5\uff09\u751f\u621030\u5206\u949f\u54a8\u8be2\u9884\u7ea6\u76f4\u64ad\u8bdd\u672f\u3002\u76ee\u6807\u5ba2\u6237\u662f25-35\u5c81\u6cb9\u75d8\u808c\u5973\u6027\uff1b\u9879\u76ee\u3001\u4ef7\u683c\u548c\u6848\u4f8b\u5747\u3010\u5f85\u8865\u3011\u3002\u5305\u542b\u5f00\u573a\u3001\u7559\u4eba\u3001\u4e92\u52a8\u3001\u4ea7\u54c1\u627f\u63a5\u3001\u8f6c\u5316\u3001\u903c\u5355\u3001\u4e0b\u64ad\u540e\u8ddf\u8fdb\u3001\u573a\u63a7\u6e05\u5355\u548c\u590d\u76d8\u6307\u6807\u3002",
    required: ["\u76f4\u64ad\u603b\u89c8", "\u56db\u5957\u6838\u5fc3\u8f6e\u64ad\u8bdd\u672f", "\u8bdd\u672fA", "\u8bdd\u672fB", "\u8bdd\u672fC", "\u8bdd\u672fD", "\u573a\u63a7\u6267\u884c\u6e05\u5355", "\u4e0b\u64ad\u540e\u8ddf\u8fdb"]
  });
  console.log("ACQUISITION_WORKMAP_OUTPUT_QUALITY_SMOKE_OK");
}

void main();
