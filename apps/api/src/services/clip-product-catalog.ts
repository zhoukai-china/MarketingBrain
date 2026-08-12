import type { LlmProvider } from "@baolu/agent";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { probeClip } from "./clip-renderer.js";
import { transcribeCommerceSource, type ClipProductRange, type TranscriptSegment } from "./clip-planner.js";

export interface ClipProductChapter {
  productId: string;
  name: string;
  ranges: ClipProductRange[];
  durationSeconds: number;
  confidence: number;
  reviewReason: string;
}

export interface ClipProductCatalog {
  catalogId: string;
  sources: Array<{ sourceId: string; durationSeconds: number }>;
  products: ClipProductChapter[];
  unassignedRanges: ClipProductRange[];
  transcriptSegmentCount: number;
  asrCalls: number;
  analyzeMs: number;
}

interface WindowItem extends ClipProductRange { windowId: string; text: string }
interface ProductAssignment { windowId?: string; productName?: string; confidence?: number; reason?: string }

export async function buildClipProductCatalog(params: {
  sources: Array<{ sourceId: string; sourcePath: string }>;
  provider: LlmProvider;
  contextText?: string;
}): Promise<ClipProductCatalog> {
  const startedAt = Date.now();
  const transcriptResults = await mapWithConcurrency(params.sources, 2, (source) =>
    transcribeCommerceSource(source, params.contextText ?? ""));
  const segments = transcriptResults.flatMap((result) => result.segments);
  if (!segments.length) throw new Error("没有识别到可用于按产品分段的清晰口播");
  const windows = buildWindows(segments);
  let assignments: ProductAssignment[] = [];
  try {
    for (let offset = 0; offset < windows.length; offset += 70) {
      const batch = windows.slice(offset, offset + 70);
      const raw = await params.provider.complete([
        {
          role: "system",
          content: "你是直播讲品分段员。按正在讲解的具体商品给连续口播窗口标注商品名。不要按卖点、话题或情绪拆成多个商品；只在主播明确换品时改变商品名。同一商品稍后再次出现仍使用完全相同的商品名。暖场、闲聊和无法判断标为非讲品。只返回 JSON。"
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "逐个窗口标注商品。返回 assignments 数组，每项包含 windowId、productName、confidence(0到1)、reason。不得遗漏窗口。",
            windows: batch
          })
        }
      ]);
      const parsed = parseJson(raw) as { assignments?: ProductAssignment[] };
      assignments.push(...(parsed.assignments ?? []));
    }
  } catch {
    assignments = [];
  }
  const assignmentByWindow = new Map(assignments.map((item) => [item.windowId, item]));
  const labeled = windows.map((window) => {
    const item = assignmentByWindow.get(window.windowId);
    return {
      ...window,
      productName: cleanProductName(item?.productName) || inferFallbackProduct(window.text),
      confidence: clamp(item?.confidence ?? 0.45, 0, 1),
      reason: String(item?.reason ?? "根据口播内容初步识别").slice(0, 100)
    };
  });
  stabilizeLabels(labeled);
  const productMap = new Map<string, ClipProductChapter>();
  const unassignedRanges: ClipProductRange[] = [];
  for (const item of labeled) {
    if (isUnassigned(item.productName)) {
      appendRange(unassignedRanges, item);
      continue;
    }
    const key = findCanonicalKey(productMap, item.productName);
    const chapter = productMap.get(key) ?? {
      productId: randomUUID(), name: item.productName, ranges: [], durationSeconds: 0,
      confidence: item.confidence, reviewReason: item.reason
    };
    appendRange(chapter.ranges, item);
    chapter.confidence = Math.min(chapter.confidence, item.confidence);
    productMap.set(key, chapter);
  }
  const products = [...productMap.values()].map((product) => ({
    ...product,
    durationSeconds: round(product.ranges.reduce((sum, range) => sum + range.endSeconds - range.startSeconds, 0))
  })).sort((a, b) => firstTime(a) - firstTime(b));
  // If the model was unavailable, keep the workflow usable instead of
  // inventing dozens of chapters: one source becomes one reviewable product.
  if (!products.length) {
    for (const source of params.sources) {
      const duration = (await probeClip(source.sourcePath)).durationSeconds;
      products.push({
        productId: randomUUID(), name: source.sourceId.replace(/\.[^.]+$/, "") || "待命名商品",
        ranges: [{ sourceId: source.sourceId, startSeconds: 0, endSeconds: duration }],
        durationSeconds: round(duration), confidence: 0.2, reviewReason: "自动识别失败，请先校正商品名称和边界"
      });
    }
  }
  const sourceInfo = await Promise.all(params.sources.map(async (source) => ({
    sourceId: source.sourceId,
    durationSeconds: (await probeClip(source.sourcePath)).durationSeconds
  })));
  const catalog: ClipProductCatalog = {
    catalogId: randomUUID(), sources: sourceInfo, products, unassignedRanges,
    transcriptSegmentCount: segments.length,
    asrCalls: transcriptResults.reduce((sum, result) => sum + result.asrCalls, 0),
    analyzeMs: Date.now() - startedAt
  };
  const root = path.resolve(env.UPLOAD_DIR, "clip-lab", "product-catalogs");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, `${catalog.catalogId}.json`), JSON.stringify(catalog, null, 2), "utf8");
  return catalog;
}

export async function readClipProductCatalog(catalogId: string): Promise<ClipProductCatalog> {
  if (!/^[a-f0-9-]{36}$/i.test(catalogId)) throw new Error("invalid_catalog_id");
  return JSON.parse(await readFile(path.resolve(env.UPLOAD_DIR, "clip-lab", "product-catalogs", `${catalogId}.json`), "utf8")) as ClipProductCatalog;
}

function buildWindows(segments: TranscriptSegment[]): WindowItem[] {
  const result: WindowItem[] = [];
  for (const sourceId of new Set(segments.map((segment) => segment.sourceId))) {
    const sourceSegments = segments.filter((segment) => segment.sourceId === sourceId).sort((a, b) => a.startSeconds - b.startSeconds);
    let bucket: TranscriptSegment[] = [];
    const flush = () => {
      if (!bucket.length) return;
      result.push({
        windowId: `${sourceId}:${result.length + 1}`,
        sourceId,
        startSeconds: bucket[0].startSeconds,
        endSeconds: bucket[bucket.length - 1].endSeconds,
        text: bucket.map((item) => item.transcript).join(" ").slice(0, 1200)
      });
      bucket = [];
    };
    for (const segment of sourceSegments) {
      if (bucket.length && (segment.startSeconds - bucket[0].startSeconds >= 45 || segment.startSeconds - bucket[bucket.length - 1].endSeconds > 12)) flush();
      bucket.push(segment);
    }
    flush();
  }
  return result;
}

function stabilizeLabels(items: Array<WindowItem & { productName: string; confidence: number; reason: string }>): void {
  for (let index = 1; index < items.length - 1; index += 1) {
    const previous = items[index - 1];
    const current = items[index];
    const next = items[index + 1];
    if (previous.sourceId === current.sourceId && current.sourceId === next.sourceId
      && normalizeName(previous.productName) === normalizeName(next.productName)
      && normalizeName(current.productName) !== normalizeName(previous.productName)
      && current.endSeconds - current.startSeconds < 55) {
      current.productName = previous.productName;
      current.confidence = Math.min(current.confidence, 0.65);
      current.reason = "相邻窗口都在讲同一商品，已合并短暂噪声段";
    }
  }
}

function appendRange(ranges: ClipProductRange[], item: ClipProductRange): void {
  const previous = ranges[ranges.length - 1];
  if (previous && previous.sourceId === item.sourceId && item.startSeconds - previous.endSeconds <= 15) {
    previous.endSeconds = Math.max(previous.endSeconds, item.endSeconds);
  } else ranges.push({ sourceId: item.sourceId, startSeconds: item.startSeconds, endSeconds: item.endSeconds });
}

function findCanonicalKey(products: Map<string, ClipProductChapter>, name: string): string {
  const key = normalizeName(name);
  for (const existing of products.keys()) {
    if (existing === key || existing.includes(key) || key.includes(existing)) return existing;
  }
  return key;
}

function cleanProductName(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/^[《“”"']+|[》“”"']+$/g, "").slice(0, 40) : "";
}
function inferFallbackProduct(text: string): string { return /油|炒菜|炸东西/.test(text) ? "食用油" : "非讲品"; }
function isUnassigned(name: string): boolean { return !name || /非讲品|闲聊|无法判断|未知|暖场/.test(name); }
function normalizeName(name: string): string { return name.replace(/[\s·，。、“”"'牌款型号]/g, "").toLowerCase(); }
function firstTime(product: ClipProductChapter): number { return product.ranges[0]?.startSeconds ?? Number.MAX_SAFE_INTEGER; }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min)); }
function round(value: number): number { return Math.round(value * 10) / 10; }
function parseJson(raw: string): unknown { const start = raw.indexOf("{"); const end = raw.lastIndexOf("}"); if (start < 0 || end <= start) throw new Error("catalog_json_missing"); return JSON.parse(raw.slice(start, end + 1)); }
async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const result = new Array<R>(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) { const index = next++; result[index] = await fn(items[index]); }
  }));
  return result;
}
