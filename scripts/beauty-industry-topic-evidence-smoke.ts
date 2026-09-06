import assert from "node:assert/strict";
import {
  evaluateBeautyTopicEvidence,
  type BeautyTopicWorkflowInput,
  type LoadedBeautyTopicDocument
} from "../apps/api/src/products/beauty-industry/topic-evidence.js";

const base: BeautyTopicWorkflowInput = {
  identity: "合成美业门店",
  targetCustomer: "附近关注日常皮肤护理的成年女性",
  acquisitionGoal: "获取到店咨询",
  offer: "基础补水护理",
  accountStage: "起号测试期",
  industry: "皮肤管理",
  benchmarkAccounts: [],
  transcriptDocumentIds: [],
  sourceSelection: { industry: true, benchmark: false, transcript: false, videoReview: false }
};

const transcript: LoadedBeautyTopicDocument = {
  id: "doc-qualified",
  title: "合成顾客常见问题",
  content: "顾客经常询问日常补水护理适合什么时间安排，不涉及疗效与价格承诺。",
  documentType: "transcript",
  confirmedAt: new Date("2026-08-25T00:00:00+08:00"),
  sensitivity: "normal",
  industry: "皮肤管理",
  usagePolicy: "recommend"
};

function evaluate(workflow: BeautyTopicWorkflowInput, documents: LoadedBeautyTopicDocument[] = [], videoReview: { id: string; output: string } | null = null) {
  return evaluateBeautyTopicEvidence({ profileIndustry: "皮肤管理", workflow, documents, videoReview });
}

assert.equal(evaluate(base).sourceCount, 1, "one confirmed industry source must be usable without inventing real-time hotspots");
assert.match(evaluate(base).directive, /不得写成实时热点|待补|待核验/);

const twoSources = { ...base, benchmarkAccounts: ["合成对标账号"], sourceSelection: { ...base.sourceSelection, benchmark: true } };
assert.equal(evaluate(twoSources).sourceCount, 2, "user-provided benchmark leads must remain explicitly unverified");
assert.match(evaluate(twoSources).directive, /尚未读取到可回溯作品与互动证据/);

const threeSources = {
  ...twoSources,
  transcriptDocumentIds: [transcript.id],
  sourceSelection: { ...twoSources.sourceSelection, transcript: true }
};
assert.equal(evaluate(threeSources, [transcript]).sourceCount, 3, "confirmed tenant transcript may become the third source");

const fourSources = {
  ...threeSources,
  videoReviewId: "review-qualified",
  sourceSelection: { ...threeSources.sourceSelection, videoReview: true }
};
const fourResult = evaluate(fourSources, [transcript], { id: "review-qualified", output: "播放、完播、互动字段均来自已解析合成数据。" });
assert.equal(fourResult.sourceCount, 4);
assert.equal(fourResult.videoReviewId, "review-qualified");

assert.throws(
  () => evaluate({ ...base, sourceSelection: { industry: false, benchmark: false, transcript: false, videoReview: false } }),
  /beauty_topic_sources_missing/,
  "all four sources disabled must fail before Provider"
);

const sensitive = { ...transcript, id: "doc-sensitive", sensitivity: "sensitive" };
assert.throws(
  () => evaluate({
    ...base,
    transcriptDocumentIds: [sensitive.id],
    sourceSelection: { industry: false, benchmark: false, transcript: true, videoReview: false }
  }, [sensitive]),
  /beauty_topic_sources_missing/,
  "sensitive-only evidence must fail before Provider"
);

console.log("beauty_industry_topic_evidence_smoke:PASS");
