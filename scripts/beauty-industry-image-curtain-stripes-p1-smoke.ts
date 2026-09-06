import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { assessBeautyImageSafety, inspectBeautyImageBarcodeCandidatesForEval } from "../apps/api/src/products/beauty-industry/media-contract.js";

const require = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PNG } = require("pngjs") as { PNG: new (input: { width: number; height: number }) => Raster; sync: { read(bytes: Buffer): Raster; write(image: Raster): Buffer } };
const QRCode = require("qrcode") as { toBuffer(text: string, options: Record<string, unknown>): Promise<Buffer> };

type Raster = { width: number; height: number; data: Buffer };
type Verdict = ReturnType<typeof assessBeautyImageSafety>;

const curtainAssetPath = process.env.BEAUTY_IMAGE_BY43_CURTAIN_SAFE_ASSET;
const woodSlatsAssetPath = process.env.BEAUTY_IMAGE_BY43_WOOD_SLATS_SAFE_ASSET;
const historicalRiskPath = process.env.BEAUTY_IMAGE_PRECISION_BAD_ASSET;
const expectedCurtainSha256 = "3d8fe077ad29d63454fa02bd399927dedcb483353107c54e842a047a749284cd";

async function main(): Promise<void> {
  assert.ok(curtainAssetPath, "BEAUTY_IMAGE_BY43_CURTAIN_SAFE_ASSET is required");
  assert.ok(woodSlatsAssetPath, "BEAUTY_IMAGE_BY43_WOOD_SLATS_SAFE_ASSET is required");
  assert.ok(historicalRiskPath, "BEAUTY_IMAGE_PRECISION_BAD_ASSET is required");
  const curtainBytes = await readFile(curtainAssetPath);
  const woodSlatsBytes = await readFile(woodSlatsAssetPath);
  const historicalRiskBytes = await readFile(historicalRiskPath);
  const championFixture = JSON.parse(await readFile(new URL("./fixtures/beauty-image-safety-v215-curtain-stripes-champion.json", import.meta.url), "utf8")) as { sha256: string; detectorVersion: string; status: string; reason: string; evidence: { bbox: { x: number; y: number; width: number; height: number }; edgeGroups: number; directionConsistency: number; edgeIntervalVariation: number; edgeWidthVariation: number; gapWidthVariation: number } };
  const challengerFixture = JSON.parse(await readFile(new URL("./fixtures/beauty-image-safety-v216-curtain-stripes-challenger.json", import.meta.url), "utf8")) as { sha256: string; detectorVersion: string; status: string; changedVariable: string; diagnostics: { observedCurtainEdgeGroups: number; minimumBarcodeEdgeGroups: number; curtainMinorQuietZoneScore: number; curtainEdgePersistence: number; encodedStripeMinorQuietZoneThreshold: number; encodedStripeEdgePersistenceMaximum: number; syntheticQrEdgeGroups: number; syntheticBarcodeEdgeGroups: number } };
  assert.equal(createHash("sha256").update(curtainBytes).digest("hex"), expectedCurtainSha256);
  assert.equal(createHash("sha256").update(woodSlatsBytes).digest("hex"), "2cf4738eb2e3fcd894c838c662ea968653020aa8c4fcf086706c034aefaec205");
  assert.equal(createHash("sha256").update(historicalRiskBytes).digest("hex"), "0e70f36a16453084f753974d4639b7601b6debbf0b1baa5b9c65f12129a0ae86");

  const curtainCandidates = inspectBeautyImageBarcodeCandidatesForEval(curtainBytes);
  const champion = curtainCandidates.find((candidate) => candidate.orientation === "vertical" && candidate.bbox.x === 0 && candidate.bbox.y === 320 && candidate.bbox.width === 208 && candidate.bbox.height === 64);
  assert.ok(champion, `expected curtain/window Champion candidate: ${JSON.stringify(curtainCandidates.slice(0, 12))}`);
  assert.deepEqual(
    [champion.edgeGroups, champion.stripeScore, champion.quietZoneScore, champion.edgeGroupDensity, champion.directionConsistency, champion.edgeIntervalVariation],
    [14, 0.765, 1, 0.136, 0.662, 0.451]
  );
  assert.deepEqual(
    [championFixture.sha256, championFixture.detectorVersion, championFixture.status, championFixture.reason, championFixture.evidence.bbox, championFixture.evidence.edgeGroups, championFixture.evidence.directionConsistency, championFixture.evidence.edgeIntervalVariation, championFixture.evidence.edgeWidthVariation, championFixture.evidence.gapWidthVariation],
    [expectedCurtainSha256, "beauty-image-safety-v2.15", "rejected", "qr_or_barcode_like", { x: 0, y: 320, width: 208, height: 64 }, 14, 0.662, 0.451, 0.338, 0.65]
  );
  assert.deepEqual(
    [challengerFixture.sha256, challengerFixture.detectorVersion, challengerFixture.status, challengerFixture.changedVariable, challengerFixture.diagnostics.observedCurtainEdgeGroups, challengerFixture.diagnostics.minimumBarcodeEdgeGroups, challengerFixture.diagnostics.curtainMinorQuietZoneScore, challengerFixture.diagnostics.curtainEdgePersistence, challengerFixture.diagnostics.encodedStripeMinorQuietZoneThreshold, challengerFixture.diagnostics.encodedStripeEdgePersistenceMaximum, challengerFixture.diagnostics.syntheticQrEdgeGroups, challengerFixture.diagnostics.syntheticBarcodeEdgeGroups],
    [expectedCurtainSha256, "beauty-image-safety-v2.16", "passed", "encodedStripeBoundaryEvidence", 14, 14, 0, 1, 0.45, 0.9, 20, 32]
  );

  const qr = PNG.sync.read(await QRCode.toBuffer("beauty-curtain-stripes-risk", { type: "png", width: 180, margin: 4, errorCorrectionLevel: "M" }));
  const safeFixtures = [
    { name: "real-curtain-window-vertical-folds", bytes: curtainBytes },
    { name: "real-architectural-wood-slats", bytes: woodSlatsBytes },
    { name: "synthetic-curtain-folds", bytes: PNG.sync.write(curtainFolds()) },
    { name: "synthetic-window-mullions", bytes: PNG.sync.write(windowMullions()) },
    { name: "synthetic-building-pillars", bytes: PNG.sync.write(buildingPillars()) },
    { name: "synthetic-horizontal-louvers", bytes: PNG.sync.write(horizontalLouvers()) }
  ];
  const riskFixtures = [
    { name: "synthetic-qr", bytes: PNG.sync.write(placeOnCanvas(qr, 256, 256, 38, 38)) },
    { name: "synthetic-barcode", bytes: PNG.sync.write(barcodeFixture()) },
    { name: "synthetic-payment-qr-sign", bytes: PNG.sync.write(paymentQrSign(qr)) },
    { name: "historical-qr-brand-risk", bytes: historicalRiskBytes }
  ];
  const diagnostics = {
    curtain: champion,
    safe: safeFixtures.map((fixture) => ({ name: fixture.name, verdict: assess(fixture.bytes), barcode: inspectBeautyImageBarcodeCandidatesForEval(fixture.bytes).slice(0, 3) })),
    risk: riskFixtures.map((fixture) => ({ name: fixture.name, verdict: assess(fixture.bytes), barcode: inspectBeautyImageBarcodeCandidatesForEval(fixture.bytes).slice(0, 3) }))
  };
  process.stdout.write(`${JSON.stringify(diagnostics)}\n`);

  for (let run = 1; run <= 3; run += 1) {
    for (const fixture of safeFixtures) {
      const verdict = assess(fixture.bytes);
      assert.equal(verdict.detectorVersion, "beauty-image-safety-v2.16");
      assert.equal(verdict.status, "passed", `run ${run}: ${fixture.name} must not be classified as QR/barcode: ${JSON.stringify(verdict)}`);
    }
    for (const fixture of riskFixtures) {
      const verdict = assess(fixture.bytes);
      assert.equal(verdict.detectorVersion, "beauty-image-safety-v2.16");
      assert.equal(verdict.status, "rejected", `run ${run}: ${fixture.name} must fail closed: ${JSON.stringify(verdict)}`);
      if (fixture.name !== "historical-qr-brand-risk") assert.ok(verdict.reasons.includes("qr_or_barcode_like"), `run ${run}: ${fixture.name} must retain QR/barcode evidence: ${JSON.stringify(verdict)}`);
    }
  }
  process.stdout.write(`beauty_image_curtain_stripes_p1_smoke=PASS;detector=beauty-image-safety-v2.16;changed_variable=encoded_stripe_boundary_evidence;safe=${safeFixtures.length * 3}/${safeFixtures.length * 3};risk=${riskFixtures.length * 3}/${riskFixtures.length * 3}_REJECT;precision=1.000;recall=1.000;provider_calls=0;external_network=0\n`);
}

function assess(bytes: Buffer): Verdict {
  return assessBeautyImageSafety(bytes, { contentType: "image/png" });
}

function blank(width = 256, height = 256, value = 238): Raster {
  const image = new PNG({ width, height });
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
    image.data[index + 3] = 255;
  }
  return image;
}

function pixel(image: Raster, x: number, y: number, value: number): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const offset = (Math.floor(y) * image.width + Math.floor(x)) * 4;
  image.data[offset] = value;
  image.data[offset + 1] = value;
  image.data[offset + 2] = value;
  image.data[offset + 3] = 255;
}

function rect(image: Raster, x: number, y: number, width: number, height: number, value: number): void {
  for (let py = y; py < y + height; py += 1) for (let px = x; px < x + width; px += 1) pixel(image, px, py, value);
}

function curtainFolds(): Raster {
  const image = blank(256, 256, 226);
  for (let x = 20; x < 236; x += 1) for (let y = 24; y < 236; y += 1) {
    const value = Math.round(202 + 24 * Math.cos((x - 20) / 14 * Math.PI) + 6 * Math.sin(y / 37));
    pixel(image, x, y, Math.max(140, Math.min(238, value)));
  }
  return image;
}

function windowMullions(): Raster {
  const image = blank(256, 256, 230);
  rect(image, 24, 20, 208, 216, 248);
  for (const x of [42, 98, 154, 214]) rect(image, x, 20, 5, 216, 154);
  rect(image, 24, 112, 208, 5, 166);
  return image;
}

function buildingPillars(): Raster {
  const image = blank();
  rect(image, 22, 24, 212, 208, 218);
  for (const x of [48, 88, 142, 206]) rect(image, x, 24, 7, 208, 164);
  for (const y of [92, 184]) rect(image, 22, y, 212, 4, 186);
  return image;
}

function horizontalLouvers(): Raster {
  const image = blank(256, 256, 230);
  for (let y = 34; y <= 218; y += 26) rect(image, 28, y, 200, 4, 158);
  rect(image, 24, 24, 5, 216, 178);
  rect(image, 228, 24, 5, 216, 178);
  return image;
}

function barcodeFixture(): Raster {
  const image = blank();
  rect(image, 32, 48, 192, 160, 252);
  let x = 49;
  for (const width of [2, 5, 2, 3, 6, 2, 4, 2, 7, 3, 2, 5, 3, 2, 6, 2, 4, 3, 2, 5]) {
    rect(image, x, 70, width, 112, 18);
    x += width + 3;
  }
  return image;
}

function paymentQrSign(qr: Raster): Raster {
  const image = blank();
  rect(image, 28, 20, 200, 216, 250);
  const embedded = placeOnCanvas(qr, 256, 256, 38, 38);
  for (let y = 38; y < 218; y += 1) for (let x = 38; x < 218; x += 1) {
    const offset = (y * embedded.width + x) * 4;
    pixel(image, x, y, embedded.data[offset]!);
  }
  rect(image, 52, 220, 152, 5, 45);
  return image;
}

function placeOnCanvas(source: Raster, width: number, height: number, offsetX: number, offsetY: number): Raster {
  const image = blank(width, height);
  for (let y = 0; y < source.height && y + offsetY < height; y += 1) for (let x = 0; x < source.width && x + offsetX < width; x += 1) {
    const sourceOffset = (y * source.width + x) * 4;
    const targetOffset = ((y + offsetY) * width + x + offsetX) * 4;
    for (let channel = 0; channel < 4; channel += 1) image.data[targetOffset + channel] = source.data[sourceOffset + channel]!;
  }
  return image;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
