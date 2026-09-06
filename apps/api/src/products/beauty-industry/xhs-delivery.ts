export const BEAUTY_XHS_DELIVERY_VERSION = "beauty-xhs-delivery-v2" as const;

export interface BeautyXhsDelivery {
  version: typeof BEAUTY_XHS_DELIVERY_VERSION;
  preview: boolean;
  customerDeliverable: {
    titles: string[];
    body: string;
    tags: string[];
    engagement: string;
    copyMarkdown: string;
  };
  productionNotes: {
    markdown: string;
  };
  auditReceipt: {
    markdown: string;
  };
}

const CUSTOMER_INTERNAL_TERMS = /(?:受控流程|controlled\s*mock|确定性模拟|任务事实回执|事实与合规待补|待补|待核验|核验|供应商|Schema|Eval|提示词|视觉参数|合同)/i;

export function parseBeautyXhsDelivery(markdown: string, preview: boolean): BeautyXhsDelivery {
  const customer = readTopSection(markdown, "客户可复制成品", "门店制作说明");
  const production = readTopSection(markdown, "门店制作说明", "质量与合规检查");
  const audit = readTopSection(markdown, "质量与合规检查");
  if (!customer || !production || !audit) throw new Error("beauty_xhs_delivery_layer_missing");
  if (CUSTOMER_INTERNAL_TERMS.test(customer)) throw new Error("beauty_xhs_customer_internal_pollution");

  const titleBlock = readSection(customer, "标题候选", "正文");
  const titles = titleBlock.split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*]\s*)?(?:[1-3一二三])[.、:：)）]\s*/, "").trim()).filter(Boolean);
  const body = readSection(customer, "正文", "话题标签").trim();
  const tagBlock = readSection(customer, "话题标签", "互动与承接");
  const tags = [...new Set(tagBlock.match(/#[^\s#，,；;]+/g) ?? [])];
  const engagement = readSection(customer, "互动与承接").trim();
  if (titles.length !== 3) throw new Error("beauty_xhs_customer_title_count");
  if (!body) throw new Error("beauty_xhs_customer_body_missing");
  if (tags.length < 5 || tags.length > 8) throw new Error("beauty_xhs_customer_tag_count");
  if (!engagement) throw new Error("beauty_xhs_customer_engagement_missing");
  const copyMarkdown = [
    "标题候选",
    ...titles.map((title, index) => `${index + 1}. ${title}`),
    "",
    "正文",
    body,
    "",
    "话题标签",
    tags.join(" "),
    "",
    "互动与承接",
    engagement
  ].join("\n");
  if (CUSTOMER_INTERNAL_TERMS.test(copyMarkdown) || /\|---|\|\s*#/i.test(copyMarkdown)) {
    throw new Error("beauty_xhs_customer_copy_pollution");
  }
  return {
    version: BEAUTY_XHS_DELIVERY_VERSION,
    preview,
    customerDeliverable: { titles, body, tags, engagement, copyMarkdown },
    productionNotes: { markdown: production },
    auditReceipt: { markdown: audit }
  };
}

export function tryParseBeautyXhsDelivery(markdown: string, preview: boolean): BeautyXhsDelivery | undefined {
  try { return parseBeautyXhsDelivery(markdown, preview); } catch { return undefined; }
}

function readTopSection(markdown: string, start: string, end?: string): string {
  const startPattern = new RegExp(`(?:^|\\n)##\\s+${escapeRegExp(start)}\\s*\\n`);
  const match = startPattern.exec(markdown);
  if (!match) return "";
  const from = match.index + match[0].length;
  if (!end) return markdown.slice(from).trim();
  const endPattern = new RegExp(`(?:^|\\n)##\\s+${escapeRegExp(end)}\\s*(?:\\n|$)`);
  const tail = markdown.slice(from);
  const endMatch = endPattern.exec(tail);
  return (endMatch ? tail.slice(0, endMatch.index) : tail).trim();
}

function readSection(markdown: string, start: string, end?: string): string {
  const startPattern = new RegExp(`(?:^|\\n)###\\s+${escapeRegExp(start)}\\s*\\n`);
  const match = startPattern.exec(markdown);
  if (!match) return "";
  const from = match.index + match[0].length;
  if (!end) return markdown.slice(from).trim();
  const endPattern = new RegExp(`(?:^|\\n)###\\s+${escapeRegExp(end)}\\s*(?:\\n|$)`);
  const tail = markdown.slice(from);
  const endMatch = endPattern.exec(tail);
  return (endMatch ? tail.slice(0, endMatch.index) : tail).trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
