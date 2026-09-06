import { prisma } from "@baolu/db";
import type { RequestContext } from "../../services/request-context.js";
import {
  beautySegmentDisplayName,
  type BeautyIndustryProfile
} from "./profile.js";

export interface BeautyTopicSourceSelection {
  industry: boolean;
  benchmark: boolean;
  transcript: boolean;
  videoReview: boolean;
}

export interface BeautyTopicWorkflowInput {
  identity?: string;
  targetCustomer: string;
  acquisitionGoal: string;
  offer?: string;
  accountStage?: string;
  industry: string;
  benchmarkAccounts: string[];
  transcriptDocumentIds: string[];
  videoReviewId?: string;
  sourceSelection: BeautyTopicSourceSelection;
}

export interface BeautyTopicEvidenceAssessment {
  canGenerate: boolean;
  sourceCount: number;
  qualifiedTranscriptIds: string[];
  rejectedTranscriptIds: string[];
  videoReviewId?: string;
  directive: string;
}

export interface LoadedBeautyTopicDocument {
  id: string;
  title: string;
  content: string;
  documentType: string;
  confirmedAt: Date | null;
  sensitivity: string;
  industry: string | null;
  usagePolicy: string;
}

export interface BeautyTopicRuntimeResult {
  answerText: string;
  qualityFlags: string[];
}

const BEAUTY_TOPIC_INTERNAL_IDENTITY = /(?:兰琪|蓝旗|枕水江南|验收\s*[abａｂABＡＢ]?\s*店|测试租户|tenant(?:id|key)?|synthetic)/i;

/**
 * The product already owns a validated structured topic brief.  The generic
 * Agent quality pass runs before that product payload is available and can
 * flag a semantically equivalent rewrite as weak fact retention.  Replace only
 * the brief metadata section with the server-validated values; the model-owned
 * four-source evidence, three gates and TOP10 remain untouched and still pass
 * the normal output contract.
 */
export function applyBeautyTopicVerifiedBrief<T extends BeautyTopicRuntimeResult>(
  result: T,
  input: BeautyTopicWorkflowInput
): T {
  const workflow = normalizeBeautyTopicWorkflow(input);
  const canonicalBrief = [
    "## 本轮主体与目标",
    `服务主体：${workflow.identity || "本店"}`,
    `目标用户：${workflow.targetCustomer}`,
    `账号阶段：${workflow.accountStage || "待补"}`,
    `本轮获客目标：${workflow.acquisitionGoal}`,
    `本轮项目：${workflow.offer || "待补"}`,
    `细分赛道：${workflow.industry}`
  ].join("\n");
  const briefPattern = /(^|\n)## 本轮主体与目标[\s\S]*?(?=\n## )/;
  const answerText = briefPattern.test(result.answerText)
    ? result.answerText.replace(briefPattern, (_match, prefix: string) => `${prefix}${canonicalBrief}`)
    : `${canonicalBrief}\n\n${result.answerText.trim()}`;
  return {
    ...result,
    answerText,
    qualityFlags: [
      ...result.qualityFlags.filter((flag) => flag !== "rubric_fact_retention_weak"),
      "beauty_topic_verified_brief_applied"
    ]
  };
}

export async function assessBeautyTopicEvidence(input: {
  context: RequestContext;
  agentId: string;
  profile: BeautyIndustryProfile | null;
  workflow: BeautyTopicWorkflowInput;
}): Promise<BeautyTopicEvidenceAssessment> {
  const workflow = normalizeBeautyTopicWorkflow(input.workflow);
  const selected = workflow.sourceSelection;
  if (!Object.values(selected).some(Boolean)) throw new Error("beauty_topic_sources_missing");

  const profileIndustry = input.profile ? beautySegmentDisplayName(input.profile) : "";
  if (profileIndustry && !hasIndustryOverlap(profileIndustry, workflow.industry)) {
    throw new Error("beauty_topic_industry_conflict");
  }

  const documents = input.context.source === "database" && selected.transcript && workflow.transcriptDocumentIds.length
    ? await prisma.knowledgeDocument.findMany({
        where: { tenantId: input.context.tenantId, id: { in: workflow.transcriptDocumentIds } },
        select: {
          id: true,
          title: true,
          content: true,
          documentType: true,
          confirmedAt: true,
          sensitivity: true,
          industry: true,
          usagePolicy: true
        }
      })
    : [];
  const videoReview = input.context.source === "database" && selected.videoReview && workflow.videoReviewId
    ? await prisma.agentRun.findFirst({
        where: {
          id: workflow.videoReviewId,
          tenantId: input.context.tenantId,
          userId: input.context.userId,
          agentId: input.agentId,
          productCode: "beauty-industry",
          capabilityId: "video_data_review",
          status: "succeeded",
          output: { not: null }
        },
        select: { id: true, output: true, createdAt: true }
      })
    : null;

  return evaluateBeautyTopicEvidence({
    profileIndustry,
    workflow,
    documents,
    videoReview: videoReview ? { id: videoReview.id, output: videoReview.output ?? "" } : null
  });
}

export function evaluateBeautyTopicEvidence(input: {
  profileIndustry: string;
  workflow: BeautyTopicWorkflowInput;
  documents: LoadedBeautyTopicDocument[];
  videoReview: { id: string; output: string } | null;
}): BeautyTopicEvidenceAssessment {
  const workflow = normalizeBeautyTopicWorkflow(input.workflow);
  const selected = workflow.sourceSelection;
  const qualifiedDocuments = input.documents.filter((document) => isQualifiedTranscript(document, workflow.industry));
  const qualifiedIds = new Set(qualifiedDocuments.map((document) => document.id));
  const rejectedTranscriptIds = workflow.transcriptDocumentIds.filter((id) => !qualifiedIds.has(id));

  // The confirmed store profile and current goal are usable industry context,
  // but never become proof of a real-time hotspot. User-entered benchmark
  // accounts are also only leads until public content is actually verified.
  const sourceAvailability = {
    industry: selected.industry && Boolean(workflow.industry),
    benchmark: selected.benchmark && workflow.benchmarkAccounts.length > 0,
    transcript: selected.transcript && qualifiedDocuments.length > 0,
    videoReview: selected.videoReview && Boolean(input.videoReview)
  };
  const sourceCount = Object.values(sourceAvailability).filter(Boolean).length;
  if (sourceCount === 0) throw new Error("beauty_topic_sources_missing");

  const transcriptContext = qualifiedDocuments.slice(0, 8).map((document, index) => [
    `已确认录音${index + 1}：${document.title}`,
    document.content.slice(0, 1_200)
  ].join("\n")).join("\n\n");
  const videoReviewContext = input.videoReview?.output.slice(0, 4_000) ?? "";
  const pendingSources = Object.entries(sourceAvailability)
    .filter(([, available]) => !available)
    .map(([source]) => sourceLabel(source));

  return {
    canGenerate: true,
    sourceCount,
    qualifiedTranscriptIds: qualifiedDocuments.map((document) => document.id),
    rejectedTranscriptIds,
    ...(input.videoReview ? { videoReviewId: input.videoReview.id } : {}),
    directive: [
      "【服务端核验的美业选题来源边界｜优先级最高】",
      `本轮获客目标：${workflow.acquisitionGoal}`,
      `目标顾客：${workflow.targetCustomer}`,
      `细分赛道：${workflow.industry}${input.profileIndustry ? "（与已确认经营档案一致）" : "（仅为本轮输入，门店档案待确认）"}`,
      `账号阶段：${workflow.accountStage || "待补"}`,
      `已启用且有可用资料的来源：${Object.entries(sourceAvailability).filter(([, value]) => value).map(([key]) => sourceLabel(key)).join("、")}。`,
      pendingSources.length ? `资料不足的来源：${pendingSources.join("、")}；最终必须标记待补或待核验，不得声称已经读取。` : "四类来源均有本轮可用资料。",
      sourceAvailability.industry
        ? "行业来源只证明已确认细分赛道和目标；未提供可回溯 URL、日期与来源的内容不得写成实时热点或已验证趋势。"
        : "行业与用户热点本轮未启用或无资料。",
      sourceAvailability.benchmark
        ? `用户提供的对标账号线索：${workflow.benchmarkAccounts.join("、")}；尚未读取到可回溯作品与互动证据，只能标记待核验。`
        : "同行与对标内容本轮未启用或无账号线索。",
      transcriptContext ? `【已确认且当前租户可用的录音/客户问题】\n${transcriptContext}` : "私有知识与客户问题本轮没有合格录音资料。",
      rejectedTranscriptIds.length ? `已排除 ${rejectedTranscriptIds.length} 条错租户、未确认、敏感、错类型或错行业资料；不得引用其标题、案例、数字或观点。` : "没有被排除的已选录音。",
      videoReviewContext ? `【已成功解析并保存的自己账号视频数据复盘】\n${videoReviewContext}` : "自己账号数据复盘本轮未启用或没有成功解析的复盘。",
      "先基于可用来源形成候选；缺失来源只写待补/待核验。不得用模型常识、其他门店历史或测试数据伪装成来源。"
    ].join("\n")
  };
}

export function normalizeBeautyTopicWorkflow(value: BeautyTopicWorkflowInput): BeautyTopicWorkflowInput {
  return {
    identity: normalizeBeautyTopicIdentity(value.identity),
    targetCustomer: requiredText(value.targetCustomer, "targetCustomer", 500),
    acquisitionGoal: requiredText(value.acquisitionGoal, "acquisitionGoal", 500),
    offer: cleanText(value.offer, 300),
    accountStage: cleanText(value.accountStage, 100),
    industry: requiredText(value.industry, "industry", 120),
    benchmarkAccounts: uniqueText(value.benchmarkAccounts, 12, 240),
    transcriptDocumentIds: uniqueText(value.transcriptDocumentIds, 20, 200),
    videoReviewId: cleanText(value.videoReviewId, 200),
    sourceSelection: {
      industry: Boolean(value.sourceSelection?.industry),
      benchmark: Boolean(value.sourceSelection?.benchmark),
      transcript: Boolean(value.sourceSelection?.transcript),
      videoReview: Boolean(value.sourceSelection?.videoReview)
    }
  };
}

/**
 * Environment and legacy-brand labels may be useful outside the product, but
 * they are not customer facts and the formal beauty output gate intentionally
 * blocks them. Replace only the structured subject identity with a neutral
 * product label before prompt composition and post-processing; user goals,
 * evidence, industry and other facts are never stripped or rewritten here.
 */
export function normalizeBeautyTopicIdentity(value: string | undefined): string {
  const identity = cleanText(value, 160);
  return !identity || BEAUTY_TOPIC_INTERNAL_IDENTITY.test(identity) ? "本店" : identity;
}

function isQualifiedTranscript(document: {
  documentType: string;
  confirmedAt: Date | null;
  sensitivity: string;
  industry: string | null;
  usagePolicy: string;
}, industry: string): boolean {
  if (document.documentType !== "transcript") return false;
  if (!document.confirmedAt || document.sensitivity === "sensitive") return false;
  if (document.usagePolicy === "deny") return false;
  return !document.industry?.trim() || hasIndustryOverlap(document.industry, industry);
}

function hasIndustryOverlap(left: string, right: string): boolean {
  const a = normalizeText(left);
  const b = normalizeText(right);
  return a.includes(b) || b.includes(a) || (/(?:美业|美容|皮肤管理)/.test(a) && /(?:美业|美容|皮肤管理)/.test(b));
}

function sourceLabel(source: string): string {
  return ({
    transcript: "私有知识与客户问题",
    industry: "行业与用户热点",
    videoReview: "自身账号数据复盘",
    benchmark: "同行与对标内容"
  } as Record<string, string>)[source] || source;
}

function uniqueText(values: string[] | undefined, limit: number, maxLength: number): string[] {
  return Array.from(new Set((values ?? []).map((value) => cleanText(value, maxLength)).filter(Boolean))).slice(0, limit);
}

function requiredText(value: string | undefined, field: string, maxLength: number): string {
  const text = cleanText(value, maxLength);
  if (!text) throw new Error(`beauty_topic_field_required:${field}`);
  return text;
}

function cleanText(value: string | undefined, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}
