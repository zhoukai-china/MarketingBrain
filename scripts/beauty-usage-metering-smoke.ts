import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createBeautyUsageMeter,beautyUsageMonthWindow,readBeautyUsageMonth,usageHash,type UsageMeasure } from "../apps/api/src/services/beauty-usage-metering.ts";
import { replicationMemoryDb } from "./fixtures/replication-test-db.ts";

const call={step:"generation",attempt:1,provider:"synthetic",model:"synthetic-text-v1",mode:"controlled_mock" as const};
const measure=(unit:UsageMeasure["unit"]="token",meter:UsageMeasure["meter"]="prompt",quantity:string|null=null):UsageMeasure=>({unit,meter,quantity,source:quantity===null?"unknown":"provider_usage",currency:"CNY",priceVersion:"synthetic-rate-v1",unitPriceMicros:"2",observedCostMicros:null,billingSource:"unknown"});
const receipt=(measures:UsageMeasure[],status="succeeded" as "succeeded"|"failed"|"unknown")=>({status,code:"synthetic_observation",providerRequestFingerprint:usageHash("synthetic-task"),measures});
async function main(){
  const originalFetch=globalThis.fetch;let external=0;
  globalThis.fetch=async()=>{external++;throw new Error("network_forbidden");};
  let client:any;
  if(process.env.BY45_DB_URL){const u=new URL(process.env.BY45_DB_URL);assert.equal(u.hostname,"127.0.0.1");assert.equal(u.pathname,"/by45_fixture");assert.equal(process.env.BY45_DB_OWNED,"true");assert.ok(+u.port>=55440&&+u.port<=55499);const {PrismaClient}=await import("../packages/db/node_modules/@prisma/client/index.js");client=new PrismaClient({datasources:{db:{url:u.toString()}}});}
  try{
    for(let round=0;round<3;round++){
      const db=client??replicationMemoryDb(),suffix=randomUUID(),actor={tenantId:`by51-${suffix}`,userId:`by51-user-${suffix}`,storeId:`by51-store-${suffix}`};
      await db.tenant.create({data:{id:actor.tenantId,name:"Synthetic metering",type:"local_business"}});
      await db.user.create({data:{id:actor.userId,nickname:"Synthetic"}});
      await db.creditAccount.create({data:{tenantId:actor.tenantId,balance:1000}});
      const before=JSON.stringify(await db.creditAccount.findUnique({where:{tenantId:actor.tenantId}}));
      const meter=createBeautyUsageMeter(db,actor,"synthetic-action");
      const base=[measure(),measure("token","completion"),measure("token","cache_hit")];
      await Promise.all(Array.from({length:10},()=>meter.begin(call,base)));
      let view=await meter.read();assert.equal(view.events.length,1);assert.equal(view.callCount,1);assert.equal(view.unresolvedCalls,1);assert.equal(view.groups[0].quantity,null);assert.equal(view.groups[0].estimatedCostMicros,null);
      // Different binding of the same persisted call cannot silently overwrite its start.
      await assert.rejects(()=>meter.begin({...call,model:"other-model"},base),/usage_event_conflict/);
      await assert.rejects(()=>meter.observe({...call,model:"other-model"},receipt(base)),/usage_call_binding_conflict/);
      // Interrupted stream survives restart; missing usage is unknown, not zero cost.
      await meter.observe(call,receipt(base,"unknown"));
      const restarted=createBeautyUsageMeter(db,actor,"synthetic-action");
      assert.equal((await restarted.read()).groups[0].observedCostMicros,null);
      const final=[measure("token","prompt","100"),measure("token","completion","20"),measure("token","cache_hit","80")];
      await Promise.all(Array.from({length:10},()=>restarted.observe(call,receipt(final))));
      view=await restarted.read();assert.equal(view.events.length,3);assert.equal(view.unresolvedCalls,0);assert.equal(view.groups.find(g=>g.meter==="prompt")?.quantity,"100.000000");assert.equal(view.groups.find(g=>g.meter==="cache_hit")?.quantity,"80.000000");
      assert.equal(view.groups.find(g=>g.meter==="prompt")?.estimatedCostMicros,"200");assert.equal(view.groups[0].observedCostMicros,null);
      // Explicit observed bill is distinct from price-derived estimate and can arrive later.
      const billed=final.map(m=>({...m,observedCostMicros:"1",billingSource:"provider_bill" as const}));await meter.observe(call,receipt(billed));
      assert.equal((await meter.read()).groups[0].observedCostMicros,"1");
      // Attempts remain separate even when the logical action is the same. Failure cost persists.
      const retry={...call,attempt:2};await meter.begin(retry,base);await meter.observe(retry,receipt(final,"failed"));
      for(const [unit,model,quantity] of[["image","synthetic-image-v1","3"],["video_second","synthetic-video-v1","1.25"]] as const){const c={...call,step:unit,model};const m=measure(unit,"output");await meter.begin(c,[m]);await meter.observe(c,receipt([measure(unit,"output",quantity)]));}
      view=await meter.read();assert.equal(view.callCount,4);assert.equal(new Set(view.groups.map(g=>g.unit)).size,3);assert.equal(view.groups.find(g=>g.unit==="video_second")?.estimatedCostMicros,"3");
      const precisionCount=view.events.length;await meter.observe({...call,step:"video_second",model:"synthetic-video-v1"},receipt([measure("video_second","output","1.250000")]));assert.equal((await meter.read()).events.length,precisionCount);
      // Unknown price does not become free/unlimited. No commercial quota or billable flag is invented.
      const unpriced=createBeautyUsageMeter(db,actor,"unpriced");const um={...measure("image","output"),priceVersion:null,unitPriceMicros:null};await unpriced.begin(call,[um]);await unpriced.observe(call,receipt([{...um,quantity:"1",source:"provider_usage"}]));assert.equal((await unpriced.read()).groups[0].estimatedCostMicros,null);
      // Contradicting known usage never overwrites old evidence or claims a complete total.
      await meter.observe(call,receipt([measure("token","prompt","101"),final[1],final[2]]));
      view=await meter.read();assert.equal(view.conflictingCalls,1);assert.equal(view.groups.find(g=>g.meter==="prompt")?.quantity,null);
      for(const other of[{...actor,tenantId:"foreign"},{...actor,userId:"colleague"},{...actor,storeId:"another-store"}]){
        const foreign=createBeautyUsageMeter(db,other,"synthetic-action");assert.equal((await foreign.read()).events.length,0);await assert.rejects(()=>foreign.observe(call,receipt(base)),/usage_attempt_not_started/);
        assert.equal((await readBeautyUsageMonth(db,other,"2026-09")).actionCount,0);
      }
      await assert.rejects(()=>meter.begin({...call,step:"bad"},[{...measure(),quantity:"-1"} as any]));
      await assert.rejects(()=>meter.begin({...call,step:"bad"},[{...measure(),prompt:"do not retain"} as any]));
      await assert.rejects(()=>meter.begin({...call,step:"bad"},[{...measure(),observedCostMicros:"9"}]));
      await assert.rejects(()=>meter.begin({...call,step:"bad"},[measure(),measure()]));
      const oldCreate=db.auditLog.create;db.auditLog.create=async()=>{throw new Error("synthetic_db_unavailable");};
      try{await assert.rejects(()=>meter.begin({...call,step:"db_down"},base),/synthetic_db_unavailable/);}finally{db.auditLog.create=oldCreate;}
      // Month start at UTC16:00, late receipt in October retained in September action view.
      const month=createBeautyUsageMeter(db,actor,"month-boundary");await month.begin(call,[measure()]);
      let row=(await month.read()).events[0];const startRows=await db.auditLog.findMany({where:{resourceId:month.traceId,action:"beauty_usage.started"}});
      await db.auditLog.update({where:{id:startRows[0].id},data:{createdAt:new Date("2026-08-31T16:00:00Z")}});
      await month.observe(call,receipt([measure("token","prompt","7")]));
      const observations=await db.auditLog.findMany({where:{resourceId:month.traceId,action:"beauty_usage.observation"}});
      await db.auditLog.update({where:{id:observations[0].id},data:{createdAt:new Date("2026-10-01T16:00:00Z")}});
      const sep=await readBeautyUsageMonth(db,actor,"2026-09");assert.ok(sep.actionCount>=1);assert.equal((await readBeautyUsageMonth(db,actor,"2026-10")).actionCount,0);
      assert.equal(beautyUsageMonthWindow("2026-01").start.toISOString(),"2025-12-31T16:00:00.000Z");
      assert.equal(beautyUsageMonthWindow("2024-02").end.toISOString(),"2024-02-29T16:00:00.000Z");assert.throws(()=>beautyUsageMonthWindow("2026-13"));
      if(client){
        const args=JSON.stringify({actor,action:"race",call,measures:base});
        await Promise.all([0,1,2].map(()=>new Promise<void>((resolve,reject)=>{const child=spawn(process.execPath,["apps/api/node_modules/tsx/dist/cli.mjs","scripts/fixtures/beauty-usage-worker.ts",args],{windowsHide:true,stdio:["ignore","pipe","pipe"],env:process.env});let out="";child.stdout.on("data",d=>out+=d);child.stderr.on("data",()=>{});const timer=setTimeout(()=>{child.kill();reject(new Error("owned_worker_timeout"));},30000);child.on("error",reject);child.on("close",c=>{clearTimeout(timer);c===0&&out.trim()==="PERSISTED"?resolve():reject(new Error("usage_worker_failed"));});})));
        const race=createBeautyUsageMeter(db,actor,"race");assert.equal((await race.read()).events.length,1);assert.equal((await race.read()).unresolvedCalls,1);await race.observe(call,receipt(final));assert.equal((await race.read()).unresolvedCalls,0);
      }
      assert.equal(JSON.stringify(await db.creditAccount.findUnique({where:{tenantId:actor.tenantId}})),before);assert.equal(await db.creditTransaction.count({where:{tenantId:actor.tenantId}}),0);assert.equal(await db.creditReservation.count({where:{tenantId:actor.tenantId}}),0);
      const audit=JSON.stringify(await db.auditLog.findMany({where:{tenantId:actor.tenantId}}));for(const s of["do not retain","Authorization","https://","promptText","apiKey"])assert.ok(!audit.includes(s));
      console.log(JSON.stringify({round,result:"PASS",database:client?"isolated_postgresql":"transactional_fixture",external,providerCalls:0,costYuan:0,creditWrites:0}));
    }
    const source=readFileSync("apps/api/src/services/beauty-usage-metering.ts","utf8");assert.doesNotMatch(source,/credit(Account|Reservation|Transaction)\.(create|update)|candidates\/|intake\/|quarantine\//);
    assert.equal(external,0);
  }finally{await client?.$disconnect();globalThis.fetch=originalFetch;}
}
main().catch(e=>{console.log(e);process.exitCode=1;});
