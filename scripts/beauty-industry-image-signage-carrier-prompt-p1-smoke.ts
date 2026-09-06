import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  BEAUTY_IMAGE_PROVIDER_PROMPT_VERSION,
  buildBeautyImageProviderInput,
  type BeautyImageDirection,
  type BeautyImageRole
} from "../apps/api/src/products/beauty-industry/media-contract.js";

const fixture = JSON.parse(readFileSync("scripts/fixtures/beauty-image-signage-surface-prompt-champion-v2.json", "utf8")) as {
  version: string;
  sourceEvidence: Array<{ assetSha256: string; role: BeautyImageRole; qualityReasons: string[]; operatorFinding: string }>;
  champion: { providerPromptVersion: string; promptHashes: Record<BeautyImageRole, string>; rootCause: string };
  challenger: { providerPromptVersion: string; singleVariable: string; requiredPromptConcepts: string[]; requiredNegativeConcepts: string[] };
};

assert.equal(fixture.version, "beauty-image-signage-surface-prompt-champion-v2");
assert.deepEqual(fixture.sourceEvidence.map((item) => item.assetSha256), [
  "13211c9d3886a53cebd78a6080e6fb475766a696104b42127a1ddf241c93144b"
]);
assert.ok(fixture.sourceEvidence.every((item) => item.role === "cover" && item.qualityReasons.length > 0));
assert.equal(fixture.champion.rootCause, "negative_object_ban_without_empty_surface_or_counter_free_positive_composition");
assert.equal(fixture.challenger.singleVariable, "empty_horizontal_surface_composition");

const roles: BeautyImageRole[] = ["cover", "content", "engagement"];
const directions = roles.map((role, index): BeautyImageDirection => ({
  index,
  role,
  label: role,
  positivePrompt: "暖色高级美业门店空间，皮肤管理主题，商业摄影。",
  negativePrompt: "文字，Logo，二维码，水印，UI，未授权人物。"
}));
const inputs = directions.map((direction) => buildBeautyImageProviderInput(direction, {
  overallVisualRequirements: "暖色、干净、摄影感、高级美业门店空间",
  prohibitedContent: "文字、Logo、水印、二维码、价格、疗效"
}));

assert.equal(BEAUTY_IMAGE_PROVIDER_PROMPT_VERSION, fixture.challenger.providerPromptVersion);
assert.equal(new Set(inputs.map((input) => input.prompt)).size, 3, "role-specific art direction must remain distinct");
for (const input of inputs) {
  assert.equal(input.providerPromptVersion, fixture.challenger.providerPromptVersion);
  assert.doesNotMatch(input.prompt, /[\u3400-\u9fff]/u, "Provider prompt must remain English-only");
  assert.doesNotMatch(input.negativePrompt, /[\u3400-\u9fff]/u, "negative prompt must remain English-only");
  for (const concept of fixture.challenger.requiredPromptConcepts) assert.ok(input.prompt.toLowerCase().includes(concept), `missing prompt concept: ${concept}`);
  for (const concept of fixture.challenger.requiredNegativeConcepts) assert.ok(input.negativePrompt.toLowerCase().includes(concept), `missing negative concept: ${concept}`);
  assert.match(input.prompt, /commercial|editorial|photograph/i);
  assert.match(input.prompt, /realistic lighting|natural daylight|material/i);
  assert.match(input.negativePrompt, /text|logo|QR code|watermark|interface/i);
  assert.doesNotMatch(input.negativePrompt, /(?:^|,\s*)table(?:,|$)/i, "a role-required empty furniture table must not conflict with the negative prompt");
}
assert.match(inputs[2]!.prompt, /small round table/i, "engagement must retain its distinct consultation-lounge role");

assert.deepEqual(fixture.champion.promptHashes, {
  cover: "47e78624ba0c121069747bd9b2c856e7f9fbe0b7b7e4e8c76b9f75c810f966f1",
  content: "bdc5c9d716f486046a08fb857aa392401c66b16debdc1c06c208c3cbd3196745",
  engagement: "365f2d4a28e89d6ddd106896f1466695d1a2555757b4682c48c5a1af042226d1"
});
const challengerHashes = Object.fromEntries(roles.map((role, index) => [
  role,
  createHash("sha256").update(JSON.stringify(inputs[index])).digest("hex")
]));
assert.ok(roles.every((role) => challengerHashes[role] !== fixture.champion.promptHashes[role]), "the single composition variable must change every role payload");

console.log(`beauty_image_signage_carrier_prompt_p1_smoke=PASS;champion=${fixture.champion.providerPromptVersion};challenger=${BEAUTY_IMAGE_PROVIDER_PROMPT_VERSION};roles=3;source_failures=1;provider_calls=0;network=0`);
