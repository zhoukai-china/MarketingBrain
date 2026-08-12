import assert from "node:assert/strict";
import {
  analyzeDailyQuality,
  reviewAgentRun,
  sanitizeLearningInput,
  type QualityRunInput
} from "../apps/api/src/services/continuous-improvement.js";
import { feedbackSchema, outcomeSchema } from "../apps/api/src/routes/feedback.js";

const start = new Date("2026-08-09T16:00:00.000Z");
const end = new Date("2026-08-10T16:00:00.000Z");

const goodRun: QualityRunInput = {
  id: "run-good",
  agentId: "agent-growth",
  skillId: "growth-plan",
  skillVersion: "1.0.0",
  status: "succeeded",
  input: "请给我一份增长计划",
  output: "这是结构完整且有依据的计划",
  createdAt: start,
  feedback: [{ rating: 5 }],
  outcomeEvents: [{ eventType: "task_completed" }, { eventType: "continued" }]
};

const rejectedRun: QualityRunInput = {
  ...goodRun,
  id: "run-rejected-1",
  input: "手机号13800138000，邮箱owner@example.com，token=abc123，请分析",
  feedback: [{ rating: 1, issueType: "incorrect" }],
  outcomeEvents: [{ eventType: "regenerated" }, { eventType: "abandoned" }]
};

const secondRejectedRun: QualityRunInput = {
  ...rejectedRun,
  id: "run-rejected-2"
};

const criticalRun: QualityRunInput = {
  ...goodRun,
  id: "run-critical",
  qualityFlags: ["cross_tenant_data_leak"],
  feedback: [{ rating: 5 }]
};

const goodReview = reviewAgentRun(goodRun);
const rejectedReview = reviewAgentRun(rejectedRun);
const criticalReview = reviewAgentRun(criticalRun);

assert.ok(goodReview.overallScore >= 80, "successful task with strong feedback should score positively");
assert.ok(rejectedReview.overallScore < goodReview.overallScore, "negative feedback and abandonment must lower score");
assert.equal(criticalReview.hardGatePassed, false, "cross-tenant signal must fail the hard gate");
assert.ok(criticalReview.overallScore <= 39, "positive feedback must never hide a hard-gate failure");

const sanitized = sanitizeLearningInput(rejectedRun.input);
assert.ok(!sanitized.includes("13800138000"), "phone number must be removed from learned eval input");
assert.ok(!sanitized.includes("owner@example.com"), "email must be removed from learned eval input");
assert.ok(!sanitized.includes("abc123"), "token value must be removed from learned eval input");

const analysis = analyzeDailyQuality({
  runs: [goodRun, rejectedRun, secondRejectedRun, criticalRun],
  periodStart: start,
  periodEnd: end,
  minimumRunSample: 3
});

const rejectionCluster = analysis.clusters.find((item) => item.category === "user_rejection");
assert.equal(rejectionCluster?.occurrenceCount, 2, "same failure category should form a recurring cluster");
assert.ok(analysis.candidates.length >= 2, "recurring and critical failures should create review candidates");
assert.ok(
  analysis.candidates.every(
    (item) => item.requiresHumanApproval && item.status === "awaiting_review" && item.proposedChange.autoActivate === false
  ),
  "generated candidates must never auto-activate"
);
assert.ok(analysis.evalDrafts.length >= 2, "eligible failure clusters should create draft regression cases");
assert.equal(
  analysis.clusters.some((item) => item.sampleRunIds.includes(goodRun.id)),
  false,
  "healthy run must not be placed in a failure cluster"
);

const insufficientSample = analyzeDailyQuality({
  runs: [rejectedRun],
  periodStart: start,
  periodEnd: end,
  minimumRunSample: 10
});
assert.equal(insufficientSample.candidates.length, 0, "ordinary one-off failure must not create a low-sample candidate");

assert.equal(feedbackSchema.safeParse({}).success, false, "empty feedback must be rejected");
assert.equal(
  feedbackSchema.safeParse({ feedbackKey: "only-an-idempotency-key" }).success,
  false,
  "idempotency key alone must not count as feedback"
);
assert.equal(
  outcomeSchema.safeParse({ eventType: "arbitrary_secret_event" }).success,
  false,
  "unknown outcome event must be rejected"
);
assert.equal(
  outcomeSchema.safeParse({ eventType: "task_completed", metadata: { surface: "agent_result" } }).success,
  true,
  "allowlisted outcome event should pass validation"
);
assert.equal(
  outcomeSchema.safeParse({ eventType: "task_completed", metadata: { surface: "owner@example.com" } }).success,
  false,
  "sensitive metadata must be rejected"
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checks: 18,
      clusters: analysis.clusters.length,
      candidates: analysis.candidates.length,
      evalDrafts: analysis.evalDrafts.length
    },
    null,
    2
  )
);
