/**
 * LQ-30 回归（先红后绿）：兰琪租户能不能真正走到「报价 → 确认出片」。
 *
 * 背景（QA-20260914-004）：出片链路三处硬编码 `beauty-industry` 权益，兰琪租户只带 `lanqi`
 * → 页面点「先报价，再出片」必然 403 `product_access_denied`；页面也从未提交素材授权声明；
 * 单批许可只能人工离线签，所以门店自助出片走不通。
 *
 * 本用例覆盖（全部离线：内存库 + 合成 OSS/供应商，不发真请求、不花钱）：
 *   1. 只有 lanqi 权益 → 报价 200 且 canConfirm=true（修复前：403）；
 *   2. 没有任何清单内权益 → 仍然 403 product_access_denied（失败关闭不回退）；
 *   3. operator 模式（默认）无许可 → 422 execution_permit_required（既有行为不回退）；
 *   4. auto 模式 → 自动签发绑定本次请求的许可，且同一 requestKey 重复报价不重复签发；
 *   5. 积分不足 → 报价缺口 insufficient_credits，且不建任务；
 *   6. 预算反推：¥10 上限下输出秒数封顶 16 秒（wan-std 60 分/秒），不越权加预算。
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import { createVideoAssetAuthorization } from "../apps/api/src/services/beauty-video-asset-authorization.ts";
import { createVideoPrivateFileReader } from "../apps/api/src/services/beauty-video-private-files.ts";
import { createControlledVideoIntegration } from "../apps/api/src/services/beauty-video-controlled-execution.ts";
import { registerViralVideoReplicationRoutes } from "../apps/api/src/routes/viral-video-replication.ts";
import { replicationSchema, REPLICATION_MODEL } from "../apps/api/src/services/viral-video-replication.ts";
import { replicationMemoryDb } from "./fixtures/replication-test-db.ts";
import { findVideoReplicationEntitlement } from "../apps/api/src/services/video-replication-entitlement.ts";

const hash = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const authority = "offline-synthetic-authority-lq30-not-real-credentials";
const MAX_COST_FEN = 1000;

let passed = 0;
const failed: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed += 1; console.log(`PASS  ${name}${detail ? ` :: ${detail}` : ""}`); }
  else { failed.push(name); console.log(`FAIL  ${name}${detail ? ` :: ${detail}` : ""}`); }
}

/** 与 BY50 同源的合成 OSS：PUT/HEAD/DELETE，不发外部请求。 */
function ossFixture() {
  const objects = new Map<string, { body: Buffer; headers: Record<string, string> }>();
  const transport = async (r: any) => {
    const u = new URL(r.url), q = u.search.replace(/=$/, "");
    const response = (status: number, body = "", headers: any = {}) => ({ status, body: Buffer.from(body), headers });
    if (q === "?bucketInfo") return response(200, '<BucketInfo><Bucket><Name>synthetic-lq30</Name><Location>oss-cn-beijing</Location><ExtranetEndpoint>oss-cn-beijing.aliyuncs.com</ExtranetEndpoint><StorageClass>Standard</StorageClass><AccessControlList><Grant>private</Grant></AccessControlList><BlockPublicAccess>true</BlockPublicAccess><CrossRegionReplication>Disabled</CrossRegionReplication></Bucket></BucketInfo>');
    if (q === "?versioning") return response(200, "<VersioningConfiguration/>");
    if (q === "?lifecycle") return response(200, '<LifecycleConfiguration><Rule><ID>fixture</ID><Prefix>beauty-industry/video-staging/v1/lq30/</Prefix><Status>Enabled</Status><Expiration><Days>1</Days></Expiration></Rule></LifecycleConfiguration>');
    if (r.method === "PUT") {
      const h = Object.fromEntries(Object.entries(r.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
      objects.set(u.pathname, { body: r.body, headers: { "x-oss-object-type": "Normal", "content-type": h["content-type"], "content-length": String(r.body.length), "x-oss-meta-sha256": h["x-oss-meta-sha256"], "x-oss-meta-binding": h["x-oss-meta-binding"] } });
      return response(200, "", { etag: createHash("md5").update(r.body).digest("hex") });
    }
    if (r.method === "HEAD") { const o = objects.get(u.pathname); return o ? response(200, "", o.headers) : response(404); }
    if (r.method === "DELETE") { objects.delete(u.pathname); return response(204); }
    throw new Error("unexpected_sdk_request");
  };
  return { transport };
}

type Scenario = {
  db: any; tenantId: string; userId: string; storeId: string;
  videoFileId: string; portraitFileId: string; app: any; permits: any;
  authorization: any; referenceBytes: Buffer; createFile(bytes: Buffer, mimeType: string): Promise<{ id: string }>;
};

async function scenario(options: {
  products: string[]; credits: number; permitMode?: "auto" | "operator"; declare?: boolean;
}): Promise<Scenario> {
  const db = replicationMemoryDb();
  const suffix = randomUUID();
  const tenantId = `lq30-${suffix}`, userId = `user-${suffix}`, storeId = `store-${suffix}`;
  const root = await mkdtemp(path.join(tmpdir(), "lq30-"));
  const upload = path.join(root, "uploads");
  await mkdir(upload, { recursive: true });
  await db.tenant.create({ data: { id: tenantId, name: "Synthetic Lanqi", type: "local_business" } });
  await db.user.create({ data: { id: userId, nickname: "Synthetic" } });
  await db.store.create({ data: { id: storeId, tenantId, name: "Synthetic" } });
  await db.membership.create({ data: { tenantId, userId, storeId, role: "owner", isActive: true } });
  for (const productCode of options.products) {
    await db.tenantProductEntitlement.create({ data: { tenantId, productCode, status: "active", source: "synthetic", startsAt: new Date(Date.now() - 1000), expiresAt: null } });
  }
  await db.creditAccount.create({ data: { tenantId, balance: options.credits } });
  const now = Date.now();
  const authorization = createVideoAssetAuthorization(db, createVideoPrivateFileReader(upload, path.join(root, "inspect")), () => now);
  // 合成素材：2 秒竖屏 mp4（ffmpeg 在 BY50 用例里已验证可用）。
  const videoPath = path.join(root, "synthetic.mp4");
  const { execFileSync } = await import("node:child_process");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=240x320:r=24", "-t", "2", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath], { timeout: 30000, windowsHide: true });
  const { readFile } = await import("node:fs/promises");
  const video = await readFile(videoPath);
  const canvas = await import("../apps/api/node_modules/@napi-rs/canvas/index.js");
  const c = canvas.createCanvas(240, 320);
  c.getContext("2d").fillRect(0, 0, 240, 320);
  const portrait = c.toBuffer("image/png");
  async function file(bytes: Buffer, mimeType: string) {
    const id = randomUUID();
    const dir = path.join(upload, tenantId);
    await mkdir(dir, { recursive: true });
    const storagePath = path.join(dir, id);
    await writeFile(storagePath, bytes, { flag: "wx" });
    return db.uploadedFile.create({ data: { id, tenantId, userId, filename: "synthetic", mimeType, byteSize: bytes.length, sha256: hash(bytes), storagePath } });
  }
  const reference = await file(video, "video/mp4");
  const photo = await file(portrait, "image/png");
  if (options.declare !== false) {
    const basis = await file(Buffer.from("Synthetic online declaration; not legal proof"), "text/plain");
    for (const [fileId, subjectRole] of [[reference.id, "reference"], [photo.id, "owner"]] as const) {
      await authorization.declare({ tenantId, userId }, { fileId, subjectRole, basisFileId: basis.id, purpose: "video_replacement", expiresAt: new Date(now + 3600_000).toISOString(), rightsDeclared: true, requestKey: `lq30-${fileId}` });
    }
  }
  const environment = {
    BEAUTY_VIDEO_EXECUTION_MODE: "controlled", BEAUTY_VIDEO_STAGING_DRIVER: "aliyun_oss",
    BEAUTY_VIDEO_EXECUTION_AUTHORITY_KEY: authority, BEAUTY_VIDEO_RESULT_HOSTS: "synthetic-output.oss-cn-beijing.aliyuncs.com",
    ALIYUN_VIDEO_REPLICATION_MODEL: REPLICATION_MODEL,
    ALIYUN_VIDEO_REPLICATION_ENDPOINT: "https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/video-synthesis",
    ALIYUN_VIDEO_REPLICATION_API_KEY: "sk-SYNTHETIC_ONLY_NOT_A_REAL_KEY",
    BEAUTY_VIDEO_OSS_REGION: "cn-beijing", BEAUTY_VIDEO_OSS_BUCKET: "synthetic-lq30",
    BEAUTY_VIDEO_OSS_PREFIX: "beauty-industry/video-staging/v1/lq30/",
    BEAUTY_VIDEO_OSS_APPROVED_ORIGIN: "https://synthetic-lq30.oss-cn-beijing.aliyuncs.com",
    BEAUTY_VIDEO_OSS_ACCESS_KEY_ID: "STS.SYNTHETICACCESSKEY30", BEAUTY_VIDEO_OSS_ACCESS_KEY_SECRET: "SYNTHETIC_OSS_SECRET_ONLY_30",
    BEAUTY_VIDEO_OSS_SECURITY_TOKEN: "SYNTHETIC_OSS_STS_TOKEN", BEAUTY_VIDEO_OSS_CREDENTIAL_EXPIRES_AT: new Date(now + 7200_000).toISOString(),
    ...(options.permitMode ? { VIDEO_REPLICATION_PERMIT_MODE: options.permitMode } : {})
  };
  const oss = ossFixture();
  const providerFetch: typeof fetch = async (url, init) => {
    const u = new URL(String(url));
    if (init?.method === "POST") return new Response(JSON.stringify({ output: { task_id: `synthetic-${suffix}`, task_status: "PENDING" } }));
    return new Response(JSON.stringify({ output: { task_id: u.pathname.split("/").at(-1), task_status: "SUCCEEDED", results: { video_url: "https://synthetic-output.oss-cn-beijing.aliyuncs.com/result.mp4" } }, usage: { video_duration: 2 } }));
  };
  const resultFetch: typeof fetch = async () => new Response(video, { headers: { "content-type": "video/mp4" } });
  // 供应商 fetch 只在确实确认出片时才会被调用；报价阶段只做账与准入，不发外部请求。
  const integrated = createControlledVideoIntegration({
    db, authorization, environment, resultRoot: path.join(root, "result"), now: () => now,
    policy: { creditCost: 100, maxCostFen: MAX_COST_FEN, maxOutputSeconds: 30, creditsPerSecond: 24 },
    offlineTransport: oss.transport, providerFetch, resultFetch
  });
  const app = Fastify({ logger: false });
  await registerViralVideoReplicationRoutes(app, {
    ...integrated,
    // 只替换鉴权上下文（合成 actor）。权益判断用的是**与路由同一份**共享查询，
    // 只是把它指向本用例的内存库（路由默认拿进程级 prisma；源码断言保证路由确实调用该查询）。
    context: async () => ({ tenantId, userId, source: "database" } as any),
    entitled: async (targetTenantId: string) => Boolean(await findVideoReplicationEntitlement(db, targetTenantId)),
    creditBalance: async (targetTenantId: string) => (await db.creditAccount.findUnique({ where: { tenantId: targetTenantId } }))?.balance ?? null
  });
  return {
    db, tenantId, userId, storeId, videoFileId: reference.id, portraitFileId: photo.id, app, permits: integrated,
    authorization, referenceBytes: video, createFile: (bytes: Buffer, mimeType: string) => file(bytes, mimeType)
  };
}

function payload(s: Scenario) {
  return replicationSchema.parse({
    referenceFileId: s.videoFileId, portraitFileId: s.portraitFileId, requestKey: `lq30-${randomUUID()}`,
    model: "aliyun_strict", visualRightsConfirmed: true, audioRightsConfirmed: true,
    performerConsentConfirmed: true, portraitConsentConfirmed: true
  });
}

async function main() {
  // 基线：源码必须走共享权益清单（防回退到硬编码 beauty-industry）。
  const fs = await import("node:fs");
  for (const file of [
    "apps/api/src/routes/viral-video-replication.ts",
    "apps/api/src/services/beauty-video-asset-authorization.ts",
    "apps/api/src/services/beauty-video-execution-permit.ts"
  ]) {
    const source = fs.readFileSync(file, "utf8");
    check(`源码 ${path.basename(file)} 不再硬编码 productCode:"beauty-industry"`, !/productCode:\s*"beauty-industry"/.test(source));
    check(`源码 ${path.basename(file)} 使用共享权益查询`, /findVideoReplicationEntitlement/.test(source));
  }

  // 1. 只有 lanqi 权益：报价应通过（修复前 403）。
  {
    const s = await scenario({ products: ["lanqi"], credits: 5000, permitMode: "auto" });
    const quote = await s.app.inject({ method: "POST", url: "/viral-video-replication/quote", payload: payload(s) });
    const body = quote.json();
    check("只有 lanqi 权益 → 报价 200（不再 403 product_access_denied）", quote.statusCode === 200, `status=${quote.statusCode} body=${JSON.stringify(body).slice(0, 160)}`);
    check("只有 lanqi 权益 + auto 模式 → canConfirm=true（许可自动签发）", body?.canConfirm === true, `gaps=${JSON.stringify(body?.gaps ?? [])}`);
    check("报价给出积分", Number.isInteger(body?.creditCost) && body.creditCost > 0, `creditCost=${body?.creditCost}`);
    const permits = await s.db.beautyVideoExecutionPermit.findMany({});
    check("自动签发且只签一条许可", permits.length === 1, `permits=${permits.length}`);
    check("许可绑定租户/门店/请求键", permits[0]?.tenantId === s.tenantId && permits[0]?.storeId === s.storeId && Boolean(permits[0]?.requestKey), `store=${permits[0]?.storeId}`);
    const scope = permits[0]?.scope ?? {};
    check("预算上限 = ¥10（1000 分），输出秒数按预算反推（≤16 秒，未越权加预算）", scope.maxCostFen === MAX_COST_FEN && scope.maxOutputSeconds === 16, `maxCostFen=${scope.maxCostFen} maxOutputSeconds=${scope.maxOutputSeconds}`);
  }

  // 2. 没有清单内权益：仍然失败关闭。
  {
    const s = await scenario({ products: ["founder-ip"], credits: 5000, permitMode: "auto", declare: false });
    const quote = await s.app.inject({ method: "POST", url: "/viral-video-replication/quote", payload: payload(s) });
    check("无 beauty-industry/lanqi 权益 → 仍 403 product_access_denied", quote.statusCode === 403 && quote.json()?.error === "product_access_denied", `status=${quote.statusCode} error=${quote.json()?.error}`);
    check("未授权租户不产生许可", (await s.db.beautyVideoExecutionPermit.findMany({})).length === 0);
  }

  // 3. operator 模式（默认）：没有人工许可 → 422，既有行为不回退。
  {
    const s = await scenario({ products: ["lanqi"], credits: 5000 });
    const quote = await s.app.inject({ method: "POST", url: "/viral-video-replication/quote", payload: payload(s) });
    check("operator 模式无许可 → 422 execution_permit_required（不回退）", quote.statusCode === 422 && quote.json()?.error === "execution_permit_required", `status=${quote.statusCode} error=${quote.json()?.error}`);
  }

  // 4. auto 模式幂等：同一 requestKey 重复报价不重复签发。
  {
    const s = await scenario({ products: ["lanqi"], credits: 5000, permitMode: "auto" });
    const p = payload(s);
    await s.app.inject({ method: "POST", url: "/viral-video-replication/quote", payload: p });
    await s.app.inject({ method: "POST", url: "/viral-video-replication/quote", payload: p });
    const permits = await s.db.beautyVideoExecutionPermit.findMany({});
    check("同一 requestKey 重复报价 → 许可仍只有一条（幂等）", permits.length === 1, `permits=${permits.length}`);
  }

  // 5. 积分不足：报价缺口点名，不建任务。
  {
    const s = await scenario({ products: ["lanqi"], credits: 1, permitMode: "auto" });
    const p = payload(s);
    const quote = await s.app.inject({ method: "POST", url: "/viral-video-replication/quote", payload: p });
    const body = quote.json();
    check("积分不足 → canConfirm=false 且缺口含 insufficient_credits", body?.canConfirm === false && (body?.gaps ?? []).includes("insufficient_credits"), `gaps=${JSON.stringify(body?.gaps ?? [])}`);
    const confirm = await s.app.inject({ method: "POST", url: "/viral-video-replication/confirm", payload: p });
    // 既有口径（BY50 契约）：积分不足由 claim 回 402 `insufficient_credits`，报价阶段则提前给同码缺口。
    check("积分不足时确认 → 402 insufficient_credits 且不创建任务", confirm.statusCode === 402 && confirm.json()?.error === "insufficient_credits" && (await s.db.viralVideoReplicationJob.findMany({})).length === 0, `status=${confirm.statusCode} error=${confirm.json()?.error}`);
  }

  // 6. 美业权益回归：beauty-industry 租户仍可报价。
  {
    const s = await scenario({ products: ["beauty-industry"], credits: 5000, permitMode: "auto" });
    const quote = await s.app.inject({ method: "POST", url: "/viral-video-replication/quote", payload: payload(s) });
    check("美业租户回归：报价 200 且可确认", quote.statusCode === 200 && quote.json()?.canConfirm === true, `status=${quote.statusCode}`);
  }

  // 7. 同内容重传（2026-09-15 现场：门店把同一份素材重新上传后 fileId 变了、sha 不变）：
  //    旧实现按 requestKey 查不到旧记录 → create 撞 (tenantId,storeId,fileSha256) 唯一键 → 409，
  //    页面停在声明这一步，**quote 根本发不出去**（用户看到「没报价也没出片」）。
  //    修复后：同内容命中已有声明时就地重绑到新 fileId，报价照常进行。
  {
    const s = await scenario({ products: ["lanqi"], credits: 5000, permitMode: "auto" });
    const duplicate = await s.createFile(s.referenceBytes, "video/mp4"); // 同字节、不同 fileId
    const basis = await s.createFile(Buffer.from("Synthetic basis for same-content re-upload"), "text/plain");
    let declareError = "";
    try {
      await s.authorization.declare(
        { tenantId: s.tenantId, userId: s.userId },
        {
          fileId: duplicate.id, subjectRole: "reference", basisFileId: basis.id, purpose: "video_replacement",
          expiresAt: new Date(Date.now() + 3600_000).toISOString(), rightsDeclared: true, requestKey: `lq31-ref-${duplicate.id}`
        }
      );
    } catch (error) {
      declareError = (error as { code?: string } | null)?.code ?? String(error);
    }
    const rebound = await s.db.beautyVideoAssetAuthorization.findFirst({ where: { tenantId: s.tenantId, subjectRole: "reference" } });
    check("同内容重新上传后再声明不报 409（就地重绑到新 fileId）", declareError === "" && rebound?.fileId === duplicate.id, `error=${declareError || "(none)"} boundFileId=${rebound?.fileId === duplicate.id}`);
    const quote = await s.app.inject({
      method: "POST", url: "/viral-video-replication/quote",
      payload: replicationSchema.parse({
        referenceFileId: duplicate.id, portraitFileId: s.portraitFileId, requestKey: `lq31-quote-${duplicate.id}`,
        model: "aliyun_strict", visualRightsConfirmed: true, audioRightsConfirmed: true,
        performerConsentConfirmed: true, portraitConsentConfirmed: true
      })
    });
    const gaps: string[] = quote.json()?.gaps ?? [];
    check("重传后报价 200 且不出现素材类缺口（可进入确认出片）", quote.statusCode === 200 && !gaps.includes("asset_authorization_required") && !gaps.includes("asset_not_found"), `status=${quote.statusCode} gaps=${JSON.stringify(gaps)}`);
  }

  console.log(`\n合计 ${passed + failed.length} 项，失败 ${failed.length} 项`);
  if (failed.length) { console.log(failed.map((name) => `  - ${name}`).join("\n")); process.exitCode = 1; }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
