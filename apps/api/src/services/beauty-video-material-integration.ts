import { createReplicationRepository, createReplicationRuntime, ReplicationError, type ReplicationRuntimePorts } from "./viral-video-replication-runtime.js";
import { replicationSchema, type ReplicationAdmission } from "./viral-video-replication.js";
import { createVideoPrivateStaging, type PrivateVideoStagingDriver } from "./beauty-video-private-staging.js";
import type { createVideoAssetAuthorization } from "./beauty-video-asset-authorization.js";
import type { ReplicationRoutePorts } from "../routes/viral-video-replication.js";
import { videoFileHash } from "./beauty-video-private-files.js";

/** No default real transport and no environment flag can turn local fixtures into a cloud adapter. */
export function createVideoMaterialIntegration(options:{
  db:any;authorization:ReturnType<typeof createVideoAssetAuthorization>;driver?:PrivateVideoStagingDriver;
  policy:{creditCost:number;maxCostFen:number;maxOutputSeconds:number;creditsPerSecond?:number};now?:()=>number;
  execution?:Pick<ReplicationRuntimePorts,"submit"|"poll"|"persist"|"read">&{access:"local_only"|"provider_https"};
  control?:ReplicationRuntimePorts["control"];
}){
  const {db,authorization,driver,execution}=options,now=options.now??Date.now,repo=createReplicationRepository(db);
  if(execution&&(!driver||driver.access!==execution.access))throw new ReplicationError("staging_transport_mismatch",503);
  const staging=driver?createVideoPrivateStaging(db,authorization,driver,now):undefined;
  async function stopIneligible(job:any){
    if(!job||job.billingStatus!=="reserved")return;
    await repo.finish(job,job.status==="queued"?"canceled":"terminal_unknown","authorization_unavailable_external_not_recalled");
    if(job.authorizationSnapshot.stagingLeaseId)await staging?.release(job.authorizationSnapshot.stagingLeaseId);
  }
  const admission:NonNullable<ReplicationRoutePorts["admission"]>=async(context,input,jobId)=>{
    let recoveredJob:any;
    if(!input){
      const job=jobId?await repo.get(jobId,context.tenantId):null;
      if(!job||job.userId!==context.userId)throw new ReplicationError("job_not_found",404);
      recoveredJob=job;
      input=replicationSchema.parse({model:"aliyun_strict",requestKey:job.requestKey,referenceFileId:job.authorizationSnapshot.reference.fileId,portraitFileId:job.authorizationSnapshot.portrait.fileId,template:job.authorizationSnapshot.template,mode:job.authorizationSnapshot.mode,visualRightsConfirmed:true,audioRightsConfirmed:true,performerConsentConfirmed:true,portraitConsentConfirmed:true});
    }
    try{return await authorization.admission(context,input,{...options.policy,stagingReady:Boolean(staging&&execution)});}
    catch(e){if(e instanceof ReplicationError&&["asset_authorization_required","authorization_changed","file_changed","product_access_denied","asset_not_found","file_not_found"].includes(e.code))await stopIneligible(recoveredJob);throw e;}
  };
  const authorize:NonNullable<ReplicationRuntimePorts["authorize"]>=async(a,phase,job)=>{
    const actor={tenantId:a.tenantId,userId:a.userId},s=await authorization.scope(actor);
    if(s.storeId!==a.storeId)throw new ReplicationError("authorization_changed",409);
    for(const old of [a.reference,a.portrait]){
      const current=await authorization.inspect(actor,old.fileId,old.role);
      if(current.evidence.sha256!==old.sha256||current.evidence.evidenceId!==old.evidenceId)throw new ReplicationError("authorization_changed",409);
      if(job){const historical=old.role==="reference"?job.authorizationSnapshot.reference:job.authorizationSnapshot.portrait;if(historical.evidenceId!==old.evidenceId||historical.sha256!==old.sha256)throw new ReplicationError("authorization_changed",409);}
    }
    await db.auditLog.create({data:{tenantId:a.tenantId,userId:a.userId,action:`beauty_video.access.${phase}`,resource:"video_replication",resourceId:job?.id,detail:JSON.stringify({code:"scope_and_file_hash_checked",tenantFingerprint:videoFileHash(a.tenantId).slice(0,16)})}});
  };
  const runtime=staging&&execution?createReplicationRuntime({repository:repo,now,stage:staging.stage,authorize,control:options.control,...execution,cleanup:async j=>{if(j.authorizationSnapshot.stagingLeaseId)await staging.release(j.authorizationSnapshot.stagingLeaseId);}}):undefined;
  const integratedAuthorization={...authorization,revoke:async(actor:Parameters<typeof authorization.revoke>[0],id:string)=>{
    const record=await authorization.revoke(actor,id);
    const jobs=await db.viralVideoReplicationJob.findMany({where:{tenantId:actor.tenantId,billingStatus:"reserved",OR:[{authorizationSnapshot:{path:["reference","evidenceId"],equals:id}},{authorizationSnapshot:{path:["portrait","evidenceId"],equals:id}}]},take:100});
    for(const job of jobs)await stopIneligible(job);
    // Stage precedes job/credit creation. Revocation must also clean leases with no job yet.
    const leases=staging?await db.beautyVideoStagingLease.findMany({where:{tenantId:actor.tenantId,status:{not:"released"},
      authorizationVersions:{array_contains:[{id}]}},take:100}):[];
    for(const lease of leases)await staging!.release(lease.id);
    return {...record,cleanupMayRemain:jobs.length===100||leases.length===100};
  }};
  return {admission,runtime,repository:repo,authorization:integratedAuthorization,staging};
}
