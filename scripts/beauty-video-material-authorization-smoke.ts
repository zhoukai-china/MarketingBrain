import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp,mkdir,writeFile,readFile } from "node:fs/promises";
import { randomUUID,randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import { createCanvas } from "../apps/api/node_modules/@napi-rs/canvas/index.js";
import { createVideoAssetAuthorization } from "../apps/api/src/services/beauty-video-asset-authorization.ts";
import { createVideoPrivateFileReader,videoFileHash } from "../apps/api/src/services/beauty-video-private-files.ts";
import { createLocalPrivateVideoStaging,createVideoPrivateStaging,assertProviderStagingOrigin } from "../apps/api/src/services/beauty-video-private-staging.ts";
import { createVideoMaterialIntegration } from "../apps/api/src/services/beauty-video-material-integration.ts";
import { createReplicationAssetStore } from "../apps/api/src/services/viral-video-replication-assets.ts";
import { registerViralVideoReplicationRoutes } from "../apps/api/src/routes/viral-video-replication.ts";
import { replicationSchema } from "../apps/api/src/services/viral-video-replication.ts";
import { replicationMemoryDb } from "./fixtures/replication-test-db.ts";

async function main(){
assert.equal(existsSync("apps/api/src/services/beauty-video-asset-authorization.ts"), true, "BY46 missing server-persisted file/store authorization admission");
assert.match(readFileSync("packages/db/prisma/schema.prisma", "utf8"), /model BeautyVideoAssetAuthorization\s*\{/);
const localFetch=globalThis.fetch;let forbiddenNetwork=0,localRequests=0;
globalThis.fetch=async()=>{forbiddenNetwork++;throw new Error("external_network_forbidden");};
const dir=await mkdtemp(path.join(tmpdir(),"by46-offline-")),upload=path.join(dir,"uploads"),inspection=path.join(dir,"inspection");await mkdir(upload,{recursive:true});
const videoPath=path.join(dir,"fixture.mp4");execFileSync("ffmpeg",["-v","error","-f","lavfi","-i","color=c=blue:s=240x320:r=24","-t","2","-an","-c:v","libx264","-pix_fmt","yuv420p",videoPath],{windowsHide:true,timeout:30000});const video=await readFile(videoPath);
const canvas=createCanvas(240,320),ctx=canvas.getContext("2d");ctx.fillStyle="#335577";ctx.fillRect(0,0,240,320);const portrait=canvas.toBuffer("image/png");
const read=createVideoPrivateFileReader(upload,inspection);
let dbClient:any;
if(process.env.BY45_DB_URL){const u=new URL(process.env.BY45_DB_URL);assert.equal(u.hostname,"127.0.0.1");assert.equal(u.pathname,"/by45_fixture");assert.equal(process.env.BY45_DB_OWNED,"true");const {PrismaClient}=await import("../packages/db/node_modules/@prisma/client/index.js");dbClient=new PrismaClient({datasources:{db:{url:u.toString()}}});
  // This runner just created an EMPTY owned database. Exercise the additive migration from its base.
  assert.equal(await dbClient.beautyVideoAssetAuthorization.count(),0);assert.equal(await dbClient.beautyVideoStagingLease.count(),0);
  await dbClient.$transaction(async(tx:any)=>{await tx.$executeRawUnsafe('DROP TABLE "BeautyVideoStagingLease"');await tx.$executeRawUnsafe('DROP TABLE "BeautyVideoAssetAuthorization"');const sql=readFileSync("packages/db/prisma/migrations/202609050001_beauty_video_material_authorizations/migration.sql","utf8").replace(/--[^\n]*/g,"");for(const statement of sql.split(";").filter(x=>x.trim()))await tx.$executeRawUnsafe(statement);});
}
try{for(let round=0;round<3;round++){
  const db=dbClient??replicationMemoryDb(),suffix=randomUUID(),actor={tenantId:`by46-${suffix}`,userId:`by46-user-${suffix}`},storeId=`by46-store-${suffix}`;let now=Date.now()+10;
  await db.tenant.create({data:{id:actor.tenantId,name:"Synthetic",type:"local_business"}});await db.user.create({data:{id:actor.userId,nickname:"Synthetic"}});await db.store.create({data:{id:storeId,tenantId:actor.tenantId,name:"Synthetic"}});await db.membership.create({data:{tenantId:actor.tenantId,userId:actor.userId,storeId,role:"owner",isActive:true}});await db.tenantProductEntitlement.create({data:{tenantId:actor.tenantId,productCode:"beauty-industry",status:"active",source:"synthetic",startsAt:new Date(now-1000),expiresAt:null}});await db.creditAccount.create({data:{tenantId:actor.tenantId,balance:1000}});
  const auth=createVideoAssetAuthorization(db,read,()=>now);
  async function file(bytes:Buffer,mimeType:string){const id=randomUUID(),tenantDir=path.join(upload,actor.tenantId);await mkdir(tenantDir,{recursive:true});const storagePath=path.join(tenantDir,id);await writeFile(storagePath,bytes,{flag:"wx"});return db.uploadedFile.create({data:{id,...actor,filename:"synthetic",mimeType,byteSize:bytes.length,storagePath,sha256:videoFileHash(bytes)}});}
  const ref=await file(video,"video/mp4"),photo=await file(portrait,"image/png"),basis=await file(Buffer.from("Synthetic rights declaration; not evidence of legal authenticity."),"text/plain");
  const declaration=(fileId:string,subjectRole:string,key=randomUUID())=>({fileId,basisFileId:basis.id,subjectRole,purpose:"video_replacement",expiresAt:new Date(now+3600_000).toISOString(),requestKey:key,rightsDeclared:true});
  const declareRef=declaration(ref.id,"reference"),declared=await Promise.all([auth.declare(actor,declareRef),auth.declare(actor,declareRef)]);assert.equal(declared[0].id,declared[1].id);const declaredPhoto=await auth.declare(actor,declaration(photo.id,"owner"));
  assert.equal(declaredPhoto.assurance,"user_declared_not_independently_verified");assert.equal(declaredPhoto.status,"declaration_recorded");
  for(const extra of [{storeId:"forged"},{tenantId:"other"},{rights:["anything"]},{version:99}])await assert.rejects(()=>auth.declare(actor,{...declaration(photo.id,"owner"),...extra}),/invalid_declaration/);
  await assert.rejects(()=>auth.declare(actor,{...declaration(photo.id,"owner"),purpose:"voice_clone"}),/invalid_declaration/);
  await assert.rejects(()=>auth.declare(actor,declaration(photo.id,"kol")),/asset_scope_or_request_conflict/);
  const duplicatePhoto=await file(portrait,"image/png");await assert.rejects(()=>auth.declare(actor,declaration(duplicatePhoto.id,"kol")),/asset_scope_or_request_conflict/);
  await assert.rejects(()=>auth.inspect({...actor,tenantId:"other"},photo.id,"owner"),/product_access_denied/);
  const originalPhotoPath=photo.storagePath;await db.uploadedFile.update({where:{id:photo.id},data:{storagePath:videoPath}});await assert.rejects(()=>auth.inspect(actor,photo.id,"owner"),/file_not_found/);await db.uploadedFile.update({where:{id:photo.id},data:{storagePath:originalPhotoPath}});
  await writeFile(photo.storagePath,Buffer.alloc(portrait.length));await assert.rejects(()=>auth.inspect(actor,photo.id,"owner"),/file_changed/);await writeFile(photo.storagePath,portrait);
  await db.uploadedFile.update({where:{id:photo.id},data:{byteSize:6*1024*1024}});await assert.rejects(()=>auth.inspect(actor,photo.id,"owner"),/file_metadata_invalid/);await db.uploadedFile.update({where:{id:photo.id},data:{byteSize:portrait.length}});
  const invalid=await file(Buffer.from("not an image"),"image/png");await assert.rejects(()=>auth.declare(actor,declaration(invalid.id,"owner")),/file_type_invalid/);
  const tinyCanvas=createCanvas(20,20),tiny=await file(tinyCanvas.toBuffer("image/png"),"image/png");await assert.rejects(()=>auth.declare(actor,declaration(tiny.id,"kol")),/file_dimensions_invalid/);
  await db.membership.updateMany({where:{tenantId:actor.tenantId,userId:actor.userId},data:{role:"staff"}});await assert.rejects(()=>auth.declare(actor,declareRef),/asset_declaration_forbidden/);await db.membership.updateMany({where:{tenantId:actor.tenantId,userId:actor.userId},data:{role:"owner"}});
  const input=replicationSchema.parse({model:"aliyun_strict",referenceFileId:ref.id,portraitFileId:photo.id,requestKey:randomUUID(),visualRightsConfirmed:true,audioRightsConfirmed:true,performerConsentConfirmed:true,portraitConsentConfirmed:true});
  const policy={creditCost:100,maxCostFen:120,maxOutputSeconds:2};
  const unavailable=createVideoMaterialIntegration({db,authorization:auth,policy,now:()=>now});assert.equal((await unavailable.admission(actor as any,input))!.stagingReady,false);assert.equal(unavailable.runtime,undefined);
  const savedExpiry=(await db.beautyVideoAssetAuthorization.findUnique({where:{id:declaredPhoto.id}})).expiresAt;
  await db.beautyVideoAssetAuthorization.update({where:{id:declaredPhoto.id},data:{expiresAt:new Date(now-1)}});await assert.rejects(()=>auth.inspect(actor,photo.id,"owner"),/asset_authorization_required/);await db.beautyVideoAssetAuthorization.update({where:{id:declaredPhoto.id},data:{expiresAt:savedExpiry}});
  const basisBytes=await readFile(basis.storagePath);await writeFile(basis.storagePath,Buffer.alloc(basisBytes.length));await assert.rejects(()=>auth.inspect(actor,photo.id,"owner"),/file_changed/);await writeFile(basis.storagePath,basisBytes);
  await assert.rejects(()=>auth.admission(actor,{...input,portraitImageUrl:"https://attacker.invalid/x.png"},{...policy,stagingReady:true}),/owned_file_ids_required/);
  const server=Fastify({logger:false});let driver:ReturnType<typeof createLocalPrivateVideoStaging>,staging:ReturnType<typeof createVideoPrivateStaging>;
  server.get<{Params:{key:string}}>("/private-video-staging/:key",async(req,reply)=>{try{const o=await staging.authorizeFetch(req.params.key);const bytes=await driver.read(`${origin}${req.url}`,o);return reply.header("Cache-Control","private, no-store").type(o.mimeType).send(bytes);}catch{return reply.code(404).send({error:"not_found"});}});
  const origin=await server.listen({port:0,host:"127.0.0.1"});driver=createLocalPrivateVideoStaging({root:path.join(dir,`staging-${round}`),origin,signingKey:randomBytes(32),now:()=>now});
  assert.throws(()=>assertProviderStagingOrigin(origin,[origin]),/staging_origin_not_approved/);
  assert.throws(()=>createVideoMaterialIntegration({db,authorization:auth,driver,policy,execution:{access:"provider_https",submit:async()=>"bad",poll:async()=>({status:"RUNNING"}),persist:async()=>{throw new Error("unexpected");},read:async()=>Buffer.alloc(0)}}),/staging_transport_mismatch/);
  const assets=createReplicationAssetStore({root:path.join(dir,`results-${round}`),allowedResultHosts:["fixture.oss-cn-beijing.aliyuncs.com"],fetch:async()=>new Response(video,{headers:{"content-type":"video/mp4"}})});
  let submitCalls=0;const execution={access:"local_only" as const,submit:async(s:any)=>{submitCalls++;for(const url of [s.referenceVideoUrl,s.portraitImageUrl]){assert.equal(new URL(url).origin,origin);localRequests++;const response=await localFetch(url,{redirect:"error",signal:AbortSignal.timeout(5000)});assert.equal(response.status,200);await response.arrayBuffer();}return `local-task-${suffix}-${submitCalls}`;},poll:async()=>({status:"SUCCEEDED",videoUrl:"https://fixture.oss-cn-beijing.aliyuncs.com/result.mp4",seconds:2}),persist:assets.persist,read:assets.read};
  const integration=createVideoMaterialIntegration({db,authorization:auth,driver,execution,policy,now:()=>now});staging=integration.staging!;
  const app=Fastify({logger:false});await registerViralVideoReplicationRoutes(app,{...integration,context:async headers=>({...actor,tenantId:headers["x-test-other"]?"other":actor.tenantId,source:"database"} as any),entitled:async()=>true});
  try{
    const declaredOverHttp=await app.inject({method:"POST",url:"/viral-video-replication/material-authorizations",payload:declareRef});assert.equal(declaredOverHttp.statusCode,201);assert.equal(declaredOverHttp.json().authorization.id,declared[0].id);
    assert.equal((await app.inject({method:"POST",url:"/viral-video-replication/material-authorizations",payload:{...declareRef,storeId:"forged"}})).statusCode,400);
    const quote=await app.inject({method:"POST",url:"/viral-video-replication/quote",payload:input});assert.equal(quote.statusCode,200);assert.equal(quote.json().canConfirm,true);
    const confirmations=await Promise.all([app.inject({method:"POST",url:"/viral-video-replication/confirm",payload:input}),app.inject({method:"POST",url:"/viral-video-replication/confirm",payload:input})]);assert.ok(confirmations.some(r=>r.statusCode===202));
    const confirmed=await app.inject({method:"POST",url:"/viral-video-replication/confirm",payload:input});assert.equal(confirmed.statusCode,202);const id=confirmed.json().job.id;assert.equal(submitCalls,1);
    const j=(await integration.repository.get(id,actor.tenantId))!;const lease=await db.beautyVideoStagingLease.findUnique({where:{id:j.authorizationSnapshot.stagingLeaseId}});assert.equal(lease.status,"active");const o=lease.objects[0],url=await driver.url(o);
    localRequests++;assert.equal((await localFetch(url.replace(/sig=./,"sig=x"),{redirect:"error"})).status,404);
    const done=await app.inject({method:"POST",url:`/viral-video-replication/jobs/${id}/refresh`,payload:{}});assert.equal(done.statusCode,200);assert.equal(done.json().job.status,"succeeded");assert.equal((await db.creditAccount.findUnique({where:{tenantId:actor.tenantId}})).balance,900);
    assert.equal((await db.beautyVideoStagingLease.findUnique({where:{id:lease.id}})).status,"released");localRequests++;assert.equal((await localFetch(url,{redirect:"error"})).status,404);
    const repeat=await app.inject({method:"POST",url:"/viral-video-replication/confirm",payload:input});assert.equal(repeat.json().idempotent,true);assert.equal(submitCalls,1);
    const download=await app.inject({method:"GET",url:`/viral-video-replication/jobs/${id}/content`});assert.equal(videoFileHash(download.rawPayload),videoFileHash(video));assert.equal((await app.inject({method:"GET",url:`/viral-video-replication/jobs/${id}/content`,headers:{"x-test-other":"true"}})).statusCode,404);
    assert.ok(!JSON.stringify(confirmed.json()).includes("sig=")&&!JSON.stringify(done.json()).includes(dir));
    const otherUser=`other-${suffix}`;await db.user.create({data:{id:otherUser,nickname:"Synthetic"}});
    const otherJob=await db.viralVideoReplicationJob.create({data:{tenantId:actor.tenantId,userId:otherUser,requestKey:randomUUID(),model:j.model,creditCost:0,billingStatus:"refunded",status:"failed",authorizationSnapshot:j.authorizationSnapshot}});
    const ownHistory=await app.inject({method:"GET",url:"/viral-video-replication/jobs"});assert.equal(ownHistory.statusCode,200,"BY46 unrelated user's job must not break authorized history");assert.deepEqual(ownHistory.json().jobs.map((x:any)=>x.id),[id]);assert.ok(!ownHistory.body.includes(otherJob.id));
    const changedStore=await db.store.create({data:{tenantId:actor.tenantId,name:"Synthetic alternate"}});await db.membership.updateMany({where:{tenantId:actor.tenantId,userId:actor.userId},data:{storeId:changedStore.id}});assert.equal((await app.inject({method:"GET",url:`/viral-video-replication/jobs/${id}/content`})).statusCode,404);await db.membership.updateMany({where:{tenantId:actor.tenantId,userId:actor.userId},data:{storeId}});
    const beforeJobs=await db.viralVideoReplicationJob.count({where:{tenantId:actor.tenantId}});const admission=(await integration.admission(actor as any,input))!;
    let removeCalls=0;const failingDriver={...driver,put:async()=>{throw new Error("injected_staging_failure");},remove:async(object:any)=>{removeCalls++;await driver.remove(object);}};const failIntegration=createVideoMaterialIntegration({db,authorization:auth,driver:failingDriver,execution,policy,now:()=>now});await assert.rejects(()=>failIntegration.runtime!.confirm(admission,{...input,requestKey:randomUUID()}),/staging_failed/);assert.equal(removeCalls,2);assert.equal(await db.viralVideoReplicationJob.count({where:{tenantId:actor.tenantId}}),beforeJobs);assert.equal(submitCalls,1);
    const expiryStage=await staging.stage(admission,{...input,requestKey:randomUUID()});const expiryLease=await db.beautyVideoStagingLease.findUnique({where:{id:expiryStage.leaseId}});now=+expiryLease.expiresAt+1;await assert.rejects(()=>expiryStage.assertScope(),/staging_lease_unavailable/);await staging.sweep();assert.equal((await db.beautyVideoStagingLease.findUnique({where:{id:expiryLease.id}})).status,"released");
    const cleanStage=await staging.stage(admission,{...input,requestKey:randomUUID()});const cleanLease=await db.beautyVideoStagingLease.findUnique({where:{id:cleanStage.leaseId}}),cleanUrl=await driver.url(cleanLease.objects[0]);
    const brokenCleanup=createVideoPrivateStaging(db,auth,{...driver,remove:async()=>{throw new Error("synthetic_remove_failure");}},()=>now);
    await assert.rejects(()=>brokenCleanup.release(cleanLease.id),/staging_cleanup_failed/);assert.equal((await db.beautyVideoStagingLease.findUnique({where:{id:cleanLease.id}})).status,"cleanup_failed");localRequests++;assert.equal((await localFetch(cleanUrl,{redirect:"error"})).status,404);await staging.sweep();assert.equal((await db.beautyVideoStagingLease.findUnique({where:{id:cleanLease.id}})).status,"released");
    // Revoke after a reservation is claimed, but before submit. No external call, one full release.
    const originalClaim=integration.repository.claim;let revoked=false;integration.repository.claim=async(...args:any[])=>{const result=await (originalClaim as any)(...args);if(result&&!revoked){revoked=true;await auth.revoke(actor,declaredPhoto.id);}return result;};
    const failed=await integration.runtime!.confirm((await integration.admission(actor as any,input))!,{...input,requestKey:randomUUID()});assert.equal(failed.job.status,"failed");assert.equal(failed.job.billingStatus,"refunded");assert.equal(submitCalls,1);assert.equal((await db.creditAccount.findUnique({where:{tenantId:actor.tenantId}})).balance,900);
    const repeatRevoke=await auth.revoke(actor,declaredPhoto.id);assert.equal(repeatRevoke.version,2);assert.equal(await db.auditLog.count({where:{tenantId:actor.tenantId,action:"beauty_video.revoke"}}),1);
    // Persisted in-flight fixture models a worker that sent before revocation; no additional submit.
    const pending=await integration.repository.create(admission,{...input,requestKey:randomUUID()},now);await integration.repository.update(pending.job,{status:"submitted",providerTaskId:`historical-local-${suffix}`});
    assert.equal((await app.inject({method:"POST",url:`/viral-video-replication/material-authorizations/${declaredPhoto.id}/revoke`,payload:{}})).json().authorization.version,2);
    assert.equal((await integration.repository.get(pending.job.id,actor.tenantId))!.status,"terminal_unknown");assert.equal((await db.creditAccount.findUnique({where:{tenantId:actor.tenantId}})).balance,900);
    assert.equal((await app.inject({method:"POST",url:"/viral-video-replication/confirm",payload:{...input,requestKey:randomUUID()}})).statusCode,422);
    assert.equal((await app.inject({method:"GET",url:`/viral-video-replication/jobs/${id}/content`})).statusCode,422);
    const revokedHistory=await app.inject({method:"GET",url:"/viral-video-replication/jobs"});assert.equal(revokedHistory.statusCode,200);assert.deepEqual(revokedHistory.json().jobs,[]);
    const audit=await db.auditLog.findMany({where:{tenantId:actor.tenantId}});for(const event of audit){assert.ok(!event.detail.includes("sig=")&&!event.detail.includes(upload)&&!event.detail.includes("Synthetic rights"));}
    assert.equal(await db.creditReservation.count({where:{tenantId:actor.tenantId,status:"released"}}),2);assert.equal(await db.creditReservation.count({where:{tenantId:actor.tenantId,status:"settled"}}),1);
  }finally{await app.close();await server.close();}
}
if(dbClient){const before=await dbClient.beautyVideoAssetAuthorization.count();assert.ok(before>0);await dbClient.$transaction(async(tx:any)=>{await tx.$executeRawUnsafe('ALTER TABLE "BeautyVideoStagingLease" RENAME TO "BeautyVideoStagingLease_by46_rollback"');await tx.$executeRawUnsafe('ALTER TABLE "BeautyVideoAssetAuthorization" RENAME TO "BeautyVideoAssetAuthorization_by46_rollback"');const records=await tx.$queryRawUnsafe('SELECT count(*)::int AS count FROM "BeautyVideoAssetAuthorization_by46_rollback"');assert.equal(records[0].count,before);await tx.$executeRawUnsafe('ALTER TABLE "BeautyVideoAssetAuthorization_by46_rollback" RENAME TO "BeautyVideoAssetAuthorization"');await tx.$executeRawUnsafe('ALTER TABLE "BeautyVideoStagingLease_by46_rollback" RENAME TO "BeautyVideoStagingLease"');});assert.equal(await dbClient.beautyVideoAssetAuthorization.count(),before);}
assert.equal(forbiddenNetwork,0);console.log(JSON.stringify({result:"BY46_PASS",rounds:3,db:dbClient?"isolated_postgresql":"transactional_fixture",migration:dbClient?"additive_and_preserve_data_rollback_pass":"not_run",localRequests,providerCalls:0,externalCalls:forbiddenNetwork,costYuan:0,artifactRoot:dir}));
}finally{await dbClient?.$disconnect();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
