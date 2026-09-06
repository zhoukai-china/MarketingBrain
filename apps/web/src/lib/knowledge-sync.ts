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
  assignedToSubject: number;
  retryCount: number;
  throttleMs: number;
  backoffMs: number;
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
    throttling: "正在遵守 Get笔记读取频率限制",
    backoff: "外部服务限流或暂时不可用，正在退避等待",
    parsing: "正在校验资料格式",
    persisting: "正在保存有变化的资料",
    binding: "正在确认资料归属",
    completed: "同步完成",
    partial_failure: "部分资料同步失败",
    interrupted: "同步进程已中断",
    failed: "同步失败"
  };
  const progress = sync.total ? ` ${Math.min(sync.processed, sync.total)}/${sync.total}` : sync.scanned ? ` 已扫描 ${sync.scanned}` : "";
  const retry = sync.retryCount ? `，已重试 ${sync.retryCount} 次${sync.backoffMs ? `（退避 ${Math.round(sync.backoffMs / 100) / 10} 秒）` : ""}` : "";
  return `${labels[sync.stage] ?? "同步处理中"}${progress}${retry}`;
}

export function knowledgeSyncResultText(sync: KnowledgeSyncView): string {
  if (sync.status !== "succeeded") return sync.message ?? `${knowledgeSyncProgressText(sync)}；${sync.retryable ? "可以安全重试。" : "请重新检查授权后再试。"}`;
  return `同步完成：扫描 ${sync.scanned} 条，新增 ${sync.created} 条，更新 ${sync.updated} 条，无变化 ${sync.unchanged} 条，跳过 ${sync.skipped} 条。`;
}
