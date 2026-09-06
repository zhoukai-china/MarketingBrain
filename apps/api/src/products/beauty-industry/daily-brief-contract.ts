export const BEAUTY_DAILY_BRIEF_PRODUCT_CODE = "beauty-industry";
export const BEAUTY_DAILY_BRIEF_CAPABILITY_ID = "beauty_daily_brief";
export const BEAUTY_DAILY_BRIEF_TOOL_NAME = "beauty.daily_brief";
export const BEAUTY_DAILY_BRIEF_SCOPE = "operations:daily-brief";
export const BEAUTY_DAILY_BRIEF_CONTRACT_VERSION = "1.0.0";
export const BEAUTY_DAILY_BRIEF_TIME_ZONE = "Asia/Shanghai";
export const BEAUTY_DAILY_BRIEF_SCHEDULE_HOUR = 9;

export const BEAUTY_DAILY_BRIEF_SECTIONS = [
  "模型动态",
  "产品发布",
  "行业风云",
  "企业改造案例",
  "趋势洞察"
] as const;

export type BeautyDailyBriefSection = typeof BEAUTY_DAILY_BRIEF_SECTIONS[number];
export const BEAUTY_DAILY_BRIEF_SOURCE_INDUSTRIES = [
  "通用AI", "AI监管", "AI研究", "AI产业", "企业数字化", "零售", "本地服务", "美业"
] as const;
export type BeautyDailyBriefSourceIndustry = typeof BEAUTY_DAILY_BRIEF_SOURCE_INDUSTRIES[number];
export type BeautyDailyBriefRuntimeMode = "disabled" | "controlled_mock" | "live";
export type BeautyDailyBriefTrigger = "scheduled" | "catchup" | "manual";
export type BeautyDailyBriefStatus =
  | "not_generated"
  | "queued"
  | "collecting_sources"
  | "verifying_sources"
  | "generating"
  | "validating_contract"
  | "succeeded"
  | "source_insufficient"
  | "failed"
  | "terminal_unknown";

export interface BeautyDailyBriefSourceCandidate {
  section: BeautyDailyBriefSection;
  source: string;
  title: string;
  summary: string;
  sourceFacts: string[];
  sourceIndustry: BeautyDailyBriefSourceIndustry;
  sourceLabel: string;
  sitongComment: string;
  inferenceLabel: "beauty_interpretation";
  possibleImpact: string;
  applicabilityConditions: string[];
  verificationNeeded: string[];
  sourceUrl: string;
  publishedAt: string;
  verificationStatus: "verified_hotspot" | "trend_observation";
  beautySegments: string[];
  reachable: boolean;
  authoritative: boolean;
  contentMatchesSource: boolean;
}

export interface BeautyDailyBriefItem extends Omit<BeautyDailyBriefSourceCandidate, "reachable" | "authoritative" | "contentMatchesSource"> {
  sourceWindowHours: 24 | 72;
}

export interface BeautyDailyBriefReport {
  productCode: typeof BEAUTY_DAILY_BRIEF_PRODUCT_CODE;
  capabilityId: typeof BEAUTY_DAILY_BRIEF_CAPABILITY_ID;
  contractVersion: typeof BEAUTY_DAILY_BRIEF_CONTRACT_VERSION;
  businessDate: string;
  cutoffAt: string;
  generatedAt: string;
  lastSuccessfulAt: string;
  trigger: BeautyDailyBriefTrigger;
  sourceWindowHours: 24 | 72;
  runtimeMode: Exclude<BeautyDailyBriefRuntimeMode, "disabled">;
  controlledNotice?: string;
  sections: Array<{ name: BeautyDailyBriefSection; items: BeautyDailyBriefItem[] }>;
  trends: Array<{ title: string; evidence: string; action: string }>;
  todayAction: { title: string; why: string; steps: string[] };
}

export interface BeautyDailyBriefClock {
  businessDate: string;
  localHour: number;
  localMinute: number;
  cutoffAt: Date;
  nextScheduledAt: Date;
}

export interface BeautyDailyBriefScheduleDecision {
  shouldEnqueue: boolean;
  trigger?: "scheduled" | "catchup";
  businessDate: string;
  uniqueKey: string;
  nextScheduledAt: Date;
  reason: "before_schedule" | "already_succeeded" | "already_active" | "scheduled" | "catchup";
}

export function canClaimBeautyDailyBriefLease(params: {
  status: BeautyDailyBriefStatus;
  leaseExpiresAt?: Date | null;
  providerCallCount: number;
  now?: Date;
}): boolean {
  if (params.status === "queued") return true;
  if (!["collecting_sources", "verifying_sources", "generating", "validating_contract"].includes(params.status)) return false;
  if (params.providerCallCount > 0) return false;
  return Boolean(params.leaseExpiresAt && params.leaseExpiresAt.getTime() < (params.now ?? new Date()).getTime());
}

export function interruptedBeautyDailyBriefStatus(providerCallCount: number): "queued" | "terminal_unknown" {
  return providerCallCount === 0 ? "queued" : "terminal_unknown";
}

const BEAUTY_RELEVANCE = /(?:美业|美容|生活美容|生美|科美|医疗美容|医美|美妆|美甲|美睫|皮肤管理|头疗|养发|门店|连锁)/u;
const FOREIGN_OR_INTERNAL = /(?:餐饮|外卖|加盟招商|创始人\s*IP|internal|system prompt|mock[_-]?result|示例品牌)/iu;
const MEDICAL_OR_PRICE_CLAIM = /(?:保证|治愈|根治|永久有效|百分之百|最低价|全网最低|无效退款)/u;
const INFERENCE_BOUNDARY = /(?:可能|可考虑|可以|若|如果|在.+条件|需(?:要)?(?:先)?核验|建议验证|仅供参考)/u;
const BEAUTY_FACT_AS_INFERENCE = /(?:已经|已在|已帮助|已实现|已提升|已增长|证明能够).{0,24}(?:美业|美容|美妆|美甲|美睫|皮肤管理|医美|门店|顾客)/u;

export function beautyDailyBriefUniqueKey(businessDate: string): string {
  assertBusinessDate(businessDate);
  return `${BEAUTY_DAILY_BRIEF_PRODUCT_CODE}:${businessDate}:${BEAUTY_DAILY_BRIEF_CONTRACT_VERSION}`;
}

export function readBeautyDailyBriefClock(now = new Date()): BeautyDailyBriefClock {
  if (Number.isNaN(now.getTime())) throw new Error("beauty_daily_brief_clock_invalid");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: BEAUTY_DAILY_BRIEF_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const businessDate = `${parts.year}-${parts.month}-${parts.day}`;
  const localHour = Number(parts.hour);
  const localMinute = Number(parts.minute);
  const scheduledToday = beijingLocalToUtc(businessDate, BEAUTY_DAILY_BRIEF_SCHEDULE_HOUR, 0);
  const nextScheduledAt = now.getTime() < scheduledToday.getTime()
    ? scheduledToday
    : beijingLocalToUtc(addBusinessDays(businessDate, 1), BEAUTY_DAILY_BRIEF_SCHEDULE_HOUR, 0);
  return { businessDate, localHour, localMinute, cutoffAt: scheduledToday, nextScheduledAt };
}

export function decideBeautyDailyBriefSchedule(params: {
  now?: Date;
  hasSucceeded: boolean;
  hasActiveTask: boolean;
}): BeautyDailyBriefScheduleDecision {
  const clock = readBeautyDailyBriefClock(params.now);
  const uniqueKey = beautyDailyBriefUniqueKey(clock.businessDate);
  if (clock.localHour < BEAUTY_DAILY_BRIEF_SCHEDULE_HOUR) {
    return { shouldEnqueue: false, businessDate: clock.businessDate, uniqueKey, nextScheduledAt: clock.nextScheduledAt, reason: "before_schedule" };
  }
  if (params.hasSucceeded) {
    return { shouldEnqueue: false, businessDate: clock.businessDate, uniqueKey, nextScheduledAt: clock.nextScheduledAt, reason: "already_succeeded" };
  }
  if (params.hasActiveTask) {
    return { shouldEnqueue: false, businessDate: clock.businessDate, uniqueKey, nextScheduledAt: clock.nextScheduledAt, reason: "already_active" };
  }
  const isScheduledMinute = clock.localHour === BEAUTY_DAILY_BRIEF_SCHEDULE_HOUR && clock.localMinute === 0;
  return {
    shouldEnqueue: true,
    trigger: isScheduledMinute ? "scheduled" : "catchup",
    businessDate: clock.businessDate,
    uniqueKey,
    nextScheduledAt: clock.nextScheduledAt,
    reason: isScheduledMinute ? "scheduled" : "catchup"
  };
}

export function selectBeautyDailyBriefSources(params: {
  candidates: BeautyDailyBriefSourceCandidate[];
  cutoffAt: Date;
  runtimeMode: Exclude<BeautyDailyBriefRuntimeMode, "disabled">;
}): { ok: true; items: BeautyDailyBriefItem[]; sourceWindowHours: 24 | 72 } | { ok: false; error: "source_insufficient"; available24h: number; available72h: number; issues: string[] } {
  const issues: string[] = [];
  const valid = params.candidates.filter((candidate, index) => {
    const candidateIssues = validateSourceCandidate(candidate, params.cutoffAt, params.runtimeMode);
    if (candidateIssues.length) issues.push(...candidateIssues.map((issue) => `source_${index + 1}:${issue}`));
    return candidateIssues.length === 0;
  });
  const unique = deduplicateSources(valid);
  const within = (hours: 24 | 72) => unique.filter((item) => {
    const ageMs = params.cutoffAt.getTime() - new Date(item.publishedAt).getTime();
    return ageMs >= 0 && ageMs <= hours * 60 * 60 * 1000;
  });
  const selected24 = chooseSectionQuota(within(24));
  if (selected24.length === 15) return { ok: true, items: selected24.map((item) => ({ ...stripEvidence(item), sourceWindowHours: 24 })), sourceWindowHours: 24 };
  const selected72 = chooseSectionQuota(within(72));
  if (selected72.length === 15) return { ok: true, items: selected72.map((item) => ({ ...stripEvidence(item), sourceWindowHours: 72 })), sourceWindowHours: 72 };
  return { ok: false, error: "source_insufficient", available24h: selected24.length, available72h: selected72.length, issues };
}

export function validateBeautyDailyBriefReport(report: BeautyDailyBriefReport): string[] {
  const issues: string[] = [];
  if (report.productCode !== BEAUTY_DAILY_BRIEF_PRODUCT_CODE) issues.push("product_code_invalid");
  if (report.capabilityId !== BEAUTY_DAILY_BRIEF_CAPABILITY_ID) issues.push("capability_id_invalid");
  if (report.contractVersion !== BEAUTY_DAILY_BRIEF_CONTRACT_VERSION) issues.push("contract_version_invalid");
  try { assertBusinessDate(report.businessDate); } catch { issues.push("business_date_invalid"); }
  if (report.runtimeMode === "controlled_mock" && !report.controlledNotice?.includes("测试")) issues.push("controlled_notice_missing");
  if (report.sections.length !== BEAUTY_DAILY_BRIEF_SECTIONS.length) issues.push("section_count_invalid");
  const names = report.sections.map((section) => section.name);
  if (names.join("|") !== BEAUTY_DAILY_BRIEF_SECTIONS.join("|")) issues.push("section_order_invalid");
  const items = report.sections.flatMap((section) => {
    if (section.items.length !== 3) issues.push(`section_item_count_invalid:${section.name}`);
    if (section.items.some((item) => item.section !== section.name)) issues.push(`section_item_mismatch:${section.name}`);
    return section.items;
  });
  if (items.length !== 15) issues.push("item_count_invalid");
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  for (const [index, item] of items.entries()) {
    const sourceIssues = validateSourceCandidate({ ...item, reachable: true, authoritative: true, contentMatchesSource: true }, new Date(report.cutoffAt), report.runtimeMode);
    issues.push(...sourceIssues.map((issue) => `item_${index + 1}:${issue}`));
    const url = item.sourceUrl.trim().toLowerCase();
    const title = normalizeTitle(item.title);
    if (seenUrls.has(url)) issues.push(`item_${index + 1}:duplicate_url`);
    if (seenTitles.has(title)) issues.push(`item_${index + 1}:duplicate_title`);
    seenUrls.add(url); seenTitles.add(title);
    if (item.inferenceLabel !== "beauty_interpretation") issues.push(`item_${index + 1}:inference_label_missing`);
    if (!item.possibleImpact.trim() || !INFERENCE_BOUNDARY.test(item.possibleImpact)) issues.push(`item_${index + 1}:inference_boundary_missing`);
    if (!item.applicabilityConditions.length || item.applicabilityConditions.some((entry) => !entry.trim())) issues.push(`item_${index + 1}:applicability_conditions_missing`);
    if (!item.verificationNeeded.length || item.verificationNeeded.some((entry) => !entry.trim())) issues.push(`item_${index + 1}:verification_needed_missing`);
    const inferenceText = `${item.sitongComment} ${item.possibleImpact}`;
    if (BEAUTY_FACT_AS_INFERENCE.test(inferenceText) && !INFERENCE_BOUNDARY.test(inferenceText)) issues.push(`item_${index + 1}:inference_presented_as_source_fact`);
  }
  if (report.trends.length !== 3) issues.push("trend_count_invalid");
  for (const [index, trend] of report.trends.entries()) {
    if (!trend.title.trim() || !trend.evidence.trim() || !trend.action.trim()) issues.push(`trend_${index + 1}:fields_missing`);
  }
  if (!report.todayAction.title.trim() || !report.todayAction.why.trim() || report.todayAction.steps.length === 0) issues.push("today_action_invalid");
  return issues;
}

export function composeBeautyDailyBriefReport(params: {
  items: BeautyDailyBriefItem[];
  businessDate: string;
  cutoffAt: Date;
  now?: Date;
  trigger: BeautyDailyBriefTrigger;
  runtimeMode: Exclude<BeautyDailyBriefRuntimeMode, "disabled">;
  sourceWindowHours: 24 | 72;
  trends: BeautyDailyBriefReport["trends"];
  todayAction: BeautyDailyBriefReport["todayAction"];
}): BeautyDailyBriefReport {
  const now = params.now ?? new Date();
  const report: BeautyDailyBriefReport = {
    productCode: BEAUTY_DAILY_BRIEF_PRODUCT_CODE,
    capabilityId: BEAUTY_DAILY_BRIEF_CAPABILITY_ID,
    contractVersion: BEAUTY_DAILY_BRIEF_CONTRACT_VERSION,
    businessDate: params.businessDate,
    cutoffAt: params.cutoffAt.toISOString(),
    generatedAt: now.toISOString(),
    lastSuccessfulAt: now.toISOString(),
    trigger: params.trigger,
    sourceWindowHours: params.sourceWindowHours,
    runtimeMode: params.runtimeMode,
    ...(params.runtimeMode === "controlled_mock" ? { controlledNotice: "受控测试结果，非实时资讯，也不代表真实模型质量。" } : {}),
    sections: BEAUTY_DAILY_BRIEF_SECTIONS.map((name) => ({ name, items: params.items.filter((item) => item.section === name) })),
    trends: params.trends,
    todayAction: params.todayAction
  };
  const issues = validateBeautyDailyBriefReport(report);
  if (issues.length) throw new Error(`beauty_daily_brief_contract_failed:${issues.join(",")}`);
  return report;
}

function validateSourceCandidate(candidate: BeautyDailyBriefSourceCandidate, cutoffAt: Date, runtimeMode: Exclude<BeautyDailyBriefRuntimeMode, "disabled">): string[] {
  const issues: string[] = [];
  const sourceText = `${candidate.source} ${candidate.title} ${candidate.summary} ${candidate.sourceFacts.join(" ")} ${candidate.sourceLabel}`.normalize("NFKC");
  const interpretationText = `${candidate.sitongComment} ${candidate.possibleImpact} ${candidate.applicabilityConditions.join(" ")} ${candidate.verificationNeeded.join(" ")}`.normalize("NFKC");
  const text = `${sourceText} ${interpretationText}`;
  if (!BEAUTY_DAILY_BRIEF_SECTIONS.includes(candidate.section)) issues.push("section_invalid");
  if (!candidate.source.trim() || !candidate.title.trim() || !candidate.sourceLabel.trim()) issues.push("source_fields_missing");
  if (!BEAUTY_DAILY_BRIEF_SOURCE_INDUSTRIES.includes(candidate.sourceIndustry)) issues.push("source_industry_invalid");
  if (candidate.sourceFacts.length < 1 || candidate.sourceFacts.length > 4 || candidate.sourceFacts.some((fact) => !fact.trim())) issues.push("source_facts_invalid");
  if (countHanLike(candidate.summary) < 70 || countHanLike(candidate.summary) > 120) issues.push("summary_length_invalid");
  if (countHanLike(candidate.sitongComment) < 50 || countHanLike(candidate.sitongComment) > 90) issues.push("comment_length_invalid");
  let url: URL | undefined;
  try { url = new URL(candidate.sourceUrl); } catch { issues.push("source_url_invalid"); }
  if (url && !["http:", "https:"].includes(url.protocol)) issues.push("source_url_invalid");
  if (url?.hostname.endsWith(".invalid") && runtimeMode !== "controlled_mock") issues.push("fixture_url_forbidden_live");
  if (!candidate.reachable) issues.push("source_unreachable");
  if (!candidate.contentMatchesSource) issues.push("source_content_mismatch");
  if (candidate.verificationStatus === "verified_hotspot" && !candidate.authoritative) issues.push("verified_source_not_authoritative");
  if (!candidate.beautySegments.length || !BEAUTY_RELEVANCE.test(candidate.beautySegments.join(" "))) issues.push("beauty_relevance_missing");
  if (candidate.inferenceLabel !== "beauty_interpretation") issues.push("inference_label_missing");
  if (!candidate.possibleImpact.trim() || !INFERENCE_BOUNDARY.test(candidate.possibleImpact)) issues.push("inference_boundary_missing");
  if (!candidate.applicabilityConditions.length || candidate.applicabilityConditions.some((entry) => !entry.trim())) issues.push("applicability_conditions_missing");
  if (!candidate.verificationNeeded.length || candidate.verificationNeeded.some((entry) => !entry.trim())) issues.push("verification_needed_missing");
  if (FOREIGN_OR_INTERNAL.test(text)) issues.push("foreign_or_internal_pollution");
  if (MEDICAL_OR_PRICE_CLAIM.test(text)) issues.push("compliance_claim_forbidden");
  const published = new Date(candidate.publishedAt);
  if (Number.isNaN(published.getTime())) issues.push("published_at_invalid");
  else {
    const ageMs = cutoffAt.getTime() - published.getTime();
    if (ageMs < 0) issues.push("published_after_cutoff");
    if (ageMs > 72 * 60 * 60 * 1000) issues.push("source_older_than_72h");
  }
  return issues;
}

function chooseSectionQuota(candidates: BeautyDailyBriefSourceCandidate[]): BeautyDailyBriefSourceCandidate[] {
  return BEAUTY_DAILY_BRIEF_SECTIONS.flatMap((section) => candidates.filter((item) => item.section === section).slice(0, 3));
}

function deduplicateSources(candidates: BeautyDailyBriefSourceCandidate[]): BeautyDailyBriefSourceCandidate[] {
  const urls = new Set<string>();
  const titles = new Set<string>();
  return candidates.filter((item) => {
    const url = item.sourceUrl.trim().toLowerCase();
    const title = normalizeTitle(item.title);
    if (urls.has(url) || titles.has(title)) return false;
    urls.add(url); titles.add(title); return true;
  });
}

function stripEvidence(candidate: BeautyDailyBriefSourceCandidate): Omit<BeautyDailyBriefSourceCandidate, "reachable" | "authoritative" | "contentMatchesSource"> {
  const { reachable: _reachable, authoritative: _authoritative, contentMatchesSource: _contentMatchesSource, ...item } = candidate;
  return item;
}

function normalizeTitle(value: string): string { return value.normalize("NFKC").toLowerCase().replace(/[\s，。！？、：；,.!?:;（）()《》“”'"-]/g, ""); }
function countHanLike(value: string): number { return [...value.trim()].filter((char) => !/\s/u.test(char)).length; }
function assertBusinessDate(value: string): void { if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new Error("beauty_daily_brief_business_date_invalid"); }
function addBusinessDays(value: string, days: number): string { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function beijingLocalToUtc(businessDate: string, hour: number, minute: number): Date { return new Date(`${businessDate}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`); }
