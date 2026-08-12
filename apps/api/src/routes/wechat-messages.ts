import { createHash } from "node:crypto";
import type { LlmProvider } from "@baolu/agent";
import { prisma } from "@baolu/db";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { invokeSkillViaGateway } from "../services/mcp-client.js";
import { resolveWechatRequestContext } from "../services/request-context.js";
import {
  buildWechatTextReply,
  parseWechatXml,
  sendWechatCustomerServiceText,
  verifyWechatMessageSignature,
  type WechatInboundMessage
} from "../services/wechat-messaging.js";

interface WechatCallbackQuery {
  signature?: string;
  timestamp?: string;
  nonce?: string;
  echostr?: string;
  encrypt_type?: string;
}

export async function registerWechatMessageRoutes(app: FastifyInstance, provider: LlmProvider): Promise<void> {
  app.addContentTypeParser(["text/xml", "application/xml"], { parseAs: "string" }, (_request, body, done) => done(null, body));

  app.get<{ Querystring: WechatCallbackQuery }>("/integrations/wechat/messages", async (request, reply) => {
    if (env.WECHAT_MESSAGE_ENABLED !== "true") return reply.code(404).send("not_found");
    if (!validCallbackQuery(request.query)) return reply.code(403).send("invalid_signature");
    return reply.type("text/plain; charset=utf-8").send(request.query.echostr ?? "");
  });

  app.post<{ Querystring: WechatCallbackQuery }>("/integrations/wechat/messages", async (request, reply) => {
    if (env.WECHAT_MESSAGE_ENABLED !== "true") return reply.code(404).send("not_found");
    if (!validCallbackQuery(request.query)) return reply.code(403).send("invalid_signature");
    if (request.query.encrypt_type === "aes") {
      return reply.code(501).send("wechat_aes_mode_not_enabled");
    }

    const inbound = parseWechatXml(typeof request.body === "string" ? request.body : "");
    if (!inbound.fromUserName || !inbound.toUserName) return reply.type("text/plain").send("success");

    if (inbound.msgType === "event" && inbound.event?.toLowerCase() === "subscribe") {
      return reply.type("application/xml; charset=utf-8").send(buildWechatTextReply(inbound, bindingMessage()));
    }

    const input = inbound.msgType === "text"
      ? inbound.content?.trim()
      : inbound.msgType === "voice"
        ? inbound.recognition?.trim()
        : undefined;
    if (!input) {
      return reply.type("application/xml; charset=utf-8").send(
        buildWechatTextReply(inbound, "目前支持文字消息，以及已开启语音识别的语音消息。请直接告诉我你要完成的任务。")
      );
    }

    try {
      await resolveWechatRequestContext(inbound.fromUserName);
    } catch (error) {
      if (error instanceof Error && error.message === "wechat_account_not_bound") {
        return reply.type("application/xml; charset=utf-8").send(buildWechatTextReply(inbound, bindingMessage()));
      }
      throw error;
    }

    void runWechatAgent(inbound, input, provider).catch((error) => {
      request.log.error({ err: error, openid: maskOpenid(inbound.fromUserName) }, "WeChat Agent execution failed");
      return sendWechatCustomerServiceText(inbound.fromUserName, friendlyFailure(error)).catch((sendError) => {
        request.log.error({ err: sendError, openid: maskOpenid(inbound.fromUserName) }, "WeChat failure message could not be sent");
      });
    });

    return reply.type("application/xml; charset=utf-8").send(
      buildWechatTextReply(inbound, "已收到，思潼 AI 正在处理。完成后会直接把结果发到这里。")
    );
  });

  app.get("/integrations/wechat/status", async () => ({
    enabled: env.WECHAT_MESSAGE_ENABLED === "true",
    mode: "official_account_plaintext",
    callbackPath: "/integrations/wechat/messages",
    defaultAgentId: env.WECHAT_MESSAGE_DEFAULT_AGENT_ID
  }));
}

async function runWechatAgent(inbound: WechatInboundMessage, input: string, provider: LlmProvider): Promise<void> {
  const context = await resolveWechatRequestContext(inbound.fromUserName);
  const agentId = env.WECHAT_MESSAGE_DEFAULT_AGENT_ID;
  const latestRun = await prisma.agentRun.findFirst({
    where: {
      tenantId: context.tenantId,
      userId: context.userId,
      agentId,
      conversation: { channel: "wechat" }
    },
    orderBy: { createdAt: "desc" },
    select: { conversationId: true }
  });
  const messageIdentity = inbound.msgId
    ?? createHash("sha256").update(`${inbound.fromUserName}:${inbound.createTime}:${input}`).digest("hex");
  const result = await invokeSkillViaGateway({
    requestId: `wechat:${messageIdentity}`,
    context,
    provider,
    agentId,
    input,
    conversationId: latestRun?.conversationId ?? undefined,
    channel: "wechat",
    deviceScope: "mobile",
    routingSource: "agent_router",
    deliveryPolicy: "clarify"
  });
  await sendWechatCustomerServiceText(inbound.fromUserName, result.answerText);
}

function validCallbackQuery(query: WechatCallbackQuery): boolean {
  return verifyWechatMessageSignature(query.signature ?? "", query.timestamp ?? "", query.nonce ?? "");
}

function bindingMessage(): string {
  const link = env.WECHAT_MESSAGE_BIND_URL ? `\n${env.WECHAT_MESSAGE_BIND_URL}` : "";
  return `请先登录思潼 AI 并完成当前微信账号绑定，然后再回来发送任务。${link}`;
}

function friendlyFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "insufficient_credits") return "本次任务未执行：当前积分不足，请进入思潼 AI 充值或联系管理员。";
  if (message === "agent_not_entitled" || message === "agent_member_access_denied") {
    return "当前账号尚未开通这个 AI 员工，或没有使用权限，请联系企业管理员。";
  }
  return "这次任务处理失败了，请稍后重试；若持续失败，请在思潼 AI 中联系服务团队。";
}

function maskOpenid(openid: string): string {
  return openid.length <= 8 ? "***" : `${openid.slice(0, 4)}***${openid.slice(-4)}`;
}
