import type { KnowledgeContextDocument } from "../routes/knowledge-base.js";
import type { FounderIpGoalBriefInput, FounderIpGoalTarget } from "./founder-ip-goal-briefs.js";

export interface FounderIpTopicContext extends FounderIpGoalBriefInput {
  videoReviewId?: string;
}

export interface FounderIpTopicSourceSelection {
  industry: boolean;
  benchmark: boolean;
  transcript: boolean;
  videoReview: boolean;
}

export interface FounderIpTopicEvidenceAssessment {
  qualifiedDocuments: KnowledgeContextDocument[];
  rejectedDocuments: Array<{ id: string; reason: "wrong_subject" | "unconfirmed" | "sensitive" | "wrong_type" | "industry_mismatch" | "low_relevance" }>;
  verifiedSources: {
    industry: boolean;
    benchmark: boolean;
    transcript: boolean;
    videoReview: boolean;
  };
  canGenerate: boolean;
  message?: string;
}

const TARGET_TERMS: Record<FounderIpGoalTarget, string[]> = {
  franchise: ["招商", "加盟", "加盟商", "创业"],
  store_visit: ["到店", "团购", "核销", "消费者", "门店"],
  student: ["学员", "课程", "试听", "报名", "学习"],
  partner: ["合作", "合作方", "渠道", "伙伴", "联营"]
};

const GENERIC_TERMS = new Set([
  "品牌", "创始人", "项目", "目标", "用户", "客户", "人群", "行业", "本轮", "获取", "咨询",
  "预算", "从业者", "负责人", "主理人", "内容", "账号", "服务", "计划", "相关", "专业"
]);

export function assertFounderIpTopicContextMatchesBrief(
  context: FounderIpTopicContext,
  brief: FounderIpGoalBriefInput
): void {
  const fields: Array<keyof Pick<FounderIpGoalBriefInput, "subjectId" | "target" | "identity" | "targetCustomer" | "acquisitionGoal" | "industry">> = [
    "subjectId", "target", "identity", "targetCustomer", "acquisitionGoal", "industry"
  ];
  const stale = fields.filter((field) => normalizeText(String(context[field] ?? "")) !== normalizeText(String(brief[field] ?? "")));
  if (stale.length > 0) {
    const error = new Error("获客目标简报已变化，请刷新后重新确认本轮目标与资料来源。") as Error & { code: string; statusCode: number; staleFields: string[] };
    error.code = "founder_ip_topic_context_stale";
    error.statusCode = 409;
    error.staleFields = stale;
    throw error;
  }
}

export function assessFounderIpTopicEvidence(input: {
  brief: FounderIpGoalBriefInput;
  subjectId: string;
  documents: KnowledgeContextDocument[];
  sourceSelection: FounderIpTopicSourceSelection;
  researchContext?: string;
  videoReviewId?: string;
}): FounderIpTopicEvidenceAssessment {
  const rejectedDocuments: FounderIpTopicEvidenceAssessment["rejectedDocuments"] = [];
  const qualifiedDocuments = input.sourceSelection.transcript
    ? input.documents.filter((document) => {
        const reason = rejectDocumentReason(document, input.subjectId, input.brief);
        if (reason) rejectedDocuments.push({ id: document.id, reason });
        return !reason;
      })
    : [];
  if (!input.sourceSelection.transcript) {
    for (const document of input.documents) rejectedDocuments.push({ id: document.id, reason: "low_relevance" });
  }

  const verifiedSources = {
    industry: input.sourceSelection.industry && hasVerifiedPublicEvidence(input.researchContext, "热点"),
    benchmark: input.sourceSelection.benchmark && hasVerifiedPublicEvidence(input.researchContext, "对标线索"),
    transcript: input.sourceSelection.transcript && qualifiedDocuments.length > 0,
    videoReview: input.sourceSelection.videoReview && Boolean(input.videoReviewId?.trim())
  };
  const canGenerate = Object.values(verifiedSources).some(Boolean);
  return {
    qualifiedDocuments,
    rejectedDocuments,
    verifiedSources,
    canGenerate,
    ...(canGenerate ? {} : {
      message: rejectedDocuments.length > 0
        ? "本轮录音与当前项目/行业相关性不足或尚未确认，且其他来源没有可核验资料。请先确认资料归属，或补充近期热点、对标账号、账号复盘后再生成。"
        : "本轮没有可核验的选题证据。请补充近期热点、对标账号、已确认录音或账号复盘后再生成。"
    })
  };
}

export function buildFounderIpTopicEvidenceDirective(assessment: FounderIpTopicEvidenceAssessment): string {
  const allowed = Object.entries(assessment.verifiedSources).filter(([, enabled]) => enabled).map(([source]) => source);
  return [
    "【服务端已确认的选题证据边界｜优先级最高】",
    `本轮允许使用的来源：${allowed.length ? allowed.join("、") : "无"}。`,
    `已确认且与当前主体/行业相关的录音：${assessment.qualifiedDocuments.length} 条。`,
    assessment.rejectedDocuments.length > 0
      ? `已排除 ${assessment.rejectedDocuments.length} 条未确认、错主体、错行业或低相关录音；不得引用其标题、观点、案例或数字。`
      : "没有被排除的录音。",
    "最终每条选题的来源依据只能引用上面允许的来源；不得用通用常识、旧项目或模型记忆填满TOP10。"
  ].join("\n");
}

export function validateFounderIpTopicDelivery(input: {
  answer: string;
  brief: FounderIpGoalBriefInput;
  evidence: FounderIpTopicEvidenceAssessment;
}): { ok: true } | { ok: false; message: string; failures: string[] } {
  const failures: string[] = [];
  const rows = parseTopicRows(input.answer);
  if (rows.length !== 10) failures.push("最终结果必须包含10条结构化选题");
  const businessTerms = businessSpecificTerms(input.brief);
  const targetTerms = TARGET_TERMS[input.brief.target];
  let relevantRows = 0;
  for (const row of rows) {
    const semanticText = normalizeText(`${row.topic} ${row.angle} ${row.evidence} ${row.goalRelation}`);
    const normalizedTopic = normalizeText(row.topic);
    const hasBusiness = businessTerms.some((term) => normalizedTopic.includes(normalizeText(term)));
    const hasTarget = targetTerms.some((term) => semanticText.includes(normalizeText(term)));
    if (hasBusiness && hasTarget) relevantRows += 1;
    if (/录音|AI录音卡|得到大脑/.test(row.evidence) && !input.evidence.verifiedSources.transcript) failures.push(`未获准的录音来源：${row.topic}`);
    if (/行业热点|热点/.test(row.evidence) && !input.evidence.verifiedSources.industry) failures.push(`未获准的行业热点来源：${row.topic}`);
    if (/对标/.test(row.evidence) && !input.evidence.verifiedSources.benchmark) failures.push(`未获准的对标来源：${row.topic}`);
    if (/复盘/.test(row.evidence) && !input.evidence.verifiedSources.videoReview) failures.push(`未获准的账号复盘来源：${row.topic}`);
  }
  if (rows.length > 0 && relevantRows < Math.min(8, rows.length)) {
    failures.push(`仅${relevantRows}/${rows.length}条选题同时匹配当前行业/项目与获客目标`);
  }
  for (const field of ["选题/钩子", "目标人群", "来源依据", "与获客目标的关系", "下一步生成内容"]) {
    if (!input.answer.includes(field)) failures.push(`缺少字段：${field}`);
  }
  const uniqueFailures = Array.from(new Set(failures));
  return uniqueFailures.length === 0
    ? { ok: true }
    : { ok: false, message: "本轮选题未通过当前项目与证据相关性门禁，未保存、未扣产品积分。请确认资料后重试。", failures: uniqueFailures };
}

function rejectDocumentReason(
  document: KnowledgeContextDocument,
  subjectId: string,
  brief: FounderIpGoalBriefInput
): FounderIpTopicEvidenceAssessment["rejectedDocuments"][number]["reason"] | undefined {
  if (document.documentType !== "transcript") return "wrong_type";
  if (!document.subjectIds?.includes(subjectId)) return "wrong_subject";
  if (!document.confirmedAt) return "unconfirmed";
  if (document.sensitivity === "sensitive") return "sensitive";
  const hasConfirmedIndustry = Boolean(document.industry?.trim());
  if (hasConfirmedIndustry && !hasIndustryOverlap(document.industry!, brief.industry)) return "industry_mismatch";
  if (hasConfirmedIndustry) return undefined;
  const evidenceText = normalizeText(`${document.title}\n${document.content}`);
  const businessTerms = businessSpecificTerms(brief);
  const targetTerms = TARGET_TERMS[brief.target];
  if (!businessTerms.some((term) => evidenceText.includes(normalizeText(term)))
    && !targetTerms.some((term) => evidenceText.includes(normalizeText(term)))) return "low_relevance";
  return undefined;
}

function hasVerifiedPublicEvidence(context: string | undefined, prefix: "热点" | "对标线索"): boolean {
  if (!context) return false;
  const expression = prefix === "热点"
    ? /热点\d+：[^\n]+｜日期：\d{4}-\d{2}-\d{2}｜来源：[^\n｜]+(?:｜https?:\/\/\S+)?/
    : /对标线索\d+：[^\n]+｜来源：[^\n]+｜https?:\/\/\S+/;
  return expression.test(context);
}

function parseTopicRows(answer: string): Array<{ topic: string; angle: string; evidence: string; goalRelation: string }> {
  return answer.split(/\r?\n/).flatMap((line) => {
    if (!/^\|\s*(?:[1-9]|10)\s*\|/.test(line)) return [];
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 7) return [];
    return [{ topic: cells[1] ?? "", angle: cells[3] ?? "", evidence: cells[4] ?? "", goalRelation: cells[5] ?? "" }];
  });
}

function businessSpecificTerms(brief: FounderIpGoalBriefInput): string[] {
  const values = [brief.industry, brief.identity, brief.targetCustomer, brief.offer ?? ""];
  const terms = values.flatMap((value) => value.split(/[\s，,、/｜|；;：:（）()的与和及\-]+/))
    .map((value) => value.trim())
    .filter((value) => value.length >= 2 && value.length <= 18 && !GENERIC_TERMS.has(value));
  return Array.from(new Set(terms.length ? terms : [brief.industry.trim()])).filter(Boolean);
}

function hasIndustryOverlap(left: string, right: string): boolean {
  const leftTerms = businessSpecificTerms({ subjectId: "", target: "franchise", identity: "", targetCustomer: "", acquisitionGoal: "", industry: left, benchmarkAccounts: [] });
  const rightText = normalizeText(right);
  return leftTerms.some((term) => rightText.includes(normalizeText(term)))
    || businessSpecificTerms({ subjectId: "", target: "franchise", identity: "", targetCustomer: "", acquisitionGoal: "", industry: right, benchmarkAccounts: [] })
      .some((term) => normalizeText(left).includes(normalizeText(term)));
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}
