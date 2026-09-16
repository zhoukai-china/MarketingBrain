import assert from "node:assert/strict";
import { existsSync,readFileSync } from "node:fs";
import { mkdtemp,mkdir,writeFile,readFile } from "node:fs/promises";
import { createHash,createHmac,randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync,spawn } from "node:child_process";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import { createCanvas } from "../apps/api/node_modules/@napi-rs/canvas/index.js";
import { createControlledVideoIntegration } from "../apps/api/src/services/beauty-video-controlled-execution.ts";
import { createVideoAssetAuthorization } from "../apps/api/src/services/beauty-video-asset-authorization.ts";
import { createVideoPrivateFileReader } from "../apps/api/src/services/beauty-video-private-files.ts";
import { createVideoExecutionPermits,videoExecutionScopeSchema,videoExecutionRequestHash,VIDEO_EXECUTION_VERSION,VIDEO_PRICE_VERSION } from "../apps/api/src/services/beauty-video-execution-permit.ts";
import { replicationSchema,REPLICATION_MODEL,REPLICATION_CONTRACT } from "../apps/api/src/services/viral-video-replication.ts";
import { registerViralVideoReplicationRoutes } from "../apps/api/src/routes/viral-video-replication.ts";
import { replicationMemoryDb } from "./fixtures/replication-test-db.ts";
import { createBeautyUsageMeter } from "../apps/api/src/services/beauty-usage-metering.ts";
import { readLanqiWalletBalance } from "../apps/api/src/services/lanqi-wallet.ts";
assert.ok(existsSync("apps/api/src/services/beauty-video-controlled-execution.ts"),"BY50 missing default-disabled controlled execution assembly");
assert.match(readFileSync("apps/api/src/routes/viral-video-replication.ts","utf8"),/createControlledVideoIntegration/,"BY50 official route has no persistent authorized execution");
console.log("BY50 execution assembly baseline PASS");

const hash=(b:Buffer|string)=>createHash("sha256").update(b).digest("hex");
const authority="offline-synthetic-authority-by50-not-real-credentials";
function ossFixture(){
 const objects=new Map<string,{body:Buffer;headers:Record<string,string>}>();let calls=0,putCount=0,failPut=0,failDelete=false;
 const transport=async(r:any)=>{calls++;const u=new URL(r.url),q=u.search.replace(/=$/,"");const response=(status:number,body="",headers:any={})=>({status,body:Buffer.from(body),headers});
  if(q==="?bucketInfo")return response(200,'<BucketInfo><Bucket><Name>synthetic-by50</Name><Location>oss-cn-beijing</Location><ExtranetEndpoint>oss-cn-beijing.aliyuncs.com</ExtranetEndpoint><StorageClass>Standard</StorageClass><AccessControlList><Grant>private</Grant></AccessControlList><BlockPublicAccess>true</BlockPublicAccess><CrossRegionReplication>Disabled</CrossRegionReplication></Bucket></BucketInfo>');
  if(q==="?versioning")return response(200,'<VersioningConfiguration/>');
  if(q==="?lifecycle")return response(200,'<LifecycleConfiguration><Rule><ID>fixture</ID><Prefix>beauty-industry/video-staging/v1/acceptance/</Prefix><Status>Enabled</Status><Expiration><Days>1</Days></Expiration></Rule></LifecycleConfiguration>');
  if(r.method==="PUT"){putCount++;if(failPut===putCount)return response(500);const h=Object.fromEntries(Object.entries(r.headers).map(([k,v])=>[k.toLowerCase(),String(v)]));assert.equal(h["x-oss-forbid-overwrite"],"true");if(objects.has(u.pathname))return response(409);objects.set(u.pathname,{body:r.body,headers:{"x-oss-object-type":"Normal","content-type":h["content-type"],"content-length":String(r.body.length),"x-oss-meta-sha256":h["x-oss-meta-sha256"],"x-oss-meta-binding":h["x-oss-meta-binding"]}});return response(200,"",{etag:createHash("md5").update(r.body).digest("hex")});}
  if(r.method==="HEAD"){const o=objects.get(u.pathname);return o?response(200,"",o.headers):response(404);}
  if(r.method==="DELETE"){if(failDelete)return response(503);objects.delete(u.pathname);return response(204);}
  throw new Error("unexpected_sdk_request");
 };
 return {transport,objects,count:()=>calls,putCount:()=>putCount,set:(p:any)=>{if(p.failPut!==undefined)failPut=p.failPut;if(p.failDelete!==undefined)failDelete=p.failDelete;}};
}

async function main(){
 const originalFetch=globalThis.fetch;let external=0;globalThis.fetch=async()=>{external++;throw new Error("external_network_forbidden");};
 const root=await mkdtemp(path.join(tmpdir(),"by50-offline-")),upload=path.join(root,"uploads");await mkdir(upload);
 const videoPath=path.join(root,"synthetic.mp4");execFileSync("ffmpeg",["-v","error","-f","lavfi","-i","color=c=blue:s=240x320:r=24","-t","2","-an","-c:v","libx264","-pix_fmt","yuv420p",videoPath],{timeout:30000,windowsHide:true});const video=await readFile(videoPath);
 const canvas=createCanvas(240,320);canvas.getContext("2d").fillRect(0,0,240,320);const portrait=canvas.toBuffer("image/png");
 let client:any;
 if(process.env.BY45_DB_URL){const u=new URL(process.env.BY45_DB_URL);assert.equal(u.hostname,"127.0.0.1");assert.equal(u.pathname,"/by45_fixture");assert.equal(process.env.BY45_DB_OWNED,"true");const {PrismaClient}=await import("../packages/db/node_modules/@prisma/client/index.js");client=new PrismaClient({datasources:{db:{url:u.toString()}}});
  assert.equal(await client.beautyVideoExecutionPermit.count(),0);
  await client.$transaction(async(tx:any)=>{await tx.$executeRawUnsafe('DROP TABLE "BeautyVideoExecutionPermit"');const sql=readFileSync("packages/db/prisma/migrations/202609050002_beauty_video_execution_permit/migration.sql","utf8").replace(/--[^\n]*/g,"");for(const statement of sql.split(";").filter(s=>s.trim()))await tx.$executeRawUnsafe(statement);});
 }
 try{for(let round=0;round<3;round++){
  const db=client??replicationMemoryDb(),suffix=randomUUID(),actor={tenantId:`by50-${suffix}`,userId:`user-${suffix}`},storeId=`store-${suffix}`;let now=Date.now()+10;
  await db.tenant.create({data:{id:actor.tenantId,name:"Synthetic",type:"local_business"}});await db.user.create({data:{id:actor.userId,nickname:"Synthetic"}});await db.store.create({data:{id:storeId,tenantId:actor.tenantId,name:"Synthetic"}});await db.membership.create({data:{...actor,storeId,role:"owner",isActive:true}});await db.tenantProductEntitlement.create({data:{tenantId:actor.tenantId,productCode:"beauty-industry",status:"active",source:"synthetic",startsAt:new Date(now-1000),expiresAt:null}});
  // LQ-34 ⑤：出片许可的预算校验已与扣费同源 → 读**owner 通用钱包余额**（不再是租户积分账户）。
  await db.wallet.create({data:{userId:actor.userId,paidBalance:1000,bonusBalance:0}});
  const auth=createVideoAssetAuthorization(db,createVideoPrivateFileReader(upload,path.join(root,"inspect")),()=>now);
  async function file(b:Buffer,mimeType:string){const id=randomUUID(),dir=path.join(upload,actor.tenantId);await mkdir(dir,{recursive:true});const storagePath=path.join(dir,id);await writeFile(storagePath,b,{flag:"wx"});return db.uploadedFile.create({data:{id,...actor,filename:"synthetic",mimeType,byteSize:b.length,sha256:hash(b),storagePath}});}
  const ref=await file(video,"video/mp4"),photo=await file(portrait,"image/png"),basis=await file(Buffer.from("Synthetic declaration; not legal proof"),"text/plain");
  for(const [fileId,subjectRole]of[[ref.id,"reference"],[photo.id,"owner"]])await auth.declare(actor,{fileId,subjectRole,basisFileId:basis.id,purpose:"video_replacement",expiresAt:new Date(now+3600000).toISOString(),rightsDeclared:true,requestKey:randomUUID()});
  const fresh=()=>replicationSchema.parse({model:"aliyun_strict",referenceFileId:ref.id,portraitFileId:photo.id,requestKey:randomUUID(),visualRightsConfirmed:true,audioRightsConfirmed:true,performerConsentConfirmed:true,portraitConsentConfirmed:true});
  const env={BEAUTY_VIDEO_EXECUTION_MODE:"controlled",BEAUTY_VIDEO_STAGING_DRIVER:"aliyun_oss",BEAUTY_VIDEO_EXECUTION_AUTHORITY_KEY:authority,BEAUTY_VIDEO_RESULT_HOSTS:"synthetic-output.oss-cn-beijing.aliyuncs.com",ALIYUN_VIDEO_REPLICATION_MODEL:REPLICATION_MODEL,ALIYUN_VIDEO_REPLICATION_ENDPOINT:"https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/video-synthesis",ALIYUN_VIDEO_REPLICATION_API_KEY:"sk-SYNTHETIC_ONLY_NOT_A_REAL_KEY",BEAUTY_VIDEO_OSS_REGION:"cn-beijing",BEAUTY_VIDEO_OSS_BUCKET:"synthetic-by50",BEAUTY_VIDEO_OSS_PREFIX:"beauty-industry/video-staging/v1/acceptance/",BEAUTY_VIDEO_OSS_APPROVED_ORIGIN:"https://synthetic-by50.oss-cn-beijing.aliyuncs.com",BEAUTY_VIDEO_OSS_ACCESS_KEY_ID:"STS.SYNTHETICACCESSKEY50",BEAUTY_VIDEO_OSS_ACCESS_KEY_SECRET:"SYNTHETIC_OSS_SECRET_ONLY_50",BEAUTY_VIDEO_OSS_SECURITY_TOKEN:"SYNTHETIC_OSS_STS_TOKEN",BEAUTY_VIDEO_OSS_CREDENTIAL_EXPIRES_AT:new Date(now+7200000).toISOString()};
  const oss=ossFixture();let submits=0,polls=0,downloads=0,submitFault=false,pollFault=false,resultFault=false,providerState="SUCCEEDED",usage=2;
  const providerFetch:typeof fetch=async(url,init)=>{const u=new URL(String(url));assert.equal(u.origin,"https://dashscope.aliyuncs.com");assert.equal(init?.redirect,"error");
    if(init?.method==="POST"){submits++;assert.equal((init.headers as any)["X-DashScope-Async"],"enable");const b=JSON.parse(String(init.body));assert.equal(b.model,REPLICATION_MODEL);assert.equal(b.input.watermark,true);assert.equal(b.parameters.check_image,true);if(submitFault)throw new Error("synthetic timeout");return new Response(JSON.stringify({output:{task_id:`synthetic-${suffix}-${submits}`,task_status:"PENDING"}}));}
    polls++;if(pollFault)return new Response("not logged",{status:503});return new Response(JSON.stringify({output:{task_id:u.pathname.split("/").at(-1),task_status:providerState,results:{video_url:"https://synthetic-output.oss-cn-beijing.aliyuncs.com/result.mp4"}},usage:{video_duration:usage}}));};
  const resultFetch:typeof fetch=async()=>{downloads++;return new Response(resultFault?Buffer.from("invalid"):video,{headers:{"content-type":"video/mp4"}});};
  const options={db,authorization:auth,environment:env,policy:{creditCost:100,maxCostFen:0,maxOutputSeconds:30},now:()=>now,resultRoot:path.join(root,`result-${round}`),offlineTransport:oss.transport,providerFetch,resultFetch};
  const integrated=createControlledVideoIntegration(options),second=createControlledVideoIntegration(options);
  async function appFor(i=integrated){const app=Fastify({logger:false});await registerViralVideoReplicationRoutes(app,{...i,context:async h=>({...actor,...(h["x-foreign"]?{tenantId:"foreign"}:{}),source:"database"} as any),entitled:async()=>true,creditBalance:async()=>(await readLanqiWalletBalance(actor.tenantId,db))?.balance??null});return app;}
  const app=await appFor(),app2=await appFor(second);
  const call=(url:string,payload:any,appInstance=app)=>appInstance.inject({method:"POST",url:`/viral-video-replication/${url}`,payload});
  // 余额口径统一为 owner 钱包（LQ-34）：与扣费 / 退款同一本账。
  const credits=async()=>(await readLanqiWalletBalance(actor.tenantId,db))!.balance;
  async function permit(input:any,changes:any={}){const a=await auth.admission(actor,input,{creditCost:100,maxCostFen:120,maxOutputSeconds:2,stagingReady:true});
    const bound=(x:any)=>({fileId:x.fileId,sha256:x.sha256,evidenceId:x.evidenceId,version:x.authorizationVersion,role:x.role});
    const scope=videoExecutionScopeSchema.parse({version:VIDEO_EXECUTION_VERSION,contract:REPLICATION_CONTRACT,permitId:randomUUID(),...actor,storeId,requestKey:input.requestKey,purpose:"video_replacement",provider:"aliyun_bailian",model:REPLICATION_MODEL,region:"cn-beijing",access:"local_only",mode:input.mode,template:input.template,requestHash:videoExecutionRequestHash(input),reference:bound(a.reference),portrait:bound(a.portrait),priceVersion:VIDEO_PRICE_VERSION,maxOutputSeconds:2,maxSubmit:1,maxPoll:4,maxStorageHttp:24,maxDownload:1,maxCostFen:130,storageCostUpperFen:10,storageCostEvidenceHash:hash("synthetic costs only not actual cloud price"),issuedAt:now-1000,expiresAt:now+3600000,...changes});
    return db.beautyVideoExecutionPermit.create({data:{id:scope.permitId,...actor,storeId,requestKey:input.requestKey,scope,signature:createHmac("sha256",authority).update(JSON.stringify(scope)).digest("hex")}});
  }
  try{
    assert.equal((await call("confirm",fresh())).statusCode,422);assert.equal(oss.count(),0);assert.equal(submits,0);assert.equal(await credits(),1000);
    const input=fresh(),p=await permit(input);assert.equal((await call("quote",input)).json().canConfirm,true);assert.equal(oss.count(),0);
    for(const extra of[{grantId:p.id},{maxCostFen:999999},{maxSubmit:2},{tenantId:"foreign"}])assert.equal((await call("confirm",{...input,...extra})).statusCode,400);
    assert.equal((await app.inject({method:"POST",url:"/viral-video-replication/confirm",headers:{"x-foreign":"true"},payload:input})).statusCode,403);
    const attempts=await Promise.all([call("confirm",input),call("confirm",input,app2)]);assert.ok(attempts.some(r=>r.statusCode===202),attempts.map(r=>r.body).join("|"));assert.equal(submits,1);
    const replay=await call("confirm",input);assert.equal(replay.statusCode,202,replay.body);assert.equal(replay.json().idempotent,true);const jobId=replay.json().job.id;
    const done=await call(`jobs/${jobId}/refresh`,{},app2);assert.equal(done.json().job.status,"succeeded",done.body);assert.equal(await credits(),900);assert.equal(oss.objects.size,0);
    const downloaded=await app.inject({method:"GET",url:`/viral-video-replication/jobs/${jobId}/content`});assert.equal(downloaded.statusCode,200);assert.equal(hash(downloaded.rawPayload),hash(video));
    assert.equal((await app.inject({method:"GET",url:`/viral-video-replication/jobs/${jobId}/content`,headers:{"x-foreign":"true"}})).statusCode,404);
    assert.equal((await call("confirm",input,app2)).json().job.id,jobId);assert.equal(submits,1);assert.equal((await app.inject({method:"GET",url:"/viral-video-replication/jobs"})).json().jobs.length,1);
    const record=await db.beautyVideoExecutionPermit.findUnique({where:{id:p.id}});assert.equal(record.submitCount,1);assert.equal(record.pollCount,1);assert.equal(record.downloadCount,1);assert.equal(record.storageCount,18);assert.equal(record.committedCostFen,130);assert.equal(record.observedProviderCostFen,120);

    // BY51: actual HTTP chain must retain metering independent of user credits.
    const meteringRows=await db.auditLog.findMany({where:{tenantId:actor.tenantId,resource:"beauty_usage_v1"}});
    assert.ok(meteringRows.length>=2,"BY51 missing durable per-call usage evidence after successful HTTP flow");
    const usageFor=(permitId:string)=>createBeautyUsageMeter(db,{...actor,storeId},permitId);
    const usageView=await usageFor(p.id).read();assert.equal(usageView.callCount,1);assert.equal(usageView.unresolvedCalls,0);assert.equal(usageView.groups[0].quantity,"2.000000");assert.equal(usageView.groups[0].estimatedCostMicros,"1200000");assert.equal(usageView.groups[0].observedCostMicros,null);
    assert.ok(!done.body.includes("beauty-usage-v1")&&!done.body.includes("unitPriceMicros"),"internal metering must not enter public job DTO");
    // Audit failure rolls back submission counter before provider invocation; credits release once.
    const auditFailureInput=fresh(),auditFailurePermit=await permit(auditFailureInput);const transaction=db.$transaction.bind(db);
    // Prisma interactive transactions use a distinct client; inject at the actual transaction boundary.
    db.$transaction=(fn:any,opts:any)=>transaction((tx:any)=>fn(new Proxy(tx,{get(target,key){
      if(key!=="auditLog")return Reflect.get(target,key);
      return new Proxy(target.auditLog,{get(table,operation){if(operation!=="create")return Reflect.get(table,operation);
        return async(args:any)=>{if(args.data.resource==="beauty_usage_v1")throw new Error("synthetic_audit_down");return table.create(args);};}});
    }})),opts);
    try{assert.equal((await call("confirm",auditFailureInput)).json().job.status,"failed");}finally{db.$transaction=transaction;}
    assert.equal(submits,1);assert.equal(await credits(),900);assert.equal((await db.beautyVideoExecutionPermit.findUnique({where:{id:auditFailurePermit.id}})).submitCount,0);

    // Invalid trusted-record scope/signature and revocation all fail before cloud and credits.
    for(const change of[{maxCostFen:129},{access:"provider_https"},{mode:"wan-pro"},{expiresAt:now-1}]){const x=fresh();await permit(x,change);const before=oss.count();assert.ok((await call("confirm",x)).statusCode>=400);assert.equal(oss.count(),before);}
    const revokedInput=fresh(),revoked=await permit(revokedInput);await db.beautyVideoExecutionPermit.update({where:{id:revoked.id},data:{revokedAt:new Date(now)}});assert.equal((await call("confirm",revokedInput)).statusCode,422);
    const tampered=fresh(),tamperPermit=await permit(tampered);await db.beautyVideoExecutionPermit.update({where:{id:tamperPermit.id},data:{scope:{...tamperPermit.scope,maxCostFen:999}}});assert.equal((await call("confirm",tampered)).statusCode,422);
    assert.equal(await credits(),900);

    submitFault=true;const lost=fresh(),lostPermit=await permit(lost);const failed=await call("confirm",lost);assert.equal(failed.json().job.status,"terminal_unknown",failed.body);submitFault=false;const submitAfter=submits;
    assert.equal((await call("confirm",lost,app2)).json().job.id,failed.json().job.id);assert.equal(submits,submitAfter);assert.equal(await credits(),900);assert.equal((await db.beautyVideoExecutionPermit.findUnique({where:{id:lostPermit.id}})).submitCount,1);
    assert.equal((await usageFor(lostPermit.id).read()).groups[0].quantity,null);
    // Delayed usage after user refund records consumed units, never settles/recharges the action.
    const lostRow=await db.viralVideoReplicationJob.findUnique({where:{id:failed.json().job.id}});
    const lateGuard=createVideoExecutionPermits(db,{authorityKey:authority,access:"local_only",now:()=>now});
    await lateGuard.observe(lostRow,2,"FAILED");const lateCount=(await usageFor(lostPermit.id).read()).events.length;
    await lateGuard.observe(lostRow,2,"FAILED");assert.equal((await usageFor(lostPermit.id).read()).events.length,lateCount);
    assert.equal((await usageFor(lostPermit.id).read()).groups[0].quantity,"2.000000");assert.equal(await credits(),900);
    // An upload failure burns the one batch claim but cannot burn a Provider submission.
    const partial=fresh(),partialPermit=await permit(partial);oss.set({failPut:oss.putCount()+2});assert.ok((await call("confirm",partial)).statusCode>=400);assert.equal(oss.objects.size,0);assert.equal(submits,submitAfter);assert.equal((await call("confirm",partial)).statusCode,409);assert.equal((await db.beautyVideoExecutionPermit.findUnique({where:{id:partialPermit.id}})).submitCount,0);

    // Explicit polling of the same task is bounded separately; exhaustion releases only user credits.
    const polling=fresh(),pollPermit=await permit(polling,{maxPoll:1});providerState="RUNNING";const pending=(await call("confirm",polling)).json().job;pollFault=true;
    assert.equal((await call(`jobs/${pending.id}/refresh`,{})).json().job.status,"processing");pollFault=false;now+=16000;
    assert.equal((await call(`jobs/${pending.id}/refresh`,{})).json().job.status,"terminal_unknown");providerState="SUCCEEDED";assert.equal((await db.beautyVideoExecutionPermit.findUnique({where:{id:pollPermit.id}})).pollCount,1);assert.equal(await credits(),900);
    const broken=fresh(),brokenPermit=await permit(broken);const brokenJob=(await call("confirm",broken)).json().job;resultFault=true;assert.equal((await call(`jobs/${brokenJob.id}/refresh`,{})).json().job.status,"failed");resultFault=false;assert.equal(await credits(),900);assert.equal((await db.beautyVideoExecutionPermit.findUnique({where:{id:brokenPermit.id}})).observedProviderCostFen,120);

    // Provider accepted, then DB update failed: no repeat POST and no restoration of external quota.
    const persistenceLost=fresh(),persistencePermit=await permit(persistenceLost);const originalUpdate=integrated.repository.update;
    integrated.repository.update=async()=>{throw new Error("synthetic_database_unavailable");};
    let persistenceJob:any;try{persistenceJob=(await call("confirm",persistenceLost)).json().job;}finally{integrated.repository.update=originalUpdate;}
    assert.equal(persistenceJob.status,"terminal_unknown");const acceptedSubmits=submits;assert.equal((await call("confirm",persistenceLost,app2)).json().job.id,persistenceJob.id);assert.equal(submits,acceptedSubmits);assert.equal((await db.beautyVideoExecutionPermit.findUnique({where:{id:persistencePermit.id}})).submitCount,1);assert.equal(await credits(),900);

    // Expiry/revoke stops polling; cleanup still has its reserved request quota.
    const revokeAfter=fresh(),revokePermit=await permit(revokeAfter);const revokeJob=(await call("confirm",revokeAfter)).json().job;
    await db.beautyVideoExecutionPermit.update({where:{id:revokePermit.id},data:{revokedAt:new Date(now)}});
    assert.equal((await call(`jobs/${revokeJob.id}/refresh`,{})).json().job.status,"terminal_unknown");assert.equal(oss.objects.size,0);assert.equal(await credits(),900);

    // Durable cleanup failure is visible, and retries only DELETE/HEAD, never submit.
    const cleanup=fresh();await permit(cleanup);const cleanupJob=(await call("confirm",cleanup)).json().job;oss.set({failDelete:true});
    assert.equal((await call(`jobs/${cleanupJob.id}/refresh`,{})).statusCode,503);oss.set({failDelete:false});
    await integrated.staging!.sweep();assert.equal(oss.objects.size,0);assert.equal(await credits(),800);

    // No unpriced or disabled environment can execute even when there is a valid record.
    const disabled=createControlledVideoIntegration({...options,environment:{...env,BEAUTY_VIDEO_EXECUTION_MODE:"disabled"}});assert.equal(disabled.runtime,undefined);
    const noKey=createControlledVideoIntegration({...options,environment:{...env,ALIYUN_VIDEO_REPLICATION_API_KEY:""}});assert.equal(noKey.runtime,undefined);
    const changed=fresh();await permit(changed);const beforeChange=oss.count();assert.equal((await call("confirm",{...changed,mode:"wan-pro"})).statusCode,422);assert.equal(oss.count(),beforeChange);
    const poor=fresh(),poorPermit=await permit(poor);await db.wallet.update({where:{userId:actor.userId},data:{paidBalance:50}});
    assert.equal((await call("confirm",poor)).statusCode,402);assert.equal(oss.count(),beforeChange);assert.equal((await db.beautyVideoExecutionPermit.findUnique({where:{id:poorPermit.id}})).status,"approved");
    await db.wallet.update({where:{userId:actor.userId},data:{paidBalance:800}});

    // Restart/multi-process claim consumes exactly once; no HTTP is involved in this race.
    const race=fresh(),racePermit=await permit(race);const admission=(await integrated.admission(actor as any,race))!;
    if(client){const workerInput=path.join(root,`worker-${round}.json`);await writeFile(workerInput,JSON.stringify({admission,input:race,authority,now}),{flag:"wx"});
      const result=await Promise.all([0,1,2].map(()=>new Promise<string>((resolve,reject)=>{const child=spawn(process.execPath,["apps/api/node_modules/tsx/dist/cli.mjs","scripts/fixtures/video-permit-worker.ts",workerInput],{windowsHide:true,stdio:["ignore","pipe","pipe"],env:{...process.env}});let stdout="";child.stdout.on("data",d=>stdout+=d);child.stderr.on("data",()=>{});const timer=setTimeout(()=>{child.kill();reject(new Error("owned_worker_timeout"));},30000);child.on("close",code=>{clearTimeout(timer);code===0?resolve(stdout.trim()):reject(new Error("worker_failed"));});})));assert.equal(result.filter(r=>r==="CLAIMED").length,1);
    }else{const guard1=createVideoExecutionPermits(db,{authorityKey:authority,access:"local_only",now:()=>now}),guard2=createVideoExecutionPermits(db,{authorityKey:authority,access:"local_only",now:()=>now});const raceResult=await Promise.allSettled([guard1.claim(admission,race),guard2.claim(admission,race)]);assert.equal(raceResult.filter(x=>x.status==="fulfilled").length,1);}
    assert.equal((await db.beautyVideoExecutionPermit.findUnique({where:{id:racePermit.id}})).committedCostFen,130);assert.equal((await call("confirm",race)).statusCode,409);assert.equal(await credits(),800);

    const queued=fresh();await permit(queued);const qa=(await integrated.admission(actor as any,queued))!;const guard=createVideoExecutionPermits(db,{authorityKey:authority,access:"local_only",now:()=>now});await guard.claim(qa,queued);const qjob=await integrated.repository.create(qa,queued,now);assert.equal((await call(`jobs/${qjob.job.id}/cancel`,{})).json().job.status,"canceled");assert.equal(await credits(),800);
    const limited=fresh(),limitPermit=await permit(limited),la=(await integrated.admission(actor as any,limited))!;await guard.claim(la,limited);
    for(let i=0;i<16;i++)await guard.storage(limitPermit.id);await assert.rejects(()=>guard.storage(limitPermit.id),/execution_request_limit/);
    await db.beautyVideoExecutionPermit.update({where:{id:limitPermit.id},data:{revokedAt:new Date(now)}});
    for(let i=0;i<8;i++)await guard.storage(limitPermit.id,true);await assert.rejects(()=>guard.storage(limitPermit.id,true),/execution_request_limit/);
    assert.equal((await db.beautyVideoExecutionPermit.findUnique({where:{id:limitPermit.id}})).storageCount,24);

    // If both job update and failure settlement lose DB access, recover the same submitting job after restart.
    const interrupted=fresh(),interruptedPermit=await permit(interrupted);const updateAgain=integrated.repository.update,finishAgain=integrated.repository.finish;
    integrated.repository.update=async()=>{throw new Error("synthetic_db_down");};integrated.repository.finish=async()=>{throw new Error("synthetic_db_down");};
    try{assert.equal((await call("confirm",interrupted)).statusCode,503);}finally{integrated.repository.update=updateAgain;integrated.repository.finish=finishAgain;}
    const interruptedJob=await db.viralVideoReplicationJob.findFirst({where:{tenantId:actor.tenantId,requestKey:interrupted.requestKey}});assert.equal(interruptedJob.status,"submitting");now+=61000;
    assert.equal((await call(`jobs/${interruptedJob.id}/refresh`,{},app2)).json().job.status,"terminal_unknown");
    assert.equal(oss.objects.size,0,"BY50 interrupted submission recovery must clean its input lease immediately");
    assert.equal((await db.beautyVideoExecutionPermit.findUnique({where:{id:interruptedPermit.id}})).submitCount,1);assert.equal(await credits(),800);
    const audit=JSON.stringify(await db.auditLog.findMany({where:{tenantId:actor.tenantId}}));for(const forbidden of[authority,"sk-SYNTHETIC","STS.SYNTHETIC","x-oss-signature","https://","SYNTHETIC_OSS_SECRET"])assert.ok(!audit.includes(forbidden));
    console.log(JSON.stringify({round,result:"PASS",db:client?"isolated_postgresql":"transactional_fixture",syntheticSubmit:submits,syntheticPoll:polls,syntheticDownload:downloads,syntheticStorage:oss.count(),providerCalls:0,externalCalls:external,costYuan:0,creditsNet:200}));
  }finally{await app.close();await app2.close();}
 }
 if(client){await client.$transaction(async(tx:any)=>{const n=await tx.beautyVideoExecutionPermit.count();await tx.$executeRawUnsafe('ALTER TABLE "BeautyVideoExecutionPermit" RENAME TO "BeautyVideoExecutionPermit_by50_probe"');const rows=await tx.$queryRawUnsafe('SELECT COUNT(*)::int AS count FROM "BeautyVideoExecutionPermit_by50_probe"');assert.equal(rows[0].count,n);await tx.$executeRawUnsafe('ALTER TABLE "BeautyVideoExecutionPermit_by50_probe" RENAME TO "BeautyVideoExecutionPermit"');});}
 assert.equal(external,0);
 }finally{await client?.$disconnect();globalThis.fetch=originalFetch;}
}
main().catch(e=>{console.log(e);process.exitCode=1;});
