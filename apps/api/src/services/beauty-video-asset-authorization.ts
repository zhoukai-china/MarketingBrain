import { z } from "zod";
import { ReplicationError } from "./viral-video-replication-runtime.js";
import { type ReplicationAdmission, type ReplicationAssetEvidence, type ReplicationRequest } from "./viral-video-replication.js";
import { videoFileHash, type InspectedVideoFile, type VideoPrivateFile } from "./beauty-video-private-files.js";
import { findVideoReplicationEntitlement } from "./video-replication-entitlement.js";

/** 按输出秒数计积分（用户 2026-09-13 拍板：爆款复刻 30 积分/秒）。
 *  供应商按实际出片秒数计费（出片时长≈原视频时长）；扣分向上取整、不超过 maxOutputSeconds 封顶；
 *  未配置 creditsPerSecond（<=0）时回退固定 creditCost（兼容旧口径）。 */
export function computeReplicationCreditCost(input: {
  durationSeconds?: number;
  maxOutputSeconds: number;
  creditsPerSecond?: number;
  creditCost: number;
}): number {
  if (!input.creditsPerSecond || !Number.isFinite(input.creditsPerSecond) || input.creditsPerSecond <= 0) return input.creditCost;
  const seconds = Math.max(1, Math.min(Math.ceil(input.durationSeconds ?? 0), input.maxOutputSeconds));
  return Math.max(1, Math.ceil(seconds * input.creditsPerSecond));
}
export const VIDEO_AUTHORIZATION_VERSION="beauty-video-asset-authorization-v1";
export type VideoActor={tenantId:string;userId:string};
export const videoDeclarationSchema=z.object({fileId:z.string().min(1).max(120),basisFileId:z.string().min(1).max(120),subjectRole:z.enum(["reference","owner","kol"]),purpose:z.literal("video_replacement"),expiresAt:z.string().datetime(),requestKey:z.string().min(12).max(120),rightsDeclared:z.literal(true)}).strict();
export type VideoDeclaration=z.infer<typeof videoDeclarationSchema>;
export type VideoAuthorizationReader=(f:VideoPrivateFile,kind:"reference"|"owner"|"kol"|"basis")=>Promise<InspectedVideoFile>;

export function createVideoAssetAuthorization(db:any, read:VideoAuthorizationReader, now=Date.now){
  async function scope(actor:VideoActor,write=false,tx=db){
    const member=await tx.membership.findFirst({where:{tenantId:actor.tenantId,userId:actor.userId,isActive:true}});
    // 共享出片能力：美业单品与兰琪工作台任一 active 权益都放行（清单只有一处）。
    const entitlement=await findVideoReplicationEntitlement(tx,actor.tenantId,now());
    if(!member||!entitlement)throw new ReplicationError("product_access_denied",403);
    // No new role grants. A store-scoped member cannot choose another store in body/header.
    if(write&&!(["owner","admin"].includes(member.role)||(member.role==="manager"&&member.storeId)))throw new ReplicationError("asset_declaration_forbidden",403);
    const stores=await tx.store.findMany({where:{tenantId:actor.tenantId,...(member.storeId?{id:member.storeId}:{})},take:2});
    if(stores.length!==1)throw new ReplicationError("store_context_required",409);
    return {storeId:stores[0].id,member,productCode:entitlement.productCode};
  }
  async function getFile(actor:VideoActor,id:string,tx=db){
    const f=await tx.uploadedFile.findFirst({where:{id,tenantId:actor.tenantId,userId:actor.userId}});
    if(!f)throw new ReplicationError("file_not_found",404);return f as VideoPrivateFile;
  }
  async function audit(tx:any,actor:VideoActor,action:string,id:string,code:string){
    // Raw file IDs remain only resource references in the private audit DB, never body/log output.
    await tx.auditLog.create({data:{tenantId:actor.tenantId,userId:actor.userId,action:`beauty_video.${action}`,resource:"video_asset_authorization",resourceId:id,detail:JSON.stringify({version:VIDEO_AUTHORIZATION_VERSION,code,tenantFingerprint:videoFileHash(actor.tenantId).slice(0,16)})}});
  }
  function publicRecord(r:any){return {id:r.id,fileId:r.fileId,subjectRole:r.subjectRole,purpose:r.purpose,version:r.version,contractVersion:r.contractVersion,assurance:r.assurance,status:r.revokedAt?"revoked":+r.expiresAt<=now()?"expired":"declaration_recorded",expiresAt:r.expiresAt};}
  async function inspect(actor:VideoActor,id:string,role:"reference"|"owner"|"kol"){
    const s=await scope(actor);
    const r=await db.beautyVideoAssetAuthorization.findFirst({where:{fileId:id,tenantId:actor.tenantId,storeId:s.storeId,declaredByUserId:actor.userId}});
    if(!r)throw new ReplicationError("asset_not_found",404);
    if(r.revokedAt||+r.expiresAt<=now()||r.contractVersion!==VIDEO_AUTHORIZATION_VERSION||r.subjectRole!==role||r.purpose!=="video_replacement"||r.assurance!=="user_declared_not_independently_verified")throw new ReplicationError("asset_authorization_required",422);
    const f=await getFile(actor,id),basis=await getFile(actor,r.basisFileId);
    if(f.sha256!==r.fileSha256||basis.sha256!==r.basisSha256)throw new ReplicationError("file_changed",409);
    const material=await read(f,role);await read(basis,"basis");
    const latest=await db.beautyVideoAssetAuthorization.findUnique({where:{id:r.id}});
    if(!latest||latest.version!==r.version||latest.revokedAt||+latest.expiresAt<=now())throw new ReplicationError("authorization_changed",409);
    return {record:r,material,evidence:{fileId:id,tenantId:actor.tenantId,storeId:s.storeId,sha256:material.sha256,evidenceId:r.id,authorizationVersion:r.version,expiresAt:+r.expiresAt,role,rights:r.rights,mimeType:material.mimeType,bytes:material.bytes.length,width:material.width,height:material.height,...(material.durationSeconds===undefined?{}:{durationSeconds:material.durationSeconds})} as ReplicationAssetEvidence};
  }
  return {
    scope,inspect,publicRecord,
    async declare(actor:VideoActor,raw:unknown){
      const parsed=videoDeclarationSchema.safeParse(raw);if(!parsed.success)throw new ReplicationError("invalid_declaration",400);const input=parsed.data;
      const s=await scope(actor,true),expiry=+new Date(input.expiresAt);
      if(expiry<=now()||expiry>now()+366*86400_000||input.fileId===input.basisFileId)throw new ReplicationError("declaration_bounds_invalid",422);
      const file=await getFile(actor,input.fileId),basis=await getFile(actor,input.basisFileId);
      const material=await read(file,input.subjectRole);const proof=await read(basis,"basis");
      const fingerprint=videoFileHash(JSON.stringify({input,tenantId:actor.tenantId,userId:actor.userId,storeId:s.storeId,sha:material.sha256,basisSha:proof.sha256}));
      const create=async(tx:any)=>{
        const currentScope=await scope(actor,true,tx);if(currentScope.storeId!==s.storeId)throw new ReplicationError("authorization_changed",409);
        const currentFile=await getFile(actor,input.fileId,tx),currentBasis=await getFile(actor,input.basisFileId,tx);
        if(currentFile.sha256!==material.sha256||currentBasis.sha256!==proof.sha256)throw new ReplicationError("file_changed",409);
        const old=await tx.beautyVideoAssetAuthorization.findFirst({where:{tenantId:actor.tenantId,requestKey:input.requestKey}});
        if(old){if(old.fingerprint!==fingerprint)throw new ReplicationError("idempotency_conflict",409);return old;}
        const record=await tx.beautyVideoAssetAuthorization.create({data:{tenantId:actor.tenantId,storeId:s.storeId,fileId:input.fileId,fileSha256:material.sha256,basisFileId:input.basisFileId,basisSha256:proof.sha256,subjectRole:input.subjectRole,purpose:input.purpose,rights:input.subjectRole==="reference"?["visual","audio","performer"]:["portrait"],declaredByUserId:actor.userId,requestKey:input.requestKey,fingerprint,metadata:{mimeType:material.mimeType,bytes:material.bytes.length,width:material.width,height:material.height,...(material.durationSeconds===undefined?{}:{durationSeconds:material.durationSeconds})},expiresAt:new Date(expiry)}});
        await audit(tx,actor,"declaration",record.id,"user_claim_recorded_not_legal_verification");return record;
      };
      try{return publicRecord(await db.$transaction(create,{isolationLevel:"Serializable"}));}catch(e:any){
        if(["P2002","P2034"].includes(e?.code)){const old=await db.beautyVideoAssetAuthorization.findFirst({where:{tenantId:actor.tenantId,requestKey:input.requestKey}});if(old?.fingerprint===fingerprint)return publicRecord(old);throw new ReplicationError("asset_scope_or_request_conflict",409);}throw e;
      }
    },
    async revoke(actor:VideoActor,id:string){
      const s=await scope(actor,true);
      return db.$transaction(async(tx:any)=>{
        const currentScope=await scope(actor,true,tx);if(currentScope.storeId!==s.storeId)throw new ReplicationError("authorization_changed",409);
        const r=await tx.beautyVideoAssetAuthorization.findFirst({where:{id,tenantId:actor.tenantId,storeId:s.storeId}});if(!r)throw new ReplicationError("asset_not_found",404);
        if(r.revokedAt)return publicRecord(r);
        const change=await tx.beautyVideoAssetAuthorization.updateMany({where:{id,version:r.version,revokedAt:null},data:{revokedAt:new Date(now()),version:{increment:1}}});
        if(change.count!==1){const latest=await tx.beautyVideoAssetAuthorization.findUnique({where:{id}});if(latest?.revokedAt)return publicRecord(latest);throw new ReplicationError("authorization_changed",409);}
        await audit(tx,actor,"revoke",id,"future_access_revoked_external_copy_not_recalled");return publicRecord(await tx.beautyVideoAssetAuthorization.findUnique({where:{id}}));
      });
    },
    async admission(actor:VideoActor,input:ReplicationRequest,policy:{creditCost:number;maxCostFen:number;maxOutputSeconds:number;stagingReady:boolean;creditsPerSecond?:number}):Promise<ReplicationAdmission>{
      const s=await scope(actor);if(!input.referenceFileId||!input.portraitFileId||input.referenceVideoUrl||input.portraitImageUrl)throw new ReplicationError("owned_file_ids_required",422);
      const reference=await inspect(actor,input.referenceFileId,"reference"),portrait=await inspect(actor,input.portraitFileId,input.template==="kol_visit"?"kol":"owner");
      return {tenantId:actor.tenantId,userId:actor.userId,storeId:s.storeId,productCode:s.productCode,entitlement:true,allowedStoreIds:[s.storeId],reference:reference.evidence,portrait:portrait.evidence,...policy,creditCost:computeReplicationCreditCost({durationSeconds:reference.evidence.durationSeconds,maxOutputSeconds:policy.maxOutputSeconds,creditsPerSecond:policy.creditsPerSecond,creditCost:policy.creditCost})};
    }
  };
}
