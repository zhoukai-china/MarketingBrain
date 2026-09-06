import assert from "node:assert/strict";
import { prisma } from "../packages/db/src/index.js";

const forbidden = /枕水江南|餐饮|招商|山东|培训3天|月流水15万|毛利60%|团购|外卖|夫妻店|兰琪|验收[AB]店|tenant/i;
const required = ["短结论", "选题", "口播逐字稿", "访谈话术", "拍摄脚本", "拍摄注意事项", "剪辑EDL", "发布标题与话题", "最佳发布时间", "评论区引导话术", "投流建议"];

async function main(): Promise<void> {
  const since = new Date(Date.now() - 30 * 60 * 1000);
  const runs = await prisma.agentRun.findMany({
    where: { capabilityId: "content_plan", createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: { id: true, output: true, skillId: true, skillVersion: true, usageChannel: true, creditCost: true }
  });
  assert.equal(runs.length >= 1, true, "recent_content_ten_run_missing");
  for (const run of runs) {
    assert.equal(run.skillId, "baolu_content_creator");
    assert.equal(run.output.length >= 760, true, "content_ten_too_short");
    for (const section of required) assert.match(run.output, new RegExp(section), `content_ten_missing:${section}`);
    assert.doesNotMatch(run.output, forbidden, "content_ten_cross_product_contamination");
  }
  const reservations = await prisma.creditReservation.findMany({
    where: { agentRunId: { in: runs.map((run) => run.id) } },
    select: { status: true, actualAmount: true, agentRunId: true }
  });
  assert.equal(reservations.length, runs.length, "content_ten_reservation_count_mismatch");
  assert.equal(reservations.every((item) => item.status === "settled" && typeof item.actualAmount === "number"), true, "content_ten_reservation_not_settled");
  const tempConnections = await prisma.workbuddyMcpConnection.findMany({
    where: { label: "内容十件套受控真实复验", createdAt: { gte: since } },
    select: { status: true, revokedAt: true }
  });
  assert.equal(tempConnections.length >= 1, true, "content_ten_temp_credential_missing");
  assert.equal(tempConnections.every((item) => item.status === "revoked" && item.revokedAt !== null), true, "content_ten_temp_credential_not_revoked");
  console.log(JSON.stringify({ status: "passed", recentRuns: runs.length, channels: [...new Set(runs.map((run) => run.usageChannel))], totalCredits: runs.reduce((sum, run) => sum + run.creditCost, 0), reservationsSettled: reservations.length, temporaryCredentialsRevoked: tempConnections.length, runFingerprints: runs.map((run) => `${run.id.slice(0, 4)}…${run.id.slice(-4)}`) }));
}

void main().finally(() => prisma.$disconnect());
