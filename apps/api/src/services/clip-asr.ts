import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { env, domesticNetworkOnly, domesticOutboundAllowlist } from "../config/env.js";
import { assertOutboundUrlAllowed } from "./outbound-policy.js";

export interface PreciseTranscriptSegment {
  segmentId: string;
  sourceId: string;
  startSeconds: number;
  endSeconds: number;
  transcript: string;
  words: Array<{ startSeconds: number; endSeconds: number; text: string }>;
}

interface UploadPolicy {
  policy: string;
  signature: string;
  upload_dir: string;
  upload_host: string;
  oss_access_key_id: string;
  x_oss_object_acl: string;
  x_oss_forbid_overwrite: string;
}

interface FileTransResult {
  transcripts?: Array<{
    sentences?: Array<{
      sentence_id?: number;
      begin_time?: number;
      end_time?: number;
      text?: string;
      words?: Array<{ begin_time?: number; end_time?: number; text?: string; punctuation?: string }>;
    }>;
  }>;
}

export async function transcribeSourceWithWordTimestamps(params: {
  sourceId: string;
  sourcePath: string;
  durationSeconds: number;
  contextText: string;
  domain?: "commerce" | "persona";
}): Promise<PreciseTranscriptSegment[]> {
  const apiKey = env.DASHSCOPE_API_KEY || env.ALIYUN_API_KEY;
  if (!apiKey) throw new Error("精确语音识别未配置百炼 API Key");
  const model = env.ALIYUN_ASR_FILETRANS_MODEL;
  const apiBase = resolveDashScopeApiBase(env.DASHSCOPE_BASE_URL || env.ALIYUN_BASE_URL);
  assertAllowed("精确语音识别", apiBase);
  const tempRoot = await mkdtemp(path.join(tmpdir(), "sitong-filetrans-"));
  const audioPath = path.join(tempRoot, `${randomUUID()}.mp3`);
  try {
    await runProcess("ffmpeg", [
      "-y", "-i", params.sourcePath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", audioPath
    ], Math.max(3 * 60_000, Math.min(30 * 60_000, params.durationSeconds * 260)));
    const ossUrl = await uploadTemporaryFile({ apiKey, model, filePath: audioPath });
    const taskId = await submitFileTranscription({
      apiKey,
      apiBase,
      model,
      ossUrl,
      contextText: buildAsrContext(params.contextText, params.domain ?? "commerce")
    });
    const transcriptionUrl = await waitForTranscription({
      apiKey, apiBase, taskId,
      timeoutMs: Math.max(8 * 60_000, Math.min(40 * 60_000, params.durationSeconds * 350))
    });
    assertAllowed("语音识别结果", transcriptionUrl);
    const resultResponse = await fetch(transcriptionUrl);
    if (!resultResponse.ok) throw new Error(`下载语音识别结果失败：${resultResponse.status}`);
    const result = await resultResponse.json() as FileTransResult;
    const sentences = result.transcripts?.flatMap((item) => item.sentences ?? []) ?? [];
    const precise = sentences.flatMap((sentence, index) => {
      const text = sentence.text?.trim() ?? "";
      const startSeconds = Math.max(0, (Number(sentence.begin_time) || 0) / 1000 - 0.08);
      const endSeconds = Math.min(params.durationSeconds, (Number(sentence.end_time) || 0) / 1000 + 0.12);
      const base = {
        segmentId: `${params.sourceId}:exact:${sentence.sentence_id ?? index}`,
        sourceId: params.sourceId,
        startSeconds: round(startSeconds),
        endSeconds: round(endSeconds),
        transcript: text,
        words: (sentence.words ?? []).map((word) => ({
          startSeconds: round((Number(word.begin_time) || 0) / 1000),
          endSeconds: round((Number(word.end_time) || 0) / 1000),
          text: `${word.text ?? ""}${word.punctuation ?? ""}`
        })).filter((word) => word.text)
      };
      return splitLongSentence(base);
    }).filter((segment) => segment.transcript.length >= 4 && segment.endSeconds - segment.startSeconds >= 0.45);
    if (precise.length === 0) throw new Error("精确语音识别没有返回可剪辑句子");
    return precise;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function splitLongSentence(segment: PreciseTranscriptSegment): PreciseTranscriptSegment[] {
  const punctuationBreaks = segment.words.filter((word) => /[，。！？；,.!?;]$/.test(word.text)).length;
  if ((segment.endSeconds - segment.startSeconds <= 4.2 && punctuationBreaks < 2) || segment.words.length < 6) return [segment];
  const groups: typeof segment.words[] = [];
  let current: typeof segment.words = [];
  for (const word of segment.words) {
    current.push(word);
    const duration = current[current.length - 1].endSeconds - current[0].startSeconds;
    const naturalBreak = /[，。！？；,.!?;]$/.test(word.text);
    if ((duration >= 2.2 && naturalBreak) || duration >= 6.8) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    if (groups.length > 0 && current[current.length - 1].endSeconds - current[0].startSeconds < 1.2) groups[groups.length - 1].push(...current);
    else groups.push(current);
  }
  return groups.map((words, index) => ({
    segmentId: `${segment.segmentId}:${index}`,
    sourceId: segment.sourceId,
    startSeconds: round(Math.max(0, words[0].startSeconds - 0.06)),
    endSeconds: round(words[words.length - 1].endSeconds + 0.1),
    transcript: words.map((word) => word.text).join("").trim(),
    words
  }));
}

async function uploadTemporaryFile(params: { apiKey: string; model: string; filePath: string }): Promise<string> {
  const policyUrl = new URL("https://dashscope.aliyuncs.com/api/v1/uploads");
  policyUrl.searchParams.set("action", "getPolicy");
  policyUrl.searchParams.set("model", params.model);
  assertAllowed("百炼临时文件上传", policyUrl.toString());
  const policyResponse = await fetch(policyUrl, {
    headers: { Authorization: `Bearer ${params.apiKey}`, "Content-Type": "application/json" }
  });
  if (!policyResponse.ok) throw new Error(`获取语音文件上传凭证失败：${policyResponse.status} ${(await policyResponse.text()).slice(0, 160)}`);
  const policyJson = await policyResponse.json() as { data?: UploadPolicy };
  const policy = policyJson.data;
  if (!policy?.upload_host || !policy.upload_dir) throw new Error("语音文件上传凭证不完整");
  assertAllowed("百炼临时文件上传地址", policy.upload_host);
  const filename = `${randomUUID()}.mp3`;
  const objectKey = `${policy.upload_dir}/${filename}`;
  const form = new FormData();
  form.append("OSSAccessKeyId", policy.oss_access_key_id);
  form.append("Signature", policy.signature);
  form.append("policy", policy.policy);
  form.append("x-oss-object-acl", policy.x_oss_object_acl);
  form.append("x-oss-forbid-overwrite", policy.x_oss_forbid_overwrite);
  form.append("key", objectKey);
  form.append("success_action_status", "200");
  form.append("file", new Blob([await readFile(params.filePath)], { type: "audio/mpeg" }), filename);
  const uploadResponse = await fetch(policy.upload_host, { method: "POST", body: form });
  if (!uploadResponse.ok) throw new Error(`上传语音文件失败：${uploadResponse.status} ${(await uploadResponse.text()).slice(0, 160)}`);
  return `oss://${objectKey}`;
}

async function submitFileTranscription(params: {
  apiKey: string;
  apiBase: string;
  model: string;
  ossUrl: string;
  contextText: string;
}): Promise<string> {
  const url = `${params.apiBase}/services/audio/asr/transcription`;
  assertAllowed("提交精确语音识别", url);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "enable",
      "X-DashScope-OssResourceResolve": "enable"
    },
    body: JSON.stringify({
      model: params.model,
      input: { file_url: params.ossUrl },
      parameters: {
        channel_id: [0],
        language: "zh",
        enable_itn: true,
        enable_words: true,
        corpus: { text: params.contextText }
      }
    })
  });
  if (!response.ok) throw new Error(`提交精确语音识别失败：${response.status} ${(await response.text()).slice(0, 200)}`);
  const json = await response.json() as { output?: { task_id?: string } };
  if (!json.output?.task_id) throw new Error("精确语音识别没有返回任务编号");
  return json.output.task_id;
}

async function waitForTranscription(params: { apiKey: string; apiBase: string; taskId: string; timeoutMs: number }): Promise<string> {
  const url = `${params.apiBase}/tasks/${encodeURIComponent(params.taskId)}`;
  assertAllowed("查询精确语音识别", url);
  const deadline = Date.now() + params.timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${params.apiKey}`, "Content-Type": "application/json" } });
    if (!response.ok) throw new Error(`查询精确语音识别失败：${response.status}`);
    const json = await response.json() as {
      output?: { task_status?: string; result?: { transcription_url?: string }; code?: string; message?: string };
    };
    const status = json.output?.task_status;
    if (status === "SUCCEEDED" && json.output?.result?.transcription_url) return json.output.result.transcription_url;
    if (status === "FAILED" || status === "UNKNOWN") {
      throw new Error(`精确语音识别失败：${json.output?.code ?? status} ${json.output?.message ?? ""}`.trim());
    }
    await delay(1800);
  }
  throw new Error("精确语音识别超时");
}

function buildAsrContext(contextText: string, domain: "commerce" | "persona"): string {
  const domainGuide = domain === "persona"
    ? "这是中文人物口述、直播或访谈。重点准确识别人名、地名、时间、人物关系、事件因果、观点转折、情绪表达和完整结论。不要把不同故事中的同音词强行改成商品词。"
    : "这是中文带货直播口播。重点准确识别商品名、品牌名、主播名、价格、规格、数量、保险、赔付和行动指令。常用词：PICC、中国人民保险、人保、笨榨大豆油、净含量、五升、九斤、六十九块九、秒回秒退。";
  return [domainGuide, contextText.trim()].filter(Boolean).join("\n").slice(0, 8000);
}

function resolveDashScopeApiBase(baseUrl?: string): string {
  const raw = (baseUrl || "https://dashscope.aliyuncs.com/api/v1").replace(/\/$/, "");
  if (raw.endsWith("/compatible-mode/v1")) return raw.replace(/\/compatible-mode\/v1$/, "/api/v1");
  if (raw.endsWith("/api/v1")) return raw;
  return `${raw}/api/v1`;
}

function assertAllowed(serviceName: string, url: string): void {
  assertOutboundUrlAllowed(serviceName, url, { domesticNetworkOnly, allowedHosts: domesticOutboundAllowlist });
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runProcess(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("提取语音文件超时"));
    }, timeoutMs);
    child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-6000); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`提取语音文件失败（${code}）：${stderr.slice(-500)}`));
    });
  });
}
