import type { FastifyInstance } from "fastify";
import { prisma } from "@baolu/db";
import { z } from "zod";
import { env } from "../config/env.js";
import { resolveRequestContext } from "../services/request-context.js";

export async function registerConversationRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { agentId?: string; deviceScope?: string } }>("/conversations", async (request, reply) => {
    const query = z.object({
      agentId: z.string().min(1).optional(),
      deviceScope: z.enum(["desktop", "mobile"]).default("desktop")
    }).safeParse(request.query ?? {});
    if (!query.success) return reply.code(400).send({ error: "invalid_request", details: query.error.flatten() });
    const context = await resolveRequestContext(request.headers);
    if (env.DATA_MODE === "demo") {
      return {
        dataMode: "demo",
        deviceScope: query.data.deviceScope,
        conversations: []
      };
    }

    const conversations = await prisma.conversation.findMany({
      where: {
        tenantId: context.tenantId,
        deviceScope: query.data.deviceScope,
        ...(query.data.agentId ? { agentId: query.data.agentId } : {})
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        agentId: true,
        title: true,
        channel: true,
        deviceScope: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            messages: true
          }
        }
      }
    });

    return {
      dataMode: "database",
      deviceScope: query.data.deviceScope,
      conversations
    };
  });

  app.get<{ Params: { conversationId: string }; Querystring: { deviceScope?: string } }>(
    "/conversations/:conversationId/messages",
    async (request, reply) => {
      const context = await resolveRequestContext(request.headers);
      const query = z.object({ deviceScope: z.enum(["desktop", "mobile"]).default("desktop") }).safeParse(request.query ?? {});
      if (!query.success) return reply.code(400).send({ error: "invalid_request", details: query.error.flatten() });
      if (env.DATA_MODE === "demo") {
        return {
          dataMode: "demo",
          deviceScope: query.data.deviceScope,
          conversationId: request.params.conversationId,
          messages: []
        };
      }

      const conversation = await prisma.conversation.findFirst({
        where: {
          id: request.params.conversationId,
          tenantId: context.tenantId,
          deviceScope: query.data.deviceScope
        }
      });
      if (!conversation) {
        return reply.code(404).send({ error: "conversation_not_found" });
      }

      const messages = await prisma.message.findMany({
        where: {
          conversationId: conversation.id,
          tenantId: context.tenantId
        },
        orderBy: { createdAt: "asc" }
      });

      return {
        dataMode: "database",
        deviceScope: query.data.deviceScope,
        conversationId: conversation.id,
        messages: messages.map((message: any) => ({
          ...message,
          displayContent: message.role === "user" ? buildDisplayContent(message.content) : message.content
        }))
      };
    }
  );
}

function buildDisplayContent(content: string): string {
  const marker = "【本次用户上传/粘贴的附件】";
  const markerIndex = content.indexOf(marker);
  if (markerIndex < 0) return content;
  const visible = content.slice(0, markerIndex).trim();
  const attachmentNames = Array.from(content.slice(markerIndex).matchAll(/^附件\d+：(.+)$/gm))
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
  if (attachmentNames.length === 0) return visible;
  return [visible || "请结合我上传的文件分析。", "", "已上传文件：", ...attachmentNames.map((name, index) => `${index + 1}. ${name}`)].join("\n");
}
