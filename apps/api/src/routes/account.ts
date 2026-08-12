import type { FastifyInstance } from "fastify";
import { PLANS } from "@baolu/shared";
import { resolveRequestContext } from "../services/request-context.js";

export async function registerAccountRoutes(app: FastifyInstance): Promise<void> {
  app.get("/account/status", async (request) => {
    const auth = await resolveRequestContext(request.headers);
    const plan = PLANS[auth.planCode];
    return {
      tenantId: auth.tenantId,
      userId: auth.userId,
      role: auth.role,
      dataMode: auth.source,
      plan,
      billingMode: "credits_only",
      creditBalance: auth.creditBalance ?? 300,
      expiresAt: null,
      note:
        auth.source === "database"
          ? "已从数据库读取账户与积分余额；系统不收月度订阅费。"
          : "MVP uses demo context. Credit balance is charged per execution."
    };
  });
}
