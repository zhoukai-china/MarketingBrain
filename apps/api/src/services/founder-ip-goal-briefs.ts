import { prisma } from "@baolu/db";
import type { RequestContext } from "./request-context.js";

export const FOUNDER_IP_TARGETS = ["franchise", "store_visit", "student", "partner"] as const;
export type FounderIpGoalTarget = typeof FOUNDER_IP_TARGETS[number];

export interface FounderIpGoalBriefInput {
  subjectId: string;
  target: FounderIpGoalTarget;
  identity: string;
  targetCustomer: string;
  acquisitionGoal: string;
  offer?: string;
  accountStage?: string;
  industry: string;
  benchmarkAccounts: string[];
}

const demoBriefs = new Map<string, FounderIpGoalBriefInput & { tenantId: string; updatedAt: Date }>();
const keyFor = (tenantId: string, subjectId: string, target: FounderIpGoalTarget) => `${tenantId}:${subjectId}:${target}`;

export async function assertFounderIpBriefSubject(context: RequestContext, subjectId: string): Promise<void> {
  if (context.source === "demo") return;
  const subject = await prisma.knowledgeSubject.findFirst({ where: { id: subjectId, tenantId: context.tenantId, status: "active" }, select: { id: true } });
  if (!subject) {
    const error = new Error("当前主体不存在、已停用或不属于本企业。");
    (error as Error & { statusCode: number; code: string }).statusCode = 404;
    (error as Error & { statusCode: number; code: string }).code = "knowledge_subject_not_found";
    throw error;
  }
}

export async function loadFounderIpGoalBrief(context: RequestContext, subjectId: string, target: FounderIpGoalTarget) {
  await assertFounderIpBriefSubject(context, subjectId);
  if (context.source === "demo") return demoBriefs.get(keyFor(context.tenantId, subjectId, target)) ?? null;
  return prisma.founderIpGoalBrief.findUnique({
    where: { tenantId_subjectId_target: { tenantId: context.tenantId, subjectId, target } },
    select: { subjectId: true, target: true, identity: true, targetCustomer: true, acquisitionGoal: true, offer: true, accountStage: true, industry: true, benchmarkAccounts: true, updatedAt: true }
  });
}

export async function saveFounderIpGoalBrief(context: RequestContext, input: FounderIpGoalBriefInput) {
  await assertFounderIpBriefSubject(context, input.subjectId);
  if (context.source === "demo") {
    const saved = { ...input, tenantId: context.tenantId, updatedAt: new Date() };
    demoBriefs.set(keyFor(context.tenantId, input.subjectId, input.target), saved);
    return saved;
  }
  return prisma.$transaction(async (tx) => {
    const saved = await tx.founderIpGoalBrief.upsert({
      where: { tenantId_subjectId_target: { tenantId: context.tenantId, subjectId: input.subjectId, target: input.target } },
      create: { tenantId: context.tenantId, createdByUserId: context.userId, ...input },
      update: { identity: input.identity, targetCustomer: input.targetCustomer, acquisitionGoal: input.acquisitionGoal, offer: input.offer || null, accountStage: input.accountStage || null, industry: input.industry, benchmarkAccounts: input.benchmarkAccounts, createdByUserId: context.userId }
    });
    await tx.auditLog.create({ data: { tenantId: context.tenantId, userId: context.userId, action: "founder_ip_goal_brief.saved", resource: "founder_ip_goal_brief", resourceId: saved.id, detail: JSON.stringify({ subjectId: input.subjectId, target: input.target }) } });
    return saved;
  });
}
