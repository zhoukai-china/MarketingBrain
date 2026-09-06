import { runAgent } from "../packages/agent/src/index.js";

const provider = {
  name: "baolu-content-sync-deterministic",
  async complete() {
    throw new Error("force_baolu_content_sync_fallback");
  }
};

async function main() {
  const beauty = await run("merge-beauty-tenant", "兰琪测试美业", "美容皮肤管理", [
    "为门店护理项目做一条短视频拍剪交接。",
    "已确认：店内采访区和服务流程可拍；没有账户、预算或投放后台数据。",
    "请给固定机位或移动拍摄选择，并说明缺什么。"
  ].join("\n"));
  const restaurant = await run("merge-restaurant-tenant", "餐饮测试品牌", "中式快餐", [
    "为新品制作短视频拍剪交接。",
    "已确认：后厨备餐和出餐过程可拍；没有账户、预算或投放后台数据。",
    "请给固定机位或移动拍摄选择，并说明缺什么。"
  ].join("\n"));

  assertBehavior("beauty", beauty.answer, {
    mustContain: ["拍摄", "剪辑EDL"],
    mustNotContain: ["餐饮测试品牌", "已充值", "已提交计划", "已自动投放"]
  });
  assertBehavior("restaurant", restaurant.answer, {
    mustContain: ["拍摄", "剪辑EDL"],
    mustNotContain: ["兰琪测试美业", "皮肤管理", "已充值", "已提交计划", "已自动投放"]
  });

  console.log("BAOLU_CONTENT_CREATOR_SYNC_BEHAVIOR_OK");
  console.log(`beauty_length=${beauty.answer.length}`);
  console.log(`restaurant_length=${restaurant.answer.length}`);
}

async function run(tenantId: string, tenantName: string, industry: string, input: string) {
  return runAgent({
    tenantId,
    userId: `${tenantId}-owner`,
    role: "owner",
    planCode: "local_premium",
    requestedSkillId: "baolu_content_creator",
    capabilityId: "shooting_editing",
    input,
    tenantProfile: { tenantId, tenantName, tenantType: "local_business", industry },
    channel: "h5"
  }, provider);
}

function assertBehavior(label: string, answer: string, expectations: { mustContain: string[]; mustNotContain: string[] }) {
  const missing = expectations.mustContain.filter((term) => !answer.includes(term));
  const leaked = expectations.mustNotContain.filter((term) => answer.includes(term));
  if (missing.length || leaked.length) {
    throw new Error(`${label}_behavior_failed: missing=${missing.join(",") || "none"}; leaked_or_executed=${leaked.join(",") || "none"}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
