// getnote 已同步结论的「应用层」读取：供选题策略官等下游消费。
//
// 设计要点（2026-09-27）：
// - 这里读的是「同步阶段已解析落库」的 metadata.analysis（0 次 LLM），不再 live 外拉 getnote。
// - 应用层只取「第二步三关筛选通过」的已确认文档：
//     confirmedAt != null 且 usagePolicy = "auto" 且 sensitivity != "sensitive"
//   （与数字员工自动加载、确认接口写入口径一致）。
// - 统计端点返回「全部已存」与「已确认可用于生成」两组，前端可按需展示。

import { Prisma, prisma } from "@baolu/db";

const GETNOTE_PROVIDER = "getnote";

export type GetNoteConclusionStats = {
  docs: number;
  coreViews: number;
  quotes: number;
  customerQuotes: number;
};

export type GetNoteEvidenceResult = {
  hasData: boolean;
  /** 注入 prompt 的私有知识底座文本；无已确认数据时为空串。 */
  text: string;
  stats: GetNoteConclusionStats;
};

/** 单条素材（来源标注到具体笔记）。 */
export type GetNoteMaterial = {
  id: string;
  type: "coreView" | "quote" | "customerQuote";
  text: string;
  source: string;
};

const TYPE_LABEL: Record<GetNoteMaterial["type"], string> = {
  coreView: "核心观点",
  quote: "金句",
  customerQuote: "客户原话"
};

export function materialTypeLabel(type: GetNoteMaterial["type"]): string {
  return TYPE_LABEL[type];
}

const ZERO: GetNoteConclusionStats = { docs: 0, coreViews: 0, quotes: 0, customerQuotes: 0 };

async function getGetNoteConnectionId(tenantId: string): Promise<string | null> {
  const conn = await prisma.knowledgeConnection.findUnique({
    where: { tenantId_provider_ownership: { tenantId, provider: GETNOTE_PROVIDER, ownership: "tenant" } },
    select: { id: true }
  });
  return conn?.id ?? null;
}

type DocMeta = {
  confirmedAt?: string | null;
  usagePolicy?: string | null;
  sensitivity?: string | null;
  metadata?: {
    analysis?: {
      coreViews?: string[];
      quotes?: string[];
      customerQuotes?: string[];
    } | null;
  } | null;
};

function sumAnalysis(docs: DocMeta[]): { stored: GetNoteConclusionStats; confirmed: GetNoteConclusionStats } {
  const stored: GetNoteConclusionStats = { ...ZERO };
  const confirmed: GetNoteConclusionStats = { ...ZERO };
  for (const d of docs) {
    const a = d.metadata?.analysis;
    if (!a) continue;
    const cv = Array.isArray(a.coreViews) ? a.coreViews.length : 0;
    const q = Array.isArray(a.quotes) ? a.quotes.length : 0;
    const cq = Array.isArray(a.customerQuotes) ? a.customerQuotes.length : 0;
    stored.docs += 1;
    stored.coreViews += cv;
    stored.quotes += q;
    stored.customerQuotes += cq;
    const isConfirmed = d.confirmedAt != null && d.usagePolicy === "auto" && d.sensitivity !== "sensitive";
    if (isConfirmed) {
      confirmed.docs += 1;
      confirmed.coreViews += cv;
      confirmed.quotes += q;
      confirmed.customerQuotes += cq;
    }
  }
  return { stored, confirmed };
}

/**
 * 统计某租户 getnote 连接下「全部已存结论」与「已确认可用于生成」的体量。
 * 前端用于把 1280/422/26 这类汇总数字作为结论展示给用户。
 */
/**
 * 展开该租户 getnote 连接下全部文档的 analysis 数组，作为「素材清单」供前端抽屉
 * 列出与勾选。每条带 type / text / source（来源笔记标题）。不读 confirmed 状态、
 * 不写库、0 次 LLM——仅把已同步落库的结论摊开给用户挑。
 */
export async function getGetNoteMaterials(tenantId: string): Promise<GetNoteMaterial[]> {
  const connectionId = await getGetNoteConnectionId(tenantId);
  if (!connectionId) return [];
  const docs = await prisma.knowledgeDocument.findMany({
    where: { connectionId },
    select: { id: true, title: true, metadata: true },
    orderBy: { occurredAt: "desc" }
  });
  const out: GetNoteMaterial[] = [];
  for (const d of docs) {
    const a = (d.metadata as DocMeta["metadata"])?.analysis;
    if (!a) continue;
    const push = (type: GetNoteMaterial["type"], arr?: unknown) => {
      if (!Array.isArray(arr)) return;
      (arr as unknown[]).forEach((raw, i) => {
        const text = typeof raw === "string" ? raw.trim() : "";
        if (!text) return;
        out.push({ id: `${d.id}:${type}:${i}`, type, text, source: d.title || "（无标题笔记）" });
      });
    };
    push("coreView", a.coreViews);
    push("quote", a.quotes);
    push("customerQuote", a.customerQuotes);
  }
  return out;
}

export async function getGetNoteConclusionStats(tenantId: string): Promise<{
  stored: GetNoteConclusionStats;
  confirmed: GetNoteConclusionStats;
}> {
  const connectionId = await getGetNoteConnectionId(tenantId);
  if (!connectionId) return { stored: { ...ZERO }, confirmed: { ...ZERO } };
  const docs = await prisma.knowledgeDocument.findMany({
    where: { connectionId },
    select: { confirmedAt: true, usagePolicy: true, sensitivity: true, metadata: true }
  });
  return sumAnalysis(docs as unknown as DocMeta[]);
}

function uniqAndCap(items: Array<string | null | undefined>, cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = typeof raw === "string" ? raw.trim() : "";
    if (!v || seen.has(v) || v.length > 80) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * 读取「第二步三关筛选通过」的已确认 getnote 结论，聚合并拼成可直接注入 prompt 的
 * 私有知识底座文本。不自行外拉 getnote、不调 LLM。
 *
 * @param subjectId 可选：仅取绑定到该主体的已确认文档；不传则取该租户全部已确认 getnote 文档。
 */
export async function getConfirmedGetNoteEvidence(
  tenantId: string,
  subjectId?: string
): Promise<GetNoteEvidenceResult> {
  const connectionId = await getGetNoteConnectionId(tenantId);
  if (!connectionId) return { hasData: false, text: "", stats: { ...ZERO } };

  const where: Prisma.KnowledgeDocumentWhereInput = {
    connectionId,
    confirmedAt: { not: null },
    usagePolicy: "auto",
    sensitivity: { not: "sensitive" }
  };
  if (subjectId) where.subjects = { some: { subjectId } };

  const docs = await prisma.knowledgeDocument.findMany({
    where,
    select: { title: true, metadata: true },
    orderBy: { occurredAt: "desc" },
    take: 60
  });

  const meta = docs
    .map((d) => (d.metadata as DocMeta["metadata"])?.analysis)
    .filter(Boolean) as Array<NonNullable<DocMeta["metadata"]>["analysis"]>;
  const stats: GetNoteConclusionStats = {
    docs: docs.length,
    coreViews: meta.reduce((n, a) => n + (a?.coreViews?.length ?? 0), 0),
    quotes: meta.reduce((n, a) => n + (a?.quotes?.length ?? 0), 0),
    customerQuotes: meta.reduce((n, a) => n + (a?.customerQuotes?.length ?? 0), 0)
  };

  if (docs.length === 0) return { hasData: false, text: "", stats };

  const coreViews = uniqAndCap(meta.flatMap((a) => a?.coreViews ?? []), 40);
  const quotes = uniqAndCap(meta.flatMap((a) => a?.quotes ?? []), 20);
  const customerQuotes = uniqAndCap(meta.flatMap((a) => a?.customerQuotes ?? []), 10);

  const blocks: string[] = [];
  blocks.push(
    "【私有知识库 · 客户已确认结论（得到大脑同步，第二步三关筛选通过）】\n" +
      `已确认 ${stats.docs} 篇笔记，沉淀：核心观点 ${stats.coreViews} 条 / 金句 ${stats.quotes} 条 / 客户原话 ${stats.customerQuotes} 条。` +
      "以下是可用于选题切角的代表性结论（已去重）："
  );
  if (coreViews.length) {
    blocks.push("· 核心观点（节选）：\n" + coreViews.map((t, i) => `${i + 1}. ${t}`).join("\n"));
  }
  if (quotes.length) {
    blocks.push("· 金句（节选）：\n" + quotes.map((t, i) => `${i + 1}. ${t}`).join("\n"));
  }
  if (customerQuotes.length) {
    blocks.push("· 客户原话（节选）：\n" + customerQuotes.map((t, i) => `${i + 1}. ${t}`).join("\n"));
  }

  const text = blocks.join("\n\n").slice(0, 4000);
  return { hasData: true, text, stats };
}
