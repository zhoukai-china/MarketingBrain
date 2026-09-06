import { createHash } from "node:crypto";

const GETNOTE_BASE_URL = "https://openapi.biji.com";

export interface GetNoteCredentials {
  apiKey: string;
  clientId: string;
}

export interface GetNoteDocument {
  externalId: string;
  title: string;
  content: string;
  documentType: "transcript" | "note" | "web_page";
  occurredAt?: Date;
  externalUpdatedAt?: Date;
  contentHash: string;
  metadata: Record<string, unknown>;
}

export interface GetNoteSyncResult {
  documents: GetNoteDocument[];
  nextCursor?: string;
  scanned: number;
  skipped: number;
  failed: number;
  importedByType: { transcripts: number; notes: number; webPages: number };
  unchanged: number;
  listRequests: number;
  detailRequests: number;
  retryCount: number;
  throttleMs: number;
  backoffMs: number;
}

export type GetNoteSyncStage = "listing" | "details" | "throttling" | "backoff" | "parsing";

export interface GetNoteSyncObservation {
  stage: GetNoteSyncStage;
  elapsedMs: number;
  scanned: number;
  processed: number;
  unchanged: number;
  failed: number;
  listRequests: number;
  detailRequests: number;
  retryCount: number;
  throttleMs: number;
  backoffMs: number;
}

export interface GetNotePullOptions {
  cursor?: string;
  maxPages?: number;
  knownDocuments?: ReadonlyMap<string, { externalUpdatedAt?: Date | null; contentHash?: string }>;
  onObservation?: (observation: GetNoteSyncObservation) => void | Promise<void>;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

export type GetNoteFailureKind = "authorization" | "rate_limit" | "temporary" | "unknown";

export function inferGetNoteDocumentType(input: {
  transcript?: string;
  noteType?: string;
  hasAudio?: boolean;
  noteContent?: string;
  webPageContent?: string;
}): GetNoteDocument["documentType"] {
  const recordingSample = `${input.noteContent ?? ""}\n${input.webPageContent ?? ""}`.slice(0, 2_500);
  const looksLikeRecording = Boolean(input.transcript)
    || /(?:recorder|record|audio|voice)/i.test(input.noteType ?? "")
    || Boolean(input.hasAudio)
    || /录音(?:信息|总结|转写|时间)|录制时间|音频时长|参与人数/.test(recordingSample);
  if (looksLikeRecording) return "transcript";
  return input.webPageContent ? "web_page" : "note";
}

/**
 * Keep connection health separate from a single synchronization attempt.
 * Only explicit authorization failures mean the saved credentials must be
 * replaced; rate limits and network/provider outages must remain retryable.
 */
export function classifyGetNoteFailure(reason: string): GetNoteFailureKind {
  if (/getnote_(?:api_)?10001|(?:getnote_)?http_(?:401|403)/i.test(reason)) return "authorization";
  if (/getnote_(?:api_)?(?:10202|42900)|(?:getnote_)?http_429/i.test(reason)) return "rate_limit";
  if (/AbortError|fetch failed|ECONNRESET|ETIMEDOUT|getnote_http_5\d\d|getnote_api_(?:30000|50000)/i.test(reason)) return "temporary";
  return "unknown";
}

export async function testGetNoteConnection(credentials: GetNoteCredentials): Promise<{ noteCount: number }> {
  const page = await getJson("/open/api/v1/resource/note/list", credentials);
  return { noteCount: extractItems(page).length };
}

export async function pullGetNoteTranscripts(
  credentials: GetNoteCredentials,
  options: GetNotePullOptions = {}
): Promise<GetNoteSyncResult> {
  const documents: GetNoteDocument[] = [];
  let cursor = options.cursor;
  let scanned = 0;
  let skipped = 0;
  let failed = 0;
  let unchanged = 0;
  let listRequests = 0;
  let detailRequests = 0;
  let retryCount = 0;
  let throttleMs = 0;
  let backoffMs = 0;
  const startedAt = (options.now ?? Date.now)();
  const sleep = options.sleep ?? delay;
  const observe = async (stage: GetNoteSyncStage): Promise<void> => {
    await options.onObservation?.({
      stage,
      elapsedMs: Math.max(0, (options.now ?? Date.now)() - startedAt),
      scanned,
      processed: documents.length + skipped + failed + unchanged,
      unchanged,
      failed,
      listRequests,
      detailRequests,
      retryCount,
      throttleMs,
      backoffMs
    });
  };
  const requestJson = async (path: string, kind: "list" | "detail"): Promise<unknown> => {
    if (kind === "list") listRequests += 1;
    else detailRequests += 1;
    return getJson(path, credentials, {
      fetchImpl: options.fetchImpl,
      sleep,
      onRetry: async (milliseconds) => {
        retryCount += 1;
        backoffMs += milliseconds;
        await observe("backoff");
      }
    });
  };
  const importedByType = { transcripts: 0, notes: 0, webPages: 0 };
  let firstDetailError: Error | undefined;
  const seenCursors = new Set<string>();
  const maxPages = Math.min(Math.max(options.maxPages ?? 5, 1), 10);

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    await observe("listing");
    const page = await requestJson(`/open/api/v1/resource/note/list${query}`, "list");
    const items = extractItems(page);
    if (items.length === 0) {
      cursor = undefined;
      break;
    }

    for (const item of items) {
      const externalId = readString(item, ["id", "note_id", "noteId", "resourceId"]);
      if (!externalId) {
        skipped += 1;
        continue;
      }
      scanned += 1;
      const listedUpdatedAt = readDate(item, ["updated_at", "updatedAt", "updateTime", "mtime"]);
      const known = options.knownDocuments?.get(externalId);
      if (known?.externalUpdatedAt && listedUpdatedAt && listedUpdatedAt.getTime() <= known.externalUpdatedAt.getTime()) {
        unchanged += 1;
        await observe("details");
        continue;
      }
      let detail: unknown;
      try {
        await observe("details");
        detail = await requestJson(`/open/api/v1/resource/note/detail?id=${encodeURIComponent(externalId)}`, "detail");
      } catch (error) {
        failed += 1;
        firstDetailError ??= error instanceof Error ? error : new Error("getnote_detail_failed");
        continue;
      }
      // GetNote applies QPS limits to read APIs. Keep detail reads paced even
      // when a note has no usable transcript.
      throttleMs += 350;
      await observe("throttling");
      await sleep(350);
      await observe("parsing");
      const note = asRecord(asRecord(detail).data)?.note ?? asRecord(detail).data ?? detail;
      const noteRecord = asRecord(note);
      const audio = asRecord(noteRecord.audio);
      const webPage = asRecord(noteRecord.web_page ?? noteRecord.webPage);
      const transcript = normalizeContent(audio.original);
      const webPageContent = normalizeContent(webPage.content);
      const noteContent = normalizeContent(noteRecord.content) || normalizeContent(item.content);
      const content = transcript || webPageContent || noteContent;
      if (!content) {
        skipped += 1;
        continue;
      }
      const noteType = readString(noteRecord, ["note_type", "noteType"]) || readString(item, ["note_type", "noteType"]);
      // GetNote's recorder card commonly stores the completed transcript in
      // note.content while audio.original is absent. The note_type field is
      // therefore authoritative for recorder cards; otherwise real recording
      // transcripts are incorrectly imported as ordinary notes and disappear
      // from the "录音转写" filter.
      const documentType = inferGetNoteDocumentType({
        transcript,
        noteType,
        hasAudio: Object.keys(audio).length > 0,
        noteContent,
        webPageContent
      });
      if (documentType === "transcript") importedByType.transcripts += 1;
      else if (documentType === "web_page") importedByType.webPages += 1;
      else importedByType.notes += 1;
      const title = readString(noteRecord, ["title", "name"]) || readString(item, ["title", "name"]) || `录音转写 ${externalId}`;
      const occurredAt = readDate(noteRecord, ["created_at", "createdAt", "createTime", "ctime"])
        ?? readDate(item, ["created_at", "createdAt", "createTime", "ctime"]);
      const externalUpdatedAt = readDate(noteRecord, ["updated_at", "updatedAt", "updateTime", "mtime"])
        ?? readDate(item, ["updated_at", "updatedAt", "updateTime", "mtime"]);
      documents.push({
        externalId,
        title,
        content,
        documentType,
        occurredAt,
        externalUpdatedAt,
        contentHash: createHash("sha256").update(content).digest("hex"),
        metadata: {
          provider: "getnote",
          sourceType: documentType,
          sourceField: transcript ? "audio.original" : webPageContent ? "web_page.content" : "content",
          noteType
        }
      });
    }

    const next = extractCursor(page);
    if (!extractHasMore(page)) {
      cursor = undefined;
      break;
    }
    if (!next || next === cursor || seenCursors.has(next)) {
      cursor = next;
      break;
    }
    seenCursors.add(next);
    cursor = next;
  }

  if (documents.length === 0 && failed > 0 && firstDetailError) throw firstDetailError;
  return { documents, nextCursor: cursor, scanned, skipped, failed, importedByType, unchanged, listRequests, detailRequests, retryCount, throttleMs, backoffMs };
}

async function getJson(
  path: string,
  credentials: GetNoteCredentials,
  options: { fetchImpl?: typeof fetch; sleep?: (milliseconds: number) => Promise<void>; onRetry?: (milliseconds: number) => void | Promise<void> } = {}
): Promise<unknown> {
  let lastError = new Error("getnote_request_failed");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await (options.fetchImpl ?? fetch)(`${GETNOTE_BASE_URL}${path}`, {
        signal: controller.signal,
        headers: {
          Authorization: credentials.apiKey,
          "X-Client-ID": credentials.clientId,
          Accept: "application/json"
        }
      });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      const code = body.code;
      const normalizedCode = code === undefined ? undefined : String(code);
      const retryable = response.status === 429
        || response.status >= 500
        || normalizedCode === "10202"
        || normalizedCode === "42900"
        || normalizedCode === "30000"
        || normalizedCode === "50000";
      if (!response.ok || (normalizedCode !== undefined && normalizedCode !== "0" && normalizedCode !== "200")) {
        lastError = new Error(!response.ok ? `getnote_http_${response.status}` : `getnote_api_${normalizedCode}`);
        if (retryable && attempt < 3) {
          const waitMs = 500 * (2 ** attempt);
          await options.onRetry?.(waitMs);
          await (options.sleep ?? delay)(waitMs);
          continue;
        }
        throw lastError;
      }
      return body;
    } catch (error) {
      lastError = error instanceof Error ? error : lastError;
      if ((lastError.name === "AbortError" || /fetch failed/i.test(lastError.message)) && attempt < 3) {
        const waitMs = 500 * (2 ** attempt);
        await options.onRetry?.(waitMs);
        await (options.sleep ?? delay)(waitMs);
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function extractItems(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const candidates = [data.list, data.notes, data.items, root.list, root.notes, root.items];
  const array = candidates.find(Array.isArray) as unknown[] | undefined;
  return (array ?? []).map(asRecord);
}

function extractCursor(payload: unknown): string | undefined {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  // GetNote currently returns next_cursor as a 19-digit JSON number and also
  // returns the same cursor as a string in data.cursor. Parsing the numeric
  // field first loses integer precision in JavaScript, causing page 2 to
  // repeat page 1. Prefer cursor strings and only fall back to numeric values.
  return readCursor(data)
    || readCursor(root)
    || undefined;
}

function readCursor(record: Record<string, unknown>): string {
  for (const key of ["nextCursor", "next_cursor", "cursor"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const safeNumeric = record.nextCursor ?? record.next_cursor ?? record.cursor;
  if (typeof safeNumeric === "number" && Number.isSafeInteger(safeNumeric)) return String(safeNumeric);
  return "";
}

function extractHasMore(payload: unknown): boolean {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const value = data.has_more ?? data.hasMore ?? root.has_more ?? root.hasMore;
  return value === true || value === 1 || value === "1" || value === "true";
}

function normalizeContent(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === "string") return item;
      return readString(asRecord(item), ["text", "content", "sentence"]);
    }).filter(Boolean).join("\n").trim();
  }
  const record = asRecord(value);
  return readString(record, ["text", "content", "transcript"]).trim();
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function readString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function readDate(record: Record<string, unknown>, keys: string[]): Date | undefined {
  const raw = readString(record, keys);
  if (!raw) return undefined;
  const numeric = Number(raw);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
