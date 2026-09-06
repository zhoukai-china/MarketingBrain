import assert from "node:assert/strict";
import { inferAcquisitionCapabilities } from "../packages/shared/src/index.js";
import { AGENT_DEFINITIONS } from "../apps/api/src/services/agent-definitions.js";

const founderIp = AGENT_DEFINITIONS.find((agent) => agent.id === "agent_acquisition");
assert(founderIp, "founder IP acquisition compatibility agent is missing");
assert.equal(founderIp.name, "思潼·创始人IP获客系统");
assert.match(founderIp.marketing.workMap?.title ?? "", /创始人IP获客/);

const targetCapabilities = [
  "fip_franchise",
  "fip_store_visit",
  "fip_student_recruitment",
  "fip_partner_recruitment"
];
assert.deepEqual(
  founderIp.capabilities.filter((item) => targetCapabilities.includes(item.key)).map((item) => item.key),
  targetCapabilities,
  "the four acquisition targets must each have an explicit entry"
);
assert.equal(
  founderIp.marketing.workMap?.nodes
    .filter((node) => targetCapabilities.includes(node.action?.type === "capability" ? node.action.capabilityId ?? "" : ""))
    .length,
  0,
  "the work map must not duplicate the four targets; users select them inside the topic-system acquisition-goal briefing"
);
assert.ok(
  founderIp.marketing.workMap?.nodes.some((node) => node.id === "topic_system" && node.action?.type === "capability" && node.action.capabilityId === "topic_inspiration"),
  "the work map must keep the unified topic-system entry for the four targets"
);

assert.deepEqual(inferAcquisitionCapabilities("为连锁品牌招加盟商，先做招商 Brief"), ["fip_franchise"]);
assert.deepEqual(inferAcquisitionCapabilities("为成都门店做团购到店预约和核销承接"), ["fip_store_visit"]);
assert.deepEqual(inferAcquisitionCapabilities("为创始人课程招学员，安排试听和报名"), ["fip_student_recruitment"]);
assert.deepEqual(inferAcquisitionCapabilities("寻找城市联营和渠道合作方，安排洽谈"), ["fip_partner_recruitment"]);
assert.deepEqual(
  inferAcquisitionCapabilities("同时招加盟商和招学员，分别做 Brief、承接与复盘"),
  ["fip_franchise", "fip_student_recruitment"],
  "mixed goals must remain independently routed"
);

for (const capability of founderIp.capabilities.filter((item) => targetCapabilities.includes(item.key))) {
  assert.match(capability.promptTemplate, /【待补】|待补/, `${capability.key} must preserve missing-fact handling`);
  assert.match(capability.promptTemplate, /不得.*(?:编造|声称已)/, `${capability.key} must forbid invented results or execution`);
}

console.log("founder_ip_four_goal_contract_smoke:PASS");
