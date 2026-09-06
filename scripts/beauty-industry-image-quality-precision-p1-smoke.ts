import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { assessBeautyImageSafety } from "../apps/api/src/products/beauty-industry/media-contract.js";

const require = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PNG } = require("pngjs") as { PNG: new (input: { width: number; height: number }) => Raster; sync: { read(bytes: Buffer): Raster; write(image: Raster): Buffer } };
const QRCode = require("qrcode") as { toBuffer(text: string, options: Record<string, unknown>): Promise<Buffer> };
type Raster = { width: number; height: number; data: Buffer };
type Verdict = ReturnType<typeof assessBeautyImageSafety> & { evidence?: Array<{ detectorType?: string; confidence?: number; bbox?: { x: number; y: number; width: number; height: number }; metrics?: Record<string, unknown>; decodedTextHash?: string }> };

const safePath = process.env.BEAUTY_IMAGE_PRECISION_SAFE_ASSET;
const badPath = process.env.BEAUTY_IMAGE_PRECISION_BAD_ASSET;
const naturalCornerPath = process.env.BEAUTY_IMAGE_PRECISION_NATURAL_CORNER_ASSET;
const pumpBottleSafePath = process.env.BEAUTY_IMAGE_PRECISION_PUMP_BOTTLES_SAFE_ASSET;
const personRiskPath = process.env.BEAUTY_IMAGE_PRECISION_PERSON_RISK_ASSET;
const uiLayoutSafePath = process.env.BEAUTY_IMAGE_PRECISION_UI_LAYOUT_SAFE_ASSET;
const blankBottleSafePath = process.env.BEAUTY_IMAGE_PRECISION_BLANK_BOTTLES_SAFE_ASSET;
const cottonPadsSafePath = process.env.BEAUTY_IMAGE_PRECISION_COTTON_PADS_SAFE_ASSET;
const denseStillSafePath = process.env.BEAUTY_IMAGE_PRECISION_DENSE_STILL_SAFE_ASSET;
const by34QrSafePath = process.env.BEAUTY_IMAGE_PRECISION_BY34_QR_SAFE_ASSET;
const by34VisibleTextRiskPath = process.env.BEAUTY_IMAGE_PRECISION_BY34_VISIBLE_TEXT_RISK_ASSET;
const by35TopTextRiskPath = process.env.BEAUTY_IMAGE_PRECISION_BY35_TOP_TEXT_RISK_ASSET;
const by35NaturalStillSafePath = process.env.BEAUTY_IMAGE_PRECISION_BY35_NATURAL_STILL_SAFE_ASSET;
const by35EngagementDeviceRiskPath = process.env.BEAUTY_IMAGE_PRECISION_BY35_ENGAGEMENT_DEVICE_RISK_ASSET;
const by35VisibleChineseRiskPath = process.env.BEAUTY_IMAGE_PRECISION_BY35_VISIBLE_CHINESE_RISK_ASSET;
const by43WoodSlatsSafePath = process.env.BEAUTY_IMAGE_PRECISION_BY43_WOOD_SLATS_SAFE_ASSET;
const by43CurtainSafePath = process.env.BEAUTY_IMAGE_PRECISION_BY43_CURTAIN_SAFE_ASSET;

async function main(): Promise<void> {
  assert.ok(safePath, "BEAUTY_IMAGE_PRECISION_SAFE_ASSET is required");
  assert.ok(badPath, "BEAUTY_IMAGE_PRECISION_BAD_ASSET is required");
  assert.ok(naturalCornerPath, "BEAUTY_IMAGE_PRECISION_NATURAL_CORNER_ASSET is required");
  assert.ok(pumpBottleSafePath, "BEAUTY_IMAGE_PRECISION_PUMP_BOTTLES_SAFE_ASSET is required");
  assert.ok(personRiskPath, "BEAUTY_IMAGE_PRECISION_PERSON_RISK_ASSET is required");
  assert.ok(uiLayoutSafePath, "BEAUTY_IMAGE_PRECISION_UI_LAYOUT_SAFE_ASSET is required");
  assert.ok(blankBottleSafePath, "BEAUTY_IMAGE_PRECISION_BLANK_BOTTLES_SAFE_ASSET is required");
  assert.ok(cottonPadsSafePath, "BEAUTY_IMAGE_PRECISION_COTTON_PADS_SAFE_ASSET is required");
  assert.ok(denseStillSafePath, "BEAUTY_IMAGE_PRECISION_DENSE_STILL_SAFE_ASSET is required");
  assert.ok(by34QrSafePath, "BEAUTY_IMAGE_PRECISION_BY34_QR_SAFE_ASSET is required");
  assert.ok(by34VisibleTextRiskPath, "BEAUTY_IMAGE_PRECISION_BY34_VISIBLE_TEXT_RISK_ASSET is required");
  assert.ok(by35TopTextRiskPath, "BEAUTY_IMAGE_PRECISION_BY35_TOP_TEXT_RISK_ASSET is required");
  assert.ok(by35NaturalStillSafePath, "BEAUTY_IMAGE_PRECISION_BY35_NATURAL_STILL_SAFE_ASSET is required");
  assert.ok(by35EngagementDeviceRiskPath, "BEAUTY_IMAGE_PRECISION_BY35_ENGAGEMENT_DEVICE_RISK_ASSET is required");
  assert.ok(by35VisibleChineseRiskPath, "BEAUTY_IMAGE_PRECISION_BY35_VISIBLE_CHINESE_RISK_ASSET is required");
  assert.ok(by43WoodSlatsSafePath, "BEAUTY_IMAGE_PRECISION_BY43_WOOD_SLATS_SAFE_ASSET is required");
  assert.ok(by43CurtainSafePath, "BEAUTY_IMAGE_PRECISION_BY43_CURTAIN_SAFE_ASSET is required");
  const safeBytes = await readFile(safePath);
  const badBytes = await readFile(badPath);
  const naturalCornerBytes = await readFile(naturalCornerPath);
  const pumpBottleSafeBytes = await readFile(pumpBottleSafePath);
  const personRiskBytes = await readFile(personRiskPath);
  const uiLayoutSafeBytes = await readFile(uiLayoutSafePath);
  const blankBottleSafeBytes = await readFile(blankBottleSafePath);
  const cottonPadsSafeBytes = await readFile(cottonPadsSafePath);
  const denseStillSafeBytes = await readFile(denseStillSafePath);
  const by34QrSafeBytes = await readFile(by34QrSafePath);
  const by34VisibleTextRiskBytes = await readFile(by34VisibleTextRiskPath);
  const by35TopTextRiskBytes = await readFile(by35TopTextRiskPath);
  const by35NaturalStillSafeBytes = await readFile(by35NaturalStillSafePath);
  const by35EngagementDeviceRiskBytes = await readFile(by35EngagementDeviceRiskPath);
  const by35VisibleChineseRiskBytes = await readFile(by35VisibleChineseRiskPath);
  const by43WoodSlatsSafeBytes = await readFile(by43WoodSlatsSafePath);
  const by43CurtainSafeBytes = await readFile(by43CurtainSafePath);
  const realUiBytes = await readFile(new URL("../workbench-desktop-preview.png", import.meta.url));
  const champion = JSON.parse(await readFile(new URL("./fixtures/beauty-image-safety-v21-pump-bottles-champion.json", import.meta.url), "utf8")) as { sha256: string; detectorVersion: string; status: string; evidence: Array<{ detectorType: string; metrics: { edgePixelDensity: number } }> };
  const uiLayoutChampion = JSON.parse(await readFile(new URL("./fixtures/beauty-image-safety-v22-ui-layout-champion.json", import.meta.url), "utf8")) as { sha256: string; detectorVersion: string; status: string; evidence: Array<{ detectorType: string; reason: string; confidence: number; metrics: Record<string, number | boolean> }> };
  const blankBottleChampion = JSON.parse(await readFile(new URL("./fixtures/beauty-image-safety-v23-blank-bottles-champion.json", import.meta.url), "utf8")) as { sha256: string; detectorVersion: string; status: string; reason: string; evidence: Array<{ detectorType: string; confidence: number; metrics: Record<string, number | boolean> }> };
  const cottonPadsChampion = JSON.parse(await readFile(new URL("./fixtures/beauty-image-safety-v24-cotton-pads-champion.json", import.meta.url), "utf8")) as { sha256: string; detectorVersion: string; status: string; reason: string; evidence: Array<{ detectorType: string; confidence: number; metrics: Record<string, number | string | boolean> }> };
  const denseStillChampion = JSON.parse(await readFile(new URL("./fixtures/beauty-image-safety-v25-dense-still-ui-champion.json", import.meta.url), "utf8")) as { sha256: string; detectorVersion: string; status: string; reason: string; evidence: Array<{ detectorType: string; confidence: number; metrics: Record<string, number | boolean> }> };
  const denseStillChallenger = JSON.parse(await readFile(new URL("./fixtures/beauty-image-safety-v26-dense-still-ui-challenger.json", import.meta.url), "utf8")) as { sha256: string; detectorVersion: string; status: string; changedVariable: string; diagnostics: Record<string, number | boolean> };
  const by34QrChampion = JSON.parse(await readFile(new URL("./fixtures/beauty-image-safety-v26-qr-false-positive-champion.json", import.meta.url), "utf8")) as { sha256: string; detectorVersion: string; status: string; reason: string; evidence: Array<{ detectorType: string; confidence: number; bbox: { x: number; y: number; width: number; height: number }; metrics: Record<string, number | string | boolean> }> };
  const by34QrChallenger = JSON.parse(await readFile(new URL("./fixtures/beauty-image-safety-v27-qr-pattern-agreement-challenger.json", import.meta.url), "utf8")) as { sha256: string; detectorVersion: string; status: string; changedVariable: string; diagnostics: Record<string, number | boolean> };
  const by34VisibleTextChampion = JSON.parse(await readFile(new URL("./fixtures/beauty-image-safety-v27-visible-text-false-negative-champion.json", import.meta.url), "utf8")) as { sha256: string; detectorVersion: string; status: string; reason: string; rootCause: string; diagnostics: Record<string, number | boolean> };
  const by34VisibleTextChallenger = JSON.parse(await readFile(new URL("./fixtures/beauty-image-safety-v28-visible-text-candidate-challenger.json", import.meta.url), "utf8")) as { sha256: string; detectorVersion: string; status: string; reason: string; changedVariable: string; diagnostics: Record<string, number | string> };
  const by35TopTextChampion = JSON.parse(await readFile(new URL("./fixtures/beauty-image-safety-v28-top-text-false-negative-champion.json", import.meta.url), "utf8")) as { sha256: string; detectorVersion: string; status: string; reason: string; rootCause: string; diagnostics: Record<string, number | string> };
  const by35TopTextChallenger = JSON.parse(await readFile(new URL("./fixtures/beauty-image-safety-v29-top-text-stroke-band-challenger.json", import.meta.url), "utf8")) as { sha256: string; detectorVersion: string; status: string; reason: string; changedVariable: string; diagnostics: Record<string, number | string> };
  const by35NaturalStillChampion = JSON.parse(await readFile(new URL("./fixtures/beauty-image-safety-v29-natural-still-false-positive-champion.json", import.meta.url), "utf8")) as { sha256: string; detectorVersion: string; status: string; reasons: string[]; rootCause: string; diagnostics: Record<string, number | string | boolean> };
  const by35NaturalStillChallenger = JSON.parse(await readFile(new URL("./fixtures/beauty-image-safety-v210-explicit-text-structure-challenger.json", import.meta.url), "utf8")) as { sha256: string; detectorVersion: string; status: string; changedVariable: string; diagnostics: Record<string, number | string | boolean> };
  const by35EngagementDeviceChampion = JSON.parse(await readFile(new URL("./fixtures/beauty-image-safety-v210-engagement-device-missed-champion.json", import.meta.url), "utf8")) as { sha256: string; detectorVersion: string; status: string; rootCause: string; sourceEvidence: { explicitPersonOrDeviceEvidence: boolean } };
  const by35EngagementDeviceChallenger = JSON.parse(await readFile(new URL("./fixtures/beauty-image-safety-v211-person-device-geometry-challenger.json", import.meta.url), "utf8")) as { sha256: string; detectorVersion: string; status: string; reason: string; changedVariable: string; diagnostics: Record<string, number | string> };
  const by35VisibleChineseChampion = JSON.parse(await readFile(new URL("./fixtures/beauty-image-safety-v211-connected-top-text-champion.json", import.meta.url), "utf8")) as { sha256: string; detectorVersion: string; status: string; reason: string; rootCause: string; diagnostics: Record<string, number | string | boolean> };
  const by35VisibleChineseChallenger = JSON.parse(await readFile(new URL("./fixtures/beauty-image-safety-v212-connected-top-text-challenger.json", import.meta.url), "utf8")) as { sha256: string; detectorVersion: string; status: string; reason: string; changedVariable: string; diagnostics: Record<string, number | string | boolean> };
  assert.equal(createHash("sha256").update(safeBytes).digest("hex"), "f408e29e809711fdf4e791d271f86b1fffe2efd84d9d5033c4ae955fde64f24e");
  assert.equal(createHash("sha256").update(badBytes).digest("hex"), "0e70f36a16453084f753974d4639b7601b6debbf0b1baa5b9c65f12129a0ae86");
  assert.equal(createHash("sha256").update(naturalCornerBytes).digest("hex"), "5181dadec432f36f24c93ccfaf3872d85cde69c6927c0d2ff3df1987d9a1653a");
  assert.equal(createHash("sha256").update(pumpBottleSafeBytes).digest("hex"), "fa9e11f9ae92ca218dd58ea33cde2dd8c91969c981933d8fcbcde4deed052846");
  assert.equal(createHash("sha256").update(personRiskBytes).digest("hex"), "229661b38b5e322c34a10c73a11b6de7d567166365376d0ac5075dd6f931ed9f");
  assert.equal(createHash("sha256").update(uiLayoutSafeBytes).digest("hex"), "63f63a70505b08e5f3568979d6feba5115c7ffc0ef23fb3e1b9c0b7648b73fe9");
  assert.equal(createHash("sha256").update(blankBottleSafeBytes).digest("hex"), "bc044be31355a642ee7f4d1464adb164e6a72f37efe5df940ae38e88297caf61");
  assert.equal(createHash("sha256").update(cottonPadsSafeBytes).digest("hex"), "19f368105ab275c7e130e1979922954c897d1cc2e855dd82a3f310a9c348d946");
  assert.equal(createHash("sha256").update(denseStillSafeBytes).digest("hex"), "f00d1cb9c29db917fd0caa718cd813d52bde586e1e1084133eb029cddff0f8d8");
  assert.equal(createHash("sha256").update(realUiBytes).digest("hex"), "bdffe78b2de579a6088da3f4e0ef26b2bfea2f023794aff4ca50689395063a3c");
  assert.equal(createHash("sha256").update(by34QrSafeBytes).digest("hex"), "60f2ea68d251cbfe2e0fc49119f3ee4e44222c94c826b8aa692a6af09868bb8d");
  assert.equal(createHash("sha256").update(by34VisibleTextRiskBytes).digest("hex"), "66b9a75b3185c465a74cf9088887bc831cf7d960121e9ed55394c6c28180f199");
  assert.equal(createHash("sha256").update(by35TopTextRiskBytes).digest("hex"), "e91ef4afcff706a03142d519f6a10e3e229f31728468f01124e5abcf4ceaa331");
  assert.equal(createHash("sha256").update(by35NaturalStillSafeBytes).digest("hex"), "df997146f3205e619734e3e596b7de098c3362d07adf45f99d5e9326d0e5f04c");
  assert.equal(createHash("sha256").update(by35EngagementDeviceRiskBytes).digest("hex"), "350b1f39cf9d99a7ff669f8e73242f12e577525dadf97e6172ed35f24e5b994a");
  assert.equal(createHash("sha256").update(by35VisibleChineseRiskBytes).digest("hex"), "e98c0d514b74882cd0fc719242d94bfcb686d96381360d69d89cd4ffd82192dc");
  assert.equal(createHash("sha256").update(by43WoodSlatsSafeBytes).digest("hex"), "2cf4738eb2e3fcd894c838c662ea968653020aa8c4fcf086706c034aefaec205");
  assert.equal(createHash("sha256").update(by43CurtainSafeBytes).digest("hex"), "3d8fe077ad29d63454fa02bd399927dedcb483353107c54e842a047a749284cd");
  assert.equal(champion.sha256, "fa9e11f9ae92ca218dd58ea33cde2dd8c91969c981933d8fcbcde4deed052846");
  assert.equal(champion.detectorVersion, "beauty-image-safety-v2.1");
  assert.equal(champion.status, "rejected");
  assert.deepEqual(champion.evidence.map((item) => [item.detectorType, item.metrics.edgePixelDensity]), [["corner_watermark", 0.077], ["glyph_sequence", 0.042]]);
  assert.equal(uiLayoutChampion.sha256, "63f63a70505b08e5f3568979d6feba5115c7ffc0ef23fb3e1b9c0b7648b73fe9");
  assert.equal(uiLayoutChampion.detectorVersion, "beauty-image-safety-v2.2");
  assert.equal(uiLayoutChampion.status, "rejected");
  assert.deepEqual(uiLayoutChampion.evidence.map((item) => [item.detectorType, item.reason, item.metrics.horizontalLongEdges, item.metrics.verticalLongEdges, item.metrics.panelLikeRegions, item.metrics.rowGroups, item.metrics.columnGroups, item.metrics.repeatedBarRegions, item.metrics.alignedPanelEvidence]), [["ui_layout", "interface_or_watermark_like", 0, 7, 6, 3, 3, 2, true]]);
  assert.equal(blankBottleChampion.sha256, "bc044be31355a642ee7f4d1464adb164e6a72f37efe5df940ae38e88297caf61");
  assert.equal(blankBottleChampion.detectorVersion, "beauty-image-safety-v2.3");
  assert.equal(blankBottleChampion.status, "rejected");
  assert.equal(blankBottleChampion.reason, "visible_text_or_brand_like");
  assert.deepEqual(blankBottleChampion.evidence.map((item) => [item.detectorType, item.metrics.glyphCount, item.metrics.glyphLikeComponents, item.metrics.glyphLikeRatio, item.metrics.maximumComponentAspectRatio, item.metrics.readableSequenceRecovered]), [["glyph_sequence", 5, 3, 0.6, 6.8, false]]);
  assert.equal(cottonPadsChampion.sha256, "19f368105ab275c7e130e1979922954c897d1cc2e855dd82a3f310a9c348d946");
  assert.equal(cottonPadsChampion.detectorVersion, "beauty-image-safety-v2.4");
  assert.equal(cottonPadsChampion.status, "rejected");
  assert.equal(cottonPadsChampion.reason, "interface_or_watermark_like");
  assert.deepEqual(cottonPadsChampion.evidence.map((item) => [item.detectorType, item.metrics.componentMode, item.metrics.glyphComponents, item.metrics.meanComponentHeight, item.metrics.sampledUnionHeight, item.metrics.meanComponentHeightToUnionHeight, item.metrics.readableSequenceRecovered]), [["corner_watermark", "edge_components", 6, 4.333, 10, 0.433, false]]);
  assert.equal(denseStillChampion.sha256, "f00d1cb9c29db917fd0caa718cd813d52bde586e1e1084133eb029cddff0f8d8");
  assert.equal(denseStillChampion.detectorVersion, "beauty-image-safety-v2.5");
  assert.equal(denseStillChampion.status, "rejected");
  assert.equal(denseStillChampion.reason, "interface_or_watermark_like");
  assert.deepEqual(denseStillChampion.evidence.map((item) => [item.detectorType, item.metrics.horizontalLongEdges, item.metrics.verticalLongEdges, item.metrics.panelLikeRegions, item.metrics.rowGroups, item.metrics.columnGroups, item.metrics.repeatedBarRegions, item.metrics.panelGridOccupancy]), [["ui_layout", 4, 14, 5, 3, 4, 2, 0.417]]);
  assert.equal(denseStillChallenger.sha256, denseStillChampion.sha256);
  assert.equal(denseStillChallenger.detectorVersion, "beauty-image-safety-v2.6");
  assert.equal(denseStillChallenger.status, "passed");
  assert.equal(denseStillChallenger.changedVariable, "panelGridOccupancy");
  assert.deepEqual([denseStillChallenger.diagnostics.panelLikeRegions, denseStillChallenger.diagnostics.rowGroups, denseStillChallenger.diagnostics.columnGroups, denseStillChallenger.diagnostics.panelGridOccupancy, denseStillChallenger.diagnostics.minimumPanelGridOccupancy, denseStillChallenger.diagnostics.panelGridAccepted, denseStillChallenger.diagnostics.repeatedBarsAccepted], [5, 3, 4, 0.417, 0.6, false, false]);
  assert.equal(by34QrChampion.sha256, "60f2ea68d251cbfe2e0fc49119f3ee4e44222c94c826b8aa692a6af09868bb8d");
  assert.equal(by34QrChampion.detectorVersion, "beauty-image-safety-v2.6");
  assert.equal(by34QrChampion.status, "rejected");
  assert.equal(by34QrChampion.reason, "qr_or_barcode_like");
  assert.deepEqual(by34QrChampion.evidence.map((item) => [item.detectorType, item.confidence, item.bbox.x, item.bbox.y, item.bbox.width, item.bbox.height, item.metrics.finderPatternCount, item.metrics.averageRatioError, item.metrics.rightAngleScore, item.metrics.decoded]), [["qr_finder_pattern", 0.953, 179, 381, 304, 304, 3, 0.283, 0.74, false]]);
  assert.equal(by34QrChallenger.sha256, by34QrChampion.sha256);
  assert.equal(by34QrChallenger.detectorVersion, "beauty-image-safety-v2.7");
  assert.equal(by34QrChallenger.status, "passed");
  assert.equal(by34QrChallenger.changedVariable, "minimumAverageQrFinderPatternAgreement");
  assert.deepEqual([by34QrChallenger.diagnostics.minimumPatternAgreement, by34QrChallenger.diagnostics.averagePatternAgreement, by34QrChallenger.diagnostics.minimumAveragePatternAgreement, by34QrChallenger.diagnostics.geometryAccepted, by34QrChallenger.diagnostics.patternAgreementAccepted], [0.469, 0.51, 0.72, true, false]);
  assert.equal(by34VisibleTextChampion.sha256, "66b9a75b3185c465a74cf9088887bc831cf7d960121e9ed55394c6c28180f199");
  assert.equal(by34VisibleTextChampion.detectorVersion, "beauty-image-safety-v2.7");
  assert.equal(by34VisibleTextChampion.status, "passed");
  assert.equal(by34VisibleTextChampion.reason, "visible_text_or_brand_like_missing");
  assert.equal(by34VisibleTextChampion.rootCause, "highest_component_count_candidate_only");
  assert.deepEqual([by34VisibleTextChampion.diagnostics.highestRankedCandidate, by34VisibleTextChampion.diagnostics.highestRankedCandidateAccepted, by34VisibleTextChampion.diagnostics.missedDisplayTextCandidateRank, by34VisibleTextChampion.diagnostics.missedDisplayTextCandidateBaselineDeviation, by34VisibleTextChampion.diagnostics.missedDisplayTextCandidateEdgePixelDensity], [1, false, 10, 0, 0.323]);
  assert.equal(by34VisibleTextChallenger.sha256, by34VisibleTextChampion.sha256);
  assert.equal(by34VisibleTextChallenger.detectorVersion, "beauty-image-safety-v2.8");
  assert.equal(by34VisibleTextChallenger.status, "rejected");
  assert.equal(by34VisibleTextChallenger.reason, "visible_text_or_brand_like");
  assert.equal(by34VisibleTextChallenger.changedVariable, "highConfidenceTopDisplayTextCandidateSelection");
  assert.deepEqual([by34VisibleTextChallenger.diagnostics.selectedCandidateRank, by34VisibleTextChallenger.diagnostics.candidateSelectionMode, by34VisibleTextChallenger.diagnostics.baselineDeviation, by34VisibleTextChallenger.diagnostics.maximumBaselineDeviation, by34VisibleTextChallenger.diagnostics.edgePixelDensity, by34VisibleTextChallenger.diagnostics.minimumEdgePixelDensity], [10, "high_confidence_top_display_text", 0, 1.25, 0.323, 0.25]);
  assert.equal(by35TopTextChampion.sha256, "e91ef4afcff706a03142d519f6a10e3e229f31728468f01124e5abcf4ceaa331");
  assert.equal(by35TopTextChampion.detectorVersion, "beauty-image-safety-v2.8");
  assert.equal(by35TopTextChampion.status, "passed");
  assert.equal(by35TopTextChampion.reason, "visible_text_or_brand_like_missing");
  assert.equal(by35TopTextChampion.rootCause, "edge_component_grouping_missed_low_contrast_top_display_text");
  assert.deepEqual([by35TopTextChampion.diagnostics.sampledWidth, by35TopTextChampion.diagnostics.sampledHeight, by35TopTextChampion.diagnostics.topDisplayTextGlyphCandidateCount, by35TopTextChampion.diagnostics.topStrokeBandQualifyingRows, by35TopTextChampion.diagnostics.topStrokeBandPeakTransitions], [384, 512, 0, 17, 98]);
  assert.equal(by35TopTextChallenger.sha256, by35TopTextChampion.sha256);
  assert.equal(by35TopTextChallenger.detectorVersion, "beauty-image-safety-v2.9");
  assert.equal(by35TopTextChallenger.status, "rejected");
  assert.equal(by35TopTextChallenger.reason, "visible_text_or_brand_like");
  assert.equal(by35TopTextChallenger.changedVariable, "highDensityTopStrokeBandFallback");
  assert.deepEqual([by35TopTextChallenger.diagnostics.candidateSelectionMode, by35TopTextChallenger.diagnostics.qualifyingRows, by35TopTextChallenger.diagnostics.consecutiveRows, by35TopTextChallenger.diagnostics.peakRowTransitions, by35TopTextChallenger.diagnostics.minimumRowTransitions, by35TopTextChallenger.diagnostics.horizontalCoverage], ["high_density_top_stroke_band", 17, 17, 99, 33, 0.451]);
  assert.equal(by35NaturalStillChampion.sha256, "df997146f3205e619734e3e596b7de098c3362d07adf45f99d5e9326d0e5f04c");
  assert.equal(by35NaturalStillChampion.detectorVersion, "beauty-image-safety-v2.9");
  assert.equal(by35NaturalStillChampion.status, "rejected");
  assert.deepEqual(by35NaturalStillChampion.reasons, ["interface_or_watermark_like", "visible_text_or_brand_like"]);
  assert.equal(by35NaturalStillChampion.rootCause, "unsupported_bright_ink_and_impure_glyph_sequences");
  assert.equal(by35NaturalStillChallenger.sha256, by35NaturalStillChampion.sha256);
  assert.equal(by35NaturalStillChallenger.detectorVersion, "beauty-image-safety-v2.10");
  assert.equal(by35NaturalStillChallenger.status, "passed");
  assert.equal(by35NaturalStillChallenger.changedVariable, "minimum_explicit_text_structure_agreement");
  assert.deepEqual([
    by35NaturalStillChallenger.diagnostics.unsupportedBrightInkFallbackAccepted,
    by35NaturalStillChallenger.diagnostics.championGlyphLikeRatio,
    by35NaturalStillChallenger.diagnostics.minimumGlyphLikeRatio,
    by35NaturalStillChallenger.diagnostics.currentReasonCount,
    by35NaturalStillChallenger.diagnostics.readableSequenceRecovered
  ], [false, 0.889, 1, 0, false]);
  assert.equal(by35EngagementDeviceChampion.sha256, "350b1f39cf9d99a7ff669f8e73242f12e577525dadf97e6172ed35f24e5b994a");
  assert.equal(by35EngagementDeviceChampion.detectorVersion, "beauty-image-safety-v2.10");
  assert.equal(by35EngagementDeviceChampion.status, "rejected");
  assert.equal(by35EngagementDeviceChampion.rootCause, "explicit_person_and_handheld_device_evidence_missing");
  assert.equal(by35EngagementDeviceChampion.sourceEvidence.explicitPersonOrDeviceEvidence, false);
  assert.equal(by35EngagementDeviceChallenger.sha256, by35EngagementDeviceChampion.sha256);
  assert.equal(by35EngagementDeviceChallenger.detectorVersion, "beauty-image-safety-v2.11");
  assert.equal(by35EngagementDeviceChallenger.status, "rejected");
  assert.equal(by35EngagementDeviceChallenger.reason, "person_or_device_like");
  assert.equal(by35EngagementDeviceChallenger.changedVariable, "brightNeutralScreenDarkFrameSkinProximity");
  assert.equal(by35VisibleChineseChampion.sha256, "e98c0d514b74882cd0fc719242d94bfcb686d96381360d69d89cd4ffd82192dc");
  assert.equal(by35VisibleChineseChampion.detectorVersion, "beauty-image-safety-v2.11");
  assert.equal(by35VisibleChineseChampion.status, "passed");
  assert.equal(by35VisibleChineseChampion.reason, "visible_text_or_brand_like_missing");
  assert.equal(by35VisibleChineseChampion.rootCause, "connected_top_display_text_excluded_from_glyph_sequence");
  assert.deepEqual([by35VisibleChineseChampion.diagnostics.sampledWidth, by35VisibleChineseChampion.diagnostics.sampledHeight, by35VisibleChineseChampion.diagnostics.componentX, by35VisibleChineseChampion.diagnostics.componentY, by35VisibleChineseChampion.diagnostics.componentWidth, by35VisibleChineseChampion.diagnostics.componentHeight, by35VisibleChineseChampion.diagnostics.componentPixels, by35VisibleChineseChampion.diagnostics.componentFill, by35VisibleChineseChampion.diagnostics.componentAspectRatio, by35VisibleChineseChampion.diagnostics.maximumGlyphComponentWidth, by35VisibleChineseChampion.diagnostics.excludedByMaximumWidth, by35VisibleChineseChampion.diagnostics.groupedGlyphCandidateCount, by35VisibleChineseChampion.diagnostics.safetyEvidenceCount], [384, 512, 166, 28, 51, 19, 571, 0.589, 2.684, 46, true, 0, 0]);
  assert.equal(by35VisibleChineseChallenger.sha256, by35VisibleChineseChampion.sha256);
  assert.equal(by35VisibleChineseChallenger.detectorVersion, "beauty-image-safety-v2.12");
  assert.equal(by35VisibleChineseChallenger.status, "rejected");
  assert.equal(by35VisibleChineseChallenger.reason, "visible_text_or_brand_like");
  assert.equal(by35VisibleChineseChallenger.changedVariable, "connectedTopDisplayTextBlockEvidence");
  assert.deepEqual([by35VisibleChineseChallenger.diagnostics.candidateSelectionMode, by35VisibleChineseChallenger.diagnostics.componentX, by35VisibleChineseChallenger.diagnostics.componentY, by35VisibleChineseChallenger.diagnostics.componentWidth, by35VisibleChineseChallenger.diagnostics.componentHeight, by35VisibleChineseChallenger.diagnostics.componentPixels, by35VisibleChineseChallenger.diagnostics.componentFill, by35VisibleChineseChallenger.diagnostics.componentAspectRatio, by35VisibleChineseChallenger.diagnostics.widthRatio, by35VisibleChineseChallenger.diagnostics.heightRatio], ["connected_top_display_text_block", 166, 28, 51, 19, 571, 0.589, 2.684, 0.133, 0.037]);

  const safeActual = assess(safeBytes);
  const badActual = assess(badBytes);
  const naturalCornerActual = assess(naturalCornerBytes);
  const pumpBottleSafeActual = assess(pumpBottleSafeBytes);
  const personRiskActual = assess(personRiskBytes);
  const uiLayoutSafeActual = assess(uiLayoutSafeBytes);
  const blankBottleSafeActual = assess(blankBottleSafeBytes);
  const cottonPadsSafeActual = assess(cottonPadsSafeBytes);
  const denseStillSafeActual = assess(denseStillSafeBytes);
  const realUiActual = assess(realUiBytes);
  const by34QrSafeActual = assess(by34QrSafeBytes);
  const by34VisibleTextRiskActual = assess(by34VisibleTextRiskBytes);
  const by35TopTextRiskActual = assess(by35TopTextRiskBytes);
  const by35NaturalStillSafeActual = assess(by35NaturalStillSafeBytes);
  const by35EngagementDeviceRiskActual = assess(by35EngagementDeviceRiskBytes);
  const by35VisibleChineseRiskActual = assess(by35VisibleChineseRiskBytes);
  assert.equal(safeActual.status, "passed", JSON.stringify(safeActual));
  assert.deepEqual(safeActual.reasons, [], "the confirmed no-text bottle still life must not accumulate unsupported risk reasons");
  assert.equal(naturalCornerActual.status, "passed", `natural bottom-right leaf texture must not be classified as a corner watermark: ${JSON.stringify(naturalCornerActual)}`);
  assert.deepEqual(naturalCornerActual.reasons, [], "natural bottom-right texture must not accumulate unsupported watermark risk reasons");
  assert.equal(pumpBottleSafeActual.status, "passed", `unlabelled pump bottles and wood texture must not be classified as watermark/text: ${JSON.stringify(pumpBottleSafeActual)}`);
  assert.deepEqual(pumpBottleSafeActual.reasons, [], "unlabelled pump bottles must not accumulate unsupported watermark/text reasons");
  assert.equal(badActual.status, "rejected", JSON.stringify(badActual));
  assert.ok(badActual.reasons.some((reason) => ["qr_or_barcode_like", "visible_text_or_brand_like", "interface_or_watermark_like"].includes(reason)));
  assertEvidence(badActual);
  assert.equal(personRiskActual.status, "rejected", "the known person plus fake-label risk asset must remain fail-closed");
  assertEvidence(personRiskActual);
  assert.equal(uiLayoutSafeActual.status, "passed", `unlabelled bottles and natural shelf lines must not be classified as UI: ${JSON.stringify(uiLayoutSafeActual)}`);
  assert.deepEqual(uiLayoutSafeActual.reasons, [], "natural shelf geometry must not accumulate unsupported UI/watermark reasons");
  assert.equal(blankBottleSafeActual.status, "passed", `blank bottle bases and shelf texture must not be classified as visible text or brand: ${JSON.stringify(blankBottleSafeActual)}`);
  assert.deepEqual(blankBottleSafeActual.reasons, [], "blank bottle still life must not accumulate unsupported visible-text/brand reasons");
  assert.equal(cottonPadsSafeActual.status, "passed", `cotton pads and tablecloth texture must not be classified as a corner watermark: ${JSON.stringify(cottonPadsSafeActual)}`);
  assert.deepEqual(cottonPadsSafeActual.reasons, [], "cotton pads and natural bottom-right texture must not accumulate unsupported watermark reasons");
  assert.equal(denseStillSafeActual.status, "passed", `blank pump bottles, tray, window and table must not be classified as UI: ${JSON.stringify(denseStillSafeActual)}`);
  assert.deepEqual(denseStillSafeActual.reasons, [], "dense natural still life must not accumulate unsupported UI reasons");
  assert.equal(realUiActual.status, "rejected", "the real product UI screenshot must remain fail-closed");
  assert.ok(realUiActual.evidence?.some((item) => item.detectorType === "ui_layout" && item.reason === "interface_or_watermark_like"), `real UI screenshot must retain ui_layout evidence: ${JSON.stringify(realUiActual)}`);
  assert.equal(by34QrSafeActual.status, "passed", `clear water bowl, white towel and leaves must not be classified as QR/barcode: ${JSON.stringify(by34QrSafeActual)}`);
  assert.deepEqual(by34QrSafeActual.reasons, [], "the BY-34 safe still life must not accumulate unsupported QR/barcode reasons");
  assert.equal(by34VisibleTextRiskActual.status, "rejected", `the BY-34 real display-text asset must fail closed: ${JSON.stringify(by34VisibleTextRiskActual)}`);
  assert.ok(by34VisibleTextRiskActual.reasons.includes("visible_text_or_brand_like"), `the BY-34 real display-text asset must retain visible-text evidence: ${JSON.stringify(by34VisibleTextRiskActual)}`);
  assert.equal(by35TopTextRiskActual.status, "rejected", `the BY-35 real top display-text asset must fail closed: ${JSON.stringify(by35TopTextRiskActual)}`);
  assert.ok(by35TopTextRiskActual.evidence?.some((item) => item.detectorType === "glyph_sequence" && item.reason === "visible_text_or_brand_like" && item.metrics?.candidateSelectionMode === "high_density_top_stroke_band"), `the BY-35 top text asset must retain explainable stroke-band evidence: ${JSON.stringify(by35TopTextRiskActual)}`);
  assert.equal(by35NaturalStillSafeActual.status, "passed", `natural bottles, towels and furniture must not be classified as watermark/text: ${JSON.stringify(by35NaturalStillSafeActual)}`);
  assert.deepEqual(by35NaturalStillSafeActual.reasons, [], "natural still life must not accumulate unsupported watermark/text reasons");
  assert.equal(by35EngagementDeviceRiskActual.status, "rejected", `hand-held smartphone engagement image must fail closed: ${JSON.stringify(by35EngagementDeviceRiskActual)}`);
  assert.ok(by35EngagementDeviceRiskActual.evidence?.some((item) => item.detectorType === "person_device_geometry" && item.metrics?.evidenceMode === "bright_neutral_screen_dark_frame_skin_proximity"), `hand-held smartphone engagement image must retain explicit device/person evidence: ${JSON.stringify(by35EngagementDeviceRiskActual)}`);
  assert.equal(by35VisibleChineseRiskActual.status, "rejected", `the BY-35 connected top display-text asset must fail closed: ${JSON.stringify(by35VisibleChineseRiskActual)}`);
  assert.ok(by35VisibleChineseRiskActual.evidence?.some((item) => item.detectorType === "glyph_sequence" && item.reason === "visible_text_or_brand_like"), `the BY-35 connected top display-text asset must retain explicit text evidence: ${JSON.stringify(by35VisibleChineseRiskActual)}`);
  assert.ok(by35VisibleChineseRiskActual.evidence?.some((item) => item.metrics?.candidateSelectionMode === "connected_top_display_text_block"), `the BY-35 connected top display-text asset must retain connected-block evidence: ${JSON.stringify(by35VisibleChineseRiskActual)}`);

  const safeFixtures = [
    { name: "blank-label-bottles", image: blankLabelBottles() },
    { name: "rectangular-color-blocks", image: rectangularBlocks() },
    { name: "natural-highlights", image: naturalHighlights() },
    { name: "bottles-on-shelf", image: bottlesOnShelfFixture() },
    { name: "building-lines", image: buildingLinesFixture() }
  ];
  const qr = PNG.sync.read(await QRCode.toBuffer("synthetic-beauty-quality-fixture", { type: "png", width: 180, margin: 4, errorCorrectionLevel: "M" }));
  const riskyFixtures = [
    { name: "qr", image: placeOnCanvas(qr, 256, 256, 38, 38), expectedReason: "qr_or_barcode_like" },
    { name: "barcode", image: barcodeFixture(), expectedReason: "qr_or_barcode_like" },
    { name: "english-text", image: glyphFixture("english"), expectedReason: "visible_text_or_brand_like" },
    { name: "chinese-like-text", image: glyphFixture("chinese"), expectedReason: "visible_text_or_brand_like" },
    { name: "garbled-text", image: glyphFixture("garbled"), expectedReason: "visible_text_or_brand_like" },
    { name: "logo", image: logoFixture(), expectedReason: "visible_text_or_brand_like" },
    { name: "watermark", image: watermarkFixture(), expectedReason: "interface_or_watermark_like" },
    { name: "bright-watermark", image: brightWatermarkFixture(), expectedReason: "interface_or_watermark_like" },
    { name: "corner-ui-badge", image: cornerUiBadgeFixture(), expectedReason: "interface_or_watermark_like" },
    { name: "ui", image: uiFixture(), expectedReason: "interface_or_watermark_like" },
    { name: "card-grid-ui", image: cardGridUiFixture(), expectedReason: "interface_or_watermark_like" },
    { name: "button-toolbar-ui", image: buttonToolbarUiFixture(), expectedReason: "interface_or_watermark_like" },
    { name: "bordered-dialog-ui", image: borderedDialogUiFixture(), expectedReason: "interface_or_watermark_like" }
  ];

  const negatives = [
    ...safeFixtures,
    ...safeFixtures.map((item) => ({ name: `${item.name}-scaled`, image: scaleRaster(item.image, 192, 192) })),
    ...safeFixtures.map((item) => ({ name: `${item.name}-low-contrast`, image: adjustContrast(item.image, 0.72) })),
    { name: "real-natural-corner-texture", image: PNG.sync.read(naturalCornerBytes) },
    { name: "real-natural-corner-texture-scaled", image: scaleRaster(PNG.sync.read(naturalCornerBytes), 192, 256) },
    { name: "real-natural-corner-texture-low-contrast", image: adjustContrast(PNG.sync.read(naturalCornerBytes), 0.72) },
    { name: "real-unlabelled-pump-bottles", image: PNG.sync.read(pumpBottleSafeBytes) },
    { name: "real-unlabelled-bottles-and-shelf", image: PNG.sync.read(uiLayoutSafeBytes) },
    { name: "real-blank-bottles-and-shelf", image: PNG.sync.read(blankBottleSafeBytes) },
    { name: "real-cotton-pads-and-tablecloth", image: PNG.sync.read(cottonPadsSafeBytes) },
    { name: "real-dense-blank-bottles-tray-window", image: PNG.sync.read(denseStillSafeBytes) },
    { name: "real-clear-water-bowl-towel-leaves", image: PNG.sync.read(by34QrSafeBytes) },
    { name: "real-clear-water-bowl-towel-leaves-low-contrast", image: adjustContrast(PNG.sync.read(by34QrSafeBytes), 0.72) },
    { name: "real-natural-bottles-towels-furniture", image: PNG.sync.read(by35NaturalStillSafeBytes) },
    { name: "real-warm-consultation-room-architectural-wood-slats", image: PNG.sync.read(by43WoodSlatsSafeBytes) },
    { name: "real-warm-consultation-room-architectural-wood-slats-scaled", image: scaleRaster(PNG.sync.read(by43WoodSlatsSafeBytes), 384, 512) },
    { name: "real-warm-consultation-room-curtain-window", image: PNG.sync.read(by43CurtainSafeBytes) },
    { name: "real-warm-consultation-room-curtain-window-scaled", image: scaleRaster(PNG.sync.read(by43CurtainSafeBytes), 384, 512) }
  ];
  const positives = [
    ...riskyFixtures,
    ...riskyFixtures.map((item) => ({ name: `${item.name}-scaled`, image: scaleRaster(item.image, 192, 192) })),
    ...riskyFixtures.map((item) => ({ name: `${item.name}-rotated`, image: rotateRaster(item.image, 3) })),
    ...riskyFixtures.map((item) => ({ name: `${item.name}-low-contrast`, image: adjustContrast(item.image, 0.62) })),
    { name: "real-person-plus-fake-label-risk", image: PNG.sync.read(personRiskBytes) },
    { name: "real-product-ui-screenshot", image: PNG.sync.read(realUiBytes) },
    { name: "real-visible-display-text", image: PNG.sync.read(by34VisibleTextRiskBytes) },
    { name: "real-low-contrast-top-display-text", image: PNG.sync.read(by35TopTextRiskBytes) },
    { name: "real-handheld-smartphone-engagement", image: PNG.sync.read(by35EngagementDeviceRiskBytes) }
    ,{ name: "real-connected-top-display-text", image: PNG.sync.read(by35VisibleChineseRiskBytes) }
  ];

  const falsePositives: Array<{ name: string; verdict: Verdict }> = [];
  for (const fixture of negatives) { const verdict = assess(PNG.sync.write(fixture.image)); if (verdict.status !== "passed") falsePositives.push({ name: fixture.name, verdict }); }
  const falseNegatives: Array<{ name: string; verdict: Verdict }> = [];
  for (const fixture of riskyFixtures) {
    const verdict = assess(PNG.sync.write(fixture.image));
    assert.ok(verdict.reasons.includes(fixture.expectedReason), `${fixture.name} must preserve the ${fixture.expectedReason} hard failure: ${JSON.stringify(verdict)}`);
  }
  const qrVerdict = assess(PNG.sync.write(riskyFixtures[0]!.image));
  assert.ok(qrVerdict.evidence?.some((item) => item.detectorType === "qr_finder_pattern" && item.decision === "rejected"), `synthetic QR must retain explicit finder-pattern evidence: ${JSON.stringify(qrVerdict)}`);
  for (const fixture of positives) {
    const result = assess(PNG.sync.write(fixture.image));
    if (result.status !== "rejected") falseNegatives.push({ name: fixture.name, verdict: result });
    else assertEvidence(result);
  }
  assert.deepEqual(falsePositives, [], `precision regressions: ${JSON.stringify(falsePositives)}`);
  assert.deepEqual(falseNegatives, [], `recall regressions: ${JSON.stringify(falseNegatives)}`);
  const uncertain = assess(PNG.sync.write(ambiguousGlyphFixture()));
  assert.equal(uncertain.status, "manual_review_required", `uncertain local evidence must not become an unsupported violation or customer PASS: ${JSON.stringify(uncertain)}`);
  assert.ok(uncertain.evidence?.every((item) => item.detectorType && typeof item.confidence === "number"));
  const precision = negatives.length / (negatives.length + falsePositives.length);
  const recall = (positives.length - falseNegatives.length) / positives.length;
  assert.equal(precision, 1);
  assert.equal(recall, 1);
  process.stdout.write(`beauty_image_quality_precision_p1_smoke=PASS;detector=beauty-image-safety-v2.16;champions=v2.1_edge_sequence,v2.2_ui_layout,v2.3_blank_bottles,v2.4_cotton_pads,v2.5_dense_still_ui,v2.6_qr_false_positive,v2.7_visible_text_false_negative,v2.8_top_text_false_negative,v2.9_natural_still_false_positive,v2.10_person_device_missing,v2.11_connected_top_text_missing,v2.12_barcode_density,v2.14_architectural_stripes,v2.15_curtain_stripes;challengers=panel_grid_occupancy,minimum_average_qr_finder_pattern_agreement,high_confidence_top_display_text_candidate_selection,high_density_top_stroke_band_fallback,minimum_explicit_text_structure_agreement,bright_neutral_screen_dark_frame_skin_proximity,connected_top_display_text_block_evidence,minimum_barcode_edge_group_density,minimum_barcode_edge_interval_variation,encoded_stripe_boundary_evidence;safe_actual=PASS;by34_qr_safe=PASS;by34_visible_text_risk=REJECT;by35_top_text_risk=REJECT;by35_natural_still=PASS;by35_engagement_device=REJECT_EXPLICIT;by35_visible_chinese=REJECT_EXPLICIT;pump_bottles=PASS;natural_shelf=PASS;blank_bottles=PASS;cotton_pads=PASS;dense_still=PASS;bad_actual=REJECT;person_risk=REJECT;real_ui=REJECT;manual_review_fixture=PASS;negative_cases=${negatives.length};positive_cases=${positives.length};precision=${precision.toFixed(3)};recall=${recall.toFixed(3)};provider_calls=0\n`);
}

function assess(bytes: Buffer): Verdict { return assessBeautyImageSafety(bytes, { contentType: "image/png" }) as Verdict; }
function assertEvidence(result: Verdict) {
  assert.ok(result.evidence?.length, `risk verdict lacks local evidence: ${JSON.stringify(result)}`);
  for (const item of result.evidence ?? []) {
    assert.ok(item.detectorType);
    assert.ok(typeof item.confidence === "number" && item.confidence >= 0 && item.confidence <= 1);
    assert.ok(item.bbox && Object.values(item.bbox).every((value) => Number.isFinite(value) && value >= 0));
    assert.ok(item.metrics && Object.keys(item.metrics).length > 0);
  }
}

function blank(width = 256, height = 256, value = 242): Raster { const image = new PNG({ width, height }); for (let i = 0; i < image.data.length; i += 4) { image.data[i] = value; image.data[i + 1] = value; image.data[i + 2] = value; image.data[i + 3] = 255; } return image; }
function pixel(image: Raster, x: number, y: number, value: number) { if (x < 0 || y < 0 || x >= image.width || y >= image.height) return; const offset = (Math.floor(y) * image.width + Math.floor(x)) * 4; image.data[offset] = value; image.data[offset + 1] = value; image.data[offset + 2] = value; image.data[offset + 3] = 255; }
function rect(image: Raster, x: number, y: number, width: number, height: number, value: number) { for (let py = y; py < y + height; py += 1) for (let px = x; px < x + width; px += 1) pixel(image, px, py, value); }
function line(image: Raster, x1: number, y1: number, x2: number, y2: number, value: number, thickness = 2) { const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1); for (let step = 0; step <= steps; step += 1) { const x = Math.round(x1 + (x2 - x1) * step / steps); const y = Math.round(y1 + (y2 - y1) * step / steps); rect(image, x, y, thickness, thickness, value); } }
function blankLabelBottles(): Raster { const image = blank(); rect(image, 38, 54, 58, 150, 190); rect(image, 46, 91, 42, 64, 228); rect(image, 48, 28, 38, 34, 168); rect(image, 132, 88, 78, 116, 202); rect(image, 141, 118, 60, 52, 231); return image; }
function rectangularBlocks(): Raster { const image = blank(); rect(image, 24, 35, 90, 70, 214); rect(image, 138, 38, 76, 64, 225); rect(image, 30, 142, 182, 52, 207); return image; }
function naturalHighlights(): Raster { const image = blank(); for (let y = 0; y < 256; y += 1) for (let x = 0; x < 256; x += 1) { const d1 = Math.hypot(x - 84, y - 120); const d2 = Math.hypot(x - 174, y - 112); pixel(image, x, y, Math.round(Math.max(150, Math.min(250, 220 + 28 * Math.cos(d1 / 18) + 17 * Math.cos(d2 / 25))))); } return image; }
function bottlesOnShelfFixture(): Raster { const image = blank(); rect(image, 18, 196, 220, 8, 154); for (let index = 0; index < 4; index += 1) { const x = 34 + index * 51; rect(image, x, 76 + index % 2 * 8, 28, 116 - index % 2 * 8, 198); rect(image, x + 5, 58 + index % 2 * 8, 18, 22, 176); } return image; }
function buildingLinesFixture(): Raster { const image = blank(); line(image, 24, 218, 228, 218, 170, 3); line(image, 45, 34, 45, 218, 180, 3); line(image, 126, 48, 126, 218, 186, 3); line(image, 210, 28, 210, 218, 178, 3); line(image, 24, 112, 228, 112, 194, 3); return image; }
function placeOnCanvas(source: Raster, width: number, height: number, offsetX: number, offsetY: number): Raster { const image = blank(width, height); for (let y = 0; y < source.height && y + offsetY < height; y += 1) for (let x = 0; x < source.width && x + offsetX < width; x += 1) { const sourceOffset = (y * source.width + x) * 4; const value = source.data[sourceOffset]!; pixel(image, x + offsetX, y + offsetY, value); } return image; }
function barcodeFixture(): Raster { const image = blank(); rect(image, 32, 58, 192, 142, 252); let x = 49; const widths = [2, 5, 2, 3, 6, 2, 4, 2, 7, 3, 2, 5, 3, 2, 6, 2, 4, 3, 2, 5]; for (const width of widths) { rect(image, x, 74, width, 100, 18); x += width + 3; } return image; }
const LATIN = ["11101", "00100", "00100", "00100", "00100", "00100", "00100"];
const HAN = ["10101", "11111", "00100", "11111", "10101", "10101", "11111"];
const GARBLED = ["11011", "01010", "11111", "10001", "01110", "10101", "11011"];
function glyphFixture(kind: "english" | "chinese" | "garbled"): Raster { const image = blank(); const glyph = kind === "english" ? LATIN : kind === "chinese" ? HAN : GARBLED; for (let index = 0; index < 6; index += 1) drawGlyph(image, 34 + index * 31, 104 + (index % 2), glyph, 4); return image; }
function ambiguousGlyphFixture(): Raster { const image = blank(); [90, 96, 102].forEach((y, index) => drawGlyph(image, 50 + index * 42, y, LATIN, 4)); return image; }
function drawGlyph(image: Raster, x: number, y: number, rows: string[], scale: number) { for (let gy = 0; gy < rows.length; gy += 1) for (let gx = 0; gx < rows[gy]!.length; gx += 1) if (rows[gy]![gx] === "1") rect(image, x + gx * scale, y + gy * scale, scale, scale, 18); }
function logoFixture(): Raster { const image = blank(); for (let angle = 0; angle < 360; angle += 2) pixel(image, 92 + Math.cos(angle * Math.PI / 180) * 26, 126 + Math.sin(angle * Math.PI / 180) * 26, 20); for (let i = 0; i < 4; i += 1) drawGlyph(image, 128 + i * 24, 110, i % 2 ? HAN : LATIN, 3); return image; }
function watermarkFixture(): Raster { const image = naturalHighlights(); for (let index = 0; index < 5; index += 1) drawGlyph(image, 112 + index * 24, 210, index % 2 ? HAN : LATIN, 3); return image; }
function brightWatermarkFixture(): Raster { const image = blank(256, 256, 72); for (let index = 0; index < 5; index += 1) drawBrightGlyph(image, 112 + index * 24, 210, index % 2 ? HAN : LATIN, 3); return image; }
function cornerUiBadgeFixture(): Raster { const image = naturalHighlights(); rect(image, 112, 205, 132, 40, 248); rect(image, 112, 205, 132, 2, 26); rect(image, 112, 243, 132, 2, 26); for (let index = 0; index < 4; index += 1) drawGlyph(image, 126 + index * 26, 213, index % 2 ? HAN : LATIN, 3); return image; }
function uiFixture(): Raster { const image = blank(); rect(image, 26, 24, 204, 208, 250); for (let row = 0; row < 3; row += 1) { rect(image, 42, 48 + row * 55, 78, 40, 218); rect(image, 133, 48 + row * 55, 78, 40, 228); line(image, 49, 58 + row * 55, 104, 58 + row * 55, 30, 3); line(image, 140, 58 + row * 55, 196, 58 + row * 55, 30, 3); rect(image, 49, 70 + row * 55, 48, 7, 80); rect(image, 140, 70 + row * 55, 52, 7, 80); } return image; }
function cardGridUiFixture(): Raster { const image = blank(); for (let row = 0; row < 3; row += 1) for (let column = 0; column < 2; column += 1) { const x = 24 + column * 112; const y = 22 + row * 76; rect(image, x, y, 96, 62, 250); line(image, x, y, x + 96, y, 30, 2); line(image, x, y + 62, x + 96, y + 62, 30, 2); line(image, x, y, x, y + 62, 30, 2); line(image, x + 96, y, x + 96, y + 62, 30, 2); rect(image, x + 10, y + 12, 58, 7, 55); rect(image, x + 10, y + 31, 72, 5, 92); } return image; }
function buttonToolbarUiFixture(): Raster { const image = blank(); rect(image, 18, 20, 220, 32, 220); for (let index = 0; index < 5; index += 1) { const x = 26 + index * 42; rect(image, x, 27, 34, 18, index % 2 ? 44 : 72); } for (let row = 0; row < 4; row += 1) { rect(image, 26, 74 + row * 40, 204, 30, 248); line(image, 26, 74 + row * 40, 230, 74 + row * 40, 55, 2); rect(image, 38, 84 + row * 40, 88, 6, 75); rect(image, 174, 80 + row * 40, 42, 16, 90); } return image; }
function borderedDialogUiFixture(): Raster { const image = cardGridUiFixture(); line(image, 12, 10, 244, 10, 24, 3); line(image, 12, 246, 244, 246, 24, 3); line(image, 12, 10, 12, 246, 24, 3); line(image, 244, 10, 244, 246, 24, 3); rect(image, 86, 218, 84, 20, 54); return image; }
function scaleRaster(source: Raster, width: number, height: number): Raster { const image = blank(width, height); for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) { const sx = Math.min(source.width - 1, Math.floor(x * source.width / width)); const sy = Math.min(source.height - 1, Math.floor(y * source.height / height)); pixel(image, x, y, source.data[(sy * source.width + sx) * 4]!); } return image; }
function rotateRaster(source: Raster, degrees: number): Raster { const image = blank(source.width, source.height); const radians = degrees * Math.PI / 180; const cx = (source.width - 1) / 2; const cy = (source.height - 1) / 2; for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) { const dx = x - cx; const dy = y - cy; const sx = Math.round(cx + dx * Math.cos(-radians) - dy * Math.sin(-radians)); const sy = Math.round(cy + dx * Math.sin(-radians) + dy * Math.cos(-radians)); if (sx >= 0 && sy >= 0 && sx < source.width && sy < source.height) pixel(image, x, y, source.data[(sy * source.width + sx) * 4]!); } return image; }
function adjustContrast(source: Raster, factor: number): Raster { const image = blank(source.width, source.height); for (let y = 0; y < source.height; y += 1) for (let x = 0; x < source.width; x += 1) { const value = source.data[(y * source.width + x) * 4]!; pixel(image, x, y, Math.max(0, Math.min(255, Math.round(128 + (value - 128) * factor)))); } return image; }
function drawBrightGlyph(image: Raster, x: number, y: number, rows: string[], scale: number) { for (let gy = 0; gy < rows.length; gy += 1) for (let gx = 0; gx < rows[gy]!.length; gx += 1) if (rows[gy]![gx] === "1") rect(image, x + gx * scale, y + gy * scale, scale, scale, 245); }

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
