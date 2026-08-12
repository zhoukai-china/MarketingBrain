import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@baolu/db";
import { env } from "../config/env.js";
import { resolveRequestContext } from "../services/request-context.js";
import { OUTCOME_EVENT_TYPES } from "../services/continuous-improvement.js";

const OUTCOME_METADATA_KEYS = new Set([
  "surface",
  "action",
  "resultCode",
  "durationMs",
  "editRatio",
  "businessMetric",
  "businessValueBucket",
  "source"
]);
const SENSITIVE_METADATA_PATTERN =
  /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?<!\d)1[3-9]\d{9}(?!\d)|api[_-]?key|token|secret|password|身份证)/i;

export const feedbackSchema = z
  .object({
    rating: z.number().int().min(1).max(5).optional(),
    feedbackKey: z.string().trim().min(1).max(120).optional(),
    issueType: z.string().trim().min(1).max(80).optional(),
    reasonCodes: z.array(z.string().trim().min(1).max(80)).min(1).max(10).optional(),
    note: z.string().trim().min(1).max(2_000).optional()
  })
  .refine(
    (value) =>
      value.rating !== undefined ||
      value.issueType !== undefined ||
      value.reasonCodes !== undefined ||
      value.note !== undefined,
    { message: "at_least_one_feedback_field_required" }
  );

export const outcomeSchema = z
  .object({
    eventKey: z.string().trim().min(1).max(120).optional(),
    eventType: z.enum(OUTCOME_EVENT_TYPES),
    value: z.number().finite().min(-1_000_000).max(1_000_000).optional(),
    metadata: z
      .record(z.union([z.string().max(200), z.number().finite(), z.boolean(), z.null()]))
      .optional()
  })
  .refine((value) => JSON.stringify(value.metadata ?? {}).length <= 2_000, {
    message: "metadata_too_large"
  })
  .refine((value) => Object.keys(value.metadata ?? {}).every((key) => OUTCOME_METADATA_KEYS.has(key)), {
    message: "metadata_key_not_allowed"
  })
  .refine(
    (value) =>
      !Object.values(value.metadata ?? {}).some(
        (item) => typeof item === "string" && SENSITIVE_METADATA_PATTERN.test(item)
      ),
    {
      message: "sensitive_metadata_not_allowed"
    }
  );

export async function registerFeedbackRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { agentRunId: string } }>(
    "/agent-runs/:agentRunId/feedback",
    async (request, reply) => {
      const parsed = feedbackSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      }
      const context = await resolveRequestContext(request.headers);

      if (env.DATA_MODE === "demo") {
        return {
          dataMode: "demo",
          saved: false,
          feedback: parsed.data
        };
      }

      const agentRun = await prisma.agentRun.findFirst({
        where: {
          id: request.params.agentRunId,
          tenantId: context.tenantId
        }
      });
      if (!agentRun) {
        return reply.code(404).send({ error: "agent_run_not_found" });
      }

      const data = {
        agentRunId: agentRun.id,
        feedbackKey: parsed.data.feedbackKey,
        userId: context.userId,
        rating: parsed.data.rating,
        issueType: parsed.data.issueType,
        reasonCodes: parsed.data.reasonCodes,
        note: parsed.data.note
      };
      const feedback = parsed.data.feedbackKey
        ? await prisma.qualityFeedback.upsert({
            where: {
              agentRunId_feedbackKey: {
                agentRunId: agentRun.id,
                feedbackKey: parsed.data.feedbackKey
              }
            },
            create: data,
            update: {
              rating: parsed.data.rating,
              issueType: parsed.data.issueType,
              reasonCodes: parsed.data.reasonCodes,
              note: parsed.data.note,
              userId: context.userId
            }
          })
        : await prisma.qualityFeedback.create({ data });

      return {
        dataMode: "database",
        saved: true,
        idempotencyProtected: Boolean(parsed.data.feedbackKey),
        feedback
      };
    }
  );

  app.post<{ Params: { agentRunId: string } }>(
    "/agent-runs/:agentRunId/outcomes",
    async (request, reply) => {
      const parsed = outcomeSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      }
      const context = await resolveRequestContext(request.headers);

      if (env.DATA_MODE === "demo") {
        return {
          dataMode: "demo",
          saved: false,
          outcome: parsed.data
        };
      }

      const agentRun = await prisma.agentRun.findFirst({
        where: {
          id: request.params.agentRunId,
          tenantId: context.tenantId
        },
        select: { id: true, tenantId: true }
      });
      if (!agentRun) {
        return reply.code(404).send({ error: "agent_run_not_found" });
      }

      const data = {
        agentRunId: agentRun.id,
        tenantId: agentRun.tenantId,
        userId: context.userId,
        eventKey: parsed.data.eventKey,
        eventType: parsed.data.eventType,
        value: parsed.data.value,
        metadata: parsed.data.metadata
      };
      const outcome = parsed.data.eventKey
        ? await prisma.agentOutcomeEvent.upsert({
            where: {
              agentRunId_eventKey: {
                agentRunId: agentRun.id,
                eventKey: parsed.data.eventKey
              }
            },
            create: data,
            update: {}
          })
        : await prisma.agentOutcomeEvent.create({ data });

      return {
        dataMode: "database",
        saved: true,
        idempotencyProtected: Boolean(parsed.data.eventKey),
        outcome
      };
    }
  );
}
