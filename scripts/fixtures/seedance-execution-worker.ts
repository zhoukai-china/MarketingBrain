import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PrismaClient } from "../../packages/db/node_modules/@prisma/client/index.js";
import { createSeedanceExecution } from "../../apps/api/src/services/beauty-seedance-execution.ts";
async function main() {
  const url = new URL(process.env.BY45_DB_URL!); assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/by45_fixture"); assert.equal(process.env.BY45_DB_OWNED, "true");
  const data = JSON.parse(readFileSync(process.argv[2], "utf8")), db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  let submits = 0; globalThis.fetch = async () => { throw new Error("network_forbidden"); };
  try {
    const execution = createSeedanceExecution({ ...data, db, now: () => data.now,
      offlineTransport: async () => { submits++; return new Response(JSON.stringify({ id: `cgt-worker-${process.pid}` })); },
      offlineResultTransport: async () => { throw new Error("download_forbidden"); } });
    await execution.confirm(data.actor, data.input); console.log(submits === 1 ? "SUBMITTED" : "REPLAYED");
  } catch (e: any) { if (/database_unavailable|journal_unavailable/.test(e.message) && submits === 0) console.log("CONTENDED"); else { console.log("UNEXPECTED"); process.exitCode = 1; } }
  finally { await db.$disconnect(); }
}
main().catch(() => { console.log("WORKER_SETUP_FAILED"); process.exitCode = 1; });
