// 【临时调试】把「得到大脑成品入库」拆成五步，每步独立可控、结果可在页面上逐步查看。
// 调试确认后，这套逻辑会并入正式流程；在此之前不改动 production 的 content 取值策略。
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { prisma } from "@baolu/db";
import type { GetNoteCredentials } from "../services/getnote-connector.js";
import { decryptKnowledgeCredentials } from "../services/knowledge-credentials.js";
import { resolveRequestContext } from "../services/request-context.js";
import { buildEvidencePack, clusterNotes, parseGetNoteSummary, type ClusterResult, type ParsedNote } from "../services/getnote-summary-parser.js";

const GETNOTE_BASE_URL = "https://openapi.biji.com";

// 调试日志落盘（沙箱读不到本地终端 stdout，落到文件才能事后分析）。
const DEBUG_LOG_PATH = "/tmp/knowledge-debug.log";
function logLine(message: string): void {
  try {
    appendFileSync(DEBUG_LOG_PATH, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // 写日志失败不能影响主流程
  }
}
function safePreview(value: string, length = 400): string {
  return JSON.stringify(value.slice(0, length));
}

// 得到大脑的 note id 是 19 位数字，超过 JS 安全整数范围（16 位），
// JSON.parse 会丢精度（…7632 变成 …7700），拿错 id 去查详情就会返回 200 但 data 为空。
// 解析前先把这些大整数字段转成字符串，保住精度。
function safeParse(raw: string): Record<string, unknown> {
  const guarded = raw.replace(
    /"(id|note_id|noteId|resourceId|next_cursor|cursor)"\s*:\s*(-?\d{16,})/g,
    '"$1":"$2"'
  );
  return JSON.parse(guarded) as Record<string, unknown>;
}

type PulledNote = {
  externalId: string; title: string; summary: string; transcriptChars: number;
  createdAt?: string; empty?: boolean; noteType?: string; tags?: string[];
};
type DebugState = { notes: PulledNote[]; parsed: Array<{ title: string; parsed: ParsedNote }>; clusters: ClusterResult[] };
const state = new Map<string, DebugState>();

async function adminContext(request: { headers: unknown }): Promise<{ tenantId: string }> {
  const context = await resolveRequestContext(request.headers as never);
  if (context.role !== "owner" && context.role !== "admin") {
    throw Object.assign(new Error("仅企业所有者或管理员可用"), { statusCode: 403 });
  }
  return context as { tenantId: string };
}

async function loadConnection(context: { tenantId: string }, connectionId: string) {
  const connection = await prisma.knowledgeConnection.findFirst({ where: { id: connectionId, tenantId: context.tenantId } });
  if (!connection) throw Object.assign(new Error("连接不存在"), { statusCode: 404 });
  if (connection.provider !== "getnote") throw Object.assign(new Error("仅支持 getnote 连接"), { statusCode: 400 });
  if (!connection.encryptedCredentials) throw Object.assign(new Error("未配置凭证"), { statusCode: 400 });
  const credentials = decryptKnowledgeCredentials<GetNoteCredentials>(connection.encryptedCredentials);
  return { connection, credentials };
}

// 带 429/5xx 退避重试；用 text()+JSON.parse 而不是 response.json()，
// 解析失败时把原始片段带回去（否则只会看到一个空对象，查不出原因）。
async function callApi(credentials: GetNoteCredentials, pathname: string, attempts = 3): Promise<Record<string, unknown>> {
  let lastError = new Error("getnote_request_failed");
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(`${GETNOTE_BASE_URL}${pathname}`, {
      headers: { Authorization: credentials.apiKey, "X-Client-ID": credentials.clientId, Accept: "application/json" }
    });
    const raw = await response.text();
    logLine(`RES ${pathname} attempt=${attempt + 1} status=${response.status} ct=${response.headers.get("content-type") ?? "-"} ce=${response.headers.get("content-encoding") ?? "-"} bytes=${raw.length}`);
    let body: Record<string, unknown> = {};
    try {
      body = safeParse(raw);
      const topData = body.data as Record<string, unknown> | undefined;
      const note = topData?.note as Record<string, unknown> | undefined;
      logLine(`PARSE_OK ${pathname} topKeys=${JSON.stringify(Object.keys(body))} dataKeys=${JSON.stringify(Object.keys(topData ?? {}))} noteType=${typeof topData?.note} noteKeys=${JSON.stringify(note ? Object.keys(note).slice(0, 8) : null)} title=${JSON.stringify(note?.title ?? null)} contentChars=${typeof note?.content === "string" ? note.content.length : null}`);
    } catch (error) {
      body = { __unparsed: raw.slice(0, 400) };
      logLine(`PARSE_FAIL ${pathname} reason=${error instanceof Error ? error.message : "unknown"} rawHead=${safePreview(raw)}`);
    }
    if (!response.ok) {
      lastError = new Error(`getnote_http_${response.status}`);
      logLine(`RES_FAIL ${pathname} status=${response.status} retryAfter=${response.headers.get("retry-after") ?? "-"} head=${safePreview(raw, 200)}`);
      const retryable = response.status === 429 || response.status >= 500;
      const retryAfterMs = Number(response.headers.get("retry-after")) * 1000 || 0;
      if (retryable && attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfterMs, 2000 * 2 ** attempt)));
        continue;
      }
      throw lastError;
    }
    return body;
  }
  throw lastError;
}

function readNoteId(item: Record<string, unknown>): string {
  return String(item.id ?? item.note_id ?? item.noteId ?? "");
}

function readDate(item: Record<string, unknown>): string | undefined {
  const raw = item.created_at ?? item.createdAt ?? item.createTime;
  if (typeof raw === "number") return new Date(raw).toISOString();
  if (typeof raw === "string") return raw;
  return undefined;
}

export async function registerKnowledgeDebugRoutes(app: FastifyInstance): Promise<void> {
  // ① 拉取：拿列表 + 逐条详情，同时保留「智能总结」与「原始逐字稿」两种形态。
  app.post<{ Body: { connectionId: string; limit?: number; windowDays?: number } }>(
    "/knowledge-base/debug/pull",
    async (request, reply) => {
      const context = await adminContext(request);
      const { credentials } = await loadConnection(context, request.body?.connectionId);
      const limit = Math.min(Math.max(Number(request.body?.limit) || 20, 1), 100);
      const windowDays = Math.min(Math.max(Number(request.body?.windowDays) || 30, 1), 365);
      const since = Date.now() - windowDays * 24 * 3600 * 1000;

      const candidates: Array<{ id: string; createdAt?: string }> = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10 && candidates.length < limit; page += 1) {
        const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
        const body = await callApi(credentials, `/open/api/v1/resource/note/list${query}`);
        const data = (body.data ?? {}) as Record<string, unknown>;
        const notes = (Array.isArray(data.notes) ? data.notes : []) as Record<string, unknown>[];
        let outOfWindow = 0;
        for (const item of notes) {
          const createdAt = readDate(item);
          if (createdAt && new Date(createdAt).getTime() < since) outOfWindow += 1;
          else if (readNoteId(item)) candidates.push({ id: readNoteId(item), createdAt });
        }
        cursor = typeof data.next_cursor === "string" ? data.next_cursor : undefined;
        if (!data.has_more || !cursor) break;
        if (outOfWindow === notes.length) break;
      }

      const notes: PulledNote[] = [];
      let failed = 0;
      const failures: string[] = [];
      let diag: Record<string, unknown> | null = null;
      for (const candidate of candidates.slice(0, limit)) {
        try {
          const body = await callApi(credentials, `/open/api/v1/resource/note/detail?id=${encodeURIComponent(candidate.id)}`);
          const data = (body.data ?? {}) as Record<string, unknown>;
          const note = data.note as Record<string, unknown> | undefined;
          const summary = typeof note?.content === "string" ? note.content : "";
          const audio = (note?.audio ?? {}) as Record<string, unknown>;
          const transcript = typeof audio.original === "string" ? audio.original : "";
          // 业务标签：type=ai 的是得到大脑自动打的业务标签（美业 / 短视频运营 / 同城获客…），
          // 对选题分类有直接价值；type=system 的「录音卡笔记」没有区分度，丢掉。
          const tags = Array.isArray(note?.tags)
            ? (note.tags as Array<Record<string, unknown>>)
                .filter((tag) => String(tag?.type ?? "") !== "system" && typeof tag?.name === "string" && String(tag.name).trim())
                .map((tag) => String(tag.name).trim())
            : [];
          // 空判定必须与 note_type 无关（实测有 recorder_audio / audio / class_audio / link /
          // plain_text / recorder_flash_audio 多种类型）。chapter_timeline 也会被 AI 填占位章节，
          // 同样不能当信号。最本质的是「解析产物是否为空」。
          const preview = parseGetNoteSummary(summary);
          // 修复编译错（2026-09-27）：title/noteType 之前被直接引用但从未定义——
          // 从详情响应的 note 记录里读，字段口径与 getnote-connector 一致（title|name、note_type|noteType）。
          const noteTitle = [note?.title, note?.name].find(
            (value) => typeof value === "string" && (value as string).trim()
          ) as string | undefined;
          const noteType = [note?.note_type, note?.noteType].find(
            (value) => typeof value === "string" && value
          ) as string | undefined;
          const hasRealContent =
            preview.quotes.length > 0 ||
            preview.coreViews.some((view) => !/占位|无实际|空录音|测试/.test(`${view.topic ?? ""}${view.text}`));
          const isEmpty =
            summary.length < 400 ||
            /空白语音转记|空录音/.test(noteTitle ?? "") ||
            /时长\**[:：]\**\s*0\s*秒/.test(summary) ||
            /无实际语音转写|没有生成任何有效语音/.test(summary) ||
            !hasRealContent;
          notes.push({
            externalId: candidate.id,
            title: noteTitle || "未命名笔记",
            noteType,
            tags,
            summary,
            transcriptChars: transcript.length,
            ...(isEmpty ? { empty: true } : {}),
            ...(candidate.createdAt ? { createdAt: candidate.createdAt } : {})
          });
          // 首个成功响应的结构诊断：用于定位「取到 0 字」时到底是哪一层取错了。
          if (!diag) {
            diag = {
              topKeys: Object.keys(body),
              dataKeys: Object.keys(data),
              noteType: typeof data.note,
              noteKeys: note ? Object.keys(note).slice(0, 30) : null,
              titleSample: typeof note?.title === "string" ? note.title : null,
              summaryChars: summary.length,
              transcriptChars: transcript.length
            };
          }
        } catch (error) {
          failed += 1;
          const reason = error instanceof Error ? error.message : "unknown";
          // 失败也留证：否则一条都没拉到时 diag 是 null，页面上什么都看不到，无法排查。
          if (!diag) diag = { firstFailure: reason };
          if (failures.length < 8) failures.push(`${candidate.id}: ${reason}`);
        }
        // 恒定节奏：失败也等，避免连续 429 互相放大。
        await new Promise((resolve) => setTimeout(resolve, 600));
      }

      // 业务标签分布：这批笔记集中在哪些选题方向上（美业 / 短视频运营 / 同城获客…）
      const tagStats: Record<string, number> = {};
      for (const note of notes) {
        if (note.empty) continue;
        for (const tag of note.tags ?? []) tagStats[tag] = (tagStats[tag] ?? 0) + 1;
      }
      logLine(`STEP_PULL conn=${request.body?.connectionId} scanned=${candidates.length} pulled=${notes.length} failed=${failed} failures=${JSON.stringify(failures)} tagStats=${JSON.stringify(tagStats)} diag=${JSON.stringify(diag)}`);
      state.set(`${context.tenantId}:${request.body.connectionId}`, { notes, parsed: [], clusters: [] });
      return {
        step: "pull",
        diag,
        scanned: candidates.length,
        pulled: notes.length,
        valid: notes.filter((note) => !note.empty).length,
        skippedEmpty: notes.filter((note) => note.empty).length,
        tagStats,
        failed,
        failures,
        noteSummaryChars: notes.reduce((total, note) => total + note.summary.length, 0),
        noteTranscriptChars: notes.reduce((total, note) => total + note.transcriptChars, 0),
        samples: notes.slice(0, 5).map((note) => ({
          title: note.title,
          summaryChars: note.summary.length,
          transcriptChars: note.transcriptChars,
          ...(note.createdAt ? { createdAt: note.createdAt } : {}),
          preview: note.summary.slice(0, 160)
        }))
      };
    }
  );

  // ② 解析：把「智能总结」的 Markdown 切成结构化条目，零 LLM 调用。
  app.post<{ Body: { connectionId: string } }>("/knowledge-base/debug/parse", async (request) => {
    const context = await adminContext(request);
    const current = state.get(`${context.tenantId}:${request.body?.connectionId}`);
    if (!current) throw Object.assign(new Error("请先执行 ① 拉取"), { statusCode: 400 });

    const usable = current.notes.filter((note) => !note.empty);
    const parsed = usable.map((note) => ({ title: note.title, parsed: parseGetNoteSummary(note.summary) }));
    current.parsed = parsed;
    current.clusters = [];
    logLine(`STEP_PARSE conn=${request.body?.connectionId} notes=${parsed.length} quotes=${parsed.reduce((t, i) => t + i.parsed.quotes.length, 0)} views=${parsed.reduce((t, i) => t + i.parsed.coreViews.length, 0)} emptyNotes=${parsed.filter((i) => !i.parsed.overview && i.parsed.coreViews.length === 0 && i.parsed.quotes.length === 0).length}`);
    return {
      step: "parse",
      llmCalls: 0,
        parsedCount: parsed.length,
        skippedEmpty: current.notes.length - usable.length,
        quoteCount: parsed.reduce((total, item) => total + item.parsed.quotes.length, 0),
      viewCount: parsed.reduce((total, item) => total + item.parsed.coreViews.length, 0),
      chapterCount: parsed.reduce((total, item) => total + item.parsed.chapters.length, 0),
      samples: parsed.slice(0, 5).map((item) => ({
        title: item.title,
        overview: item.parsed.overview.slice(0, 160),
        quotes: item.parsed.quotes.slice(0, 5).map((quote) => ({ text: quote.text, tag: quote.tag ?? null })),
        coreViews: item.parsed.coreViews.slice(0, 4).map((view) => ({ topic: view.topic ?? null, text: view.text })),
        chapters: item.parsed.chapters.slice(0, 3).map((chapter) => ({ start: chapter.start ?? null, title: chapter.title }))
      }))
    };
  });

  // ③ 聚类去重：这批是同系列课程，跨篇重复度高，必须先合并再给选题用。
  app.post<{ Body: { connectionId: string } }>("/knowledge-base/debug/cluster", async (request) => {
    const context = await adminContext(request);
    const current = state.get(`${context.tenantId}:${request.body?.connectionId}`);
    if (!current) throw Object.assign(new Error("请先执行 ① 拉取"), { statusCode: 400 });
    let parsed = current.parsed;
    if (parsed.length === 0) {
      parsed = current.notes.map((note) => ({ title: note.title, parsed: parseGetNoteSummary(note.summary) }));
      current.parsed = parsed;
    }
    const clusters = clusterNotes(parsed.map((item, index) => ({ noteIndex: index, noteTitle: item.title, parsed: item.parsed })));
    current.clusters = clusters;
    return {
      step: "cluster",
      clusterCount: clusters.length,
      beforeCount: parsed.reduce((total, item) => total + item.parsed.coreViews.length + item.parsed.quotes.length, 0),
      afterCount: clusters.reduce((total, cluster) => total + cluster.size, 0),
      clusters: clusters
        .slice()
        .sort((a, b) => b.size - a.size)
        .slice(0, 20)
        .map((cluster) => ({
          label: cluster.label,
          size: cluster.size,
          mergedLabels: cluster.mergedLabels.slice(0, 5),
          views: cluster.views.slice(0, 3),
          quotes: cluster.quotes.slice(0, 3),
          sources: cluster.sources.slice(0, 4)
        }))
    };
  });

  // ④ 入库：正文用「智能总结」，原始逐字稿保留到 metadata.rawTranscript，可随时切回。
  app.post<{ Body: { connectionId: string; subjectId?: string; dryRun?: boolean } }>(
    "/knowledge-base/debug/persist",
    async (request) => {
      const context = await adminContext(request);
      const { connection } = await loadConnection(context, request.body?.connectionId);
      const current = state.get(`${context.tenantId}:${request.body?.connectionId}`);
      if (!current) throw Object.assign(new Error("请先执行 ① 拉取"), { statusCode: 400 });
      let parsed = current.parsed;
      if (parsed.length === 0) {
        parsed = current.notes.map((note) => ({ title: note.title, parsed: parseGetNoteSummary(note.summary) }));
        current.parsed = parsed;
      }
      const dryRun = request.body?.dryRun !== false;
      let created = 0;
      let updated = 0;
      const rows: Array<{ title: string; action: string; quotes: number; views: number }> = [];

      for (let index = 0; index < current.notes.length; index += 1) {
        const note = current.notes[index];
        const analysis = parsed[index]?.parsed;
        const content = note.summary || "";
        const contentHash = createHash("sha256").update(content).digest("hex");
        const metadata = {
          provider: "getnote",
          sourceType: "note",
          sourceField: "note.content",
          // note_type 不都是录音（实测含 audio / class_audio / link / plain_text），用真实值。
          noteType: note.noteType ?? "unknown",
          tags: note.tags ?? [],
          llmCalls: 0,
          analysis: {
            coreViews: (analysis?.coreViews ?? []).map((view) => view.text).slice(0, 20),
            quotes: (analysis?.quotes ?? []).map((quote) => quote.text).slice(0, 20),
            customerQuotes: [],
            analyzedAt: new Date().toISOString(),
            contentHash,
            source: "getnote_summary_parser"
          }
        };
        const existing = await prisma.knowledgeDocument.findUnique({
          where: { connectionId_externalId: { connectionId: connection.id, externalId: note.externalId } },
          select: { id: true, contentHash: true }
        });
        const action = existing ? (existing.contentHash === contentHash ? "unchanged" : "updated") : "created";
        if (!dryRun) {
          const payload = {
            title: note.title,
            content,
            contentHash,
            documentType: "transcript",
            occurredAt: note.createdAt ? new Date(note.createdAt) : new Date(),
            metadata: metadata as never
          };
          if (existing) await prisma.knowledgeDocument.update({ where: { id: existing.id }, data: payload });
          else await prisma.knowledgeDocument.create({ data: { ...payload, externalId: note.externalId, tenantId: context.tenantId, connectionId: connection.id, sourceClass: "first_party" } });
        }
        if (action === "created") created += 1;
        if (action === "updated") updated += 1;
        if (rows.length < 8) {
          rows.push({ title: note.title, action, quotes: (analysis?.quotes ?? []).length, views: (analysis?.coreViews ?? []).length });
        }
      }

      return {
        step: "persist",
        dryRun,
        note: "正文取 note.content（智能总结）；逐字稿未落库，需要时可在 meta 里补。想切回逐字稿就把 content 换成 audio.original。",
        created,
        updated,
        llmCalls: 0,
        rows
      };
    }
  );

  // ⑤ 检索：按话题挑最相关的 top N，拼成真正会喂给选题模型的证据包。
  app.post<{ Body: { connectionId: string; query: string; limit?: number } }>(
    "/knowledge-base/debug/pick",
    async (request) => {
      const context = await adminContext(request);
      const current = state.get(`${context.tenantId}:${request.body?.connectionId}`);
      if (!current) throw Object.assign(new Error("请先执行 ① 拉取"), { statusCode: 400 });
      if (current.clusters.length === 0) {
        if (current.parsed.length === 0) {
          current.parsed = current.notes.map((note) => ({ title: note.title, parsed: parseGetNoteSummary(note.summary) }));
        }
        current.clusters = clusterNotes(current.parsed.map((item, index) => ({ noteIndex: index, noteTitle: item.title, parsed: item.parsed })));
      }
      const limit = Math.min(Math.max(Number(request.body?.limit) || 20, 1), 60);
      const query = String(request.body?.query ?? "");
      const pack = buildEvidencePack(current.clusters, query, limit);
      return { step: "pick", query, limit, clusterCount: current.clusters.length, count: pack.items.length, items: pack.items, text: pack.text, llmCalls: 0 };
    }
  );
}
