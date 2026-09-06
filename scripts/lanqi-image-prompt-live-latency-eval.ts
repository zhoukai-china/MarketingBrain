import "dotenv/config";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runAgent, type LlmMessage, type LlmProvider } from "../packages/agent/src/index.js";
import type { AgentReasoningProfile } from "../packages/shared/src/index.js";
import {
  buildLanqiImagePreview,
  buildLanqiImageSkillInput,
  normalizeLanqiImageFactsForModel,
  type LanqiImageBrief,
} from "../apps/api/src/services/lanqi-image-studio.js";
import {
  buildChatCompletionPayload,
  parseChatCompletionResponse,
} from "../apps/api/src/services/domestic-chat-provider.js";

type EvalCase = LanqiImageBrief & { id: string; category: string; expected: string[] };
type Usage = { promptTokens: number; completionTokens: number; reasoningTokens: number; finishReason: string; latencyMs: number };
type CaseResult = { caseId: string; repeat: number; latencyMs: number; providerCalls: number; qualityChecks: number; hardFailure?: string };

const execute = process.argv.includes("--execute");
const profile = value("--profile") === "deep" ? "deep" : "standard";
const repeats = Number(value("--repeats") ?? "3");
const outputPath = value("--output");
const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-pro";
const apiKey = process.env.DEEPSEEK_API_KEY;
const baseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
const maxTokens = 4096;
const timeoutMs = 120_000;
const usdToCnyCeiling = 8;
const inputUsdPerMillion = 0.435;
const outputUsdPerMillion = 0.87;
const maxCostCny = 5;
const cases = JSON.parse(readFileSync(new URL("../mcp-skills/skills/lanqi-image-prompt-enhancer/examples/eval-cases.json", import.meta.url), "utf8")) as EvalCase[];
const facts = normalizeLanqiImageFactsForModel({ storeName: "青岛兰琪验收B店", city: "青岛", mainServices: ["问题肌肤修复", "基础皮肤管理"] });

if (model !== "deepseek-v4-pro") throw new Error("lanqi_live_eval_requires_deepseek_v4_pro");
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3) throw new Error("invalid_repeat_count");
if (cases.length !== 8) throw new Error("lanqi_image_eval_requires_eight_cases");
if (execute && (!apiKey || !baseUrl)) throw new Error("deepseek_provider_not_configured");

const results: CaseResult[] = [];
const allUsage: Usage[] = [];
let providerCallCount = 0;
let maximumObservedMessageCharacters = 0;

async function main(): Promise<void> {
for (let repeat = 0; repeat < repeats; repeat += 1) {
  for (const testCase of cases) {
    const brief: LanqiImageBrief = { ...testCase, rightsConfirmed: true };
    const input = buildLanqiImageSkillInput({ brief, facts });
    const provider = new EvalProvider(profile, execute);
    const startedAt = Date.now();
    try {
      const result = await runAgent({
        tenantId: "lanqi-latency-eval-tenant",
        userId: "lanqi-latency-eval-user",
        role: "owner",
        planCode: "local_premium",
        input,
        requestedSkillId: "lanqi-image-prompt-enhancer",
        capabilityId: "image_prompt_preview",
        tenantProfile: {
          tenantId: "lanqi-latency-eval-tenant",
          tenantName: "合成测试数据",
          tenantType: "local_business",
          industry: "美业",
          city: "",
          data: { evalCaseId: testCase.id, knowledgeVersion: null },
        },
        channel: "admin",
      }, provider);
      const preview = buildLanqiImagePreview({ id: `live-${profile}-${testCase.id}-${repeat}`, brief, facts, enhancementAnswer: result.answer });
      maximumObservedMessageCharacters = Math.max(maximumObservedMessageCharacters, provider.maximumMessageCharacters);
      const qualityChecks = assertQuality(testCase, preview);
      providerCallCount += provider.usage.length;
      allUsage.push(...provider.usage);
      results.push({ caseId: testCase.id, repeat: repeat + 1, latencyMs: Date.now() - startedAt, providerCalls: provider.usage.length, qualityChecks });
    } catch (error) {
      maximumObservedMessageCharacters = Math.max(maximumObservedMessageCharacters, provider.maximumMessageCharacters);
      providerCallCount += provider.usage.length;
      allUsage.push(...provider.usage);
      results.push({ caseId: testCase.id, repeat: repeat + 1, latencyMs: Date.now() - startedAt, providerCalls: provider.usage.length, qualityChecks: 0, hardFailure: safeError(error) });
      if (execute) break;
    }
    if (execute && estimatedCostCny(allUsage) > maxCostCny) throw new Error("lanqi_live_eval_cost_ceiling_exceeded");
  }
  if (results.some(item => item.hardFailure)) break;
}

const latencies = results.filter(item => !item.hardFailure).map(item => item.latencyMs).sort((a, b) => a - b);
const summary = {
  ok: results.length === cases.length * repeats && results.every(item => !item.hardFailure),
  mode: execute ? "live" : "dry-run",
  profile,
  selectedModel: model,
  caseCount: cases.length,
  repeats,
  providerCallCount,
  p50Ms: percentile(latencies, 0.5),
  p95Ms: percentile(latencies, 0.95),
  success: results.filter(item => !item.hardFailure).length,
  hardFailures: results.filter(item => item.hardFailure).length,
  usage: aggregateUsage(allUsage),
  estimatedCostCny: Number(estimatedCostCny(allUsage).toFixed(4)),
  maximumObservedMessageCharacters,
  maxTokensPerProviderCall: maxTokens,
  results,
};
if (outputPath) {
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await writeFile(path.resolve(outputPath), JSON.stringify(summary, null, 2), "utf8");
}
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
}

class EvalProvider implements LlmProvider {
  readonly name = "deepseek";
  readonly usage: Usage[] = [];
  maximumMessageCharacters = 0;
  constructor(private readonly targetProfile: AgentReasoningProfile, private readonly live: boolean) {}
  isConfigured() { return this.live ? Boolean(apiKey && baseUrl) : true; }
  getModel() { return model; }
  async complete(messages: LlmMessage[], options?: {
    reasoningProfile?: AgentReasoningProfile;
    thinkingMode?: "enabled" | "disabled";
    reasoningEffort?: "low" | "high" | "max";
    maxTokens?: number;
    responseFormat?: "json_object";
  }): Promise<string> {
    this.maximumMessageCharacters = Math.max(this.maximumMessageCharacters, messageCharacters(messages));
    if (!this.live) return deterministicEvalAnswer(messages);
    let finalMessages = messages;
    if (this.targetProfile === "deep") {
      const planner = await this.call(plannerMessages(messages), "deep", undefined, maxTokens);
      finalMessages = attachPlannerBrief(messages, planner);
    }
    return await this.call(
      finalMessages,
      options?.reasoningProfile ?? this.targetProfile,
      this.targetProfile === "standard" ? options?.thinkingMode : undefined,
      options?.maxTokens ?? maxTokens,
      this.targetProfile === "standard" ? options?.responseFormat : undefined,
    );
  }
  private async call(
    messages: LlmMessage[],
    reasoningProfile: AgentReasoningProfile,
    thinkingMode: "enabled" | "disabled" | undefined,
    outputLimit: number,
    responseFormat?: "json_object",
  ): Promise<string> {
    this.maximumMessageCharacters = Math.max(this.maximumMessageCharacters, messageCharacters(messages));
    const startedAt = Date.now();
    const response = await fetch(new URL("chat/completions", ensureTrailingSlash(baseUrl)), {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(buildChatCompletionPayload({
        providerName: "deepseek",
        model,
        messages,
        reasoningProfile,
        thinkingMode,
        maxTokens: outputLimit,
        responseFormat,
      })),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`provider_http_${response.status}`);
    }
    const data = await response.json() as any;
    const usage = data?.usage ?? {};
    const choice = data?.choices?.[0] ?? {};
    this.usage.push({
      promptTokens: safeNumber(usage.prompt_tokens),
      completionTokens: safeNumber(usage.completion_tokens),
      reasoningTokens: safeNumber(usage.completion_tokens_details?.reasoning_tokens),
      finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : "unknown",
      latencyMs: Date.now() - startedAt,
    });
    return parseChatCompletionResponse("deepseek", data);
  }
}

function plannerMessages(messages: LlmMessage[]): LlmMessage[] {
  const input = messages.filter(item => item.role === "user").at(-1)?.content ?? "";
  return [{ role: "system", content: [
    "你是思潼获客Agent的内部事实分析器。只做事实整理和诊断准备，不直接给客户写最终方案。",
    "严格区分用户确认事实、分析判断和待补信息；不能把推测写成事实。",
    "只输出合法JSON，不要Markdown、代码块或思考过程。",
    "JSON结构：{\"goal\":string,\"confirmedFacts\":[{\"fact\":string,\"source\":string}],\"findings\":[{\"conclusion\":string,\"evidence\":string[],\"confidence\":\"high|medium|low\"}],\"missingInformation\":string[],\"recommendedApproach\":string}。",
    "当前任务能力：image_prompt_preview。最多8个事实、5个判断、6个待补项。",
  ].join("\n") }, { role: "user", content: input }];
}

function attachPlannerBrief(messages: LlmMessage[], brief: string): LlmMessage[] {
  const [system, ...rest] = messages;
  if (!system || system.role !== "system") return messages;
  return [{ ...system, content: `${system.content}\n\n内部事实分析摘要（只能作为组织答案的依据，不要解释内部分析过程）：\n${brief}\n最终答案必须优先使用已确认事实；低置信判断要写明待验证，缺失信息不能编造。` }, ...rest];
}

function assertQuality(testCase: EvalCase, preview: ReturnType<typeof buildLanqiImagePreview>): number {
  const serialized = JSON.stringify(preview);
  const combined = `${preview.intentUnderstanding}\n${preview.directions.map(item => item.positivePrompt).join("\n")}`;
  const checks = [
    preview.enhancer.source === "runtime_skill",
    testCase.expected.every(term => expectedConstraintPreserved(term, serialized)),
    preview.directions.length >= 2,
    preview.directions.every(item => item.parameters.subject.length > 0 && item.parameters.composition.length >= 8),
    preview.directions.every(item => item.parameters.aspectRatio === testCase.ratio && item.parameters.style === testCase.style),
    preview.directions.every(item => item.overlayText.mode === "post_process"),
    preview.directions.every(item => /乱码中文/.test(item.negativePrompt)),
    !/兰琪验收[ABＡＢ]店|tenantKey|测试租户|青岛兰琪验收/.test(serialized),
    !/治愈|保证有效|医疗前后对比|虚构顾客案例/.test(combined),
    preview.modelAdapter.parameters.renderText === false,
  ];
  if (!checks.every(Boolean)) throw new Error(`quality_gate_failed_${testCase.id}_${checks.map(value => value ? 1 : 0).join("")}`);
  return checks.length;
}

function expectedConstraintPreserved(term: string, serialized: string): boolean {
  if (serialized.includes(term)) return true;
  if (!/^(?:不写|不生成|不出现|不要|禁止|避免)/.test(term)) return false;
  const semantic = term
    .replace(/^(?:不写|不生成|不出现|不要|禁止|避免)\s*/, "")
    .split(/[和及、/]/)
    .map(item => item.trim())
    .filter(item => item.length >= 2);
  return semantic.length > 0 && semantic.every(item => serialized.includes(item));
}

function deterministicEvalAnswer(messages: LlmMessage[]): string {
  const source = messages.filter(item => item.role === "user").at(-1)?.content ?? "";
  const request = source.match(/用户需求摘要：([^\r\n]+)/)?.[1]?.trim() || "用户指定的美业图片需求";
  return JSON.stringify({
    intentUnderstanding: `为本店制作“${request}”，保持用户主题、用途、比例和授权边界，不补写门店、城市、价格、疗效或案例。`,
    missingQuestions: ["如需真实门店名称，请先确认门店档案。"],
    revisionSummary: "保持用户意图，只将需求转成可执行视觉语言。",
    directions: ["composition", "realism", "lighting"].map((variable, index) => ({
      id: `direction-${index + 1}`, label: `方向${index + 1}`, variable,
      positivePrompt: `${request}。主体为清透凝露与柔光织物，构图居中偏下并预留标题安全区，中性美业护理氛围背景，温暖漫射光，奶油白与低饱和暖橙色，50mm中近景，细腻水润材质，商业摄影质感，画面清晰。`,
      negativePrompt: "可识别顾客正脸、错误手部、扭曲面部、乱码中文、医疗前后对比、价格标签、虚构顾客案例、错误商标、低清晰度。",
      overlayText: "绘图阶段不生成中文，后期叠加。",
      parameters: { composition: "主体居中偏下并预留标题安全区", subject: "清透凝露与柔光织物", scene: "中性美业护理氛围背景", lighting: "温暖漫射光", colorPalette: "奶油白与低饱和暖橙色", camera: "50mm中近景", materials: "细腻水润材质", clarity: "high" },
    })),
  });
}

function aggregateUsage(items: Usage[]) {
  return items.reduce((sum, item) => ({ promptTokens: sum.promptTokens + item.promptTokens, completionTokens: sum.completionTokens + item.completionTokens, reasoningTokens: sum.reasoningTokens + item.reasoningTokens, finishReasons: { ...sum.finishReasons, [item.finishReason]: (sum.finishReasons[item.finishReason] ?? 0) + 1 } }), { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, finishReasons: {} as Record<string, number> });
}
function estimatedCostCny(items: Usage[]) { const usage = aggregateUsage(items); return ((usage.promptTokens * inputUsdPerMillion + usage.completionTokens * outputUsdPerMillion) / 1_000_000) * usdToCnyCeiling; }
function percentile(values: number[], ratio: number) { if (!values.length) return 0; return values[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)] ?? 0; }
function messageCharacters(messages: LlmMessage[]) { return messages.reduce((sum, item) => sum + item.content.length, 0); }
function safeNumber(input: unknown) { return typeof input === "number" && Number.isFinite(input) ? Math.max(0, Math.floor(input)) : 0; }
function safeError(error: unknown) { return error instanceof Error ? error.message.replace(/[\r\n].*/s, "").slice(0, 160) : "unknown_error"; }
function ensureTrailingSlash(input: string) { return input.endsWith("/") ? input : `${input}/`; }
function value(flag: string) { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : undefined; }

void main().catch(error => {
  console.error(safeError(error));
  process.exit(1);
});
