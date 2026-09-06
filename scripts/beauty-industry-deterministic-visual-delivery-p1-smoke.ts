import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assessBeautyImageQualityForRole,
  type BeautyImageRole
} from "../apps/api/src/products/beauty-industry/media-contract.js";
import {
  BEAUTY_DETERMINISTIC_VISUAL_VERSION,
  generateBeautyDeterministicVisual
} from "../apps/api/src/services/beauty-deterministic-visual.js";
import { composeBeautyCustomerImage } from "../apps/api/src/services/beauty-image-compositor.js";

const roles: BeautyImageRole[] = ["cover", "content", "engagement"];
const theme = {
  configVersion: "beauty-industry-brand-v1",
  tokenName: "beauty-default",
  primary: "#1F6B57",
  primaryDark: "#17352F",
  primaryLight: "#D9EEE7",
  surface: "#F7F5EF"
} as const;

async function main() {
const outputs = [];
const generatedOutputs: Array<Awaited<ReturnType<typeof generateBeautyDeterministicVisual>>> = [];
for (const role of roles) {
  const input = { role, taskSnapshotHash: "f".repeat(64), theme } as const;
  const first = await generateBeautyDeterministicVisual(input);
  const second = await generateBeautyDeterministicVisual(input);
  assert.equal(first.receipt.version, BEAUTY_DETERMINISTIC_VISUAL_VERSION);
  assert.equal(first.receipt.role, role);
  assert.equal(first.receipt.source, "deterministic_canvas");
  assert.equal(first.receipt.scenePolicy, "generic_beauty_store_non_reference");
  assert.equal(first.receipt.scene, first.receipt.layout);
  assert.ok(first.receipt.elementCount >= 5);
  assert.equal(first.receipt.sha256, second.receipt.sha256, `${role} must be deterministic`);
  assert.deepEqual(first.bytes, second.bytes, `${role} bytes must be deterministic`);
  assert.equal(first.receipt.width, 768);
  assert.equal(first.receipt.height, 1024);
  const quality = assessBeautyImageQualityForRole(first.bytes, {
    contentType: "image/png",
    role,
    deterministicReceipt: first.receipt
  });
  if (quality.status !== "passed") console.error(JSON.stringify({ role, status: quality.status, reasons: quality.reasons, evidence: quality.evidence }));
  assert.equal(quality.status, "passed", `${role} deterministic base must pass: ${quality.reasons.join(",")}`);
  const composed = await composeBeautyCustomerImage({
    sourceBytes: first.bytes,
    role,
    overlayText: role === "cover" ? "把日常护理做得更从容" : role === "content" ? "先了解，再选择" : "你更关注哪一步"
  });
  assert.equal(composed.receipt.width, 768);
  assert.equal(composed.receipt.height, 1024);
  outputs.push(first.receipt.sha256);
  generatedOutputs.push(first);
}
assert.equal(new Set(outputs).size, 3, "three roles must use distinct deterministic layouts");

const assetRoot = await mkdtemp(path.join(tmpdir(), "beauty-deterministic-visual-"));
process.env.UPLOAD_DIR = assetRoot;
process.env.BEAUTY_MEDIA_ASSET_STORAGE = "local";
try {
  const { persistBeautyCustomerComposite, persistBeautyDeterministicBase, readBeautyMediaAsset, readBeautyProviderMediaAsset } = await import("../apps/api/src/services/beauty-media-assets.js");
  for (const [index, generated] of generatedOutputs.entries()) {
    const role = roles[index]!;
    const jobId = `deterministic-visual-${index + 1}`;
    const metadata = await persistBeautyDeterministicBase({ tenantId: "tenant-a", jobId, bytes: generated.bytes, receipt: generated.receipt });
    assert.equal(metadata.source, "deterministic");
    assert.equal(metadata.deterministicVisual?.sha256, generated.receipt.sha256);
    const composed = await composeBeautyCustomerImage({
      sourceBytes: generated.bytes,
      role,
      overlayText: role === "cover" ? "把日常护理做得更从容" : role === "content" ? "先了解，再选择" : "你更关注哪一步"
    });
    await persistBeautyCustomerComposite({ tenantId: "tenant-a", jobId, bytes: composed.bytes, receipt: composed.receipt });
    const base = await readBeautyProviderMediaAsset({ tenantId: "tenant-a", jobId });
    const final = await readBeautyMediaAsset({ tenantId: "tenant-a", jobId });
    assert.equal(base.metadata.source, "deterministic");
    assert.notDeepEqual(base.bytes, final.bytes);
    await assert.rejects(() => readBeautyMediaAsset({ tenantId: "tenant-b", jobId }));
  }
} finally {
  await rm(assetRoot, { recursive: true, force: true });
}

const route = await readFile(new URL("../apps/api/src/routes/beauty-industry-media.ts", import.meta.url), "utf8");
assert.match(route, /next\.provider === "local_deterministic"/u, "historical deterministic batches stay readable and recoverable");
assert.match(route, /deliveryMode:\s*"real_provider_composed"/u, "new batches no longer use the deterministic renderer as customer quality");
assert.match(route, /generateBeautyDeterministicVisual/u, "historical deterministic jobs keep their pinned implementation");

console.log(JSON.stringify({
  ok: true,
  version: BEAUTY_DETERMINISTIC_VISUAL_VERSION,
  roles,
  providerCalls: 0,
  externalCostYuan: 0
}));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
