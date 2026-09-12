import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { prisma } from "@baolu/db";
import { env } from "../config/env.js";
import { getBearerToken, verifySessionToken } from "../services/auth-token.js";
import { resolveRequestContext, type RequestContext } from "../services/request-context.js";
import { REPLICATION_CONTRACT, replicationSchema, replicationCapabilityGaps, validateReplicationAdmission, validateViralReplicationInput, type ReplicationAdmission, type ReplicationRequest } from "../services/viral-video-replication.js";
import { ReplicationError, createReplicationRepository, publicReplicationJob, type createReplicationRuntime } from "../services/viral-video-replication-runtime.js";
import { createVideoAssetAuthorization } from "../services/beauty-video-asset-authorization.js";
import { createVideoPrivateFileReader } from "../services/beauty-video-private-files.js";
import { createControlledVideoIntegration } from "../services/beauty-video-controlled-execution.js";

export type ReplicationRoutePorts = {
  context?(headers: Record<string, unknown>): Promise<RequestContext>;
  entitled?(tenantId: string): Promise<boolean>;
  /** Server-owned evidence, never client consent. Default has no approved store/staging authority. */
  admission?(context: RequestContext, input?: ReplicationRequest, jobId?: string): Promise<ReplicationAdmission | null>;
  runtime?: ReturnType<typeof createReplicationRuntime>;
  repository?: ReturnType<typeof createReplicationRepository>;
  authorization?: ReturnType<typeof createVideoAssetAuthorization>;
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
      policy:{creditCost:env.ALIYUN_VIDEO_REPLICATION_CREDITS,maxCostFen:env.ALIYUN_VIDEO_REPLICATION_MAX_COST_FEN,maxOutputSeconds:30}}),...ports};
  }
  const repo = ports.repository ?? createReplicationRepository(prisma);
  async function context(headers: Record<string, unknown>): Promise<RequestContext> {
    let c: RequestContext;
    if (ports.context) c = await ports.context(headers);
    else {
      const token = getBearerToken(headers);
      if (!token || !verifySessionToken(token)) throw new ReplicationError("unauthorized", 401);
      c = await resolveRequestContext(headers);
    }
    const entitled = ports.entitled ? await ports.entitled(c.tenantId) : c.source === "database" && Boolean(await prisma.tenantProductEntitlement.findFirst({ where: { tenantId: c.tenantId, productCode: "beauty-industry", status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { id: true } }));
    if (!entitled) throw new ReplicationError("product_access_denied", 403);
    return c;
  }
  function safeError(error: unknown, reply: any) {
    const known = error instanceof ReplicationError;
    return reply.code(known ? error.statusCode : 503).send({ error: known ? error.code : "replication_unavailable", message: "当前步骤未完成；请按前置条件处理。未确认成功前不会提供成片。" });
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
    return { c, input, admission, gaps: [...new Set(gaps)] };
  }
  app.post("/viral-video-replication/material-authorizations",async(request,reply)=>{
    try{const c=await context(request.headers);if(!ports.authorization)throw new ReplicationError("authorization_registry_unavailable",503);
      return reply.code(201).send({authorization:await ports.authorization.declare(c,request.body),message:"已记录素材授权声明及依据引用，未独立核验法律真实性；不代表已获视频生成权限。"});
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
      return { contractVersion: REPLICATION_CONTRACT, model: "aliyun_strict", mode: "只替换授权人物，保留参考视频原背景、动作和光照；不提供新口播或换背景。", canConfirm: p.gaps.length === 0, creditCost: p.admission?.creditCost ?? null, gaps: p.gaps, message: p.gaps.length ? "缺少前置能力或授权；不会创建任务或预留积分。" : "请确认本次报价；不会自动重试或补做。" };
    } catch (error) { return safeError(error, reply); }
  });
  app.post("/viral-video-replication/confirm", async (request, reply) => {
    try {
      const p = await preflight(request.headers, request.body);
      if (p.gaps.length || !p.admission || !ports.runtime) return reply.code(422).send({ error: "replication_preflight_blocked", gaps: p.gaps, message: "未创建任务、未预留积分；需要服务端素材授权与安全暂存，或调整不支持的组合。" });
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
          if(error instanceof ReplicationError&&["job_not_found","asset_not_found","file_not_found","asset_authorization_required","authorization_changed","file_changed"].includes(error.code))continue;
          throw error;
        }
        if (a && a.tenantId === c.tenantId && a.userId === c.userId && a.entitlement && a.allowedStoreIds.includes(a.storeId) && a.storeId === job.authorizationSnapshot?.storeId && job.userId === c.userId) visible.push(publicReplicationJob(job));
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
  app.post("/viral-video-replication/callbacks/aliyun", async (request, reply) => {
    const received = Buffer.from(String(request.headers["x-aliyun-replication-token"] ?? ""));
    const expected = Buffer.from(env.ALIYUN_VIDEO_REPLICATION_CALLBACK_TOKEN ?? "");
    if (!expected.length || received.length !== expected.length || !timingSafeEqual(received, expected)) return reply.code(401).send({ error: "unauthorized_callback" });
    // A callback is not trusted output. Only verified polling may transition the job.
    return reply.code(202).send({ accepted: false, code: "verified_task_poll_required" });
  });
}
