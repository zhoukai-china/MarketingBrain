import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { isIP } from "node:net";
import { ReplicationError } from "./viral-video-replication-runtime.js";
import { videoFileHash } from "./beauty-video-private-files.js";
import type { createVideoAssetAuthorization, VideoActor } from "./beauty-video-asset-authorization.js";
import type { ReplicationAdmission, ReplicationRequest } from "./viral-video-replication.js";

export type StagedObject={key:string;authorizationId:string;version:number;fileId:string;sha256:string;role:"reference"|"owner"|"kol";expiresAt:number;mimeType:string;executionPermitId?:string};
export type PrivateVideoStagingDriver={
  id:string;access:"local_only"|"provider_https";
  put(object:StagedObject,bytes:Buffer):Promise<void>;
  url(object:StagedObject):Promise<string>;
  assertUrl(url:string,object:StagedObject):Promise<void>;
  remove(object:StagedObject):Promise<void>;
};
const objectKey=/^[a-f0-9]{32}-(reference|portrait)\.(mp4|png|jpg|webp|bmp|mov|avi)$/;
/** A local private service adapter, NOT a public staging cloud. Never compatible with real Provider transport. */
export function createLocalPrivateVideoStaging(options:{root:string;origin:string;signingKey:Buffer;now?:()=>number}){
  const root=path.resolve(options.root),origin=new URL(options.origin),now=options.now??Date.now;
  if(origin.protocol!=="http:"||origin.hostname!=="127.0.0.1"||!origin.port||origin.pathname!=="/"||origin.search||origin.hash||origin.username||origin.password||options.signingKey.length<32)throw new ReplicationError("local_staging_configuration_invalid",503);
  const sign=(key:string,expiresAt:number)=>createHmac("sha256",options.signingKey).update(`video_replacement\n${origin.origin}\n${key}\n${expiresAt}`).digest("hex");
  async function location(key:string){if(!objectKey.test(key))throw new ReplicationError("staged_object_not_found",404);await mkdir(root,{recursive:true});if((await realpath(root)).toLowerCase()!==root.toLowerCase())throw new ReplicationError("staging_path_invalid",503);return path.join(root,key);}
  async function assertUrl(url:string,o:StagedObject){
    const u=new URL(url),sig=Buffer.from(u.searchParams.get("sig")??""),expected=Buffer.from(sign(o.key,o.expiresAt));
    if(u.origin!==origin.origin||u.pathname!==`/private-video-staging/${o.key}`||u.username||u.password||u.hash||u.searchParams.size!==2||u.searchParams.get("expires")!==String(o.expiresAt)||sig.length!==expected.length||!timingSafeEqual(sig,expected)||now()>=o.expiresAt)throw new ReplicationError("staged_object_not_found",404);
  }
  const driver:PrivateVideoStagingDriver={id:"local-private-staging-v1",access:"local_only",
    async put(o,b){if(now()>=o.expiresAt||videoFileHash(b)!==o.sha256)throw new ReplicationError("staged_object_invalid",422);await writeFile(await location(o.key),b,{flag:"wx"});},
    async url(o){return `${origin.origin}/private-video-staging/${o.key}?expires=${o.expiresAt}&sig=${sign(o.key,o.expiresAt)}`;},assertUrl,
    async remove(o){const p=await location(o.key);try{if((await realpath(p)).toLowerCase()!==p.toLowerCase())throw new ReplicationError("staging_path_invalid",503);await unlink(p);}catch(e:any){if(e.code!=="ENOENT")throw e;}}
  };
  return {...driver,async read(url:string,o:StagedObject){await assertUrl(url,o);const p=await location(o.key);if((await realpath(p)).toLowerCase()!==p.toLowerCase())throw new ReplicationError("staged_object_not_found",404);const b=await readFile(p);if(videoFileHash(b)!==o.sha256)throw new ReplicationError("staged_object_not_found",404);return b;}};
}

/** Remote drivers must pin their exact HTTPS origin/objects and TTL; this helper never fetches a URL. */
export function assertProviderStagingOrigin(value:string,allowedOrigins:readonly string[]){
  const u=new URL(value);if(u.protocol!=="https:"||u.username||u.password||u.hash||u.port||isIP(u.hostname.replace(/^\[|\]$/g,""))||/\.(local|internal|localhost|invalid)$/.test(u.hostname)||!allowedOrigins.includes(u.origin))throw new ReplicationError("staging_origin_not_approved",422);
  return u;
}

export function createVideoPrivateStaging(db:any,authorization:ReturnType<typeof createVideoAssetAuthorization>,driver:PrivateVideoStagingDriver,now=Date.now){
  async function audit(lease:any,stage:string,code:string){await db.auditLog.create({data:{tenantId:lease.tenantId,userId:lease.requestedByUserId,action:`beauty_video.staging.${stage}`,resource:"video_staging_lease",resourceId:lease.id,detail:JSON.stringify({code,adapter:driver.id,tenantFingerprint:videoFileHash(lease.tenantId).slice(0,16)})}});}
  async function validate(lease:any){
    if(!lease||lease.adapterId!==driver.id||lease.status!=="active"||+lease.expiresAt<=now())throw new ReplicationError("staging_lease_unavailable",409);
    const actor={tenantId:lease.tenantId,userId:lease.requestedByUserId},scope=await authorization.scope(actor);
    if(scope.storeId!==lease.storeId)throw new ReplicationError("staging_scope_changed",409);
    for(const o of lease.objects as StagedObject[]){const current=await authorization.inspect(actor,o.fileId,o.role);if(current.record.id!==o.authorizationId||current.record.version!==o.version||current.material.sha256!==o.sha256)throw new ReplicationError("authorization_changed",409);}
  }
  async function release(id:string){
    const lease=await db.beautyVideoStagingLease.findUnique({where:{id}});if(!lease||lease.status==="released")return;
    if(lease.adapterId!==driver.id)throw new ReplicationError("staging_adapter_mismatch",503);
    // Revoke access before deletion; crashed cleanup can be resumed by the same persistent lease.
    await db.beautyVideoStagingLease.updateMany({where:{id,status:{not:"released"}},data:{status:"releasing"}});
    try{for(const o of lease.objects as StagedObject[])await driver.remove(o);await db.beautyVideoStagingLease.update({where:{id},data:{status:"released",releasedAt:new Date(now()),errorCode:null}});await audit(lease,"released","future_access_disabled_no_external_recall");}
    // 现场教训（LQ-27）：以前这里固定记/固定抛通用码，导致"删不掉"还是"请求被拒"根本分不清。
    // 现在把驱动给的具体码（如 oss_transport_unknown / oss_http_403）原样记在租约上并抛出。
    catch(e){const code=e instanceof ReplicationError?e.code:"staging_cleanup_failed";
      await db.beautyVideoStagingLease.update({where:{id},data:{status:"cleanup_failed",errorCode:code}});throw new ReplicationError(code,503);}
  }
  async function stage(a:ReplicationAdmission,input:ReplicationRequest){
    if(!input.requestKey)throw new ReplicationError("idempotency_key_required",400);
    const actor:VideoActor={tenantId:a.tenantId,userId:a.userId};
    const refs=await Promise.all([authorization.inspect(actor,a.reference.fileId,"reference"),authorization.inspect(actor,a.portrait.fileId,input.template==="kol_visit"?"kol":"owner")]);
    const requestHash=videoFileHash(JSON.stringify([a.userId,a.storeId,input.requestKey,refs.map(r=>[r.record.id,r.record.version,r.material.sha256])]));
    let lease=await db.beautyVideoStagingLease.findFirst({where:{tenantId:a.tenantId,requestHash}});
    if(!lease){
      const id=randomUUID().replaceAll("-",""),expiresAt=Math.min(now()+15*60_000,...refs.map(r=>+r.record.expiresAt));
      if(expiresAt<=now()+1000)throw new ReplicationError("authorization_expiring",422);
      const extensions:Record<string,string>={"video/mp4":"mp4","video/quicktime":"mov","video/x-msvideo":"avi","image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/bmp":"bmp"};
      const objects:StagedObject[]=refs.map((r,i)=>({key:`${id}-${i===0?"reference":"portrait"}.${extensions[r.material.mimeType]}`,authorizationId:r.record.id,version:r.record.version,fileId:r.record.fileId,sha256:r.material.sha256,role:r.record.subjectRole,expiresAt,mimeType:r.material.mimeType,...(a.executionPermitId?{executionPermitId:a.executionPermitId}:{})}));
      try{lease=await db.beautyVideoStagingLease.create({data:{id,tenantId:a.tenantId,storeId:a.storeId,requestedByUserId:a.userId,requestHash,authorizationVersions:refs.map(r=>({id:r.record.id,version:r.record.version})),objects,adapterId:driver.id,expiresAt:new Date(expiresAt)}});}catch(e:any){if(e.code==="P2002")throw new ReplicationError("staging_in_progress",409);throw e;}
      try{await audit(lease,"creating","private_objects_pending");for(let i=0;i<objects.length;i++)await driver.put(objects[i],refs[i].material.bytes);lease=await db.beautyVideoStagingLease.update({where:{id},data:{status:"active"}});await validate(lease);await audit(lease,"ready","authorization_checked");}
      catch(e){await release(lease.id);throw e instanceof ReplicationError?e:new ReplicationError("staging_failed",503);}
    }
    await validate(lease);
    const objects=lease.objects as StagedObject[];const referenceVideoUrl=await driver.url(objects[0]),portraitImageUrl=await driver.url(objects[1]);
    const assertScope=async()=>{await validate(await db.beautyVideoStagingLease.findUnique({where:{id:lease.id}}));await driver.assertUrl(referenceVideoUrl,objects[0]);await driver.assertUrl(portraitImageUrl,objects[1]);};
    try{await assertScope();}catch(e){await release(lease.id);throw e;}
    return {leaseId:lease.id,referenceVideoUrl,portraitImageUrl,assertScope,release:()=>release(lease.id)};
  }
  return {stage,release,validate,
    async authorizeFetch(key:string){
      if(!objectKey.test(key))throw new ReplicationError("staged_object_not_found",404);
      const lease=await db.beautyVideoStagingLease.findUnique({where:{id:key.split("-")[0]}});await validate(lease);
      const object=(lease.objects as StagedObject[]).find(o=>o.key===key);if(!object)throw new ReplicationError("staged_object_not_found",404);return object;
    },
    async sweep(){const leases=await db.beautyVideoStagingLease.findMany({where:{adapterId:driver.id,status:{not:"released"},OR:[{expiresAt:{lte:new Date(now())}},{status:{in:["cleanup_failed","releasing"]}}]},take:100});for(const l of leases)await release(l.id);return leases.length;}
  };
}
