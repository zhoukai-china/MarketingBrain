import "dotenv/config";
import path from "node:path";
import { buildClipRoughCutPlan } from "../services/clip-planner.js";
import { createRuntimeLlmProvider } from "../services/llm-provider-factory.js";

const sampleRoot = path.join(process.env.USERPROFILE ?? "", "Desktop", "张芷豪合作", "带货讲品");
const plan = await buildClipRoughCutPlan({
  sources: ["2.mp4", "3.mp4"].map((sourceId) => ({ sourceId, sourcePath: path.join(sampleRoot, sourceId) })),
  targetDurationSeconds: 60,
  template: "evidence_conversion",
  confirmedFacts: "商品为笨榨大豆油，净含量5升；价格、保险、赔付信息待人工核验。",
  personalAngle: "先展示真实产品证据，再说明规格、家庭使用场景和价格",
  provider: createRuntimeLlmProvider()
});

process.stdout.write(JSON.stringify({
  planId: plan.planId,
  analyzeMs: plan.analyzeMs,
  duration: plan.estimatedDurationSeconds,
  qualityFlags: plan.qualityFlags,
  selected: plan.selected.map((segment) => ({
    role: segment.role,
    highlightScore: segment.highlightScore,
    highlightTags: segment.highlightTags,
    transcript: segment.transcript
  }))
}, null, 2));
