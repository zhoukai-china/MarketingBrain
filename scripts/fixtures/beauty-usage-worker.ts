import assert from "node:assert/strict";
import { PrismaClient } from "../../packages/db/node_modules/@prisma/client/index.js";
import { createBeautyUsageMeter } from "../../apps/api/src/services/beauty-usage-metering.ts";
async function main(){
  const url=new URL(process.env.BY45_DB_URL!);assert.equal(url.hostname,"127.0.0.1");assert.equal(url.pathname,"/by45_fixture");assert.equal(process.env.BY45_DB_OWNED,"true");assert.ok(+url.port>=55440&&+url.port<=55499);
  const input=JSON.parse(process.argv[2]);const db=new PrismaClient({datasources:{db:{url:url.toString()}}});
  try{await createBeautyUsageMeter(db,input.actor,input.action).begin(input.call,input.measures);console.log("PERSISTED");}finally{await db.$disconnect();}
}
main().catch(()=>{console.log("WORKER_FAILED");process.exitCode=1;});
