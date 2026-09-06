import { prisma } from "@baolu/db";
import type { RequestContext } from "./request-context.js";
import { assertFounderIpBriefSubject, FOUNDER_IP_TARGETS, loadFounderIpGoalBrief, type FounderIpGoalTarget } from "./founder-ip-goal-briefs.js";

export interface FounderIpContentDraftInput {
  subjectId: string; target: FounderIpGoalTarget; topic: string; audience: string; sourceEvidence: string; factBoundary: string; goalRelation: string;
}
export interface FounderIpContentDraft extends FounderIpContentDraftInput {
  id: string; identity: string; targetCustomer: string; acquisitionGoal: string; offer: string; accountStage: string; industry: string; content: string; createdAt: string; updatedAt: string;
}

const demoDrafts = new Map<string, FounderIpContentDraft>();
const marker = "FOUNDER_IP_CONTENT_DRAFT_V1";
const demoKey = (tenantId: string, id: string) => `${tenantId}:${id}`;

function draftFrom(input: FounderIpContentDraftInput, brief: any, id: string, now: Date, content = ""): FounderIpContentDraft {
  return { id, ...input, identity: brief.identity, targetCustomer: brief.targetCustomer, acquisitionGoal: brief.acquisitionGoal, offer: brief.offer ?? "", accountStage: brief.accountStage ?? "", industry: brief.industry, content, createdAt: now.toISOString(), updatedAt: now.toISOString() };
}
function encode(draft: FounderIpContentDraft): string { return `${marker}\n${JSON.stringify(draft)}`; }
function decode(value: string): FounderIpContentDraft | null { if (!value.startsWith(marker)) return null; try { return JSON.parse(value.slice(marker.length).trim()) as FounderIpContentDraft; } catch { return null; } }

export async function createFounderIpContentDraft(context: RequestContext, agentId: string, input: FounderIpContentDraftInput): Promise<FounderIpContentDraft> {
  await assertFounderIpBriefSubject(context, input.subjectId);
  const brief = await loadFounderIpGoalBrief(context, input.subjectId, input.target);
  if (!brief) { const error = new Error("请先保存当前获客目标简报，再生成内容草稿。"); (error as any).code = "founder_ip_goal_brief_required"; (error as any).statusCode = 409; throw error; }
  const now = new Date();
  if (context.source === "demo") { const id = `fip-content-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; const draft = draftFrom(input, brief, id, now); demoDrafts.set(demoKey(context.tenantId, id), draft); return draft; }
  const draft = draftFrom(input, brief, "", now);
  const conversation = await prisma.$transaction(async tx => {
    const created = await tx.conversation.create({ data: { tenantId: context.tenantId, agentId, channel: "founder_ip_content_draft", deviceScope: "desktop", title: `内容草稿｜${input.topic.slice(0, 36)}` } });
    draft.id = created.id;
    await tx.message.create({ data: { conversationId: created.id, tenantId: context.tenantId, userId: context.userId, role: "system", content: encode(draft) } });
    await tx.auditLog.create({ data: { tenantId: context.tenantId, userId: context.userId, action: "founder_ip_content_draft.created", resource: "founder_ip_content_draft", resourceId: created.id, detail: JSON.stringify({ subjectId: input.subjectId, target: input.target }) } });
    return created;
  });
  draft.id = conversation.id;
  return draft;
}

export async function loadFounderIpContentDraft(context: RequestContext, id: string): Promise<FounderIpContentDraft | null> {
  if (context.source === "demo") return demoDrafts.get(demoKey(context.tenantId, id)) ?? null;
  const record = await prisma.conversation.findFirst({ where: { id, tenantId: context.tenantId, channel: "founder_ip_content_draft" }, include: { messages: { where: { tenantId: context.tenantId, role: "system" }, orderBy: { createdAt: "desc" }, take: 1 } } });
  return record ? decode(record.messages[0]?.content ?? "") : null;
}

export async function saveFounderIpContentDraft(context: RequestContext, id: string, content: string, event: "saved" | "generated" = "saved"): Promise<FounderIpContentDraft | null> {
  const current = await loadFounderIpContentDraft(context, id); if (!current) return null;
  const draft = { ...current, content, updatedAt: new Date().toISOString() };
  if (context.source === "demo") { demoDrafts.set(demoKey(context.tenantId, id), draft); return draft; }
  const message = await prisma.message.findFirst({ where: { tenantId: context.tenantId, conversationId: id, role: "system" }, orderBy: { createdAt: "desc" } });
  if (!message) return null;
  await prisma.$transaction(async tx => { await tx.message.update({ where: { id: message.id }, data: { content: encode(draft) } }); await tx.conversation.update({ where: { id }, data: { updatedAt: new Date() } }); await tx.auditLog.create({ data: { tenantId: context.tenantId, userId: context.userId, action: `founder_ip_content_draft.${event}`, resource: "founder_ip_content_draft", resourceId: id, detail: JSON.stringify({ subjectId: draft.subjectId, target: draft.target }) } }); });
  return draft;
}

export const FOUNDER_IP_CONTENT_TARGETS = FOUNDER_IP_TARGETS;
