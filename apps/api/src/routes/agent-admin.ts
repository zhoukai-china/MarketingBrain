import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { runAgent, type LlmProvider } from "@baolu/agent";
import { Prisma, prisma } from "@baolu/db";
import type { SkillId } from "@baolu/shared";
import { SKILL_MANIFESTS } from "@baolu/skills";
import { env } from "../config/env.js";
import { requireAdminToken } from "../services/access-guards.js";
import { getDemoContext, toAgentRequest } from "../services/demo-context.js";
import { resolveRequestContext } from "../services/request-context.js";

const agentPatchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(1000).optional(),
  icon: z.string().max(100).nullable().optional(),
  status: z.enum(["draft", "active", "coming_soon", "archived"]).optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  marketing: z.record(z.unknown()).optional()
});

const offerSchema = z.object({
  code: z.string().min(2).max(100),
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  status: z.enum(["draft", "active", "archived"]),
  amountCny: z.number().int().nonnegative(),
  credits: z.number().int().nonnegative().default(0),
  durationDays: z.number().int().positive().nullable().optional(),
  agentIds: z.array(z.string().min(1)).min(1)
});

const entitlementSchema = z.object({
  tenantId: z.string().min(1),
  agentId: z.string().min(1),
  action: z.enum(["grant", "pause", "revoke"]),
  expiresAt: z.string().datetime().nullable().optional(),
  membershipIds: z.array(z.string().min(1)).default([])
});

const memberAccessSchema = z.object({ agentIds: z.array(z.string().min(1)).max(100) });

const skillReleaseSchema = z.object({
  skillId: z.string().min(2).max(120),
  version: z.string().regex(/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,79}$/),
  prompt: z.string().min(50).max(200_000)
});

const skillReleaseTestSchema = z.object({
  input: z.string().min(1).max(20_000),
  capabilityId: z.string().min(1).max(100).optional()
});

export async function registerAgentAdminRoutes(app: FastifyInstance, provider: LlmProvider): Promise<void> {
  app.get("/admin/agents", { preHandler: requireAdminToken }, async () => {
    if (env.DATA_MODE !== "database") return { dataMode: "demo", agents: [], offers: [], skillReleases: [] };
    const [agents, offers, skillReleases] = await Promise.all([
      prisma.agentDefinition.findMany({
        orderBy: { sortOrder: "asc" },
        include: {
          capabilities: { orderBy: { sortOrder: "asc" }, include: { skillRelease: true } },
          skillBindings: { include: { skillRelease: true } },
          _count: { select: { entitlements: true } }
        }
      }),
      prisma.agentOffer.findMany({
        orderBy: { createdAt: "desc" },
        include: { agents: { include: { agent: true } } }
      }),
      prisma.skillRelease.findMany({ orderBy: [{ skillId: "asc" }, { createdAt: "desc" }] })
    ]);
    return { dataMode: "database", agents, offers, skillReleases };
  });

  app.post("/admin/skill-releases", { preHandler: requireAdminToken }, async (request, reply) => {
    if (env.DATA_MODE !== "database") return reply.code(409).send({ error: "database_mode_required" });
    const parsed = skillReleaseSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    if (!SKILL_MANIFESTS[parsed.data.skillId as keyof typeof SKILL_MANIFESTS]) {
      return reply.code(400).send({ error: "unknown_skill_id" });
    }
    const fileHash = createHash("sha256").update(parsed.data.prompt, "utf8").digest("hex");
    const existing = await prisma.skillRelease.findUnique({
      where: { skillId_version: { skillId: parsed.data.skillId, version: parsed.data.version } }
    });
    if (existing) return reply.code(409).send({ error: "skill_version_exists", releaseId: existing.id });
    const release = await prisma.skillRelease.create({
      data: {
        skillId: parsed.data.skillId,
        version: parsed.data.version,
        fileHash,
        packageSnapshot: { prompt: parsed.data.prompt },
        status: "draft"
      }
    });
    return reply.code(201).send({ release });
  });

  app.post<{ Params: { releaseId: string } }>("/admin/skill-releases/:releaseId/test", { preHandler: requireAdminToken }, async (request, reply) => {
    if (env.DATA_MODE !== "database") return reply.code(409).send({ error: "database_mode_required" });
    const parsed = skillReleaseTestSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const release = await prisma.skillRelease.findUnique({ where: { id: request.params.releaseId } });
    if (!release) return reply.code(404).send({ error: "skill_release_not_found" });
    const prompt = readReleasePrompt(release.packageSnapshot);
    if (!prompt) return reply.code(409).send({ error: "skill_release_prompt_missing" });
    const result = await runAgent(toAgentRequest({
      auth: getDemoContext({}),
      input: parsed.data.input,
      requestedSkillId: release.skillId as SkillId,
      capabilityId: parsed.data.capabilityId,
      skillPrompt: prompt,
      skillVersionOverride: release.version,
      channel: "admin"
    }), provider);
    return {
      releaseId: release.id,
      skillId: result.skillId,
      skillVersion: result.skillVersion,
      answerText: result.answer,
      qualityFlags: result.qualityFlags,
      creditCost: result.creditCost
    };
  });

  // Activating any historical release is also the rollback operation. The
  // Agent keeps exactly one binding per Skill and all matching task cards move
  // atomically to the selected immutable release.
  app.post<{ Params: { agentId: string; releaseId: string } }>("/admin/agents/:agentId/skill-releases/:releaseId/activate", { preHandler: requireAdminToken }, async (request, reply) => {
    if (env.DATA_MODE !== "database") return reply.code(409).send({ error: "database_mode_required" });
    const release = await prisma.skillRelease.findUnique({ where: { id: request.params.releaseId } });
    if (!release) return reply.code(404).send({ error: "skill_release_not_found" });
    const allowedBinding = await prisma.agentSkillBinding.findFirst({
      where: { agentId: request.params.agentId, skillRelease: { skillId: release.skillId } }
    });
    if (!allowedBinding) return reply.code(409).send({ error: "agent_skill_not_allowed" });
    const result = await prisma.$transaction(async (tx: any) => {
      const bindings = await tx.agentSkillBinding.findMany({
        where: { agentId: request.params.agentId },
        include: { skillRelease: true }
      });
      const matchingBindings = bindings.filter((item: any) => item.skillRelease.skillId === release.skillId);
      const capabilities = await tx.agentCapability.findMany({
        where: { agentId: request.params.agentId },
        include: { skillRelease: true }
      });
      const capabilityIds = capabilities
        .filter((item: any) => item.skillRelease.skillId === release.skillId)
        .map((item: any) => item.id);
      await tx.agentSkillBinding.deleteMany({
        where: { id: { in: matchingBindings.map((item: any) => item.id) } }
      });
      await tx.agentSkillBinding.create({
        data: {
          agentId: request.params.agentId,
          skillReleaseId: release.id,
          isDefault: matchingBindings.some((item: any) => item.isDefault)
        }
      });
      if (capabilityIds.length > 0) {
        await tx.agentCapability.updateMany({
          where: { id: { in: capabilityIds } },
          data: { skillReleaseId: release.id }
        });
      }
      await tx.skillRelease.update({
        where: { id: release.id },
        data: { status: "active", publishedAt: release.publishedAt ?? new Date() }
      });
      return { capabilityIds, previousReleaseIds: matchingBindings.map((item: any) => item.skillReleaseId) };
    });
    return { activated: true, agentId: request.params.agentId, releaseId: release.id, ...result };
  });

  app.patch<{ Params: { agentId: string } }>("/admin/agents/:agentId", { preHandler: requireAdminToken }, async (request, reply) => {
    const parsed = agentPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const agent = await prisma.agentDefinition.update({
      where: { id: request.params.agentId },
      data: {
        ...parsed.data,
        marketing: parsed.data.marketing as Prisma.InputJsonValue | undefined
      }
    });
    return { agent };
  });

  app.put("/admin/agent-offers", { preHandler: requireAdminToken }, async (request, reply) => {
    const parsed = offerSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const offer = await prisma.$transaction(async (tx: any) => {
      const saved = await tx.agentOffer.upsert({
        where: { code: parsed.data.code },
        update: {
          name: parsed.data.name,
          description: parsed.data.description,
          status: parsed.data.status,
          amountCny: parsed.data.amountCny,
          credits: parsed.data.credits,
          durationDays: parsed.data.durationDays
        },
        create: {
          code: parsed.data.code,
          name: parsed.data.name,
          description: parsed.data.description,
          status: parsed.data.status,
          amountCny: parsed.data.amountCny,
          credits: parsed.data.credits,
          durationDays: parsed.data.durationDays
        }
      });
      await tx.agentOfferAgent.deleteMany({ where: { offerId: saved.id } });
      await tx.agentOfferAgent.createMany({
        data: parsed.data.agentIds.map((agentId) => ({ offerId: saved.id, agentId }))
      });
      return saved;
    });
    return { offer };
  });

  app.post("/admin/agent-entitlements", { preHandler: requireAdminToken }, async (request, reply) => {
    const parsed = entitlementSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const status = parsed.data.action === "grant" ? "active" : parsed.data.action === "pause" ? "paused" : "revoked";
    const entitlement = await prisma.tenantAgentEntitlement.upsert({
      where: { tenantId_agentId: { tenantId: parsed.data.tenantId, agentId: parsed.data.agentId } },
      update: { status, expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null, source: "admin" },
      create: {
        tenantId: parsed.data.tenantId,
        agentId: parsed.data.agentId,
        status,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
        source: "admin"
      }
    });
    if (parsed.data.action === "grant") {
      for (const membershipId of parsed.data.membershipIds) {
        await prisma.memberAgentAccess.upsert({
          where: { membershipId_agentId: { membershipId, agentId: parsed.data.agentId } },
          update: {},
          create: { membershipId, agentId: parsed.data.agentId }
        });
      }
    }
    return { entitlement };
  });

  app.get("/account/agent-access", async (request) => {
    const context = await resolveRequestContext(request.headers);
    if (context.source !== "database") return { dataMode: "demo", members: [], agents: [] };
    const [members, entitlements] = await Promise.all([
      prisma.membership.findMany({
        where: { tenantId: context.tenantId, isActive: true },
        include: { user: true, agentAccess: { include: { agent: true } } }
      }),
      prisma.tenantAgentEntitlement.findMany({
        where: { tenantId: context.tenantId, status: "active" },
        include: { agent: true }
      })
    ]);
    return { dataMode: "database", members, agents: entitlements.map((item) => item.agent) };
  });

  app.put<{ Params: { membershipId: string } }>("/account/members/:membershipId/agents", async (request, reply) => {
    const parsed = memberAccessSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const context = await resolveRequestContext(request.headers);
    if (context.role !== "owner" && context.role !== "admin") return reply.code(403).send({ error: "admin_role_required" });
    const membership = await prisma.membership.findFirst({
      where: { id: request.params.membershipId, tenantId: context.tenantId, isActive: true }
    });
    if (!membership) return reply.code(404).send({ error: "membership_not_found" });
    const entitled = await prisma.tenantAgentEntitlement.findMany({
      where: { tenantId: context.tenantId, status: "active" },
      select: { agentId: true }
    });
    const allowed = new Set(entitled.map((item) => item.agentId));
    if (parsed.data.agentIds.some((agentId) => !allowed.has(agentId))) {
      return reply.code(403).send({ error: "agent_not_entitled" });
    }
    await prisma.$transaction(async (tx: any) => {
      await tx.memberAgentAccess.deleteMany({ where: { membershipId: membership.id } });
      if (parsed.data.agentIds.length > 0) {
        await tx.memberAgentAccess.createMany({
          data: parsed.data.agentIds.map((agentId) => ({ membershipId: membership.id, agentId }))
        });
      }
    });
    return { updated: true, membershipId: membership.id, agentIds: parsed.data.agentIds };
  });
}

function readReleasePrompt(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prompt = (value as Record<string, unknown>).prompt;
  return typeof prompt === "string" ? prompt : undefined;
}
