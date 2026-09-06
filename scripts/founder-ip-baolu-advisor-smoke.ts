import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { AGENT_DEFINITIONS } from "../apps/api/src/services/agent-definitions.js";
import { routeSkill } from "../packages/agent/src/index.js";

const page = readFileSync(new URL("../apps/web/src/pages/AgentProductsApp.tsx", import.meta.url), "utf8");
const prompt = readFileSync(new URL("../packages/skills/skills/baolu_ip_advisor/prompt.md", import.meta.url), "utf8");
const contract = readFileSync(new URL("../packages/skills/skills/baolu_ip_advisor/contract.json", import.meta.url), "utf8");
const originalSkillPath = new URL("../mcp-skills/skills/baolu_ip_advisor/SKILL.md", import.meta.url);
const founderIp = AGENT_DEFINITIONS.find((agent) => agent.id === "agent_acquisition");

assert(founderIp, "founder IP agent is missing");
const advisor = founderIp.capabilities.find((item) => item.key === "baolu_ip_advisor");
assert(advisor, "问问保禄 must be an explicit Founder IP capability");
assert.equal(advisor.skillId, "baolu_ip_advisor", "问问保禄 must lock to the Baolu advisor twin skill");
assert.match(advisor.promptTemplate, /不得.*(?:冒充保禄本人|外部动作)/, "advisor must not impersonate Baolu or execute external actions");
assert.match(founderIp.marketing.workMap?.nodes.find((node) => node.action.type === "capability" && node.action.capabilityId === "baolu_ip_advisor")?.title ?? "", /问问保禄/, "work map must expose 问问保禄");
assert.match(page, /问问保禄/, "Founder IP sidebar must expose 问问保禄");
assert.match(page, /baolu_ip_advisor/, "Founder IP page must route 问问保禄 to its dedicated capability");
assert.equal(routeSkill("我想问问保禄：新媒体起号前三条应该怎么拍？", "baolu_ip_advisor"), "baolu_ip_advisor");
assert.match(prompt, /新媒体|创始人IP/, "advisor skill must be scoped to new media and Founder IP");
assert.match(prompt, /不冒充保禄本人/, "advisor skill must disclose the twin boundary");
assert.match(contract, /不编造/, "advisor contract must prevent fabricated facts");
assert.ok(existsSync(originalSkillPath), "registered FIP advisor must have an original mcp-skills asset so database API catalog startup cannot fail");
const originalSkill = readFileSync(originalSkillPath, "utf8");
assert.match(originalSkill, /^---[\s\S]*name:\s*baolu_ip_advisor/m, "original FIP advisor skill must retain its registered id");
assert.match(originalSkill, /不冒充保禄本人/, "original FIP advisor skill must preserve the twin boundary");

console.log("founder_ip_baolu_advisor_smoke:PASS");
