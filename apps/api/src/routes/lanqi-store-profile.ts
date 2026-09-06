import type { FastifyInstance } from "fastify";
import { prisma } from "@baolu/db";
import { z } from "zod";
import { env } from "../config/env.js";
import { resolveRequestContext } from "../services/request-context.js";
import {
  LANQI_STORE_PROFILE_FIELDS,
  canEditLanqiStoreProfile,
  emptyLanqiStoreProfile,
  getDemoLanqiStoreProfile,
  saveDemoLanqiStoreProfile,
  toLanqiStoreProfileView,
  validateLanqiStoreProfilePayload,
  type LanqiStoreProfileFacts,
  type LanqiStoreProfileField,
  type LanqiStoreProfilePayload,
} from "../services/lanqi-store-profile.js";

const scalarValueSchema = z.string().trim().min(1).max(500);
const listValueSchema = z.array(z.string().trim().min(1).max(80)).min(1).max(20);
const factsShape = Object.fromEntries(
  LANQI_STORE_PROFILE_FIELDS.map(field => [field, z.union([scalarValueSchema, listValueSchema]).optional()])
) as Record<LanqiStoreProfileField, z.ZodOptional<z.ZodUnion<[typeof scalarValueSchema, typeof listValueSchema]>>>;
const factsSchema = z.object(factsShape).strict();
const storeProfileSchema = z.object({
  confirmedFacts: factsSchema,
  estimatedFacts: factsSchema,
  needsInput: z.array(z.enum(LANQI_STORE_PROFILE_FIELDS)).max(LANQI_STORE_PROFILE_FIELDS.length),
});

export async function registerLanqiStoreProfileRoutes(app: FastifyInstance): Promise<void> {
  app.get("/lanqi/store-profile", async (request) => {
    const context = await resolveRequestContext(request.headers);
    if (env.DATA_MODE === "demo") {
      const profile = getDemoLanqiStoreProfile(context.tenantId);
      return {
        dataMode: "demo",
        profile: profile ? toLanqiStoreProfileView(profile, context.role) : emptyLanqiStoreProfile(context.role),
      };
    }

    const profile = await prisma.lanqiStoreProfile.findUnique({ where: { tenantId: context.tenantId } });
    return {
      dataMode: "database",
      profile: profile ? toLanqiStoreProfileView(profile, context.role) : emptyLanqiStoreProfile(context.role),
    };
  });

  app.put("/lanqi/store-profile", async (request, reply) => {
    const parsed = storeProfileSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const context = await resolveRequestContext(request.headers);
    if (!canEditLanqiStoreProfile(context.role)) {
      return reply.code(403).send({ error: "lanqi_store_profile_admin_required", message: "只有门店老板或管理员可以修改经营档案。" });
    }
    const payload = parsed.data as LanqiStoreProfilePayload;
    const validationErrors = validateLanqiStoreProfilePayload(payload);
    if (validationErrors.length) {
      return reply.code(400).send({ error: "fact_source_conflict", validationErrors });
    }

    if (env.DATA_MODE === "demo") {
      const profile = saveDemoLanqiStoreProfile(context.tenantId, payload);
      return { dataMode: "demo", event: "lanqi_store_profile_saved", profile: toLanqiStoreProfileView(profile, context.role) };
    }

    const profile = await prisma.$transaction(async tx => {
      const saved = await tx.lanqiStoreProfile.upsert({
        where: { tenantId: context.tenantId },
        create: {
          tenantId: context.tenantId,
          confirmedFacts: payload.confirmedFacts,
          estimatedFacts: payload.estimatedFacts,
          needsInput: payload.needsInput,
        },
        update: {
          confirmedFacts: payload.confirmedFacts,
          estimatedFacts: payload.estimatedFacts,
          needsInput: payload.needsInput,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          userId: context.userId,
          action: "lanqi_store_profile.updated",
          resource: "lanqi_store_profile",
          resourceId: saved.id,
          detail: JSON.stringify({
            confirmedFieldCount: Object.keys(payload.confirmedFacts).length,
            estimatedFieldCount: Object.keys(payload.estimatedFacts).length,
            needsInputCount: payload.needsInput.length,
          }),
        },
      });
      return saved;
    });
    return { dataMode: "database", event: "lanqi_store_profile_saved", profile: toLanqiStoreProfileView(profile, context.role) };
  });
}
