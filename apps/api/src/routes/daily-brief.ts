import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { LlmProvider } from "@baolu/agent";
import { resolveRequestContext } from "../services/request-context.js";
import {
  buildDailyBriefHistory,
  ensureDailyBriefReport,
  getBeijingDate
} from "../services/daily-brief.js";

const preferenceSchema = z.object({
  pushTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
});

export async function registerDailyBriefRoutes(app: FastifyInstance, provider: LlmProvider): Promise<void> {
  app.get("/daily-brief/today", async (request) => {
    const context = await resolveRequestContext(request.headers);
    const report = await ensureDailyBriefReport(provider);
    return {
      report,
      preference: buildPreference(context.tenantId),
      push: buildPushLog(),
      unread: false
    };
  });

  app.get("/daily-brief/history", async (request) => {
    await resolveRequestContext(request.headers);
    const report = await ensureDailyBriefReport(provider);
    return {
      reports: buildDailyBriefHistory(report)
    };
  });

  app.get("/daily-brief/status", async (request) => {
    const context = await resolveRequestContext(request.headers);
    const report = await ensureDailyBriefReport(provider, getBeijingDate());
    return {
      hasTodayReport: true,
      unread: false,
      report,
      preference: buildPreference(context.tenantId)
    };
  });

  app.post("/daily-brief/read", async (request) => {
    await resolveRequestContext(request.headers);
    return {
      ok: true,
      push: buildPushLog()
    };
  });

  app.put("/daily-brief/preference", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const parsed = preferenceSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        message: "请选择有效时间格式，例如 09:00"
      });
    }
    return {
      ok: true,
      preference: buildPreference(context.tenantId, parsed.data.pushTime)
    };
  });

  app.post("/daily-brief/run-scheduler", async () => {
    const report = await ensureDailyBriefReport(provider);
    return {
      due: true,
      pushed: 1,
      report
    };
  });
}

function buildPreference(tenantId: string, pushTime = "09:00") {
  return {
    id: `daily-preference-${tenantId}`,
    tenantId,
    pushTime,
    timezone: "Asia/Shanghai",
    enabled: true
  };
}

function buildPushLog() {
  return {
    id: "daily-read",
    status: "read",
    scheduledAt: null,
    pushedAt: new Date().toISOString(),
    readAt: new Date().toISOString()
  };
}
