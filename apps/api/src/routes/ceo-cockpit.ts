import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@baolu/db";
import { env } from "../config/env.js";
import {
  createDemoAutomationTask,
  listDemoAutomationTasks,
  updateDemoAutomationTaskByOwner
} from "../services/demo-automation.js";
import { toPrismaJson } from "../services/prisma-json.js";
import { resolveRequestContext } from "../services/request-context.js";

const createOrderSchema = z.object({
  title: z.string().trim().min(2).max(120),
  rationale: z.string().trim().max(1000).optional(),
  ownerRole: z.string().trim().max(80).optional(),
  dueAt: z.string().datetime().optional(),
  deliverable: z.string().trim().max(500).optional(),
  acceptanceCriteria: z.string().trim().max(1000).optional(),
  reviewAt: z.string().datetime().optional(),
  sourceRunId: z.string().trim().max(120).optional()
});

const updateOrderSchema = z.object({
  action: z.enum(["approve", "reject", "complete", "block"]),
  note: z.string().trim().max(1000).optional()
});

type ActionOrderPayload = z.infer<typeof createOrderSchema> & {
  approvalNote?: string;
  feedbackNote?: string;
};

export async function registerCeoCockpitRoutes(app: FastifyInstance): Promise<void> {
  app.get("/agents/ceo-cockpit/dashboard", async (request) => {
    const context = await resolveRequestContext(request.headers);
    if (env.DATA_MODE === "demo") {
      return {
        dataMode: "demo",
        dataStatus: { knowledgeCount: 0, latestKnowledgeAt: null, latestAnalysisAt: null },
        orders: listDemoAutomationTasks(context.tenantId)
          .filter((task) => task.type === "ceo_action_order")
          .slice(0, 20)
      };
    }

    const [knowledgeCount, latestKnowledge, latestAnalysis, orders] = await Promise.all([
      prisma.knowledgeDocument.count({ where: { tenantId: context.tenantId } }),
      prisma.knowledgeDocument.findFirst({
        where: { tenantId: context.tenantId },
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true }
      }),
      prisma.agentRun.findFirst({
        where: { tenantId: context.tenantId, agentId: "agent_ceo_cockpit", status: "succeeded" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true }
      }),
      prisma.automationTask.findMany({
        where: { tenantId: context.tenantId, type: "ceo_action_order" },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { logs: { orderBy: { createdAt: "desc" }, take: 3 } }
      })
    ]);

    return {
      dataMode: "database",
      dataStatus: {
        knowledgeCount,
        latestKnowledgeAt: latestKnowledge?.updatedAt ?? null,
        latestAnalysisAt: latestAnalysis?.createdAt ?? null
      },
      orders
    };
  });

  app.post("/agents/ceo-cockpit/orders", async (request, reply) => {
    const parsed = createOrderSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const context = await resolveRequestContext(request.headers);
    const runAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : new Date();

    if (env.DATA_MODE === "demo") {
      const task = createDemoAutomationTask({
        tenantId: context.tenantId,
        userId: context.userId,
        type: "ceo_action_order",
        payload: parsed.data,
        runAt
      });
      updateDemoAutomationTaskByOwner({ tenantId: context.tenantId, taskId: task.id, status: "proposed" });
      return reply.code(201).send({ dataMode: "demo", task });
    }

    const task = await prisma.automationTask.create({
      data: {
        tenantId: context.tenantId,
        userId: context.userId,
        type: "ceo_action_order",
        payload: toPrismaJson(parsed.data),
        runAt,
        status: "proposed",
        confirmationRequired: true,
        confirmationStatus: "required",
        logs: { create: { message: "行动令草案已创建，等待老板审批", metadata: toPrismaJson({ source: "ceo_cockpit" }) } }
      },
      include: { logs: true }
    });
    return reply.code(201).send({ dataMode: "database", task });
  });

  app.patch("/agents/ceo-cockpit/orders/:id", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const parsed = updateOrderSchema.safeParse(request.body ?? {});
    if (!params.success || !parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const context = await resolveRequestContext(request.headers);
    const next = orderTransition(parsed.data.action);

    if (env.DATA_MODE === "demo") {
      const current = listDemoAutomationTasks(context.tenantId).find((task) => task.id === params.data.id && task.type === "ceo_action_order");
      if (!current) return reply.code(404).send({ error: "order_not_found" });
      if (["approve", "reject"].includes(parsed.data.action) && current.confirmationStatus !== "required") {
        return reply.code(409).send({ error: "order_already_reviewed", message: "这条行动令已经审批，不能重复操作" });
      }
      const payload = withOrderNote(current.payload, parsed.data.action, parsed.data.note);
      const task = updateDemoAutomationTaskByOwner({
        tenantId: context.tenantId,
        taskId: current.id,
        status: next.status,
        confirmationStatus: next.confirmationStatus,
        payload
      });
      return { dataMode: "demo", task };
    }

    const current = await prisma.automationTask.findFirst({
      where: { id: params.data.id, tenantId: context.tenantId, type: "ceo_action_order" }
    });
    if (!current) return reply.code(404).send({ error: "order_not_found" });
    if (["approve", "reject"].includes(parsed.data.action) && current.confirmationStatus !== "required") {
      return reply.code(409).send({ error: "order_already_reviewed", message: "这条行动令已经审批，不能重复操作" });
    }

    const payload = withOrderNote(current.payload, parsed.data.action, parsed.data.note);
    const task = await prisma.automationTask.update({
      where: { id: current.id },
      data: {
        status: next.status,
        confirmationStatus: next.confirmationStatus,
        payload: toPrismaJson(payload),
        logs: { create: { message: next.logMessage, metadata: toPrismaJson({ action: parsed.data.action, note: parsed.data.note, userId: context.userId }) } }
      },
      include: { logs: { orderBy: { createdAt: "desc" }, take: 3 } }
    });
    return { dataMode: "database", task };
  });
}

function orderTransition(action: z.infer<typeof updateOrderSchema>["action"]): {
  status: string;
  confirmationStatus: string;
  logMessage: string;
} {
  if (action === "approve") return { status: "pending", confirmationStatus: "approved", logMessage: "老板已批准行动令，进入内部待执行队列" };
  if (action === "reject") return { status: "rejected", confirmationStatus: "rejected", logMessage: "老板已驳回行动令" };
  if (action === "complete") return { status: "completed", confirmationStatus: "approved", logMessage: "行动令已回传为完成" };
  return { status: "blocked", confirmationStatus: "approved", logMessage: "行动令执行受阻，等待处理" };
}

function withOrderNote(payload: unknown, action: z.infer<typeof updateOrderSchema>["action"], note?: string): ActionOrderPayload | Record<string, unknown> {
  const base = payload && typeof payload === "object" && !Array.isArray(payload)
    ? { ...(payload as Record<string, unknown>) }
    : {};
  if (action === "approve" || action === "reject") base.approvalNote = note;
  else base.feedbackNote = note;
  return base;
}
