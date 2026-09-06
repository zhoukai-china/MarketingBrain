import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assessBeautyImageSafety,
  buildBeautyImageProviderInput,
  parseBeautyImageDirections
} from "../apps/api/src/products/beauty-industry/media-contract.js";
import { buildLanqiMediaProviderRequest } from "../apps/api/src/services/lanqi-media-generation.js";

const require = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PNG } = require("pngjs") as { PNG: new (input: { width: number; height: number }) => { width: number; height: number; data: Buffer }; sync: { write(image: { width: number; height: number; data: Buffer }): Buffer } };
const QRCode = require("qrcode") as { toBuffer(text: string, options: Record<string, unknown>): Promise<Buffer> };

async function main(): Promise<void> {
const auditDir = process.env.BEAUTY_IMAGE_AUDIT_DIR;

const expected = new Map([
  ["0b6cb2f6003c7c66ccc3780b3fcbedcb8473f0e14ae908b4fe26b808cb89bd8c", "audit-1"],
  ["0e70f36a16453084f753974d4639b7601b6debbf0b1baa5b9c65f12129a0ae86", "audit-2"],
  ["9664e44676d3af48e392c74ad278c0f59dee814dfaa55681eb3d86dbfe0ad71b", "audit-3"]
]);

const files = [
  "cmta04xju02516w3bgm043i2q.png",
  "cmta04xjv02556w3b4ojqk762.png",
  "cmta04xjv02536w3bsunhwe96.png"
];
const findings: Array<{ sha256: string; result: ReturnType<typeof assessBeautyImageSafety> }> = [];
if (auditDir) {
  for (const filename of files) {
    const bytes = await readFile(path.join(auditDir, filename));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    assert.ok(expected.has(sha256), `unexpected audit asset hash: ${sha256}`);
    const result = assessBeautyImageSafety(bytes, { contentType: "image/png", sha256 });
    findings.push({ sha256, result });
  }
  const requiredRejected = findings.find((item) => item.sha256.startsWith("0e70f36a"));
  assert.equal(requiredRejected?.result.status, "rejected", "the known customer-visible unsafe image must fail the offline safety screen");
  assert.ok(requiredRejected?.result.reasons.some((reason) => ["qr_or_barcode_like", "visible_text_or_brand_like", "interface_or_watermark_like"].includes(reason)));
  assert.ok(findings.every((item) => item.result.status === "rejected"), `all three known unsafe audit assets must remain rejected: ${JSON.stringify(findings)}`);
  assert.ok(findings.every((item) => item.result.evidence.length > 0), "every rejected image needs auditable local evidence");
}

const clean = new PNG({ width: 128, height: 128 });
for (let y = 0; y < clean.height; y += 1) for (let x = 0; x < clean.width; x += 1) {
  const offset = (y * clean.width + x) * 4;
  clean.data[offset] = 232 + Math.floor(x / 32); clean.data[offset + 1] = 239 + Math.floor(y / 48); clean.data[offset + 2] = 230; clean.data[offset + 3] = 255;
}
assert.equal(assessBeautyImageSafety(PNG.sync.write(clean), { contentType: "image/png" }).status, "passed", "a clean no-text fixture must remain deliverable");

const qrResult = assessBeautyImageSafety(await QRCode.toBuffer("synthetic-beauty-quality-fixture", { type: "png", width: 128, margin: 4, errorCorrectionLevel: "M" }), { contentType: "image/png" });
assert.equal(qrResult.status, "rejected");
assert.ok(qrResult.reasons.includes("qr_or_barcode_like"), JSON.stringify(qrResult));

const output = `
## 配图方向一｜封面图
正向视觉提示词：暖白背景上的无品牌护肤器皿静物，柔和自然光。
负向提示词：真人正脸、疗效对比。
后期叠字：由门店后期确认。
视觉参数：3:4。
## 配图方向二｜内容图
正向视觉提示词：清爽水滴与纯色器皿的细节组合。
负向提示词：真人正脸、疗效对比。
后期叠字：由门店后期确认。
视觉参数：3:4。
## 配图方向三｜互动承接图
正向视觉提示词：暖白留白空间和无品牌护理工具。
负向提示词：真人正脸、疗效对比。
后期叠字：由门店后期确认。
视觉参数：3:4。`;
for (const direction of parseBeautyImageDirections(output, 3)) {
  const providerInput = buildBeautyImageProviderInput(direction);
  assert.match(providerInput.prompt, /Pure photographic scene only/i);
  assert.match(providerInput.negativePrompt, /text|letters/i);
  assert.match(providerInput.negativePrompt, /QR code/i);
  assert.match(providerInput.negativePrompt, /logo|brand mark/i);
  assert.match(providerInput.negativePrompt, /watermark/i);
  const snapshot = buildLanqiMediaProviderRequest({ kind: "image", ...providerInput, ratio: "3:4", promptVersion: "test", watermark: false });
  assert.equal((snapshot.parameters as Record<string, unknown>).watermark, false);
  assert.match(JSON.stringify(snapshot), /必须避免/);
}

const routeSource = await readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../apps/api/src/routes/beauty-industry-media.ts"), "utf8");
for (const token of ["visual_quality_rejected", "visual_quality_manual_review_required", "quality_failed", "customerUsable", "compensateSettledCreditReservation", "qualityEvidence"]) {
  assert.ok(routeSource.includes(token), `missing production quality gate token: ${token}`);
}
process.stdout.write(`beauty_industry_image_quality_p1_smoke=PASS;assets=${findings.length};rejected=${findings.filter((item) => item.result.status === "rejected").length};required_rejected=${auditDir ? "PASS" : "NOT_RUN"};clean_fixture=PASS;qr_fixture=PASS;provider_calls=0\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
