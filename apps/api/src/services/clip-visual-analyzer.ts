import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { env, domesticNetworkOnly, domesticOutboundAllowlist } from "../config/env.js";
import { assertOutboundUrlAllowed } from "./outbound-policy.js";

export interface ClipVisualAnalysis {
  segmentId: string;
  summary: string;
  ocrText: string;
  matchScore: number;
  matched: boolean;
  focusX: number;
  focusY: number;
  reviewReason: string;
}

interface VisualCandidate {
  segmentId: string;
  sourceId: string;
  startSeconds: number;
  endSeconds: number;
  transcript: string;
  role: string;
}

export async function analyzeSelectedClipVisuals(params: {
  segments: VisualCandidate[];
  sourcePaths: Record<string, string>;
}): Promise<Map<string, ClipVisualAnalysis>> {
  const analyses = new Map<string, ClipVisualAnalysis>();
  const cacheRoot = path.resolve(env.UPLOAD_DIR, "clip-lab", "vision-cache");
  await mkdir(cacheRoot, { recursive: true });
  const pending: VisualCandidate[] = [];
  const cachePaths = new Map<string, string>();
  for (const segment of params.segments) {
    const sourcePath = params.sourcePaths[segment.sourceId];
    if (!sourcePath) throw new Error(`找不到画面分析源：${segment.sourceId}`);
    const sourceStat = await stat(sourcePath);
    const cacheKey = createHash("sha256").update([
      sourcePath,
      sourceStat.size,
      sourceStat.mtimeMs,
      segment.startSeconds,
      segment.endSeconds,
      segment.transcript,
      segment.role,
      env.ALIYUN_VIDEO_MODEL,
      "vision-alignment-v4-blind-strong-claim-ocr"
    ].join("|")).digest("hex");
    const cachePath = path.join(cacheRoot, `${cacheKey}.json`);
    cachePaths.set(segment.segmentId, cachePath);
    try {
      const cached = JSON.parse(await readFile(cachePath, "utf8")) as ClipVisualAnalysis;
      analyses.set(segment.segmentId, cached);
    } catch {
      pending.push(segment);
    }
  }
  if (pending.length === 0) return analyses;
  const tempRoot = await mkdtemp(path.join(tmpdir(), "sitong-clip-vision-"));
  try {
    const frames = await mapWithConcurrency(pending, 3, async (segment) => {
      const sourcePath = params.sourcePaths[segment.sourceId];
      if (!sourcePath) throw new Error(`找不到画面分析源：${segment.sourceId}`);
      const framePath = path.join(tempRoot, `${randomUUID()}.jpg`);
      const midpoint = segment.startSeconds + (segment.endSeconds - segment.startSeconds) * 0.52;
      await runProcess("ffmpeg", [
        "-y", "-ss", midpoint.toFixed(3), "-i", sourcePath, "-frames:v", "1",
        "-vf", "scale=480:-2", "-q:v", "5", framePath
      ], 45_000);
      return { segment, dataUrl: `data:image/jpeg;base64,${(await readFile(framePath)).toString("base64")}` };
    });
    const batches: Array<Array<{ segment: VisualCandidate; dataUrl: string }>> = [];
    const evidenceFrames = frames.filter((item) => requiresBlindOcr(item.segment));
    const otherFrames = frames.filter((item) => !requiresBlindOcr(item.segment));
    for (const group of [evidenceFrames, otherFrames]) {
      for (let index = 0; index < group.length; index += 3) batches.push(group.slice(index, index + 3));
    }
    const batchResults = await mapWithConcurrency(batches, 2, analyzeBatch);
    for (const result of batchResults) {
      for (const item of result) analyses.set(item.segmentId, item);
    }
    for (const segment of pending) {
      if (analyses.has(segment.segmentId)) continue;
      analyses.set(segment.segmentId, fallbackAnalysis(segment, "画面模型没有返回该片段"));
    }
    await Promise.all(pending.map(async (segment) => {
      const analysis = analyses.get(segment.segmentId);
      const cachePath = cachePaths.get(segment.segmentId);
      if (analysis && cachePath) await writeFile(cachePath, JSON.stringify(analysis), "utf8");
    }));
    return analyses;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function analyzeBatch(batch: Array<{ segment: VisualCandidate; dataUrl: string }>): Promise<ClipVisualAnalysis[]> {
  const apiKey = env.ALIYUN_API_KEY || env.DASHSCOPE_API_KEY;
  const baseUrl = env.ALIYUN_BASE_URL || env.DASHSCOPE_BASE_URL;
  if (!apiKey || !baseUrl) return batch.map((item) => fallbackAnalysis(item.segment, "画面识别服务未配置"));
  assertOutboundUrlAllowed("带货粗剪画面识别", baseUrl, { domesticNetworkOnly, allowedHosts: domesticOutboundAllowlist });
  const blindEvidenceOcr = batch.every((item) => requiresBlindOcr(item.segment));
  const content: Array<Record<string, unknown>> = [{
    type: "text",
    text: blindEvidenceOcr ? [
      "你是独立的商品证据OCR检查器。只根据下面图片本身读取事实；你不会收到口播内容，也不得猜测图片外的信息。",
      "逐张写出画面主体和真正可辨认的原文。模糊、遮挡或看不清时必须留空，尤其不得猜PICC、人保、保险、价格、赔偿和规格。",
      "matchScore只表示OCR文字清晰可辨程度，focusX/focusY使用0到1000坐标表示标签中心。",
      "只返回JSON：{\"segments\":[{\"segmentId\":\"\",\"summary\":\"\",\"ocrText\":\"\",\"matchScore\":0,\"focusX\":500,\"focusY\":500,\"reviewReason\":\"\"}]}"
    ].join("\n") : [
      "你是带货视频音画对齐质检器。下面每张图都来自对应口播时间段的中间帧。",
      "逐张检查：画面主体、可见商品、OCR文字、口播内容是否被画面支持、应该聚焦的位置。",
      "严禁因为口播提到PICC/价格/规格就假设画面里也有；只有真正看见才算匹配。",
      "focusX/focusY使用0到1000坐标，表示最应该保留在特写中心的画面位置。",
      "只返回JSON：{\"segments\":[{\"segmentId\":\"\",\"summary\":\"\",\"ocrText\":\"\",\"matchScore\":0,\"focusX\":500,\"focusY\":500,\"reviewReason\":\"\"}]}"
    ].join("\n")
  }];
  for (const [index, item] of batch.entries()) {
    content.push({
      type: "text",
      text: blindEvidenceOcr
        ? `图片${index + 1}；segmentId=${item.segment.segmentId}`
        : `图片${index + 1}；segmentId=${item.segment.segmentId}；阶段=${item.segment.role}；同期口播=${item.segment.transcript}`
    });
    content.push({ type: "image_url", image_url: { url: item.dataUrl } });
  }
  try {
    const response = await fetch(buildChatCompletionsUrl(baseUrl), {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.ALIYUN_VIDEO_MODEL,
        messages: [{ role: "user", content }],
        temperature: 0.05
      })
    });
    if (!response.ok) throw new Error(`画面识别失败：${response.status} ${(await response.text()).slice(0, 160)}`);
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = parseJson(json.choices?.[0]?.message?.content ?? "") as { segments?: Array<Record<string, unknown>> };
    const byId = new Map(batch.map((item) => [item.segment.segmentId, item.segment]));
    return (parsed.segments ?? []).flatMap((raw) => {
      const segmentId = stringValue(raw.segmentId);
      const segment = byId.get(segmentId);
      if (!segment) return [];
      const ocrText = stringValue(raw.ocrText);
      const summary = stringValue(raw.summary);
      const rawScore = Number(raw.matchScore) || 0;
      const modelScore = clamp(rawScore > 0 && rawScore <= 1 ? rawScore * 100 : rawScore, 0, 100);
      const deterministic = verifyEvidenceTerms(segment.transcript, blindEvidenceOcr ? ocrText : `${ocrText}\n${summary}`);
      const matched = deterministic === false ? false : modelScore >= (requiresBlindOcr(segment) ? 62 : 42);
      return [{
        segmentId,
        summary: summary.slice(0, 120),
        ocrText: ocrText.slice(0, 160),
        matchScore: matched ? modelScore : Math.min(modelScore, 45),
        matched,
        focusX: clamp(Number(raw.focusX) || 500, 80, 920),
        focusY: clamp(Number(raw.focusY) || 500, 80, 920),
        reviewReason: matched ? stringValue(raw.reviewReason).slice(0, 100) : buildMismatchReason(segment, stringValue(raw.reviewReason))
      }];
    });
  } catch (error) {
    const message = describeError(error);
    return batch.map((item) => fallbackAnalysis(item.segment, message));
  }
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "画面识别失败";
  const cause = error.cause as { code?: string; message?: string } | undefined;
  return `${error.message}${cause?.code ? ` (${cause.code})` : ""}${cause?.message ? ` ${cause.message}` : ""}`.slice(0, 180);
}

function verifyEvidenceTerms(transcript: string, visualText: string): boolean | undefined {
  const normalized = visualText.toLowerCase();
  if (/PICC|人保|人民保险|保险/i.test(transcript)) return /picc|人保|人民保险|保险/i.test(normalized);
  if (/赔偿|赔付/i.test(transcript)) {
    const amounts = transcript.match(/\d+(?:\.\d+)?|两万|二万/g) ?? [];
    return /赔偿|赔付|赔您|赔/i.test(normalized) && (amounts.length === 0 || amounts.some((amount) => normalized.includes(amount)));
  }
  const specification = transcript.match(/(\d+(?:\.\d+)?\s*(?:升|斤|元|块)|五升|九斤|六十九)/g);
  if (specification?.length) {
    const numericTokens = specification.join("").match(/\d+(?:\.\d+)?|五|九|六十九/g) ?? [];
    if (numericTokens.length > 0 && /规格|净含量|价格|标签|证据/.test(transcript)) {
      return numericTokens.some((token) => normalized.includes(token.toLowerCase()));
    }
  }
  return undefined;
}

function requiresBlindOcr(segment: VisualCandidate): boolean {
  return segment.role === "evidence" || /PICC|人保|人民保险|保险|赔偿|赔付|认证|证书|标签/i.test(segment.transcript);
}

function buildMismatchReason(segment: VisualCandidate, modelReason: string): string {
  if (/PICC|人保|人民保险|保险/i.test(segment.transcript)) return "口播提到保险，但同期画面未确认出现PICC/人保文字，需要匹配证据画面";
  return modelReason.slice(0, 100) || "同期画面不足以直接支持这句口播，需要人工检查或补充画面";
}

function fallbackAnalysis(segment: VisualCandidate, reason: string): ClipVisualAnalysis {
  return {
    segmentId: segment.segmentId,
    summary: "待人工查看同期画面",
    ocrText: "",
    matchScore: 0,
    matched: false,
    focusX: 500,
    focusY: 500,
    reviewReason: reason.slice(0, 100)
  };
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

function parseJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("画面识别返回格式错误");
  return JSON.parse(raw.slice(start, end + 1));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

function runProcess(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("提取质检画面超时")); }, timeoutMs);
    child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-4000); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`提取质检画面失败（${code}）：${stderr.slice(-400)}`));
    });
  });
}
