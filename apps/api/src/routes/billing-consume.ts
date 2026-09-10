import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@baolu/db";
import {
  resolveRequestContext
} from "../services/request-context.js";
import { resolveBillingAccessToken } from "../services/billing-access-tokens.js";
import {
  consumeWalletCredits,
  precheckConsume,
  readWallet,
  recordRedo
} from "../services/sitong-wallet.js";

const precheckSchema = z.object({
  skill: z.string().trim().min(1).max(120)
});

const consumeSchema = precheckSchema.extend({
  requestId: z.string().trim().min(8).max(200),
  viaBundle: z.string().trim().max(120).optional(),
  stepIndex: z.coerce.number().int().min(0).max(20).optional()
});

const redoSchema = z.object({
  requestId: z.string().trim().min(8).max(200),
  skill: z.string().trim().min(1).max(120).optional()
});

const SKILL_PPU: Record<string, number> = {
  "ip-pos": 200,
  topic: 40,
  copy: 40,
  vidrev: 60,
  livescript: 200,
  liverev: 100,
  sales: 60,
  moments: 20,
  "ip-pack": 0
};

const BUNDLE_STEP_PPU = [200, 40, 40, 60, 200, 100, 60];

function resolveSkillPrice(skill: string, viaBundle?: string, stepIndex?: number): number {
  if ((viaBundle || skill.includes("__ip-pack")) && typeof stepIndex === "number") {
    return BUNDLE_STEP_PPU[stepIndex] ?? 0;
  }
  const core = skill.includes("__") ? skill.slice(skill.lastIndexOf("__") + 2) : skill;
  return SKILL_PPU[core] ?? 0;
}

export async function registerBillingConsumeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/wallet", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    if (context.source !== "database") {
      return reply.code(409).send({ error: "database_mode_required" });
    }
    const wallet = await readWallet(context.userId);
    return {
      paidBalance: wallet.paidBalance,
      bonusBalance: wallet.bonusBalance,
      balance: wallet.balance
    };
  });

  app.post("/billing/precheck", async (request, reply) => {
    const parsed = precheckSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const token = await resolveBillingAccessToken(authHeader(request.headers.authorization));
    if (!token) return reply.code(401).send({ error: "billing_access_token_required" });
    if (!(await hasActiveUser(token.userId))) {
      return reply.code(401).send({ error: "billing_access_token_invalid" });
    }

    const price = resolveSkillPrice(parsed.data.skill);
    if (price <= 0) {
      return reply.code(404).send({ error: "marketplace_skill_not_configured", message: "未找到该智能体的价格配置" });
    }
    const result = await precheckConsume({
      userId: token.userId,
      price,
      skillId: parsed.data.skill
    });
    return {
      allowed: result.allowed,
      balance: result.wallet.balance,
      paidBalance: result.wallet.paidBalance,
      bonusBalance: result.wallet.bonusBalance,
      price,
      rechargeUrl: result.rechargeUrl
    };
  });

  app.post("/billing/consume", async (request, reply) => {
    const parsed = consumeSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const token = await resolveBillingAccessToken(authHeader(request.headers.authorization));
    if (!token) return reply.code(401).send({ error: "billing_access_token_required" });
    if (!(await hasActiveUser(token.userId))) {
      return reply.code(401).send({ error: "billing_access_token_invalid" });
    }

    const price = resolveSkillPrice(parsed.data.skill, parsed.data.viaBundle, parsed.data.stepIndex);
    if (price <= 0) {
      return reply.code(404).send({ error: "marketplace_skill_not_configured", message: "未找到该智能体的价格配置" });
    }

    const result = await consumeWalletCredits({
      userId: token.userId,
      requestId: parsed.data.requestId,
      price,
      skillId: parsed.data.skill,
      viaBundle: parsed.data.viaBundle,
      stepIndex: parsed.data.stepIndex,
      source: "workbuddy"
    });

    if (result.status === "insufficient") {
      return reply.code(402).send({
        error: "insufficient_credits",
        message: "当前积分不足，请先充值后再使用。",
        balance: result.wallet.balance,
        paidBalance: result.wallet.paidBalance,
        bonusBalance: result.wallet.bonusBalance,
        required: result.required,
        rechargeUrl: result.rechargeUrl
      });
    }

    return {
      status: "completed",
      idempotent: result.idempotent,
      balance: result.wallet.balance,
      paidBalance: result.wallet.paidBalance,
      bonusBalance: result.wallet.bonusBalance,
      spent: result.spent,
      price
    };
  });

  app.post("/billing/redo", async (request, reply) => {
    const parsed = redoSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    const token = await resolveBillingAccessToken(authHeader(request.headers.authorization));
    if (!token) return reply.code(401).send({ error: "billing_access_token_required" });
    if (!(await hasActiveUser(token.userId))) {
      return reply.code(401).send({ error: "billing_access_token_invalid" });
    }
    const result = await recordRedo({
      userId: token.userId,
      requestId: parsed.data.requestId,
      skillId: parsed.data.skill,
      source: "workbuddy"
    });
    return result;
  });
}

function authHeader(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value;
}

async function hasActiveUser(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  return Boolean(user);
}
