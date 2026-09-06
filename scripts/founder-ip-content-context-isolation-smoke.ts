import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { buildAgentMessages } from "../packages/agent/src/index.ts";

const pagePath = new URL("../apps/web/src/pages/AgentProductsApp.tsx", import.meta.url);
const routesPath = new URL("../apps/api/src/routes/agents.ts", import.meta.url);
const generatorPath = new URL("../apps/api/src/services/founder-ip-content-generation.ts", import.meta.url);
const definitionsPath = new URL("../apps/api/src/services/agent-definitions.ts", import.meta.url);
const dedicatedSkillPromptPath = new URL("../packages/skills/skills/founder_ip_content_creator/prompt.md", import.meta.url);
const dedicatedMcpSkillPath = new URL("../mcp-skills/skills/founder_ip_content_creator/SKILL.md", import.meta.url);
const page = readFileSync(pagePath, "utf8");
const routes = readFileSync(routesPath, "utf8");

assert.ok(existsSync(generatorPath), "FIP 内容生成必须有产品专属服务，不能继续借用通用工作台会话");
assert.match(page, /generateFounderIpContentDraft/, "FIP 草稿生成必须走专属客户端适配层");
assert.match(page, /founder-ip-content-drafts\/[^\n]*\/generate/, "FIP 草稿生成必须请求受租户保护的专属接口");
const fipOpenFlow = page.slice(page.indexOf("async function openFounderIpContentDraft"), page.indexOf("function trafficCapabilities"));
assert.match(fipOpenFlow, /generateFounderIpContentDraft\(data\.draft\.id\)/, "FIP 草稿创建后必须直接进入专属生成入口");
assert.doesNotMatch(fipOpenFlow, /runContentSystem\(/, "FIP 草稿不得再回到通用 send() 内容链");
assert.match(routes, /founder-ip-content-drafts\/:draftId\/generate/, "服务端必须提供按草稿 ID 隔离的 FIP 内容生成路由");

const generator = readFileSync(generatorPath, "utf8");
assert.match(generator, /history:\s*\[\]/, "FIP 内容生成必须显式使用空会话历史");
assert.match(generator, /capabilityLocked:\s*true/, "FIP 内容生成必须锁定内容 Skill，不能由旧输入重路由");
assert.match(generator, /validateFounderIpGeneratedContent/, "最终模型输出必须在服务端按 FIP 契约校验");
assert.match(generator, /founder_ip_content_provider_unavailable/, "模型未配置时必须明确阻断，不得返回通用内容模板");
assert.match(generator, /env\.DATA_MODE === "demo"/, "演示模型模式必须明确阻断，不得把通用演示内容交给用户");
assert.match(generator, /qualityFlags\.includes\("provider_fallback_used"\)/, "真实模型异常后的通用降级也必须明确阻断");
assert.match(generator, /招商加盟/, "生成契约必须覆盖招商加盟");
assert.match(generator, /C端团购到店/, "生成契约必须覆盖 C 端团购到店");
assert.match(generator, /学员招募/, "生成契约必须覆盖学员招募");
assert.match(generator, /合作方招募/, "生成契约必须覆盖合作方招募");

const definitions = readFileSync(definitionsPath, "utf8");
const acquisitionStart = definitions.indexOf('id: "agent_acquisition"');
const acquisitionEnd = definitions.indexOf('\n  {\n    id:', acquisitionStart + 1);
const acquisitionDefinition = definitions.slice(acquisitionStart, acquisitionEnd === -1 ? undefined : acquisitionEnd);
const contentPlanStart = acquisitionDefinition.indexOf('key: "content_plan"');
const contentPlanEnd = acquisitionDefinition.indexOf('\n      {', contentPlanStart + 1);
const contentPlanCapability = acquisitionDefinition.slice(contentPlanStart, contentPlanEnd === -1 ? undefined : contentPlanEnd);
assert.match(
  contentPlanCapability,
  /skillId:\s*"founder_ip_content_creator"/,
  "FIP content_plan 必须绑定产品专属轻量 Skill，不能继续加载通用 36KB 内容 Skill"
);
assert.ok(existsSync(dedicatedSkillPromptPath), "FIP 产品专属内容 Skill prompt 必须存在");
assert.ok(existsSync(dedicatedMcpSkillPath), "FIP 产品专属内容 Skill 原始包必须存在，确保数据库模式可注册");

const dedicatedPrompt = readFileSync(dedicatedSkillPromptPath, "utf8");
assert.ok(Buffer.byteLength(dedicatedPrompt, "utf8") < 8_000, "FIP 内容 Skill 必须保持小于 8KB，避免通用九栏目上下文稀释当前选题");
assert.match(dedicatedPrompt, /逐字保留.*选题|选题.*逐字保留/, "专属 Skill 必须要求逐字保留当前选题/钩子");
assert.match(dedicatedPrompt, /来源依据/, "专属 Skill 必须保留来源依据与事实边界");
assert.match(dedicatedPrompt, /获客目标/, "专属 Skill 必须锁定当前获客目标和承接动作");
assert.doesNotMatch(dedicatedPrompt, /十件套|九件套|EDL|DOU\+|本地推|投流预算/, "专属内容 Skill 不得混入通用内容执行包、拍剪或投流上下文");

buildAgentMessages({
  tenantId: "fip-isolation-tenant",
  userId: "fip-isolation-user",
  role: "owner",
  planCode: "ip_standard",
  requestedSkillId: "founder_ip_content_creator",
  capabilityId: "content_plan",
  input: "【创始人IP获客内容生成】\n获客目标：招商加盟\n选题/钩子：为什么加盟前先看真实交付边界",
  tenantProfile: {
    tenantId: "fip-isolation-tenant",
    tenantName: "旧门店默认画像",
    tenantType: "personal_ip",
    industry: "旧门店行业",
    city: "旧门店城市"
  },
  channel: "h5",
  history: []
}).then((prepared) => {
  const founderSystemPrompt = prepared.messages[0]?.content ?? "";
  assert.ok(founderSystemPrompt.length <= 5_000, `FIP 专属系统上下文必须保持小于 5000 字符，当前 ${founderSystemPrompt.length}`);
  assert.doesNotMatch(founderSystemPrompt, /旧门店默认画像|旧门店行业|旧门店城市/, "FIP 专属内容生成不得注入企业默认画像，避免旧上下文污染");
  assert.doesNotMatch(founderSystemPrompt, /本地商家默认目标|真人团队入企|Word 下载/, "FIP 专属内容生成不得加载通用咨询师交付契约");
  assert.match(founderSystemPrompt, /创始人 IP 获客内容生成/, "FIP 专属系统上下文必须保留当前专属 Skill");
  console.log("founder_ip_content_context_isolation_smoke:PASS");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
