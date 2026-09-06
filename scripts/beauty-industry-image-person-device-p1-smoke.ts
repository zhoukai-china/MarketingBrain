import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import {
  assessBeautyImageSafety,
  buildBeautyImageProviderInput
} from "../apps/api/src/products/beauty-industry/media-contract.js";

const require = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PNG } = require("pngjs") as {
  PNG: new (input: { width: number; height: number }) => Raster;
  sync: { read(bytes: Buffer): Raster; write(image: Raster): Buffer };
};

type Raster = { width: number; height: number; data: Buffer };

const riskPath = process.env.BEAUTY_IMAGE_ENGAGEMENT_DEVICE_RISK_ASSET;
const safeCoverPath = process.env.BEAUTY_IMAGE_ENGAGEMENT_SAFE_COVER_ASSET;
const safeContentPath = process.env.BEAUTY_IMAGE_ENGAGEMENT_SAFE_CONTENT_ASSET;

async function main(): Promise<void> {
  assert.ok(riskPath, "BEAUTY_IMAGE_ENGAGEMENT_DEVICE_RISK_ASSET is required");
  assert.ok(safeCoverPath, "BEAUTY_IMAGE_ENGAGEMENT_SAFE_COVER_ASSET is required");
  assert.ok(safeContentPath, "BEAUTY_IMAGE_ENGAGEMENT_SAFE_CONTENT_ASSET is required");

  const [riskBytes, safeCoverBytes, safeContentBytes] = await Promise.all([
    readFile(riskPath),
    readFile(safeCoverPath),
    readFile(safeContentPath)
  ]);
  const champion = JSON.parse(await readFile(new URL("./fixtures/beauty-image-safety-v210-engagement-device-missed-champion.json", import.meta.url), "utf8")) as {
    version: string;
    sha256: string;
    detectorVersion: string;
    status: string;
    rootCause: string;
    sourceEvidence: { role: string; observedDetector: string; explicitPersonOrDeviceEvidence: boolean };
  };

  assert.equal(createHash("sha256").update(riskBytes).digest("hex"), champion.sha256);
  assert.equal(createHash("sha256").update(safeCoverBytes).digest("hex"), "15721cea1dcf3ab5753f12f5b680b0e17b3fd45311f67b664645dbbfc5bc5b3f");
  assert.equal(createHash("sha256").update(safeContentBytes).digest("hex"), "4cdeb649b9f8efd368913a4ef331ddf266ddef72c6eeba772a91fc438c2c0c90");
  assert.equal(champion.version, "beauty-image-safety-v210-engagement-device-missed-champion-v1");
  assert.equal(champion.detectorVersion, "beauty-image-safety-v2.10");
  assert.equal(champion.status, "rejected");
  assert.equal(champion.rootCause, "explicit_person_and_handheld_device_evidence_missing");
  assert.deepEqual([champion.sourceEvidence.role, champion.sourceEvidence.observedDetector, champion.sourceEvidence.explicitPersonOrDeviceEvidence], ["engagement", "glyph_sequence", false]);

  const providerInput = buildBeautyImageProviderInput({
    index: 2,
    role: "engagement",
    label: "互动承接图",
    positivePrompt: "皮肤管理产品、透明水杯与绿植静物，自然光摄影，自然收尾",
    negativePrompt: "无文字、无品牌、无人物",
    postProductionText: "你更关注哪一步？"
  });
  const realRisk = assessBeautyImageSafety(riskBytes, { contentType: "image/png" });
  const syntheticHandheld = assessBeautyImageSafety(PNG.sync.write(handheldPhoneFixture()), { contentType: "image/png" });
  const safeCover = assessBeautyImageSafety(safeCoverBytes, { contentType: "image/png" });
  const safeContent = assessBeautyImageSafety(safeContentBytes, { contentType: "image/png" });

  const failures: string[] = [];
  if (providerInput.providerPromptVersion !== "beauty-image-provider-prompt-v1.7") failures.push(`prompt_version=${providerInput.providerPromptVersion}`);
  if (!/smartphone|phone screen|electronic device/i.test(`${providerInput.prompt};${providerInput.negativePrompt}`)) failures.push("handheld_device_negative_missing");
  if (!/hand|fingers|wrist/i.test(providerInput.negativePrompt)) failures.push("partial_hand_negative_missing");
  if (!realRisk.evidence.some((item) => item.detectorType === "person_device_geometry" && item.reason === "person_or_device_like")) failures.push("real_explicit_person_device_evidence_missing");
  if (!syntheticHandheld.evidence.some((item) => item.detectorType === "person_device_geometry" && item.reason === "person_or_device_like")) failures.push("synthetic_explicit_person_device_evidence_missing");
  if (safeCover.status !== "passed") failures.push(`safe_cover=${safeCover.status}`);
  if (safeContent.status !== "passed") failures.push(`safe_content=${safeContent.status}`);
  assert.deepEqual(failures, [], `QA-20260829-003 red: ${failures.join(",")}`);

  process.stdout.write("beauty_image_person_device_p1_smoke=PASS;champion=safety-v2.10;challenger=safety-v2.11_prompt-v1.3;real_handheld=REJECT_EXPLICIT;synthetic_handheld=REJECT_EXPLICIT;safe_cover=PASS;safe_content=PASS;provider_calls=0;network=0\n");
}

function handheldPhoneFixture(): Raster {
  const image = solid(256, 256, [224, 224, 218]);
  rect(image, 60, 68, 108, 158, [24, 27, 28]);
  rect(image, 68, 79, 92, 134, [244, 243, 236]);
  rect(image, 101, 79, 28, 8, [22, 24, 25]);
  rect(image, 28, 132, 66, 74, [210, 153, 122]);
  rect(image, 76, 116, 24, 66, [221, 164, 132]);
  rect(image, 83, 174, 72, 36, [214, 157, 126]);
  return image;
}

function solid(width: number, height: number, color: [number, number, number]): Raster {
  const image = new PNG({ width, height });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = color[0];
    image.data[offset + 1] = color[1];
    image.data[offset + 2] = color[2];
    image.data[offset + 3] = 255;
  }
  return image;
}

function rect(image: Raster, x: number, y: number, width: number, height: number, color: [number, number, number]): void {
  for (let py = y; py < y + height; py += 1) for (let px = x; px < x + width; px += 1) {
    const offset = (py * image.width + px) * 4;
    image.data[offset] = color[0];
    image.data[offset + 1] = color[1];
    image.data[offset + 2] = color[2];
    image.data[offset + 3] = 255;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
