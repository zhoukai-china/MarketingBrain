#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { inspectQuality } from "../packages/agent/src/index.js";
import { loadSkillQualityContract } from "../packages/skills/src/index.js";
import { assertBeautyWorkflowRuntimeResult } from "../apps/api/src/products/beauty-industry/output-contract.js";
import { buildBeautyIndustryRunInput } from "../apps/api/src/products/beauty-industry/profile.js";
import { buildBeautyWorkflowPrompt } from "../apps/api/src/products/beauty-industry/workflows.js";
import { buildBeautyXhsTaskFactDirective } from "../apps/api/src/products/beauty-industry/xhs-task-facts.js";
import { parseBeautyXhsDelivery } from "../apps/api/src/products/beauty-industry/xhs-delivery.js";
import { internalIdentityHeaders } from "./lib/internal-ops-identity.mjs";

const requireFromDb = createRequire(new URL("../packages/db/package.json", import.meta.url));
const { PrismaClient } = requireFromDb("@prisma/client");
const prisma = new PrismaClient();
const USER_INPUT = "为夏季基础补水护理做一套面向附近女性顾客的小红书图文";
const CAPABILITY_ID = "beauty_xiaohongshu_package";
const SKILL_ID = "wechat-xhs-content-line";
const API_BASE = process.env.BY17_LIVE_API_BASE ?? "";

// This audit replays a real Provider result from the acceptance database.
// The shared acceptance env defaults to controlled mock for normal local use,
// so pin the parser mode explicitly without enabling any external call.
process.env.LLM_MOCK_MODE = "false";
process.env.USE_MOCK_LLM = "false";

function buildProductAlignedEvalContract(contract) {
  return {
    ...contract,
    requiredTerms: (contract.requiredTerms ?? []).filter((term) => !new Set(["事实母版", "画面方向", "逐张提示词"]).has(term)),
    requiredDeliverables: []
  };
}

try {
  const tenant = await prisma.tenant.findFirstOrThrow({
    where: { name: "BY17 Synthetic Empty Profile", createdAt: { gt: new Date(Date.now() - 3_600_000) } },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  const run = await prisma.agentRun.findFirstOrThrow({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, userId: true, status: true, capabilityId: true, skillId: true, output: true }
  });
  assert.equal(run.status, "succeeded");
  assert.equal(run.capabilityId, CAPABILITY_ID);
  assert.equal(run.skillId, SKILL_ID);
  assert.ok(run.output);

  const contract = await loadSkillQualityContract(SKILL_ID);
  const composed = await buildBeautyWorkflowPrompt(CAPABILITY_ID);
  assert.ok(contract);
  const effectiveInput = buildBeautyIndustryRunInput({
    question: USER_INPUT,
    profile: null,
    mode: "quick",
    xhsTaskFactDirective: buildBeautyXhsTaskFactDirective({ question: USER_INPUT })
  });
  const rawFlags = inspectQuality(run.output, SKILL_ID, contract, [{ role: "user", content: USER_INPUT }], CAPABILITY_ID);
  const productionFlags = inspectQuality(run.output, SKILL_ID, buildProductAlignedEvalContract(contract), [{ role: "user", content: effectiveInput }], CAPABILITY_ID);
  const validation = await assertBeautyWorkflowRuntimeResult({
    capabilityId: CAPABILITY_ID,
    expectedSkillId: SKILL_ID,
    expectedSkillVersion: composed.version,
    result: {
      capabilityId: CAPABILITY_ID,
      skillId: SKILL_ID,
      skillVersion: composed.version,
      answerText: run.output,
      deliveryStatus: "completed",
      qualityFlags: productionFlags,
      creditCost: 8
    },
    observedProviderOutputs: [run.output],
    replay: false,
    taskFactSource: effectiveInput
  });
  const delivery = parseBeautyXhsDelivery(run.output, false);
  assert.deepEqual(validation.structuredDelivery, delivery);
  assert.doesNotMatch(delivery.customerDeliverable.copyMarkdown, /受控流程验收|确定性模拟输出|任务事实回执|事实与合规待补|待核验|Schema|Eval/i);
  assert.match(delivery.productionNotes.markdown, /配图方向一｜封面图/);
  assert.match(delivery.auditReceipt.markdown, /任务事实回执/);
  assert.match(API_BASE, /^http:\/\/127\.0\.0\.1:\d+$/);
  await prisma.$transaction([
    prisma.tenantProductEntitlement.updateMany({ where: { tenantId: tenant.id }, data: { status: "active" } }),
    prisma.tenantAgentEntitlement.updateMany({ where: { tenantId: tenant.id }, data: { status: "active" } })
  ]);
  try {
    const historyResponse = await fetch(`${API_BASE}/beauty-industry/acquisition/history`, {
      headers: internalIdentityHeaders({ tenantId: tenant.id, userId: run.userId }),
      signal: AbortSignal.timeout(10_000)
    });
    assert.equal(historyResponse.status, 200);
    const history = await historyResponse.json();
    const historyRun = history.runs?.find((item) => item.id === run.id);
    assert.ok(historyRun, "Web history did not restore the WorkBuddy run");
    assert.equal(historyRun.output, run.output, "Web history output diverged from the WorkBuddy-persisted run");
    assert.equal(historyRun.usageChannel, "mcp");
  } finally {
    await prisma.$transaction([
      prisma.tenantProductEntitlement.updateMany({ where: { tenantId: tenant.id }, data: { status: "revoked" } }),
      prisma.tenantAgentEntitlement.updateMany({ where: { tenantId: tenant.id }, data: { status: "revoked" } })
    ]);
  }

  console.log(JSON.stringify({
    status: "passed",
    runIdHash: createHash("sha256").update(run.id).digest("hex").slice(0, 16),
    outputHash: createHash("sha256").update(run.output).digest("hex").slice(0, 16),
    skillVersion: composed.version,
    rawInputFalseNegativeFlags: rawFlags.filter((flag) => flag.startsWith("missing_contract_terms:")),
    productionBlockingFlags: productionFlags.filter((flag) => /missing_contract_terms|rubric_fact|cross_industry|wrong_|fallback/i.test(flag)),
    fallbackUsed: validation.fallbackUsed,
    providerOutputVerified: validation.providerOutputVerified,
    customerLayerHash: createHash("sha256").update(delivery.customerDeliverable.copyMarkdown).digest("hex").slice(0, 16),
    productionLayerHash: createHash("sha256").update(delivery.productionNotes.markdown).digest("hex").slice(0, 16),
    auditLayerHash: createHash("sha256").update(delivery.auditReceipt.markdown).digest("hex").slice(0, 16),
    webHistoryRestored: true,
    webWorkbuddyOutputHashMatch: true
  }));
} finally {
  await prisma.$disconnect();
}
