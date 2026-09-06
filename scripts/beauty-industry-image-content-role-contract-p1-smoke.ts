import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { assessBeautyContentRoleContract, assessBeautyImageQualityForRole } from "../apps/api/src/products/beauty-industry/media-contract.js";

const collagePath = process.env.BEAUTY_IMAGE_BY38_COLLAGE_ASSET;
const packagingPath = process.env.BEAUTY_IMAGE_BY38_PACKAGING_ASSET;
const safeScenePath = process.env.BEAUTY_IMAGE_BY38_SAFE_SCENE_ASSET;

async function main(): Promise<void> {
  assert.ok(collagePath, "BEAUTY_IMAGE_BY38_COLLAGE_ASSET is required");
  assert.ok(packagingPath, "BEAUTY_IMAGE_BY38_PACKAGING_ASSET is required");
  assert.ok(safeScenePath, "BEAUTY_IMAGE_BY38_SAFE_SCENE_ASSET is required");
  const [collageBytes, packagingBytes, safeSceneBytes] = await Promise.all([readFile(collagePath), readFile(packagingPath), readFile(safeScenePath)]);
  const receipt = JSON.parse(await readFile(new URL("./fixtures/beauty-image-content-role-contract-v1-boundary.json", import.meta.url), "utf8")) as {
    contractVersion: string;
    cases: Array<{ sha256: string; expectedStatus: string; expectedReason: string }>;
    localBoundary: { packagingBottleContainerLabelBrandCarrierSemantics: string; customerDeliveryWhenSemanticsUnverified: string };
  };
  assert.equal(receipt.contractVersion, "beauty-image-content-role-contract-v1");
  assert.equal(receipt.localBoundary.packagingBottleContainerLabelBrandCarrierSemantics, "unsupported_locally");
  assert.equal(receipt.localBoundary.customerDeliveryWhenSemanticsUnverified, "fail_closed");
  assert.equal(createHash("sha256").update(collageBytes).digest("hex"), "e9af2a0eebd361b634b35110a2acd3a5a31870e01e84273f2a1f2e929022a803");
  assert.equal(createHash("sha256").update(packagingBytes).digest("hex"), "9f217ea59c4dda4682bab1810bf5f38bbcc633a76e337f034fac66d286bbc2e1");
  assert.equal(createHash("sha256").update(safeSceneBytes).digest("hex"), "60f2ea68d251cbfe2e0fc49119f3ee4e44222c94c826b8aa692a6af09868bb8d");
  for (const expected of receipt.cases) assert.ok([
    createHash("sha256").update(collageBytes).digest("hex"),
    createHash("sha256").update(packagingBytes).digest("hex"),
    createHash("sha256").update(safeSceneBytes).digest("hex")
  ].includes(expected.sha256));

  const collage = assessBeautyContentRoleContract(collageBytes, { contentType: "image/png" });
  assert.equal(collage.status, "rejected", JSON.stringify(collage));
  assert.ok(collage.reasons.includes("multi_panel_layout"), JSON.stringify(collage));
  assert.equal(collage.semanticChecks.packagingCarrier, "unsupported_locally");
  const collageDelivery = assessBeautyImageQualityForRole(collageBytes, { contentType: "image/png", role: "content" });
  assert.equal(collageDelivery.status, "rejected", JSON.stringify(collageDelivery));
  assert.ok(collageDelivery.reasons.includes("multi_panel_layout"), JSON.stringify(collageDelivery));

  const packaging = assessBeautyContentRoleContract(packagingBytes, { contentType: "image/png" });
  assert.equal(packaging.status, "manual_review_required", JSON.stringify(packaging));
  assert.ok(packaging.reasons.includes("content_semantics_unverified"), JSON.stringify(packaging));
  assert.equal(packaging.semanticChecks.packagingCarrier, "unsupported_locally");
  const packagingDelivery = assessBeautyImageQualityForRole(packagingBytes, { contentType: "image/png", role: "content" });
  assert.notEqual(packagingDelivery.status, "passed", "historical packaging/label carrier must remain fail-closed");

  const safeScene = assessBeautyContentRoleContract(safeSceneBytes, { contentType: "image/png" });
  assert.equal(safeScene.status, "manual_review_required", JSON.stringify(safeScene));
  assert.equal(safeScene.layoutChecks.singleScene, true);
  assert.equal(safeScene.semanticChecks.packagingCarrier, "unsupported_locally");
  assert.equal(safeScene.boundary, "deterministic_layout_only_no_object_semantics");
  const safeSceneDelivery = assessBeautyImageQualityForRole(safeSceneBytes, { contentType: "image/png", role: "content" });
  assert.equal(safeSceneDelivery.status, "manual_review_required", "a visually simple scene cannot be auto-delivered while object semantics remain unverified locally");

  process.stdout.write("beauty_image_content_role_contract_p1_smoke=PASS;collage=REJECT;packaging=MANUAL_REVIEW;safe_scene=MANUAL_REVIEW;semantic_boundary=UNSUPPORTED_LOCALLY;provider_calls=0\n");
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
