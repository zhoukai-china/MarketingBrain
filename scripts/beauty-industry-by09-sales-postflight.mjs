#!/usr/bin/env node
import { createRequire } from "node:module";

const requireFromDb = createRequire(new URL("../packages/db/package.json", import.meta.url));
const { PrismaClient } = requireFromDb("@prisma/client");
const prisma = new PrismaClient();

try {
  const tenant = await prisma.tenant.findFirst({
    where: { name: "BY09 Controlled Evaluation", createdAt: { gt: new Date(Date.now() - 3_600_000) } },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  if (!tenant) throw new Error("by09_controlled_tenant_not_found");
  const run = await prisma.agentRun.findFirst({
    where: { tenantId: tenant.id, capabilityId: "beauty_sales", skillId: "sales_growth_advisor" },
    orderBy: { createdAt: "desc" },
    select: { output: true, status: true, qualityFlags: true }
  });
  if (!run?.output) throw new Error("by09_sales_output_not_found");
  const output = run.output;
  console.log(JSON.stringify({
    status: run.status,
    officialContract: {
      currentJudgement: /当前判断/.test(output),
      nextAction: /下一步动作/.test(output),
      objection: /异议/.test(output),
      breakthrough: /核心破局点/.test(output),
      suggestedReply: /推荐回复/.test(output),
      anticipatedResponse: /客户可能回复与预判应对/.test(output),
      copyableScript: /可直接复制|复制使用|话术/.test(output)
    },
    factBoundary: {
      missingOrUnconfirmed: /待补|未确认|需确认|尚未提供|未提供/.test(output),
      noGuaranteedOutcome: !/保证(?:改善|疗效|见效|治愈)|一次见效|根治/.test(output)
    },
    scenarioBoundary: {
      beautyConsumerContext: /顾客|护理|实际情况|具体情况/.test(output),
      noGroupBuyRefundRoute: !/团购|核销|团购后台|预约和临时不去|购买后的使用政策/.test(output),
      refundOnlyAsBoundary: /退款/.test(output),
      noEnterpriseProcurementRoute: !/企业项目|总预算|采购预算|内部决策人|老板决定|实施负责人/.test(output)
    },
    legacyHarnessMarkers: {
      conclusion: /结论/.test(output),
      steps: /步骤/.test(output),
      missing: /待补/.test(output)
    },
    semanticSignals: {
      advice: /建议|可以这样回复|回复/.test(output),
      followUp: /下一步|后续|跟进/.test(output),
      confirmUnknowns: /价格|肤况|预约|确认|了解/.test(output),
      individualizedBoundary: /因人而异|个体差异|实际情况|具体情况/.test(output),
      numberedActions: (output.match(/^\s*\d+[.、]/gm)?.length ?? 0)
    },
    outputLength: output.length,
    qualityFlags: Array.isArray(run.qualityFlags) ? run.qualityFlags : null
  }));
} finally {
  await prisma.$disconnect();
}
