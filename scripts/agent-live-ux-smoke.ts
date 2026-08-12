import { createRuntimeLlmProvider } from "../apps/api/src/services/llm-provider-factory.js";
import { AGENT_DEFINITIONS } from "../apps/api/src/services/agent-definitions.js";
import { invokeSkillThroughMcp } from "../apps/api/src/services/agent-runtime.js";
import { getDemoContext } from "../apps/api/src/services/demo-context.js";

const USER_TASK = "我是上海一家产后修复工作室，主推1980元盆底修复套餐，目标客户是产后3到12个月的宝妈。现在主要靠美团和老客转介绍，抖音更新不稳定，朋友圈没有固定内容。本月想新增30个到店咨询。请给我未来7天的抖音和朋友圈获客计划：每天发什么、怎么承接优惠、私信跟进怎么说。";

function summarizeAnswer(answer: string) {
  const requiredFacts = ["上海", "1980", "产后修复", "盆底修复", "宝妈"];
  const missingFacts = requiredFacts.filter((fact) => !answer.includes(fact));
  return {
    hasSevenDayPlan: /第\s*[1-7]\s*天|Day\s*[1-7]|7天|七天/.test(answer),
    hasDouyinAndMoments: answer.includes("抖音") && answer.includes("朋友圈"),
    hasPrivateMessageFollowUp: /私信.*(?:话术|跟进|回复)|跟进.*话术/.test(answer),
    hasProgressiveFollowUp: ["首次回复", "24小时未回复", "客户只问价格", "准备预约"].every((term) => answer.includes(term)),
    missingFacts,
    containsGenericPlaceholder: /你的业务|主推产品\/服务|什么样的客户|主发布平台/.test(answer)
  };
}

async function main() {
  const provider = createRuntimeLlmProvider();
  if (!provider.isConfigured()) throw new Error("runtime_model_not_configured");
  const agent = AGENT_DEFINITIONS.find((item) => item.id === "agent_acquisition");
  if (!agent) throw new Error("acquisition_agent_not_found");
  const context = { ...getDemoContext({}), source: "demo" as const };

  const run = async (capabilityId?: "content_plan") => {
    const startedAt = Date.now();
    const result = await invokeSkillThroughMcp({
      requestId: `live-ux-${capabilityId ?? "free"}-${Date.now()}`,
      context,
      provider,
      agentId: agent.id,
      capabilityId,
      skillId: capabilityId ? "baolu_content_creator" : undefined,
      input: USER_TASK,
      skipEntitlement: true,
      persist: false
    });
    return {
      mode: capabilityId ?? "free_question",
      elapsedMs: Date.now() - startedAt,
      skillId: result.skillId,
      qualityFlags: result.qualityFlags,
      summary: summarizeAnswer(result.answerText),
      answer: result.answerText
    };
  };

  const results = [await run(), await run("content_plan")];
  console.log(JSON.stringify({ model: provider.getModel(), results }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
