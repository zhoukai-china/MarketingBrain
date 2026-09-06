import type { FastifyInstance } from "fastify";
import { prisma } from "@baolu/db";
import { z } from "zod";
import { env } from "../config/env.js";
import { resolveRequestContext } from "../services/request-context.js";
import {
  buildLanqiReferralInvite,
  generateLanqiReferralCode,
  publicLanqiReferral,
} from "../services/lanqi-referrals.js";

const createReferralSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
});

export async function registerLanqiReferralRoutes(app: FastifyInstance): Promise<void> {
  app.post("/lanqi/referrals", async (request, reply) => {
    const parsed = createReferralSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const context = await resolveRequestContext(request.headers);
    if (context.role !== "owner" && context.role !== "admin") {
      return reply.code(403).send({ error: "lanqi_referral_admin_required" });
    }
    if (env.DATA_MODE !== "database") return reply.code(409).send({ error: "database_required" });

    const code = generateLanqiReferralCode();
    const invite = buildLanqiReferralInvite(code, parsed.data.label);
    const referral = await prisma.$transaction(async (tx: any) => {
      const inviteCode = await tx.inviteCode.create({
        data: {
          ...invite.invite,
          label: invite.invite.label ?? "兰琪加盟商推荐开通",
          planCode: "local_standard",
          productCode: "lanqi",
        },
      });
      return tx.lanqiReferral.create({
        data: {
          inviterTenantId: context.tenantId,
          inviteCodeId: inviteCode.id,
          label: parsed.data.label,
        },
      });
    });
    return reply.code(201).send({
      referral: publicLanqiReferral(referral),
      inviteCode: code,
    });
  });

  app.get("/lanqi/referrals", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    if (env.DATA_MODE !== "database") return reply.code(409).send({ error: "database_required" });
    const referrals = await prisma.lanqiReferral.findMany({
      where: { inviterTenantId: context.tenantId },
      orderBy: { createdAt: "desc" },
    });
    return { referrals: referrals.map(publicLanqiReferral) };
  });

  app.post<{ Params: { id: string } }>("/lanqi/referrals/:id/revoke", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    if (context.role !== "owner" && context.role !== "admin") {
      return reply.code(403).send({ error: "lanqi_referral_admin_required" });
    }
    if (env.DATA_MODE !== "database") return reply.code(409).send({ error: "database_required" });
    const updated = await prisma.lanqiReferral.updateMany({
      where: { id: request.params.id, inviterTenantId: context.tenantId, status: "pending" },
      data: { status: "revoked", revokedAt: new Date() },
    });
    if (updated.count !== 1) return reply.code(404).send({ error: "lanqi_referral_not_pending" });
    const referral = await prisma.lanqiReferral.findFirst({ where: { id: request.params.id, inviterTenantId: context.tenantId } });
    return { referral: publicLanqiReferral(referral!) };
  });
}
