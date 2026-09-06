import { BEAUTY_INDUSTRY_PRODUCT_CODE } from "./mcp-adapter.js";

export interface BeautyIndustryConfirmedFact {
  key: string;
  value: string;
  confirmed: boolean;
  source?: string;
}

export interface BeautyIndustryBriefInput {
  productCode: string;
  question: string;
  operatingEntityName?: string;
  industry?: string;
  confirmedFacts?: BeautyIndustryConfirmedFact[];
  brandKnowledge?: string[];
  requestedExternalActions?: string[];
}

export interface BeautyIndustryBrief {
  productCode: typeof BEAUTY_INDUSTRY_PRODUCT_CODE;
  question: string;
  operatingEntityLabel: string;
  confirmedFacts: Array<{ key: string; value: string; source?: string }>;
  pending: string[];
  complianceRisks: string[];
  executionBoundary: string;
}

const INTERNAL_LABEL = /(兰琪|蓝旗|验收\s*[abａｂABＡＢ]?\s*店|测试租户|tenant(?:key)?|synthetic)/i;
const MEDICAL_OR_EFFECT_CLAIM = /(治疗|治愈|根治|根除|消炎|杀菌|排毒|永久|100%|保证效果|一次见效|祛痘|祛斑|瘦脸)/i;
const UNCONFIRMED_COMMERCIAL_CLAIM = /(原价|折扣|优惠|销量|案例|顾客都说|好评第一|全市第一)/i;
const EXTERNAL_ACTION = /(发布|投流|付款|充值|发消息|开播)/i;
const OTHER_INDUSTRY = /(餐饮|菜品|外卖|汽修|宠物|儿童乐园|加盟招商)/i;

export function buildBeautyIndustryBrief(input: BeautyIndustryBriefInput): BeautyIndustryBrief {
  if (input.productCode !== BEAUTY_INDUSTRY_PRODUCT_CODE) throw new Error("beauty_product_context_required");
  const question = cleanText(input.question, 20_000);
  if (!question) throw new Error("beauty_question_required");
  if (input.brandKnowledge?.some((item) => cleanText(item, 500))) throw new Error("beauty_brand_knowledge_forbidden");
  const industry = cleanText(input.industry ?? "美业", 80);
  if (industry && !/(美业|生活美容|皮肤管理|SPA|美甲|美睫|美容院)/i.test(industry)) throw new Error("beauty_industry_context_mismatch");

  const facts = (input.confirmedFacts ?? [])
    .filter((fact) => fact.confirmed)
    .map((fact) => ({ key: cleanText(fact.key, 80), value: cleanText(fact.value, 500), source: cleanText(fact.source ?? "", 200) || undefined }))
    .filter((fact) => fact.key && fact.value && !INTERNAL_LABEL.test(fact.value));
  const factText = facts.map((fact) => `${fact.key}:${fact.value}`).join("\n");
  const pending: string[] = [];
  const risks: string[] = [];
  if (!facts.length) pending.push("当前经营主体的已确认服务、目标顾客和承接方式");
  if (MEDICAL_OR_EFFECT_CLAIM.test(question) && !/(功效依据|资质|备案|证据)/i.test(factText)) {
    risks.push("存在医疗或确定功效表达，需改为日常护理/舒缓护理等非医疗描述");
    pending.push("相关服务资质与可核验功效依据");
  }
  if (UNCONFIRMED_COMMERCIAL_CLAIM.test(question) && !/(价格|优惠|案例|评价|销量)/i.test(factText)) {
    risks.push("价格、优惠、案例或评价没有已确认依据，不能写入成品");
    pending.push("对应价格/优惠/案例的可公开依据与有效期");
  }
  if (OTHER_INDUSTRY.test(question)) risks.push("输入混入其他行业或招商内容，必须只保留美业到店获客目标");
  if (EXTERNAL_ACTION.test(question) || (input.requestedExternalActions ?? []).some((item) => EXTERNAL_ACTION.test(item))) {
    risks.push("外部动作只允许生成草稿或 PREVIEW_ONLY 计划，未经确认不执行");
  }
  const entity = cleanText(input.operatingEntityName ?? "", 120);
  const operatingEntityLabel = entity && !INTERNAL_LABEL.test(entity) ? entity : "当前经营主体";
  if (entity && operatingEntityLabel === "当前经营主体") pending.push("当前经营主体的正式对外名称");
  return {
    productCode: BEAUTY_INDUSTRY_PRODUCT_CODE,
    question,
    operatingEntityLabel,
    confirmedFacts: facts,
    pending: unique(pending),
    complianceRisks: unique(risks),
    executionBoundary: "仅生成获客草稿、诊断或 PREVIEW_ONLY 计划；不自动发布、投流、付款、充值或调用未确认的付费媒体。"
  };
}

function cleanText(value: string, maxLength: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
