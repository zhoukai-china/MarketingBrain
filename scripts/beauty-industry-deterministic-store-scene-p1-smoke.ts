import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import {
  BEAUTY_DETERMINISTIC_VISUAL_VERSION,
  generateBeautyDeterministicVisual
} from "../apps/api/src/services/beauty-deterministic-visual.js";
import type { BeautyImageRole } from "../apps/api/src/products/beauty-industry/media-contract.js";
import { assessBeautyDeterministicSceneRequirements } from "../apps/api/src/products/beauty-industry/media-batch.js";

const require = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PNG } = require("pngjs") as { PNG: { sync: { read(bytes: Buffer): { width: number; height: number; data: Buffer } } } };
const roles: BeautyImageRole[] = ["cover", "content", "engagement"];
const expectedScenes = ["reception_consultation", "treatment_room", "aftercare_consultation"];
const theme = {
  configVersion: "beauty-industry-brand-v1",
  tokenName: "beauty-default",
  primary: "#1F6B57",
  primaryDark: "#17352F",
  primaryLight: "#D9EEE7",
  surface: "#F7F5EF"
} as const;

async function main(): Promise<void> {
  for (const [index, role] of roles.entries()) {
    const generated = await generateBeautyDeterministicVisual({ role, taskSnapshotHash: "a".repeat(64), theme });
    const receipt = generated.receipt as typeof generated.receipt & { scenePolicy?: string; scene?: string; elementCount?: number };
    assert.equal(BEAUTY_DETERMINISTIC_VISUAL_VERSION, "beauty-deterministic-visual-v2");
    assert.equal(receipt.scenePolicy, "generic_beauty_store_non_reference");
    assert.equal(receipt.scene, expectedScenes[index]);
    assert.ok((receipt.elementCount ?? 0) >= 5, `${role} must contain identifiable store-scene elements`);
    assert.ok(edgeRatio(generated.bytes) >= 0.012, `${role} must not remain a smooth/blank gradient`);
  }

  const route = await readFile(new URL("../apps/api/src/routes/beauty-industry-media.ts", import.meta.url), "utf8");
  assert.match(route, /next\.provider === "local_deterministic"/u, "historical deterministic batches must remain recoverable");
  assert.match(route, /deliveryMode:\s*"real_provider_composed"/u, "new batches must use the real commercial-photo chain");

  const page = await readFile(new URL("../apps/web/src/components/acquisition/BeautyXhsWorkbench.tsx", import.meta.url), "utf8");
  assert.match(page, /商业摄影感配图/u);
  assert.match(page, /非本店实景/u);
  assert.match(page, /非本店实景、无人出镜/u);
  assert.doesNotMatch(page, /爱马仕/u);
  assert.deepEqual(assessBeautyDeterministicSceneRequirements({ overallVisualRequirements: "温暖干净的店内场景" }), { ok: true, scenePolicy: "generic_beauty_store_non_reference" });
  assert.equal(assessBeautyDeterministicSceneRequirements({ overallVisualRequirements: "还原我的门店实景" }).ok, false);
  assert.equal(assessBeautyDeterministicSceneRequirements({ overallVisualRequirements: "有顾客人物出镜" }).ok, false);

  console.log(JSON.stringify({ ok: true, version: BEAUTY_DETERMINISTIC_VISUAL_VERSION, roles, providerCalls: 0, externalCostYuan: 0 }));
}

function edgeRatio(bytes: Buffer): number {
  const decoded = PNG.sync.read(bytes);
  let edges = 0;
  let compared = 0;
  for (let y = 8; y < Math.min(decoded.height - 8, 760); y += 4) {
    for (let x = 8; x < decoded.width - 8; x += 4) {
      const center = luminance(decoded.data, decoded.width, x, y);
      const right = luminance(decoded.data, decoded.width, x + 4, y);
      const down = luminance(decoded.data, decoded.width, x, y + 4);
      if (Math.abs(center - right) >= 18 || Math.abs(center - down) >= 18) edges += 1;
      compared += 1;
    }
  }
  return compared ? edges / compared : 0;
}

function luminance(data: Buffer, width: number, x: number, y: number): number {
  const offset = (y * width + x) * 4;
  return data[offset]! * 0.299 + data[offset + 1]! * 0.587 + data[offset + 2]! * 0.114;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
