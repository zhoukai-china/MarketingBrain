import { createHash } from "node:crypto";
import type { LlmProvider } from "@baolu/agent";
import { prisma } from "@baolu/db";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { invokeSkillViaGateway } from "../services/mcp-client.js";
import { resolveWechatUnionidRequestContext } from "../services/request-context.js";
import {
  extractWechatKfEncryptedField,
  getWechatKfCustomerUnionid,
  parseWechatKfCallback,
  sendWechatKfText,
  syncWechatKfMessages,
  verifyAndDecryptWechatKfPayload,
  type WechatKfMessage
} from "../services/wechat-kf.js";

interface WechatKfQuery {
  msg_signature?: string;
  timestamp?: string;
  nonce?: string;
  echostr?: string;
}

const pendingMessageIds = new Set<string>();

export async function registerWechatKfRoutes(app: FastifyInstance, provider: LlmProvider): Promise<void> {
  app.get<{ Querystring: WechatKfQuery }>("/integrations/wechat-kf/callback", async (request, reply) => {
    if (env.WECHAT_KF_ENABLED !== "true") return reply.code(404).send("not_found");
    try {
      const plaintext = verifyAndDecryptWechatKfPayload({
        encrypted: request.query.echostr ?? "",
        signature: request.query.msg_signature ?? "",
        timestamp: request.query.timestamp ?? "",
        nonce: request.query.nonce ?? ""
      });
      return reply.type("text/plain; charset=utf-8").send(plaintext);
    } catch (error) {
      request.log.warn({ err: error }, "WeChat Customer Service callback verification failed");
      return reply.code(403).send("invalid_signature");
    }
  });

  app.post<{ Querystring: WechatKfQuery }>("/integrations/wechat-kf/callback", async (request, reply) => {
    if (env.WECHAT_KF_ENABLED !== "true") return reply.code(404).send("not_found");
    try {
      const encrypted = extractWechatKfEncryptedField(typeof request.body === "string" ? request.body : "");
      const plaintext = verifyAndDecryptWechatKfPayload({
        encrypted,
        signature: request.query.msg_signature ?? "",
        timestamp: request.query.timestamp ?? "",
        nonce: request.query.nonce ?? ""
      });
      const callback = parseWechatKfCallback(plaintext);
      if (callback.event === "kf_msg_or_event" && callback.token) {
        void handleWechatKfBatch(callback.token, callback.openKfId, provider).catch((error) => {
          request.log.error({ err: error, openKfId: callback.openKfId }, "WeChat Customer Service batch failed");
        });
      }
      return reply.type("text/plain; charset=utf-8").send("success");
    } catch (error) {
      request.log.warn({ err: error }, "WeChat Customer Service callback rejected");
      return reply.code(403).send("invalid_signature");
    }
  });

  app.get("/integrations/wechat-kf/status", async () => ({
    enabled: env.WECHAT_KF_ENABLED === "true",
    channelType: "wechat_customer_service",
    callbackPath: "/integrations/wechat-kf/callback",
    defaultAgentId: env.WECHAT_KF_DEFAULT_AGENT_ID,
    accountMapping: "wechat_unionid"
  }));
}

async function handleWechatKfBatch(token: string, openKfId: string | undefined, provider: LlmProvider): Promise<void> {
  const messages = (await syncWechatKfMessages(token, openKfId))
    .filter((message) => message.origin === 3 && message.msgtype === "text" && message.text?.content?.trim())
    .sort((left, right) => (left.send_time ?? 0) - (right.send_time ?? 0));
  for (const message of messages) await handleWechatKfText(message, provider);
}

async function handleWechatKfText(message: WechatKfMessage, provider: LlmProvider): Promise<void> {
  const externalUserId = message.external_userid;
  const openKfId = message.open_kfid;
  const input = message.text?.content?.trim();
  if (!externalUserId || !openKfId || !input || !message.msgid) return;
  if (pendingMessageIds.has(message.msgid)) return;
  const requestId = `wechat-kf:${message.msgid}`;
  const existingRun = await prisma.agentRun.findUnique({ where: { requestId }, select: { id: true } });
  if (existingRun) return;
  pendingMessageIds.add(message.msgid);

  try {
    const unionid = await getWechatKfCustomerUnionid(externalUserId);
    if (!unionid) {
      await sendWechatKfText(externalUserId, openKfId, bindingMessage("微信客服尚未关联到思潼微信开放平台账号。"));
      return;
    }

    let context;
    try {
      context = await resolveWechatUnionidRequestContext(unionid);
    } catch (error) {
      if (error instanceof Error && error.message === "wechat_account_not_bound") {
        await sendWechatKfText(externalUserId, openKfId, bindingMessage("这个微信尚未绑定思潼 AI 账号。"));
        return;
      }
      throw error;
    }

    const agentId = env.WECHAT_KF_DEFAULT_AGENT_ID;
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

    try {
      await sendWechatKfText(externalUserId, openKfId, "已收到，思潼 AI 正在处理。完成后会直接把结果发到这里。");
      const result = await invokeSkillViaGateway({
        requestId,
        requestFingerprint: createHash("sha256").update(`${externalUserId}:${openKfId}:${input}`).digest("hex"),
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
      await sendWechatKfText(externalUserId, openKfId, result.answerText);
    } catch (error) {
      await sendWechatKfText(externalUserId, openKfId, friendlyFailure(error));
    }
  } finally {
    pendingMessageIds.delete(message.msgid);
  }
}

function bindingMessage(reason: string): string {
  const link = env.WECHAT_KF_BIND_URL ? `\n${env.WECHAT_KF_BIND_URL}` : "";
  return `${reason}\n请先登录思潼 AI 完成微信登录，再回来发送任务。${link}`;
}

function friendlyFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "insufficient_credits") return "本次任务未执行：当前积分不足，请进入思潼 AI 充值或联系管理员。";
  if (message === "agent_not_entitled" || message === "agent_member_access_denied") {
    return "当前账号尚未开通这个 AI 员工，或没有使用权限，请联系企业管理员。";
  }
  return "这次任务处理失败了，请稍后重试；若持续失败，请在思潼 AI 中联系服务团队。";
}
