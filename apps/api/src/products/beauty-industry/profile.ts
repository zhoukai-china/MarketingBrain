import { Prisma, prisma } from "@baolu/db";

export const BEAUTY_INDUSTRY_PROFILE_KEY = "beautyIndustry" as const;

export const BEAUTY_SEGMENTS = [
  "skin_management",
  "hairdressing",
  "nail_lash",
  "scalp_hair_care",
  "lifestyle_beauty",
  "medical_beauty",
  "tattoo_embroidery",
  "body_spa",
  "postpartum_care",
  "makeup_styling",
  "beauty_retail",
  "other"
] as const;

export type BeautySegment = (typeof BEAUTY_SEGMENTS)[number];
export type BeautyRunMode = "quick" | "professional";
export type BeautyOperationType = "single_store" | "chain_brand";
export type BeautyOperatingStage = "startup" | "growth" | "stable" | "adjustment";

export interface BeautyIndustryProfile {
  segment: BeautySegment;
  customSegment?: string;
  operationType: BeautyOperationType;
  operatingStage: BeautyOperatingStage;
  storeName?: string;
  city?: string;
  services: string[];
  targetCustomers?: string;
  channels: string[];
  acquisitionGoal?: string;
  factBoundaries: string;
  source: "user_confirmed";
  confirmationStatus: "confirmed";
  version: number;
  confirmedAt: string;
}

export interface BeautyProfessionalOptions {
  audience?: string;
  project?: string;
  platform?: string;
  tone?: string;
  visualStyle?: string;
  budgetPreview?: string;
  contentStructure?: string;
  shootingRequirements?: string;
  edlRequirements?: string;
  imageCount?: number;
  parsedEvidence?: string;
  parseStatus?: "parsed" | "failed";
  sourceFilename?: string;
  priceBoundary?: string;
  customerConcern?: string;
  communicationStage?: string;
  allowedNextAction?: string;
  city?: string;
  storeFacts?: string;
  contentAngle?: string;
  prohibitedContent?: string;
}

const SEGMENT_LABELS: Record<BeautySegment, string> = {
  skin_management: "皮肤管理",
  hairdressing: "美发",
  nail_lash: "美甲美睫",
  scalp_hair_care: "头疗养发",
  lifestyle_beauty: "生活美容",
  medical_beauty: "医疗美容",
  tattoo_embroidery: "纹绣/半永久",
  body_spa: "身体护理/SPA",
  postpartum_care: "产后护理",
  makeup_styling: "化妆造型",
  beauty_retail: "美妆零售",
  other: "其他/自定义"
};

export function beautySegmentDisplayName(profile: Pick<BeautyIndustryProfile, "segment" | "customSegment">): string {
  return profile.segment === "other" ? profile.customSegment || "其他美业方向" : SEGMENT_LABELS[profile.segment];
}

export function normalizeBeautyIndustryProfile(value: unknown): BeautyIndustryProfile {
  if (!isRecord(value)) throw new Error("beauty_profile_invalid");
  const segment = cleanText(value.segment, 40) as BeautySegment;
  if (!BEAUTY_SEGMENTS.includes(segment)) throw new Error("beauty_segment_invalid");
  const customSegment = optionalText(value.customSegment, 80);
  if (segment === "other" && !customSegment) throw new Error("beauty_segment_custom_required");
  const factBoundaries = cleanText(value.factBoundaries, 1_000);
  if (segment === "medical_beauty" && !factBoundaries) throw new Error("medical_beauty_boundary_required");
  const source = value.source === "user_confirmed" ? value.source : "user_confirmed";
  const confirmationStatus = value.confirmationStatus === "confirmed" ? value.confirmationStatus : "confirmed";
  const confirmedAt = validIsoDate(value.confirmedAt) ?? new Date().toISOString();
  const version = positiveInteger(value.version) ?? 1;
  return {
    segment,
    ...(segment === "other" && customSegment ? { customSegment } : {}),
    operationType: value.operationType === "chain_brand" ? "chain_brand" : "single_store",
    operatingStage: isOperatingStage(value.operatingStage) ? value.operatingStage : "growth",
    ...(optionalText(value.storeName, 120) ? { storeName: optionalText(value.storeName, 120) } : {}),
    ...(optionalText(value.city, 80) ? { city: optionalText(value.city, 80) } : {}),
    services: stringList(value.services, 20, 100),
    ...(optionalText(value.targetCustomers, 500) ? { targetCustomers: optionalText(value.targetCustomers, 500) } : {}),
    channels: stringList(value.channels, 12, 80),
    ...(optionalText(value.acquisitionGoal, 500) ? { acquisitionGoal: optionalText(value.acquisitionGoal, 500) } : {}),
    factBoundaries,
    source,
    confirmationStatus,
    version,
    confirmedAt
  };
}

export function readBeautyIndustryProfileFromTenantData(value: unknown): BeautyIndustryProfile | null {
  if (!isRecord(value) || !(BEAUTY_INDUSTRY_PROFILE_KEY in value)) return null;
  try {
    return normalizeBeautyIndustryProfile(value[BEAUTY_INDUSTRY_PROFILE_KEY]);
  } catch {
    return null;
  }
}

export function mergeBeautyIndustryProfileIntoTenantData(
  existing: unknown,
  profile: BeautyIndustryProfile
): Record<string, unknown> {
  return {
    ...(isRecord(existing) ? existing : {}),
    [BEAUTY_INDUSTRY_PROFILE_KEY]: normalizeBeautyIndustryProfile(profile)
  };
}

export function deleteBeautyIndustryProfileFromTenantData(existing: unknown): Record<string, unknown> {
  const next = { ...(isRecord(existing) ? existing : {}) };
  delete next[BEAUTY_INDUSTRY_PROFILE_KEY];
  return next;
}

export async function saveBeautyIndustryProfile(params: {
  tenantId: string;
  input: Omit<BeautyIndustryProfile, "source" | "confirmationStatus" | "version" | "confirmedAt">;
}): Promise<BeautyIndustryProfile> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.tenantProfile.findUnique({ where: { tenantId: params.tenantId } });
    const current = readBeautyIndustryProfileFromTenantData(existing?.confirmedData ?? existing?.data);
    const profile = normalizeBeautyIndustryProfile({
      ...params.input,
      source: "user_confirmed",
      confirmationStatus: "confirmed",
      version: (current?.version ?? 0) + 1,
      confirmedAt: new Date().toISOString()
    });
    const merged = mergeBeautyIndustryProfileIntoTenantData(existing?.confirmedData ?? existing?.data, profile);
    await tx.tenantProfile.upsert({
      where: { tenantId: params.tenantId },
      update: {
        data: merged as Prisma.InputJsonValue,
        confirmedData: merged as Prisma.InputJsonValue,
        version: { increment: 1 }
      },
      create: {
        tenantId: params.tenantId,
        data: merged as Prisma.InputJsonValue,
        confirmedData: merged as Prisma.InputJsonValue,
        inferredData: {} as Prisma.InputJsonValue
      }
    });
    return profile;
  });
}

export async function deleteBeautyIndustryProfile(tenantId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.tenantProfile.findUnique({ where: { tenantId } });
    if (!existing) return;
    const next = deleteBeautyIndustryProfileFromTenantData(existing.confirmedData ?? existing.data);
    await tx.tenantProfile.update({
      where: { tenantId },
      data: {
        data: next as Prisma.InputJsonValue,
        confirmedData: next as Prisma.InputJsonValue,
        version: { increment: 1 }
      }
    });
  });
}

export function buildBeautyIndustryRunInput(params: {
  question: string;
  profile: BeautyIndustryProfile | null;
  mode: BeautyRunMode;
  professionalOptions?: BeautyProfessionalOptions;
  oneOffConfirmedFacts?: string;
  priorTaskContext?: { runId: string; capabilityId: string; output: string };
  topicEvidenceContext?: string;
  contentWorkflowContext?: string;
  videoContentWorkflowContext?: string;
  xhsTaskFactDirective?: string;
  xhsTaskSnapshotDirective?: string;
}): string {
  // Keep the user's current request explicitly delimited from product-owned
  // profile, mode and safety instructions. Runtime quality checks use this
  // marker to retain actual user facts without treating those instructions as
  // user-provided business facts.
  const sections = [`用户这次说：${params.question.trim()}`];
  if (params.xhsTaskFactDirective) sections.push(params.xhsTaskFactDirective);
  if (params.xhsTaskSnapshotDirective) sections.push(params.xhsTaskSnapshotDirective);
  if (params.professionalOptions?.parseStatus) {
    const parsedEvidence = optionalText(params.professionalOptions.parsedEvidence, 20_000);
    const sourceFilename = optionalText(params.professionalOptions.sourceFilename, 240) || "未命名文件";
    sections.push(params.professionalOptions.parseStatus === "parsed" && parsedEvidence
      ? `【本次用户上传/粘贴的附件】\n文件：${sourceFilename}\n【业务文件解析结果】\n解析状态：成功\n${parsedEvidence}`
      : `【本次用户上传/粘贴的附件】\n文件：${sourceFilename}\n【文件解析状态】\n解析状态：失败。不得声称读取、看过或分析了该文件。`);
  }
  sections.push(
    "当前产品上下文：以下档案、模式和动作边界由系统注入，不属于用户本轮原始表述。",
    formatBeautyIndustryProfileContext(params.profile)
  );
  const oneOffFacts = optionalText(params.oneOffConfirmedFacts, 2_000);
  if (oneOffFacts) {
    sections.push(`【本次补充资料（仅用于本次请求，不写入门店档案）】\n${oneOffFacts}`);
  }
  if (params.priorTaskContext) {
    sections.push([
      "【上一步 AI 草稿，不是门店事实】",
      `来源任务：${params.priorTaskContext.capabilityId}；仅用于继续当前获客流程。`,
      params.priorTaskContext.output.slice(0, 8_000),
      "不得把上一步的推断、建议、案例或数字晋升为已确认门店事实；与用户已确认档案冲突时以档案为准。"
    ].join("\n"));
  }
  if (params.topicEvidenceContext) {
    sections.push(params.topicEvidenceContext);
  }
  if (params.contentWorkflowContext) {
    sections.push(params.contentWorkflowContext);
  }
  if (params.videoContentWorkflowContext) {
    sections.push(params.videoContentWorkflowContext);
  }
  if (params.mode === "professional") {
    sections.push(formatProfessionalOptions(params.professionalOptions));
  } else {
    sections.push("【使用模式】\n快速模式：依据一句需求与已确认门店档案完成结果；资料不足处明确待补，不猜测。 ");
  }
  sections.push("【下一步与动作边界】\n结果可建议选题、内容、视频复盘或直播复盘；不得自动发布、投放、付款、充值或发送消息。");
  return sections.filter(Boolean).join("\n\n");
}

export function hasBeautyStructuredDataRecords(value: string): boolean {
  const source = value.trim();
  if (!source) return false;
  if (/(?:播放量|播放次数|完播率|平均播放时长|点赞|评论|分享|有效咨询|预约|到店|成交|核销)[：:\s]+[0-9]/.test(source)) return true;
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headerIndex = lines.findIndex((line) => {
    const metricHeaders = line.match(/作品标题|视频标题|播放量|播放次数|完播率|平均播放时长|点赞|评论|分享|有效咨询|预约|到店|成交|核销/g) ?? [];
    return metricHeaders.length >= 2 && /[\t,]/.test(line);
  });
  if (headerIndex < 0) return false;
  return lines.slice(headerIndex + 1).some((line) => /[\t,]/.test(line) && /[0-9]/.test(line) && !/^【.+】$/.test(line));
}

export function formatBeautyIndustryProfileContext(profile: BeautyIndustryProfile | null): string {
  if (!profile) {
    return "【当前经营主体已确认门店档案】\n尚未建立。不得自行补造细分赛道、门店名称、城市、服务、目标顾客、渠道、价格、疗效、案例或素材；真正影响结果时列为待补。";
  }
  const rows = [
    `细分赛道：${profile.segment === "other" ? profile.customSegment : SEGMENT_LABELS[profile.segment]}（用户已确认）`,
    `经营类型：${profile.operationType === "chain_brand" ? "连锁" : "单店"}（用户已确认）`,
    `经营阶段：${operatingStageLabel(profile.operatingStage)}（用户已确认）`,
    `品牌/门店：${profile.storeName || "待补"}`,
    `城市：${profile.city || "待补"}`,
    `服务项目：${profile.services.length ? profile.services.join("、") : "待补"}`,
    `目标顾客：${profile.targetCustomers || "待补"}`,
    `当前渠道：${profile.channels.length ? profile.channels.join("、") : "待补"}`,
    `当前获客目标：${profile.acquisitionGoal || "待补"}`,
    `事实边界：${profile.factBoundaries || "未补充；仍禁止编造疗效、价格、案例和门店事实"}`,
    `档案版本：${profile.version}；来源：用户确认；状态：已确认`
  ];
  if (profile.segment === "medical_beauty") {
    rows.push("医疗美容边界：仅依据已确认资质与服务范围回答；无证据不得写医疗诊断、治疗或疗效承诺。");
  } else {
    rows.push("生活美容边界：不得把日常护理写成医疗诊断、治疗或疗效承诺。");
  }
  return `【当前经营主体已确认门店档案】\n${rows.join("\n")}`;
}

function formatProfessionalOptions(options: BeautyProfessionalOptions | undefined): string {
  const value = options ?? {};
  return [
    "【使用模式】",
    "专业模式：以下参数只约束本次任务，不改变已确认门店档案。",
    `目标顾客：${optionalText(value.audience, 500) || "沿用档案或待补"}`,
    `本次项目：${optionalText(value.project, 200) || "沿用档案或待补"}`,
    `平台：${optionalText(value.platform, 100) || "待补"}`,
    `语气：${optionalText(value.tone, 200) || "由能力按任务给出"}`,
    `画面：${optionalText(value.visualStyle, 300) || "由能力按任务给出"}`,
    `本次城市：${optionalText(value.city, 80) || "沿用档案或不使用"}`,
    `本次门店事实：${optionalText(value.storeFacts, 500) || "沿用已确认档案；不得编造"}`,
    `内容角度：${optionalText(value.contentAngle, 300) || "由能力按任务给出"}`,
    `明确禁用内容：${optionalText(value.prohibitedContent, 500) || "无额外项；仍遵守美业合规硬门禁"}`,
    `预算边界：${optionalText(value.budgetPreview, 200) || "未提供；不得编造预算或执行投放"}`,
    `内容结构：${optionalText(value.contentStructure, 500) || "由能力按任务给出"}`,
    `拍摄要求：${optionalText(value.shootingRequirements, 500) || "待补"}`,
    `EDL要求：${optionalText(value.edlRequirements, 500) || "待补"}`,
    `配图数量：${boundedInteger(value.imageCount, 1, 9) ?? "按能力默认"}`,
    `文件解析：${value.parseStatus === "parsed" ? "成功，可使用下方解析证据" : value.parseStatus === "failed" ? "失败，禁止声称看过文件" : "本任务未提供文件"}`,
    `来源文件：${optionalText(value.sourceFilename, 240) || "无"}`,
    `已确认价格/优惠边界：${optionalText(value.priceBoundary, 500) || "未提供；不得编造价格、优惠或名额"}`,
    `顾客原话/主要顾虑：${optionalText(value.customerConcern, 1_000) || "待补"}`,
    `沟通阶段：${optionalText(value.communicationStage, 200) || "待补"}`,
    `允许的下一步动作：${optionalText(value.allowedNextAction, 500) || "待补；不得擅自预约、发送或承诺"}`,
    value.parseStatus === "parsed" ? `解析证据：${optionalText(value.parsedEvidence, 20_000) || "缺失（不得继续复盘）"}` : ""
  ].join("\n");
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function optionalText(value: unknown, max: number): string | undefined {
  return cleanText(value, max) || undefined;
}

function stringList(value: unknown, maxItems: number, maxItemLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanText(item, maxItemLength)).filter(Boolean))].slice(0, maxItems);
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function boundedInteger(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

function validIsoDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim() || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function isOperatingStage(value: unknown): value is BeautyOperatingStage {
  return value === "startup" || value === "growth" || value === "stable" || value === "adjustment";
}

function operatingStageLabel(value: BeautyOperatingStage): string {
  if (value === "startup") return "起步期";
  if (value === "stable") return "稳定期";
  if (value === "adjustment") return "调整期";
  return "增长期";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
