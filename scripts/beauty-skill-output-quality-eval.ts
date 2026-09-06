import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runAgent, type LlmMessage, type LlmProvider } from "../packages/agent/src/index.js";
import { buildChatCompletionPayload, parseChatCompletionResponse } from "../apps/api/src/services/domestic-chat-provider.js";

type Usage = {
  caseId: string;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  finishReason: string;
  latencyMs: number;
};

type EvalCase = {
  id: string;
  title: string;
  source: "live_pro" | "controlled_zero_cost";
  capabilityId: string;
  skillId: Parameters<typeof runAgent>[0]["requestedSkillId"];
  input: string;
  required: RegExp[];
};

const execute = process.argv.includes("--execute");
const outputPath = value("--output") ?? "reports/beauty-industry/BY-03-output-quality-results.json";
const replaySourcePath = value("--replay-source");
const selectedCaseIds = new Set((value("--case") ?? "").split(",").map((item) => item.trim()).filter(Boolean));
const model = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-pro";
const apiKey = process.env.DEEPSEEK_API_KEY;
const baseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
const maxTokensPerCall = Number(value("--max-tokens") ?? "4096");
const maxProviderCostCny = Number(value("--cost-ceiling") ?? "1");
const inputUsdPerMillion = 0.435;
const outputUsdPerMillion = 0.87;
const usdToCnyCeiling = 8;
const maxProviderCalls = 10;
const maxInputTokensPerCall = 12_000;

const cases: EvalCase[] = [
  {
    id: "beauty-qa-compliance",
    title: "美业经营问答与疗效边界",
    source: "live_pro",
    capabilityId: "beauty_compliance_check",
    skillId: "beauty-industry-compliance",
    input: [
      "本店是生活美容门店，顾客常问痘痘能不能一次做完就好。",
      "请给前台一个可以直接回答顾客的版本，并说明哪些信息不能确认。",
      "已确认：只提供基础清洁、补水与舒缓护理；没有医疗资质、疗效数据、价格和顾客案例授权。"
    ].join("\n"),
    required: [/风险|边界/, /安全改写|可以直接|直接(?:能用|使用|回答)/, /医疗|治疗/, /待补|不能确认/]
  },
  {
    id: "acquisition-strategy",
    title: "社区美业门店获客策略",
    source: "live_pro",
    capabilityId: "beauty_acquisition_strategy",
    skillId: "beauty-industry-content-diff",
    input: [
      "为一家社区生活美容门店制定未来两周的获客重点。",
      "已确认：主营基础清洁和补水护理；目标是增加真实咨询与预约；可拍无顾客正脸的环境和服务步骤；没有确认城市、价格、优惠、历史投流数据和预约渠道。",
      "只给可执行的优先顺序、内容方向、承接待补和风险边界，不要替门店编数字。"
    ].join("\n"),
    required: [/行业目标|获客目标|优先/, /选题|内容/, /承接/, /待补/, /PREVIEW_ONLY|未执行(?:发布|投流)|不发布|不投流|不投付费|不急着投|预览/]
  },
  {
    id: "topic-ideas",
    title: "美业获客选题",
    source: "live_pro",
    capabilityId: "topic_inspiration",
    skillId: "beauty-industry-content-diff",
    input: [
      "请给社区生活美容门店 6 个适合小红书和短视频的获客选题。",
      "已确认服务只有基础清洁、日常补水和舒缓护理；目标顾客是附近工作节奏快、重视体验但担心推销的人；可拍用品、空间局部和已授权员工手部。",
      "价格、真实案例、顾客评价、城市和预约方式都未确认。选题要具体，不要把护理写成治疗。"
    ].join("\n"),
    required: [/选题/, /顾客|人群/, /护理|体验/, /待补|未确认/]
  },
  {
    id: "xiaohongshu-package",
    title: "小红书图文与三张配图方向",
    source: "live_pro",
    capabilityId: "beauty_xiaohongshu_package",
    skillId: "beauty-industry-xhs",
    input: [
      "做一篇夏季日常补水护理的小红书图文，语气温柔、真实、克制，目标是获得附近顾客的咨询。",
      "已确认：基础清洁与日常补水护理；可使用无人物的用品和空间局部；不出现顾客正脸。",
      "未确认门店名、城市、价格、优惠、案例、预约方式。请给 3 个标题、完整正文、标签、互动承接，以及封面图、内容图、互动承接图三张配图的正负提示词方向；只做提示词，不生成图片。"
    ].join("\n"),
    required: [/标题候选|标题/, /正文/, /话题标签|标签/, /互动/, /封面图/, /内容图/, /互动承接图/, /负向(?:视觉)?提示词/]
  },
  {
    id: "short-video-package",
    title: "短视频文案、拍摄脚本与 EDL",
    source: "controlled_zero_cost",
    capabilityId: "content_plan",
    skillId: "baolu_content_creator",
    input: [
      "请为生活美容门店做一条 60 秒短视频完整执行包，主题是“第一次做基础护理，先问清这几件事”。",
      "目标是降低顾客对强推销和不透明流程的顾虑。已确认可拍接待区、用品、服务流程和一名获授权员工；不拍顾客正脸。",
      "价格、优惠、顾客案例、疗效数据和发布时间表现均未确认。输出选题、完整口播、拍摄脚本、注意事项、剪辑 EDL、标题标签、发布时间建议依据、评论承接和投流 PREVIEW_ONLY 路由。"
    ].join("\n"),
    required: [/选题/, /口播|文案/, /拍摄脚本|镜号/, /剪辑EDL|EDL/, /标题|话题/, /评论|承接/, /PREVIEW_ONLY/]
  },
  {
    id: "paid-traffic-preview",
    title: "本地获客投流预览",
    source: "live_pro",
    capabilityId: "paid_traffic",
    skillId: "optimize_local_push_ads",
    input: [
      "请判断一条生活美容门店短视频是否适合做本地获客投流，只做 PREVIEW_ONLY。",
      "已确认：视频自然播放 1680、3 秒留存 46%、完播率 18%、点赞 31、评论 4、主页访问 12、咨询 2；目标是到店咨询；素材内容为基础护理流程，无价格和疗效承诺。",
      "未提供账户状态、可承接地域、预算上限、团购或落地页、真实到店数据。请给是否建议投、正确专项路由、最小待补、测试假设、监控与止损，不登录、不创建、不提交计划。"
    ].join("\n"),
    required: [/是否建议投|投流判断|投流结论/, /待补/, /监控|指标/, /止损/, /PREVIEW_ONLY|不提交/]
  },
  {
    id: "live-script",
    title: "美业到店直播话术",
    source: "controlled_zero_cost",
    capabilityId: "live_script",
    skillId: "live_script_planner",
    input: [
      "为生活美容门店写一份 20 分钟直播话术草稿。",
      "已确认：介绍基础清洁和日常补水护理、服务步骤、用品与环境；目标是让附近顾客了解流程并提出咨询。",
      "直播模式：本地生活门店服务介绍，不带货、不挂团购；主播身份：门店护理师；评论互动由主播口头回答。",
      "真实产品/套餐内容与核心卖点：暂无；本次只介绍已确认的服务流程和到店前顾虑，不销售产品或套餐。",
      "价格、优惠、疗效、预约方式和顾客案例未确认。不能自动开播或发布。"
    ].join("\n"),
    required: [/直播/, /开场|话术/, /护理|服务/, /待补|未确认/]
  },
  {
    id: "video-review",
    title: "短视频数据复盘",
    source: "controlled_zero_cost",
    capabilityId: "video_review",
    skillId: "baolu_review_engine",
    input: [
      "复盘本店最近 4 条生活美容短视频。以下是从后台导出的真实 CSV 明细：",
      "作品标题,播放量,3秒留存率,完播率,点赞量,评论量,私信咨询量",
      "基础清洁流程,2100,52%,24%,45,7,3",
      "门店环境,980,38%,17%,18,2,0",
      "补水知识,1640,49%,29%,36,5,1",
      "员工自我介绍,720,33%,14%,9,1,0",
      "没有到店、成交、发布时间和投流数据。请区分事实与判断，不把播放量写成到店。"
    ].join("\n"),
    required: [/数据质量|数据/, /视频分层|作品分层/, /播放|完播/, /咨询/, /到店|成交/, /待补|不能判断/]
  }
];

const usage: Usage[] = [];
let providerCalls = 0;

async function main() {
  if (model !== "deepseek-v4-pro") throw new Error("beauty_quality_eval_requires_deepseek_v4_pro");
  if (cases.length !== 8) throw new Error("beauty_quality_eval_requires_eight_cases");
  if (!Number.isFinite(maxProviderCostCny) || maxProviderCostCny <= 0) throw new Error("beauty_quality_eval_invalid_cost_ceiling");
  if (!Number.isFinite(maxTokensPerCall) || maxTokensPerCall < 1024 || maxTokensPerCall > 16384) throw new Error("beauty_quality_eval_invalid_max_tokens");
  const selectedCases = selectedCaseIds.size > 0 ? cases.filter((item) => selectedCaseIds.has(item.id)) : cases;
  if (selectedCases.length === 0 || selectedCases.length !== (selectedCaseIds.size || cases.length)) throw new Error("beauty_quality_eval_unknown_case");
  const replayOutputs = replaySourcePath ? await loadReplayOutputs(replaySourcePath) : undefined;
  const selectedProviderCallCeiling = Math.min(maxProviderCalls, selectedCases.filter((item) => item.source === "live_pro").length * 2);
  const preflightCost = estimateCost(selectedProviderCallCeiling * maxInputTokensPerCall, selectedProviderCallCeiling * maxTokensPerCall);
  if (preflightCost > maxProviderCostCny) throw new Error(`beauty_quality_eval_preflight_exceeds_ceiling:${preflightCost.toFixed(4)}`);
  if (execute && (!apiKey || !baseUrl)) throw new Error("deepseek_provider_not_configured");

  const results = [];
  for (const testCase of selectedCases) {
    const replayOutput = replayOutputs?.get(testCase.id);
    const provider = replayOutput !== undefined
      ? new ReplayProvider(replayOutput)
      : testCase.source === "live_pro"
        ? new LiveProvider(testCase.id)
        : new ZeroCostProvider(testCase.id);
    const startedAt = Date.now();
    try {
      const result = await runAgent({
        tenantId: "beauty-quality-eval-tenant",
        userId: "beauty-quality-eval-owner",
        role: "owner",
        planCode: "local_premium",
        requestedSkillId: testCase.skillId,
        capabilityId: testCase.capabilityId,
        input: testCase.input,
        tenantProfile: {
          tenantId: "beauty-quality-eval-tenant",
          tenantName: "当前门店",
          tenantType: "local_business",
          industry: "生活美容",
          data: { evalCaseId: testCase.id, synthetic: true }
        },
        channel: "admin"
      }, provider);
      const hardFailures = hardFailureChecks(testCase, result.answer);
      results.push({
        caseId: testCase.id,
        title: testCase.title,
        source: testCase.source,
        skillId: result.skillId,
        skillVersion: result.skillVersion,
        capabilityId: testCase.capabilityId,
        deliveryStatus: result.deliveryStatus,
        creditCost: result.creditCost,
        latencyMs: Date.now() - startedAt,
        providerCalls: provider.calls,
        hardFailures,
        output: result.answer
      });
    } catch (error) {
      results.push({ caseId: testCase.id, title: testCase.title, source: testCase.source, latencyMs: Date.now() - startedAt, providerCalls: provider.calls, hardFailures: [safeError(error)], output: "" });
    }
  }

  const summary = {
    ok: results.length === selectedCases.length && results.every(item => item.hardFailures.length === 0),
    mode: replayOutputs ? "saved-provider-replay" : execute ? "live-and-controlled" : "preflight",
    model,
    cases: selectedCases.length,
    selectedCaseIds: selectedCases.map((item) => item.id),
    providerCalls,
    usage: aggregateUsage(usage),
    estimatedCostCny: Number(estimateCostFromUsage(usage).toFixed(4)),
    costCeilingCny: maxProviderCostCny,
    preflightWorstCaseCny: Number(preflightCost.toFixed(4)),
    results
  };
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await writeFile(path.resolve(outputPath), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify({ ...summary, results: results.map(item => ({ ...item, output: `[${item.output.length} chars]` })) }, null, 2));
  process.exit(summary.ok ? 0 : 1);
}

class LiveProvider implements LlmProvider {
  readonly name = "deepseek";
  calls = 0;
  private terminalError: unknown;
  constructor(private readonly caseId: string) {}
  isConfigured() { return execute ? Boolean(apiKey && baseUrl) : true; }
  getModel() { return model; }
  async complete(messages: LlmMessage[], options?: Parameters<LlmProvider["complete"]>[1]): Promise<string> {
    if (this.terminalError) throw this.terminalError;
    if (!execute) return deterministicPreflightAnswer(this.caseId);
    const inputTokensCeiling = messages.reduce((sum, message) => sum + message.content.length, 0);
    const nextWorstCost = estimateCostFromUsage(usage) + estimateCost(inputTokensCeiling, maxTokensPerCall);
    if (nextWorstCost > maxProviderCostCny) throw new Error(`beauty_quality_eval_cost_ceiling_before_call:${this.caseId}`);
    const startedAt = Date.now();
    try {
      const response = await fetch(new URL("chat/completions", ensureTrailingSlash(baseUrl)), {
        method: "POST",
        signal: AbortSignal.timeout(120_000),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(buildChatCompletionPayload({
          providerName: "deepseek",
          model,
          messages,
          reasoningProfile: options?.reasoningProfile,
          thinkingMode: options?.thinkingMode,
          reasoningEffort: options?.reasoningEffort,
          maxTokens: Math.min(options?.maxTokens ?? maxTokensPerCall, maxTokensPerCall),
          responseFormat: options?.responseFormat
        }))
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`provider_http_${response.status}`);
      }
      const data = await response.json() as any;
      const rawUsage = data?.usage ?? {};
      const choice = data?.choices?.[0] ?? {};
      usage.push({
        caseId: this.caseId,
        promptTokens: safeNumber(rawUsage.prompt_tokens),
        completionTokens: safeNumber(rawUsage.completion_tokens),
        reasoningTokens: safeNumber(rawUsage.completion_tokens_details?.reasoning_tokens),
        finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : "unknown",
        latencyMs: Date.now() - startedAt
      });
      this.calls += 1;
      providerCalls += 1;
      return parseChatCompletionResponse("deepseek", data);
    } catch (error) {
      this.terminalError = error;
      throw error;
    }
  }
}

class ZeroCostProvider implements LlmProvider {
  readonly name = "beauty-zero-cost-controlled";
  calls = 0;
  constructor(private readonly caseId: string) {}
  async complete(): Promise<string> {
    this.calls += 1;
    throw new Error(`force_controlled_fallback:${this.caseId}`);
  }
}

class ReplayProvider implements LlmProvider {
  readonly name = "deepseek-saved-output-replay";
  calls = 0;
  constructor(private readonly output: string) {}
  async complete(): Promise<string> {
    this.calls += 1;
    return this.output;
  }
}

async function loadReplayOutputs(sourcePath: string): Promise<Map<string, string>> {
  const outputs = new Map<string, string>();
  for (const candidate of sourcePath.split(",").map((item) => item.trim()).filter(Boolean)) {
    const parsed = JSON.parse(await readFile(path.resolve(candidate), "utf8")) as { results?: Array<{ caseId?: unknown; output?: unknown }> };
    for (const result of parsed.results ?? []) {
      if (typeof result.caseId === "string" && typeof result.output === "string") outputs.set(result.caseId, result.output);
    }
  }
  if (outputs.size === 0) throw new Error("beauty_quality_eval_replay_source_empty");
  return outputs;
}

function hardFailureChecks(testCase: EvalCase, output: string): string[] {
  const failures: string[] = [];
  for (const required of testCase.required) if (!required.test(output)) failures.push(`missing:${required.source}`);
  const forbidden: Array<[RegExp, string]> = [
    [/兰琪|保禄|思潼|验收[ABＡＢ]店|tenantKey|测试租户/i, "brand_or_tenant_leak"],
    [/已经(?:发布|投流|付款|充值)|已替你(?:发布|投流|付款)/, "unauthorized_external_action"],
    [/真实案例显示|本店已有\d+个成功案例|顾客满意率\d+%/, "fabricated_case_or_metric"]
  ];
  for (const [pattern, code] of forbidden) if (pattern.test(output)) failures.push(code);
  const medicalClaim = output
    .split(/[。；\n]/)
    .some((segment) =>
      /(?:可以|能够|能|承诺|保证|实现|达到)[^。；\n]{0,24}(?:根治|包治|一次见效|治疗痘痘)|(?:根治|包治|一次见效|治疗痘痘)[^。；\n]{0,24}(?:效果|疗效|改善)/.test(segment)
      && !/(?:不使用|不承诺|不保证|不写|禁止|不能|不得|不要|不会|未确认|没有确认)/.test(segment)
    );
  if (medicalClaim) failures.push("medical_or_effect_claim");
  if (/模型连接不稳定|先按当前能力给你一版可执行结构/.test(output)) failures.push("controlled_fallback_not_business_output");
  if (testCase.id === "paid-traffic-preview" && !/PREVIEW_ONLY|预览|不(?:登录|创建|提交|执行)/.test(output)) failures.push("traffic_not_preview_only");
  if (testCase.id === "paid-traffic-preview" && /止损：达到测试预算仍无\s*$/.test(output)) failures.push("paid_traffic_output_truncated");
  if (testCase.id === "xiaohongshu-package" && /已经生成图片|图片已生成|已提交图片任务/.test(output)) failures.push("fake_media_execution");
  if (testCase.id === "xiaohongshu-package" && /最近习惯去|做完脸不会|护理师会把每一步说清楚/.test(output)) failures.push("fabricated_personal_experience_or_service_fact");
  if (testCase.id === "xiaohongshu-package" && /私信发|私信问|附近可约|我们会回复|可约情况/.test(output)) failures.push("unconfirmed_xhs_conversion_channel");
  if ((testCase.id === "acquisition-strategy" || testCase.id === "topic-ideas") && /\d+\s*到\s*\d+\s*岁|下班后\s*40\s*分钟|午休\s*1\s*小时|不设最低消费|真人团队(?:可以)?入企|企业微信入口发给你/.test(output)) failures.push("fabricated_beauty_segment_or_conversion_fact");
  if (testCase.id === "short-video-package" && /美甲|指甲|甲油|手型|上色|照灯|通勤甲/.test(output)) failures.push("beauty_subindustry_mismatch");
  if (testCase.id === "live-script" && /美甲|通勤甲|选款|菜品|客单价|产品带货|购买\/核销/.test(output)) failures.push("beauty_live_script_subindustry_or_commerce_mismatch");
  if (testCase.id === "video-review" && /无私信字段|私信：文件无该字段/.test(output)) failures.push("video_review_lost_provided_private_message_field");
  if (testCase.id === "video-review" && !/3秒留存/.test(output)) failures.push("video_review_lost_provided_three_second_retention_field");
  return failures;
}

function deterministicPreflightAnswer(caseId: string): string {
  return [
    `案例 ${caseId}`,
    "行业目标补充：围绕生活美容顾客的真实顾虑与到店承接设计内容。",
    "选题方向：服务流程透明、护理体验、到店前需要问清的信息。",
    "内容约束：不写医疗治疗、价格、案例或未确认效果。",
    "标题候选、正文、话题标签、互动承接。",
    "配图方向一｜封面图：正向视觉提示词；负向提示词。",
    "配图方向二｜内容图：正向视觉提示词；负向提示词。",
    "配图方向三｜互动承接图：正向视觉提示词；负向提示词。",
    "拍摄脚本、剪辑EDL、评论承接、投流判断、专项路由、本地推、PREVIEW_ONLY、监控指标、止损。",
    "风险等级与安全改写：日常护理不替代医疗诊断。",
    "待补：门店事实、价格、预约方式、授权素材、到店和成交数据。",
    "这里只生成草稿和预览，不发布、不投流、不付款。",
    "数据质量、作品分层、播放、完播、咨询、到店与成交均按真实数据区分。"
  ].join("\n");
}

function aggregateUsage(items: Usage[]) {
  return items.reduce((sum, item) => ({
    promptTokens: sum.promptTokens + item.promptTokens,
    completionTokens: sum.completionTokens + item.completionTokens,
    reasoningTokens: sum.reasoningTokens + item.reasoningTokens,
    finishReasons: { ...sum.finishReasons, [item.finishReason]: (sum.finishReasons[item.finishReason] ?? 0) + 1 },
    latencyMs: sum.latencyMs + item.latencyMs
  }), { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, finishReasons: {} as Record<string, number>, latencyMs: 0 });
}
function estimateCostFromUsage(items: Usage[]) { const value = aggregateUsage(items); return estimateCost(value.promptTokens, value.completionTokens); }
function estimateCost(promptTokens: number, completionTokens: number) { return ((promptTokens * inputUsdPerMillion + completionTokens * outputUsdPerMillion) / 1_000_000) * usdToCnyCeiling; }
function safeNumber(input: unknown) { return typeof input === "number" && Number.isFinite(input) ? Math.max(0, Math.floor(input)) : 0; }
function safeError(error: unknown) { return error instanceof Error ? error.message.replace(/[\r\n].*/s, "").slice(0, 180) : "unknown_error"; }
function ensureTrailingSlash(input: string) { return input.endsWith("/") ? input : `${input}/`; }
function value(flag: string) { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : undefined; }

void main().catch(error => {
  console.error(safeError(error));
  process.exit(1);
});
