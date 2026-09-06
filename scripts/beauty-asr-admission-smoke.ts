import assert from "node:assert/strict";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import multipart from "../apps/api/node_modules/@fastify/multipart/index.js";
import { env } from "../apps/api/src/config/env.js";
import { registerMediaRoutes } from "../apps/api/src/routes/media.js";
import * as XLSX from "../apps/api/node_modules/xlsx/xlsx.mjs";

// Synthetic local bytes and injected fetch only. No credentials, source speech, DB or Provider.
const originalFetch=globalThis.fetch;
const saved={ALIYUN_API_KEY:env.ALIYUN_API_KEY,DASHSCOPE_API_KEY:env.DASHSCOPE_API_KEY,ALIYUN_BASE_URL:env.ALIYUN_BASE_URL};
function form(bytes:Buffer,filename:string,mime:string, fields:Record<string,string>={}){
  const boundary="by47-synthetic-boundary";
  return {headers:{"content-type":`multipart/form-data; boundary=${boundary}`},payload:Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),bytes,...Object.entries(fields).map(([key,value])=>Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}`)),Buffer.from(`\r\n--${boundary}--\r\n`)])};
}
async function main(){
  Object.assign(env,{ALIYUN_API_KEY:"synthetic-never-sent",DASHSCOPE_API_KEY:"",ALIYUN_BASE_URL:"https://dashscope.aliyuncs.com/compatible-mode/v1"});
  let interceptedCalls=0;
  globalThis.fetch=async()=>{interceptedCalls++;return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:"Synthetic transcript."}}],usage:{total_tokens:1}}),{headers:{"content-type":"application/json"}});};
  const logs:string[]=[];
  const app=Fastify({disableRequestLogging:true,logger:{stream:{write:(line:string)=>{logs.push(line);}}}});
  await app.register(multipart,{limits:{fileSize:2*1024*1024}});await registerMediaRoutes(app);
  try{
    const wav=Buffer.alloc(32044);wav.write("RIFF");wav.writeUInt32LE(wav.length-8,4);wav.write("WAVEfmt ",8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(wav.length-44,40);
    const response=await app.inject({method:"POST",url:"/media/analyze",...form(wav,"synthetic.wav","audio/wav")});
    console.log(JSON.stringify({stage:"asr_admission",status:response.statusCode,interceptedTransportCalls:interceptedCalls,providerCalls:0,costYuan:0}));
    assert.equal(response.statusCode,503,"BY47 audio upload without server authorization must stop before ASR");
    assert.equal(interceptedCalls,0,"No configured-key bypass of server authorization");
    let blocked=1, documents=0;
    const cases = [
      { filename:"synthetic.wav",mime:"audio/wav",bytes:wav },
      { filename:"broken.mp4",mime:"video/mp4",bytes:Buffer.from("not-video") },
      { filename:"voice.MP3",mime:"text/plain",bytes:Buffer.from("synthetic-body-marker") },
      { filename:"note.txt",mime:"audio/wav",bytes:wav },
      { filename:"long.wav",mime:"audio/wav",bytes:wav, fields:{metadata:JSON.stringify({duration:86400})} },
      { filename:"with-frames.mp4",mime:"video/mp4",bytes:Buffer.from("invalid"), fields:{frames:JSON.stringify(["data:image/png;base64,AAAA"])} }
    ];
    for(let round=0;round<3;round++){
      for(const [index,item] of cases.entries()){
        const upload=form(item.bytes,item.filename,item.mime,{...item.fields,tenantId:"synthetic-other-tenant",storeId:"synthetic-other-store",fileId:"synthetic-other-file",asrApproved:"true"});
        const result=await app.inject({method:"POST",url:"/media/analyze?approved=true",remoteAddress:`127.1.${round}.${index+1}`,...upload,headers:{...upload.headers,authorization:"Bearer synthetic-client-assertion","idempotency-key":"same-request"}});
        assert.equal(result.statusCode,503);
        assert.deepEqual(result.json(),response.json());
        assert.equal(result.json().transcript,undefined);
        assert.equal(result.json().jobId,undefined);
        blocked++;
      }
      const duplicate=form(wav,"duplicate.wav","audio/wav");
      const concurrent=await Promise.all(Array.from({length:4},()=>app.inject({method:"POST",url:"/media/analyze",remoteAddress:`127.2.0.${round+1}`,...duplicate,headers:{...duplicate.headers,"idempotency-key":"same-request"}})));
      for(const result of concurrent){assert.equal(result.statusCode,503);assert.deepEqual(result.json(),response.json());blocked++;}
      const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([["metric","value"],["synthetic",3]]),"data");
      for(const [filename,mime,bytes] of [
        ["sample.csv","text/csv",Buffer.from("metric,value\nsynthetic,3")],
        ["sample.txt","text/plain",Buffer.from("synthetic-body-marker")],
        ["sample.xlsx","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",XLSX.write(workbook,{type:"buffer",bookType:"xlsx"})]
      ] as Array<[string,string,Buffer]>){
        const result=await app.inject({method:"POST",url:"/media/analyze",remoteAddress:`127.3.0.${round+1}`,...form(bytes,filename,mime)});
        assert.equal(result.statusCode,200);assert.match(result.json().documentText,/synthetic/);
        assert.deepEqual(result.json().providerTrace,[]);assert.equal(result.json().transcript,undefined);documents++;
      }
      const unsupported=await app.inject({method:"POST",url:"/media/analyze",remoteAddress:`127.4.0.${round+1}`,...form(Buffer.from("invalid"),"sample.exe","application/octet-stream")});
      assert.equal(unsupported.statusCode,415);
      const oversized=await app.inject({method:"POST",url:"/media/analyze",remoteAddress:`127.5.0.${round+1}`,...form(Buffer.alloc(2*1024*1024+1),"large.wav","audio/wav")});
      assert.equal(oversized.statusCode,413);
    }
    const events=logs.map(line=>JSON.parse(line)).filter(event=>event.event==="media_analysis.admission_rejected");
    assert.equal(events.length,blocked);
    for(const event of events){assert.equal(event.stage,"asr_admission");assert.equal(event.providerCalls,0);assert.equal(event.code,"asr_authorization_required");}
    for(const marker of ["synthetic-body-marker","synthetic-client-assertion","synthetic-other-tenant","synthetic-other-store","synthetic-other-file","synthetic-never-sent"]){assert.ok(!logs.join("").includes(marker),"safe observation must exclude uploaded fields and credentials");}
    assert.equal(interceptedCalls,0);
    console.log(JSON.stringify({result:"BY47_PASS",rounds:3,blocked,documents,interceptedTransportCalls:interceptedCalls,providerCalls:0,costYuan:0}));
  }finally{await app.close();Object.assign(env,saved);globalThis.fetch=originalFetch;}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
