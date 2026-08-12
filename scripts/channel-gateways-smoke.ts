import assert from "node:assert/strict";
import { createCipheriv, createHash } from "node:crypto";

const workbuddyToken = "workbuddy-test-token-at-least-32-characters";
process.env.WORKBUDDY_MCP_ENABLED = "true";
process.env.WORKBUDDY_MCP_CONNECTIONS_JSON = JSON.stringify([{
  label: "smoke",
  token: workbuddyToken,
  tenantId: "tenant-smoke",
  userId: "user-smoke",
  agentId: "agent_acquisition"
}]);
process.env.WECHAT_MESSAGE_TOKEN = "wechat-smoke-token";
process.env.WECHAT_KF_TOKEN = "wechat-kf-smoke-token";
process.env.WECHAT_KF_CORP_ID = "ww-smoke-corp";
process.env.WECHAT_KF_ENCODING_AES_KEY = Buffer.alloc(32, 7).toString("base64").slice(0, 43);

async function main(): Promise<void> {
  const { resolveWorkbuddyConnection, getWorkbuddyConnectionIssues, hashWorkbuddyToken } = await import("../apps/api/src/services/workbuddy-connections.js");
  const {
    buildWechatTextReply,
    parseWechatXml,
    verifyWechatMessageSignature
  } = await import("../apps/api/src/services/wechat-messaging.js");
  const {
    parseWechatKfCallback,
    verifyAndDecryptWechatKfPayload
  } = await import("../apps/api/src/services/wechat-kf.js");

assert.deepEqual(getWorkbuddyConnectionIssues(), []);
assert.match(hashWorkbuddyToken(workbuddyToken), /^[a-f0-9]{64}$/);
assert.notEqual(hashWorkbuddyToken(workbuddyToken), workbuddyToken);
assert.equal((await resolveWorkbuddyConnection(`Bearer ${workbuddyToken}`))?.agentId, "agent_acquisition");
assert.equal(await resolveWorkbuddyConnection("Bearer wrong-token"), null);

const timestamp = "1723000000";
const nonce = "smoke-nonce";
const signature = createHash("sha1")
  .update([process.env.WECHAT_MESSAGE_TOKEN!, timestamp, nonce].sort().join(""))
  .digest("hex");
assert.equal(verifyWechatMessageSignature(signature, timestamp, nonce), true);
assert.equal(verifyWechatMessageSignature("bad", timestamp, nonce), false);

const inbound = parseWechatXml([
  "<xml>",
  "<ToUserName><![CDATA[official-account]]></ToUserName>",
  "<FromUserName><![CDATA[user-openid]]></FromUserName>",
  "<CreateTime>1723000000</CreateTime>",
  "<MsgType><![CDATA[text]]></MsgType>",
  "<Content><![CDATA[帮我写一条朋友圈]]></Content>",
  "<MsgId>123456</MsgId>",
  "</xml>"
].join(""));
assert.equal(inbound.fromUserName, "user-openid");
assert.equal(inbound.content, "帮我写一条朋友圈");
assert.equal(inbound.msgId, "123456");

const reply = buildWechatTextReply(inbound, "已收到");
assert.match(reply, /<ToUserName><!\[CDATA\[user-openid\]\]><\/ToUserName>/);
assert.match(reply, /<FromUserName><!\[CDATA\[official-account\]\]><\/FromUserName>/);
assert.match(reply, /已收到/);

const kfPlaintext = [
  "<xml>",
  "<ToUserName><![CDATA[ww-smoke-corp]]></ToUserName>",
  "<CreateTime>1723000000</CreateTime>",
  "<MsgType><![CDATA[event]]></MsgType>",
  "<Event><![CDATA[kf_msg_or_event]]></Event>",
  "<Token><![CDATA[sync-token]]></Token>",
  "<OpenKfId><![CDATA[wk-smoke]]></OpenKfId>",
  "</xml>"
].join("");
const encryptedKf = encryptWechatKfPayload(kfPlaintext, process.env.WECHAT_KF_ENCODING_AES_KEY!, process.env.WECHAT_KF_CORP_ID!);
const kfSignature = createHash("sha1")
  .update([process.env.WECHAT_KF_TOKEN!, timestamp, nonce, encryptedKf].sort().join(""))
  .digest("hex");
const decryptedKf = verifyAndDecryptWechatKfPayload({ encrypted: encryptedKf, signature: kfSignature, timestamp, nonce });
assert.equal(decryptedKf, kfPlaintext);
assert.deepEqual(parseWechatKfCallback(decryptedKf), {
  event: "kf_msg_or_event",
  token: "sync-token",
  openKfId: "wk-smoke"
});

  console.log("Channel gateway smoke passed: WorkBuddy token scope and WeChat callback protocol are valid.");
}

void main();

function encryptWechatKfPayload(message: string, encodingAesKey: string, receiveId: string): string {
  const key = Buffer.from(`${encodingAesKey}=`, "base64");
  const messageBuffer = Buffer.from(message);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(messageBuffer.length);
  const plain = Buffer.concat([Buffer.alloc(16, 9), length, messageBuffer, Buffer.from(receiveId)]);
  const padLength = 32 - (plain.length % 32);
  const padded = Buffer.concat([plain, Buffer.alloc(padLength, padLength)]);
  const cipher = createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
}
