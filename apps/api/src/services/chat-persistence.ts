import type { AgentResponse, LlmProvider } from "@baolu/agent";
import { Prisma, prisma } from "@baolu/db";
import type { DeviceScope } from "@baolu/shared";
import type { RequestContext } from "./request-context.js";
import type { ExecutionPlan, SkillResultEnvelope } from "./agent-orchestrator.js";
import { settleCreditReservation, type ProductBillingContext } from "./credit-reservations.js";

export class InsufficientCreditsError extends Error {
  constructor() {
    super("insufficient_credits");
  }
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("request_id_conflict");
  }
}

export interface PersistedChatResult {
  persisted: boolean;
  conversationId?: string;
  deviceScope?: DeviceScope;
  agentRunId?: string;
  remainingCredits?: number;
}

export type ChatChannel = "h5" | "workbuddy" | "wechat";

export async function persistChatResult(params: {
  context: RequestContext;
  input: string;
  result: AgentResponse;
  provider: LlmProvider;
  channel?: ChatChannel;
  conversationId?: string;
  deviceScope?: DeviceScope;
  agentId?: string;
  capabilityId?: string;
  requestId?: string;
  requestFingerprint?: string;
  mcpCallId?: string;
  billingContext?: ProductBillingContext;
  billingReservationId?: string;
  routingSource?: "capability" | "agent_router" | "legacy";
  execution?: {
    plan: ExecutionPlan;
    results: SkillResultEnvelope[];
  };
}): Promise<PersistedChatResult> {
  const deviceScope = params.deviceScope ?? "desktop";
  const channel = params.channel ?? "h5";
  if (params.context.source !== "database") {
    return {
      persisted: false,
      deviceScope,
      remainingCredits: params.context.creditBalance
    };
  }

  const existing = await findExistingRun(params.context.tenantId, params.requestId, params.agentId, params.requestFingerprint);
  if (existing) return existing;

  try {
    const saved = await prisma.$transaction(async (tx: any) => {
      if (params.requestId) {
        const duplicate = await tx.agentRun.findUnique({ where: { requestId: params.requestId } });
        if (duplicate) {
          if (
            duplicate.tenantId !== params.context.tenantId
            || duplicate.agentId !== params.agentId
            || (params.requestFingerprint && duplicate.requestFingerprint && duplicate.requestFingerprint !== params.requestFingerprint)
          ) {
            throw new IdempotencyConflictError();
          }
          const account = await tx.creditAccount.findUnique({ where: { tenantId: params.context.tenantId } });
          return {
            conversationId: duplicate.conversationId,
            agentRunId: duplicate.id,
            remainingCredits: account?.balance
          };
        }
      }

      const creditAccount = await tx.creditAccount.findUnique({
        where: { tenantId: params.context.tenantId }
      });
      if (!creditAccount || (!params.billingReservationId && creditAccount.balance < params.result.creditCost)) {
        throw new InsufficientCreditsError();
      }

      const conversation = params.conversationId
        ? await tx.conversation.findFirst({
            where: {
              id: params.conversationId,
              tenantId: params.context.tenantId,
              agentId: params.agentId,
              deviceScope,
              channel
            }
          })
        : null;

      const activeConversation =
        conversation ??
        (await tx.conversation.create({
          data: {
            tenantId: params.context.tenantId,
            agentId: params.agentId,
            channel,
            deviceScope,
            title: params.input.slice(0, 40)
          }
        }));

      await tx.message.create({
        data: {
          conversationId: activeConversation.id,
          tenantId: params.context.tenantId,
          userId: params.context.userId,
          role: "user",
          content: params.input
        }
      });
      await tx.message.create({
        data: {
          conversationId: activeConversation.id,
          tenantId: params.context.tenantId,
          role: "assistant",
          content: params.result.answer
        }
      });
      await tx.conversation.update({
        where: { id: activeConversation.id },
        data: { updatedAt: new Date() }
      });

      const agentRun = await tx.agentRun.create({
        data: {
          tenantId: params.context.tenantId,
          userId: params.context.userId,
          conversationId: activeConversation.id,
          agentId: params.agentId,
          capabilityId: params.capabilityId,
          requestId: params.requestId,
          requestFingerprint: params.requestFingerprint,
          mcpCallId: params.mcpCallId,
          routingSource: params.routingSource,
          deviceScope,
          skillId: params.result.skillId,
          skillVersion: params.result.skillVersion,
          tenantType: params.context.profile.tenantType,
          status: params.result.deliveryStatus === "needs_input"
            ? "needs_input"
            : params.result.deliveryStatus === "failed"
              ? "failed"
              : "succeeded",
          input: params.input,
          output: params.result.answer,
          qualityFlags: params.result.qualityFlags ?? null,
          modelProvider: params.provider.name,
          productCode: params.billingContext?.productCode,
          operatingEntityId: params.billingContext?.operatingEntityId,
          usageChannel: params.billingContext?.channel,
          mcpCredentialId: params.billingContext?.credentialId,
          creditCost: params.result.creditCost
        }
      });

      if (params.execution?.results.length) {
        const stepById = new Map(params.execution.plan.steps.map((step) => [step.stepId, step]));
        await tx.agentRunStep.createMany({
          data: params.execution.results.map((result) => {
            const step = stepById.get(result.stepId);
            return {
              agentRunId: agentRun.id,
              stepId: result.stepId,
              sortOrder: step?.sortOrder ?? 0,
              capabilityId: result.capabilityId,
              skillId: result.skillId,
              skillVersion: result.skillVersion,
              status: result.status === "success"
                ? "succeeded"
                : result.status === "needs_input"
                  ? "needs_input"
                  : "failed",
              dependsOn: step?.dependsOn ?? [],
              input: result.input,
              output: result.status === "success" ? result.answerMarkdown : null,
              qualityFlags: result.qualityFlags,
              creditCost: result.creditCost,
              durationMs: result.durationMs,
              errorCode: result.error?.code
            };
          })
        });
      }

      const updatedAccount = params.billingReservationId
        ? await settleCreditReservation({
            tx,
            reservationId: params.billingReservationId,
            actualAmount: params.result.creditCost,
            agentRunId: agentRun.id
          })
        : await tx.creditAccount.update({
            where: { id: creditAccount.id },
            data: { balance: { decrement: params.result.creditCost } }
          });
      if (!params.billingReservationId) {
        await tx.creditTransaction.create({
          data: {
            creditAccountId: creditAccount.id,
            tenantId: params.context.tenantId,
            userId: params.context.userId,
            direction: "consume",
            amount: params.result.creditCost,
            reason: `agent:${params.agentId ?? "legacy"}:${params.result.skillId}`,
            refType: "agent_run",
            refId: agentRun.id,
            productCode: params.billingContext?.productCode,
            operatingEntityId: params.billingContext?.operatingEntityId,
            channel: params.billingContext?.channel,
            capabilityId: params.capabilityId,
            mcpCredentialId: params.billingContext?.credentialId,
            provider: params.provider.name
          }
        });
      }

      return {
        conversationId: activeConversation.id,
        agentRunId: agentRun.id,
        remainingCredits: updatedAccount.balance
      };
    });

    return { persisted: true, deviceScope, ...saved };
  } catch (error) {
    if (params.requestId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicate = await findExistingRun(params.context.tenantId, params.requestId, params.agentId, params.requestFingerprint);
      if (duplicate) return duplicate;
    }
    throw error;
  }
}

async function findExistingRun(
  tenantId: string,
  requestId?: string,
  agentId?: string,
  requestFingerprint?: string
): Promise<PersistedChatResult | null> {
  if (!requestId) return null;
  const existing = await prisma.agentRun.findUnique({
    where: { requestId },
    select: { id: true, tenantId: true, agentId: true, conversationId: true, deviceScope: true, requestFingerprint: true }
  });
  if (!existing) return null;
  if (
    existing.tenantId !== tenantId
    || existing.agentId !== agentId
    || (requestFingerprint && existing.requestFingerprint && existing.requestFingerprint !== requestFingerprint)
  ) throw new IdempotencyConflictError();
  const account = await prisma.creditAccount.findUnique({ where: { tenantId } });
  return {
    persisted: true,
    agentRunId: existing.id,
    conversationId: existing.conversationId ?? undefined,
    deviceScope: existing.deviceScope === "mobile" ? "mobile" : "desktop",
    remainingCredits: account?.balance
  };
}
