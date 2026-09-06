import type { BeautyXhsDelivery } from "./xhs-delivery.js";

export const BEAUTY_CONTENT_DELIVERY_VERSION = "beauty-content-delivery-v1" as const;
export const BEAUTY_SALES_DELIVERY_VERSION = "beauty-sales-delivery-v1" as const;

export interface BeautyContentDelivery {
  version: typeof BEAUTY_CONTENT_DELIVERY_VERSION;
  preview: boolean;
  customerDeliverable: { copyMarkdown: string };
  productionNotes: { markdown: string };
  auditReceipt: { markdown: string };
}

export interface BeautySalesDelivery {
  version: typeof BEAUTY_SALES_DELIVERY_VERSION;
  resultType: "quick_response" | "professional_advice";
  preview: boolean;
  customerDeliverable: {
    copyMarkdown: string;
    primaryReply: string;
    rationale: string;
    likelyNextReply: string;
    nextQuestion: string;
  };
  productionNotes: { markdown: string };
  auditReceipt: { markdown: string };
}

export type BeautyStructuredDelivery = BeautyXhsDelivery | BeautyContentDelivery | BeautySalesDelivery;

export const BEAUTY_DELIVERY_PREVIEW_FLAG = "beauty_delivery_preview:yes";
export const BEAUTY_DELIVERY_FORMAL_FLAG = "beauty_delivery_preview:no";

export function beautyDeliveryModeQualityFlag(delivery: BeautyStructuredDelivery): string {
  return delivery.preview ? BEAUTY_DELIVERY_PREVIEW_FLAG : BEAUTY_DELIVERY_FORMAL_FLAG;
}

export function readBeautyDeliveryPreview(qualityFlags: unknown): boolean | undefined {
  if (!Array.isArray(qualityFlags)) return undefined;
  if (qualityFlags.includes(BEAUTY_DELIVERY_PREVIEW_FLAG)) return true;
  if (qualityFlags.includes(BEAUTY_DELIVERY_FORMAL_FLAG)) return false;
  return undefined;
}

const CONTENT_AUDIT_HEADING = "## 质量与合规检查";
const CUSTOMER_INTERNAL_TERMS = /(?:controlled\s*mock|受控流程|确定性模拟|任务事实回执|待补|待核验|核验|Schema|Eval|供应商|合同)/i;

export function parseBeautyContentDelivery(markdown: string, preview: boolean): BeautyContentDelivery {
  const auditIndex = markdown.indexOf(CONTENT_AUDIT_HEADING);
  if (auditIndex < 0) throw new Error("beauty_content_delivery_audit_missing");
  const customer = markdown.slice(0, auditIndex).trim();
  const audit = markdown.slice(auditIndex + CONTENT_AUDIT_HEADING.length).trim();
  if (!customer || !audit) throw new Error("beauty_content_delivery_layer_missing");
  if (CUSTOMER_INTERNAL_TERMS.test(customer)) throw new Error("beauty_content_customer_internal_pollution");

  const requiredHeadings = [
    "短结论", "一、选题", "二、口播逐字稿", "三、访谈话术", "四、拍摄脚本",
    "五、拍摄注意事项", "六、剪辑EDL", "七、发布标题与话题", "八、最佳发布时间",
    "九、评论区引导话术", "十、投流建议"
  ];
  if (!requiredHeadings.every((heading) => customer.includes(`## ${heading}`))) {
    throw new Error("beauty_content_delivery_sections_missing");
  }
  const productionNotes = ["四、拍摄脚本", "五、拍摄注意事项", "六、剪辑EDL"]
    .map((heading, index, headings) => readTopSection(customer, heading, headings[index + 1] ?? "七、发布标题与话题"))
    .filter(Boolean)
    .join("\n\n");
  if (!productionNotes) throw new Error("beauty_content_delivery_production_missing");
  return {
    version: BEAUTY_CONTENT_DELIVERY_VERSION,
    preview,
    customerDeliverable: { copyMarkdown: customer },
    productionNotes: { markdown: productionNotes },
    auditReceipt: { markdown: audit }
  };
}

export function tryParseBeautyContentDelivery(markdown: string, preview: boolean): BeautyContentDelivery | undefined {
  try { return parseBeautyContentDelivery(markdown, preview); } catch { return undefined; }
}

export function parseBeautySalesDelivery(
  markdown: string,
  preview: boolean,
  resultType: BeautySalesDelivery["resultType"]
): BeautySalesDelivery {
  const primaryReply = readTopSectionBody(markdown, "建议先这样回复", "为什么这样回");
  const rationale = readTopSectionBody(markdown, "为什么这样回", "顾客可能的下一句");
  const likelyNextReply = readTopSectionBody(markdown, "顾客可能的下一句", "你接下来问什么");
  const nextQuestion = readTopSectionBody(markdown, "你接下来问什么", "策略详情");
  const strategyDetails = readTopSection(markdown, "策略详情", "质量与合规检查");
  const auditReceipt = readTopSectionBody(markdown, "质量与合规检查", "");
  if (![primaryReply, rationale, likelyNextReply, nextQuestion, strategyDetails, auditReceipt].every(Boolean)) {
    throw new Error("beauty_sales_delivery_layer_missing");
  }
  if (CUSTOMER_INTERNAL_TERMS.test([primaryReply, rationale, likelyNextReply, nextQuestion].join("\n"))) {
    throw new Error("beauty_sales_customer_internal_pollution");
  }
  return {
    version: BEAUTY_SALES_DELIVERY_VERSION,
    resultType,
    preview,
    customerDeliverable: {
      copyMarkdown: primaryReply,
      primaryReply,
      rationale,
      likelyNextReply,
      nextQuestion
    },
    productionNotes: { markdown: strategyDetails },
    auditReceipt: { markdown: auditReceipt }
  };
}

export function tryParseBeautySalesDelivery(
  markdown: string,
  preview: boolean,
  resultType: BeautySalesDelivery["resultType"]
): BeautySalesDelivery | undefined {
  try { return parseBeautySalesDelivery(markdown, preview, resultType); } catch { return undefined; }
}

function readTopSection(markdown: string, start: string, end: string): string {
  const startMarker = `## ${start}`;
  const startIndex = markdown.indexOf(startMarker);
  if (startIndex < 0) return "";
  const endIndex = markdown.indexOf(`## ${end}`, startIndex + startMarker.length);
  return (endIndex < 0 ? markdown.slice(startIndex) : markdown.slice(startIndex, endIndex)).trim();
}

function readTopSectionBody(markdown: string, start: string, end: string): string {
  const section = readTopSection(markdown, start, end);
  return section.replace(new RegExp(`^##\\s+${escapeRegExp(start)}\\s*`), "").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
