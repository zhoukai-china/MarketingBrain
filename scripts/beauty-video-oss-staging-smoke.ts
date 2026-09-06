import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import { createOssPrivateVideoStaging, validateOssStagingConfig, assertOssPublicIpv4, createOssHttpsTransport, type OssWireRequest, type OssTransport } from "../apps/api/src/services/beauty-video-oss-staging.ts";
import { createConfiguredVideoMaterialIntegration } from "../apps/api/src/services/beauty-video-staging-config.ts";
import { createVideoAssetAuthorization } from "../apps/api/src/services/beauty-video-asset-authorization.ts";
import { createVideoMaterialIntegration } from "../apps/api/src/services/beauty-video-material-integration.ts";
import { registerViralVideoReplicationRoutes } from "../apps/api/src/routes/viral-video-replication.ts";
import { replicationSchema } from "../apps/api/src/services/viral-video-replication.ts";
import { replicationMemoryDb } from "./fixtures/replication-test-db.ts";
import type { StagedObject } from "../apps/api/src/services/beauty-video-private-staging.ts";

assert.equal(existsSync("apps/api/src/services/beauty-video-oss-staging.ts"), true,
  "BY49: provider HTTPS private staging driver is missing");
assert.match(readFileSync("apps/api/src/routes/viral-video-replication.ts", "utf8"), /createControlledVideoIntegration/,
  "BY49: official route does not assemble configured cloud staging");
console.log("BY49 implementation admission baseline PASS");

const sha=(b:Buffer|string)=>createHash("sha256").update(b).digest("hex");
const md5=(b:Buffer)=>createHash("md5").update(b).digest("hex");
const config={bucket:"synthetic-by49",region:"cn-beijing",prefix:"beauty-industry/video-staging/v1/acceptance/",approvedOrigin:"https://synthetic-by49.oss-cn-beijing.aliyuncs.com"};
function fixture() {
  const objects=new Map<string,{body:Buffer;headers:Record<string,string>}>(),calls:OssWireRequest[]=[];
  let forcedStatus=0,throwNetwork=false,privateBucket=true,version="",days=1,wrongMetadata=false,deleteFailure=false,putNumber=0,failPut=0;
  const transport:OssTransport=async r=>{
    calls.push(r);const u=new URL(r.url);u.search=u.search.replace(/=$/,"");assert.equal(u.origin,config.approvedOrigin);
    const headers=Object.fromEntries(Object.entries(r.headers).map(([k,v])=>[k.toLowerCase(),String(v)]));
    assert.match(headers.authorization,/^OSS4-HMAC-SHA256 Credential=STS\.SYNTHETICACCESSKEY49\/[0-9]{8}\/cn-beijing\/oss\/aliyun_v4_request,.*Signature=[a-f0-9]{64}$/);
    assert.equal(headers["x-oss-security-token"],"SYNTHETIC_STS_TOKEN_ONLY");
    assert.equal(headers["x-oss-content-sha256"],"UNSIGNED-PAYLOAD");
    assert.equal(r.timeoutMs,20000);
    if(throwNetwork)throw new Error("SYNTHETIC_RAW_RESPONSE_SECRET_MUST_NOT_ESCAPE");
    const response=(status:number,body="",h:Record<string,string>={})=>({status,headers:h,body:Buffer.from(body)});
    if(forcedStatus)return response(forcedStatus,"private raw response",{location:"http://127.0.0.1/secret"});
    if(u.search==="?bucketInfo")return response(200,`<BucketInfo><Bucket><Name>${config.bucket}</Name><Location>oss-cn-beijing</Location><ExtranetEndpoint>oss-cn-beijing.aliyuncs.com</ExtranetEndpoint><StorageClass>Standard</StorageClass><AccessControlList><Grant>${privateBucket?"private":"public-read"}</Grant></AccessControlList><BlockPublicAccess>true</BlockPublicAccess><CrossRegionReplication>Disabled</CrossRegionReplication></Bucket></BucketInfo>`);
    if(u.search==="?versioning")return response(200,`<VersioningConfiguration>${version?`<Status>${version}</Status>`:""}</VersioningConfiguration>`);
    if(u.search==="?lifecycle")return response(200,`<LifecycleConfiguration><Rule><ID>synthetic</ID><Prefix>${config.prefix}</Prefix><Status>Enabled</Status><Expiration><Days>${days}</Days></Expiration></Rule></LifecycleConfiguration>`);
    if(r.method==="PUT"){
      putNumber++;if(putNumber===failPut)return response(500);
      assert.equal(headers["x-oss-object-acl"],"private");assert.equal(headers["x-oss-forbid-overwrite"],"true");assert.equal(headers["x-oss-server-side-encryption"],"AES256");
      assert.equal(headers["content-md5"],createHash("md5").update(r.body!).digest("base64"));
      if(objects.has(u.pathname))return response(409);
      objects.set(u.pathname,{body:Buffer.from(r.body!),headers:{"x-oss-object-type":"Normal","content-type":headers["content-type"],"content-length":String(r.body!.length),"x-oss-meta-sha256":headers["x-oss-meta-sha256"],"x-oss-meta-binding":headers["x-oss-meta-binding"]}});
      return response(200,"",{etag:`"${md5(r.body!)}"`});
    }
    if(r.method==="HEAD"){const object=objects.get(u.pathname);return object?response(200,"",{...object.headers,...(wrongMetadata?{"x-oss-meta-binding":"tampered"}:{})}):response(404);}
    if(r.method==="DELETE"){if(deleteFailure)return response(503);objects.delete(u.pathname);return response(204);}
    throw new Error("unexpected protocol request");
  };
  return {transport,objects,calls,set:(p:any)=>{if(p.forcedStatus!==undefined)forcedStatus=p.forcedStatus;if(p.throwNetwork!==undefined)throwNetwork=p.throwNetwork;if(p.privateBucket!==undefined)privateBucket=p.privateBucket;if(p.version!==undefined)version=p.version;if(p.days!==undefined)days=p.days;if(p.wrongMetadata!==undefined)wrongMetadata=p.wrongMetadata;if(p.deleteFailure!==undefined)deleteFailure=p.deleteFailure;if(p.failPut!==undefined)failPut=p.failPut;},putCount:()=>putNumber};
}
async function main(){
 const oldFetch=globalThis.fetch;let forbiddenNetwork=0;globalThis.fetch=async()=>{forbiddenNetwork++;throw new Error("network_forbidden");};
 try{for(let round=0;round<3;round++){
  let now=Date.now();const creds=()=>({accessKeyId:"STS.SYNTHETICACCESSKEY49",accessKeySecret:"SYNTHETIC_SECRET_NOT_REAL_49",securityToken:"SYNTHETIC_STS_TOKEN_ONLY",expiresAt:now+3600000});
  const f=fixture(),audit:any[]=[],driver=createOssPrivateVideoStaging({config,credentials:creds,transport:f.transport,now:()=>now,audit:e=>audit.push(e)});
  assert.equal(driver.access,"local_only");
  for(const patch of [{region:"cn-hangzhou"},{bucket:"other"},{approvedOrigin:config.approvedOrigin+".evil.test"},{approvedOrigin:"http://127.0.0.1"},{prefix:"other-product/"},{prefix:config.prefix+"../"}])assert.throws(()=>validateOssStagingConfig({...config,...patch}),/configuration_invalid/);
  for(const ip of ["127.0.0.1","10.1.2.3","169.254.169.254","100.64.0.1","192.168.1.2","::1","::ffff:127.0.0.1","203.0.113.2"]){assert.throws(()=>assertOssPublicIpv4([ip]),/dns_rejected/);assert.throws(()=>assertOssPublicIpv4(["8.8.8.8",ip]),/dns_rejected/);}
  assertOssPublicIpv4(["8.8.8.8"]);await assert.rejects(()=>createOssHttpsTransport(config.approvedOrigin)({url:"http://127.0.0.1",method:"GET",headers:{},timeoutMs:1}),/origin_rejected/);
  const bytes=Buffer.from("synthetic private video bytes; no customer"),o:StagedObject={key:`${randomUUID().replaceAll("-","")}-reference.mp4`,authorizationId:"synthetic-rights",fileId:"synthetic-file",sha256:sha(bytes),role:"reference",expiresAt:now+600000,version:1,mimeType:"video/mp4"};
  try{await driver.preflight();}catch(e){console.log(JSON.stringify({stage:"preflight",audit,requests:f.calls.map(r=>({method:r.method,path:new URL(r.url).pathname,queryKeys:[...new URL(r.url).searchParams.keys()]}))}));throw e;}assert.equal(f.calls.length,3);
  for(const patch of [{privateBucket:false},{version:"Enabled"},{version:"Suspended"},{days:2}]){f.set(patch);await assert.rejects(()=>driver.preflight(),/oss_/);f.set({privateBucket:true,version:"",days:1});}
  for(const status of [301,302,307,400,403,404,429,500,503]){const n=f.calls.length;f.set({forcedStatus:status});await assert.rejects(()=>driver.preflight(),/oss_/);assert.equal(f.calls.length,n+1,"no SDK retry/redirect");}f.set({forcedStatus:0});
  f.set({throwNetwork:true});await assert.rejects(()=>driver.preflight(),e=>String(e).includes("oss_")&&!String(e).includes("SYNTHETIC_RAW"));f.set({throwNetwork:false});
  const n=f.calls.length;await assert.rejects(()=>driver.put({...o,key:"../other.mp4"},bytes),/object_invalid/);await assert.rejects(()=>driver.put(o,Buffer.from("changed")),/upload_invalid/);assert.equal(f.calls.length,n);
  await driver.put(o,bytes);const url=await driver.url(o),u=new URL(url);assert.equal(u.origin,config.approvedOrigin);assert.equal(u.pathname,`/${config.prefix}${o.sha256}/${o.key}`);
  assert.equal(u.searchParams.get("x-oss-signature-version"),"OSS4-HMAC-SHA256");assert.equal(u.searchParams.get("x-oss-additional-headers"),"host");assert.ok(Number(u.searchParams.get("x-oss-expires"))<=600);
  await driver.assertUrl(url,o);for(const bad of [url+"&evil=1",url.replace(config.bucket,"other"),url.replace(o.key,"other.mp4"),url.replace("https:","http:"),url+"#fragment"])await assert.rejects(()=>driver.assertUrl(bad,o),/signed_url_rejected/);
  await assert.rejects(()=>driver.assertUrl(url,{...o,version:2}),/signed_url_rejected/);
  await assert.rejects(()=>driver.put(o,bytes),/oss_/);f.set({wrongMetadata:true});await assert.rejects(()=>driver.url(o),/verification_failed/);await assert.rejects(()=>driver.remove(o),/verification_failed/);assert.equal(f.objects.size,1);f.set({wrongMetadata:false});
  await driver.remove(o);assert.equal(f.objects.size,0);await driver.remove(o);await assert.rejects(()=>driver.assertUrl(url,o),/signed_url_rejected/);
  const expired=createOssPrivateVideoStaging({config,credentials:()=>({...creds(),expiresAt:now}),transport:f.transport,now:()=>now});assert.throws(()=>expired.checkCredentials(),/credentials_unavailable/);
  for(const accessKeyId of ["LONGTERMKEY49","STS.bad\nheader","STS.short"]){
    const invalid=createOssPrivateVideoStaging({config,credentials:()=>({...creds(),accessKeyId}),transport:f.transport,now:()=>now});
    assert.throws(()=>invalid.checkCredentials(),/credentials_unavailable/);
  }
  const testRequire=createRequire(import.meta.url),ossRequire=createRequire(testRequire.resolve("../apps/api/node_modules/ali-oss")),debug=ossRequire("debug"),previousDebug=debug.disable();
  try{debug.enable("ali-oss");assert.throws(()=>driver.checkCredentials(),/debug_logging_forbidden/);}finally{debug.enable(previousDebug);}
  const shortLived=createOssPrivateVideoStaging({config,credentials:()=>({...creds(),expiresAt:now+60000}),transport:f.transport,now:()=>now});
  const beforeExpired=f.calls.length;await assert.rejects(()=>shortLived.put(o,bytes),/credentials_unavailable/);assert.equal(f.calls.length,beforeExpired);

  // Actual production assembly + registered HTTP handlers, synthetic DB/file reader only.
  const db=replicationMemoryDb(),actor={tenantId:`synthetic-tenant-${round}`,userId:`synthetic-user-${round}`},storeId=`store-${round}`;
  await db.store.create({data:{id:storeId,tenantId:actor.tenantId}});await db.membership.create({data:{...actor,storeId,role:"owner",isActive:true}});await db.tenantProductEntitlement.create({data:{tenantId:actor.tenantId,productCode:"beauty-industry",startsAt:new Date(now-1),status:"active",expiresAt:null}});await db.creditAccount.create({data:{tenantId:actor.tenantId,balance:1000}});
  const files=new Map<string,Buffer>();
  for(const [id,b,mimeType] of [["ref",bytes,"video/mp4"],["photo",Buffer.from("synthetic-photo"),"image/png"],["basis",Buffer.from("synthetic-rights"),"text/plain"]] as const){files.set(id,b);await db.uploadedFile.create({data:{id,...actor,sha256:sha(b),mimeType,byteSize:b.length}});}
  const auth=createVideoAssetAuthorization(db,async(f:any,role)=>({bytes:files.get(f.id)!,sha256:sha(files.get(f.id)!),mimeType:f.mimeType,width:240,height:320,...(role==="reference"?{durationSeconds:2}:{})}),()=>now);
  let refAuth:any;for(const [fileId,subjectRole]of[["ref","reference"],["photo","owner"]]){const r=await auth.declare(actor,{fileId,subjectRole,basisFileId:"basis",purpose:"video_replacement",expiresAt:new Date(now+3600000).toISOString(),rightsDeclared:true,requestKey:randomUUID()});if(fileId==="ref")refAuth=r;}
  const environment={BEAUTY_VIDEO_STAGING_DRIVER:"aliyun_oss",BEAUTY_VIDEO_OSS_REGION:config.region,BEAUTY_VIDEO_OSS_BUCKET:config.bucket,BEAUTY_VIDEO_OSS_PREFIX:config.prefix,BEAUTY_VIDEO_OSS_APPROVED_ORIGIN:config.approvedOrigin,BEAUTY_VIDEO_OSS_ACCESS_KEY_ID:creds().accessKeyId,BEAUTY_VIDEO_OSS_ACCESS_KEY_SECRET:creds().accessKeySecret,BEAUTY_VIDEO_OSS_SECURITY_TOKEN:creds().securityToken,BEAUTY_VIDEO_OSS_CREDENTIAL_EXPIRES_AT:new Date(now+3600000).toISOString()};
  const ff=fixture();let submissions=0,uncertain=false;
  const execution={access:"local_only" as const,submit:async(s:any)=>{submissions++;for(const v of[s.referenceVideoUrl,s.portraitImageUrl])assert.equal(new URL(v).origin,config.approvedOrigin);if(uncertain)throw new Error("synthetic unknown");return `synthetic-task-${submissions}`;},poll:async()=>({status:"RUNNING"}),persist:async()=>{throw new Error("not in storage scope");},read:async()=>Buffer.alloc(0)};
  const base={db,authorization:auth,policy:{creditCost:100,maxCostFen:120,maxOutputSeconds:2},now:()=>now};
  assert.throws(()=>createVideoMaterialIntegration({...base,driver,execution:{...execution,access:"provider_https"}}),/transport_mismatch/);
  const configured=(e=environment,execute=true)=>createConfiguredVideoMaterialIntegration({...base,environment:e,offlineTransport:ff.transport,execution:execute?execution:undefined,audit:e=>audit.push(e)});
  const input=replicationSchema.parse({model:"aliyun_strict",referenceFileId:"ref",portraitFileId:"photo",requestKey:randomUUID(),visualRightsConfirmed:true,audioRightsConfirmed:true,performerConsentConfirmed:true,portraitConsentConfirmed:true});
  const disabled=configured({...environment,BEAUTY_VIDEO_STAGING_DRIVER:"disabled"},false);assert.equal(disabled.runtime,undefined);
  const noExecution=configured(environment,false);assert.equal(noExecution.runtime,undefined);assert.equal((await noExecution.admission(actor as any,input))!.stagingReady,false);assert.equal(ff.calls.length,0);
  const bad=configured({...environment,BEAUTY_VIDEO_OSS_BUCKET:"wrong"});await assert.rejects(()=>bad.admission(actor as any,input),/configuration_invalid/);assert.equal(ff.calls.length,0);
  const missingCredentials=configured({...environment,BEAUTY_VIDEO_OSS_SECURITY_TOKEN:""});await assert.rejects(()=>missingCredentials.admission(actor as any,input),/credentials_unavailable/);assert.equal(ff.calls.length,0);
  const noBudget=createConfiguredVideoMaterialIntegration({...base,policy:{...base.policy,maxCostFen:0},environment,offlineTransport:ff.transport,execution});
  await assert.rejects(async()=>noBudget.runtime!.confirm((await noBudget.admission(actor as any,input))!,input),/budget_exceeded/);assert.equal(ff.calls.length,0);assert.equal(await db.creditReservation.count(),0);
  const integrated=configured(),app=Fastify({logger:false});await registerViralVideoReplicationRoutes(app,{...integrated,context:async headers=>({...actor,...(headers["x-other-user"]?{userId:"other"}:{}),source:"database"} as any),entitled:async()=>true});
  try{
    const quote=await app.inject({method:"POST",url:"/viral-video-replication/quote",payload:input});assert.equal(quote.statusCode,200);assert.equal(quote.json().canConfirm,true);assert.equal(ff.calls.length,0);
    assert.equal((await app.inject({method:"POST",url:"/viral-video-replication/confirm",payload:{...input,tenantId:"injected"}})).statusCode,400);assert.equal(ff.calls.length,0);
    await assert.rejects(()=>integrated.admission({...actor,tenantId:"foreign"} as any,input),/product_access_denied/);
    await assert.rejects(()=>integrated.admission(actor as any,{...input,template:"kol_visit"}),/authorization_required/);assert.equal(ff.calls.length,0);
    const confirmed=await app.inject({method:"POST",url:"/viral-video-replication/confirm",payload:input});assert.equal(confirmed.statusCode,202,confirmed.body);const id=confirmed.json().job.id;assert.equal(submissions,1);assert.equal(ff.objects.size,2);
    const callCount=ff.calls.length;for(let i=0;i<2;i++){const replay=await app.inject({method:"POST",url:"/viral-video-replication/confirm",payload:input});assert.equal(replay.json().job.id,id);assert.equal(replay.json().idempotent,true);}assert.equal(ff.calls.length,callCount);assert.equal(submissions,1);
    const reassembled=configured();const a=(await reassembled.admission(actor as any,input))!;assert.equal((await reassembled.runtime!.confirm(a,input)).job.id,id);assert.equal(submissions,1);
    assert.equal((await app.inject({method:"POST",url:"/viral-video-replication/confirm",payload:input,headers:{"x-other-user":"true"}})).statusCode,403);
    const j=await integrated.repository.get(id,actor.tenantId),leaseId=j!.authorizationSnapshot.stagingLeaseId;
    await db.store.create({data:{id:"other-store",tenantId:actor.tenantId}});await db.membership.updateMany({where:actor,data:{storeId:"other-store"}});
    await assert.rejects(()=>integrated.admission(actor as any,input),/asset_not_found/);await db.membership.updateMany({where:actor,data:{storeId}});
    ff.set({deleteFailure:true});await assert.rejects(()=>integrated.staging!.release(leaseId),/cleanup_failed/);assert.equal((await db.beautyVideoStagingLease.findUnique({where:{id:leaseId}})).status,"cleanup_failed");ff.set({deleteFailure:false});await integrated.staging!.sweep();assert.equal(ff.objects.size,0);
    uncertain=true;const unknownInput={...input,requestKey:randomUUID()};const unknown=await integrated.runtime!.confirm(a,unknownInput);assert.equal(unknown.job.status,"terminal_unknown");const after=ff.calls.length;await integrated.runtime!.confirm(a,unknownInput);assert.equal(ff.calls.length,after);assert.equal(submissions,2);assert.equal(ff.objects.size,0);uncertain=false;
    ff.set({failPut:ff.putCount()+2});await assert.rejects(()=>integrated.runtime!.confirm(a,{...input,requestKey:randomUUID()}),/oss_/);assert.equal(ff.objects.size,0);assert.equal(submissions,2);
    const staged=await integrated.staging!.stage(a,{...input,requestKey:randomUUID()});now+=901000;await assert.rejects(()=>staged.assertScope(),/unavailable/);await integrated.staging!.sweep();assert.equal(ff.objects.size,0);
    await integrated.staging!.stage(a,{...input,requestKey:randomUUID()});assert.equal(ff.objects.size,2);
    await integrated.authorization.revoke(actor,refAuth.id);assert.equal(ff.objects.size,0,"BY49 revoke must clean active lease even before a job exists");assert.equal((await integrated.repository.get(id,actor.tenantId))!.status,"terminal_unknown");assert.equal((await db.creditAccount.findUnique({where:{tenantId:actor.tenantId}})).balance,1000);assert.equal(await db.creditReservation.count(),2);
    await assert.rejects(()=>integrated.admission(actor as any,{...input,requestKey:randomUUID()}),/authorization_required/);
    assert.equal(await db.creditReservation.count({where:{status:"released"}}),2);
    const exposed=JSON.stringify([...audit,...await db.auditLog.findMany()]);for(const word of["SYNTHETICACCESSKEY49","SYNTHETIC_STS","SYNTHETIC_SECRET","x-oss-signature","private raw response","SYNTHETIC_RAW_RESPONSE"])assert.ok(!exposed.includes(word));
    console.log(JSON.stringify({round,result:"PASS",sdkRequests:f.calls.length+ff.calls.length,syntheticHandoffs:submissions,providerCalls:0,externalNetwork:forbiddenNetwork,creditsNet:0}));
  }finally{await app.close();}
 }
 assert.equal(forbiddenNetwork,0);
 }finally{globalThis.fetch=oldFetch;}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
