import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { assessBeautyContentRoleContract } from "../apps/api/src/products/beauty-industry/media-contract.js";

const require = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PNG } = require("pngjs") as {
  PNG: new (input: { width: number; height: number }) => Raster;
  sync: { write(image: Raster): Buffer };
};
type Raster = { width: number; height: number; data: Buffer };

const expectedAssets = {
  collageRisk: "e9af2a0eebd361b634b35110a2acd3a5a31870e01e84273f2a1f2e929022a803",
  packagingRisk: "9f217ea59c4dda4682bab1810bf5f38bbcc633a76e337f034fac66d286bbc2e1",
  blankBottleRisk: "bc044be31355a642ee7f4d1464adb164e6a72f37efe5df940ae38e88297caf61",
  safeScene: "60f2ea68d251cbfe2e0fc49119f3ee4e44222c94c826b8aa692a6af09868bb8d"
} as const;

async function main(): Promise<void> {
  const paths = {
    collageRisk: requiredEnv("BEAUTY_IMAGE_SEMANTICS_COLLAGE_RISK_ASSET"),
    packagingRisk: requiredEnv("BEAUTY_IMAGE_SEMANTICS_PACKAGING_RISK_ASSET"),
    blankBottleRisk: requiredEnv("BEAUTY_IMAGE_SEMANTICS_BLANK_BOTTLE_RISK_ASSET"),
    safeScene: requiredEnv("BEAUTY_IMAGE_SEMANTICS_SAFE_SCENE_ASSET")
  };
  const realEntries = await Promise.all(Object.entries(paths).map(async ([name, path]) => {
    const bytes = await readFile(path);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    assert.equal(sha256, expectedAssets[name as keyof typeof expectedAssets]);
    return { name, bytes, sha256 };
  }));
  const syntheticWarm = syntheticSingleScene(236, 224, 207);
  const syntheticGreen = syntheticSingleScene(222, 235, 226);
  const cases = [
    ...realEntries.map((entry) => ({ ...entry, expected: entry.name === "safeScene" ? "safe" as const : "risk" as const })),
    { name: "syntheticSingleSceneWarm", bytes: syntheticWarm, sha256: createHash("sha256").update(syntheticWarm).digest("hex"), expected: "safe" as const },
    { name: "syntheticSingleSceneGreen", bytes: syntheticGreen, sha256: createHash("sha256").update(syntheticGreen).digest("hex"), expected: "safe" as const }
  ];

  const started = performance.now();
  const rssBefore = process.memoryUsage().rss;
  const runs: Array<Array<{ name: string; expected: "safe" | "risk"; status: string; reasons: readonly string[] }>> = [];
  for (let run = 0; run < 3; run += 1) {
    runs.push(cases.map((item) => {
      const result = assessBeautyContentRoleContract(item.bytes, { contentType: "image/png" });
      return { name: item.name, expected: item.expected, status: result.status, reasons: result.reasons };
    }));
  }
  const elapsedMs = performance.now() - started;
  const rssDeltaBytes = Math.max(0, process.memoryUsage().rss - rssBefore);
  assert.deepEqual(runs[1], runs[0]);
  assert.deepEqual(runs[2], runs[0]);

  const baseline = runs[0]!;
  const safe = baseline.filter((item) => item.expected === "safe");
  const risk = baseline.filter((item) => item.expected === "risk");
  assert.equal(safe.length, 3);
  assert.equal(risk.length, 3);
  assert.equal(safe.filter((item) => item.status === "passed").length, 0, "current local contract cannot auto-approve a semantically safe scene");
  assert.equal(risk.filter((item) => item.status === "rejected").length, 1, "only deterministic collage layout is currently distinguishable");
  assert.equal(baseline.find((item) => item.name === "collageRisk")?.status, "rejected");
  assert.ok(baseline.filter((item) => item.name !== "collageRisk").every((item) => item.status === "manual_review_required"));

  const rootPackage = await readFile(new URL("../apps/api/package.json", import.meta.url), "utf8");
  const lock = await readFile(new URL("../pnpm-lock.yaml", import.meta.url), "utf8");
  const receipt = JSON.parse(await readFile(new URL("./fixtures/beauty-image-local-object-semantics-feasibility-20260831.json", import.meta.url), "utf8")) as {
    decision: string;
    productRuntime: { objectSemanticModelAssetCount: number; absentDependencies: string[] };
    champion: { safeAutoPassed: string; riskDeterministicallyRejected: string; manualReview: string; providerCalls: number; externalNetwork: number };
    sampleProvenance: { safe: string[]; risk: string[] };
  };
  const semanticRuntimePattern = /opencv|onnxruntime|transformers|tensorflow|torchvision|ultralytics|mediapipe/iu;
  assert.equal(semanticRuntimePattern.test(rootPackage), false);
  assert.equal(semanticRuntimePattern.test(lock), false);
  assert.equal(receipt.decision, "not_feasible_with_current_offline_assets");
  assert.equal(receipt.productRuntime.objectSemanticModelAssetCount, 0);
  assert.equal(receipt.champion.safeAutoPassed, "0/3");
  assert.equal(receipt.champion.riskDeterministicallyRejected, "1/3");
  assert.equal(receipt.champion.manualReview, "5/6");
  assert.equal(receipt.champion.providerCalls, 0);
  assert.equal(receipt.champion.externalNetwork, 0);
  assert.deepEqual(receipt.sampleProvenance.safe, cases.filter((item) => item.expected === "safe").map((item) => item.sha256));
  assert.deepEqual(receipt.sampleProvenance.risk, cases.filter((item) => item.expected === "risk").map((item) => item.sha256));

  process.stdout.write(JSON.stringify({
    ok: true,
    contract: "beauty-image-content-role-contract-v1",
    runs: 3,
    cases: baseline.map((item, index) => ({ name: item.name, sha256: cases[index]!.sha256, expected: item.expected, status: item.status, reasons: item.reasons })),
    safeAutoPassed: `${safe.filter((item) => item.status === "passed").length}/${safe.length}`,
    riskDeterministicallyRejected: `${risk.filter((item) => item.status === "rejected").length}/${risk.length}`,
    manualReview: `${baseline.filter((item) => item.status === "manual_review_required").length}/${baseline.length}`,
    totalElapsedMs: Number(elapsedMs.toFixed(3)),
    meanImageElapsedMs: Number((elapsedMs / (cases.length * 3)).toFixed(3)),
    rssDeltaMiB: Number((rssDeltaBytes / 1024 / 1024).toFixed(3)),
    productSemanticRuntimeDependencies: 0,
    providerCalls: 0,
    externalNetwork: 0,
    feasible: false,
    reason: "no_licensed_local_object_semantics_runtime_or_model_asset"
  }) + "\n");
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} is required`);
  return value;
}

function syntheticSingleScene(red: number, green: number, blue: number): Buffer {
  const image = new PNG({ width: 256, height: 320 });
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    const offset = (y * image.width + x) * 4;
    const shade = Math.round(8 * (y / image.height));
    image.data[offset] = Math.max(0, red - shade);
    image.data[offset + 1] = Math.max(0, green - shade);
    image.data[offset + 2] = Math.max(0, blue - shade);
    image.data[offset + 3] = 255;
  }
  drawEllipse(image, 128, 205, 70, 28, [181, 165, 143]);
  drawEllipse(image, 128, 174, 42, 46, [224, 214, 194]);
  return PNG.sync.write(image);
}

function drawEllipse(image: Raster, centerX: number, centerY: number, radiusX: number, radiusY: number, color: [number, number, number]): void {
  for (let y = centerY - radiusY; y <= centerY + radiusY; y += 1) for (let x = centerX - radiusX; x <= centerX + radiusX; x += 1) {
    const normalized = ((x - centerX) ** 2) / (radiusX ** 2) + ((y - centerY) ** 2) / (radiusY ** 2);
    if (normalized > 1 || x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
    const offset = (y * image.width + x) * 4;
    image.data[offset] = color[0]; image.data[offset + 1] = color[1]; image.data[offset + 2] = color[2]; image.data[offset + 3] = 255;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
