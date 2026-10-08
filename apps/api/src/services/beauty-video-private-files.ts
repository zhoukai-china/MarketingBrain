import { createHash, randomUUID } from "node:crypto";
import { open, realpath, mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { loadImage } from "@napi-rs/canvas";
import { probeClip } from "./clip-renderer.js";
import { ReplicationError } from "./viral-video-replication-runtime.js";

export type VideoPrivateFile = { id:string; tenantId:string; userId:string|null; storagePath:string; mimeType:string; byteSize:number; sha256:string|null };
export type InspectedVideoFile = { bytes:Buffer; sha256:string; mimeType:string; width:number; height:number; durationSeconds?:number };
export const videoFileHash = (b:Buffer|string) => createHash("sha256").update(b).digest("hex");
/** Uses existing UploadedFile/private upload root; never accepts remote URLs or client metadata. */
export function createVideoPrivateFileReader(rootPath:string, inspectionRoot:string) {
  const root=path.resolve(rootPath), inspection=path.resolve(inspectionRoot);
  return async (file:VideoPrivateFile, kind:"reference"|"owner"|"kol"|"basis"):Promise<InspectedVideoFile> => {
    const max=kind==="reference"?200*1024*1024:5*1024*1024;
    if(!/^[a-zA-Z0-9_-]{1,120}$/.test(file.tenantId)||!file.sha256||!/^[a-f0-9]{64}$/.test(file.sha256)||file.byteSize<=0||file.byteSize>max) throw new ReplicationError("file_metadata_invalid",422);
    const tenantRoot=path.join(root,file.tenantId), abs=path.resolve(file.storagePath), relative=path.relative(tenantRoot,abs);
    if(!relative||relative.startsWith("..")||path.isAbsolute(relative)||(await realpath(root)).toLowerCase()!==root.toLowerCase()||(await realpath(abs)).toLowerCase()!==abs.toLowerCase())throw new ReplicationError("file_not_found",404);
    const handle=await open(abs,"r");let bytes:Buffer;
    try {
      const stat=await handle.stat();if(!stat.isFile()||stat.size!==file.byteSize||stat.size>max)throw new ReplicationError("file_changed",409);
      bytes=Buffer.alloc(file.byteSize);let offset=0;
      while(offset<bytes.length){const r=await handle.read(bytes,offset,bytes.length-offset,offset);if(!r.bytesRead)break;offset+=r.bytesRead;}
      if(offset!==bytes.length||(await handle.stat()).size!==bytes.length||videoFileHash(bytes)!==file.sha256)throw new ReplicationError("file_changed",409);
    } finally {await handle.close();}
    if((await realpath(abs)).toLowerCase()!==abs.toLowerCase())throw new ReplicationError("file_not_found",404);
    let width=0,height=0,durationSeconds:number|undefined;
    let normalizedMime=file.mimeType;
    if(kind==="basis"){
      if(!["application/pdf","text/plain"].includes(file.mimeType)||(file.mimeType==="application/pdf"&&bytes.toString("ascii",0,5)!=="%PDF-"))throw new ReplicationError("basis_type_invalid",422);
    }else if(kind==="reference"){
      const mp4=bytes.toString("ascii",4,8)==="ftyp",avi=bytes.toString("ascii",0,4)==="RIFF"&&bytes.toString("ascii",8,12)==="AVI ";
      if(!(["video/mp4","video/quicktime"].includes(file.mimeType)&&mp4)&&!(file.mimeType==="video/x-msvideo"&&avi))throw new ReplicationError("file_type_invalid",422);
      await mkdir(inspection,{recursive:true});
      if((await realpath(inspection)).toLowerCase()!==inspection.toLowerCase())throw new ReplicationError("inspection_path_invalid",503);
      const temp=path.join(inspection,`${randomUUID()}.mp4`);
      try {await writeFile(temp,bytes,{flag:"wx"});const p=await probeClip(temp);width=p.width;height=p.height;durationSeconds=p.durationSeconds;} finally {await unlink(temp).catch(()=>{});} // 临时检查文件清理失败（被本地安全删除护栏拦截/并发删除等）只应残留，不可拖垮主流程
      if(!Number.isFinite(durationSeconds)||durationSeconds!<2||durationSeconds!>30)throw new ReplicationError("reference_duration_invalid",422);
    }else{
      // 2026-10-08：浏览器按扩展名上报 mimeType，PNG 存成 .jpeg 时声明的 image/jpeg 与真实内容
      // （PNG 魔数）不一致，严格比对会把正常图片拦成 file_type_invalid（现场：LQ 视频换脸 demo 页
      // 那张 1536×1536 的 PNG）。改为按内容魔数识别，四类格式任一即放行，并归一化 mimeType。
      const hex=bytes.subarray(0,12).toString("hex");
      const isPng=hex.startsWith("89504e470d0a1a0a"),isJpeg=hex.startsWith("ffd8ff"),isBmp=hex.startsWith("424d"),isWebp=bytes.toString("ascii",0,4)==="RIFF"&&bytes.toString("ascii",8,12)==="WEBP";
      if(!isPng&&!isJpeg&&!isBmp&&!isWebp)throw new ReplicationError("file_type_invalid",422);
      normalizedMime=isPng?"image/png":isJpeg?"image/jpeg":isBmp?"image/bmp":"image/webp";
      // Decoder only receives bounded local bytes, not a URL.
      const image=await loadImage(bytes);width=image.width;height=image.height;
    }
    if(kind!=="basis"&&(!Number.isFinite(width)||!Number.isFinite(height)||width<200||height<200||width>(kind==="reference"?2048:4096)||height>(kind==="reference"?2048:4096)||width/height<1/3||width/height>3))throw new ReplicationError("file_dimensions_invalid",422);
    return {bytes,sha256:file.sha256,mimeType:kind==="basis"||kind==="reference"?file.mimeType:normalizedMime,width,height,...(durationSeconds===undefined?{}:{durationSeconds})};
  };
}
