/**
 * LQ-27 运营脚本：在**真实环境**跑一条爆款复刻样片（一次一批，用户已授权上限 ¥10）。
 *
 * 设计要点（与 `beauty-video-execution-permit.ts` 的契约逐条对齐）：
 *   · 许可必须由运维侧离线签发 —— 没有任何 HTTP 接口能创建许可；这里就是那个"人签一批"的动作。
 *   · 许可 scope 的字段顺序必须与 `videoExecutionScopeSchema` 一致，签名才对得上，
 *     所以本脚本先用同一套 zod schema `parse`，再对 `JSON.stringify(parsed)` 做 HMAC。
 *   · 素材（原视频 / 人像 / 授权依据）走真实上传与授权声明接口；暂存由报价环节真实完成（会真的 PUT 到 OSS）。
 *   · 全程用**合成租户 + 仓库自带合成素材**，不碰任何客户数据；跑完清掉许可与租约，保留租户与任务作审计。
 *
 * 用法（服务器上）：
 *   set -a; . /etc/baolu-secrets/baolu-os-v2.env; set +a
 *   node apps/api/node_modules/tsx/dist/cli.mjs scripts/lanqi-replication-sample.ts [原视频] [人像] [输出mp4]
 */
import { createHash, createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "../packages/db/node_modules/@prisma/client/index.js";
import { createSessionToken } from "../apps/api/src/services/auth-token.js";
import {
  REPLICATION_CONTRACT,
  REPLICATION_MODEL,
  replicationSchema
} from "../apps/api/src/services/viral-video-replication.js";
import {
  VIDEO_EXECUTION_VERSION,
  VIDEO_PRICE_VERSION,
  videoExecutionRequestHash,
  videoExecutionScopeSchema
} from "../apps/api/src/services/beauty-video-execution-permit.js";

const API = (process.env.LQ27_API ?? "http://127.0.0.1:3002").replace(/\/+$/, "");
const AUTHORITY_KEY = process.env.BEAUTY_VIDEO_EXECUTION_AUTHORITY_KEY ?? "";
const PAYLOAD_KEY = process.env.ALIYUN_VIDEO_REPLICATION_API_KEY ?? "";
const REFERENCE_PATH = process.argv[2] ?? "scripts/fixtures/beauty-video-content.mp4";
const PORTRAIT_PATH = process.argv[3] ?? "scripts/tmp/lq23-synthetic-portrait.png";
const stamp = Date.now().toString(36);
const OUT_PATH = process.argv[4] ?? `/tmp/lq27-sample-${stamp}.mp4`;
const prisma = new PrismaClient();

const tenantId = `lq27sample${stamp}`;
const userId = `lq27user${stamp}`;
const storeId = `lq27store${stamp}`;
const requestKey = `lq27-sample-${stamp}-batch`;
const permitId = `lq27permit${stamp}`;
const MAX_COST_FEN = 1000;

function sha256(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

function log(step: string, detail: unknown = "") {
  console.log(`[STEP] ${step}${detail === "" ? "" : ` :: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}

async function api<T = any>(path: string, options: { method?: string; token?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${API}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined)
  });
  const text = await response.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* 非 JSON */
  }
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path} -> ${response.status} :: ${text.slice(0, 300)}`);
  return data as T;
}

async function upload(token: string, filePath: string, mimeType: string): Promise<string> {
  const buffer = readFileSync(filePath);
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType }), filePath.split(/[\\/]/).pop() ?? "material");
  const data = await api<{ file?: { id?: string } }>("/files", { method: "POST", token, form });
  if (!data?.file?.id) throw new Error(`上传失败：${filePath}`);
  return data.file.id;
}

async function declare(token: string, fileId: string, basisFileId: string, subjectRole: "reference" | "owner", expiresAt: string, key: string) {
  return await api("/viral-video-replication/material-authorizations", {
    method: "POST",
    token,
    body: { fileId, basisFileId, subjectRole, purpose: "video_replacement", expiresAt, requestKey: key, rightsDeclared: true }
  });
}

async function main() {
  if (!AUTHORITY_KEY || AUTHORITY_KEY.length < 32) throw new Error("BEAUTY_VIDEO_EXECUTION_AUTHORITY_KEY 未配置或过短");
  if (!PAYLOAD_KEY) throw new Error("ALIYUN_VIDEO_REPLICATION_API_KEY 未配置");

  // ── ① 合成租户（不碰客户数据） ──
  const tenant = await prisma.tenant.create({ data: { id: tenantId, name: `LQ27 合成样片租户 ${stamp}`, type: "local_business", industry: "美业" } });
  await prisma.store.create({ data: { id: storeId, tenantId, name: "LQ27 合成样片门店" } });
  await prisma.user.create({ data: { id: userId, nickname: `lq27-${stamp}` } });
  await prisma.membership.create({ data: { tenantId, userId, storeId, role: "owner", isActive: true } });
  await prisma.tenantProductEntitlement.create({ data: { tenantId, productCode: "beauty-industry", status: "active", source: "lq27_sample_run" } });
  await prisma.creditAccount.create({ data: { tenantId, balance: 2000 } });
  log("合成租户已建", { tenantId, storeId, userId });
  const token = createSessionToken({ tenantId, userId, ttlSeconds: 3600 });

  // ── ② 上传素材：原视频 / 人像 / 授权依据（依据用同一张合成图再传一次，fileId 不同） ──
  const referenceFileId = await upload(token, REFERENCE_PATH, "video/mp4");
  const portraitFileId = await upload(token, PORTRAIT_PATH, "image/png");
  // 授权依据文件必须是 PDF 或纯文本（见 beauty-video-private-files.ts 的 basis 校验），
  // 这里用一份写明"合成样本、非真实客户资料"的 txt。
  const basisFileId = await upload(token, "scripts/lq27-basis.txt", "text/plain");
  log("素材已上传", { referenceFileId, portraitFileId, basisFileId });

  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await declare(token, referenceFileId, basisFileId, "reference", expiresAt, `lq27-decl-ref-${stamp}`);
  await declare(token, portraitFileId, basisFileId, "owner", expiresAt, `lq27-decl-pt-${stamp}`);
  log("素材授权声明已记录");

  // ── ③ 先按素材授权签这一批许可（人签一批、只跑一次）──
  // 关键顺序：**许可必须在报价之前签好** —— 报价阶段就会走准入校验（claim 会要许可），
  // 所以"先报价看 gaps 再签许可"这条路是不通的（会直接 422 execution_permit_required）。
  const parsed = replicationSchema.parse({
    referenceFileId,
    portraitFileId,
    requestKey,
    model: "aliyun_strict",
    template: "owner_promo",
    mode: "wan-std",
    style: "preserve_original",
    environmentFileIds: [],
    subtitles: false,
    visualRightsConfirmed: true,
    audioRightsConfirmed: true,
    performerConsentConfirmed: true,
    portraitConsentConfirmed: true
  });
  const requestHash = videoExecutionRequestHash(parsed);
  const refAuth = await prisma.beautyVideoAssetAuthorization.findUnique({ where: { fileId: referenceFileId } });
  const ptAuth = await prisma.beautyVideoAssetAuthorization.findUnique({ where: { fileId: portraitFileId } });
  if (!refAuth || !ptAuth) throw new Error("素材授权记录缺失，无法签许可");
  // 存储成本证据 = 两份素材授权的不可变指纹（真实记录，不是编造值）；成本上限按一次 PUT 的极小额取 1 分。
  const storageCostEvidenceHash = sha256(
    JSON.stringify([
      { id: refAuth.id, fileId: refAuth.fileId, sha256: refAuth.fileSha256, version: refAuth.version },
      { id: ptAuth.id, fileId: ptAuth.fileId, sha256: ptAuth.fileSha256, version: ptAuth.version }
    ])
  );
  const scope = videoExecutionScopeSchema.parse({
    version: VIDEO_EXECUTION_VERSION,
    contract: REPLICATION_CONTRACT,
    permitId,
    tenantId,
    userId,
    storeId,
    requestKey,
    purpose: "video_replacement",
    provider: "aliyun_bailian",
    model: REPLICATION_MODEL,
    region: "cn-beijing",
    access: "provider_https",
    mode: parsed.mode,
    template: parsed.template,
    requestHash,
    reference: { fileId: refAuth.fileId, sha256: refAuth.fileSha256, evidenceId: refAuth.id, version: refAuth.version, role: refAuth.subjectRole },
    portrait: { fileId: ptAuth.fileId, sha256: ptAuth.fileSha256, evidenceId: ptAuth.id, version: ptAuth.version, role: ptAuth.subjectRole },
    priceVersion: VIDEO_PRICE_VERSION,
    // 预算公式（permit 自检）：maxCostFen ≥ maxOutputSeconds × 60（wan-std） + storageCostUpperFen。
    // 用户授权上限 ¥10 = 1000 分 → 输出上限取 16 秒（16×60+1=961 ≤ 1000），不越权加预算。
    maxOutputSeconds: 16,
    maxSubmit: 1,
    maxPoll: 120,
    maxStorageHttp: 40,
    maxDownload: 1,
    maxCostFen: MAX_COST_FEN,
    storageCostUpperFen: 1,
    storageCostEvidenceHash,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 2 * 3600 * 1000
  });
  const signature = createHmac("sha256", AUTHORITY_KEY).update(JSON.stringify(scope)).digest("hex");
  await prisma.beautyVideoExecutionPermit.create({
    data: { id: permitId, tenantId, userId, storeId, requestKey, scope: scope as object, signature, status: "approved" }
  });
  log("单批许可已签发", { permitId, maxCostFen: MAX_COST_FEN, storageCostUpperFen: 1 });

  // ── ④ 报价（这一步会真实完成安全暂存，并在库里留下暂存租约） ──
  const quote = await api<{ canConfirm?: boolean; creditCost?: number; gaps?: string[]; message?: string }>("/viral-video-replication/quote", {
    method: "POST",
    token,
    body: parsed
  });
  log("报价结果", { canConfirm: quote.canConfirm === true, creditCost: quote.creditCost ?? null, gaps: quote.gaps ?? [] });
  const lease = await prisma.beautyVideoStagingLease.findUnique({ where: { tenantId_requestHash: { tenantId, requestHash } } });

  // ── ⑤ 确认出片（真实调用付费接口，一次不重试；失败即止） ──
  const confirmed = await api<{ job?: { id?: string; status?: string } }>("/viral-video-replication/confirm", { method: "POST", token, body: parsed });
  const jobId = confirmed?.job?.id;
  if (!jobId) throw new Error("任务未创建成功");
  log("任务已创建", { jobId, status: confirmed.job?.status });

  // ── ⑥ 轮询 ──
  let finalStatus = "unknown";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 6000));
    const list = await api<{ jobs?: { id?: string; status?: string }[] }>("/viral-video-replication/jobs", { token });
    const found = (list.jobs ?? []).find(item => item.id === jobId);
    finalStatus = String(found?.status ?? "unknown");
    log(`轮询 ${attempt + 1}`, finalStatus);
    if (["succeeded", "failed", "cancelled"].includes(finalStatus)) break;
  }

  // ── ⑦ 取成片 ──
  if (finalStatus === "succeeded") {
    const response = await fetch(`${API}/viral-video-replication/jobs/${jobId}/content`, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`成片读取失败 ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(OUT_PATH, buffer);
    log("成片已保存", { path: OUT_PATH, bytes: buffer.length, sha256: sha256(buffer) });
  } else {
    log("任务未成功", finalStatus);
  }

  // ── ⑧ 清理付费侧痕迹（保留租户与任务作审计） ──
  await prisma.beautyVideoExecutionPermit.deleteMany({ where: { id: permitId } });
  if (lease) await prisma.beautyVideoStagingLease.deleteMany({ where: { id: lease.id } });
  await prisma.beautyVideoAssetAuthorization.deleteMany({ where: { tenantId } });
  log("清理完成", { deletedPermit: permitId, deletedLease: lease?.id ?? null, keptTenant: tenantId });
  console.log(`\nRESULT ${JSON.stringify({ tenantId, jobId, finalStatus, out: finalStatus === "succeeded" ? OUT_PATH : null })}`);
  void tenant;
}

main()
  .catch(error => {
    console.error(`\nFAILED :: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
