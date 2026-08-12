import "dotenv/config";
import path from "node:path";
import { readClipPlan } from "../services/clip-planner.js";
import { renderRoughCutPlan } from "../services/clip-renderer.js";
import { listSupplementalAssets, matchAssetsToNeeds } from "../services/clip-assets.js";

const planId = process.argv[2];
if (!planId) throw new Error("Usage: tsx clip-plan-smoke.ts <planId>");
const plan = await readClipPlan(planId);
const sampleRoot = path.join(process.env.USERPROFILE ?? "", "Desktop", "张芷豪合作", "带货讲品");
const sourcePaths = Object.fromEntries([...new Set(plan.selected.map((segment) => segment.sourceId))].map((sourceId) => [sourceId, path.join(sampleRoot, sourceId)]));
const assets = await listSupplementalAssets(plan.assetNeeds);
const matches = matchAssetsToNeeds(plan.assetNeeds, assets);
const broll = matches.flatMap((match) => {
  if (!match.matchedAsset) return [];
  const asset = assets.find((item) => item.id === match.matchedAsset?.id);
  return asset ? [{
    assetPath: asset.localPath,
    assetType: asset.type,
    insertAfterSegmentId: match.insertAfterSegmentId,
    durationSeconds: match.durationSeconds,
    presentation: "fullscreen" as const
  }] : [];
});
const result = await renderRoughCutPlan({
  planId,
  segments: plan.selected,
  sourcePaths,
  broll
});
process.stdout.write(JSON.stringify(result, null, 2));
