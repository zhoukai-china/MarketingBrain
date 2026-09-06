import type { FastifyInstance } from "fastify";
import { prisma } from "@baolu/db";
import { env } from "../config/env.js";
import { resolveRequestContext } from "../services/request-context.js";
import { buildLanqiDiagnosis } from "../services/lanqi-diagnosis.js";
import { emptyLanqiStoreProfile, getDemoLanqiStoreProfile, toLanqiStoreProfileView } from "../services/lanqi-store-profile.js";

export async function registerLanqiDiagnosisRoutes(app: FastifyInstance): Promise<void> {
  app.get("/lanqi/diagnosis/current", async (request) => {
    const context = await resolveRequestContext(request.headers);
    if (env.DATA_MODE === "demo") {
      const saved = getDemoLanqiStoreProfile(context.tenantId);
      const profile = saved ? toLanqiStoreProfileView(saved, context.role) : emptyLanqiStoreProfile(context.role);
      return { dataMode: "demo", report: buildLanqiDiagnosis(profile) };
    }

    const record = await prisma.lanqiStoreProfile.findUnique({ where: { tenantId: context.tenantId } });
    const profile = record ? toLanqiStoreProfileView(record, context.role) : emptyLanqiStoreProfile(context.role);
    return { dataMode: "database", report: buildLanqiDiagnosis(profile) };
  });
}
