import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resolveAgentMaxTokens,
  resolveAgentReasoningProfile,
  resolveAgentResponseFormat,
  resolveAgentThinkingMode,
} from "../packages/agent/src/index.js";
import { resolveReasoningProfile as resolveApiReasoningProfile } from "../apps/api/src/services/structured-delivery.js";
import { buildChatCompletionPayload } from "../apps/api/src/services/domestic-chat-provider.js";
import {
  assertLanqiProfessionalTextModel,
  resolveLanqiRuntimeModelPolicy,
} from "../apps/api/src/services/lanqi-runtime-model-policy.js";

const schema = readFileSync(new URL("../packages/db/prisma/schema.prisma", import.meta.url), "utf8");
const mediaRoute = readFileSync(new URL("../apps/api/src/routes/lanqi-media-generation.ts", import.meta.url), "utf8");
const imagePage = readFileSync(new URL("../apps/web/src/pages/LanqiImageStudioPage.tsx", import.meta.url), "utf8");
const contentPage = readFileSync(new URL("../apps/web/src/pages/LanqiContentStudioPage.tsx", import.meta.url), "utf8");

assert.equal(resolveAgentReasoningProfile("xiaohongshu_copy", "xiaohongshu_ops"), "deep", "小红书专业综合必须使用 reasoning_high/deep");
assert.equal(resolveAgentReasoningProfile("image_prompt_preview"), "standard", "本地图片 capability 必须使用有界 standard reasoning");
assert.equal(resolveAgentReasoningProfile(undefined, "lanqi-image-prompt-enhancer"), "standard", "本地图片 Skill 必须使用有界 standard reasoning");
assert.equal(resolveAgentReasoningProfile("image_prompt_preview", "lanqi-image-prompt-enhancer"), "standard", "本地图片 capability + Skill 必须使用有界 standard reasoning");
assert.equal(resolveAgentThinkingMode("image_prompt_preview", "lanqi-image-prompt-enhancer"), "disabled", "图片提示词必须显式关闭 V4 Pro 默认深度思考");
assert.equal(resolveAgentMaxTokens("image_prompt_preview", "lanqi-image-prompt-enhancer"), 4096, "图片提示词必须限制结构化输出 token 上限");
assert.equal(resolveAgentResponseFormat("image_prompt_preview", "lanqi-image-prompt-enhancer"), "json_object", "图片提示词必须使用 Provider 严格 JSON 输出");
assert.deepEqual(buildChatCompletionPayload({
  providerName: "deepseek",
  model: "deepseek-v4-pro",
  messages: [{ role: "user", content: "输出 JSON" }],
  reasoningProfile: "standard",
  thinkingMode: "disabled",
  maxTokens: 4096,
  responseFormat: "json_object",
}), {
  model: "deepseek-v4-pro",
  messages: [{ role: "user", content: "输出 JSON" }],
  thinking: { type: "disabled" },
  temperature: 0.3,
  max_tokens: 4096,
  response_format: { type: "json_object" },
}, "图片提示词 Provider 参数必须序列化为 non-thinking 严格 JSON 请求");
assert.equal(resolveApiReasoningProfile("xiaohongshu_copy", "xiaohongshu_ops"), "deep", "远程 MCP 小红书路径必须使用 reasoning_high/deep");
assert.equal(resolveApiReasoningProfile("image_prompt_preview"), "standard", "远程 MCP 图片 capability 必须使用有界 standard reasoning");
assert.equal(resolveApiReasoningProfile(undefined, "lanqi-image-prompt-enhancer"), "standard", "远程 MCP 图片 Skill 必须使用有界 standard reasoning");
assert.equal(resolveApiReasoningProfile("image_prompt_preview", "lanqi-image-prompt-enhancer"), "standard", "远程 MCP 图片 capability + Skill 必须使用有界 standard reasoning");

const professional = resolveLanqiRuntimeModelPolicy("professional_prompt_enhancement", false);
assert.deepEqual(professional, { model: "deepseek-v4-pro", reasoningTag: "reasoning_high", reasoningProfile: "deep" });
const unapprovedLowRisk = resolveLanqiRuntimeModelPolicy("low_risk_formatting", false);
assert.equal(unapprovedLowRisk.model, "deepseek-v4-pro", "Flash Eval 未批准前低风险任务也必须保留 Pro");
const approvedLowRisk = resolveLanqiRuntimeModelPolicy("low_risk_formatting", true);
assert.deepEqual(approvedLowRisk, { model: "deepseek-v4-flash", reasoningTag: "reasoning_standard", reasoningProfile: "standard" });
assert.throws(() => assertLanqiProfessionalTextModel({ name: "deepseek", getModel: () => "deepseek-v3", complete: async () => "" }), /lanqi_pro_model_required/);
assert.doesNotThrow(() => assertLanqiProfessionalTextModel({ name: "deepseek", getModel: () => "deepseek-v4-pro", complete: async () => "" }));

assert.match(schema, /provider\s+String/, "媒体任务必须持久化实际 Provider");
assert.match(schema, /promptVersion\s+String/, "媒体任务必须持久化提示词版本");
assert.match(mediaRoute, /provider:\s*quote\.provider/, "创建媒体任务时必须保存 Provider");
assert.match(mediaRoute, /promptVersion:\s*input\.promptVersion/, "创建媒体任务时必须保存提示词版本");
assert.match(mediaRoute, /loadLanqiImagePreview/, "媒体任务必须由服务端恢复并校验当前租户的专业提示词预览");
assert.match(imagePage, /受控草稿（专业模型未完成）/, "图片提示词降级时必须明确标识受控草稿");
assert.match(contentPage, /受控草稿（专业模型未完成）/, "小红书降级时必须明确标识受控草稿");

console.log("Lanqi runtime model policy eval passed: Pro model, bounded standard image prompting, deep Xiaohongshu, gated Flash, traceable media jobs.");
