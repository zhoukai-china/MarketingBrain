export type BeautyXhsTaskFactKey =
  | "time_context"
  | "service_project"
  | "audience_geography"
  | "target_audience"
  | "platform"
  | "deliverable";

export interface BeautyXhsTaskFact {
  key: BeautyXhsTaskFactKey;
  value: string;
}

export interface BeautyXhsTaskFactIssue {
  kind: "missing" | "contradiction";
  key: BeautyXhsTaskFactKey;
}

const TIME_CONTEXTS = [
  "春季", "春天", "春日", "夏季", "夏天", "盛夏", "秋季", "秋天", "秋日", "冬季", "冬天", "寒冬",
  "换季", "节前", "节后", "周末", "工作日", "开学季", "毕业季"
] as const;

export function extractBeautyXhsTaskFacts(input: {
  question: string;
  project?: string;
  audience?: string;
  platform?: string;
}): BeautyXhsTaskFact[] {
  const question = sanitizeFactValue(input.question, 500);
  const timeMatch = TIME_CONTEXTS.find((term) => question.includes(term));
  const timeContext = canonicalTimeContext(timeMatch);
  const project = sanitizeFactValue(input.project, 120) || extractProject(question, timeMatch);
  const rawAudience = sanitizeFactValue(input.audience, 160) || extractAudience(question);
  const geography = extractAudienceGeography(rawAudience || question);
  const targetAudience = sanitizeFactValue(
    stripAudienceGeography(rawAudience, geography)
      .replace(/^的|的$/g, "")
      .trim(),
    100
  );
  const platform = /小红书/i.test(input.platform ?? question) ? "小红书" : "小红书";
  const deliverable = /图文|图片.{0,3}文字|文字.{0,3}图片/.test(question) ? "图文" : "图文";

  return [
    timeContext ? { key: "time_context" as const, value: timeContext } : undefined,
    project ? { key: "service_project" as const, value: project } : undefined,
    geography ? { key: "audience_geography" as const, value: geography } : undefined,
    targetAudience ? { key: "target_audience" as const, value: targetAudience } : undefined,
    { key: "platform" as const, value: platform },
    { key: "deliverable" as const, value: deliverable }
  ].filter((item): item is BeautyXhsTaskFact => Boolean(item?.value));
}

export function buildBeautyXhsTaskFactDirective(input: {
  question: string;
  project?: string;
  audience?: string;
  platform?: string;
}): string {
  const facts = extractBeautyXhsTaskFacts(input);
  return [
    "【本次任务事实清单｜服务端锁定】",
    "这些值来自本轮请求或固定的小红书图文能力，不是示例。最终交付必须保留其含义；可以合理改写，但不得遗漏、矛盾或用其他项目/人群替换。",
    ...facts.map((fact) => `- [XHS_TASK_FACT:${fact.key}] ${fact.value}`),
    "【任务事实回执要求】",
    "最终答案必须先用“任务事实回执”逐项确认季节/时点、服务项目、地理范围、目标顾客、平台与交付；标题、正文、标签和相关配图方向也必须围绕同一组事实。"
  ].join("\n");
}

export function inspectBeautyXhsTaskFactIssues(answer: string, source: string): BeautyXhsTaskFactIssue[] {
  const facts = Array.from(source.matchAll(/\[XHS_TASK_FACT:([a-z_]+)]\s*([^\n]{1,160})/g)).flatMap((match) => {
    const key = match[1] as BeautyXhsTaskFactKey;
    const value = match[2]?.trim() ?? "";
    return isBeautyXhsTaskFactKey(key) && value ? [{ key, value }] : [];
  });
  const receipt = answer.match(/(?:^|\n)#{0,3}\s*任务事实回执\s*\n([\s\S]*?)(?=\n#{1,3}\s|$)/)?.[1]?.trim() ?? "";
  if (!receipt) return facts.map((fact) => ({ kind: "missing", key: fact.key }));
  return facts.flatMap((fact) => {
    const line = receiptLine(receipt, fact.key);
    if (line && factMatches(line, fact)) return [];
    return [{ kind: line && explicitlyContradicts(line, fact) ? "contradiction" as const : "missing" as const, key: fact.key }];
  });
}

const TIME_ALIASES = [["春季", "春天", "春日"], ["夏季", "夏天", "盛夏"], ["秋季", "秋天", "秋日"], ["冬季", "冬天", "寒冬"]] as const;
const GEOGRAPHY_ALIASES = [["附近", "周边", "门店周边", "社区周边"], ["本地", "同城", "本市", "本区"]] as const;

function isBeautyXhsTaskFactKey(value: string): value is BeautyXhsTaskFactKey {
  return ["time_context", "service_project", "audience_geography", "target_audience", "platform", "deliverable"].includes(value);
}

function receiptLine(receipt: string, key: BeautyXhsTaskFactKey): string {
  const labels: Record<BeautyXhsTaskFactKey, RegExp> = {
    time_context: /^(?:[-*]\s*)?(?:季节|时点|季节\/时点|时间语境)[：:]\s*(.+)$/m,
    service_project: /^(?:[-*]\s*)?(?:服务项目|本次项目|项目)[：:]\s*(.+)$/m,
    audience_geography: /^(?:[-*]\s*)?(?:地理范围|地域|范围)[：:]\s*(.+)$/m,
    target_audience: /^(?:[-*]\s*)?(?:目标顾客|目标人群|受众)[：:]\s*(.+)$/m,
    platform: /^(?:[-*]\s*)?(?:平台)[：:]\s*(.+)$/m,
    deliverable: /^(?:[-*]\s*)?(?:交付|交付形式|内容形式)[：:]\s*(.+)$/m
  };
  return receipt.match(labels[key])?.[1]?.trim() ?? "";
}

function factMatches(source: string, fact: BeautyXhsTaskFact): boolean {
  const compact = normalizeFactText(source);
  const expected = normalizeFactText(fact.value);
  if (fact.key === "time_context") return aliasGroup(expected, TIME_ALIASES).some((alias) => compact.includes(alias));
  if (fact.key === "audience_geography") return aliasGroup(expected, GEOGRAPHY_ALIASES).some((alias) => compact.includes(alias));
  if (fact.key === "target_audience") {
    const expectedAgeRange = ageRange(fact.value);
    return (!FEMALE_AUDIENCE.test(expected) || FEMALE_AUDIENCE.test(compact))
      && (!/顾客|客户|客群|用户|人群/.test(expected) || /顾客|客户|客群|用户|人群/.test(compact))
      && (!expectedAgeRange || ageRange(source) === expectedAgeRange);
  }
  if (fact.key === "service_project") {
    const core = normalizeProject(expected);
    return core.length >= 2 ? normalizeProject(compact).includes(core) : compact.includes(expected);
  }
  if (fact.key === "platform") return /小红书/.test(compact);
  if (fact.key === "deliverable") return /图文|图片(?:与|和|加)文字|文字(?:与|和|加)图片/.test(compact);
  return compact.includes(expected);
}

function explicitlyContradicts(source: string, fact: BeautyXhsTaskFact): boolean {
  const compact = normalizeFactText(source);
  if (fact.key === "time_context") {
    const expected = aliasGroup(normalizeFactText(fact.value), TIME_ALIASES);
    return TIME_ALIASES.some((group) => group.some((alias) => compact.includes(alias)) && !group.some((alias) => expected.includes(alias)));
  }
  if (fact.key === "audience_geography" && /异地|外地|远途|全国/.test(compact)) return true;
  if (fact.key === "target_audience") {
    if (FEMALE_AUDIENCE.test(fact.value) && MALE_AUDIENCE.test(compact) && !FEMALE_AUDIENCE.test(compact)) return true;
    const expectedAgeRange = ageRange(fact.value);
    const actualAgeRange = ageRange(source);
    if (expectedAgeRange && actualAgeRange && expectedAgeRange !== actualAgeRange) return true;
  }
  if (fact.key === "platform" && /抖音|视频号|公众号|朋友圈/.test(compact) && !/小红书/.test(compact)) return true;
  if (fact.key === "deliverable" && /视频|直播|音频/.test(compact) && !/图文|图片|文字/.test(compact)) return true;
  if (fact.key === "service_project" && /治疗|手术|注射/.test(compact) && !/治疗|手术|注射/.test(fact.value)) return true;
  return false;
}

const FEMALE_AUDIENCE = /女性|女士|女生|女顾客|女客户|女客群|女用户|女性用户|女性人群/;
const MALE_AUDIENCE = /男性|男士|男生|男顾客|男客户|男客群|男用户|男性用户|男性人群/;

function ageRange(value: string): string | undefined {
  const normalized = value.replace(/[—–－~～至到]/g, "-").replace(/\s+/g, "");
  const match = normalized.match(/(?:^|\D)(\d{1,2})-(\d{1,2})(?:岁|周岁)?(?:\D|$)/);
  if (!match) return undefined;
  const lower = Number(match[1]);
  const upper = Number(match[2]);
  if (!Number.isInteger(lower) || !Number.isInteger(upper) || lower > upper) return undefined;
  return `${lower}-${upper}`;
}

function aliasGroup(value: string, groups: readonly (readonly string[])[]): string[] {
  return [...(groups.find((group) => group.some((alias) => value.includes(alias))) ?? [value])];
}

function normalizeFactText(value: string): string {
  return value.toLowerCase().replace(/[\s，。；;：:、“”‘’（）()[\]【】{}<>《》|/\\_-]+/g, "");
}

function normalizeProject(value: string): string {
  return normalizeFactText(value).replace(/日常/g, "基础").replace(/保湿/g, "补水").replace(/基础|护理|项目|服务|疗程/g, "");
}

function extractProject(question: string, timeMatch: string | undefined): string {
  const candidates = [
    question.match(/^(?:请|请帮我|帮我)?(?:为)?(.{2,100}?)(?=(?:做|生成|制作|创作|写)(?:一|1)?(?:套|篇|份|个)?(?:面向|给|用于|的)?(?:附近|周边|本地|同城|小红书|图文))/)?.[1],
    question.match(/(?:本次项目|服务项目|项目)[：:]\s*([^，。；;\n]{2,80})/)?.[1],
    question.match(/(?:生成|制作|创作|写)([^，。；;\n]{2,80}?)(?=(?:的)?(?:小红书|图文))/)?.[1]
  ];
  for (const candidate of candidates) {
    let value = sanitizeFactValue(candidate, 120);
    if (!value) continue;
    if (timeMatch) value = value.replace(timeMatch, "").trim();
    value = value.replace(/^(?:一套|一篇|一份|关于)/, "").replace(/(?:的小红书|的图文)$/, "").trim();
    if (value.length >= 2) return value;
  }
  return "";
}

function extractAudience(question: string): string {
  const match = question.match(/(?:面向|给)([^，。；;\n]{2,80}?)(?=(?:的)?(?:小红书|公众号|抖音|视频号|图文|内容|生成|制作|创作|$))/);
  return sanitizeFactValue(match?.[1], 160).replace(/^的|的$/g, "").trim();
}

function extractAudienceGeography(source: string): string {
  const match = source.match(/社区周边|门店周边|附近|周边|本地|同城|本市|本区/);
  if (!match) return "";
  return /周边/.test(match[0]) ? "附近" : /本地|同城|本市|本区/.test(match[0]) ? "本地" : match[0];
}

function stripAudienceGeography(source: string, canonical: string): string {
  if (!canonical) return source;
  const aliases = canonical === "附近"
    ? ["社区周边", "门店周边", "附近", "周边"]
    : ["本地", "同城", "本市", "本区"];
  return source.replace(new RegExp(aliases.map(escapeRegExp).join("|")), "");
}

function canonicalTimeContext(value: string | undefined): string {
  if (!value) return "";
  if (/春/.test(value)) return "春季";
  if (/夏/.test(value)) return "夏季";
  if (/秋/.test(value)) return "秋季";
  if (/冬/.test(value)) return "冬季";
  return value;
}

function sanitizeFactValue(value: unknown, max: number): string {
  return typeof value === "string"
    ? value.replace(/[\r\n\t]+/g, " ").replace(/[\[\]{}<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
