import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

export interface WechatInboundMessage {
  toUserName: string;
  fromUserName: string;
  createTime: string;
  msgType: string;
  content?: string;
  recognition?: string;
  event?: string;
  eventKey?: string;
  msgId?: string;
}

let accessToken: { value: string; expiresAt: number } | null = null;

export function verifyWechatMessageSignature(signature: string, timestamp: string, nonce: string): boolean {
  if (!env.WECHAT_MESSAGE_TOKEN || !signature || !timestamp || !nonce) return false;
  const expected = createHash("sha1")
    .update([env.WECHAT_MESSAGE_TOKEN, timestamp, nonce].sort().join(""))
    .digest("hex");
  return safeEqual(expected, signature);
}

export function parseWechatXml(xml: string): WechatInboundMessage {
  return {
    toUserName: xmlField(xml, "ToUserName") ?? "",
    fromUserName: xmlField(xml, "FromUserName") ?? "",
    createTime: xmlField(xml, "CreateTime") ?? "",
    msgType: (xmlField(xml, "MsgType") ?? "").toLowerCase(),
    content: xmlField(xml, "Content"),
    recognition: xmlField(xml, "Recognition"),
    event: xmlField(xml, "Event"),
    eventKey: xmlField(xml, "EventKey"),
    msgId: xmlField(xml, "MsgId")
  };
}

export function buildWechatTextReply(message: WechatInboundMessage, content: string): string {
  return [
    "<xml>",
    `<ToUserName><![CDATA[${safeCdata(message.fromUserName)}]]></ToUserName>`,
    `<FromUserName><![CDATA[${safeCdata(message.toUserName)}]]></FromUserName>`,
    `<CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>`,
    "<MsgType><![CDATA[text]]></MsgType>",
    `<Content><![CDATA[${safeCdata(content)}]]></Content>`,
    "</xml>"
  ].join("");
}

export async function sendWechatCustomerServiceText(openid: string, content: string): Promise<void> {
  for (const part of splitUtf8(content, 1800)) {
    await sendWechatCustomerServicePart(openid, part, false);
  }
}

async function sendWechatCustomerServicePart(openid: string, content: string, retried: boolean): Promise<void> {
  const token = await getAccessToken(retried);
  const response = await fetch(`https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ touser: openid, msgtype: "text", text: { content } })
  });
  const payload = await response.json() as { errcode?: number; errmsg?: string };
  if ((payload.errcode === 40014 || payload.errcode === 42001) && !retried) {
    accessToken = null;
    return sendWechatCustomerServicePart(openid, content, true);
  }
  if (!response.ok || (payload.errcode ?? 0) !== 0) {
    throw new Error(`wechat_customer_service_send_failed:${payload.errcode ?? response.status}:${payload.errmsg ?? "unknown"}`);
  }
}

async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && accessToken && accessToken.expiresAt > Date.now()) return accessToken.value;
  if (!env.WECHAT_AUTH_APPID || !env.WECHAT_AUTH_SECRET) throw new Error("wechat_message_not_configured");
  const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", env.WECHAT_AUTH_APPID);
  url.searchParams.set("secret", env.WECHAT_AUTH_SECRET);
  const response = await fetch(url);
  const payload = await response.json() as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error(`wechat_access_token_failed:${payload.errcode ?? response.status}:${payload.errmsg ?? "unknown"}`);
  }
  accessToken = {
    value: payload.access_token,
    expiresAt: Date.now() + Math.max(60, (payload.expires_in ?? 7200) - 120) * 1000
  };
  return accessToken.value;
}

function xmlField(xml: string, field: string): string | undefined {
  const pattern = new RegExp(`<${field}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${field}>`, "i");
  const match = pattern.exec(xml);
  if (!match) return undefined;
  return decodeXmlEntities((match[1] ?? match[2] ?? "").trim());
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function safeCdata(value: string): string {
  return value.replace(/]]>/g, "]]]]><![CDATA[>");
}

function splitUtf8(value: string, maxBytes: number): string[] {
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, "utf8");
    if (current && bytes + size > maxBytes) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += character;
    bytes += size;
  }
  if (current) parts.push(current);
  return parts.length > 0 ? parts : [""];
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
