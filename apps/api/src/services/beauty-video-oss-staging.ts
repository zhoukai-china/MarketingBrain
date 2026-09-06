import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import { ReplicationError } from "./viral-video-replication-runtime.js";
import type { PrivateVideoStagingDriver, StagedObject } from "./beauty-video-private-staging.js";

const require = createRequire(import.meta.url);
// Pinned official SDK: signing, request construction and XML response parsing, not copied algorithms.
const OSS = require("ali-oss");
const sdkRequire = createRequire(require.resolve("ali-oss"));
const sdkDebug = sdkRequire("debug");
const hash = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const fail = (code: string): never => { throw new ReplicationError(code, 503); };
const keyPattern = /^[a-f0-9]{32}-(reference|portrait)\.(mp4|png|jpg|webp|bmp|mov|avi)$/;
export const OSS_STAGING_VERSION = "beauty-oss-private-staging-v1";
export type OssStagingConfig = { bucket: string; region: string; prefix: string; approvedOrigin: string };
export type OssStagingCredentials = { accessKeyId: string; accessKeySecret: string; securityToken: string; expiresAt: number };
export type OssWireRequest = { method: string; url: string; headers: Record<string,string>; body?: Buffer; timeoutMs: number };
export type OssWireResponse = { status: number; headers: Record<string,string>; body: Buffer };
export type OssTransport = (request: OssWireRequest) => Promise<OssWireResponse>;
export type OssAudit = { event: "beauty_video.oss"; operation: string; status: number; elapsedMs: number; code: string; objectFingerprint: string };

export function validateOssStagingConfig(c: OssStagingConfig) {
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(c.bucket) || c.region !== "cn-beijing" ||
      !/^beauty-industry\/video-staging\/v1\/[a-z0-9-]{3,32}\/$/.test(c.prefix) ||
      c.approvedOrigin !== `https://${c.bucket}.oss-${c.region}.aliyuncs.com`) fail("oss_staging_configuration_invalid");
  return c;
}

const blocked = new BlockList();
for (const [ip, bits] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],
  ["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.168.0.0",16],["192.88.99.0",24],
  ["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",4],["240.0.0.0",4]] as const) blocked.addSubnet(ip,bits);
export function assertOssPublicIpv4(addresses: readonly string[]) {
  if (!addresses.length || addresses.some(a => isIP(a) !== 4 || blocked.check(a))) fail("oss_dns_rejected");
}

/** Single HTTPS attempt, pinned resolved address + original TLS hostname. No proxy/redirect/retry. */
export function createOssHttpsTransport(origin: string): OssTransport {
  return async r => {
    const u = new URL(r.url);
    if (u.origin !== origin || u.username || u.password || u.hash || u.protocol !== "https:") fail("oss_transport_origin_rejected");
    const signal = AbortSignal.timeout(r.timeoutMs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const rows = await Promise.race([lookup(u.hostname,{family:4,all:true}), new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>reject(new ReplicationError("oss_dns_timeout",503)),r.timeoutMs);
      })]);
      if (signal.aborted) fail("oss_transport_timeout");
      assertOssPublicIpv4(rows.map(x=>x.address));
      const address=rows[0].address;
      return await new Promise<OssWireResponse>((resolve,reject)=>{
        const req=httpsRequest(u,{method:r.method,headers:r.headers,agent:false,servername:u.hostname,
          rejectUnauthorized:true,signal,lookup:(_host,_options,callback:any)=>callback(null,address,4)},res=>{
          const chunks:Buffer[]=[];let size=0;
          res.on("data",chunk=>{size+=chunk.length;if(size>65536){res.destroy();reject(new ReplicationError("oss_response_too_large",503));}else chunks.push(Buffer.from(chunk));});
          res.on("error",()=>reject(new ReplicationError("oss_transport_unknown",503)));
          res.on("end",()=>resolve({status:res.statusCode??0,headers:Object.fromEntries(Object.entries(res.headers).map(([k,v])=>[k,String(v??"")])),body:Buffer.concat(chunks)}));
        });
        req.on("error",()=>reject(new ReplicationError("oss_transport_unknown",503)));
        req.end(r.body);
      });
    } finally { if(timer)clearTimeout(timer); }
  };
}

/** Injection is explicitly local_only. A fixture can never acquire provider_https identity. */
export function createOssPrivateVideoStaging(options: {
  config: OssStagingConfig; credentials: () => OssStagingCredentials;
  transport?: OssTransport; now?:()=>number; audit?:(event:OssAudit)=>void;
  beforeRequest?:(o:StagedObject|undefined,cleanup:boolean)=>Promise<void>;
}) {
  const c=validateOssStagingConfig({...options.config}),now=options.now??Date.now;
  const offline=Boolean(options.transport),transport=options.transport??createOssHttpsTransport(c.approvedOrigin);
  const signed=new Map<string,{url:string;binding:string;expiresAt:number}>();
  const id=`${OSS_STAGING_VERSION}:${offline?"offline":"real"}:${hash(JSON.stringify(c)).slice(0,16)}`;
  const binding=(o:StagedObject)=>hash(JSON.stringify([o.key,o.authorizationId,o.version,o.fileId,o.sha256,o.role,o.expiresAt,o.mimeType]));
  function objectName(o:StagedObject) {
    const mime:Record<string,string[]>={mp4:["video/mp4"],mov:["video/quicktime"],avi:["video/x-msvideo"],png:["image/png"],jpg:["image/jpeg"],webp:["image/webp"],bmp:["image/bmp"]};
    if(!keyPattern.test(o.key)||!/^[a-f0-9]{64}$/.test(o.sha256)||!o.authorizationId||!o.fileId||!Number.isInteger(o.version)||o.version<1||
       !Number.isSafeInteger(o.expiresAt)||!mime[o.key.split(".").at(-1)!]?.includes(o.mimeType)||
       (o.key.includes("-reference.")?o.role!=="reference":!["owner","kol"].includes(o.role))) fail("oss_object_invalid");
    return `${c.prefix}${o.sha256}/${o.key}`;
  }
  function credential(expiry=now()+1000) {
    // SDK debug can print signed headers and raw XML; fail before constructing any request.
    if (["ali-oss","ali-oss:object"].some(n=>sdkDebug.enabled(n))) fail("oss_debug_logging_forbidden");
    const v=options.credentials();
    if(!/^STS\.[A-Za-z0-9]{8,128}$/.test(v.accessKeyId)||v.accessKeySecret.length<16||/[\r\n]/.test(v.accessKeySecret)||
      !v.securityToken||/[\r\n]/.test(v.securityToken)||!Number.isSafeInteger(v.expiresAt)||v.expiresAt<expiry+5000) fail("oss_sts_credentials_unavailable");
    return v;
  }
  function client(expiry?:number,object?:StagedObject,cleanup=false) {
    const v=credential(expiry);
    let wireFailure:ReplicationError|undefined;
    const sdk=new OSS({region:`oss-${c.region}`,bucket:c.bucket,accessKeyId:v.accessKeyId,accessKeySecret:v.accessKeySecret,
      stsToken:v.securityToken,authorizationV4:true,secure:true,retryMax:0,timeout:20000,refreshSTSToken:null,refreshSTSTokenInterval:300000,
      urllib:{request:async(url:string,p:any)=>{
        const u=new URL(url),start=now(),op=p.method;
        const bucketRead=u.pathname==="/"&&op==="GET"&&["bucketInfo","versioning","lifecycle"].some(k=>u.search===`?${k}`||u.search===`?${k}=`);
        const objectPath=u.pathname.startsWith(`/${c.prefix}`)&&!u.search&&!/%|\\|\.\./.test(u.pathname)&&["PUT","HEAD","DELETE"].includes(op);
        if(u.origin!==c.approvedOrigin||u.username||u.password||u.hash||(!bucketRead&&!objectPath)||p.stream||p.writeStream) fail("oss_sdk_request_rejected");
        let status=0,code="oss_transport_unknown";
        try {
          await options.beforeRequest?.(object,cleanup);
          const response=await transport({url,method:op,headers:p.headers,body:p.content,timeoutMs:20000});status=response.status;
          if(response.body.length>65536)fail("oss_response_too_large");
          if(status>=300&&!(op==="HEAD"&&status===404))fail(status<400?"oss_redirect_blocked":`oss_http_${status}`);
          if(![200,204,404].includes(status))fail("oss_response_invalid");
          code="ok";
          return {status,headers:response.headers,data:response.body,res:{status,statusCode:status,headers:response.headers,size:response.body.length}};
        } catch(e) {code=e instanceof ReplicationError?e.code:"oss_transport_unknown";wireFailure=new ReplicationError(code,503);throw wireFailure;}
        finally { options.audit?.({event:"beauty_video.oss",operation:bucketRead?u.search.slice(1):op,status,elapsedMs:Math.max(0,now()-start),code,objectFingerprint:hash(u.pathname).slice(0,16)}); }
      }}
    });
    // The SDK wraps transport errors; preserve our allowlisted reason without exposing its raw error.
    return new Proxy(sdk,{get(target,key){const value=target[key];if(typeof value!=="function")return value;
      return async(...args:any[])=>{wireFailure=undefined;try{return await value.apply(target,args);}catch(e){throw wireFailure??e;}};
    }});
  }
  async function safe<T>(fn:()=>Promise<T>):Promise<T>{try{return await fn();}catch(e){
    const code=e instanceof ReplicationError?e.code:"oss_sdk_response_invalid";
    options.audit?.({event:"beauty_video.oss",operation:"contract",status:0,elapsedMs:0,code,objectFingerprint:"none"});
    throw new ReplicationError(code,503);
  }}
  async function preflight(object?:StagedObject) {await safe(async()=>{
    const sdk=client(undefined,object);
    const {bucket:b}=await sdk.getBucketInfo(c.bucket);
    if(b?.Name!==c.bucket||b.Location!==`oss-${c.region}`||b.ExtranetEndpoint!==`oss-${c.region}.aliyuncs.com`||b.StorageClass!=="Standard"||b.AccessControlList?.Grant!=="private"||String(b.BlockPublicAccess)!=="true"||b.CrossRegionReplication!=="Disabled")fail("oss_bucket_policy_rejected");
    const version=await sdk.getBucketVersioning(c.bucket);
    if(version.versionStatus!==undefined&&version.versionStatus!=="")fail("oss_versioning_not_supported");
    const {rules}=await sdk.getBucketLifecycle(c.bucket);
    if(!Array.isArray(rules)||!rules.some((r:any)=>r.prefix===c.prefix&&r.status==="Enabled"&&Number(r.expiration?.days)===1&&!r.tag&&!r.filter))fail("oss_lifecycle_required");
  });}
  async function head(o:StagedObject,sdk=client(undefined,o),absentOk=false) {
    let result:any;
    try{result=await sdk.head(objectName(o));}catch(e:any){if(e.status===404&&absentOk)return null;throw e;}
    const h=result.res.headers;
    if(result.status!==200||h["x-oss-object-type"]!=="Normal"||h["x-oss-version-id"]||h["x-oss-meta-sha256"]!==o.sha256||h["x-oss-meta-binding"]!==binding(o)||h["content-type"]!==o.mimeType)fail("oss_object_verification_failed");
    return h;
  }
  const driver:PrivateVideoStagingDriver={id,access:offline?"local_only":"provider_https",
    async put(o,bytes){return safe(async()=>{
      objectName(o);
      if(o.expiresAt<=now()+1000||o.expiresAt>now()+15*60000||hash(bytes)!==o.sha256||bytes.length<=0||bytes.length>(o.role==="reference"?200:5)*1024*1024)fail("oss_upload_invalid");
      const sdk=client(o.expiresAt,o);await preflight(o);
      const md5=createHash("md5").update(bytes).digest("hex");
      const result=await sdk.put(objectName(o),bytes,{mime:o.mimeType,headers:{"x-oss-object-acl":"private","x-oss-forbid-overwrite":"true","x-oss-server-side-encryption":"AES256","x-oss-meta-sha256":o.sha256,"x-oss-meta-binding":binding(o)}});
      if(String(result.res.headers.etag).replaceAll('"',"").toLowerCase()!==md5)fail("oss_upload_integrity_failed");
      const h=await head(o,sdk);if(Number(h["content-length"])!==bytes.length)fail("oss_upload_integrity_failed");
    });},
    async url(o){return safe(async()=>{
      objectName(o);const remaining=Math.floor((o.expiresAt-now())/1000);
      if(remaining<1||remaining>900)fail("oss_url_expired");
      const sdk=client(o.expiresAt,o);await head(o,sdk);
      const url=await sdk.signatureUrlV4("GET",remaining,{headers:{host:new URL(c.approvedOrigin).host}},objectName(o),["host"]);
      for(const [k,v] of signed)if(v.expiresAt<=now())signed.delete(k);
      signed.set(o.key,{url,binding:binding(o),expiresAt:o.expiresAt});
      return url;
    });},
    async assertUrl(url,o){objectName(o);credential(o.expiresAt);const entry=signed.get(o.key);
      if(!entry||entry.url!==url||entry.binding!==binding(o)||now()>=entry.expiresAt)fail("oss_signed_url_rejected");
    },
    async remove(o){signed.delete(o.key);return safe(async()=>{
      const sdk=client(undefined,o,true),name=objectName(o);const h=await head(o,sdk,true);if(!h)return;
      const deleted=await sdk.delete(name);
      if(deleted.res.headers["x-oss-delete-marker"]||deleted.res.headers["x-oss-version-id"])fail("oss_delete_versioning_changed");
      if(await head(o,sdk,true))fail("oss_delete_not_confirmed");
    });}
  };
  return {...driver,preflight,checkCredentials:()=>{credential();}};
}
