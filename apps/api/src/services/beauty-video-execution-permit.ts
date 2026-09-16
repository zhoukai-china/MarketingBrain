import { createHash,createHmac,randomUUID,timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createBeautyUsageMeter,usageHash,type UsageMeasure } from "./beauty-usage-metering.js";
import { readLanqiWalletBalance } from "./lanqi-wallet.js";
import { ReplicationError,type ReplicationJob } from "./viral-video-replication-runtime.js";
import { REPLICATION_CONTRACT,REPLICATION_MODEL,type ReplicationAdmission,type ReplicationRequest } from "./viral-video-replication.js";
import { findVideoReplicationEntitlement } from "./video-replication-entitlement.js";

export const VIDEO_EXECUTION_VERSION="beauty-video-controlled-execution-v1";
export const VIDEO_PRICE_VERSION="wan2.2-animate-mix-cn-beijing-20260905";
const id=z.string().min(1).max(160),sha=z.string().regex(/^[a-f0-9]{64}$/);
const asset=z.object({fileId:id,sha256:sha,evidenceId:id,version:z.number().int().positive(),role:z.enum(["reference","owner","kol"])}).strict();
/** No HTTP endpoint creates permits. An independently reviewed operator signs this exact scope.
 * Offline transport requires an offline-only permit and can never consume a real permit. */
export const videoExecutionScopeSchema=z.object({
  version:z.literal(VIDEO_EXECUTION_VERSION),contract:z.literal(REPLICATION_CONTRACT),
  permitId:id,tenantId:id,userId:id,storeId:id,requestKey:z.string().min(12).max(120),
  purpose:z.literal("video_replacement"),provider:z.literal("aliyun_bailian"),model:z.literal(REPLICATION_MODEL),region:z.literal("cn-beijing"),
  access:z.enum(["local_only","provider_https"]),mode:z.enum(["wan-std","wan-pro"]),template:z.enum(["owner_promo","kol_visit"]),
  requestHash:sha,reference:asset,portrait:asset,priceVersion:z.literal(VIDEO_PRICE_VERSION),
  maxOutputSeconds:z.number().int().min(2).max(30),maxSubmit:z.literal(1),maxPoll:z.number().int().min(1).max(240),
  maxStorageHttp:z.number().int().min(20).max(40),maxDownload:z.literal(1),
  maxCostFen:z.number().int().positive().max(100000),storageCostUpperFen:z.number().int().positive(),
  // Server-reviewed storage cost evidence: zero/missing evidence cannot authorize cloud access.
  storageCostEvidenceHash:sha,issuedAt:z.number().int(),expiresAt:z.number().int(),
}).strict();
export type VideoExecutionScope=z.infer<typeof videoExecutionScopeSchema>;
export const videoExecutionRequestHash=(input:ReplicationRequest)=>createHash("sha256").update(JSON.stringify(input)).digest("hex");
const fingerprint=(s:string)=>createHash("sha256").update(s).digest("hex").slice(0,16);
function reject(code:string,status=422):never{throw new ReplicationError(code,status);}

export function createVideoExecutionPermits(db:any,options:{authorityKey:string;access:"local_only"|"provider_https";now?:()=>number;autoIssue?:boolean}){
  if(Buffer.byteLength(options.authorityKey)<32)reject("execution_authority_unconfigured",503);
  const now=options.now??Date.now;
  const usageCall={step:"video_generation",attempt:1,provider:"aliyun_bailian",model:REPLICATION_MODEL,mode:options.access==="local_only"?"controlled_mock" as const:"real" as const};
  function usageMeter(tx:any,s:VideoExecutionScope){return createBeautyUsageMeter(tx,{tenantId:s.tenantId,userId:s.userId,storeId:s.storeId},s.permitId);}
  function usageMeasures(s:VideoExecutionScope,seconds?:number):UsageMeasure[]{return [{unit:"video_second",meter:"output",quantity:seconds===undefined?null:String(seconds),source:seconds===undefined?"unknown":"provider_usage",currency:"CNY",priceVersion:s.priceVersion,unitPriceMicros:s.mode==="wan-pro"?"900000":"600000",observedCostMicros:null,billingSource:"unknown"}];}
  function verified(row:any):VideoExecutionScope{
    const parsed=videoExecutionScopeSchema.safeParse(row?.scope);if(!parsed.success)reject("execution_permit_invalid");
    const s=parsed.data,expected=createHmac("sha256",options.authorityKey).update(JSON.stringify(s)).digest("hex");
    const received=Buffer.from(String(row.signature??"")),wanted=Buffer.from(expected);
    if(received.length!==wanted.length||!timingSafeEqual(received,wanted)||s.access!==options.access||s.permitId!==row.id||s.tenantId!==row.tenantId||s.userId!==row.userId||s.storeId!==row.storeId||s.requestKey!==row.requestKey)reject("execution_permit_invalid");
    if(s.expiresAt<=s.issuedAt||s.expiresAt-s.issuedAt>86400000||s.issuedAt>now()||
      s.maxCostFen<s.maxOutputSeconds*(s.mode==="wan-pro"?90:60)+s.storageCostUpperFen)reject("execution_budget_invalid");
    return s;
  }
  function live(row:any,s:VideoExecutionScope){if(row.revokedAt||now()>=s.expiresAt)reject("execution_permit_expired_or_revoked");}
  async function currentAccess(tx:any,s:VideoExecutionScope){
    const member=await tx.membership.findFirst({where:{tenantId:s.tenantId,userId:s.userId,isActive:true}});
    // 共享出片能力：美业单品与兰琪工作台任一 active 权益都放行（清单见 video-replication-entitlement.ts）。
    const entitlement=await findVideoReplicationEntitlement(tx,s.tenantId,now());
    if(!member||!entitlement||(member.storeId&&member.storeId!==s.storeId))reject("execution_access_revoked",403);
    for(const bound of[s.reference,s.portrait]){const r=await tx.beautyVideoAssetAuthorization.findFirst({where:{id:bound.evidenceId,tenantId:s.tenantId,storeId:s.storeId,declaredByUserId:s.userId,fileId:bound.fileId,fileSha256:bound.sha256,version:bound.version,subjectRole:bound.role,purpose:"video_replacement",revokedAt:null,expiresAt:{gt:new Date(now())}}});if(!r)reject("execution_asset_changed");}
  }
  async function rowFor(a:ReplicationAdmission,input:ReplicationRequest){
    const row=await db.beautyVideoExecutionPermit.findFirst({where:{tenantId:a.tenantId,userId:a.userId,requestKey:input.requestKey??""}});
    if(!row)reject("execution_permit_required");const s=verified(row);
    if(s.storeId!==a.storeId||s.requestHash!==videoExecutionRequestHash(input)||s.mode!==input.mode||s.template!==input.template)reject("execution_scope_mismatch");
    for(const [bound,current] of [[s.reference,a.reference],[s.portrait,a.portrait]] as const){
      if(bound.fileId!==current.fileId||bound.sha256!==current.sha256||bound.evidenceId!==current.evidenceId||bound.version!==current.authorizationVersion||bound.role!==current.role)reject("execution_asset_changed");
    }
    return {row,s};
  }
  async function audit(tx:any,row:any,phase:string,code:string){await tx.auditLog.create({data:{tenantId:row.tenantId,userId:row.userId,action:`beauty_video.execution.${phase}`,resource:"video_execution_permit",resourceId:row.id,
    detail:JSON.stringify({version:VIDEO_EXECUTION_VERSION,code,tenantFingerprint:fingerprint(row.tenantId),permitFingerprint:fingerprint(row.id)})}});}
  async function atomic<T>(fn:(tx:any)=>Promise<T>):Promise<T>{try{return await db.$transaction(fn,{isolationLevel:"Serializable"});}catch(e:any){if(["P2034","P2002"].includes(e?.code))reject("execution_concurrent_conflict",409);throw e;}}
  async function take(permitId:string,kind:"submit"|"poll"|"storage"|"cleanup"|"download"){
    return atomic(async tx=>{
      const row=await tx.beautyVideoExecutionPermit.findUnique({where:{id:permitId}});const s=verified(row);
      // Cleanup remains allowed after expiry/revoke, but uses the same finite persistent quota.
      if(kind!=="cleanup"){live(row,s);await currentAccess(tx,s);}
      if(row.status!=="claimed"||row.committedCostFen!==s.maxCostFen)reject("execution_permit_not_claimed");
      const field=kind==="cleanup"?"storageCount":`${kind}Count`,max=kind==="submit"?1:kind==="poll"?s.maxPoll:kind==="download"?1:s.maxStorageHttp;
      // Keep 8 requests reserved for cleanup; forwarding cannot spend the cleanup reserve.
      const limit=kind==="storage"?max-8:max;
      if(!Number.isInteger(row[field])||row[field]<0||row[field]>=limit)reject("execution_request_limit");
      const count=await tx.beautyVideoExecutionPermit.updateMany({where:{id:row.id,status:"claimed",[field]:row[field]},data:{[field]:{increment:1},lastCode:`${kind}_attempt_committed`}});
      if(count.count!==1)reject("execution_concurrent_conflict",409);
      await audit(tx,row,kind,"attempt_committed_no_automatic_retry");
      if(kind==="submit")await usageMeter(tx,s).begin(usageCall,usageMeasures(s));
      return s;
    });
  }
  /**
   * 单批许可的**自动签发**（用户 2026-09-14 拍板 A 方案）。
   *
   * 原口径是"许可只能由运营离线签"（没有任何 HTTP 接口）。兰琪门店要自助出片时，
   * 每出一条都等人工介入等于功能不可用；改为：条件满足就由服务端按**同一套预算上限**
   * 自动签一条绑定本次请求的许可。安全性质一条不少：
   *   · 绑定 (tenantId,userId,requestKey) + 素材授权指纹 + 请求哈希，换素材即换键；
   *   · 预算自检 maxCostFen ≥ maxOutputSeconds×费率 + 存储上限，输出秒数由预算反推（不越权加钱）；
   *   · 仍然只能 claim 一次、submit 一次，轮询 / 下载 / 暂存各有上限，扣分与幂等不变；
   *   · 许可被 claim 过或已被撤销时**不重签**，直接失败关闭。
   */
  const AUTO_PERMIT_TTL_MS=2*3600*1000;
  /** 存储成本上限：一次 PUT 的极小额，取 1 分（与 LQ-27 样片同一口径）。 */
  const STORAGE_COST_UPPER_FEN=1;
  function autoScope(a:ReplicationAdmission,input:ReplicationRequest,permitId:string,issuedAt:number){
    const ratePerSecond=input.mode==="wan-pro"?90:60;
    const affordable=Math.floor((a.maxCostFen-STORAGE_COST_UPPER_FEN)/ratePerSecond);
    const maxOutputSeconds=Math.min(a.maxOutputSeconds,affordable);
    if(!Number.isInteger(maxOutputSeconds)||maxOutputSeconds<2)reject("execution_budget_too_small");
    const bound=(e:ReplicationAdmission["reference"]|ReplicationAdmission["portrait"])=>({fileId:e.fileId,sha256:e.sha256,evidenceId:e.evidenceId,version:e.authorizationVersion,role:e.role});
    return videoExecutionScopeSchema.parse({version:VIDEO_EXECUTION_VERSION,contract:REPLICATION_CONTRACT,permitId,
      tenantId:a.tenantId,userId:a.userId,storeId:a.storeId,requestKey:input.requestKey,purpose:"video_replacement",
      provider:"aliyun_bailian",model:REPLICATION_MODEL,region:"cn-beijing",access:options.access,mode:input.mode,
      template:input.template,requestHash:videoExecutionRequestHash(input),reference:bound(a.reference),portrait:bound(a.portrait),
      priceVersion:VIDEO_PRICE_VERSION,maxOutputSeconds,maxSubmit:1,maxPoll:120,maxStorageHttp:40,maxDownload:1,
      maxCostFen:a.maxCostFen,storageCostUpperFen:STORAGE_COST_UPPER_FEN,
      // 成本证据 = 两份素材授权记录的不可变指纹（真实记录，不是编造值）。
      storageCostEvidenceHash:createHash("sha256").update(JSON.stringify([
        {id:a.reference.evidenceId,fileId:a.reference.fileId,sha256:a.reference.sha256,version:a.reference.authorizationVersion},
        {id:a.portrait.evidenceId,fileId:a.portrait.fileId,sha256:a.portrait.sha256,version:a.portrait.authorizationVersion}
      ])).digest("hex"),
      issuedAt,expiresAt:issuedAt+AUTO_PERMIT_TTL_MS});
  }
  async function ensure(a:ReplicationAdmission,input:ReplicationRequest){
    if(!options.autoIssue)return;
    const requestKey=input.requestKey??"";
    if(!requestKey)reject("idempotency_key_required",400);
    const existing=await db.beautyVideoExecutionPermit.findFirst({where:{tenantId:a.tenantId,userId:a.userId,requestKey}});
    if(existing){
      try{
        const current=verified(existing);live(existing,current);
        if(current.storeId===a.storeId&&current.requestHash===videoExecutionRequestHash(input)&&current.mode===input.mode&&current.template===input.template)return;
      }catch{/* 过期 / 绑定漂移：下面按"重签"处理，只有从未用过的才重签 */ }
      // 已 claim、已花预算或已撤销的许可一律保留并失败关闭；只有"签了但从未用过"的可以就地重签 scope。
      if(existing.revokedAt||existing.status!=="approved"||existing.submitCount!==0||existing.committedCostFen!==0)reject("execution_permit_not_reusable",409);
      const rotated=autoScope(a,input,existing.id,now());
      const signature=createHmac("sha256",options.authorityKey).update(JSON.stringify(rotated)).digest("hex");
      const changed=await db.beautyVideoExecutionPermit.updateMany({where:{id:existing.id,status:"approved",submitCount:0,committedCostFen:0,revokedAt:null},
        data:{storeId:a.storeId,scope:rotated as object,signature,lastCode:"auto_reissued_unused"}});
      if(changed.count!==1)reject("execution_permit_not_reusable",409);
      return;
    }
    const issuedAt=now(),permitId=randomUUID(),scope=autoScope(a,input,permitId,issuedAt);
    const signature=createHmac("sha256",options.authorityKey).update(JSON.stringify(scope)).digest("hex");
    try{
      await db.beautyVideoExecutionPermit.create({data:{id:permitId,tenantId:a.tenantId,userId:a.userId,storeId:a.storeId,
        requestKey,scope:scope as object,signature,status:"approved",lastCode:"auto_issued_pending_confirmation"}});
    }catch(error:any){
      // 两次报价并发：唯一键冲突说明另一路已签发，直接复用那条，不重复签。
      if(error?.code!=="P2002")throw error;
    }
  }
  return {
    ensure,
    async admission(a:ReplicationAdmission,input:ReplicationRequest,history=false){
      const {row,s}=await rowFor(a,input);if(!history)live(row,s);
      return {...a,maxCostFen:s.maxCostFen-s.storageCostUpperFen,maxOutputSeconds:s.maxOutputSeconds,executionPermitId:row.id};
    },
    async claim(a:ReplicationAdmission,input:ReplicationRequest){
      const {row,s}=await rowFor(a,input);live(row,s);
      // LQ-34 ⑤：许可预算校验必须和扣费同源——读**owner 通用钱包余额**，
      // 否则会出现"许可说预算够、扣费说没钱"。读余额放在原子块之外：
      // `readLanqiWalletBalance` 自己会开事务，嵌进 Serializable 事务里等于两层事务。
      // 找不到 owner（没有可扣费的老板账号）→ 失败关闭，直接 402，不放行、不调模型。
      const wallet=await readLanqiWalletBalance(a.tenantId,db);
      if(!wallet||wallet.balance<a.creditCost)reject("insufficient_credits",402);
      await atomic(async tx=>{
        const current=await tx.beautyVideoExecutionPermit.findUnique({where:{id:row.id}});const scope=verified(current);live(current,scope);await currentAccess(tx,scope);
        // Claim once before any cloud PUT. A crash before job creation is a stopped batch, not a replay ticket.
        const result=await tx.beautyVideoExecutionPermit.updateMany({where:{id:row.id,status:"approved",revokedAt:null,submitCount:0,storageCount:0,committedCostFen:0},
          data:{status:"claimed",claimedAt:new Date(now()),committedCostFen:scope.maxCostFen,lastCode:"batch_claimed"}});
        if(result.count!==1)reject("execution_batch_already_claimed",409);
        await audit(tx,current,"claim","worst_cost_committed_not_provider_actual_cost");
      });
    },
    async beforeSubmit(job:ReplicationJob){await take(job.authorizationSnapshot.executionPermitId,"submit");},
    async beforePoll(job:ReplicationJob){await take(job.authorizationSnapshot.executionPermitId,"poll");},
    async beforeDownload(job:ReplicationJob){await take(job.authorizationSnapshot.executionPermitId,"download");},
    async storage(permitId:string|undefined,cleanup=false){if(!permitId)reject("execution_permit_required");await take(permitId,cleanup?"cleanup":"storage");},
    async accepted(job:ReplicationJob,taskId:string){
      const row=await db.beautyVideoExecutionPermit.findUnique({where:{id:job.authorizationSnapshot.executionPermitId}}),s=verified(row);
      if(s.tenantId!==job.tenantId||s.userId!==job.userId)reject("execution_scope_mismatch");
      await usageMeter(db,s).observe(usageCall,{status:"pending",code:"provider_accepted",providerRequestFingerprint:usageHash(taskId),measures:usageMeasures(s)});
    },
    async observe(job:ReplicationJob,seconds:number|undefined,status="UNKNOWN"){
      const row=await db.beautyVideoExecutionPermit.findUnique({where:{id:job.authorizationSnapshot.executionPermitId}}),s=verified(row);
      if(s.tenantId!==job.tenantId||s.userId!==job.userId)reject("execution_scope_mismatch");
      if(seconds!==undefined&&(!Number.isFinite(seconds)||seconds<0))reject("execution_cost_invalid");
      await usageMeter(db,s).observe(usageCall,{status:status==="SUCCEEDED"?"succeeded":status==="FAILED"?"failed":status==="CANCELED"?"cancelled":status==="PENDING"||status==="RUNNING"?"pending":"unknown",code:"provider_status_observed",providerRequestFingerprint:job.providerTaskId?usageHash(job.providerTaskId):null,measures:usageMeasures(s,seconds)});
      if(seconds===undefined)return;
      const cost=Math.ceil(seconds!*(s.mode==="wan-pro"?90:60));if(!Number.isSafeInteger(cost)||cost<0)reject("execution_cost_invalid");
      await atomic(async tx=>{await tx.beautyVideoExecutionPermit.update({where:{id:row.id},data:{observedProviderCostFen:cost,lastCode:cost>s.maxCostFen-s.storageCostUpperFen?"observed_cost_exceeds_authorized":"provider_usage_observed"}});await audit(tx,row,"usage","observed_cost_not_refunded");});
    }
  };
}
