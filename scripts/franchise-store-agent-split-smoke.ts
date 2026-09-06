import assert from "node:assert/strict";
import { AGENT_DEFINITIONS } from "../apps/api/src/services/agent-definitions.js";

const franchise = AGENT_DEFINITIONS.find((agent) => agent.slug === "acquisition");
const store = AGENT_DEFINITIONS.find((agent) => agent.slug === "store-acquisition");

assert(franchise, "founder IP acquisition compatibility agent definition missing");
assert.equal(franchise.name, "思潼·创始人IP获客系统");
assert.match(franchise.marketing.workMap?.title ?? "", /创始人IP获客/);
assert(["fip_franchise", "fip_store_visit", "fip_student_recruitment", "fip_partner_recruitment"].every((key) => franchise.capabilities.some((item) => item.key === key)));
assert(franchise.capabilities.some((item) => item.key === "baolu_ip_advisor" && item.skillId === "baolu_ip_advisor"));

assert(store, "store acquisition agent definition missing");
assert.equal(store.name, "思潼·门店获客智能体");
assert.match(store.marketing.workMap?.title ?? "", /门店获客/);
assert.match(JSON.stringify(store), /团购|到店/);

console.log("franchise_store_agent_split_smoke:PASS");
