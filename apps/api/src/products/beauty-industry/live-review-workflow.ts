import { z } from "zod";

export const BEAUTY_LIVE_REVIEW_WORKFLOW_VERSION = "live_review_workflow_v1" as const;

export const BEAUTY_LIVE_REVIEW_WORKFLOW = {
  workflowId: "live-review",
  toolName: "beauty.live_review",
  scope: "acquisition:live-review",
  capabilityId: "live_review",
  primarySkillId: "baolu_live_review_engine",
  constraintSkillIds: ["beauty-industry-compliance"],
  evidenceFlow: "数据/转写/计划 → 核验与降级 → 八模块报告 → 下场动作"
} as const;

export const BEAUTY_LIVE_REVIEW_SECTIONS = [
  "一、核心数据速览",
  "二、流量诊断",
  "三、转化归因",
  "四、互动诊断",
  "五、话术执行对照表",
  "六、人货场诊断",
  "七、方法论沉淀",
  "八、下次直播调整清单"
] as const;

export type BeautyLiveReviewScenario = "product" | "franchise" | "knowledge";

export interface BeautyLiveReviewWorkflowInput {
  version: typeof BEAUTY_LIVE_REVIEW_WORKFLOW_VERSION;
  scenario: BeautyLiveReviewScenario;
  platform: string;
  sessionTitle: string;
  sessionTime: string;
  businessObjective: string;
  liveData?: string;
  recordingTranscript?: string;
  scriptPlan?: string;
  interactionEvidence?: string;
  projectEvidence?: string;
  conversionDefinition?: string;
  visualEvidence?: string;
  factBoundary: string;
  sourceFilename?: string;
  parseStatus?: "parsed" | "failed";
}

export const beautyLiveReviewWorkflowSchema = z.object({
  version: z.literal(BEAUTY_LIVE_REVIEW_WORKFLOW_VERSION),
  scenario: z.enum(["product", "franchise", "knowledge"]),
  platform: z.string().trim().min(1).max(100),
  sessionTitle: z.string().trim().min(2).max(240),
  sessionTime: z.string().trim().min(2).max(200),
  businessObjective: z.string().trim().min(2).max(500),
  liveData: z.string().trim().max(20_000).optional(),
  recordingTranscript: z.string().trim().max(30_000).optional(),
  scriptPlan: z.string().trim().max(20_000).optional(),
  interactionEvidence: z.string().trim().max(5_000).optional(),
  projectEvidence: z.string().trim().max(5_000).optional(),
  conversionDefinition: z.string().trim().max(2_000).optional(),
  visualEvidence: z.string().trim().max(10_000).optional(),
  factBoundary: z.string().trim().min(2).max(2_000),
  sourceFilename: z.string().trim().max(240).optional(),
  parseStatus: z.enum(["parsed", "failed"]).optional()
}).strict().superRefine((value, ctx) => {
  if (!value.liveData?.trim() && !value.recordingTranscript?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["liveData"],
      message: "直播复盘至少需要真实直播数据或录音转写；只有计划不能形成已发生场次结论。"
    });
  }
  if (value.parseStatus === "parsed" && (!value.liveData?.trim() || !value.sourceFilename?.trim())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["parseStatus"], message: "解析成功状态必须同时带入文件名和真实解析数据。" });
  }
  if (value.sourceFilename?.trim() && value.parseStatus !== "parsed") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceFilename"], message: "文件证据必须来自当前请求的成功解析回执。" });
  }
  if (value.liveData?.trim() && !hasBeautyLiveDataRecords(value.liveData)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["liveData"], message: "直播数据必须保留至少一个真实指标名和数值记录；纯说明不能冒充场次数据。" });
  }
});

export const BEAUTY_LIVE_REVIEW_WORKFLOW_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    version: { type: "string", const: BEAUTY_LIVE_REVIEW_WORKFLOW_VERSION },
    scenario: { type: "string", enum: ["product", "franchise", "knowledge"] },
    platform: { type: "string", minLength: 1, maxLength: 100 },
    sessionTitle: { type: "string", minLength: 2, maxLength: 240 },
    sessionTime: { type: "string", minLength: 2, maxLength: 200 },
    businessObjective: { type: "string", minLength: 2, maxLength: 500 },
    liveData: { type: "string", maxLength: 20_000, description: "当前场次真实后台数据；缺失值不得补零" },
    recordingTranscript: { type: "string", maxLength: 30_000, description: "当前场次真实录音/录屏转写，建议保留时间戳" },
    scriptPlan: { type: "string", maxLength: 20_000, description: "本场原计划或原话术，用于执行对照" },
    interactionEvidence: { type: "string", maxLength: 5_000 },
    projectEvidence: { type: "string", maxLength: 5_000 },
    conversionDefinition: { type: "string", maxLength: 2_000 },
    visualEvidence: { type: "string", maxLength: 10_000, description: "仅接受用户确认的画面/场景事实，不代表系统读取了录屏" },
    factBoundary: { type: "string", minLength: 2, maxLength: 2_000 },
    sourceFilename: { type: "string", maxLength: 240 },
    parseStatus: { type: "string", enum: ["parsed", "failed"] }
  },
  required: ["version", "scenario", "platform", "sessionTitle", "sessionTime", "businessObjective", "factBoundary"],
  allOf: [{ anyOf: [{ required: ["liveData"] }, { required: ["recordingTranscript"] }] }]
} as const;

export const BEAUTY_LIVE_REVIEW_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    question: { type: "string", minLength: 6, maxLength: 20_000 },
    requestId: { type: "string", minLength: 8, maxLength: 200 },
    mode: { type: "string", const: "professional" },
    liveReviewWorkflow: BEAUTY_LIVE_REVIEW_WORKFLOW_JSON_SCHEMA
  },
  required: ["question", "requestId", "mode", "liveReviewWorkflow"]
} as const;

export const BEAUTY_LIVE_REVIEW_ZERO_COST_PREFLIGHT = {
  providerCalls: 0,
  creditCost: 0,
  acceptsDataFiles: ["csv", "xls", "xlsx"],
  acceptsMediaFiles: false,
  retainedMedia: false
} as const;

export function readBeautyLiveReviewWorkflow(value: unknown): BeautyLiveReviewWorkflowInput {
  const parsed = beautyLiveReviewWorkflowSchema.safeParse(value);
  if (!parsed.success) throw new Error("beauty_live_review_workflow_invalid");
  return parsed.data;
}

export function hasBeautyLiveDataRecords(value: string): boolean {
  const source = value.normalize("NFKC").trim();
  if (!source) return false;
  const metric = /(?:曝光|进房|场观|观看|在线|峰值|停留|互动|评论|点赞|分享|商品点击|项目点击|咨询|私信|留资|预约|到店|订单|成交|核销|GMV|销售额)/i;
  if (metric.test(source) && /(?:^|[^\p{L}\p{N}])\d+(?:\.\d+)?%?/u.test(source)) return true;
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headerIndex = lines.findIndex((line) => metric.test(line) && /[,\t|]/.test(line));
  return headerIndex >= 0 && lines.slice(headerIndex + 1).some((line) => /[,\t|]/.test(line) && /\d/.test(line));
}

export function assessBeautyLiveReviewReadiness(input: Partial<BeautyLiveReviewWorkflowInput>): {
  executionReady: boolean;
  evidence: { data: boolean; transcript: boolean; plan: boolean; visual: boolean };
  blockingMissing: string[];
  degradedModules: string[];
} {
  const evidence = {
    data: Boolean(input.liveData?.trim()),
    transcript: Boolean(input.recordingTranscript?.trim()),
    plan: Boolean(input.scriptPlan?.trim()),
    visual: Boolean(input.visualEvidence?.trim())
  };
  const blockingMissing = [
    !input.scenario ? "选择直播场景" : "",
    !input.platform?.trim() ? "填写直播平台" : "",
    !input.sessionTitle?.trim() ? "填写直播间或场次名称" : "",
    !input.sessionTime?.trim() ? "填写真实直播时间或统计周期" : "",
    !input.businessObjective?.trim() ? "填写本场业务目标" : "",
    !input.factBoundary?.trim() ? "确认本场事实边界" : "",
    !evidence.data && !evidence.transcript ? "补充真实直播数据或带时间信息的转写（至少一类）" : ""
  ].filter(Boolean);
  const degradedModules = [
    !evidence.data ? "核心数据、流量、转化和互动模块只能列待补指标，不能给本场数值结论" : "",
    !evidence.transcript ? "话术执行、互动原因和转化节点不能做逐段归因" : "",
    !evidence.plan ? "话术执行对照表只能复盘实际表达，不能判断计划执行偏差" : "",
    !evidence.visual ? "人货场中的画面、布景、陈列和镜头判断保持待补" : ""
  ].filter(Boolean);
  return { executionReady: blockingMissing.length === 0, evidence, blockingMissing, degradedModules };
}

export function buildBeautyLiveReviewWorkflowDirective(input: BeautyLiveReviewWorkflowInput): string {
  const readiness = assessBeautyLiveReviewReadiness(input);
  const scenarioLabel: Record<BeautyLiveReviewScenario, string> = { product: "项目/产品型直播", franchise: "招商/合作型直播", knowledge: "知识/咨询型直播" };
  return [
    `【直播复盘正式输入｜${BEAUTY_LIVE_REVIEW_WORKFLOW_VERSION}】`,
    `直播场景：${scenarioLabel[input.scenario]}`,
    `平台：${input.platform}`,
    `直播间/场次：${input.sessionTitle}`,
    `时间或统计周期：${input.sessionTime}`,
    `本场业务目标：${input.businessObjective}`,
    `直播后台数据：${input.liveData?.trim() || "未提供；核心数据、流量、转化和互动结论保持待补"}`,
    `录音转写：${input.recordingTranscript?.trim() || "未提供；不得编造主播原话或逐段归因"}`,
    `原话术/计划：${input.scriptPlan?.trim() || "未提供；不得判断计划执行偏差"}`,
    `互动证据：${input.interactionEvidence?.trim() || "未提供；不得编造评论、提问或顾客反馈"}`,
    `项目/商品事实：${input.projectEvidence?.trim() || "未提供；不得补造项目、价格、优惠、疗效或库存"}`,
    `咨询/成交口径：${input.conversionDefinition?.trim() || "未提供；不得推断咨询、预约、到店、订单或成交"}`,
    `用户确认的画面证据：${input.visualEvidence?.trim() || "未提供；不得声称读取录屏，不判断人货场画面细节"}`,
    `事实边界：${input.factBoundary}`,
    input.sourceFilename ? `数据文件回执：${input.sourceFilename}（当前请求服务端解析成功）` : "数据文件回执：无；文本数据由用户本轮直接提供",
    `证据状态：数据=${readiness.evidence.data ? "已提供" : "待补"}；转写=${readiness.evidence.transcript ? "已提供" : "待补"}；计划=${readiness.evidence.plan ? "已提供" : "待补"}；画面=${readiness.evidence.visual ? "用户已确认" : "待补"}`,
    readiness.degradedModules.length ? `必须降级：${readiness.degradedModules.join("；")}` : "三类核心资料齐全；仍只按证据范围判断。",
    `最终必须依次输出：${BEAUTY_LIVE_REVIEW_SECTIONS.join("、")}。`,
    "数据与转写只有在时间粒度可对齐时才能讨论时段关联；无法对齐时只陈述各自证据，不把相关性写成因果。",
    "禁止自由文本改路由，禁止使用模板、跨产品示例或未提供事实补齐报告。"
  ].join("\n");
}
