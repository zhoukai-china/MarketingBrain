import { apiPath } from "./api.js";

export type KnowledgeSyncStatus = "queued" | "running" | "succeeded" | "failed" | "interrupted";

export interface KnowledgeSyncView {
  id: string;
  connectionId: string;
  status: KnowledgeSyncStatus;
  stage: string;
  retryable: boolean;
  scanned: number;
  processed: number;
  total: number | null;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  analyzed?: number;
  analyzedFailed?: number;
  analyzedReused?: number;
  assignedToSubject: number;
  importedByType: { transcripts: number; notes: number; webPages: number };
  message?: string | null;
  lastSuccessfulAt?: string | null;
  completedAt?: string | null;
}

type SyncPayload = { sync: KnowledgeSyncView; reused?: boolean };

async function readSync(response: Response): Promise<SyncPayload> {
  const payload = await response.json().catch(() => ({})) as Partial<SyncPayload> & { error?: string; message?: string };
  if (!response.ok) throw new Error(payload.message ?? payload.error ?? "同步请求失败");
  if (!payload.sync) throw new Error("同步任务状态缺失");
  return payload as SyncPayload;
}

export async function startKnowledgeSync(
  connectionId: string,
  headers: Record<string, string>,
  options: { subjectId?: string } = {}
): Promise<SyncPayload> {
  const clientStartedAt = Date.now();
  const clientRequestId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `sync-${clientStartedAt}-${Math.random().toString(16).slice(2)}`;
  return fetch(apiPath(`/knowledge-base/connections/${connectionId}/sync`), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ ...options, clientStartedAt, clientRequestId })
  }).then(readSync);
}

export async function latestKnowledgeSync(connectionId: string, headers: Record<string, string>): Promise<KnowledgeSyncView | null> {
  const response = await fetch(apiPath(`/knowledge-base/connections/${connectionId}/sync`), { headers });
  if (response.status === 404) return null;
  return (await readSync(response)).sync;
}

export async function pollKnowledgeSync(
  initial: KnowledgeSyncView,
  headers: Record<string, string>,
  onProgress: (sync: KnowledgeSyncView) => void,
  options: { signal?: AbortSignal; pollMs?: number; maxWaitMs?: number } = {}
): Promise<KnowledgeSyncView> {
  let current = initial;
  const startedAt = Date.now();
  onProgress(current);
  while (current.status === "queued" || current.status === "running") {
    if (Date.now() - startedAt > (options.maxWaitMs ?? 600_000)) {
      throw new Error("同步状态等待超时；任务仍保留，可刷新页面恢复查看。请勿重复创建并发任务。");
    }
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(resolve, options.pollMs ?? 800);
      options.signal?.addEventListener("abort", () => { window.clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
    });
    current = (await fetch(apiPath(`/knowledge-base/sync-jobs/${current.id}`), { headers, signal: options.signal }).then(readSync)).sync;
    onProgress(current);
  }
  return current;
}

export async function runKnowledgeSync(
  connectionId: string,
  headers: Record<string, string>,
  onProgress: (sync: KnowledgeSyncView) => void,
  options: { subjectId?: string; signal?: AbortSignal } = {}
): Promise<KnowledgeSyncView> {
  const accepted = await startKnowledgeSync(connectionId, headers, { subjectId: options.subjectId });
  return pollKnowledgeSync(accepted.sync, headers, onProgress, { signal: options.signal });
}

export async function resumeKnowledgeSync(
  connectionId: string,
  headers: Record<string, string>,
  onProgress: (sync: KnowledgeSyncView) => void,
  signal?: AbortSignal
): Promise<KnowledgeSyncView | null> {
  const latest = await latestKnowledgeSync(connectionId, headers);
  if (!latest) return null;
  if (latest.status !== "queued" && latest.status !== "running") {
    onProgress(latest);
    return latest;
  }
  return pollKnowledgeSync(latest, headers, onProgress, { signal });
}

export function knowledgeSyncProgressText(sync: KnowledgeSyncView): string {
  const labels: Record<string, string> = {
    queued: "已入队，正在准备",
    listing: "正在读取资料列表",
    details: "正在读取资料详情",
    throttling: "正在读取资料详情",
    backoff: "正在读取资料详情",
    parsing: "正在校验资料格式",
    persisting: "正在保存有变化的资料",
    binding: "正在确认资料归属",
    analyzing: "正在整理笔记要点（核心观点 / 金句 / 客户原话）",
    completed: "同步完成",
    partial_failure: "部分资料同步失败",
    interrupted: "同步进程已中断",
    failed: "同步失败"
  };
  // 进度只给客户看「阶段 + 几/几条」这类必要信息；内部「重试 N 次 / 退避 X 秒」属于运维细节，
  // 只在服务端日志里记录，不污染客户界面（避免客户看到一堆退避秒数以为系统坏了）。
  const progress = sync.total ? ` ${Math.min(sync.processed, sync.total)}/${sync.total}` : sync.scanned ? ` 已扫描 ${sync.scanned}` : "";
  return `${labels[sync.stage] ?? "同步处理中"}${progress}`;
}

export function knowledgeSyncResultText(sync: KnowledgeSyncView): string {
  if (sync.status !== "succeeded") return sync.message ?? `${knowledgeSyncProgressText(sync)}；${sync.retryable ? "可以安全重试。" : "请重新检查授权后再试。"}`;
  const analyzed = sync.analyzed ?? 0;
  const reused = sync.analyzedReused ?? 0;
  // 口径统一：主数字一律用「有效笔记」= 新增 + 更新 + 无变化（与预检徽标「近 30 天 X 条：已同步 X」同一数字）。
  // 「扫描」原始数（含空录音/窗口外）与库内历史总量不再作为主数字展示，避免同屏出现 70/88/99 三个对不上的数。
  const valid = (sync.created ?? 0) + (sync.updated ?? 0) + (sync.unchanged ?? 0);
  const syncPart = `同步完成：本次有效笔记 ${valid} 条（新增 ${sync.created ?? 0} · 更新 ${sync.updated ?? 0} · 无变化 ${sync.unchanged ?? 0}），另跳过 ${sync.skipped ?? 0} 条空录音或超出 30 天窗口的笔记`;
  // getnote 同步全程 0 次 LLM：核心观点/金句来自得到大脑免费智能总结，落库时已写入 metadata.analysis。
  const insightPart = analyzed > 0
    ? `，本轮新提取 ${analyzed} 篇、沿用 ${reused} 篇，合计 ${analyzed + reused} 篇洞察可用于选题${sync.analyzedFailed ? `（${sync.analyzedFailed} 篇提取失败）` : ""}`
    : `，全程未调用大模型；选题可用洞察合计 ${reused} 条${reused > valid ? `（含历史已同步笔记 ${reused - valid} 条）` : ""}`;
  return `${syncPart}${insightPart}。`;
}
