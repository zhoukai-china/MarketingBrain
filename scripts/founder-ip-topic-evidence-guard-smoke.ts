import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assessFounderIpTopicEvidence,
  assertFounderIpTopicContextMatchesBrief,
  validateFounderIpTopicDelivery
} from "../apps/api/src/services/founder-ip-topic-evidence.ts";

const routeSource = readFileSync(new URL("../apps/api/src/routes/agents.ts", import.meta.url), "utf8");
const topicSource = readFileSync(new URL("../apps/web/src/components/acquisition/TopicSystemWorkbench.tsx", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../apps/web/src/main.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../apps/web/src/pages/AgentProductsApp.tsx", import.meta.url), "utf8");

assert.match(routeSource, /assessFounderIpTopicEvidence/, "FIP topic runs must use the product evidence guard");
assert.match(routeSource, /const topicContext = parsed\.data\.founderIpTopicContext/, "FIP topic runs must require structured goal context");
assert.match(routeSource, /topicSourceSelection:\s*parsed\.data\.topicSourceSelection/, "topic source toggles must participate in request idempotency");
assert.match(routeSource, /isRequestedFounderIpTopicRun[\s\S]*!Object\.values\(parsed\.data\.topicSourceSelection\)\.some\(Boolean\)/, "an explicit FIP topic request with every source disabled must fail before Provider execution");
assert.match(routeSource, /founderIpTopicBrief = await loadFounderIpGoalBrief\(runtimeContext, topicContext\.subjectId, topicContext\.target\)/, "FIP topic runs must reload the authoritative saved goal brief");
assert.match(routeSource, /persist:\s*!isAutomaticTopicRun/, "FIP topic output must be validated before persistence and billing");
assert.match(routeSource, /validateFounderIpTopicDelivery/, "FIP topic output must pass the target and evidence delivery gate");

assert.match(topicSource, /confirmed:\s*boolean/, "recording candidates must expose their confirmed state");
assert.match(topicSource, /isQualifiedFounderIpTranscript/, "the workbench must not auto-select unconfirmed or irrelevant recordings");
assert.match(topicSource, /localFixture/, "the FIP local fixture must explicitly lock external and model actions");
assert.match(topicSource, /本机合成验收数据/, "synthetic data must be visibly labelled on the destination page");
assert.match(mainSource, /本机合成验收数据/, "the local fixture must use a persistent synthetic-data label");
assert.match(mainSource, /美业加盟/, "the franchise acceptance fixture must be internally consistent with the beauty franchise goal");
assert.match(appSource, /founderIpTopicContext/, "the client must send structured target context instead of relying on prompt parsing");

const beautyBrief = {
  subjectId: "subject-beauty",
  target: "franchise" as const,
  identity: "问题肌品牌创始人",
  targetCustomer: "10万预算的美业从业者",
  acquisitionGoal: "获取加盟咨询",
  offer: "问题肌加盟项目",
  accountStage: "稳定更新期",
  industry: "美业问题肌",
  benchmarkAccounts: []
};
const aiBrief = {
  ...beautyBrief,
  subjectId: "subject-ai",
  identity: "企业AI咨询创始人",
  targetCustomer: "准备做AI改造的企业负责人",
  offer: "企业AI咨询项目",
  industry: "企业AI咨询"
};
const aiRecording = {
  id: "recording-ai",
  title: "企业AI工具采购复盘",
  content: "企业AI改造先做流程诊断，再考虑采购AI工具。",
  documentType: "transcript",
  confirmedAt: new Date("2026-08-21T00:00:00Z"),
  industry: "企业AI咨询",
  sensitivity: "normal",
  subjectIds: ["subject-beauty", "subject-ai"]
};
const beautyRecording = {
  id: "recording-beauty",
  title: "问题肌门店加盟访谈",
  content: "美业加盟商先核对问题肌客群、服务边界与门店运营支持。",
  documentType: "transcript",
  confirmedAt: new Date("2026-08-21T00:00:00Z"),
  industry: "美业问题肌",
  sensitivity: "normal",
  subjectIds: ["subject-beauty"]
};
const sources = { industry: false, benchmark: false, transcript: true, videoReview: false };

const noSources = assessFounderIpTopicEvidence({
  brief: beautyBrief,
  subjectId: beautyBrief.subjectId,
  documents: [beautyRecording],
  sourceSelection: { industry: false, benchmark: false, transcript: false, videoReview: false }
});
assert.equal(noSources.canGenerate, false, "disabling all four sources must fail closed even when unrelated automatic documents exist");

const unconfirmed = assessFounderIpTopicEvidence({
  brief: beautyBrief,
  subjectId: beautyBrief.subjectId,
  documents: [{ ...aiRecording, confirmedAt: null, industry: null }],
  sourceSelection: sources
});
assert.equal(unconfirmed.canGenerate, false, "unconfirmed low-relevance recordings must not generate TOP10");
assert.equal(unconfirmed.rejectedDocuments[0]?.reason, "unconfirmed");

const beautyWithAi = assessFounderIpTopicEvidence({ brief: beautyBrief, subjectId: beautyBrief.subjectId, documents: [aiRecording], sourceSelection: sources });
assert.equal(beautyWithAi.canGenerate, false, "beauty franchise must reject enterprise-AI evidence");
assert.equal(beautyWithAi.rejectedDocuments[0]?.reason, "industry_mismatch");

const beautyWithBeauty = assessFounderIpTopicEvidence({ brief: beautyBrief, subjectId: beautyBrief.subjectId, documents: [beautyRecording], sourceSelection: sources });
assert.equal(beautyWithBeauty.canGenerate, true, "confirmed beauty franchise evidence should be eligible");

const aiWithAi = assessFounderIpTopicEvidence({ brief: aiBrief, subjectId: aiBrief.subjectId, documents: [aiRecording], sourceSelection: sources });
assert.equal(aiWithAi.canGenerate, true, "the same AI evidence should remain eligible for an AI-consulting project");

const wrongSubject = assessFounderIpTopicEvidence({ brief: beautyBrief, subjectId: "subject-other", documents: [beautyRecording], sourceSelection: sources });
assert.equal(wrongSubject.canGenerate, false, "draft/source/subject isolation must fail closed");
assert.equal(wrongSubject.rejectedDocuments[0]?.reason, "wrong_subject");

assert.throws(
  () => assertFounderIpTopicContextMatchesBrief({ ...beautyBrief, target: "student" }, beautyBrief),
  /获客目标简报已变化/,
  "switching target/project must invalidate stale topic context"
);

function table(topic: (index: number) => string, evidence: string): string {
  return [
    "## 三关筛选后的TOP10",
    "| 序号 | 选题/钩子 | 目标人群 | 核心观点/内容角度 | 来源依据 | 与获客目标的关系 | 下一步生成内容 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...Array.from({ length: 10 }, (_, index) => `| ${index + 1} | ${topic(index)} | 10万预算的美业从业者 | 美业问题肌加盟条件核对 | ${evidence} | 帮助美业加盟商发起加盟咨询 | 生成口播草稿 |`),
    "## 待验证动作与证据边界"
  ].join("\n");
}

const badDelivery = validateFounderIpTopicDelivery({
  answer: table((index) => `企业AI改造工具清单${index + 1}`, "AI录音卡"),
  brief: beautyBrief,
  evidence: beautyWithBeauty
});
assert.equal(badDelivery.ok, false, "generic AI topics must fail the beauty-franchise final delivery gate");

const goodDelivery = validateFounderIpTopicDelivery({
  answer: table((index) => `美业问题肌加盟前要核对的条件${index + 1}`, "AI录音卡：已确认美业加盟访谈"),
  brief: beautyBrief,
  evidence: beautyWithBeauty
});
assert.equal(goodDelivery.ok, true, "beauty-franchise topics grounded in confirmed beauty evidence should pass");

console.log("founder_ip_topic_evidence_guard_smoke:PASS");
