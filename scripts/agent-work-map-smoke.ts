import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateAgentWorkMapDefinition } from "../packages/shared/src/index.js";
import { AGENT_DEFINITIONS } from "../apps/api/src/services/agent-definitions.js";

const acquisition = AGENT_DEFINITIONS.find((agent) => agent.slug === "acquisition");
assert(acquisition, "acquisition agent definition missing");
assert(acquisition.marketing.workMap, "acquisition work map missing");
assert.equal(acquisition.name, "思潼·创始人IP获客系统");
assert.match(acquisition.marketing.workMap.title, /创始人IP获客/);

const workMap = acquisition.marketing.workMap;
const capabilityIds = acquisition.capabilities.map((capability) => capability.key);
assert.deepEqual(validateAgentWorkMapDefinition(workMap, capabilityIds), []);

assert.deepEqual(
  workMap.nodes.map((node) => node.id),
  [
    "founder_ip_acquisition",
    "baolu_ip_advisor",
    "topic_system",
    "content_system",
    "traffic_system",
    "video_review_system",
    "live_system",
    "live_review_system"
  ]
);
const founderRoot = workMap.nodes.find((node) => node.id === "founder_ip_acquisition");
assert.deepEqual(founderRoot?.action, { type: "static" }, "Founder IP acquisition must be a non-clickable map root");
assert.equal(founderRoot?.title, "创始人IP获客系统");
assert.equal(workMap.nodes.find((node) => node.id === "topic_system")?.title, "选题系统");
assert.equal(workMap.nodes.find((node) => node.id === "content_system")?.title, "内容系统");
assert.equal(workMap.nodes.find((node) => node.id === "traffic_system")?.title, "投流系统");
assert.equal(workMap.nodes.find((node) => node.id === "video_review_system")?.title, "视频复盘系统");
assert.equal(workMap.nodes.find((node) => node.id === "live_system")?.title, "直播系统");
assert.equal(workMap.nodes.find((node) => node.id === "live_review_system")?.title, "直播复盘系统");

assert(workMap.edges.some((edge) => edge.from === "video_review_system" && edge.to === "topic_system" && edge.type === "feedback"));
assert(!workMap.nodes.some((node) => /^fip_(?:franchise|store_visit|student|partner)_goal$/.test(node.id)), "Four acquisition goals must be selected only inside the topic Brief, not in the work map");
assert(!workMap.edges.some((edge) => /^fip-(?:franchise|store|student|partner)-topic$/.test(edge.id)), "The work map must not retain four-goal entry edges");
for (const branchTarget of ["topic_system", "live_system", "baolu_ip_advisor"]) {
  assert(workMap.edges.some((edge) => edge.from === "founder_ip_acquisition" && edge.to === branchTarget && edge.type === "branch"), `Founder root must branch to ${branchTarget}`);
}
const founderLive = workMap.edges.find((edge) => edge.from === "founder_ip_acquisition" && edge.to === "live_system");
const founderBranches = workMap.edges
  .filter((edge) => edge.from === "founder_ip_acquisition" && edge.type === "branch")
  .map((edge) => edge.label)
  .sort();
assert.deepEqual(founderBranches, ["独立答疑", "直播分支", "视频分支"].sort(), "FIP root branches must be 视频分支、直播分支、独立答疑");
assert.deepEqual(founderLive?.waypoints ?? [], [], "Founder-to-live must be a direct line that cannot pass through 问问保禄");
assert(!workMap.edges.some((edge) => edge.from === "baolu_ip_advisor" && edge.to === "topic_system"), "问问保禄 must remain an independent task card");
assert(!workMap.edges.some((edge) => edge.from === "baolu_ip_advisor" && edge.to === "live_system"), "问问保禄 must not connect to 直播系统");
assert(!workMap.edges.some((edge) => edge.from === "topic_system" && edge.to === "live_system"), "直播系统 must be a direct Founder IP branch, not a child of the topic flow");
assert(!workMap.nodes.some((node) => node.id === "ip_positioning_system"), "品牌获客地图不应出现 IP 定位节点");

const storeAcquisition = AGENT_DEFINITIONS.find((agent) => agent.slug === "store-acquisition");
assert(storeAcquisition?.marketing.workMap, "store acquisition work map missing");
assert.equal(storeAcquisition.name, "思潼·门店获客智能体");
assert.match(storeAcquisition.marketing.workMap.title, /门店获客/);
assert.deepEqual(validateAgentWorkMapDefinition(storeAcquisition.marketing.workMap, storeAcquisition.capabilities.map((capability) => capability.key)), []);
assert(workMap.edges.some((edge) => edge.from === "live_review_system" && edge.to === "live_system" && edge.type === "feedback"));

const invalidMap = {
  ...workMap,
  edges: [...workMap.edges, { id: "broken", from: "missing", to: "topic_system", type: "flow" as const }]
};
assert(validateAgentWorkMapDefinition(invalidMap, capabilityIds).includes("work_map_edge_from_unknown:broken:missing"));

const takeaway = AGENT_DEFINITIONS.find((agent) => agent.slug === "takeaway-growth");
assert(takeaway?.marketing.workMap, "takeaway work map missing");
const takeawayCapabilityIds = takeaway.capabilities.map((capability) => capability.key);
assert.deepEqual(validateAgentWorkMapDefinition(takeaway.marketing.workMap, takeawayCapabilityIds), []);
const takeawayFoundation = takeaway.marketing.workMap.nodes.find((node) => node.id === "takeaway_knowledge");
assert.deepEqual(takeawayFoundation?.action, { type: "capability", capabilityId: "takeaway_data_foundation" });
assert(!takeaway.marketing.workMap.nodes.some((node) => node.action.type === "knowledge"), "every takeaway task card must open an independent task page");
assert.deepEqual(
  takeaway.marketing.workMap.nodes.map((node) => node.id),
  [
    "takeaway_knowledge",
    "takeaway_growth",
    "takeaway_problem_validation",
    "takeaway_growth_plan",
    "takeaway_execution",
    "takeaway_effect_evaluation",
    "takeaway_review"
  ],
  "经营阶段是诊断上下文，不应继续作为绕过AI诊断的分支节点"
);
const expectedTakeawayFlow = [
  ["takeaway_knowledge", "takeaway_growth"],
  ["takeaway_growth", "takeaway_problem_validation"],
  ["takeaway_problem_validation", "takeaway_growth_plan"],
  ["takeaway_growth_plan", "takeaway_execution"],
  ["takeaway_execution", "takeaway_effect_evaluation"],
  ["takeaway_effect_evaluation", "takeaway_review"]
] as const;
expectedTakeawayFlow.forEach(([from, to]) => {
  assert(takeaway.marketing.workMap?.edges.some((edge) => edge.from === from && edge.to === to && edge.type === "flow"), `${from} must flow to ${to}`);
});
assert(takeaway.marketing.workMap.edges.some((edge) => edge.from === "takeaway_review" && edge.to === "takeaway_growth" && edge.type === "feedback"));
assert(!takeaway.marketing.workMap.nodes.some((node) => ["mature_store_growth", "new_store_breakthrough", "takeaway_menu_profit", "takeaway_campaign_roi", "takeaway_competitor_loss"].includes(node.id)), "经营阶段和专业工具不应挤占主流程任务节点");

const agentProductsSource = readFileSync(new URL("../apps/web/src/pages/AgentProductsApp.tsx", import.meta.url), "utf8");
const workMapComponentSource = readFileSync(new URL("../apps/web/src/components/work-map/AgentWorkMap.tsx", import.meta.url), "utf8");
const myAiSource = agentProductsSource.slice(
  agentProductsSource.indexOf("export function MyAiPage()"),
  agentProductsSource.indexOf("export function AccountCenterPage()")
);
assert.match(myAiSource, /<AgentCardGrid agents=\{owned\}/, "my-ai should display every entitled agent");
assert.doesNotMatch(myAiSource, /filter\(\(agent\) => agent\.slug === "takeaway-growth"\)/, "my-ai must not hide acquisition behind a takeaway-only filter");
assert.match(agentProductsSource, /if \(agent\?\.marketing\?\.workMap && !requestedAcquisitionSystem\) setWorkMapOpen\(true\)/, "work map should be the default agent entry without reopening over a direct system page");
assert.match(agentProductsSource, /onSwitchAgent=\{\(\) => navigate\("\/my-ai"\)\}/, "work map should provide a visible agent switch entry");
assert.match(workMapComponentSource, /if \(node\.action\.type === "static"\) \{[\s\S]{0,700}return <div/, "Static work-map roots must render as non-clickable cards");
assert.match(workMapComponentSource, /"这是业务总入口，不直接执行任务"/, "Static work-map roots must describe that they do not execute a task");

console.log("agent work map smoke passed");
