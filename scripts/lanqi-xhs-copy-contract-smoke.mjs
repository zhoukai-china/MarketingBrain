import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(relativePath) {
  try {
    return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
}

const routeSource = read("apps/api/src/routes/lanqi-content-studio.ts");
const pageSource = read("apps/web/src/pages/LanqiContentStudioPage.tsx");
const sharedSource = read("packages/shared/src/index.ts");
const skillRegistrySource = read("packages/skills/src/index.ts");
const agentRegistrySource = read("packages/agent/src/index.ts");
const agentDefinitionsSource = read("apps/api/src/services/agent-definitions.ts");
const xhsPrompt = read("packages/skills/skills/xiaohongshu_ops/prompt.md");
const xhsContract = read("packages/skills/skills/xiaohongshu_ops/contract.json");
const xhsMcpSkill = read("mcp-skills/skills/xiaohongshu_ops/SKILL.md");

const failures = [];

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) failures.push(message);
}

function forbidMatch(source, pattern, message) {
  if (pattern.test(source)) failures.push(message);
}

requireMatch(xhsPrompt, /小红书运营 Skill/, "缺少本地小红书专用 Skill 方法论");
requireMatch(xhsContract, /"skillId":\s*"xiaohongshu_ops"/, "缺少小红书专用质量契约");
requireMatch(xhsMcpSkill, /^---[\s\S]*name:\s*xiaohongshu-ops/m, "缺少可由 MCP 加载的原始小红书 Skill 包");
requireMatch(routeSource, /invokeSkillViaGateway/, "兰琪小红书文案必须通过 MCP Skill 网关生成");
requireMatch(routeSource, /skillId:\s*"xiaohongshu_ops"/, "兰琪小红书文案尚未锁定 xiaohongshu_ops");
forbidMatch(routeSource, /skillId:\s*"baolu_content_creator"/, "兰琪小红书文案仍在调用通用内容 Skill");
requireMatch(routeSource, /capabilityLocked:\s*true/, "兰琪小红书文案入口必须锁定能力，不能被自由路由");

requireMatch(sharedSource, /\|\s*"xiaohongshu_ops"/, "xiaohongshu_ops 尚未加入共享 SkillId 契约");
requireMatch(skillRegistrySource, /xiaohongshu_ops:\s*\{/, "xiaohongshu_ops 尚未加入 Skill manifest");
requireMatch(agentRegistrySource, /"xiaohongshu_ops"/, "xiaohongshu_ops 尚未加入 Agent 运行时白名单和质量契约");
requireMatch(agentDefinitionsSource, /skillId:\s*"xiaohongshu_ops"/, "门店获客 Agent 尚未绑定小红书专用能力");
requireMatch(agentDefinitionsSource, /key:\s*"xiaohongshu_copy"/, "门店获客 Agent 尚未建立独立小红书文案能力");

requireMatch(pageSource, /这次想发什么/, "统一页面必须只保留一个自然语言需求入口");
requireMatch(pageSource, /"生成小红书图文"/, "主操作必须明确为生成完整小红书图文");
requireMatch(pageSource, /cause instanceof TypeError \? "网络暂时不可用/, "浏览器网络失败不得把 Failed to fetch 原样暴露给用户");
requireMatch(pageSource, /\/lanqi\/content-studio\/packages/, "小红书文案必须通过统一图文工作流交付");
forbidMatch(pageSource, /getAppPath\("\/lanqi\/image-studio"\)/, "用户主导航不得保留独立文生图入口");
forbidMatch(pageSource, /文生视频|图生视频|我还需要视频|图片与视频任务/, "统一图文页不得混入视频生成功能");
forbidMatch(pageSource, /阿里云|百炼|DashScope/, "用户界面不得暴露媒体供应商名称");
requireMatch(routeSource, /requestKey/, "小红书文案保存缺少重复请求幂等键");
requireMatch(routeSource, /createHash\("sha256"\).*context\.tenantId/s, "小红书文案幂等 ID 尚未按租户隔离");
requireMatch(routeSource, /knowledgeVersion/, "小红书文案生成没有显式注入兰琪知识版本状态");
requireMatch(routeSource, /toPublicDraft/, "小红书文案接口尚未过滤内部图片和视频提示字段");
for (const event of ["requested", "succeeded", "needs_input", "failed"]) {
  requireMatch(routeSource, new RegExp(`lanqi_xhs_copy\\.${event}`), `缺少可观测事件 lanqi_xhs_copy.${event}`);
}

if (failures.length > 0) {
  console.error("lanqi xhs copy contract: FAIL");
  failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
  process.exit(1);
}

console.log("lanqi xhs copy contract: PASS");
