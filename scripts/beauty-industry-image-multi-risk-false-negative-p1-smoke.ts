import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  assessBeautyImageSafety,
  inspectBeautyImageGlyphCandidatesForEval
} from "../apps/api/src/products/beauty-industry/media-contract.js";

async function main(): Promise<void> {
  const riskAssetPath = process.env.BEAUTY_IMAGE_MULTI_RISK_ASSET;
  assert.ok(riskAssetPath, "BEAUTY_IMAGE_MULTI_RISK_ASSET is required");

  const bytes = await readFile(riskAssetPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  assert.equal(sha256, "aadedfc946f49135b11686642b976f2ab548542c55fbae4a81e717cd151dae1f");

  const verdict = assessBeautyImageSafety(bytes, { contentType: "image/png", sha256 });
  const glyphCandidates = inspectBeautyImageGlyphCandidatesForEval(bytes);

  assert.equal(verdict.status, "rejected", "the real provider image with visible wall signage must fail closed");
  assert.equal(verdict.detectorVersion, "beauty-image-safety-v2.16");
  assert.ok(verdict.reasons.includes("visible_text_or_brand_like"), JSON.stringify(verdict));
  assert.ok(
    verdict.evidence.some((item) => item.detectorType === "glyph_sequence"
      && item.decision === "rejected"
      && item.metrics.candidateSelectionMode === "center_display_text_stroke_band"),
    JSON.stringify(verdict)
  );
  assert.ok(glyphCandidates.length > 0, "the false-negative must retain desensitized local detector diagnostics");

  const safeAssets = splitPaths(process.env.BEAUTY_IMAGE_MULTI_RISK_SAFE_ASSETS);
  const riskAssets = splitPaths(process.env.BEAUTY_IMAGE_MULTI_RISK_POSITIVE_ASSETS);
  const runs: Array<{ safe: string[]; risk: string[] }> = [];
  for (let run = 0; run < 3; run += 1) {
    const safe = await Promise.all(safeAssets.map(async (assetPath) => assessBeautyImageSafety(await readFile(assetPath), { contentType: "image/png" }).status));
    const risk = await Promise.all(riskAssets.map(async (assetPath) => assessBeautyImageSafety(await readFile(assetPath), { contentType: "image/png" }).status));
    assert.ok(safe.every((status) => status === "passed"), JSON.stringify({ run, safe }));
    assert.ok(risk.every((status) => status === "rejected"), JSON.stringify({ run, risk }));
    runs.push({ safe, risk });
  }
  assert.deepEqual(runs[1], runs[0]);
  assert.deepEqual(runs[2], runs[0]);

  process.stdout.write(`beauty_image_multi_risk_false_negative_p1_smoke=PASS;sha=${sha256.slice(0, 8)};detector=${verdict.detectorVersion};status=${verdict.status};runs=3;safe=${safeAssets.length};risk=${riskAssets.length + 1};precision=1.000;recall=1.000;provider_calls=0\n`);
}

function splitPaths(value: string | undefined): string[] {
  return value?.split(";").map((item) => item.trim()).filter(Boolean) ?? [];
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
