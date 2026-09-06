import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { assessBeautyImageSafety, inspectBeautyImageBarcodeCandidatesForEval, inspectBeautyImageGlyphCandidatesForEval } from "../apps/api/src/products/beauty-industry/media-contract.js";

const require = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PNG } = require("pngjs") as { PNG: new (input: { width: number; height: number }) => Raster; sync: { read(bytes: Buffer): Raster; write(image: Raster): Buffer } };
const QRCode = require("qrcode") as { toBuffer(text: string, options: Record<string, unknown>): Promise<Buffer> };

type Raster = { width: number; height: number; data: Buffer };
type Verdict = ReturnType<typeof assessBeautyImageSafety>;

const safeAssetPath = process.env.BEAUTY_IMAGE_BY43_WOOD_SLATS_SAFE_ASSET;
const historicalRiskPath = process.env.BEAUTY_IMAGE_PRECISION_BAD_ASSET;
const expectedSafeSha256 = "2cf4738eb2e3fcd894c838c662ea968653020aa8c4fcf086706c034aefaec205";

async function main(): Promise<void> {
  assert.ok(safeAssetPath, "BEAUTY_IMAGE_BY43_WOOD_SLATS_SAFE_ASSET is required");
  assert.ok(historicalRiskPath, "BEAUTY_IMAGE_PRECISION_BAD_ASSET is required");
  const safeBytes = await readFile(safeAssetPath);
  const historicalRiskBytes = await readFile(historicalRiskPath);
  const championFixture = JSON.parse(await readFile(new URL("./fixtures/beauty-image-safety-v214-architectural-stripes-champion.json", import.meta.url), "utf8")) as { sha256: string; detectorVersion: string; status: string; reason: string; evidence: { bbox: { x: number; y: number; width: number; height: number }; edgeGroups: number; edgeIntervalVariation: number } };
  const challengerFixture = JSON.parse(await readFile(new URL("./fixtures/beauty-image-safety-v215-architectural-stripes-challenger.json", import.meta.url), "utf8")) as { sha256: string; detectorVersion: string; status: string; changedVariable: string; diagnostics: { edgeIntervalVariation: number; minimumBarcodeEdgeIntervalVariation: number; minimumObservedRiskIntervalVariation: number } };
  assert.equal(createHash("sha256").update(safeBytes).digest("hex"), expectedSafeSha256);
  assert.equal(createHash("sha256").update(historicalRiskBytes).digest("hex"), "0e70f36a16453084f753974d4639b7601b6debbf0b1baa5b9c65f12129a0ae86");

  const championCandidates = inspectBeautyImageBarcodeCandidatesForEval(safeBytes);
  const champion = championCandidates.find((candidate) => candidate.orientation === "vertical" && candidate.bbox.x === 528 && candidate.bbox.y === 180 && candidate.bbox.width === 144 && candidate.bbox.height === 64);
  assert.ok(champion, `expected architectural-slats Champion candidate: ${JSON.stringify(championCandidates.slice(0, 12))}`);
  assert.deepEqual(
    [champion.edgeGroups, champion.stripeScore, champion.quietZoneScore, champion.edgeGroupDensity, champion.directionConsistency],
    [27, 1, 0.6, 0.38, 1]
  );
  assert.deepEqual(
    [championFixture.sha256, championFixture.detectorVersion, championFixture.status, championFixture.reason, championFixture.evidence.bbox, championFixture.evidence.edgeGroups, championFixture.evidence.edgeIntervalVariation],
    [expectedSafeSha256, "beauty-image-safety-v2.14", "rejected", "qr_or_barcode_like", { x: 528, y: 180, width: 144, height: 64 }, 27, 0.232]
  );
  assert.deepEqual(
    [challengerFixture.sha256, challengerFixture.detectorVersion, challengerFixture.status, challengerFixture.changedVariable, challengerFixture.diagnostics.edgeIntervalVariation, challengerFixture.diagnostics.minimumBarcodeEdgeIntervalVariation, challengerFixture.diagnostics.minimumObservedRiskIntervalVariation],
    [expectedSafeSha256, "beauty-image-safety-v2.15", "passed", "minimumBarcodeEdgeIntervalVariation", 0.232, 0.35, 0.365]
  );

  const safeFixtures: Array<{ name: string; bytes: Buffer }> = [
    { name: "real-warm-consultation-room-wood-slats", bytes: safeBytes },
    { name: "real-warm-consultation-room-wood-slats-scaled", bytes: PNG.sync.write(scaleRaster(PNG.sync.read(safeBytes), 384, 512)) },
    { name: "synthetic-window-louvers", bytes: PNG.sync.write(windowLouvers()) },
    { name: "synthetic-building-decoration-lines", bytes: PNG.sync.write(buildingDecorationLines()) }
  ];
  const qr = PNG.sync.read(await QRCode.toBuffer("beauty-architectural-stripes-risk", { type: "png", width: 180, margin: 4, errorCorrectionLevel: "M" }));
  const riskFixtures: Array<{ name: string; bytes: Buffer; expectedReasons: Array<"qr_or_barcode_like" | "visible_text_or_brand_like" | "interface_or_watermark_like"> }> = [
    { name: "synthetic-qr", bytes: PNG.sync.write(placeOnCanvas(qr, 256, 256, 38, 38)), expectedReasons: ["qr_or_barcode_like"] },
    { name: "synthetic-barcode", bytes: PNG.sync.write(barcodeFixture()), expectedReasons: ["qr_or_barcode_like"] },
    { name: "synthetic-payment-qr-sign", bytes: PNG.sync.write(paymentQrSign(qr)), expectedReasons: ["qr_or_barcode_like"] },
    { name: "synthetic-text-logo", bytes: PNG.sync.write(textLogoFixture()), expectedReasons: ["visible_text_or_brand_like", "qr_or_barcode_like"] },
    { name: "synthetic-ui-card", bytes: PNG.sync.write(uiCardFixture()), expectedReasons: ["interface_or_watermark_like", "qr_or_barcode_like"] },
    { name: "historical-qr-brand-risk", bytes: historicalRiskBytes, expectedReasons: ["visible_text_or_brand_like", "interface_or_watermark_like"] }
  ];
  const riskBarcodeDiagnostics = riskFixtures.map((fixture) => ({
    name: fixture.name,
    candidates: inspectBeautyImageBarcodeCandidatesForEval(fixture.bytes).slice(0, 3),
    glyphCandidates: inspectBeautyImageGlyphCandidatesForEval(fixture.bytes).slice(0, 3)
  }));

  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  const runs: Array<{ run: number; safe: Array<{ name: string; status: string; reasons: string[] }>; risk: Array<{ name: string; status: string; reasons: string[] }> }> = [];
  for (let run = 1; run <= 3; run += 1) {
    const safeResults = safeFixtures.map((fixture) => ({ name: fixture.name, verdict: assess(fixture.bytes) }));
    const riskResults = riskFixtures.map((fixture) => ({ ...fixture, verdict: assess(fixture.bytes) }));
    falsePositive += safeResults.filter((item) => item.verdict.status !== "passed").length;
    for (const item of riskResults) {
      if (item.verdict.status === "rejected" && item.expectedReasons.some((reason) => item.verdict.reasons.includes(reason))) truePositive += 1;
      else falseNegative += 1;
    }
    runs.push({
      run,
      safe: safeResults.map((item) => ({ name: item.name, status: item.verdict.status, reasons: item.verdict.reasons })),
      risk: riskResults.map((item) => ({ name: item.name, status: item.verdict.status, reasons: item.verdict.reasons }))
    });
  }

  assert.equal(falsePositive, 0, `architectural safe fixtures must pass: ${JSON.stringify({ champion, riskBarcodeDiagnostics, runs })}`);
  assert.equal(falseNegative, 0, `QR/barcode/text/UI risk fixtures must remain rejected: ${JSON.stringify({ riskBarcodeDiagnostics, runs })}`);
  const precision = truePositive / Math.max(1, truePositive + falsePositive);
  const recall = truePositive / Math.max(1, truePositive + falseNegative);
  assert.equal(precision, 1);
  assert.equal(recall, 1);
  process.stdout.write(`beauty_image_architectural_stripes_p1_smoke=PASS;detector=beauty-image-safety-v2.16;retained_guard=barcode_edge_interval_variation_range;safe=${safeFixtures.length * 3}/${safeFixtures.length * 3};risk=${riskFixtures.length * 3}/${riskFixtures.length * 3}_REJECT;precision=${precision.toFixed(3)};recall=${recall.toFixed(3)};champion_interval_variation=${champion.edgeIntervalVariation.toFixed(3)};champion_minor_quiet=${champion.minorQuietZoneScore.toFixed(3)};provider_calls=0;external_network=0\n`);
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

function windowLouvers(): Raster {
  const image = blank(256, 256, 231);
  for (let y = 44; y <= 212; y += 34) rect(image, 36, y, 184, 3, 152);
  rect(image, 30, 30, 5, 198, 178);
  rect(image, 221, 30, 5, 198, 178);
  return image;
}

function buildingDecorationLines(): Raster {
  const image = blank();
  rect(image, 20, 30, 216, 196, 218);
  for (const x of [48, 126, 208]) rect(image, x, 30, 3, 196, 172);
  for (const y of [104, 182]) rect(image, 20, y, 216, 3, 184);
  return image;
}

function scaleRaster(source: Raster, width: number, height: number): Raster {
  const image = blank(width, height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const sourceX = Math.min(source.width - 1, Math.floor(x * source.width / width));
    const sourceY = Math.min(source.height - 1, Math.floor(y * source.height / height));
    const sourceOffset = (sourceY * source.width + sourceX) * 4;
    const targetOffset = (y * width + x) * 4;
    for (let channel = 0; channel < 4; channel += 1) image.data[targetOffset + channel] = source.data[sourceOffset + channel]!;
  }
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

function textLogoFixture(): Raster {
  const image = blank();
  rect(image, 34, 72, 188, 112, 250);
  for (let index = 0; index < 7; index += 1) {
    const x = 48 + index * 23;
    rect(image, x, 96 + (index % 2) * 4, 5, 42, 28);
    rect(image, x, 116, 16, 5, 28);
  }
  rect(image, 62, 151, 132, 6, 28);
  return image;
}

function uiCardFixture(): Raster {
  const image = blank();
  rect(image, 24, 26, 208, 204, 248);
  rect(image, 24, 26, 208, 18, 50);
  for (let row = 0; row < 2; row += 1) for (let column = 0; column < 2; column += 1) {
    rect(image, 42 + column * 96, 64 + row * 72, 76, 54, 210);
    rect(image, 50 + column * 96, 74 + row * 72, 56, 5, 70);
    rect(image, 50 + column * 96, 88 + row * 72, 42, 5, 94);
  }
  rect(image, 76, 204, 104, 14, 42);
  return image;
}

function placeOnCanvas(source: Raster, width: number, height: number, offsetX: number, offsetY: number): Raster {
  const image = blank(width, height);
  for (let y = 0; y < source.height && y + offsetY < height; y += 1) for (let x = 0; x < source.width && x + offsetX < width; x += 1) {
    const sourceOffset = (y * source.width + x) * 4;
    const targetOffset = ((y + offsetY) * width + x + offsetX) * 4;
    image.data[targetOffset] = source.data[sourceOffset]!;
    image.data[targetOffset + 1] = source.data[sourceOffset + 1]!;
    image.data[targetOffset + 2] = source.data[sourceOffset + 2]!;
    image.data[targetOffset + 3] = 255;
  }
  return image;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
