import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@baolu/db";
import { env } from "../config/env.js";
import { createDeviceToken, getDeviceToken, hashDeviceToken } from "../services/desktop-auth.js";
import {
  claimDemoAutomationTasks,
  getDemoDesktopDeviceByToken,
  saveDemoDesktopDevice,
  taskRequiresConfirmation,
  updateDemoAutomationTask
} from "../services/demo-automation.js";
import { toPrismaJson } from "../services/prisma-json.js";
import { resolveRequestContext } from "../services/request-context.js";
import { nextRecurringAutomationRun } from "../services/automation-schedule.js";

const registerDeviceSchema = z.object({
  deviceName: z.string().min(1),
  platform: z.string().min(1),
  appVersion: z.string().optional()
});

const pollQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(5)
});

const updateTaskSchema = z.object({
  status: z.enum([
    "requires_user_confirm",
    "approved",
    "running",
    "succeeded",
    "failed",
    "canceled"
  ]),
  confirmationStatus: z.enum(["not_required", "required", "approved", "rejected"]).optional(),
  message: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});

export async function registerDesktopRoutes(app: FastifyInstance): Promise<void> {
  app.post("/desktop/devices/register", async (request, reply) => {
    const parsed = registerDeviceSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const context = await resolveRequestContext(request.headers);
    const deviceToken = createDeviceToken();

    if (env.DATA_MODE === "demo") {
      const device = saveDemoDesktopDevice({
        tenantId: context.tenantId,
        userId: context.userId,
        deviceName: parsed.data.deviceName,
        platform: parsed.data.platform,
        appVersion: parsed.data.appVersion,
        deviceToken
      });
      return {
        dataMode: "demo",
        device,
        deviceToken
      };
    }

    const device = await prisma.desktopDevice.create({
      data: {
        tenantId: context.tenantId,
        userId: context.userId,
        deviceName: parsed.data.deviceName,
        platform: parsed.data.platform,
        appVersion: parsed.data.appVersion,
        deviceTokenHash: hashDeviceToken(deviceToken)
      }
    });

    return {
      dataMode: "database",
      device,
      deviceToken
    };
  });

  app.get("/desktop/tasks/poll", async (request, reply) => {
    const parsed = pollQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const deviceToken = getDeviceToken(request.headers);
    if (!deviceToken) {
      return reply.code(401).send({ error: "device_token_required" });
    }

    if (env.DATA_MODE === "demo") {
      const device = getDemoDesktopDeviceByToken(deviceToken);
      if (!device) {
        return reply.code(401).send({ error: "device_not_found" });
      }
      const tasks = claimDemoAutomationTasks({
        tenantId: device.tenantId,
        deviceId: device.id,
        limit: parsed.data.limit
      });
      return {
        dataMode: "demo",
        deviceId: device.id,
        tasks
      };
    }

    const device = await prisma.desktopDevice.findUnique({
      where: {
        deviceTokenHash: hashDeviceToken(deviceToken)
      }
    });
    if (!device) {
      return reply.code(401).send({ error: "device_not_found" });
    }

    const now = new Date();
    const tasks = await prisma.$transaction(async (tx: any) => {
      await tx.desktopDevice.update({
        where: { id: device.id },
        data: { lastSeenAt: now }
      });

      const candidates = await tx.automationTask.findMany({
        where: {
          tenantId: device.tenantId,
          status: {
            in: ["draft", "pending"]
          },
          runAt: {
            lte: now
          }
        },
        orderBy: { runAt: "asc" },
        take: parsed.data.limit
      });

      const claimed = [];
      for (const task of candidates) {
        const confirmationRequired = taskRequiresConfirmation(task.type as any);
        claimed.push(
          await tx.automationTask.update({
            where: { id: task.id },
            data: {
              deviceId: device.id,
              status: confirmationRequired ? "requires_user_confirm" : "claimed",
              confirmationRequired,
              confirmationStatus: confirmationRequired ? "required" : "not_required",
              lockedAt: now,
              logs: {
                create: {
                  message: "桌面端已领取任务",
                  metadata: toPrismaJson({
                    deviceId: device.id,
                    deviceName: device.deviceName
                  })
                }
              }
            }
          })
        );
      }
      return claimed;
    });

    return {
      dataMode: "database",
      deviceId: device.id,
      tasks
    };
  });

  app.post<{ Params: { taskId: string } }>("/desktop/tasks/:taskId/status", async (request, reply) => {
    const parsed = updateTaskSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    const deviceToken = getDeviceToken(request.headers);
    if (!deviceToken) {
      return reply.code(401).send({ error: "device_token_required" });
    }

    if (env.DATA_MODE === "demo") {
      const device = getDemoDesktopDeviceByToken(deviceToken);
      if (!device) {
        return reply.code(401).send({ error: "device_not_found" });
      }
      const task = updateDemoAutomationTask({
        tenantId: device.tenantId,
        deviceId: device.id,
        taskId: request.params.taskId,
        status: parsed.data.status,
        confirmationStatus: parsed.data.confirmationStatus
      });
      if (!task) {
        return reply.code(404).send({ error: "task_not_found" });
      }
      return {
        dataMode: "demo",
        task
      };
    }

    const device = await prisma.desktopDevice.findUnique({
      where: {
        deviceTokenHash: hashDeviceToken(deviceToken)
      }
    });
    if (!device) {
      return reply.code(401).send({ error: "device_not_found" });
    }

    const task = await prisma.automationTask.findFirst({
      where: {
        id: request.params.taskId,
        tenantId: device.tenantId,
        deviceId: device.id
      }
    });
    if (!task) {
      return reply.code(404).send({ error: "task_not_found" });
    }

    const nextRun = parsed.data.status === "succeeded"
      ? nextRecurringAutomationRun(task.payload, task.runAt)
      : undefined;
    const updated = await prisma.automationTask.update({
      where: { id: task.id },
      data: {
        status: nextRun ? "pending" : parsed.data.status,
        confirmationStatus: nextRun
          ? (task.confirmationRequired ? "required" : "not_required")
          : parsed.data.confirmationStatus,
        ...(nextRun ? { runAt: nextRun, deviceId: null, lockedAt: null } : {}),
        logs: {
          create: {
            message: nextRun
              ? `本次执行成功，已按循环计划安排下次执行：${nextRun.toISOString()}`
              : parsed.data.message ?? `桌面端更新任务状态：${parsed.data.status}`,
            level: parsed.data.status === "failed" ? "error" : "info",
            metadata: toPrismaJson(parsed.data.metadata ?? {})
          }
        }
      },
      include: {
        logs: {
          orderBy: { createdAt: "desc" },
          take: 5
        }
      }
    });

    return {
      dataMode: "database",
      task: updated
    };
  });
}

