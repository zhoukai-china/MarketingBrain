import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { getBeautyIndustryToolRegistration } from "../apps/api/src/products/beauty-industry/mcp-adapter.js";

type Admission = {
  id: string;
  capabilityId: string;
  toolName: string;
  scope: string;
  chain: string[];
  userVisible: boolean;
};

const root = process.cwd();
const failures: string[] = [];

const admissions: Admission[] = [
  { id: "xiaohongshu", capabilityId: "beauty_xiaohongshu_package", toolName: "beauty.xiaohongshu_package", scope: "acquisition:xhs", chain: ["wechat-xhs-content-line", "beauty-industry-xhs", "beauty-industry-compliance"], userVisible: true },
  { id: "topics", capabilityId: "topic_inspiration", toolName: "beauty.topic_ideas", scope: "acquisition:topics", chain: ["baolu_topics", "beauty-industry-content-diff", "beauty-industry-compliance"], userVisible: true },
  { id: "content-ten", capabilityId: "content_plan", toolName: "beauty.content_ten_pack", scope: "acquisition:video-content", chain: ["baolu_content_creator", "beauty-industry-content-diff", "beauty-industry-compliance"], userVisible: true },
  { id: "video-content-review", capabilityId: "shooting_editing", toolName: "beauty.video_content_review", scope: "acquisition:video-content-review", chain: ["baolu_content_creator", "beauty-industry-content-diff", "beauty-industry-compliance"], userVisible: true },
  { id: "video-data-review", capabilityId: "video_data_review", toolName: "beauty.video_data_review", scope: "acquisition:video-data-review", chain: ["baolu_review_engine", "beauty-industry-content-diff", "beauty-industry-compliance"], userVisible: true },
  { id: "live-script", capabilityId: "live_script", toolName: "beauty.live_script", scope: "acquisition:live", chain: ["live_script_planner", "beauty-industry-compliance"], userVisible: true },
  { id: "live-review", capabilityId: "live_review", toolName: "beauty.live_review", scope: "acquisition:live-review", chain: ["baolu_live_review_engine", "beauty-industry-compliance"], userVisible: true },
  { id: "sales", capabilityId: "beauty_sales", toolName: "beauty.sales_advice", scope: "sales:advice", chain: ["sales_growth_advisor", "beauty-industry-compliance"], userVisible: true }
];

async function main(): Promise<void> {
  const manifests = await read("packages/skills/src/index.ts");
  const shared = await read("packages/shared/src/index.ts");
  const adapter = await read("apps/api/src/products/beauty-industry/mcp-adapter.ts");
  const workflows = await readOptional("apps/api/src/products/beauty-industry/workflows.ts");
  const execution = await read("apps/api/src/products/beauty-industry/execution.ts");
  const agentDefinitions = await read("apps/api/src/services/agent-definitions.ts");
  const beautyAgentBlock = agentDefinitions.slice(agentDefinitions.indexOf('id: "agent_beauty_acquisition"'), agentDefinitions.indexOf('id: "agent_sales"'));

  for (const admission of admissions) {
    for (const skillId of admission.chain) {
      await requiredFile(`mcp-skills/skills/${skillId}/SKILL.md`, `${admission.id}:formal_skill_missing:${skillId}`);
      await requiredFile(`packages/skills/skills/${skillId}/prompt.md`, `${admission.id}:runtime_prompt_missing:${skillId}`);
      await requiredFile(`packages/skills/skills/${skillId}/contract.json`, `${admission.id}:runtime_contract_missing:${skillId}`);
      await requiredFile(`packages/skills/skills/${skillId}/examples/sample-grade.md`, `${admission.id}:sample_missing:${skillId}`);
      check(manifests.includes(`${JSON.stringify(skillId)}:`) || manifests.includes(`${skillId}: {`), `${admission.id}:manifest_missing:${skillId}`);
      check(shared.includes(`| ${JSON.stringify(skillId)}`) || shared.includes(JSON.stringify(skillId)), `${admission.id}:shared_skill_id_missing:${skillId}`);
    }
    check(workflows.includes(`${admission.id}: {`) || workflows.includes(`${JSON.stringify(admission.id)}: {`), `${admission.id}:workflow_missing`);
    check(workflows.includes(`capabilityId: ${JSON.stringify(admission.capabilityId)}`), `${admission.id}:workflow_capability_mismatch`);
    for (const skillId of admission.chain) check(workflows.includes(JSON.stringify(skillId)), `${admission.id}:workflow_chain_missing:${skillId}`);
    if (admission.userVisible) {
      const registration = getBeautyIndustryToolRegistration(admission.toolName);
      check(registration.scope === admission.scope, `${admission.id}:scope_missing`);
      check(registration.capabilityId === admission.capabilityId, `${admission.id}:mcp_capability_mismatch`);
      check(registration.skillId === admission.chain[0], `${admission.id}:mcp_skill_mismatch`);
    } else {
      check(!adapter.includes(`name: ${JSON.stringify(admission.toolName)}`), `${admission.id}:retired_mcp_tool_exposed`);
      check(!adapter.includes(`scope: ${JSON.stringify(admission.scope)}`), `${admission.id}:retired_scope_exposed`);
    }
    check(beautyAgentBlock.includes(`key: ${JSON.stringify(admission.capabilityId)}`), `${admission.id}:agent_capability_missing`);
  }

  check(!adapter.includes("beauty.compliance_check"), "compliance_exposed_as_user_tool");
  check(!adapter.includes("beauty.paid_traffic_preview"), "paid_traffic_still_exposed");
  check(!adapter.includes("acquisition:traffic"), "paid_traffic_scope_still_exposed");
  check(!beautyAgentBlock.includes('key: "paid_traffic"'), "beauty_paid_traffic_agent_capability_still_present");
  check(!/文案脚本|内容四件套|内容九件套/.test(adapter + beautyAgentBlock + workflows), "legacy_content_product_name_present");
  check(adapter.includes("内容系统"), "content_system_user_name_missing");
  check(adapter.includes("V5 十件"), "content_system_delivery_contract_missing");
  check(workflows.includes("internalGuard: true"), "compliance_not_internal_guard");
  check(adapter.includes("parsedEvidence") && adapter.includes("parseStatus"), "parsed_file_input_contract_missing");
  check(execution.includes("beauty_video_data_not_parsed"), "parsed_file_evidence_guard_missing");
  check(workflows.includes("video-content-review") && workflows.includes('capabilityId: "shooting_editing"'), "admitted_video_content_workflow_missing");

  const contentContract = JSON.parse(await read("packages/skills/skills/baolu_content_creator/contract.json")) as { version?: string; capabilityContracts?: Record<string, { requiredSections?: string[] }> };
  check(contentContract.version === "5.0.0", "content_runtime_contract_version_not_v5");
  const ten = contentContract.capabilityContracts?.franchise_acquisition?.requiredSections ?? [];
  check(ten.length === 11 && ten.filter((item) => /^([一二三四五六七八九十]+)、/.test(item)).length === 10, "content_ten_pack_contract_not_ten");
  check(ten.some((item) => item.includes("访谈话术")), "content_ten_pack_missing_interview");
  check(ten.some((item) => item.includes("剪辑EDL")), "content_ten_pack_missing_edl");

  for (let repeat = 1; repeat <= 3; repeat += 1) {
    check(workflows.includes("medicalClaims: \"fail_closed\""), `high-risk-${repeat}:medical_claim_guard_missing`);
    check(workflows.includes("unknownPriceCase: \"mark_missing\""), `high-risk-${repeat}:price_case_guard_missing`);
    check(workflows.includes("crossIndustry: \"reject\""), `high-risk-${repeat}:cross_industry_guard_missing`);
    check(workflows.includes("materialAuthorization: \"required\""), `high-risk-${repeat}:material_authorization_guard_missing`);
    check(workflows.includes("externalActions: \"preview_only\""), `high-risk-${repeat}:external_action_guard_missing`);
  }

  if (failures.length) throw new Error(`beauty_skill_admission_failures:${failures.join(",")}`);
  console.log(`beauty industry skill admission passed (${admissions.length} combinations, high-risk x3)`);
}

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}

async function readOptional(relativePath: string): Promise<string> {
  try { return await read(relativePath); } catch { return ""; }
}

async function requiredFile(relativePath: string, code: string): Promise<void> {
  try { await access(path.join(root, relativePath)); } catch { failures.push(code); }
}

function check(condition: boolean, code: string): void {
  if (!condition) failures.push(code);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
