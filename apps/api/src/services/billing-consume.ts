import { Prisma, prisma } from "@baolu/db";
import {
  markBillingAccessTokenUsed,
  type ResolvedBillingAccessToken
} from "./billing-access-tokens.js";

export interface BillingPrecheckResult {
  ok: boolean;
  balance: number;
  required: number;
  rechargeUrl: string | null;
}

export type BillingConsumeResult =
  | {
      status: "completed";
      idempotent: boolean;
      balance: number;
      amount: number;
    }
  | {
      status: "insufficient";
      idempotent: boolean;
      balance: number;
      required: number;
      rechargeUrl: string;
    };

export async function precheckBillingConsume(params: {
  token: ResolvedBillingAccessToken;
  amount: number;
  skill?: string;
}): Promise<BillingPrecheckResult> {
  const balance = await readCreditBalance(params.token.tenantId);
  return {
    ok: balance >= params.amount,
    balance,
    required: params.amount,
    rechargeUrl: buildRechargeUrl(params.skill)
  };
}

export async function consumeBillingCredits(params: {
  token: ResolvedBillingAccessToken;
  requestId: string;
  amount: number;
  skill?: string;
}): Promise<BillingConsumeResult> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const existing = await tx.billingConsume.findUnique({
          where: {
            accessTokenId_requestId: {
              accessTokenId: params.token.id,
              requestId: params.requestId
            }
          }
        });

        const balance = await readCreditBalance(params.token.tenantId, tx);
        if (existing) {
          if (existing.status === "completed") {
            return {
              status: "completed" as const,
              idempotent: true,
              balance,
              amount: existing.amount
            };
          }
          return {
            status: "insufficient" as const,
            idempotent: true,
            balance,
            required: existing.amount,
            rechargeUrl: buildRechargeUrl(params.skill)
          };
        }

        const account = await tx.creditAccount.findUnique({
          where: { tenantId: params.token.tenantId },
          select: { id: true, balance: true }
        });

        if (!account || account.balance < params.amount) {
          await tx.billingConsume.create({
            data: {
              tenantId: params.token.tenantId,
              userId: params.token.userId,
              accessTokenId: params.token.id,
              requestId: params.requestId,
              amount: params.amount,
              status: "insufficient"
            }
          });
          return {
            status: "insufficient" as const,
            idempotent: false,
            balance: account?.balance ?? 0,
            required: params.amount,
            rechargeUrl: buildRechargeUrl(params.skill)
          };
        }

        const claimed = await tx.creditAccount.updateMany({
          where: { id: account.id, balance: { gte: params.amount } },
          data: { balance: { decrement: params.amount } }
        });
        if (claimed.count !== 1) {
          await tx.billingConsume.create({
            data: {
              tenantId: params.token.tenantId,
              userId: params.token.userId,
              accessTokenId: params.token.id,
              requestId: params.requestId,
              amount: params.amount,
              status: "insufficient"
            }
          });
          return {
            status: "insufficient" as const,
            idempotent: false,
            balance: account.balance,
            required: params.amount,
            rechargeUrl: buildRechargeUrl(params.skill)
          };
        }

        const transaction = await tx.creditTransaction.create({
          data: {
            creditAccountId: account.id,
            tenantId: params.token.tenantId,
            userId: params.token.userId,
            direction: "consume",
            amount: params.amount,
            reason: "billing_consume",
            refType: "billing_consume",
            refId: params.requestId,
            productCode: "workbuddy",
            channel: "workbuddy",
            capabilityId: params.skill ?? undefined,
            mcpCredentialId: params.token.id,
            provider: "workbuddy"
          }
        });

        await tx.billingConsume.create({
          data: {
            tenantId: params.token.tenantId,
            userId: params.token.userId,
            accessTokenId: params.token.id,
            requestId: params.requestId,
            amount: params.amount,
            status: "completed",
            creditTransactionId: transaction.id
          }
        });

        const nextAccount = await tx.creditAccount.findUnique({
          where: { id: account.id },
          select: { balance: true }
        });
        return {
          status: "completed" as const,
          idempotent: false,
          balance: nextAccount?.balance ?? 0,
          amount: params.amount
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.billingConsume.findUnique({
        where: {
          accessTokenId_requestId: {
            accessTokenId: params.token.id,
            requestId: params.requestId
          }
        }
      });
      if (existing) {
        const balance = await readCreditBalance(params.token.tenantId);
        if (existing.status === "completed") {
          return {
            status: "completed",
            idempotent: true,
            balance,
            amount: existing.amount
          };
        }
        return {
          status: "insufficient",
          idempotent: true,
          balance,
          required: existing.amount,
          rechargeUrl: buildRechargeUrl(params.skill)
        };
      }
    }
    throw error;
  } finally {
    await markBillingAccessTokenUsed(params.token.id).catch(() => undefined);
  }
}

async function readCreditBalance(
  tenantId: string,
  tx: Prisma.TransactionClient = prisma
): Promise<number> {
  const account = await tx.creditAccount.findUnique({
    where: { tenantId },
    select: { balance: true }
  });
  return account?.balance ?? 0;
}

function buildRechargeUrl(skill?: string): string {
  const params = new URLSearchParams({ from: "workbuddy" });
  if (skill) params.set("skill", skill);
  return `/recharge?${params.toString()}`;
}
