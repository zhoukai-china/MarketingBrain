import { createVideoMaterialIntegration } from "./beauty-video-material-integration.js";
import { createOssPrivateVideoStaging, type OssAudit, type OssTransport } from "./beauty-video-oss-staging.js";
import { ReplicationError } from "./viral-video-replication-runtime.js";

type MaterialOptions=Parameters<typeof createVideoMaterialIntegration>[0];
export type VideoStagingEnvironment={
  BEAUTY_VIDEO_STAGING_DRIVER?:string;
  BEAUTY_VIDEO_OSS_BUCKET?:string;BEAUTY_VIDEO_OSS_REGION?:string;BEAUTY_VIDEO_OSS_PREFIX?:string;BEAUTY_VIDEO_OSS_APPROVED_ORIGIN?:string;
  BEAUTY_VIDEO_OSS_ACCESS_KEY_ID?:string;BEAUTY_VIDEO_OSS_ACCESS_KEY_SECRET?:string;BEAUTY_VIDEO_OSS_SECURITY_TOKEN?:string;BEAUTY_VIDEO_OSS_CREDENTIAL_EXPIRES_AT?:string;
};

/** Same production assembly is used by the isolated runner. The environment cannot install a fixture
 * execution port or enable a paid provider. Budget/execution still belong to a separate server authority. */
export function createConfiguredVideoMaterialIntegration(options:Omit<MaterialOptions,"driver">&{
  environment:VideoStagingEnvironment;offlineTransport?:OssTransport;audit?:(event:OssAudit)=>void;
  beforeStorageRequest?:Parameters<typeof createOssPrivateVideoStaging>[0]["beforeRequest"];
}) {
  const {environment:e,offlineTransport,audit,beforeStorageRequest,...base}=options;
  if(!e.BEAUTY_VIDEO_STAGING_DRIVER||e.BEAUTY_VIDEO_STAGING_DRIVER==="disabled")return createVideoMaterialIntegration(base);
  try {
    if(e.BEAUTY_VIDEO_STAGING_DRIVER!=="aliyun_oss")throw new ReplicationError("staging_driver_not_supported",503);
    const driver=createOssPrivateVideoStaging({config:{bucket:e.BEAUTY_VIDEO_OSS_BUCKET??"",region:e.BEAUTY_VIDEO_OSS_REGION??"",
      prefix:e.BEAUTY_VIDEO_OSS_PREFIX??"",approvedOrigin:e.BEAUTY_VIDEO_OSS_APPROVED_ORIGIN??""},
      credentials:()=>({accessKeyId:e.BEAUTY_VIDEO_OSS_ACCESS_KEY_ID??"",accessKeySecret:e.BEAUTY_VIDEO_OSS_ACCESS_KEY_SECRET??"",
        securityToken:e.BEAUTY_VIDEO_OSS_SECURITY_TOKEN??"",expiresAt:Date.parse(e.BEAUTY_VIDEO_OSS_CREDENTIAL_EXPIRES_AT??"")}),
      transport:offlineTransport,now:base.now,audit,beforeRequest:beforeStorageRequest});
    // Pure configuration check; no bucket access at server boot or disabled quote.
    driver.checkCredentials();
    return createVideoMaterialIntegration({...base,driver});
  }catch(e){
    const code=e instanceof ReplicationError?e.code:"oss_staging_configuration_invalid";
    const closed=createVideoMaterialIntegration({...base,execution:undefined});
    return {...closed,admission:async(...args:Parameters<typeof closed.admission>)=>{await closed.admission(...args);throw new ReplicationError(code,503);}};
  }
}
