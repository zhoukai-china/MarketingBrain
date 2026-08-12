import assert from "node:assert/strict";
import { AGENT_DEFINITIONS } from "../apps/api/src/services/agent-definitions.js";

const franchise = AGENT_DEFINITIONS.find((agent) => agent.slug === "acquisition");
const store = AGENT_DEFINITIONS.find((agent) => agent.slug === "store-acquisition");

assert(franchise, "brand franchise agent definition missing");
assert.equal(franchise.name, "思潼·品牌招商智能体");
assert.match(franchise.marketing.workMap?.title ?? "", /品牌招商/);
assert.match(franchise.capabilities.map((item) => item.promptTemplate).join("\n"), /不得生成门店到店|不得生成面向消费者/);

assert(store, "store acquisition agent definition missing");
assert.equal(store.name, "思潼·门店获客智能体");
assert.match(store.marketing.workMap?.title ?? "", /门店获客/);
assert.match(JSON.stringify(store), /团购|到店/);

console.log("franchise_store_agent_split_smoke:PASS");
