import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@baolu/db";
import { env } from "../config/env.js";
import { requireAdminToken } from "../services/access-guards.js";

const decisionSchema = z.object({
  decision: z.enum(["approve_for_evaluation", "reject"]),
  note: z.string().trim().min(1).max(2_000)
});

export async function registerContinuousImprovementRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/continuous-improvement/latest", { preHandler: requireAdminToken }, async () => {
    if (env.DATA_MODE === "demo") {
      return {
        dataMode: "demo",
        snapshot: null,
        clusters: [],
        candidates: [],
        note: "Set DATA_MODE=database and run quality:daily:apply to create a persisted snapshot."
      };
    }

    const snapshot = await prisma.dailyQualitySnapshot.findFirst({
      orderBy: [{ snapshotDate: "desc" }, { generatedAt: "desc" }],
      include: {
        failureClusters: {
          orderBy: [{ severity: "asc" }, { occurrenceCount: "desc" }],
          take: 50
        },
        improvementCandidates: {
          orderBy: { createdAt: "desc" },
          take: 50
        }
      }
    });

    return {
      dataMode: "database",
      snapshot
    };
  });

  app.get("/admin/continuous-improvement/candidates", { preHandler: requireAdminToken }, async (request, reply) => {
    if (env.DATA_MODE === "demo") return { dataMode: "demo", candidates: [] };
    const parsedQuery = z
      .object({ status: z.string().trim().min(1).max(40).optional() })
      .safeParse(request.query ?? {});
    if (!parsedQuery.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsedQuery.error.flatten() });
    }
    const query = parsedQuery.data;
    const candidates = await prisma.improvementCandidate.findMany({
      where: query.status ? { status: query.status } : undefined,
      orderBy: [{ createdAt: "desc" }],
      take: 100,
      include: {
        sourceCluster: {
          select: {
            fingerprint: true,
            category: true,
            severity: true,
            occurrenceCount: true,
            evidenceSummary: true
          }
        },
        experiments: {
          orderBy: { createdAt: "desc" },
          take: 5
        }
      }
    });
    return { dataMode: "database", candidates };
  });

  app.get("/admin/continuous-improvement/eval-drafts", { preHandler: requireAdminToken }, async () => {
    if (env.DATA_MODE === "demo") return { dataMode: "demo", evalDrafts: [] };
    const evalDrafts = await prisma.learnedEvalCase.findMany({
      where: { status: "draft" },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        sourceCluster: {
          select: {
            category: true,
            severity: true,
            occurrenceCount: true
          }
        }
      }
    });
    return { dataMode: "database", evalDrafts };
  });

  app.post<{ Params: { candidateId: string } }>(
    "/admin/continuous-improvement/candidates/:candidateId/decision",
    { preHandler: requireAdminToken },
    async (request, reply) => {
      if (env.DATA_MODE === "demo") {
        return reply.code(409).send({
          error: "database_mode_required",
          message: "候选改进决策需要 DATA_MODE=database"
        });
      }
      const parsed = decisionSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      }

      const candidate = await prisma.improvementCandidate.findUnique({
        where: { id: request.params.candidateId }
      });
      if (!candidate) return reply.code(404).send({ error: "improvement_candidate_not_found" });
      if (!["awaiting_review", "approved_for_evaluation", "rejected"].includes(candidate.status)) {
        return reply.code(409).send({
          error: "candidate_state_conflict",
          message: "当前候选已进入实验或发布流程，不能通过评审接口覆盖状态"
        });
      }

      const status = parsed.data.decision === "approve_for_evaluation" ? "approved_for_evaluation" : "rejected";
      const updated = await prisma.improvementCandidate.update({
        where: { id: candidate.id },
        data: {
          status,
          decisionNote: parsed.data.note,
          decidedAt: new Date()
        }
      });

      return {
        dataMode: "database",
        candidate: updated,
        productionChanged: false,
        nextGate:
          status === "approved_for_evaluation"
            ? "离线评测通过后，另行创建 challenger 实验；本接口不会发布到生产。"
            : null
      };
    }
  );
}
