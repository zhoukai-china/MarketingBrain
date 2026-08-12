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
import { assertAgentAccess, getRuntimeAgent } from "../services/agent-runtime.js";

const automationTaskTypes = [
  "daily_business_advice",
  "weekly_topic_push",
  "moments_push",
  "inactive_user_wakeup",
  "profile_completion",
  "subscription_expiry",
  "file_analysis_followup",
  "audio_card_analysis",
  "local_push_ad_plan",
  "local_push_ad_adjustment",
  "video_publish_plan",
  "video_publish_execution",
  "ceo_action_order"
] as const;

const createTaskSchema = z.object({
  type: z.enum(automationTaskTypes),
  payload: z.record(z.unknown()).default({}),
  runAt: z.string().datetime().optional()
});

const updateTaskSchema = z.object({
  action: z.enum(["pause", "resume", "cancel"]),
  runAt: z.string().datetime().optional()
});

export async function registerAutomationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/automation/capabilities", async (request) => {
    const context = await resolveRequestContext(request.headers);
    return {
      dataMode: context.source,
      planCode: context.planCode,
      capabilities: {
        basicPush: true,
        advancedAutomation: true,
        audioCardAnalysis: true,
        localPushAdAssist: true,
        videoPublishAssist: true,
        requiresUserConfirmation: [
          "充值",
          "提交投放",
          "开启投放",
          "修改预算",
          "正式发布视频",
          "删除视频"
        ]
      }
    };
  });

  app.get("/automation/tasks", async (request) => {
    const context = await resolveRequestContext(request.headers);
    if (env.DATA_MODE === "demo") {
      const tasks = listDemoAutomationTasks(context.tenantId).filter((task) => canManageAutomationTask(context, task.payload));
      return {
        dataMode: "demo",
        tasks
      };
    }

    const tasks = await prisma.automationTask.findMany({
      where: { tenantId: context.tenantId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        logs: {
          orderBy: { createdAt: "desc" },
          take: 3
        }
      }
    });
    return {
      dataMode: "database",
      tasks: tasks.filter((task: any) => canManageAutomationTask(context, task.payload))
    };
  });

  app.post("/automation/tasks", async (request, reply) => {
    const parsed = createTaskSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const context = await resolveRequestContext(request.headers);
    const requestedAgent = typeof parsed.data.payload.agentSlug === "string"
      ? parsed.data.payload.agentSlug.trim()
      : typeof parsed.data.payload.agentId === "string"
        ? parsed.data.payload.agentId.trim()
        : "";
    let taskPayload = parsed.data.payload;
    if (requestedAgent) {
      let agent;
      try {
        agent = await getRuntimeAgent(requestedAgent);
      } catch {
        return reply.code(400).send({ error: "automation_agent_not_found", message: "未找到要配置自动化的智能体。" });
      }
      try {
        await assertAgentAccess(context, agent);
      } catch {
        return reply.code(403).send({ error: "automation_agent_access_denied", message: "当前账号没有配置这个智能体自动化的权限。" });
      }
      const automationAction = agent.marketing?.automationAction;
      if (!automationAction?.enabled) {
        return reply.code(400).send({ error: "automation_not_enabled", message: "当前智能体尚未启用自动化能力。" });
      }
      if (!automationAction.allowedTaskTypes.includes(parsed.data.type)) {
        return reply.code(400).send({ error: "automation_type_not_allowed", message: "当前智能体不支持这种自动化任务。" });
      }
      const requestedCapabilityId = typeof parsed.data.payload.capabilityId === "string"
        ? parsed.data.payload.capabilityId.trim()
        : automationAction.capabilityId;
      if (requestedCapabilityId && !agent.capabilities.some((item) => item.key === requestedCapabilityId)) {
        return reply.code(400).send({ error: "automation_capability_not_allowed", message: "自动化任务指定的智能体能力不存在。" });
      }
      taskPayload = {
        ...parsed.data.payload,
        agentId: agent.id,
        agentSlug: agent.slug,
        agentName: agent.name,
        capabilityId: requestedCapabilityId
      };
    }
    taskPayload = { ...taskPayload, createdByUserId: context.userId };

    const runAt = parsed.data.runAt ? new Date(parsed.data.runAt) : new Date();
    if (env.DATA_MODE === "demo") {
      const task = createDemoAutomationTask({
        tenantId: context.tenantId,
        userId: context.userId,
        type: parsed.data.type,
        payload: taskPayload,
        runAt
      });
      return {
        dataMode: "demo",
        task
      };
    }

    const task = await prisma.automationTask.create({
      data: {
        tenantId: context.tenantId,
        type: parsed.data.type,
        payload: toPrismaJson(taskPayload),
        runAt,
        status: "draft",
        logs: {
          create: {
            message: "任务已创建，等待用户确认或调度执行",
            metadata: toPrismaJson({
              userId: context.userId,
              source: "api"
            })
          }
        }
      },
      include: {
        logs: true
      }
    });

    return {
      dataMode: "database",
      task
    };
  });

  app.patch<{ Params: { taskId: string } }>("/automation/tasks/:taskId", async (request, reply) => {
    const parsed = updateTaskSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const context = await resolveRequestContext(request.headers);
    const requestedRunAt = parsed.data.runAt ? new Date(parsed.data.runAt) : undefined;
    const status = parsed.data.action === "pause"
      ? "paused"
      : parsed.data.action === "cancel"
        ? "canceled"
        : "pending";

    if (env.DATA_MODE === "demo") {
      const existing = listDemoAutomationTasks(context.tenantId).find((item) => item.id === request.params.taskId);
      if (!existing) return reply.code(404).send({ error: "task_not_found" });
      if (!canManageAutomationTask(context, existing.payload)) return reply.code(403).send({ error: "automation_task_access_denied" });
      const runAt = parsed.data.action === "resume"
        ? requestedRunAt ?? (new Date(existing.runAt).getTime() < Date.now() ? new Date() : new Date(existing.runAt))
        : undefined;
      const task = updateDemoAutomationTaskByOwner({
        tenantId: context.tenantId,
        taskId: request.params.taskId,
        status,
        runAt,
        resetClaim: parsed.data.action === "resume"
      });
      return { dataMode: "demo", task };
    }

    const existing = await prisma.automationTask.findFirst({
      where: { id: request.params.taskId, tenantId: context.tenantId }
    });
    if (!existing) return reply.code(404).send({ error: "task_not_found" });
    if (!canManageAutomationTask(context, existing.payload)) return reply.code(403).send({ error: "automation_task_access_denied" });

    const runAt = parsed.data.action === "resume"
      ? requestedRunAt ?? (existing.runAt.getTime() < Date.now() ? new Date() : existing.runAt)
      : existing.runAt;
    const task = await prisma.automationTask.update({
      where: { id: existing.id },
      data: {
        status,
        runAt,
        ...(parsed.data.action === "resume" ? {
          deviceId: null,
          lockedAt: null,
          confirmationStatus: existing.confirmationRequired ? "required" : "not_required"
        } : {}),
        logs: {
          create: {
            message: parsed.data.action === "pause" ? "用户暂停自动化任务" : parsed.data.action === "cancel" ? "用户取消自动化任务" : "用户恢复自动化任务",
            metadata: toPrismaJson({ userId: context.userId, source: "automation_center" })
          }
        }
      },
      include: { logs: { orderBy: { createdAt: "desc" }, take: 5 } }
    });
    return { dataMode: "database", task };
  });

  app.post<{ Params: { taskId: string } }>("/automation/tasks/:taskId/run-now", async (request, reply) => {
    const context = await resolveRequestContext(request.headers);
    const runAt = new Date();

    if (env.DATA_MODE === "demo") {
      const existing = listDemoAutomationTasks(context.tenantId).find((item) => item.id === request.params.taskId);
      if (!existing) return reply.code(404).send({ error: "task_not_found" });
      if (!canManageAutomationTask(context, existing.payload)) return reply.code(403).send({ error: "automation_task_access_denied" });
      const task = updateDemoAutomationTaskByOwner({
        tenantId: context.tenantId,
        taskId: request.params.taskId,
        status: "pending",
        runAt,
        resetClaim: true
      });
      if (!task) return reply.code(404).send({ error: "task_not_found" });
      return { dataMode: "demo", task };
    }

    const existing = await prisma.automationTask.findFirst({
      where: { id: request.params.taskId, tenantId: context.tenantId }
    });
    if (!existing) return reply.code(404).send({ error: "task_not_found" });
    if (!canManageAutomationTask(context, existing.payload)) return reply.code(403).send({ error: "automation_task_access_denied" });
    const task = await prisma.automationTask.update({
      where: { id: existing.id },
      data: {
        status: "pending",
        runAt,
        deviceId: null,
        lockedAt: null,
        confirmationStatus: existing.confirmationRequired ? "required" : "not_required",
        logs: {
          create: {
            message: "用户要求立即执行自动化任务",
            metadata: toPrismaJson({ userId: context.userId, source: "automation_center" })
          }
        }
      },
      include: { logs: { orderBy: { createdAt: "desc" }, take: 5 } }
    });
    return { dataMode: "database", task };
  });
}

function canManageAutomationTask(context: { role: string; userId: string }, payload: unknown): boolean {
  if (context.role === "owner" || context.role === "admin") return true;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  return (payload as Record<string, unknown>).createdByUserId === context.userId;
}

