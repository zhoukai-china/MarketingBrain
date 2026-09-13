import path from "node:path";
import { createConfiguredVideoMaterialIntegration,type VideoStagingEnvironment } from "./beauty-video-staging-config.js";
import { createVideoExecutionPermits } from "./beauty-video-execution-permit.js";
import { createReplicationProvider,replicationSchema,REPLICATION_MODEL,type ReplicationRequest } from "./viral-video-replication.js";
import { createReplicationAssetStore } from "./viral-video-replication-assets.js";
import { ReplicationError } from "./viral-video-replication-runtime.js";

/**
 * 供应商密钥的形状检查（LQ-27 现场修正）。
 *
 * 这道检查的本意是"看起来像一把供应商密钥"，不是"校验密钥真伪"（真伪由调用结果决定）。
 * 原实现写死 `/^sk-[A-Za-z0-9_-]{16,}$/`，但生产在用的工作区密钥形如
 * `sk-ws-….<含小数点>`，env 行尾还可能残留 CR —— 结果配置完全合法却永远
 * 503 `execution_configuration_invalid`，付费链路根本开不了闸。
 * 现在：允许 `.`，容忍尾部空白与 CR，其余照旧从严。
 */
export function isProviderKeyShaped(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /^sk-[A-Za-z0-9_.-]{16,}$/.test(value.replace(/[\s\r\n]+$/, ""));
}

type Base=Parameters<typeof createConfiguredVideoMaterialIntegration>[0];
export type VideoExecutionEnvironment=VideoStagingEnvironment&{
  BEAUTY_VIDEO_EXECUTION_MODE?:string;BEAUTY_VIDEO_EXECUTION_AUTHORITY_KEY?:string;
  BEAUTY_VIDEO_RESULT_HOSTS?:string;ALIYUN_VIDEO_REPLICATION_API_KEY?:string;
  ALIYUN_VIDEO_REPLICATION_MODEL?:string;ALIYUN_VIDEO_REPLICATION_ENDPOINT?:string;
};
/** Environment selects code, never grants permission. Permits are HMAC-bound records in the existing DB.
 * No issue endpoint, no auto key loading, no paid retry. Only explicit HTTP confirmation executes. */
export function createControlledVideoIntegration(options:Omit<Base,"environment"|"execution"|"control"|"beforeStorageRequest">&{
  environment:VideoExecutionEnvironment;resultRoot:string;providerFetch?:typeof fetch;resultFetch?:typeof fetch;
}){
  const {environment:e,resultRoot,providerFetch,resultFetch,...base}=options;
  const closed=createConfiguredVideoMaterialIntegration({...base,environment:e});
  if(!e.BEAUTY_VIDEO_EXECUTION_MODE||e.BEAUTY_VIDEO_EXECUTION_MODE==="disabled")return closed;
  try{
    const injected=[base.offlineTransport,providerFetch,resultFetch].filter(Boolean).length;
    if(e.BEAUTY_VIDEO_EXECUTION_MODE!=="controlled"||e.BEAUTY_VIDEO_STAGING_DRIVER!=="aliyun_oss"||
      (injected!==0&&injected!==3)||e.ALIYUN_VIDEO_REPLICATION_MODEL!==REPLICATION_MODEL||
      !isProviderKeyShaped(e.ALIYUN_VIDEO_REPLICATION_API_KEY)||!path.isAbsolute(resultRoot)||
      e.BEAUTY_VIDEO_EXECUTION_AUTHORITY_KEY===e.ALIYUN_VIDEO_REPLICATION_API_KEY)throw new ReplicationError("execution_configuration_invalid",503);
    const access=injected?"local_only" as const:"provider_https" as const;
    const hosts=(e.BEAUTY_VIDEO_RESULT_HOSTS??"").split(",").map(s=>s.trim());
    if(!hosts.length||hosts.some(h=>!/^(?:[a-z0-9-]+\.)*oss-cn-[a-z0-9-]+\.aliyuncs\.com$|^(?:[a-z0-9-]+\.)*oss-accelerate\.aliyuncs\.com$/.test(h)))throw new ReplicationError("execution_result_host_required",503);
    const permits=createVideoExecutionPermits(base.db,{authorityKey:e.BEAUTY_VIDEO_EXECUTION_AUTHORITY_KEY??"",access,now:base.now});
    const provider=createReplicationProvider({endpoint:e.ALIYUN_VIDEO_REPLICATION_ENDPOINT??"",apiKey:e.ALIYUN_VIDEO_REPLICATION_API_KEY!,fetch:providerFetch});
    const assets=createReplicationAssetStore({root:resultRoot,allowedResultHosts:hosts,fetch:resultFetch});
    const integrated=createConfiguredVideoMaterialIntegration({...base,environment:e,control:permits,
      beforeStorageRequest:async(o,cleanup)=>permits.storage(o?.executionPermitId,cleanup),
      execution:{access,submit:async(input,job)=>{let taskId:string;try{taskId=await provider.submit(input);}catch(error){await permits.observe(job,undefined,"UNKNOWN");throw error;}await permits.accepted(job,taskId);return taskId;},
        poll:async(taskId,job)=>{await permits.beforePoll(job);let result:Awaited<ReturnType<typeof provider.poll>>;try{result=await provider.poll(taskId);}catch(error){await permits.observe(job,undefined,"UNKNOWN");throw error;}await permits.observe(job,result.seconds,result.status);return result;},
        persist:async(job,url)=>{await permits.beforeDownload(job);return assets.persist(job,url);},read:assets.read}
    });
    return {...integrated,admission:async(...args:Parameters<typeof integrated.admission>)=>{
      const a=await integrated.admission(...args);if(!a)return a;
      let input=args[1];
      if(!input){const job=await integrated.repository.get(args[2]!,a.tenantId);input=job?.authorizationSnapshot.request as ReplicationRequest|undefined;}
      if(!input)throw new ReplicationError("execution_history_not_bound",409);
      return permits.admission(a,replicationSchema.parse(input),!args[1]);
    }};
  }catch(e){
    const code=e instanceof ReplicationError?e.code:"execution_configuration_invalid";
    return {...closed,admission:async(...args:Parameters<typeof closed.admission>)=>{await closed.admission(...args);throw new ReplicationError(code,503);}};
  }
}
