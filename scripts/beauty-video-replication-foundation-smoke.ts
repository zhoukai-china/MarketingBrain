import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import { buildAliyunReplicationRequest, replicationSchema, replicationCapabilityGaps, validateDirectAssetUrl, validateReplicationAdmission, createReplicationProvider, ReplicationProviderError, type ReplicationAdmission } from "../apps/api/src/services/viral-video-replication.ts";
import { createReplicationRepository, createReplicationRuntime, ReplicationError, publicReplicationJob } from "../apps/api/src/services/viral-video-replication-runtime.ts";
import { createReplicationAssetStore } from "../apps/api/src/services/viral-video-replication-assets.ts";
import { registerViralVideoReplicationRoutes } from "../apps/api/src/routes/viral-video-replication.ts";
import { replicationMemoryDb } from "./fixtures/replication-test-db.ts";
import { readLanqiWalletBalance } from "../apps/api/src/services/lanqi-wallet.ts";

async function main() {
const request = buildAliyunReplicationRequest({ referenceVideoUrl: "https://assets.example.test/ref.mp4", portraitImageUrl: "https://assets.example.test/portrait.png" });
assert.equal(request.model, "wan2.2-animate-mix", "BY45 protocol drift: formal model must be pinned");
assert.deepEqual(request.input, { video_url: "https://assets.example.test/ref.mp4", image_url: "https://assets.example.test/portrait.png", watermark: true });
assert.deepEqual(request.parameters, { mode: "wan-std", check_image: true });
let externalCalls = 0;
globalThis.fetch = async () => { externalCalls++; throw new Error("external_network_forbidden"); };
const endpoint = "https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/video-synthesis";
const input = replicationSchema.parse({ model: "aliyun_strict", referenceFileId: "synthetic-reference", portraitFileId: "synthetic-portrait", requestKey: "synthetic-request-key", visualRightsConfirmed: true, audioRightsConfirmed: true, performerConsentConfirmed: true, portraitConsentConfirmed: true });
const base: ReplicationAdmission = { tenantId: "synthetic-tenant", userId: "synthetic-user", productCode: "beauty-industry", storeId: "store-a", allowedStoreIds: ["store-a"], entitlement: true, creditCost: 100, maxCostFen: 120, maxOutputSeconds: 2, stagingReady: true,
  reference: { fileId: input.referenceFileId!, tenantId: "synthetic-tenant", storeId: "store-a", sha256: "a".repeat(64), evidenceId: "server-ref-evidence", expiresAt: Date.now()+3600_000, role: "reference", rights: ["visual","audio","performer"], mimeType: "video/mp4", bytes: 10000, width: 240, height: 320, durationSeconds: 2 },
  portrait: { fileId: input.portraitFileId!, tenantId: "synthetic-tenant", storeId: "store-a", sha256: "b".repeat(64), evidenceId: "server-portrait-evidence", expiresAt: Date.now()+3600_000, role: "owner", rights: ["portrait"], mimeType: "image/png", bytes: 10000, width: 240, height: 320 }
};
assert.deepEqual(validateReplicationAdmission(input, base), []);
for (const url of ["http://host.test/a.mp4", "https://127.0.0.1/a.mp4", "https://[::1]/a.mp4", "https://localhost/a.mp4", "https://x.local/a.mp4", "https://user:secret@example.test/a.mp4", "https://example.test:444/a.mp4", "https://www.douyin.com/video/a.mp4"]) assert.ok(validateDirectAssetUrl(url));
assert.equal(replicationSchema.safeParse({ ...input, tenantId: "evil" }).success, false);
assert.deepEqual(replicationCapabilityGaps({ ...input, environmentFileIds: ["x"], style: "rural", script: "new words", subtitles: true, voiceId: "x" }).sort(), ["background_replacement_not_supported","style_transfer_not_supported","new_speech_not_supported","subtitle_composition_not_supported","voice_cloning_not_supported"].sort());
for (const modify of [
  (a: any) => a.entitlement = false,
  (a: any) => a.allowedStoreIds = [],
  (a: any) => a.reference.tenantId = "other",
  (a: any) => a.reference.storeId = "other",
  (a: any) => a.reference.rights = [],
  (a: any) => a.portrait.expiresAt = 0,
  (a: any) => a.reference.durationSeconds = 31,
  (a: any) => a.reference.durationSeconds = 1,
  (a: any) => a.portrait.width = 10,
  (a: any) => a.portrait.bytes = 6*1024*1024,
  (a: any) => a.reference.mimeType = "image/png",
  (a: any) => a.maxCostFen = 100,
  (a: any) => a.stagingReady = false
]) { const a = structuredClone(base); modify(a); assert.ok(validateReplicationAdmission(input, a).length); }
assert.ok(validateReplicationAdmission({ ...input, template: "kol_visit" }, base).includes("asset_authorization_required"));

let submittedHttp = 0, polledHttp = 0;
const provider = createReplicationProvider({ endpoint, apiKey: "synthetic-not-a-key", fetch: async (url: any, init: any) => {
  assert.equal(init.redirect, "error");
  if (init.method === "POST") { submittedHttp++; assert.equal(init.headers["X-DashScope-Async"], "enable"); assert.equal(JSON.parse(init.body).input.person_image_url, undefined); return new Response(JSON.stringify({ output: { task_id: "synthetic-task", task_status: "PENDING" } })); }
  polledHttp++; assert.equal(url, "https://dashscope.aliyuncs.com/api/v1/tasks/synthetic-task"); return new Response(JSON.stringify({ output: { task_id: "synthetic-task", task_status: "SUCCEEDED", results: { video_url: "https://fixture.oss-cn-beijing.aliyuncs.com/result.mp4" } }, usage: { video_duration: 2 } }));
} });
await provider.submit({ referenceVideoUrl: "https://assets.example.test/ref.mp4", portraitImageUrl: "https://assets.example.test/portrait.png", mode: "wan-std" });
assert.equal((await provider.poll("synthetic-task")).seconds, 2);
assert.equal(submittedHttp, 1); assert.equal(polledHttp, 1);
for (const status of [400,401,404,429,500,503]) {
  let calls = 0;
  const p = createReplicationProvider({ endpoint, apiKey: "synthetic", fetch: async () => { calls++; return new Response('{"message":"DO_NOT_LEAK_SYNTHETIC_RESPONSE"}', {status}); } });
  await assert.rejects(() => p.submit({ referenceVideoUrl: "https://assets.example.test/ref.mp4", portraitImageUrl: "https://assets.example.test/portrait.png", mode: "wan-std" }), new RegExp(`provider_http_${status}`)); assert.equal(calls, 1);
}
for (const response of [{}, {task_id:"wrong"}, {output:{task_id:"a",task_status:"UNKNOWN"}}]) {
  const p = createReplicationProvider({ endpoint, apiKey:"synthetic", fetch:async()=>new Response(JSON.stringify(response)) });
  await assert.rejects(()=>p.submit({ referenceVideoUrl:"https://assets.example.test/ref.mp4",portraitImageUrl:"https://assets.example.test/portrait.png",mode:"wan-std" }), /provider_task_id_missing/);
}

const dir = await mkdtemp(path.join(tmpdir(), "by45-offline-"));
const videoFile = path.join(dir, "synthetic.mp4");
execFileSync("ffmpeg", ["-v","error","-f","lavfi","-i","color=c=blue:s=240x320:r=24","-t","2","-an","-c:v","libx264","-pix_fmt","yuv420p", videoFile], {windowsHide:true,timeout:30000});
const videoBytes = await readFile(videoFile);
const assets = createReplicationAssetStore({ root: path.join(dir,"assets"), allowedResultHosts:["fixture.oss-cn-beijing.aliyuncs.com"], fetch:async()=>new Response(videoBytes,{headers:{"content-type":"video/mp4"}}) });

const dbUrl = process.env.BY45_DB_URL;
let realDb: any;
if (dbUrl) {
  const u = new URL(dbUrl);
  assert.equal(u.hostname,"127.0.0.1"); assert.match(u.pathname,/^\/by45_[a-z0-9_]+$/); assert.equal(process.env.BY45_DB_OWNED,"true");
  const { PrismaClient } = await import("../packages/db/node_modules/@prisma/client/index.js");
  realDb = new PrismaClient({datasources:{db:{url:dbUrl}}});
}
try {
for (let round=0;round<3;round++) {
  const db = realDb ?? replicationMemoryDb();
  const a = structuredClone(base), suffix=randomUUID(); a.tenantId = `by45-${suffix}`; a.userId = `by45-user-${suffix}`; a.reference.tenantId=a.tenantId; a.portrait.tenantId=a.tenantId;
  if(realDb) { await db.tenant.create({data:{id:a.tenantId,name:"Synthetic video fixture",type:"local_business"}}); await db.user.create({data:{id:a.userId,nickname:"Synthetic"}}); }
  // LQ-34 ③④⑤：付费主体 = 租户 owner 的**通用钱包**（不再建租户积分账户 / CreditReservation）。
  await db.membership.create({data:{tenantId:a.tenantId,userId:a.userId,role:"owner",isActive:true}});
  await db.wallet.create({data:{userId:a.userId,paidBalance:1000,bonusBalance:0}});
  const walletBalance = async () => (await readLanqiWalletBalance(a.tenantId, db))!.balance;
  const repo = createReplicationRepository(db);
  let rejectedStagingReleased = false;
  const invalidStagingRuntime = createReplicationRuntime({repository:repo,stage:async()=>({referenceVideoUrl:"http://127.0.0.1/ref.mp4",portraitImageUrl:"https://assets.example.test/portrait.png",release:async()=>{rejectedStagingReleased=true;}}),submit:async()=>{throw new Error("unexpected_submit");},poll:async()=>{throw new Error("unexpected_poll");},persist:assets.persist,read:assets.read});
  await assert.rejects(()=>invalidStagingRuntime.confirm(a,input),/staged_asset_url_rejected/);
  assert.equal(rejectedStagingReleased,true);assert.equal(await db.walletLedger.count({where:{userId:a.userId}}),0);
  let submit=0,poll=0,now=Date.now(),failed=false,unknown=false,persistFail=false,queryFail=false;
const runtime = createReplicationRuntime({repository:repo,now:()=>now,stage:async()=>({referenceVideoUrl:"https://assets.example.test/ref.mp4",portraitImageUrl:"https://assets.example.test/portrait.png",release:async()=>{}}),submit:async()=>{submit++;if(unknown) throw new Error("SYNTHETIC_SECRET_MUST_NOT_LEAK"); return `task-${suffix}-${submit}`;},poll:async()=>{poll++;if(queryFail) { throw new ReplicationProviderError("provider_response_unknown",true); } return {status:failed?"FAILED":"SUCCEEDED",videoUrl:"https://fixture.oss-cn-beijing.aliyuncs.com/result.mp4",seconds:2};},persist:async(job,url)=>{if(persistFail)throw new Error("SYNTHETIC_PRIVATE_PATH");return assets.persist(job,url);},read:assets.read});
  const app=Fastify({logger:false});
  await registerViralVideoReplicationRoutes(app,{repository:repo,runtime,context:async(headers)=>({tenantId:headers["x-test-tenant"]=== "other"?"other":a.tenantId,userId:a.userId,source:"database"} as any),entitled:async tenant=>tenant!=="denied",admission:async c=>c.tenantId===a.tenantId?a:null,creditBalance:async(t:string)=>(await readLanqiWalletBalance(t,db as any))?.balance??null});
  const post=(url:string,payload:any=input)=>app.inject({method:"POST",url,payload});
  const confirmations=await Promise.all([post("/viral-video-replication/confirm"),post("/viral-video-replication/confirm")]);
  const ok=confirmations.find(r=>r.statusCode===202)!;assert.ok(ok);const id=ok.json().job.id;
  assert.equal(submit,1);assert.equal(await db.viralVideoReplicationJob.count({where:{tenantId:a.tenantId}}),1);
  assert.equal((await post("/viral-video-replication/confirm",{...input,mode:"wan-pro"})).statusCode,422);
  assert.equal((await runtime.cancel(id,a).catch(e=>e)).code,"upstream_cancellation_not_supported");
  const results=await Promise.all([post(`/viral-video-replication/jobs/${id}/refresh`,{}),post(`/viral-video-replication/jobs/${id}/refresh`,{})]);
  const done=(await repo.get(id,a.tenantId))!;assert.equal(done.status,"succeeded");assert.equal(poll,1);
  assert.equal(await walletBalance(),900);
  assert.equal((await post(`/viral-video-replication/jobs/${id}/refresh`,{})).json().job.canDownload,true);
  const download=await app.inject({method:"GET",url:`/viral-video-replication/jobs/${id}/content`});assert.equal(download.statusCode,200);assert.deepEqual(download.rawPayload,videoBytes);
  assert.equal((await app.inject({method:"GET",url:`/viral-video-replication/jobs/${id}/content`,headers:{"x-test-tenant":"other"}})).statusCode,404);
  await assert.rejects(()=>runtime.download(id,{...a,storeId:"store-other",allowedStoreIds:["store-other"]}),/job_not_found/);
  await assert.rejects(()=>runtime.download(id,{...a,entitlement:false}),/job_not_found/);
  assert.equal((await app.inject({method:"GET",url:"/viral-video-replication/jobs"})).json().jobs.length,1);
  const unsafe=JSON.stringify(publicReplicationJob(done));assert.ok(!unsafe.includes("storageKey")&&!unsafe.includes("oss-cn")&&!unsafe.includes(a.tenantId));
  for(const failMode of ["provider","persistence","unknown"]){
    failed=failMode==="provider";persistFail=failMode==="persistence";unknown=failMode==="unknown";
    const requestKey=`failure-${failMode}-${suffix}`;const made=await runtime.confirm(a,{...input,requestKey});
    if(!unknown)await runtime.refresh(made.job.id,a);
    const j=(await repo.get(made.job.id,a.tenantId))!;assert.equal(j.billingStatus,"refunded");assert.equal(j.status,unknown?"terminal_unknown":"failed");
    if(persistFail)assert.equal(j.authorizationSnapshot.providerCostFen,120);
    await Promise.all([repo.finish(j,"failed","repeat"),repo.finish(j,"failed","repeat")]);
    assert.equal(await walletBalance(),900);
    const before=submit;await runtime.confirm(a,{...input,requestKey});assert.equal(submit,before);
    await assert.rejects(()=>runtime.download(j.id,a),/asset_not_found/);
    assert.ok(!JSON.stringify(j).includes("SYNTHETIC_SECRET"));
  }
  failed=false;persistFail=false;unknown=false;
  const interrupted=await repo.create(a,{...input,requestKey:`interrupted-${suffix}`},now);await repo.claim(interrupted.job,"submitting",now);const before=submit;now+=61_000;
  await runtime.refresh(interrupted.job.id,a);assert.equal(submit,before);assert.equal((await repo.get(interrupted.job.id,a.tenantId))!.status,"terminal_unknown");
  const resumable=await runtime.confirm(a,{...input,requestKey:`poll-recover-${suffix}`});queryFail=true;await runtime.refresh(resumable.job.id,a);assert.equal((await repo.get(resumable.job.id,a.tenantId))!.status,"processing");queryFail=false;now+=15_001;await runtime.refresh(resumable.job.id,a);assert.equal((await repo.get(resumable.job.id,a.tenantId))!.status,"succeeded");
  assert.equal(await walletBalance(),800);
  assert.equal(await db.walletLedger.count({where:{userId:a.userId,type:"refund"}}),4);
  assert.equal((await post("/viral-video-replication/confirm",{...input,brand:"forged"})).statusCode,400);
  await app.close();
  const blocked=Fastify({logger:false});await registerViralVideoReplicationRoutes(blocked,{context:async()=>({tenantId:a.tenantId,userId:a.userId,source:"database"} as any),entitled:async()=>true});
  const quote=await blocked.inject({method:"POST",url:"/viral-video-replication/quote",payload:input});assert.equal(quote.json().canConfirm,false);assert.ok(quote.json().gaps.includes("server_asset_authorization_required"));
  assert.equal((await blocked.inject({method:"POST",url:"/viral-video-replication/confirm",payload:input})).statusCode,422);await blocked.close();
}
} finally { if(realDb)await realDb.$disconnect(); }
assert.equal(externalCalls,0);
console.log(JSON.stringify({result:"BY45_FOUNDATION_PASS",rounds:3,db:realDb?"isolated_postgresql":"transactional_fixture",externalCalls,providerCalls:0,costYuan:0,artifactProbe:"ffprobe-h264",temporarySyntheticAssetRoot:dir}));
}
main().catch(error => { console.error(error); process.exitCode=1; });
