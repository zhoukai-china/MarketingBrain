import { createDecipheriv, createHash, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

export interface WechatKfCallbackEvent {
  event: string;
  token: string;
  openKfId?: string;
}

export interface WechatKfMessage {
  msgid: string;
  open_kfid?: string;
  external_userid?: string;
  send_time?: number;
  origin?: number;
  msgtype?: string;
  text?: { content?: string };
  event?: { event_type?: string; open_kfid?: string; external_userid?: string };
}

let accessToken: { value: string; expiresAt: number } | null = null;

export function verifyAndDecryptWechatKfPayload(params: {
  encrypted: string;
  signature: string;
  timestamp: string;
  nonce: string;
}): string {
  const token = env.WECHAT_KF_TOKEN;
  const aesKey = env.WECHAT_KF_ENCODING_AES_KEY;
  if (!token || !aesKey) throw new Error("wechat_kf_not_configured");
  const expected = createHash("sha1")
    .update([token, params.timestamp, params.nonce, params.encrypted].sort().join(""))
    .digest("hex");
  if (!safeEqual(expected, params.signature)) throw new Error("wechat_kf_invalid_signature");
  return decryptWechatKfPayload(params.encrypted, aesKey, env.WECHAT_KF_CORP_ID);
}

export function decryptWechatKfPayload(encrypted: string, encodingAesKey: string, expectedReceiveId?: string): string {
  if (encodingAesKey.length !== 43) throw new Error("wechat_kf_invalid_aes_key");
  const key = Buffer.from(`${encodingAesKey}=`, "base64");
  if (key.length !== 32) throw new Error("wechat_kf_invalid_aes_key");
  const decipher = createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const padded = Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]);
  const padLength = padded[padded.length - 1] ?? 0;
  if (padLength < 1 || padLength > 32) throw new Error("wechat_kf_invalid_padding");
  const plain = padded.subarray(0, padded.length - padLength);
  if (plain.length < 20) throw new Error("wechat_kf_invalid_payload");
  const messageLength = plain.readUInt32BE(16);
  const messageEnd = 20 + messageLength;
  if (messageEnd > plain.length) throw new Error("wechat_kf_invalid_payload");
  const message = plain.subarray(20, messageEnd).toString("utf8");
  const receiveId = plain.subarray(messageEnd).toString("utf8");
  if (expectedReceiveId && receiveId && receiveId !== expectedReceiveId) throw new Error("wechat_kf_receive_id_mismatch");
  return message;
}

export function parseWechatKfCallback(xml: string): WechatKfCallbackEvent {
  return {
    event: xmlField(xml, "Event") ?? "",
    token: xmlField(xml, "Token") ?? "",
    openKfId: xmlField(xml, "OpenKfId")
  };
}

export function extractWechatKfEncryptedField(xml: string): string {
  const encrypted = xmlField(xml, "Encrypt");
  if (!encrypted) throw new Error("wechat_kf_encrypt_missing");
  return encrypted;
}

export async function syncWechatKfMessages(token: string, openKfId?: string): Promise<WechatKfMessage[]> {
  const messages: WechatKfMessage[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const payload = await callWechatKfApi<{
      next_cursor?: string;
      has_more?: number;
      msg_list?: WechatKfMessage[];
    }>("/cgi-bin/kf/sync_msg", {
      token,
      limit: 1000,
      voice_format: 0,
      ...(cursor ? { cursor } : {}),
      ...(openKfId ? { open_kfid: openKfId } : {})
    });
    messages.push(...(payload.msg_list ?? []));
    if (payload.has_more !== 1 || !payload.next_cursor) break;
    cursor = payload.next_cursor;
  }
  return messages;
}

export async function getWechatKfCustomerUnionid(externalUserId: string): Promise<string | undefined> {
  const payload = await callWechatKfApi<{
    customer_list?: Array<{ external_userid?: string; unionid?: string }>;
  }>("/cgi-bin/kf/customer/batchget", {
    external_userid_list: [externalUserId],
    need_enter_session_context: 0
  });
  return payload.customer_list?.find((customer) => customer.external_userid === externalUserId)?.unionid;
}

export async function sendWechatKfText(externalUserId: string, openKfId: string, content: string): Promise<void> {
  for (const part of splitUtf8(content, 1800)) {
    await callWechatKfApi("/cgi-bin/kf/send_msg", {
      touser: externalUserId,
      open_kfid: openKfId,
      msgtype: "text",
      text: { content: part }
    });
  }
}

async function callWechatKfApi<T extends object>(path: string, body: object, retried = false): Promise<T> {
  const token = await getWechatKfAccessToken(retried);
  const response = await fetch(`https://qyapi.weixin.qq.com${path}?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json() as T & { errcode?: number; errmsg?: string };
  if ((payload.errcode === 40014 || payload.errcode === 42001) && !retried) {
    accessToken = null;
    return callWechatKfApi<T>(path, body, true);
  }
  if (!response.ok || (payload.errcode ?? 0) !== 0) {
    throw new Error(`wechat_kf_api_failed:${path}:${payload.errcode ?? response.status}:${payload.errmsg ?? "unknown"}`);
  }
  return payload;
}

async function getWechatKfAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && accessToken && accessToken.expiresAt > Date.now()) return accessToken.value;
  if (!env.WECHAT_KF_CORP_ID || !env.WECHAT_KF_SECRET) throw new Error("wechat_kf_not_configured");
  const url = new URL("https://qyapi.weixin.qq.com/cgi-bin/gettoken");
  url.searchParams.set("corpid", env.WECHAT_KF_CORP_ID);
  url.searchParams.set("corpsecret", env.WECHAT_KF_SECRET);
  const response = await fetch(url);
  const payload = await response.json() as { errcode?: number; errmsg?: string; access_token?: string; expires_in?: number };
  if (!response.ok || payload.errcode || !payload.access_token) {
    throw new Error(`wechat_kf_access_token_failed:${payload.errcode ?? response.status}:${payload.errmsg ?? "unknown"}`);
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
  return match ? (match[1] ?? match[2] ?? "").trim() : undefined;
}

function splitUtf8(value: string, maxBytes: number): string[] {
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const character of value) {
    const next = Buffer.byteLength(character, "utf8");
    if (current && size + next > maxBytes) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += character;
    size += next;
  }
  if (current) parts.push(current);
  return parts.length ? parts : [""];
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
