import { randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { prisma } from "@baolu/db";
import { env } from "../config/env.js";
import { getBearerToken, verifySessionToken } from "../services/auth-token.js";
import { resolveRequestContext, type RequestContext } from "../services/request-context.js";
import { importDouyinVideo } from "../services/douyin-video-import.js";
import { storeBuffer } from "../services/file-storage.js";
import { REPLICATION_CONTRACT, replicationSchema, replicationCapabilityGaps, validateReplicationAdmission, validateViralReplicationInput, type ReplicationAdmission, type ReplicationRequest } from "../services/viral-video-replication.js";
import { ReplicationError, createReplicationRepository, publicReplicationJob, type createReplicationRuntime } from "../services/viral-video-replication-runtime.js";
import { createVideoAssetAuthorization } from "../services/beauty-video-asset-authorization.js";
import { createVideoPrivateFileReader } from "../services/beauty-video-private-files.js";
import { createControlledVideoIntegration } from "../services/beauty-video-controlled-execution.js";
import { findVideoReplicationEntitlement } from "../services/video-replication-entitlement.js";
import { readLanqiWalletBalance } from "../services/lanqi-wallet.js";
import { readWallet } from "../services/sitong-wallet.js";
import { z } from "zod";
import { faceFuseConfigured, faceFuseCreditsPerSecond, loadUploadedFilePath, pollFaceFusion, quoteFaceFusion, readFuseAsset, submitFaceFusion } from "../services/viral-face-fusion.js";

export type ReplicationRoutePorts = {
  context?(headers: Record<string, unknown>): Promise<RequestContext>;
  entitled?(tenantId: string): Promise<boolean>;
  /** 算力余额（报价阶段用来判断「够不够这一次」，默认读当前进程的 prisma）。 */
  creditBalance?(tenantId: string): Promise<number | null>;
  /** Server-owned evidence, never client consent. Default has no approved store/staging authority. */
  admission?(context: RequestContext, input?: ReplicationRequest, jobId?: string): Promise<ReplicationAdmission | null>;
  runtime?: ReturnType<typeof createReplicationRuntime>;
  repository?: ReturnType<typeof createReplicationRepository>;
  authorization?: ReturnType<typeof createVideoAssetAuthorization>;
  /** 受控链路的暂存服务（stage/release + 浏览器直传预签名）与单批许可控制（prestage 需要提前 claim）。 */
  staging?: Omit<ReturnType<typeof import("../services/beauty-video-private-staging.js").createVideoPrivateStaging>, "presign"> & { presign?(method: "PUT" | "GET", key: string, ttlSeconds: number, contentType?: string): Promise<string> };
  control?: import("../services/viral-video-replication-runtime.js").ReplicationRuntimePorts["control"];
};

export async function registerViralVideoReplicationRoutes(app: FastifyInstance, ports: ReplicationRoutePorts = {}): Promise<void> {
  if(!ports.context){
    const authorization=createVideoAssetAuthorization(prisma,createVideoPrivateFileReader(env.UPLOAD_DIR,path.join(env.UPLOAD_DIR,".video-inspection")));
    // Configuration installs code only; a signed persistent per-batch permit is independently required.
    ports={...createControlledVideoIntegration({db:prisma,authorization,environment:env,
      resultRoot:path.resolve(env.UPLOAD_DIR,".beauty-video-results"),
      audit:event=>app.log.info(event,"beauty video storage"),
      // maxCostFen 以前硬编码为 0（等于永久禁止付费执行）。现在改为读环境变量，
      // 默认仍是 0：**漏配就等于关闭**，只有显式给出上限（首次联调 ¥10 = 1000 分）
      // 才可能外发付费请求。这是「先能跑通、再常态化」的受控开关。
      policy:{creditCost:env.ALIYUN_VIDEO_REPLICATION_CREDITS,maxCostFen:env.ALIYUN_VIDEO_REPLICATION_MAX_COST_FEN,maxOutputSeconds:30,...(env.ALIYUN_VIDEO_REPLICATION_CREDITS_PER_SECOND>0?{creditsPerSecond:env.ALIYUN_VIDEO_REPLICATION_CREDITS_PER_SECOND}:{})}}),...ports};
  }
  const repo = ports.repository ?? createReplicationRepository(prisma);
  // 后台任务推进 worker（2026-10-04）：任务推进从「前端触发 refresh」改为「后端主动轮询」——
  // 页面关掉任务也能跑完；前端只读任务状态。runtime 自带 nextPollAt 限频，5s 一拍不会打爆供应商。
  if (ports.runtime && ports.admission && !(app as unknown as { __viralReplicationWorker?: boolean }).__viralReplicationWorker) {
    (app as unknown as { __viralReplicationWorker?: boolean }).__viralReplicationWorker = true;
    let ticking = false;
    const runtime = ports.runtime;
    const tick = async () => {
      if (ticking) return;
      ticking = true;
      try {
        const jobs = await repo.listActive(20);
        for (const job of jobs) {
          try {
            const actor = { tenantId: job.tenantId, userId: job.userId, source: "database" as const };
            const a = await ports.admission!(actor as unknown as RequestContext, undefined, job.id);
            if (!a) continue;
            await runtime.refresh(job.id, a);
          } catch (error) {
            console.log(`[viral-replication] worker.skip ${JSON.stringify({ jobId: job.id, code: error instanceof ReplicationError ? error.code : String((error as { message?: string })?.message ?? error).slice(0, 120) })}`);
          }
        }
      } catch (error) {
        console.log(`[viral-replication] worker.tick-failed ${JSON.stringify({ message: String((error as { message?: string })?.message ?? error).slice(0, 120) })}`);
      } finally {
        ticking = false;
      }
    };
    const workerTimer = setInterval(() => void tick(), 5000);
    workerTimer.unref?.();
    void tick();
  }
  async function context(headers: Record<string, unknown>): Promise<RequestContext> {
    let c: RequestContext;
    if (ports.context) c = await ports.context(headers);
    else {
      const token = getBearerToken(headers);
      if (!token || !verifySessionToken(token)) throw new ReplicationError("unauthorized", 401);
      c = await resolveRequestContext(headers);
    }
    // 共享能力：美业单品与兰琪工作台任一 active 权益都放行（清单见 video-replication-entitlement.ts）。
    const entitled = ports.entitled ? await ports.entitled(c.tenantId) : c.source === "database" && Boolean(await findVideoReplicationEntitlement(prisma, c.tenantId));
    if (!entitled) throw new ReplicationError("product_access_denied", 403);
    return c;
  }
  function safeError(error: unknown, reply: any) {
    const known = error instanceof ReplicationError;
    // 兜底分支此前把**未知异常整个吞掉**：对外只回一句"当前步骤未完成"，对内不留任何栈，
    // 线上排障无从下手（2026-10-08 换人出片轮询 503 就是这么查不到真因的）。
    // 现在未知异常一律打出栈；对外文案一字不改。
    if (!known) {
      const e = error as { name?: string; code?: string; message?: string; stack?: string };
      console.error(`[viral-replication] unhandled ${JSON.stringify({
        name: e?.name ?? null,
        code: (e as { code?: unknown })?.code ?? null,
        message: String(e?.message ?? error).slice(0, 300),
        stack: String(e?.stack ?? "").split("\n").slice(0, 5).join(" | ").slice(0, 900)
      })}`);
    }
    const friendly: Record<string, string> = {
      douyin_link_invalid: "没识别到抖音分享链接：请把分享口令整段粘贴进来（含 v.douyin.com 短链）。",
      douyin_fetch_failed: "抖音视频获取失败（可能触发风控或作品不可见），请换一条，或改用本地上传。",
      douyin_too_large: "这条抖音视频超过 200MB 上限，请换一条。",
      file_type_invalid: "素材格式不支持：图片请上传 JPG / PNG / WebP / BMP，视频请上传 MP4 / MOV（以文件真实格式为准，改后缀名无效）。",
      file_not_found: "素材不存在或已失效，请重新上传后再试。",
      file_changed: "素材与之前的授权声明不一致（文件已变更），请重新上传并重新声明授权。",
      reference_duration_invalid: "参考视频时长需在 2–30 秒之间。",
      file_dimensions_invalid: "素材尺寸不满足要求：边长至少 200px，最长边不超限。",
      basis_type_invalid: "授权依据文件需为 PDF 或 TXT。",
      declaration_bounds_invalid: "授权有效期设置无效，请重新发起声明。",
      invalid_declaration: "授权声明参数不完整，请刷新页面重新提交。",
      product_access_denied: "当前账号没有视频生成权益，请先在商城开通。",
      asset_declaration_forbidden: "当前账号无权声明素材授权，请用门店主账号操作。",
      store_context_required: "请先选择门店后再操作。",
      authorization_changed: "素材授权状态已发生变化，请刷新页面后重试。",
      asset_not_found: "该素材还没有授权声明，请先完成授权声明再报价。",
      asset_authorization_required: "素材授权已过期或版本已更新，请重新声明授权。"
    };
    const message = (known && friendly[error.code]) || "当前步骤未完成；请按前置条件处理。未确认成功前不会提供成片。";
    return reply.code(known ? error.statusCode : 503).send({ error: known ? error.code : "replication_unavailable", message });
  }
  async function preflight(headers: Record<string, unknown>, body: unknown) {
    const c = await context(headers);
    const parsed = replicationSchema.safeParse(body);
    if (!parsed.success) throw new ReplicationError("invalid_request", 400);
    const input = parsed.data;
    if (validateViralReplicationInput(input)) throw new ReplicationError("invalid_replication_input", 422);
    const gaps = replicationCapabilityGaps(input);
    const admission = await ports.admission?.(c, input) ?? null;
    if (!admission) gaps.push("server_asset_authorization_required", "secure_staging_required");
    else {
      if (admission.tenantId !== c.tenantId || admission.userId !== c.userId) throw new ReplicationError("asset_not_found", 404);
      gaps.push(...validateReplicationAdmission(input, admission));
    }
    if (!ports.runtime) gaps.push("controlled_execution_not_enabled");
    // 算力不足要在报价阶段就说清（此前只在确认时 402，用户看不出下一步该干什么）。
    if (admission) {
      // LQ-34 ③：报价阶段「够不够这一次」必须和扣费同源 —— 读**租户 owner 的通用钱包余额**
      // （兰琪充值的钱就进这本账）。找不到 owner 也按"不够"处理：不放行、不建任务、不扣费。
      // 2026-10-04：视频生成不收赠送积分 → 按 **paid 桶**判定，赠送再多也不算够。
      const balance = ports.creditBalance
        ? await ports.creditBalance(c.tenantId)
        : (await readLanqiWalletBalance(c.tenantId))?.paidBalance ?? null;
      if (balance === null || balance < admission.creditCost) gaps.push("insufficient_credits");
    }
    return { c, input, admission, gaps: [...new Set(gaps)] };
  }
  app.post("/viral-video-replication/material-authorizations",async(request,reply)=>{
    try{const c=await context(request.headers);if(!ports.authorization)throw new ReplicationError("authorization_registry_unavailable",503);
      return reply.code(201).send({authorization:await ports.authorization.declare(c,request.body),message:"已记录素材授权声明及依据引用，未独立核验法律真实性；不代表已获视频生成权限。"});
    }catch(error){return safeError(error,reply);}
  });
  app.post("/viral-video-replication/douyin-import",async(request,reply)=>{
    try{
      const c=await context(request.headers);
      const body=(request.body??{}) as {shareText?:string};
      const shareText=String(body.shareText??"").trim();
      if(shareText.length<8)throw new ReplicationError("douyin_link_invalid",400);
      const result=await importDouyinVideo({tenantId:c.tenantId,userId:c.userId},shareText);
      return reply.code(201).send(result);
    }catch(error){return safeError(error,reply);}
  });
  app.post<{Params:{id:string}}>("/viral-video-replication/material-authorizations/:id/revoke",async(request,reply)=>{
    try{const c=await context(request.headers);if(!ports.authorization)throw new ReplicationError("authorization_registry_unavailable",503);
      if(request.body&&Object.keys(request.body as object).length)throw new ReplicationError("invalid_request",400);
      return {authorization:await ports.authorization.revoke(c,request.params.id),message:"已撤销后续访问；已经发送到外部的内容不能据此承诺追回。"};
    }catch(error){return safeError(error,reply);}
  });
  app.post("/viral-video-replication/quote", async (request, reply) => {
    try {
      const p = await preflight(request.headers, request.body);
      console.log(`[viral-replication] quote ${JSON.stringify({ gaps: p.gaps, canConfirm: p.gaps.length === 0, creditCost: p.admission?.creditCost ?? null })}`);
      return { contractVersion: REPLICATION_CONTRACT, model: "aliyun_strict", mode: "只替换授权人物，保留参考视频原背景、动作和光照；不提供新口播或换背景。", canConfirm: p.gaps.length === 0, creditCost: p.admission?.creditCost ?? null, gaps: p.gaps, message: p.gaps.length ? "这一版还不能出片（缺口见下方），不会创建任务、不会预留算力。" : "请确认本次报价；不会自动重试或补做。" };
    } catch (error) { return safeError(error, reply); }
  });
  app.post("/viral-video-replication/confirm", async (request, reply) => {
    try {
      const p = await preflight(request.headers, request.body);
      // 算力不足不进 422：让它继续走到 claim，由既有口径回 402 `insufficient_credits`
      // （BY50 契约不变；报价阶段已经在 gaps 里提前告诉用户该去充值）。
      const blocking = p.gaps.filter((gap) => gap !== "insufficient_credits");
      if (blocking.length || !p.admission || !ports.runtime) return reply.code(422).send({ error: "replication_preflight_blocked", gaps: p.gaps, message: "未创建任务、未预留算力；需要服务端素材授权与安全暂存，或调整不支持的组合。" });
      if (!p.input.requestKey) throw new ReplicationError("idempotency_key_required", 400);
      return reply.code(202).send(await ports.runtime.confirm(p.admission, p.input));
    } catch (error) { return safeError(error, reply); }
  });
  app.get("/viral-video-replication/jobs", async (request, reply) => {
    try {
      const c = await context(request.headers);
      const jobs = c.source === "database" || ports.repository ? await repo.list(c.tenantId,c.userId) : [];
      const visible = [];
      for (const job of jobs) {
        let a:ReplicationAdmission|null|undefined;
        try{a = await ports.admission?.(c, undefined, job.id);}
        catch(error){
          // Revoked/changed files are no longer visible. Keep unrelated history usable;
          // database, audit and product-permission failures must still propagate fail-closed.
          if(error instanceof ReplicationError&&["job_not_found","asset_not_found","file_not_found","asset_authorization_required","authorization_changed","file_changed"].includes(error.code)){
            // 任务"凭空消失"比报错更难查：留下跳过原因（只记 code，不含素材细节）。
            console.log(`[viral-replication] jobs.skip ${JSON.stringify({ jobId: job.id, code: error.code, status: job.status })}`);
            continue;
          }
          throw error;
        }
        if (a && a.tenantId === c.tenantId && a.userId === c.userId && a.entitlement && a.allowedStoreIds.includes(a.storeId) && a.storeId === job.authorizationSnapshot?.storeId && job.userId === c.userId) visible.push(publicReplicationJob(job));
        else console.log(`[viral-replication] jobs.invisible ${JSON.stringify({ jobId: job.id, status: job.status, admission: a ? { entitlement: a.entitlement, storeId: a.storeId, allowed: a.allowedStoreIds, snapStore: job.authorizationSnapshot?.storeId, ownerMatch: a.userId === c.userId && job.userId === c.userId } : null })}`);
      }
      return { jobs: visible };
    } catch (error) { return safeError(error, reply); }
  });
  for (const operation of ["refresh", "cancel", "content"] as const) {
    app.route<{ Params: { id: string } }>({ method: operation === "content" ? "GET" : "POST", url: "/viral-video-replication/jobs/:id/" + operation, handler: async (request, reply) => {
      try {
        const c = await context(request.headers);
        const a = await ports.admission?.(c, undefined, request.params.id);
        if (!a || a.tenantId !== c.tenantId || a.userId !== c.userId || !ports.runtime) throw new ReplicationError("job_not_found", 404);
        if (operation === "content") {
          const bytes = await ports.runtime.download(request.params.id, a);
          return reply.type("video/mp4").header("Cache-Control", "private, no-store").header("Content-Disposition", 'attachment; filename="authorized-video.mp4"').send(bytes);
        }
        return { job: await ports.runtime[operation](request.params.id, a) };
      } catch (error) { return safeError(error, reply); }
    } });
  }
  // 预暂存（2026-10-04）：报价成功后前端自动触发，把「素材上传到 OSS」从用户点击 confirm 的那 5 秒里挪出来。
  // 与 confirm 共用同一 requestKey → stage 按 requestHash 幂等，confirm 直接复用租约、不再重传。
  app.post("/viral-video-replication/prestage", async (request, reply) => {
    try {
      const p = await preflight(request.headers, request.body);
      const blocking = p.gaps.filter((gap) => gap !== "insufficient_credits");
      if (blocking.length || !p.admission || !ports.runtime) return reply.code(422).send({ error: "replication_preflight_blocked", gaps: p.gaps });
      if (!ports.staging?.stage) throw new ReplicationError("staging_unavailable", 503);
      // 云端 PUT 受单批许可约束：prestage 先 claim（同一 requestKey），confirm 遇"已 claim"复用。
      if (ports.control?.claim) {
        try { await ports.control.claim(p.admission, p.input); }
        catch (error) { if (!(error instanceof ReplicationError) || error.code !== "execution_batch_already_claimed") throw error; }
      }
      const staged = await ports.staging.stage(p.admission, p.input);
      console.log(`[viral-replication] prestage ${JSON.stringify({ leaseId: staged.leaseId, requestKey: p.input.requestKey ?? null })}`);
      return { staged: true, leaseId: staged.leaseId };
    } catch (error) { return safeError(error, reply); }
  });

  // 浏览器直传 OSS：后端只签发 10 分钟预签名 PUT，不经手媒体字节（桶需配置 CORS 后浏览器才可用）。
  const DIRECT_KINDS = {
    reference: { exts: ["mp4", "mov", "avi"], limitMb: 200, mime: (ext: string) => (ext === "mp4" ? "video/mp4" : ext === "mov" ? "video/quicktime" : "video/x-msvideo") },
    portrait: { exts: ["png", "jpg", "jpeg", "webp", "bmp"], limitMb: 5, mime: (ext: string) => ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", bmp: "image/bmp" }[ext] ?? "image/jpeg") },
    basis: { exts: ["txt", "pdf"], limitMb: 5, mime: (ext: string) => (ext === "pdf" ? "application/pdf" : "text/plain") }
  } as const;
  app.post("/viral-video-replication/upload-url", async (request, reply) => {
    try {
      const c = await context(request.headers);
      const body = (request.body ?? {}) as { kind?: string; name?: string };
      const kind = body.kind && body.kind in DIRECT_KINDS ? (body.kind as keyof typeof DIRECT_KINDS) : null;
      if (!kind) throw new ReplicationError("invalid_request", 400);
      const ext = (body.name?.split(".").pop() ?? "").toLowerCase();
      if (!ext || !(DIRECT_KINDS[kind].exts as readonly string[]).includes(ext)) throw new ReplicationError("invalid_request", 422);
      if (!ports.staging?.presign) throw new ReplicationError("direct_upload_unavailable", 503);
      const key = `${env.BEAUTY_VIDEO_OSS_PREFIX ?? ""}direct/${c.tenantId}/${randomUUID()}.${ext}`;
      const uploadUrl = await ports.staging.presign("PUT", key, 600, DIRECT_KINDS[kind].mime(ext));
      console.log(`[viral-replication] upload-url ${JSON.stringify({ kind, keyTail: key.slice(-36) })}`);
      return { uploadUrl, key, expiresIn: 600, contentType: DIRECT_KINDS[kind].mime(ext) };
    } catch (error) { return safeError(error, reply); }
  });

  // 直传回源登记：浏览器 PUT 到 OSS 后，后端把对象取回本地 uploads 目录，走与 /files 完全相同的登记与下游校验。
  app.post("/files/from-oss", async (request, reply) => {
    try {
      const c = await context(request.headers);
      const body = (request.body ?? {}) as { key?: string; name?: string; kind?: string };
      const key = String(body.key ?? "");
      // key 全形 = <OSS前缀>direct/<租户>/…（与 upload-url 生成的完全一致），前缀校验要含 OSS 前缀。
      if (!key.startsWith(`${env.BEAUTY_VIDEO_OSS_PREFIX ?? ""}direct/${c.tenantId}/`)) throw new ReplicationError("file_not_found", 404);
      const kind = body.kind && body.kind in DIRECT_KINDS ? (body.kind as keyof typeof DIRECT_KINDS) : null;
      if (!kind || !ports.staging?.presign) throw new ReplicationError("invalid_request", 400);
      const ext = (body.name?.split(".").pop() ?? "").toLowerCase();
      const getUrl = await ports.staging.presign("GET", key, 60);
      const response = await fetch(getUrl, { signal: AbortSignal.timeout(60_000) });
      console.log(`[viral-replication] ingest ${JSON.stringify({ keyTail: key.slice(-36), status: response.status })}`);
      if (!response.ok) throw new ReplicationError("oss_object_not_found", 404);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > DIRECT_KINDS[kind].limitMb * 1024 * 1024) throw new ReplicationError("file_too_large", 413);
      const upload = await storeBuffer({ tenantId: c.tenantId, filename: body.name ?? `upload.${ext}`, mimeType: DIRECT_KINDS[kind].mime(ext), buffer });
      const record = env.DATA_MODE === "demo"
        ? null
        : await prisma.uploadedFile.create({ data: { id: upload.id, tenantId: c.tenantId, userId: c.userId, filename: upload.filename, mimeType: upload.mimeType, byteSize: upload.byteSize, storagePath: upload.storagePath, sha256: upload.sha256 } });
      return { dataMode: env.DATA_MODE, file: record ?? { id: upload.id, filename: upload.filename, mimeType: upload.mimeType, byteSize: upload.byteSize, storagePath: upload.storagePath, sha256: upload.sha256 } };
    } catch (error) { return safeError(error, reply); }
  });

  app.post("/viral-video-replication/callbacks/aliyun", async (request, reply) => {
    const received = Buffer.from(String(request.headers["x-aliyun-replication-token"] ?? ""));
    const expected = Buffer.from(env.ALIYUN_VIDEO_REPLICATION_CALLBACK_TOKEN ?? "");
    if (!expected.length || received.length !== expected.length || !timingSafeEqual(received, expected)) return reply.code(401).send({ error: "unauthorized_callback" });
    // A callback is not trusted output. Only verified polling may transition the job.
    return reply.code(202).send({ accepted: false, code: "verified_task_poll_required" });
  });

  // ── 换脸链路（阿里云视频人脸融合）· 2026-10-06 本地先行，未上线 ──
  // 与 animate-mix（换人）不同：只换主角的脸，原片文字 / 字幕 / 配音全部原样保留。
  // 前置质检（眼镜 / 遮挡 / 多人脸 / 码率）由前端上传环节提示；厂商对不可融合素材会静默跳过。
  app.post("/viral-video-replication/fuse/quote", async (request, reply) => {
    try {
      const c = await context(request.headers);
      const parsed = z.object({ videoFileId: z.string().min(4), portraitFileId: z.string().min(4) }).safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: "invalid_request", message: "参数不完整，请刷新后重试。" });
      const videoPath = await loadUploadedFilePath(parsed.data.videoFileId, c.tenantId);
      const portraitPath = await loadUploadedFilePath(parsed.data.portraitFileId, c.tenantId);
      // 报价必须与提交**同源**：换脸扣的是发起人（c.userId）钱包，且视频生成只认充值算力（paidOnly）。
      // 此前这里恒为 null（creditBalance port 从未注册）→ 报价跳过余额校验、永远显示"可确认"，
      // 提交才在 paid 桶上失败（insufficient_credits），用户看到的是"报价通过、提交神秘失败"（2026-10-08）。
      const balance = ports.creditBalance
        ? await ports.creditBalance(c.tenantId)
        : (await readWallet(c.userId)).paidBalance;
      const quote = await quoteFaceFusion({ videoPath, portraitPath, creditBalance: balance });
      return { canConfirm: quote.canConfirm, creditCost: quote.creditCost, durationSeconds: quote.durationSeconds, message: quote.message, gaps: quote.gaps };
    } catch (error) { return safeError(error, reply); }
  });

  app.post("/viral-video-replication/fuse/submit", async (request, reply) => {
    try {
      const c = await context(request.headers);
      const parsed = z.object({
        videoFileId: z.string().min(4),
        portraitFileId: z.string().min(4),
        requestKey: z.string().min(6).max(80)
      }).safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: "invalid_request", message: "参数不完整，请刷新后重试。" });
      const videoPath = await loadUploadedFilePath(parsed.data.videoFileId, c.tenantId);
      const portraitPath = await loadUploadedFilePath(parsed.data.portraitFileId, c.tenantId);
      const durationSeconds = await (async () => {
        const probe = await quoteFaceFusion({ videoPath, portraitPath, creditBalance: null });
        return probe.durationSeconds;
      })();
      const creditCost = Math.max(1, Math.ceil(durationSeconds) * faceFuseCreditsPerSecond());
      const result = await submitFaceFusion({
        tenantId: c.tenantId,
        userId: c.userId,
        requestKey: parsed.data.requestKey,
        videoPath,
        portraitPath,
        creditCost
      });
      return reply.code(202).send({ job: { id: result.jobId, status: "submitted" } });
    } catch (error) {
      request.log.error({ event: "fuse_submit_error", detail: String((error as any)?.message ?? error).slice(0, 300) });
      return safeError(error, reply);
    }
  });

  app.get("/viral-video-replication/fuse/status", async (request, reply) => {
    try {
      const c = await context(request.headers);
      const query = (request.query ?? {}) as { jobId?: string };
      if (!query.jobId) return reply.code(400).send({ error: "invalid_request" });
      const job = await pollFaceFusion(query.jobId, c.tenantId);
      if (!job) return reply.code(404).send({ error: "fuse_job_not_found" });
      return { status: job.status, errorMessage: job.errorMessage ?? null, creditCost: job.creditCost };
    } catch (error) { return safeError(error, reply); }
  });

  app.get("/viral-video-replication/fuse/asset/:jobId", async (request, reply) => {
    try {
      const c = await context(request.headers);
      const asset = await readFuseAsset(String((request.params as { jobId: string }).jobId), c.tenantId);
      if (!asset) return reply.code(404).send({ error: "fuse_asset_not_found" });
      return reply.header("Content-Type", "video/mp4").header("Cache-Control", "private, no-store").send(asset.bytes);
    } catch (error) { return safeError(error, reply); }
  });
}
