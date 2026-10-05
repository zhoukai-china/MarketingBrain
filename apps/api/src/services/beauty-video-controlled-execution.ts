import path from "node:path";
import { randomUUID } from "node:crypto";
import { createConfiguredVideoMaterialIntegration,type VideoStagingEnvironment } from "./beauty-video-staging-config.js";
import { createVideoExecutionPermits } from "./beauty-video-execution-permit.js";
import { createReplicationProvider,replicationSchema,REPLICATION_MODEL,type ReplicationRequest } from "./viral-video-replication.js";
import { createReplicationAssetStore } from "./viral-video-replication-assets.js";
import { probeClip } from "./clip-renderer.js";
import { ReplicationError, type ReplicationRuntimePorts } from "./viral-video-replication-runtime.js";

type ExecutionPort=Pick<ReplicationRuntimePorts,"submit"|"poll"|"persist"|"read">&{access:"local_only"|"provider_https"};

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
  /** `auto` = 条件满足就按预算自动签单批许可（用户 2026-09-14 拍板）；缺省/其他值一律走人工签发。 */
  VIDEO_REPLICATION_PERMIT_MODE?:string;
  /** 本地联调回放（2026-10-04）：指向一份真实成片 mp4 → 不调阿里云。生产环境忽略。 */
  BEAUTY_VIDEO_REPLICATION_MOCK_VIDEO?:string;
  NODE_ENV?:string;
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
    // 结果域名白名单改为「可选」：不再强制配置 BEAUTY_VIDEO_RESULT_HOSTS。
    // 原强制校验已被证明只有坏处、没有安全收益——
    //   ① 结果 URL 来自阿里云 poll 响应（服务端主动调用所得），不是客户端可伪造的输入；
    //   ② isResultHostAllowed() 第一步就用 isAliyunOssResultFamily() 无条件放行 OSS 域名族，
    //      本 env 只是源码注释里写的「第二道防线」，运行时几乎轮不到它生效；
    //   ③ 强制配置曾真实拦掉过成片：百炼结果落到 oss-cn-wulanchabu 时被判
    //      artifact_host_not_approved，任务 FAILED（见 beauty-industry-image-asset-url-policy-p1-smoke.ts:27）。
    // 因此：留空 = 只依赖 OSS 域名族（自动覆盖任意区域，含 wulanchabu / hangzhou / accelerate），零配置即可用；
    // 若确需额外收窄，仍可配置精确基域，但不再是上线前置条件。
    const hosts=(e.BEAUTY_VIDEO_RESULT_HOSTS??"").split(",").map(s=>s.trim()).filter(Boolean);
    const permits=createVideoExecutionPermits(base.db,{authorityKey:e.BEAUTY_VIDEO_EXECUTION_AUTHORITY_KEY??"",access,now:base.now,
      autoIssue:e.VIDEO_REPLICATION_PERMIT_MODE==="auto"});
    const provider=createReplicationProvider({endpoint:e.ALIYUN_VIDEO_REPLICATION_ENDPOINT??"",apiKey:e.ALIYUN_VIDEO_REPLICATION_API_KEY!,fetch:providerFetch});
    const assets=createReplicationAssetStore({root:resultRoot,allowedResultHosts:hosts,fetch:resultFetch});
    // 2026-10-04 本地联调：BEAUTY_VIDEO_REPLICATION_MOCK_VIDEO 指向一份真实成片时，
    // submit/poll 不再调用阿里云（不提交、不轮询），persist 走同一条内部落盘路径回放该文件。
    // 生产环境忽略此配置——防止误配把付费接口静默替换成回放。
    const mockVideoPath=e.NODE_ENV==="production"?"":(e.BEAUTY_VIDEO_REPLICATION_MOCK_VIDEO??"").trim();
    const execution:ExecutionPort={access,
      submit:async(input,job)=>{let taskId:string;try{taskId=await provider.submit(input);}catch(error){await permits.observe(job,undefined,"UNKNOWN");throw error;}await permits.accepted(job,taskId);return taskId;},
      poll:async(taskId,job)=>{await permits.beforePoll(job);let result:Awaited<ReturnType<typeof provider.poll>>;try{result=await provider.poll(taskId);}catch(error){await permits.observe(job,undefined,"UNKNOWN");throw error;}await permits.observe(job,result.seconds,result.status);return result;},
      persist:async(job,url)=>{await permits.beforeDownload(job);return assets.persist(job,url);},read:assets.read};
    const effectiveExecution=mockVideoPath?(()=>{
      let cached:Promise<{seconds:number;width:number;height:number}>|null=null;
      const probeOnce=()=>cached??(cached=probeClip(mockVideoPath).then(p=>({seconds:p.durationSeconds,width:p.width,height:p.height})));
      return {...execution,
        submit:async(input:Parameters<typeof execution.submit>[0],job:Parameters<typeof execution.submit>[1])=>{const taskId=`mock-${randomUUID()}`;await permits.accepted(job,taskId);console.log(`[viral-replication] provider.mock-submit ${JSON.stringify({jobId:job.id,taskId,mockVideo:path.basename(mockVideoPath)})}`);return taskId;},
        poll:async(taskId:string,job:Parameters<typeof execution.poll>[1])=>{await permits.beforePoll(job);const m=await probeOnce();const result={status:"SUCCEEDED" as const,videoUrl:"https://mock-replay.oss-cn-beijing.aliyuncs.com/mock-result.mp4",seconds:m.seconds};await permits.observe(job,result.seconds,result.status);console.log(`[viral-replication] provider.mock-poll ${JSON.stringify({jobId:job.id,providerStatus:result.status,seconds:result.seconds})}`);return result;},
        persist:async(job:Parameters<typeof execution.persist>[0],url:string)=>{await permits.beforeDownload(job);const artifact=await assets.persistLocal(job,mockVideoPath);console.log(`[viral-replication] provider.mock-persist ${JSON.stringify({jobId:job.id,bytes:artifact.bytes,durationSeconds:artifact.durationSeconds,width:artifact.width,height:artifact.height,sha256:artifact.sha256})}`);return artifact;}
      };
    })():execution;
    const integrated=createConfiguredVideoMaterialIntegration({...base,environment:e,control:permits,
      beforeStorageRequest:async(o,cleanup)=>permits.storage(o?.executionPermitId,cleanup),
      execution:effectiveExecution
    });
    return {...integrated,admission:async(...args:Parameters<typeof integrated.admission>)=>{
      const a=await integrated.admission(...args);if(!a)return a;
      let input=args[1];
      if(!input){const job=await integrated.repository.get(args[2]!,a.tenantId);input=job?.authorizationSnapshot.request as ReplicationRequest|undefined;}
      if(!input)throw new ReplicationError("execution_history_not_bound",409);
      const request=replicationSchema.parse(input);
      // auto 模式：按同一套预算上限自动签发绑定本次请求的单批许可（幂等，已用过的不重签）。
      await permits.ensure(a,request);
      return permits.admission(a,request,!args[1]);
    }};
  }catch(e){
    const code=e instanceof ReplicationError?e.code:"execution_configuration_invalid";
    return {...closed,admission:async(...args:Parameters<typeof closed.admission>)=>{await closed.admission(...args);throw new ReplicationError(code,503);}};
  }
}
