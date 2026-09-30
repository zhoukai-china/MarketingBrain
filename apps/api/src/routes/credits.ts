import type { FastifyInstance } from "fastify";
import { prisma } from "@baolu/db";
import { env } from "../config/env.js";
import { listDemoBillingOrders } from "../services/demo-billing.js";
import { resolveRequestContext } from "../services/request-context.js";
import { readCreditLedger } from "../services/credit-ledger.js";

export async function registerCreditRoutes(app: FastifyInstance): Promise<void> {
  /**
   * 算力明细（用户级钱包流水）。
   *
   * 与 `/market/me` 的余额同源（都是用户双桶钱包），登录后才有数据；未登录返回 401，
   * 由前端统一收口到登录页——不再出现「余额有数、明细空白」的对不上页面。
   */
  app.get<{ Querystring: { page?: string; pageSize?: string; limit?: string; category?: string; q?: string } }>(
    "/credits/ledger",
    async (request, reply) => {
      let context;
      try {
        context = await resolveRequestContext(request.headers);
      } catch {
        return reply.code(401).send({ error: "login_required", message: "登录后可查看算力明细。" });
      }
      if (context.source !== "database" || !context.userId) {
        return reply.code(401).send({ error: "login_required", message: "登录后可查看算力明细。" });
      }
      // 2026-09-30（用户）：明细改右侧抽屉，要分页 / 分类 / 搜索；`limit` 保留兼容旧调用。
      const pageSize = request.query.pageSize ?? request.query.limit;
      return readCreditLedger(context.userId, {
        page: Number(request.query.page ?? 1),
        pageSize: pageSize === undefined ? 8 : Number(pageSize),
        category: request.query.category ?? null,
        q: request.query.q ?? null
      });
    }
  );

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

function clampLimit(rawLimit: string | undefined, fallback = 50): number {
  const parsed = Number(rawLimit ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.trunc(parsed), 100));
}
