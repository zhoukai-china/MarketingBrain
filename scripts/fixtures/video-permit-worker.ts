import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createVideoExecutionPermits } from "../../apps/api/src/services/beauty-video-execution-permit.ts";
import { PrismaClient } from "../../packages/db/node_modules/@prisma/client/index.js";
import { ReplicationError } from "../../apps/api/src/services/viral-video-replication-runtime.ts";
async function main(){
const url=new URL(process.env.BY45_DB_URL!);assert.equal(url.hostname,"127.0.0.1");assert.equal(url.pathname,"/by45_fixture");assert.equal(process.env.BY45_DB_OWNED,"true");
const data=JSON.parse(readFileSync(process.argv[2],"utf8"));const db=new PrismaClient({datasources:{db:{url:url.toString()}}});
try{await createVideoExecutionPermits(db,{authorityKey:data.authority,access:"local_only",now:()=>data.now}).claim(data.admission,data.input);console.log("CLAIMED");}
catch(e){if(e instanceof ReplicationError&&["execution_concurrent_conflict","execution_batch_already_claimed"].includes(e.code))console.log("BLOCKED");else{console.log("UNEXPECTED");process.exitCode=1;}}
finally{await db.$disconnect();}
}
main().catch(()=>{console.log("WORKER_SETUP_FAILED");process.exitCode=1;});
