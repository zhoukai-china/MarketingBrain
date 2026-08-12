import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { config as loadEnv } from "dotenv";

const supportedExtensions = new Set([".xlsx", ".xls", ".csv", ".tsv", ".json", ".txt"]);

function walk(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? walk(path) : supportedExtensions.has(extname(name).toLowerCase()) ? [path] : [];
  });
}

async function main(): Promise<void> {
  loadEnv({ path: process.env.TAKEAWAY_ENV_FILE ?? ".env", override: false, quiet: true });
  const [{ prisma }, { buildTakeawayDashboard, parseTakeawayWorkbook, saveTakeawayImport }] = await Promise.all([
    import("../packages/db/src/index.js"),
    import("../apps/api/src/services/takeaway-growth-data.js")
  ]);
  const sourceDir = process.env.TAKEAWAY_REPARSE_SOURCE_DIR;
  const apply = process.argv.includes("--apply");
  if (!sourceDir) throw new Error("TAKEAWAY_REPARSE_SOURCE_DIR is required");
  const files = walk(sourceDir);
  let matched = 0;
  let refreshed = 0;
  const tenantIds = new Set<string>();
  for (const file of files) {
    const buffer = readFileSync(file);
    const filename = file.split(/[\\/]/).at(-1)!;
    const lookup = parseTakeawayWorkbook({ filename, buffer, tenantId: "sha-lookup-only" });
    const records = await prisma.takeawayDataImport.findMany({
      where: { sha256: lookup.sha256 },
      select: { id: true, tenantId: true, userId: true, platform: true, storeName: true }
    });
    matched += records.length;
    for (const record of records) {
      tenantIds.add(record.tenantId);
      if (!apply) continue;
      const parsed = parseTakeawayWorkbook({
        filename,
        buffer,
        tenantId: record.tenantId,
        platformHint: record.platform ?? undefined,
        storeNameHint: record.storeName ?? undefined
      });
      await saveTakeawayImport({ tenantId: record.tenantId, userId: record.userId ?? undefined, parsed });
      refreshed += 1;
    }
  }
  const verification = process.argv.includes("--verify")
    ? await Promise.all([...tenantIds].map(async (tenantId) => {
        const dashboard = await buildTakeawayDashboard({ tenantId });
        return {
          imports: dashboard.dataStatus.importCount,
          rows: dashboard.dataStatus.rowCount,
          productEvidence: dashboard.dataStatus.productEvidence,
          products: dashboard.products.length,
          productQuantity: dashboard.products.reduce((total, item) => total + item.quantity, 0),
          missingFields: dashboard.dataStatus.missingFields
        };
      }))
    : undefined;
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", files: files.length, matched, refreshed, verification }));
  await prisma.$disconnect();
}

main();
