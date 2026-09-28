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
  /** 仅同步该窗口内的笔记（天）。不传则同步全部。业务规则：私有知识库同步时间范围 30 天。 */
  windowDays?: number;
  knownDocuments?: ReadonlyMap<string, { externalUpdatedAt?: Date | null; contentHash?: string }>;
  onObservation?: (observation: GetNoteSyncObservation) => void | Promise<void>;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  /** 预检模式：只取列表层的 ID/时间做差集，不逐条拉详情内容，避免进页面全量重拉导致长时间 pending。 */
  metadataOnly?: boolean;
}

export type GetNoteFailureKind = "authorization" | "rate_limit" | "temporary" | "membership" | "unknown";

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
  if (/not_member|getnote_(?:api_)?10201/i.test(reason)) return "membership";
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
  // 连续被限流的计数与整批中止标志：对面进入限流窗口后继续硬锤只会全部失败、并进一步放大限流。
  let consecutiveRateLimited = 0;
  let rateLimitAbort = false;
  // 独立计数：请求成功但正文为空的笔记（与 skipped 里的「无 id / 越窗口」区分，
  // 便于一眼判断「某批没进来」到底是请求失败还是本来就没内容）。
  let emptyContent = 0;
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
        // 重试是内部细节：只累计 retryCount/backoffMs 用于服务端诊断，绝不切换用户可见 stage
        // （避免界面出现「退避 / 重试 / 限流」字样；真实失败原因只打服务端日志）。
      }
    });
  };
  const importedByType = { transcripts: 0, notes: 0, webPages: 0 };
  let firstDetailError: Error | undefined;
  const seenCursors = new Set<string>();
  const maxPages = Math.min(Math.max(options.maxPages ?? 5, 1), 10);
  const windowDays = options.windowDays;
  const sinceMs = windowDays && windowDays > 0 ? (options.now ?? Date.now)() - windowDays * 24 * 3600 * 1000 : undefined;
  // 翻页提前停止：note/list 按创建时间倒序（新在前）时，整页越界，或本页越界项连续落在尾部，即已越过 30 天边界，可停。
  // 若某页同时含窗口内外且越界项非连续尾部（顺序不可信），继续翻页，避免漏掉窗口内笔记。
  let windowExhausted = false;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    if (rateLimitAbort) break;
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    await observe("listing");
    const page = await requestJson(`/open/api/v1/resource/note/list${query}`, "list");
    const items = extractItems(page);
    if (items.length === 0) {
      cursor = undefined;
      break;
    }

    let pageInWindow = 0;
    let pageOutOfWindow = 0;
    let trailingOutOfWindow = 0;
    for (const item of items) {
      if (rateLimitAbort) break;
      const externalId = readString(item, ["id", "note_id", "noteId", "resourceId"]);
      if (!externalId) {
        skipped += 1;
        continue;
      }
      scanned += 1;
      const listedCreatedAt = readDate(item, ["created_at", "createdAt", "createTime", "ctime"]);
      const listedUpdatedAt = readDate(item, ["updated_at", "updatedAt", "updateTime", "mtime"]);
      // 窗口依据：创建时间。note/list 按创建时间排序，只关注近 30 天创建的笔记。
      if (sinceMs !== undefined && listedCreatedAt && listedCreatedAt.getTime() < sinceMs) {
        skipped += 1;
        pageOutOfWindow += 1;
        trailingOutOfWindow += 1;
        continue;
      }
      pageInWindow += 1;
      trailingOutOfWindow = 0;
      // 预检模式：只取列表层 ID/时间做差集，跳过逐条详情拉取（否则进页面会全量重拉、长时间 pending）。
      if (options.metadataOnly) {
        documents.push({
          externalId,
          title: readString(item, ["title", "name"]) ?? `笔记 ${externalId}`,
          content: "",
          documentType: "note",
          occurredAt: listedCreatedAt,
          externalUpdatedAt: listedUpdatedAt ?? listedCreatedAt,
          contentHash: "",
          metadata: { provider: "getnote", sourceType: "note", sourceField: "", noteType: undefined }
        });
        await observe("details");
        continue;
      }
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
        const detailError = error instanceof Error ? error : new Error("getnote_detail_failed");
        firstDetailError ??= detailError;
        // 逐条失败留证：记录是哪条笔记、失败到第几条、失败归类（限流/临时/授权）。
        // 否则整批失败后只剩一个总数，事后无法还原当时对面返回了什么。
        console.error(
          `[getnote-connector] 单条详情失败 externalId=${externalId} 失败计数=${failed} 已扫描=${scanned} ` +
          `kind=${classifyGetNoteFailure(detailError.message)} reason=${detailError.message}`
        );
        // 连续 3 条都被限流 → 对面已进入限流窗口，整批早停。
        // 已拉到的文档照常入库（partial_failure、水位不推进），下次可安全重试，不再白锤几百次。
        if (/getnote_http_429|getnote_api_(?:10202|42900)/.test(detailError.message)) {
          consecutiveRateLimited += 1;
          if (consecutiveRateLimited >= 3) {
            rateLimitAbort = true;
            console.warn(
              `[getnote-connector] 连续 ${consecutiveRateLimited} 条被限流，整批早停；已取得 ${documents.length} 条、失败 ${failed} 条`
            );
            break;
          }
        } else {
          consecutiveRateLimited = 0;
        }
        continue;
      }
      // GetNote applies QPS limits to read APIs. Keep detail reads paced even
      // when a note has no usable transcript. 350ms 实测仍会触发短窗口限流，放宽到 700ms。
      throttleMs += 700;
      await observe("details");
      await sleep(700);
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
        emptyContent += 1;
        skipped += 1;
        console.warn(
          `[getnote-connector] 详情 200 但正文为空，已跳过 externalId=${externalId} ` +
          `noteType=${String(noteRecord.note_type ?? noteRecord.noteType ?? "-")} 累计无正文=${emptyContent}`
        );
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
      // 窗口过滤：以 occurredAt 为准（详情层才拿到），超出窗口不入库存。
      const docWindowTime = (occurredAt ?? externalUpdatedAt)?.getTime();
      if (sinceMs !== undefined && docWindowTime !== undefined && docWindowTime < sinceMs) {
        skipped += 1;
        continue;
      }
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

    if (pageInWindow === 0 && pageOutOfWindow > 0) windowExhausted = true;

    // 提前停止条件（满足任一即认为已越过 30 天边界，后续页不再有窗口内笔记）：
    // ① 整页都早于窗口起点（windowExhausted）；
    // ② 本页越界项全部连续落在尾部（trailingOutOfWindow），与"创建时间倒序"一致，可安全停。
    const outOfWindowAllTrailing = pageOutOfWindow > 0 && trailingOutOfWindow >= pageOutOfWindow;
    if (windowExhausted || outOfWindowAllTrailing) {
      cursor = undefined;
      break;
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
  // 一次性汇总：下次再出现「某批没进来」时，这一行就能直接判定是请求失败还是内容缺失。
  console.warn(
    `[getnote-connector] 拉取汇总 扫描=${scanned} 入库候选=${documents.length} 请求失败=${failed} ` +
    `跳过=${skipped}(其中正文为空=${emptyContent}) 未变化=${unchanged} ` +
    `类型=${JSON.stringify(importedByType)} 列表请求=${listRequests} 详情请求=${detailRequests} ` +
    `重试=${retryCount} 退避ms=${backoffMs} 耗时ms=${(options.now ?? Date.now)() - startedAt}`
  );
  return { documents, nextCursor: cursor, scanned, skipped, failed, importedByType, unchanged, listRequests, detailRequests, retryCount, throttleMs, backoffMs };
}

async function getJson(
  path: string,
  credentials: GetNoteCredentials,
  options: { fetchImpl?: typeof fetch; sleep?: (milliseconds: number) => Promise<void>; onRetry?: (milliseconds: number) => void | Promise<void> } = {}
): Promise<unknown> {
  let lastError = new Error("getnote_request_failed");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await (options.fetchImpl ?? fetch)(`${GETNOTE_BASE_URL}${path}`, {
        headers: {
          Authorization: credentials.apiKey,
          "X-Client-ID": credentials.clientId,
          Accept: "application/json"
        }
      });
      const rawBody = await response.text();
      // 19 位 note id 超过 JS 安全整数范围，直接 json() 会丢精度（…7632 → …7700），
      // 拿错 id 查详情会得到 200 但 data 为空。解析前先把这些字段转成字符串。
      const body = parsePreservingLargeIds(rawBody);
      // 得到大脑错误响应有两种形态：顶层 {code} 或嵌套 {error:{code,reason}}（如 403+10201 not_member）
      const errorEnvelope = body.error as Record<string, unknown> | undefined;
      const rawCode = body.code ?? errorEnvelope?.code;
      const normalizedCode = rawCode === undefined || rawCode === null ? undefined : String(rawCode);
      const notMemberReason = errorEnvelope?.reason === "not_member";
      const retryable = response.status === 429
        || response.status >= 500
        || normalizedCode === "10202"
        || normalizedCode === "42900"
        || normalizedCode === "30000"
        || normalizedCode === "50000";
      if (!response.ok || (normalizedCode !== undefined && normalizedCode !== "0" && normalizedCode !== "200")) {
        // 优先用响应体里的业务错误码（如 10201 会员限制），否则退化为 HTTP 状态。
        // 否则 403+10201 会被误判为授权失效，提示错误。
        lastError = new Error(normalizedCode !== undefined ? `getnote_api_${normalizedCode}` : `getnote_http_${response.status}`);
        if (notMemberReason) lastError.message += "|not_member";
        if (retryable && attempt < 3) {
          const retryAfter = response.headers.get("Retry-After");
          const retryAfterMs = retryAfter && /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter.trim()) * 1000 : 0;
          // 限流退避从 0.5s 起改为 2s 起（2s / 4s / 8s），0.5s 太短，重试后立刻又被拒。
          const waitMs = Math.max(2000 * (2 ** attempt), retryAfterMs);
          console.warn(`[getnote-connector] 将重试 path=${path} attempt=${attempt + 1} httpStatus=${response.status} code=${normalizedCode ?? "-"} retryAfter=${retryAfter ?? "-"} waitMs=${waitMs}`);
          await options.onRetry?.(waitMs);
          await (options.sleep ?? delay)(waitMs);
          continue;
        }
        console.error(`[getnote-connector] 请求最终失败 path=${path} httpStatus=${response.status} code=${normalizedCode ?? "-"} kind=${classifyGetNoteFailure(lastError.message)}`);
        throw lastError;
      }
      return body;
    } catch (error) {
      lastError = error instanceof Error ? error : lastError;
      if (/fetch failed/i.test(lastError.message) && attempt < 3) {
        const waitMs = 2000 * (2 ** attempt);
        console.warn(`[getnote-connector] 网络异常将重试 path=${path} attempt=${attempt + 1} waitMs=${waitMs}`);
        await options.onRetry?.(waitMs);
        await (options.sleep ?? delay)(waitMs);
        continue;
      }
      console.error(`[getnote-connector] 请求异常 path=${path} kind=${classifyGetNoteFailure(lastError.message)} message=${lastError.message}`);
      throw lastError;
    }
  }
  throw lastError;
}

function parsePreservingLargeIds(raw: string): Record<string, unknown> {
  try {
    const guarded = raw.replace(
      /"(id|note_id|noteId|resourceId|next_cursor|cursor)"\s*:\s*(-?\d{16,})/g,
      '"$1":"$2"'
    );
    return JSON.parse(guarded) as Record<string, unknown>;
  } catch {
    return {};
  }
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
