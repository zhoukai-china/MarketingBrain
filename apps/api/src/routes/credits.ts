import type { FastifyInstance } from "fastify";
import { prisma } from "@baolu/db";
import { env } from "../config/env.js";
import { listDemoBillingOrders } from "../services/demo-billing.js";
import { resolveRequestContext } from "../services/request-context.js";

export async function registerCreditRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { limit?: string } }>("/credits/transactions", async (request) => {
    const context = await resolveRequestContext(request.headers);
    const limit = clampLimit(request.query.limit);

    if (env.DATA_MODE === "demo") {
      const paidOrders = listDemoBillingOrders(context.tenantId).filter(
        (order) => order.status === "paid"
      );
      const transactions = [
        {
          id: "demo-welcome-credit",
          direction: "grant",
          amount: 300,
          reason: "welcome_credits",
          refType: "demo",
          refId: context.tenantId,
          createdAt: new Date().toISOString()
        },
        ...paidOrders.map((order) => ({
          id: `demo-order-${order.id}`,
          direction: "grant",
          amount: order.credits,
          reason: `credit_pack:${order.creditPackCode}`,
          refType: "billing_order",
          refId: order.id,
          createdAt: order.paidAt ?? order.createdAt
        }))
      ]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);

      return {
        dataMode: "demo",
        tenantId: context.tenantId,
        creditBalance: context.creditBalance ?? 300,
        transactions
      };
    }

    const transactions = await prisma.creditTransaction.findMany({
      where: {
        tenantId: context.tenantId
      },
      orderBy: {
        createdAt: "desc"
      },
      take: limit
    });

    return {
      dataMode: "database",
      tenantId: context.tenantId,
      creditBalance: context.creditBalance ?? 0,
      transactions: transactions.map((transaction: any) => ({
        id: transaction.id,
        direction: transaction.direction,
        amount: transaction.amount,
        reason: transaction.reason,
        refType: transaction.refType,
        refId: transaction.refId,
        userId: transaction.userId,
        createdAt: transaction.createdAt.toISOString()
      }))
    };
  });
}

function clampLimit(rawLimit: string | undefined): number {
  const parsed = Number(rawLimit ?? 50);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(Math.trunc(parsed), 100));
}
