import { createHash } from "node:crypto";
import {
  BEAUTY_DAILY_BRIEF_CAPABILITY_ID,
  BEAUTY_DAILY_BRIEF_CONTRACT_VERSION,
  BEAUTY_DAILY_BRIEF_PRODUCT_CODE,
  BEAUTY_DAILY_BRIEF_SECTIONS,
  validateBeautyDailyBriefReport,
  type BeautyDailyBriefReport,
  type BeautyDailyBriefSourceIndustry,
  type BeautyDailyBriefTrigger
} from "./daily-brief-contract.js";

export const BEAUTY_DAILY_BRIEF_LIVE_LIMITS = {
  allowedHosts: [
    "www.cac.gov.cn",
    "www.miit.gov.cn",
    "www.caict.ac.cn",
    "www.jiqizhixin.com",
    "www.leiphone.com",
    "www.tmtpost.com"
  ],
  listUrls: [
    "https://www.cac.gov.cn/yaowen/wxyw/A093602index_1.htm",
    "https://www.miit.gov.cn/xwfb/bldhd/index.html",
    "https://www.caict.ac.cn/kxyj/qwfb/",
    "https://www.jiqizhixin.com",
    "https://www.leiphone.com",
    "https://www.tmtpost.com"
  ],
  maxListRequests: 6,
  maxDetailRequests: 30,
  initialDetailRequestsPerHost: 5,
  maxDetailRequestsPerHost: 10,
  maxRedirectHops: 2,
  maxHttpRequestsPerDay: 36,
  maxHttpRequestsPerMonth: 1116,
  maxCandidates: 40,
  maxModelCallsPerDay: 1,
  maxModelCallsPerMonth: 31,
  maxPromptTokens: 25_000,
  maxPromptBytes: 100_000,
  maxOutputTokens: 5_120,
  maxCostYuanPerDay: 0.13,
  maxCostYuanPerMonth: 4.1
} as const;

const BEAUTY = /美业|美容|美妆|美甲|美睫|皮肤管理|医美|医疗美容|生美|科美|头疗|养发|门店|连锁/u;
const AI = /(?:\bAI\b|人工智能|大模型|基础模型|智能体|\bAgent\b|AIGC|生成式|机器学习|深度学习|神经网络|算法模型|智能计算|AI芯片|算力)/iu;
const FORBIDDEN = /餐饮|外卖|招商加盟|创始人\s*IP|保证治愈|根治|永久有效|百分之百|全网最低/u;
const AI_EVENT = /(?:\bAI\b|人工智能|大模型|基础模型|智能体|\bAgent\b|AIGC|生成式|机器学习|深度学习|神经网络|算法模型|智能计算|AI芯片|算力).{0,48}(?:发布|上线|更新|开源|报告|政策|规则|规范|办法|治理|监管|评测|融资|并购|合作|落地|应用)|(?:发布|上线|更新|开源|报告|政策|规则|规范|办法|治理|监管|评测|融资|并购|合作|落地|应用).{0,48}(?:\bAI\b|人工智能|大模型|基础模型|智能体|\bAgent\b|AIGC|生成式|机器学习|深度学习|神经网络|算法模型|智能计算|AI芯片|算力)/iu;
const MAX_BODY_BYTES = 2_000_000;

type CanonicalClass = "none" | "same_host" | "allowlisted_cross_host" | "external" | "invalid";

interface BeautyDailyBriefSourceAdapter {
  host: (typeof BEAUTY_DAILY_BRIEF_LIVE_LIMITS.allowedHosts)[number];
  listUrl: (typeof BEAUTY_DAILY_BRIEF_LIVE_LIMITS.listUrls)[number];
  sourceClass: "regulator" | "research" | "industry_media";
  evidenceBasis: "authorized_list_contract";
}

export const BEAUTY_DAILY_BRIEF_SOURCE_ADAPTERS: readonly BeautyDailyBriefSourceAdapter[] = [
  { host: "www.cac.gov.cn", listUrl: "https://www.cac.gov.cn/yaowen/wxyw/A093602index_1.htm", sourceClass: "regulator", evidenceBasis: "authorized_list_contract" },
  { host: "www.miit.gov.cn", listUrl: "https://www.miit.gov.cn/xwfb/bldhd/index.html", sourceClass: "regulator", evidenceBasis: "authorized_list_contract" },
  { host: "www.caict.ac.cn", listUrl: "https://www.caict.ac.cn/kxyj/qwfb/", sourceClass: "research", evidenceBasis: "authorized_list_contract" },
  { host: "www.jiqizhixin.com", listUrl: "https://www.jiqizhixin.com", sourceClass: "industry_media", evidenceBasis: "authorized_list_contract" },
  { host: "www.leiphone.com", listUrl: "https://www.leiphone.com", sourceClass: "industry_media", evidenceBasis: "authorized_list_contract" },
  { host: "www.tmtpost.com", listUrl: "https://www.tmtpost.com", sourceClass: "industry_media", evidenceBasis: "authorized_list_contract" }
] as const;

export interface BeautyDailyBriefRawSource {
  source: string;
  title: string;
  sourceUrl: string;
  publishedAt: string;
  excerpt: string;
  authoritative: boolean;
  sourceIndustry: BeautyDailyBriefSourceIndustry;
  directBeautyEvidence: boolean;
  evidenceFingerprint: string;
}

export interface BeautyDailyBriefSourceObservation {
  host: string;
  kind: "list" | "detail";
  status: number | "network_error";
  elapsedMs: number;
  finalHost: string;
  redirectClass: "none" | "same_host" | "allowlisted_cross_host" | "external_blocked" | "loop_blocked" | "limit_blocked" | "location_invalid";
  stage: "list_fetch" | "detail_fetch" | "redirect_follow";
  retryable: boolean;
  requestBudgetImpact: 1;
  originHost: string;
  rejectionReason?: string;
  dateParsed?: boolean;
  bodyParsed?: boolean;
  aiFactMatched?: boolean;
  canonicalClass?: CanonicalClass;
}

export interface BeautyDailyBriefSourceHostStats {
  host: string;
  listRequestCount: number;
  listStatuses: Array<number | "network_error">;
  listCandidates: number;
  initialQuota: number;
  allocatedDetails: number;
  actualDetailRequests: number;
  qualified: number;
  rejected: Record<string, number>;
  remainingCandidates: number;
  dateParsed: number;
  dateFailed: number;
  bodyParsed: number;
  bodyFailed: number;
  aiFactMatched: number;
  aiFactRejected: number;
}

export interface BeautyDailyBriefCollectionResult {
  candidates: BeautyDailyBriefRawSource[];
  requestCount: number;
  listRequestCount: number;
  detailRequestCount: number;
  redirectBlockedCount: number;
  observations: BeautyDailyBriefSourceObservation[];
  sourceStats: BeautyDailyBriefSourceHostStats[];
}

export function buildBeautyDailyBriefLivePrompt(params: {
  businessDate: string;
  cutoffAt: Date;
  sourceWindowHours: 24 | 72;
  trigger: BeautyDailyBriefTrigger;
  candidates: BeautyDailyBriefRawSource[];
}): string {
  if (params.candidates.length < 15) throw new Error("beauty_daily_brief_source_insufficient");
  const evidence = params.candidates.slice(0, 40).map((item, index) => ({
    id: index + 1,
    source: item.source,
    title: item.title,
    sourceUrl: item.sourceUrl,
    publishedAt: item.publishedAt,
    authoritative: item.authoritative,
    sourceIndustry: item.sourceIndustry,
    directBeautyEvidence: item.directBeautyEvidence,
    excerpt: item.excerpt.slice(0, 600)
  }));
  const prompt = [
    "你是美业智能体的公开资讯日报编辑。只返回一个 JSON 对象，不要 Markdown。",
    `固定产品=${BEAUTY_DAILY_BRIEF_PRODUCT_CODE}，capability=${BEAUTY_DAILY_BRIEF_CAPABILITY_ID}，contractVersion=${BEAUTY_DAILY_BRIEF_CONTRACT_VERSION}。`,
    `业务日期=${params.businessDate}；截止=${params.cutoffAt.toISOString()}；窗口=${params.sourceWindowHours}小时；触发=${params.trigger}。`,
    `必须严格输出五版块且按此顺序：${BEAUTY_DAILY_BRIEF_SECTIONS.join("、")}；每版块3条，共15条；另含3条trends和todayAction。`,
    "来源多样性是硬约束：15条至少覆盖4个来源域，必须同时包含监管、研究和行业媒体；任一域最多6条，每个版块的3条至少来自2个不同域。不得为满足配额改写来源身份或放宽事实门禁。",
    "采用严格两层合同。来源事实层：每条只能引用下列证据中的一个 sourceUrl，source/title/publishedAt/sourceIndustry 必须与证据一致；summary 70-120字且只概括原文；sourceFacts 为1-4条可由标题或excerpt逐项核验的核心事实。原文没有美业事实时，summary/sourceFacts不得写成已经在美业、门店或顾客中发生。",
    "美业解释与行动层：inferenceLabel 固定为 beauty_interpretation；possibleImpact 必须明确使用‘可能/若/需核验’等推断边界；sitongComment 50-90字并给老板可执行建议；applicabilityConditions 和 verificationNeeded 各至少1条。推断不得写入summary/sourceFacts，不得虚构门店、顾客、品牌、价格、疗效或经营数字。",
    "每条 verificationStatus 只能是 verified_hotspot 或 trend_observation；beautySegments 表示建议可能适用的美业细分类，不代表原文已发生美业案例。企业改造案例允许有来源的企业、零售或本地服务案例，但必须保留 sourceIndustry，并只说明可借鉴点。",
    "不得补造来源、日期、数字、事件、案例、疗效或价格。没有足够证据支撑严格结构时返回 {\"error\":\"source_or_structure_insufficient\"}。",
    "JSON 顶层字段：productCode,capabilityId,contractVersion,businessDate,cutoffAt,generatedAt,lastSuccessfulAt,trigger,sourceWindowHours,runtimeMode,sections,trends,todayAction。runtimeMode 必须 live。",
    `公开证据：${JSON.stringify(evidence)}`
  ].join("\n");
  const bytes = Buffer.byteLength(prompt, "utf8");
  const conservativeTokens = [...prompt].length;
  if (bytes > BEAUTY_DAILY_BRIEF_LIVE_LIMITS.maxPromptBytes) throw new Error("beauty_daily_brief_prompt_bytes_exceeded");
  if (conservativeTokens > BEAUTY_DAILY_BRIEF_LIVE_LIMITS.maxPromptTokens) throw new Error("beauty_daily_brief_prompt_tokens_exceeded");
  return prompt;
}

export function parseBeautyDailyBriefLiveReport(raw: string, candidates: BeautyDailyBriefRawSource[]): BeautyDailyBriefReport {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  let report: BeautyDailyBriefReport;
  try { report = JSON.parse(cleaned) as BeautyDailyBriefReport; }
  catch { throw new Error("beauty_daily_brief_contract_failed:json_invalid"); }
  const issues = validateBeautyDailyBriefReport(report);
  const evidence = new Map(candidates.map((item) => [item.sourceUrl, item]));
  for (const [index, item] of report.sections.flatMap((section) => section.items).entries()) {
    const source = evidence.get(item.sourceUrl);
    if (!source) issues.push(`item_${index + 1}:source_not_in_verified_set`);
    else {
      if (item.source !== source.source || item.title !== source.title) issues.push(`item_${index + 1}:source_identity_mismatch`);
      if (new Date(item.publishedAt).getTime() !== new Date(source.publishedAt).getTime()) issues.push(`item_${index + 1}:published_at_mismatch`);
      if (item.sourceIndustry !== source.sourceIndustry) issues.push(`item_${index + 1}:source_industry_mismatch`);
      const sourceFactText = `${item.summary} ${item.sourceFacts.join(" ")}`;
      const evidenceText = `${source.title} ${source.excerpt}`;
      if (!hasEvidenceOverlap(sourceFactText, evidenceText)) issues.push(`item_${index + 1}:fact_evidence_weak`);
      if (item.sourceFacts.some((fact) => !hasEvidenceOverlap(fact, evidenceText))) issues.push(`item_${index + 1}:source_fact_not_grounded`);
      if (BEAUTY.test(sourceFactText) && !source.directBeautyEvidence) issues.push(`item_${index + 1}:beauty_fact_not_in_source`);
      if (item.inferenceLabel !== "beauty_interpretation") issues.push(`item_${index + 1}:inference_label_missing`);
    }
  }
  issues.push(...validateBeautyDailyBriefSourceDiversity(report));
  if (issues.length) throw new Error(`beauty_daily_brief_contract_failed:${issues.join(",")}`);
  return report;
}

export function validateBeautyDailyBriefSourceDiversity(report: Pick<BeautyDailyBriefReport, "sections">): string[] {
  const issues: string[] = [];
  const items = report.sections.flatMap((section) => section.items);
  const hosts = items.map((item) => safeHost(item.sourceUrl)).filter((host): host is string => Boolean(host));
  const counts = new Map<string, number>();
  for (const host of hosts) counts.set(host, (counts.get(host) ?? 0) + 1);
  if (counts.size < 4) issues.push("source_diversity_domain_count_insufficient");
  if ([...counts.values()].some((count) => count > 6)) issues.push("source_diversity_single_domain_exceeded");
  const classes = new Set(hosts.map(sourceClass));
  for (const required of ["regulator", "research", "industry_media"] as const) {
    if (!classes.has(required)) issues.push(`source_diversity_${required}_missing`);
  }
  for (const section of report.sections) {
    const sectionHosts = new Set(section.items.map((item) => safeHost(item.sourceUrl)).filter(Boolean));
    if (sectionHosts.size < 2) issues.push(`source_diversity_section_domain_insufficient:${section.name}`);
  }
  return issues;
}

export function validateBeautyDailyBriefCandidateDiversity(candidates: BeautyDailyBriefRawSource[]): string[] {
  const issues: string[] = [];
  const hosts = candidates.map((item) => safeHost(item.sourceUrl)).filter((host): host is string => Boolean(host));
  const counts = new Map<string, number>();
  for (const host of hosts) counts.set(host, (counts.get(host) ?? 0) + 1);
  if (counts.size < 4) issues.push("candidate_diversity_domain_count_insufficient");
  if ([...counts.values()].some((count) => count > 10)) issues.push("candidate_diversity_single_domain_exceeded");
  const classes = new Set(hosts.map(sourceClass));
  for (const required of ["regulator", "research", "industry_media"] as const) {
    if (!classes.has(required)) issues.push(`candidate_diversity_${required}_missing`);
  }
  return issues;
}

export function estimateBeautyDailyBriefWorstModelCost(): number {
  return Number(((BEAUTY_DAILY_BRIEF_LIVE_LIMITS.maxPromptTokens * 3.48
    + BEAUTY_DAILY_BRIEF_LIVE_LIMITS.maxOutputTokens * 6.96) / 1_000_000).toFixed(6));
}

export function estimateBeautyDailyBriefModelCost(promptTokens: number, completionTokens: number): number {
  return Number(((promptTokens * 3.48 + completionTokens * 6.96) / 1_000_000).toFixed(6));
}

export function validateBeautyDailyBriefLiveConfig(config: {
  dailyHttp: number; monthlyHttp: number; dailyModels: number; monthlyModels: number; dailyCost: number; monthlyCost: number;
}): string[] {
  const issues: string[] = [];
  if (config.dailyHttp < 1 || config.dailyHttp > 36) issues.push("daily_http_limit_invalid");
  if (config.monthlyHttp < config.dailyHttp || config.monthlyHttp > 1116) issues.push("monthly_http_limit_invalid");
  if (config.dailyModels !== 1) issues.push("daily_model_limit_invalid");
  if (config.monthlyModels < 1 || config.monthlyModels > 31) issues.push("monthly_model_limit_invalid");
  if (config.dailyCost <= 0 || config.dailyCost > 0.13) issues.push("daily_cost_limit_invalid");
  if (config.monthlyCost < config.dailyCost || config.monthlyCost > 4.1) issues.push("monthly_cost_limit_invalid");
  if (estimateBeautyDailyBriefWorstModelCost() > config.dailyCost) issues.push("worst_cost_exceeds_daily_limit");
  return issues;
}

export async function collectBeautyDailyBriefSources(params: {
  cutoffAt: Date;
  fetchImpl?: typeof fetch;
  listUrls?: readonly string[];
  maxDetailRequests?: number;
  beforeRequest?: (request: { url: string; kind: "list" | "detail" }) => void | Promise<void>;
}): Promise<BeautyDailyBriefCollectionResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const listUrls = (params.listUrls ?? BEAUTY_DAILY_BRIEF_LIVE_LIMITS.listUrls).slice(0, 6);
  const maxDetailRequests = Math.min(params.maxDetailRequests ?? 30, BEAUTY_DAILY_BRIEF_LIVE_LIMITS.maxDetailRequests);
  const observations: BeautyDailyBriefSourceObservation[] = [];
  let redirectBlockedCount = 0;
  const discovered: Array<{ url: string; title: string; nearbyDate?: string }> = [];

  for (const url of listUrls) {
    assertStrictAllowedUrl(url);
    const result = await boundedFetch(fetchImpl, url, "list", observations, params.beforeRequest, BEAUTY_DAILY_BRIEF_LIVE_LIMITS.maxHttpRequestsPerDay, new URL(url).hostname);
    if (result.blockedRedirect) { redirectBlockedCount += 1; continue; }
    if (!result.body) continue;
    discovered.push(...extractLinks(result.body, result.finalUrl));
  }

  const unique = new Map<string, { url: string; title: string; nearbyDate?: string }>();
  for (const item of discovered) {
    try {
      assertStrictAllowedUrl(item.url);
      if (!unique.has(item.url)) unique.set(item.url, item);
    } catch { /* fail closed: discard off-allowlist and malformed links */ }
  }
  const buckets = new Map<string, Array<{ url: string; title: string; nearbyDate?: string }>>();
  for (const item of unique.values()) {
    const host = new URL(item.url).hostname;
    buckets.set(host, [...(buckets.get(host) ?? []), item]);
  }
  for (const [host, items] of buckets) buckets.set(host, items.sort((a, b) => compareDiscovered(a, b, params.cutoffAt)));
  const selected = buildFairDetailSchedule(buckets, maxDetailRequests);
  const candidates: BeautyDailyBriefRawSource[] = [];
  const allocatedByHost = new Map<string, number>();
  for (const item of selected) {
    const originHost = new URL(item.url).hostname;
    const detailRequestsUsed = observations.filter((entry) => entry.kind === "detail").length;
    if (detailRequestsUsed >= maxDetailRequests || observations.length >= BEAUTY_DAILY_BRIEF_LIVE_LIMITS.maxHttpRequestsPerDay) break;
    allocatedByHost.set(originHost, (allocatedByHost.get(originHost) ?? 0) + 1);
    const result = await boundedFetch(fetchImpl, item.url, "detail", observations, params.beforeRequest, Math.min(BEAUTY_DAILY_BRIEF_LIVE_LIMITS.maxHttpRequestsPerDay, observations.length + (maxDetailRequests - detailRequestsUsed)), originHost);
    if (result.blockedRedirect) { redirectBlockedCount += 1; continue; }
    if (!result.body) continue;
    const parsed = inspectBeautyDailyBriefArticle(result.body, { ...item, url: result.finalUrl }, params.cutoffAt);
    const terminal = findTerminalDetailObservation(observations, originHost);
    if (terminal) {
      terminal.dateParsed = parsed.dateParsed;
      terminal.bodyParsed = parsed.bodyParsed;
      terminal.aiFactMatched = parsed.aiFactMatched;
      terminal.canonicalClass = parsed.canonicalClass;
      if (parsed.rejectionReason) terminal.rejectionReason = parsed.rejectionReason;
    }
    if (parsed.candidate) candidates.push(parsed.candidate);
  }
  const sourceStats = BEAUTY_DAILY_BRIEF_LIVE_LIMITS.allowedHosts.map((host) => {
    const items = buckets.get(host) ?? [];
    const listObservations = observations.filter((item) => item.kind === "list" && item.originHost === host);
    const hostObservations = observations.filter((item) => item.kind === "detail" && item.originHost === host);
    const rejected: Record<string, number> = {};
    for (const observation of hostObservations) if (observation.rejectionReason) rejected[observation.rejectionReason] = (rejected[observation.rejectionReason] ?? 0) + 1;
    const qualified = candidates.filter((item) => safeHost(item.sourceUrl) === host).length;
    const allocatedDetails = allocatedByHost.get(host) ?? 0;
    return {
      host,
      listRequestCount: listObservations.length,
      listStatuses: listObservations.map((item) => item.status),
      listCandidates: items.length,
      initialQuota: Math.min(items.length, BEAUTY_DAILY_BRIEF_LIVE_LIMITS.initialDetailRequestsPerHost),
      allocatedDetails,
      actualDetailRequests: hostObservations.length,
      qualified,
      rejected,
      remainingCandidates: Math.max(0, items.length - allocatedDetails),
      dateParsed: hostObservations.filter((item) => item.dateParsed).length,
      dateFailed: hostObservations.filter((item) => item.dateParsed === false).length,
      bodyParsed: hostObservations.filter((item) => item.bodyParsed).length,
      bodyFailed: hostObservations.filter((item) => item.bodyParsed === false).length,
      aiFactMatched: hostObservations.filter((item) => item.aiFactMatched).length,
      aiFactRejected: hostObservations.filter((item) => item.aiFactMatched === false).length
    };
  });
  return {
    candidates: candidates.slice(0, BEAUTY_DAILY_BRIEF_LIVE_LIMITS.maxCandidates),
    requestCount: observations.length,
    listRequestCount: observations.filter((item) => item.kind === "list").length,
    detailRequestCount: observations.filter((item) => item.kind === "detail").length,
    redirectBlockedCount,
    observations,
    sourceStats
  };
}

function assertStrictAllowedUrl(raw: string): void {
  const url = new URL(raw);
  if (url.protocol !== "https:" || !BEAUTY_DAILY_BRIEF_LIVE_LIMITS.allowedHosts.includes(url.hostname as never)) {
    throw new Error("beauty_daily_brief_source_not_allowlisted");
  }
  if (url.username || url.password) throw new Error("beauty_daily_brief_source_credentials_forbidden");
  if (url.port && url.port !== "443") throw new Error("beauty_daily_brief_source_port_forbidden");
  if (/^(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\])$/iu.test(url.hostname)) throw new Error("beauty_daily_brief_source_ip_literal_forbidden");
}

async function boundedFetch(fetchImpl: typeof fetch, initialUrl: string, kind: "list" | "detail", observations: BeautyDailyBriefSourceObservation[], beforeRequest: ((request: { url: string; kind: "list" | "detail" }) => void | Promise<void>) | undefined, absoluteObservationLimit: number, originHost: string): Promise<{ body?: string; blockedRedirect: boolean; finalUrl: string }> {
  let currentUrl = initialUrl;
  const visited = new Set<string>();
  for (let hop = 0; hop <= BEAUTY_DAILY_BRIEF_LIVE_LIMITS.maxRedirectHops; hop += 1) {
    if (observations.length >= absoluteObservationLimit || observations.length >= BEAUTY_DAILY_BRIEF_LIVE_LIMITS.maxHttpRequestsPerDay) return { blockedRedirect: true, finalUrl: currentUrl };
    assertStrictAllowedUrl(currentUrl);
    const normalized = normalizeRequestUrl(currentUrl);
    if (visited.has(normalized)) return { blockedRedirect: true, finalUrl: currentUrl };
    visited.add(normalized);
    const started = Date.now();
    let status: number | "network_error" = "network_error";
    let response: Response | undefined;
    try {
      await beforeRequest?.({ url: currentUrl, kind });
      response = await fetchImpl(currentUrl, {
        redirect: "manual",
        headers: { accept: "text/html,application/xhtml+xml", "user-agent": "SitongBeautyDailyBrief/1.0" },
        signal: AbortSignal.timeout(8_000)
      });
      status = response.status;
    } catch {
      observations.push(makeObservation({ currentUrl, originHost, kind, status, started, redirectClass: "none", rejectionReason: "network_error", retryable: true, stage: hop ? "redirect_follow" : `${kind}_fetch` }));
      return { blockedRedirect: false, finalUrl: currentUrl };
    }
    if (status >= 300 && status < 400) {
      const location = response.headers.get("location");
      let nextUrl: string | undefined;
      try { if (location) nextUrl = new URL(location, currentUrl).toString(); } catch { nextUrl = undefined; }
      if (!nextUrl) {
        observations.push(makeObservation({ currentUrl, originHost, kind, status, started, redirectClass: "location_invalid", rejectionReason: "redirect_location_invalid", retryable: false, stage: hop ? "redirect_follow" : `${kind}_fetch` }));
        return { blockedRedirect: true, finalUrl: currentUrl };
      }
      const currentHost = new URL(currentUrl).hostname;
      const nextHost = new URL(nextUrl).hostname;
      const allowlisted = BEAUTY_DAILY_BRIEF_LIVE_LIMITS.allowedHosts.includes(nextHost as never);
      const redirectClass = !allowlisted ? "external_blocked" : nextHost === currentHost ? "same_host" : "allowlisted_cross_host";
      if (!allowlisted) {
        observations.push(makeObservation({ currentUrl, originHost, kind, status, started, finalHost: nextHost, redirectClass, rejectionReason: "redirect_external", retryable: false, stage: hop ? "redirect_follow" : `${kind}_fetch` }));
        return { blockedRedirect: true, finalUrl: currentUrl };
      }
      try { assertStrictAllowedUrl(nextUrl); } catch {
        observations.push(makeObservation({ currentUrl, originHost, kind, status, started, finalHost: nextHost, redirectClass: "external_blocked", rejectionReason: "redirect_target_unsafe", retryable: false, stage: hop ? "redirect_follow" : `${kind}_fetch` }));
        return { blockedRedirect: true, finalUrl: currentUrl };
      }
      if (visited.has(normalizeRequestUrl(nextUrl))) {
        observations.push(makeObservation({ currentUrl, originHost, kind, status, started, finalHost: nextHost, redirectClass: "loop_blocked", rejectionReason: "redirect_loop", retryable: false, stage: hop ? "redirect_follow" : `${kind}_fetch` }));
        return { blockedRedirect: true, finalUrl: currentUrl };
      }
      if (hop >= BEAUTY_DAILY_BRIEF_LIVE_LIMITS.maxRedirectHops) {
        observations.push(makeObservation({ currentUrl, originHost, kind, status, started, finalHost: nextHost, redirectClass: "limit_blocked", rejectionReason: "redirect_limit", retryable: false, stage: "redirect_follow" }));
        return { blockedRedirect: true, finalUrl: currentUrl };
      }
      observations.push(makeObservation({ currentUrl, originHost, kind, status, started, finalHost: nextHost, redirectClass, retryable: false, stage: hop ? "redirect_follow" : `${kind}_fetch` }));
      currentUrl = nextUrl;
      continue;
    }
    if (!response.ok) {
      const rejectionReason = status === 412 ? "http_412_adapter_required" : status === 404 ? "http_404" : status === 429 ? "http_429" : status >= 500 ? "http_5xx" : `http_${status}`;
      observations.push(makeObservation({ currentUrl, originHost, kind, status, started, redirectClass: "none", rejectionReason, retryable: status === 429 || status >= 500, stage: hop ? "redirect_follow" : `${kind}_fetch` }));
      return { blockedRedirect: false, finalUrl: currentUrl };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BODY_BYTES) {
      observations.push(makeObservation({ currentUrl, originHost, kind, status, started, redirectClass: "none", rejectionReason: "body_too_large", retryable: false, stage: hop ? "redirect_follow" : `${kind}_fetch` }));
      return { blockedRedirect: false, finalUrl: currentUrl };
    }
    observations.push(makeObservation({ currentUrl, originHost, kind, status, started, redirectClass: "none", retryable: false, stage: hop ? "redirect_follow" : `${kind}_fetch` }));
    return { body: new TextDecoder("utf-8").decode(bytes), blockedRedirect: false, finalUrl: currentUrl };
  }
  return { blockedRedirect: true, finalUrl: currentUrl };
}

function makeObservation(params: { currentUrl: string; originHost: string; kind: "list" | "detail"; status: number | "network_error"; started: number; finalHost?: string; redirectClass: BeautyDailyBriefSourceObservation["redirectClass"]; stage: BeautyDailyBriefSourceObservation["stage"]; retryable: boolean; rejectionReason?: string }): BeautyDailyBriefSourceObservation {
  const host = new URL(params.currentUrl).hostname;
  return { host, kind: params.kind, status: params.status, elapsedMs: Date.now() - params.started, finalHost: params.finalHost ?? host, redirectClass: params.redirectClass, stage: params.stage, retryable: params.retryable, requestBudgetImpact: 1, originHost: params.originHost, ...(params.rejectionReason ? { rejectionReason: params.rejectionReason } : {}) };
}

function findTerminalDetailObservation(observations: BeautyDailyBriefSourceObservation[], originHost: string): BeautyDailyBriefSourceObservation | undefined {
  for (let index = observations.length - 1; index >= 0; index -= 1) {
    const observation = observations[index];
    if (observation?.kind === "detail" && observation.originHost === originHost && observation.status === 200) return observation;
  }
  return undefined;
}

function buildFairDetailSchedule(buckets: Map<string, Array<{ url: string; title: string; nearbyDate?: string }>>, maxDetails: number): Array<{ url: string; title: string; nearbyDate?: string }> {
  const hosts = BEAUTY_DAILY_BRIEF_LIVE_LIMITS.allowedHosts.filter((host) => (buckets.get(host)?.length ?? 0) > 0);
  const selected: Array<{ url: string; title: string; nearbyDate?: string }> = [];
  const used = new Map(hosts.map((host) => [host, 0]));
  for (let round = 0; round < BEAUTY_DAILY_BRIEF_LIVE_LIMITS.initialDetailRequestsPerHost && selected.length < maxDetails; round += 1) {
    for (const host of hosts) {
      const item = buckets.get(host)?.[round];
      if (!item || selected.length >= maxDetails) continue;
      selected.push(item); used.set(host, (used.get(host) ?? 0) + 1);
    }
  }
  let advanced = true;
  while (selected.length < maxDetails && advanced) {
    advanced = false;
    for (const host of hosts) {
      const index = used.get(host) ?? 0;
      if (index >= BEAUTY_DAILY_BRIEF_LIVE_LIMITS.maxDetailRequestsPerHost) continue;
      const item = buckets.get(host)?.[index];
      if (!item || selected.length >= maxDetails) continue;
      selected.push(item); used.set(host, index + 1); advanced = true;
    }
  }
  return selected;
}

function compareDiscovered(a: { title: string; nearbyDate?: string }, b: { title: string; nearbyDate?: string }, cutoffAt: Date): number {
  const beauty = Number(BEAUTY.test(b.title)) - Number(BEAUTY.test(a.title));
  if (beauty) return beauty;
  const dateA = normalizePublishedAt(a.nearbyDate) ? new Date(normalizePublishedAt(a.nearbyDate) as string).getTime() : 0;
  const dateB = normalizePublishedAt(b.nearbyDate) ? new Date(normalizePublishedAt(b.nearbyDate) as string).getTime() : 0;
  const validA = dateA <= cutoffAt.getTime() ? dateA : 0;
  const validB = dateB <= cutoffAt.getTime() ? dateB : 0;
  return validB - validA || a.title.localeCompare(b.title, "zh-CN");
}

function normalizeRequestUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_.+|spm|from|source|ref)$/iu.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}
function safeHost(raw: string): string | undefined { try { return new URL(raw).hostname; } catch { return undefined; } }
function sourceClass(host: string): "regulator" | "research" | "industry_media" | "unknown" {
  if (host === "www.cac.gov.cn" || host === "www.miit.gov.cn") return "regulator";
  if (host === "www.caict.ac.cn") return "research";
  if (["www.jiqizhixin.com", "www.leiphone.com", "www.tmtpost.com"].includes(host)) return "industry_media";
  return "unknown";
}

function extractLinks(body: string, baseUrl: string): Array<{ url: string; title: string; nearbyDate?: string }> {
  const found: Array<{ url: string; title: string; nearbyDate?: string }> = [];
  for (const item of body.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/giu)) {
    const block = item[1];
    const title = cleanText(readXmlTag(block, "title"));
    const href = cleanText(readXmlTag(block, "link"));
    const nearbyDate = cleanText(readXmlTag(block, "pubDate") || readXmlTag(block, "published") || readXmlTag(block, "date"));
    pushDiscovery(found, baseUrl, href, title, nearbyDate);
  }
  for (const entry of body.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/giu)) {
    const block = entry[1];
    const title = cleanText(readXmlTag(block, "title"));
    const linkTag = block.match(/<link\b[^>]*>/iu)?.[0] ?? "";
    const href = linkTag.match(/\bhref=["']([^"']+)["']/iu)?.[1] ?? cleanText(readXmlTag(block, "link"));
    const nearbyDate = cleanText(readXmlTag(block, "published") || readXmlTag(block, "updated"));
    pushDiscovery(found, baseUrl, href, title, nearbyDate);
  }
  for (const match of body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu)) {
    const title = cleanText(match[2]);
    if (title.length < 6 || title.length > 160) continue;
    let url: string;
    try { url = new URL(match[1], baseUrl).toString(); } catch { continue; }
    const matchIndex = match.index ?? 0;
    found.push({ url, title, nearbyDate: extractClosestDate(body, matchIndex, matchIndex + match[0].length) });
  }
  const seen = new Set<string>();
  return found.filter((item) => {
    const key = normalizeRequestUrl(item.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readXmlTag(block: string, name: string): string {
  return block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "iu"))?.[1]?.replace(/^<!\[CDATA\[|\]\]>$/gu, "") ?? "";
}

function pushDiscovery(found: Array<{ url: string; title: string; nearbyDate?: string }>, baseUrl: string, href: string, title: string, nearbyDate?: string): void {
  if (title.length < 6 || title.length > 160 || !href) return;
  try {
    found.push({ url: new URL(href, baseUrl).toString(), title, nearbyDate: nearbyDate || undefined });
  } catch {
    // Invalid feed links remain fail-closed and never enter the request schedule.
  }
}

export interface BeautyDailyBriefArticleInspection {
  candidate?: BeautyDailyBriefRawSource;
  rejectionReason?: "article_title_missing" | "article_date_missing" | "article_date_invalid" | "article_date_future" | "article_date_outside_72h" | "article_body_missing" | "article_ai_fact_missing" | "article_forbidden";
  dateParsed: boolean;
  bodyParsed: boolean;
  aiFactMatched: boolean;
  canonicalClass: CanonicalClass;
}

export function parseBeautyDailyBriefArticle(body: string, discovery: { url: string; title: string; nearbyDate?: string }, cutoffAt: Date): BeautyDailyBriefRawSource | undefined {
  return inspectBeautyDailyBriefArticle(body, discovery, cutoffAt).candidate;
}

export function inspectBeautyDailyBriefArticle(body: string, discovery: { url: string; title: string; nearbyDate?: string }, cutoffAt: Date): BeautyDailyBriefArticleInspection {
  const canonical = inspectCanonicalUrl(body, discovery.url);
  const sourceUrl = canonical.classification === "same_host" && canonical.url ? canonical.url : normalizeRequestUrl(discovery.url);
  const article = extractArticleContent(body);
  const title = cleanText(
    findMetaContent(body, ["og:title", "twitter:title"])
      ?? readJsonLdString(body, "headline")
      ?? article.html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/iu)?.[1]
      ?? body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1]
      ?? discovery.title
  ).slice(0, 160);
  if (title.length < 6) return inspectionFailure("article_title_missing", false, article.text.length >= 16, false, canonical.classification);

  const publishedRaw = findMetaContent(body, ["article:published_time", "datepublished", "publishdate", "pubdate"])
    ?? readJsonLdString(body, "datePublished")
    ?? findTimeDatetime(article.html)
    ?? extractDate(article.html)
    ?? discovery.nearbyDate;
  if (!publishedRaw) return inspectionFailure("article_date_missing", false, article.text.length >= 16, false, canonical.classification);
  const publishedAt = normalizePublishedAt(publishedRaw);
  if (!publishedAt) return inspectionFailure("article_date_invalid", false, article.text.length >= 16, false, canonical.classification);
  const age = cutoffAt.getTime() - new Date(publishedAt).getTime();
  if (age < 0) return inspectionFailure("article_date_future", true, article.text.length >= 16, false, canonical.classification);
  if (age > 72 * 3_600_000) return inspectionFailure("article_date_outside_72h", true, article.text.length >= 16, false, canonical.classification);
  if (article.text.length < 16) return inspectionFailure("article_body_missing", true, false, false, canonical.classification);

  const evidence = `${title} ${article.text.slice(0, 4_000)}`;
  const aiFactMatched = AI.test(title) || AI_EVENT.test(article.text);
  if (!aiFactMatched) return inspectionFailure("article_ai_fact_missing", true, true, false, canonical.classification);
  if (FORBIDDEN.test(evidence)) return inspectionFailure("article_forbidden", true, true, true, canonical.classification);
  const host = new URL(sourceUrl).hostname;
  const adapter = BEAUTY_DAILY_BRIEF_SOURCE_ADAPTERS.find((item) => item.host === host);
  if (!adapter) throw new Error("beauty_daily_brief_source_adapter_missing");
  const authoritative = adapter.sourceClass !== "industry_media";
  const directBeautyEvidence = BEAUTY.test(evidence);
  return {
    candidate: {
      source: host,
      title,
      sourceUrl,
      publishedAt,
      excerpt: article.text.slice(0, 1_200),
      authoritative,
      sourceIndustry: classifySourceIndustry(evidence, host),
      directBeautyEvidence,
      evidenceFingerprint: createHash("sha256").update(`${sourceUrl}\n${title}\n${publishedAt}\n${article.text.slice(0, 1200)}`).digest("hex").slice(0, 16)
    },
    dateParsed: true,
    bodyParsed: true,
    aiFactMatched: true,
    canonicalClass: canonical.classification
  };
}

function inspectionFailure(rejectionReason: NonNullable<BeautyDailyBriefArticleInspection["rejectionReason"]>, dateParsed: boolean, bodyParsed: boolean, aiFactMatched: boolean, canonicalClass: CanonicalClass): BeautyDailyBriefArticleInspection {
  return { rejectionReason, dateParsed, bodyParsed, aiFactMatched, canonicalClass };
}

function extractArticleContent(body: string): { html: string; text: string; source: "json_ld" | "article" | "article_body" | "main" | "body" | "none" } {
  const jsonBody = readJsonLdString(body, "articleBody");
  if (jsonBody) return { html: jsonBody, text: cleanText(jsonBody), source: "json_ld" };
  const article = body.match(/<article\b[^>]*>([\s\S]*?)<\/article>/iu)?.[1];
  if (article) return { html: article, text: cleanText(article), source: "article" };
  const articleBody = body.match(/<([a-z][\w:-]*)\b[^>]*\bitemprop=["']articleBody["'][^>]*>([\s\S]*?)<\/\1>/iu)?.[2];
  if (articleBody) return { html: articleBody, text: cleanText(articleBody), source: "article_body" };
  const main = body.match(/<main\b[^>]*>([\s\S]*?)<\/main>/iu)?.[1];
  if (main) return { html: main, text: cleanText(main), source: "main" };
  const rawBody = body.match(/<body\b[^>]*>([\s\S]*?)<\/body>/iu)?.[1] ?? "";
  const pruned = rawBody.replace(/<(?:nav|header|footer|aside|form|script|style|noscript)\b[\s\S]*?<\/(?:nav|header|footer|aside|form|script|style|noscript)>/giu, " ");
  const text = cleanText(pruned);
  return text ? { html: pruned, text, source: "body" } : { html: "", text: "", source: "none" };
}

function inspectCanonicalUrl(body: string, pageUrl: string): { classification: CanonicalClass; url?: string } {
  const tag = [...body.matchAll(/<link\b[^>]*>/giu)].find((match) => (readAttributes(match[0]).rel ?? "").toLowerCase().split(/\s+/u).includes("canonical"))?.[0];
  if (!tag) return { classification: "none" };
  const href = readAttributes(tag).href;
  if (!href) return { classification: "invalid" };
  try {
    const url = new URL(href, pageUrl);
    assertStrictAllowedUrl(url.toString());
    const classification: CanonicalClass = url.hostname === new URL(pageUrl).hostname ? "same_host" : "allowlisted_cross_host";
    return { classification, url: normalizeRequestUrl(url.toString()) };
  } catch {
    try { return { classification: BEAUTY_DAILY_BRIEF_LIVE_LIMITS.allowedHosts.includes(new URL(href, pageUrl).hostname as never) ? "invalid" : "external" }; }
    catch { return { classification: "invalid" }; }
  }
}

function findMetaContent(body: string, keys: string[]): string | undefined {
  const wanted = new Set(keys.map((item) => item.toLowerCase()));
  for (const match of body.matchAll(/<meta\b[^>]*>/giu)) {
    const attributes = readAttributes(match[0]);
    const key = (attributes.property ?? attributes.name ?? attributes.itemprop ?? "").toLowerCase();
    if (wanted.has(key) && attributes.content?.trim()) return attributes.content.trim();
  }
  return undefined;
}

function findTimeDatetime(body: string): string | undefined {
  for (const match of body.matchAll(/<time\b[^>]*>/giu)) {
    const datetime = readAttributes(match[0]).datetime;
    if (datetime?.trim()) return datetime.trim();
  }
  return undefined;
}

function readAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gu)) attributes[match[1].toLowerCase()] = decodeEntities(match[3]);
  return attributes;
}

function readJsonLdString(body: string, key: string): string | undefined {
  const raw = body.match(new RegExp(`["']${key}["']\\s*:\\s*["']((?:\\\\.|[^"'])*)["']`, "iu"))?.[1];
  if (!raw) return undefined;
  try { return JSON.parse(`"${raw.replace(/"/gu, '\\"')}"`) as string; }
  catch { return raw.replace(/\\n/gu, " ").replace(/\\"/gu, '"'); }
}

function normalizePublishedAt(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().replace(/[年/月]/g, "-").replace(/日/g, " ");
  const date = new Date(/(?:Z|[+-]\d\d:?\d\d)$/u.test(normalized) ? normalized : `${normalized.trim().replace(" ", "T")}+08:00`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function extractDate(value: string): string | undefined {
  return value.match(/20\d{2}[-年/.]\d{1,2}[-月/.]\d{1,2}(?:[日\sT]+\d{1,2}:\d{2}(?::\d{2})?)?/u)?.[0];
}

function extractClosestDate(value: string, start: number, end: number): string | undefined {
  const windowStart = Math.max(0, start - 260);
  const windowEnd = Math.min(value.length, end + 260);
  const window = value.slice(windowStart, windowEnd);
  const matches = [...window.matchAll(/20\d{2}[-年/.]\d{1,2}[-月/.]\d{1,2}(?:[日\sT]+\d{1,2}:\d{2}(?::\d{2})?)?/gu)];
  if (!matches.length) return undefined;
  const localStart = start - windowStart;
  const localEnd = end - windowStart;
  return matches.sort((a, b) => distanceToRange(a.index ?? 0, localStart, localEnd) - distanceToRange(b.index ?? 0, localStart, localEnd))[0]?.[0];
}

function distanceToRange(position: number, start: number, end: number): number {
  if (position < start) return start - position;
  if (position > end) return position - end;
  return 0;
}

function cleanText(value: string): string {
  return value.replace(/<script\b[\s\S]*?<\/script>/giu, " ").replace(/<style\b[\s\S]*?<\/style>/giu, " ").replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;|&#160;/giu, " ").replace(/&amp;/giu, "&").replace(/&lt;/giu, "<").replace(/&gt;/giu, ">").replace(/&quot;/giu, '"').replace(/&#39;|&apos;/giu, "'").replace(/\s+/gu, " ").trim();
}

function decodeEntities(value: string): string {
  return value.replace(/&amp;/giu, "&").replace(/&quot;/giu, '"').replace(/&#39;|&apos;/giu, "'").replace(/&lt;/giu, "<").replace(/&gt;/giu, ">");
}

function hasEvidenceOverlap(output: string, evidence: string, minimum = 2): boolean {
  const normalizedOutput = output.normalize("NFKC").toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "");
  const normalizedEvidence = evidence.normalize("NFKC").toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "");
  if (normalizedOutput.length >= 6 && normalizedEvidence.includes(normalizedOutput)) return true;
  const tokens = [...new Set(evidence.match(/[\p{Script=Han}]{2,8}|[A-Za-z][A-Za-z0-9-]{2,}/gu) ?? [])]
    .filter((token) => !/公开|发布|资料|来源|内容|日报|美业|美容|门店|人工智能|智能体/iu.test(token));
  return tokens.filter((token) => output.includes(token)).length >= minimum;
}

function classifySourceIndustry(evidence: string, host: string): BeautyDailyBriefSourceIndustry {
  if (BEAUTY.test(evidence)) return "美业";
  if (/(?:cac|miit)\.gov\.cn$/u.test(host)) return "AI监管";
  if (/caict\.ac\.cn$/u.test(host)) return "AI研究";
  if (/零售|商超|电商|消费品牌/u.test(evidence)) return "零售";
  if (/本地生活|到店|服务业/u.test(evidence)) return "本地服务";
  if (/企业|组织|业务流程|生产制造|数字化转型/u.test(evidence)) return "企业数字化";
  if (/产业|芯片|算力|投融资/u.test(evidence)) return "AI产业";
  return "通用AI";
}
