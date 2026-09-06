import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { assessBeautyImageSafety, inspectBeautyImageBarcodeCandidatesForEval } from "../apps/api/src/products/beauty-industry/media-contract.js";

const require = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PNG } = require("pngjs") as { PNG: new (input: { width: number; height: number }) => Raster; sync: { write(image: Raster): Buffer } };
type Raster = { width: number; height: number; data: Buffer };

const naturalStripePath = process.env.BEAUTY_IMAGE_BY38_NATURAL_STRIPES_ASSET;

async function main(): Promise<void> {
  assert.ok(naturalStripePath, "BEAUTY_IMAGE_BY38_NATURAL_STRIPES_ASSET is required");
  const naturalBytes = await readFile(naturalStripePath);
  assert.equal(createHash("sha256").update(naturalBytes).digest("hex"), "e9af2a0eebd361b634b35110a2acd3a5a31870e01e84273f2a1f2e929022a803");

  const receipt = JSON.parse(await readFile(new URL("./fixtures/beauty-image-safety-v213-barcode-density-challenger.json", import.meta.url), "utf8")) as {
    sourceSha256: string;
    challenger: { changedVariable: string; minimumBarcodeEdgeGroupDensity: number };
  };
  assert.equal(receipt.sourceSha256, createHash("sha256").update(naturalBytes).digest("hex"));
  assert.equal(receipt.challenger.changedVariable, "minimumBarcodeEdgeGroupDensity");
  const naturalCandidates = inspectBeautyImageBarcodeCandidatesForEval(naturalBytes);
  const naturalChampion = naturalCandidates.find((candidate) => candidate.edgeGroups === 11 && candidate.orientation === "vertical");
  assert.ok(naturalChampion, JSON.stringify(naturalCandidates.slice(0, 10)));
  assert.ok(naturalChampion.edgeGroupDensity < naturalChampion.minimumEdgeGroupDensity, JSON.stringify(naturalChampion));
  assert.equal(naturalChampion.minimumEdgeGroupDensity, receipt.challenger.minimumBarcodeEdgeGroupDensity);
  let truePositive = 0; let falsePositive = 0; let falseNegative = 0;
  for (let run = 0; run < 3; run += 1) {
    const natural = assessBeautyImageSafety(naturalBytes, { contentType: "image/png" });
    if (natural.reasons.includes("qr_or_barcode_like")) falsePositive += 1;
    for (const variant of [barcodeFixture(), scaleRaster(barcodeFixture(), 192, 192), adjustContrast(barcodeFixture(), 0.62)]) {
      const result = assessBeautyImageSafety(PNG.sync.write(variant), { contentType: "image/png" });
      if (result.status === "rejected" && result.reasons.includes("qr_or_barcode_like") && result.evidence.some((item) => item.detectorType === "barcode_stripes")) truePositive += 1;
      else falseNegative += 1;
    }
  }
  assert.equal(falsePositive, 0, "natural bottle/window edges must not be classified as a barcode");
  assert.equal(falseNegative, 0, "all deterministic barcode variants must remain rejected");
  const precision = truePositive / Math.max(1, truePositive + falsePositive);
  const recall = truePositive / Math.max(1, truePositive + falseNegative);
  assert.equal(precision, 1);
  assert.equal(recall, 1);

  process.stdout.write(`beauty_image_barcode_stripes_p1_smoke=PASS;runs=3;natural_safe=3/3;barcode_risk=9/9_REJECT;precision=${precision.toFixed(3)};recall=${recall.toFixed(3)};natural_edge_groups=${naturalChampion.edgeGroups};natural_edge_group_density=${naturalChampion.edgeGroupDensity.toFixed(3)};minimum_density=${naturalChampion.minimumEdgeGroupDensity.toFixed(3)};provider_calls=0\n`);
}

function blank(width = 256, height = 256, value = 242): Raster {
  const image = new PNG({ width, height });
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = value; image.data[i + 1] = value; image.data[i + 2] = value; image.data[i + 3] = 255;
  }
  return image;
}
function pixel(image: Raster, x: number, y: number, value: number) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const offset = (Math.floor(y) * image.width + Math.floor(x)) * 4;
  image.data[offset] = value; image.data[offset + 1] = value; image.data[offset + 2] = value; image.data[offset + 3] = 255;
}
function rect(image: Raster, x: number, y: number, width: number, height: number, value: number) {
  for (let py = y; py < y + height; py += 1) for (let px = x; px < x + width; px += 1) pixel(image, px, py, value);
}
function barcodeFixture(): Raster {
  const image = blank(); rect(image, 32, 58, 192, 142, 252); let x = 49;
  for (const width of [2, 5, 2, 3, 6, 2, 4, 2, 7, 3, 2, 5, 3, 2, 6, 2, 4, 3, 2, 5]) { rect(image, x, 74, width, 100, 18); x += width + 3; }
  return image;
}
function scaleRaster(source: Raster, width: number, height: number): Raster {
  const image = blank(width, height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const sx = Math.min(source.width - 1, Math.floor(x * source.width / width));
    const sy = Math.min(source.height - 1, Math.floor(y * source.height / height));
    pixel(image, x, y, source.data[(sy * source.width + sx) * 4]!);
  }
  return image;
}
function adjustContrast(source: Raster, factor: number): Raster {
  const image = blank(source.width, source.height);
  for (let y = 0; y < source.height; y += 1) for (let x = 0; x < source.width; x += 1) {
    const value = source.data[(y * source.width + x) * 4]!;
    pixel(image, x, y, Math.max(0, Math.min(255, Math.round(128 + (value - 128) * factor))));
  }
  return image;
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
