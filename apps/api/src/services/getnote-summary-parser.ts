// 得到大脑 note/detail 返回的 content 本身就是对方已经做好的结构化总结：
//   ### 📑 智能总结 → #### 录音信息 / #### 录音总结
//   ### 📅 章节概要（带时间戳）
//   ### ✨ 金句精选（带分类标签）
//   ### 📋 待办事项
// 这里把它解析成结构化条目，避免再花钱调 LLM 二次提取。

export type ParsedQuote = { text: string; tag?: string };
export type ParsedCoreView = { topic?: string; text: string };
export type ParsedChapter = { start?: string; title: string; summary: string };
export type ParsedNote = {
  sourceChars: number;
  overview: string;
  coreViews: ParsedCoreView[];
  quotes: ParsedQuote[];
  chapters: ParsedChapter[];
  todos: string[];
  meta: Record<string, string>;
};

type Bucket = "meta" | "summary" | "chapters" | "quotes" | "todos" | "other";

const HEADING = /^(#{2,4})\s+(.*)$/;
const QUOTE_LINE = /^[-*]\s*[“"](.+?)[”"]\s*(?:[（(]([^）)]*)[）)])?\s*$/;
const CHAPTER_LINE = /^\[([^\]]+)\]\([^)]*\)\s*\*\*(.+?)\*\*\s*$/;
const META_LINE = /^[-*]\s*\*\*(.+?)\*\*\s*[:：]\s*(.*)$/;
const TOPIC_LINE = /^\*\*(.+?)\*\*\s*$/;
const BULLET_LINE = /^[-*]\s+(.*)$/;

function classifyHeading(raw: string): Bucket | null {
  if (/录音信息/.test(raw)) return "meta";
  if (/录音总结|内容总结|总结/.test(raw)) return "summary";
  if (/章节/.test(raw)) return "chapters";
  if (/金句/.test(raw)) return "quotes";
  if (/待办|行动项/.test(raw)) return "todos";
  return null;
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripMarkdown(value: string): string {
  return clean(value.replace(/\*\*/g, "").replace(/`/g, ""));
}

function matchQuote(line: string): ParsedQuote | null {
  const quoted = line.match(QUOTE_LINE);
  if (quoted) return { text: clean(quoted[1]), ...(quoted[2] ? { tag: clean(quoted[2]) } : {}) };
  const bullet = line.match(BULLET_LINE);
  if (!bullet) return null;
  const inner = bullet[1].match(/[“"](.+?)[”"]\s*(?:[（(]([^）)]*)[）)])?/);
  if (!inner) return null;
  return { text: clean(inner[1]), ...(inner[2] ? { tag: clean(inner[2]) } : {}) };
}

export function parseGetNoteSummary(content: unknown): ParsedNote {
  const text = typeof content === "string" ? content : "";
  const buckets = new Map<Bucket, string[]>();
  let current: Bucket = "other";

  for (const rawLine of text.split(/\r?\n/)) {
    const heading = rawLine.match(HEADING);
    if (heading) {
      const bucket = classifyHeading(heading[2]);
      // 未识别的小节标题（例如「📑 智能总结」容器）保留在当前桶，避免内容被丢掉。
      if (bucket) current = bucket;
      if (!buckets.has(current)) buckets.set(current, []);
      continue;
    }
    if (!buckets.has(current)) buckets.set(current, []);
    buckets.get(current)!.push(rawLine);
  }

  const meta: Record<string, string> = {};
  for (const line of buckets.get("meta") ?? []) {
    const found = line.match(META_LINE);
    if (found) meta[clean(found[1])] = clean(found[2]);
  }

  let overview = "";
  const coreViews: ParsedCoreView[] = [];
  let topic: string | undefined;
  for (const raw of buckets.get("summary") ?? []) {
    const line = raw.trim();
    if (!line) continue;
    const topicMatch = line.match(TOPIC_LINE);
    if (topicMatch) {
      topic = clean(topicMatch[1]);
      continue;
    }
    const bullet = line.match(BULLET_LINE);
    if (bullet) {
      let body = stripMarkdown(bullet[1]);
      const lead = body.match(/^(.+?)\s*[:：]\s*(.+)$/);
      if (lead && lead[1].length <= 24) {
        coreViews.push({ ...(topic ? { topic } : {}), text: `${clean(lead[1])}：${clean(lead[2])}` });
      } else if (body) {
        coreViews.push({ ...(topic ? { topic } : {}), text: body });
      }
      continue;
    }
    if (!topic && !coreViews.length) {
      overview = overview ? `${overview} ${stripMarkdown(line)}` : stripMarkdown(line);
    }
  }

  const quotes: ParsedQuote[] = [];
  for (const raw of buckets.get("quotes") ?? []) {
    const line = raw.trim();
    if (!line) continue;
    const found = matchQuote(line);
    if (found && found.text) quotes.push(found);
  }

  const chapters: ParsedChapter[] = [];
  for (const raw of buckets.get("chapters") ?? []) {
    const line = raw.trim();
    if (!line) continue;
    const found = line.match(CHAPTER_LINE);
    if (found) {
      chapters.push({ start: clean(found[1]), title: clean(found[2]), summary: "" });
      continue;
    }
    const bullet = line.match(BULLET_LINE);
    const body = stripMarkdown(bullet ? bullet[1] : line);
    if (!body) continue;
    const last = chapters[chapters.length - 1];
    if (last) last.summary = last.summary ? `${last.summary} ${body}` : body;
  }

  const todos: string[] = [];
  for (const raw of buckets.get("todos") ?? []) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(BULLET_LINE);
    const body = stripMarkdown(bullet ? bullet[1] : line);
    if (body) todos.push(body);
  }

  return { sourceChars: text.length, overview: clean(overview), coreViews, quotes, chapters, todos, meta };
}

// ---------------------------------------------------------------------------
// 聚类去重：这批是同系列课程，跨篇重复度很高（多处讲同一套打法）。
// 用「录音总结」里自带的小主题做锚点，再按字符 bigram 相似度合并措辞不同的同义主题。
// ---------------------------------------------------------------------------

export type ClusterInput = {
  noteIndex: number;
  noteTitle: string;
  parsed: ParsedNote;
};

export type ClusterResult = {
  label: string;
  size: number;
  mergedLabels: string[];
  views: string[];
  quotes: string[];
  sources: string[];
};

function bigrams(value: string): Set<string> {
  const normalized = value.replace(/[^\p{L}\p{N}]/gu, "");
  const grams = new Set<string>();
  for (let index = 0; index + 2 <= normalized.length; index += 1) grams.add(normalized.slice(index, index + 2));
  return grams;
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export function clusterNotes(notes: ClusterInput[], threshold = 0.34): ClusterResult[] {
  const buckets: Array<{ label: string; grams: Set<string>; merged: string[]; views: string[]; quotes: string[]; sources: string[] }> = [];

  for (const note of notes) {
    const topics = new Map<string, ParsedCoreView[]>();
    for (const view of note.parsed.coreViews) {
      const key = view.topic ?? "未分类";
      const list = topics.get(key) ?? [];
      list.push(view);
      topics.set(key, list);
    }
    for (const [topic, views] of topics) {
      const grams = bigrams(topic);
      let target = buckets.find((bucket) => similarity(bucket.grams, grams) >= threshold);
      if (!target) {
        target = { label: topic, grams, merged: [], views: [], quotes: [], sources: [] };
        buckets.push(target);
      } else if (target.label !== topic && !target.merged.includes(topic)) {
        target.merged.push(topic);
      }
      for (const view of views) if (!target.views.includes(view.text)) target.views.push(view.text);
      const source = `#${note.noteIndex} ${note.noteTitle}`;
      if (!target.sources.includes(source)) target.sources.push(source);
    }
    // 金句按自身标签挂到最相近的主题簇；没有标签或匹配不上时，挂到该篇的第一个簇。
    for (const quote of note.parsed.quotes) {
      const grams = bigrams(quote.text);
      let scored: { bucket: (typeof buckets)[number]; score: number } | null = null;
      for (const bucket of buckets) {
        const score = similarity(bucket.grams, grams);
        if (!scored || score > scored.score) scored = { bucket, score };
      }
      const target = scored && scored.score >= threshold ? scored.bucket : buckets[0];
      if (target && !target.quotes.includes(quote.text)) target.quotes.push(quote.text);
    }
  }

  return buckets.map((bucket) => ({
    label: bucket.label,
    size: bucket.views.length + bucket.quotes.length,
    mergedLabels: bucket.merged,
    views: bucket.views,
    quotes: bucket.quotes,
    sources: bucket.sources
  }));
}

export function buildEvidencePack(clusters: ClusterResult[], query: string, limit = 20): { items: string[]; text: string } {
  const keywordGrams = bigrams(query ?? "");
  const scored = clusters
    .map((cluster) => {
      const haystack = `${cluster.label} ${cluster.views.join(" ")} ${cluster.quotes.join(" ")}`;
      const grams = bigrams(haystack);
      let shared = 0;
      for (const gram of keywordGrams) if (grams.has(gram)) shared += 1;
      const score = keywordGrams.size === 0 ? 0 : shared / keywordGrams.size;
      return { cluster, score };
    })
    .sort((a, b) => b.score - a.score);

  const items: string[] = [];
  for (const entry of scored) {
    if (items.length >= limit) break;
    if (entry.cluster.views[0]) items.push(`【${entry.cluster.label}】${entry.cluster.views[0]}`);
    if (items.length >= limit) break;
    if (entry.cluster.quotes[0]) items.push(`【金句】${entry.cluster.quotes[0]}`);
  }
  return { items, text: items.map((item, index) => `${index + 1}. ${item}`).join("\n") };
}
