// 正式版：得到大脑「智能总结」同步。
//
// 关键变化：note/list 返回的 content 就是完整智能总结（实测是 note/detail 的 100.6%，
// 且含金句精选 / 章节概要 / 录音总结），因此**不再逐条调用 note/detail**。
// 请求数从「每篇一次」降到「每页一次」（193 → 10），限流问题随之消失，且拿到的
// 结构化成果（金句 / 观点 / 章节）不再需要 LLM 二次提取。
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import type { GetNoteCredentials, GetNoteDocument } from "./getnote-connector.js";
import { clusterNotes, parseGetNoteSummary, type ParsedNote } from "./getnote-summary-parser.js";

const GETNOTE_BASE_URL = "https://openapi.biji.com";
const LOG_PATH = "/tmp/getnote-summary-sync.log";

function logLine(message: string): void {
  try {
    appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // 日志失败不能影响同步
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 模块被加载时立刻落一行：用于判断「后端是否真的用新代码重启了」。
// 只要服务启动时加载了这个文件，日志就会出现，不需要先跑一次同步。
logLine("MODULE_LOADED getnote-summary-sync（正式版：只翻 note/list，不再逐条 note/detail）");

// 19 位 id 超过 JS 安全整数，解析前先转字符串，否则精度丢失会拿到空响应。
function safeParse(raw: string): Record<string, unknown> {
  const guarded = raw.replace(/"(id|note_id|noteId|resourceId|next_cursor|cursor)"\s*:\s*(-?\d{16,})/g, '"$1":"$2"');
  return JSON.parse(guarded) as Record<string, unknown>;
}

function toDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = new Date(value.trim().replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function inferDocumentType(noteType: string): GetNoteDocument["documentType"] {
  if (/audio|recorder/i.test(noteType)) return "transcript";
  if (/link|web/i.test(noteType)) return "web_page";
  return "note";
}

export interface SummarySyncStats {
  documents: GetNoteDocument[];
  nextCursor?: string;
  scanned: number;
  skipped: number;
  failed: number;
  unchanged: number;
  importedByType: { transcripts: number; notes: number; webPages: number };
  listRequests: number;
  detailRequests: number;
  retryCount: number;
  throttleMs: number;
  backoffMs: number;
  // 扩展统计：用于评估这批内容对选题的实际价值
  valid: number;
  emptySkipped: number;
  quotes: number;
  views: number;
  chapters: number;
  clusterCount: number;
  tagStats: Record<string, number>;
}

export async function syncGetNoteSummaries(options: {
  credentials: GetNoteCredentials;
  windowDays?: number;
  maxPages?: number;
  now?: () => number;
}): Promise<SummarySyncStats> {
  const windowDays = options.windowDays ?? 30;
  const maxPages = Math.min(Math.max(options.maxPages ?? 10, 1), 20);
  const since = (options.now ?? Date.now)() - windowDays * 24 * 3600 * 1000;

  const documents: GetNoteDocument[] = [];
  const importedByType = { transcripts: 0, notes: 0, webPages: 0 };
  const tagStats: Record<string, number> = {};
  const parsedAll: Array<{ noteIndex: number; noteTitle: string; parsed: ParsedNote }> = [];
  let scanned = 0;
  let skipped = 0;
  let failed = 0;
  let emptySkipped = 0;
  let quotes = 0;
  let views = 0;
  let chapters = 0;
  let listRequests = 0;
  let retryCount = 0;
  let backoffMs = 0;
  let throttleMs = 0;
  let nextCursor: string | undefined;
  const startedAt = Date.now();

  logLine(`SYNC_START windowDays=${windowDays} maxPages=${maxPages}`);

  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const path = `/open/api/v1/resource/note/list${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
    let body: Record<string, unknown> | null = null;

    for (let attempt = 0; attempt < 3 && !body; attempt += 1) {
      listRequests += 1;
      const response = await fetch(`${GETNOTE_BASE_URL}${path}`, {
        headers: {
          Authorization: options.credentials.apiKey,
          "X-Client-ID": options.credentials.clientId,
          Accept: "application/json"
        }
      });
      const raw = await response.text();
      if (!response.ok) {
        const retryAfterMs = Number(response.headers.get("retry-after")) * 1000 || 0;
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          const waitMs = Math.max(retryAfterMs, 2000 * 2 ** attempt);
          retryCount += 1;
          backoffMs += waitMs;
          logLine(`LIST_RETRY page=${page} status=${response.status} waitMs=${waitMs}`);
          await sleep(waitMs);
          continue;
        }
        failed += 1;
        logLine(`LIST_FAIL page=${page} status=${response.status}`);
        break;
      }
      try {
        body = safeParse(raw);
      } catch {
        logLine(`LIST_PARSE_FAIL page=${page} head=${JSON.stringify(raw.slice(0, 200))}`);
        body = null;
      }
    }

    if (!body) break;
    const data = (body.data ?? {}) as Record<string, unknown>;
    const items = (Array.isArray(data.notes) ? data.notes : []) as Array<Record<string, unknown>>;
    logLine(`LIST_OK page=${page} items=${items.length} has_more=${String(data.has_more)}`);
    if (items.length === 0) break;

    let outOfWindow = 0;
    for (const item of items) {
      const externalId = String(item.id ?? item.note_id ?? "");
      if (!externalId) {
        skipped += 1;
        continue;
      }
      const occurredAt = toDate(item.created_at);
      // 列表按创建时间倒序；整页都越界即已越过窗口，停止翻页。
      if (occurredAt && occurredAt.getTime() < since) {
        skipped += 1;
        outOfWindow += 1;
        continue;
      }
      scanned += 1;

      const title = typeof item.title === "string" && item.title.trim() ? item.title.trim() : `笔记 ${externalId}`;
      const content = typeof item.content === "string" ? item.content : "";
      const noteType = typeof item.note_type === "string" ? item.note_type : "";
      const tags = Array.isArray(item.tags)
        ? (item.tags as Array<Record<string, unknown>>)
            .filter((tag) => String(tag?.type ?? "") !== "system" && typeof tag?.name === "string" && String(tag.name).trim())
            .map((tag) => String(tag.name).trim())
        : [];

      const parsed = parseGetNoteSummary(content);
      // 空判定与 note_type 无关：本质是「解析产物是否为空」。
      const hasRealContent =
        parsed.quotes.length > 0 ||
        parsed.coreViews.some((view) => !/占位|无实际|空录音|测试/.test(`${view.topic ?? ""}${view.text}`));
      const isEmpty =
        content.length < 400 ||
        /空白语音转记|空录音/.test(title) ||
        /时长\**[:：]\**\s*0\s*秒/.test(content) ||
        /无实际语音转写|没有生成任何有效语音/.test(content) ||
        !hasRealContent;

      if (isEmpty) {
        emptySkipped += 1;
        skipped += 1;
        logLine(`NOTE_EMPTY id=${externalId} title=${JSON.stringify(title)} chars=${content.length}`);
        continue;
      }

      quotes += parsed.quotes.length;
      views += parsed.coreViews.length;
      chapters += parsed.chapters.length;
      for (const tag of tags) tagStats[tag] = (tagStats[tag] ?? 0) + 1;
      parsedAll.push({ noteIndex: documents.length, noteTitle: title, parsed });

      const documentType = inferDocumentType(noteType);
      if (documentType === "transcript") importedByType.transcripts += 1;
      else if (documentType === "web_page") importedByType.webPages += 1;
      else importedByType.notes += 1;

      const contentHash = createHash("sha256").update(content).digest("hex");
      documents.push({
        externalId,
        title,
        content,
        documentType,
        ...(occurredAt ? { occurredAt } : {}),
        externalUpdatedAt: toDate(item.updated_at) ?? occurredAt,
        contentHash,
        metadata: {
          provider: "getnote",
          sourceType: "note",
          sourceField: "note.content",
          noteType,
          tags,
          llmCalls: 0,
          analysis: {
            coreViews: parsed.coreViews.map((view) => view.text).slice(0, 20),
            quotes: parsed.quotes.map((quote) => quote.text).slice(0, 20),
            customerQuotes: [],
            analyzedAt: new Date().toISOString(),
            contentHash,
            source: "getnote_summary_parser"
          }
        }
      });

      logLine(
        `NOTE_OK id=${externalId} title=${JSON.stringify(title)} type=${noteType} chars=${content.length} ` +
        `quotes=${parsed.quotes.length} views=${parsed.coreViews.length} chapters=${parsed.chapters.length} tags=${JSON.stringify(tags)}`
      );
    }

    if (outOfWindow === items.length) {
      logLine(`WINDOW_EXHAUSTED page=${page}（整页越界，停止翻页）`);
      break;
    }
    const rawCursor = data.next_cursor;
    if (typeof rawCursor === "string" && rawCursor) nextCursor = rawCursor;
    if (!data.has_more) break;
    cursor = nextCursor;
    if (!cursor) break;

    // 分页之间固定节奏，避免短窗口限流
    throttleMs += 700;
    await sleep(700);
  }

  const clusters = clusterNotes(parsedAll);
  const stats: SummarySyncStats = {
    documents,
    ...(nextCursor ? { nextCursor } : {}),
    scanned,
    skipped,
    failed,
    // 变更判定交给入库时的 contentHash 比对，拉取阶段不做增量裁剪
    unchanged: 0,
    importedByType,
    listRequests,
    detailRequests: 0,
    retryCount,
    throttleMs,
    backoffMs,
    valid: documents.length,
    emptySkipped,
    quotes,
    views,
    chapters,
    clusterCount: clusters.length,
    tagStats
  };

  logLine(
    `SYNC_DONE scanned=${scanned} valid=${documents.length} emptySkipped=${emptySkipped} failed=${failed} ` +
    `quotes=${quotes} views=${views} chapters=${chapters} clusters=${clusters.length} ` +
    `listRequests=${listRequests} retryCount=${retryCount} ms=${Date.now() - startedAt}`
  );
  logLine(`SYNC_TAGS ${JSON.stringify(tagStats)}`);
  logLine(
    `SYNC_CLUSTERS ${JSON.stringify(
      clusters.slice().sort((a, b) => b.size - a.size).slice(0, 15).map((c) => ({ label: c.label, size: c.size }))
    )}`
  );
  return stats;
}
