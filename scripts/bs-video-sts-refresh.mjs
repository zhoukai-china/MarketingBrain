#!/usr/bin/env node
/**
 * 兰琪爆款复刻：取 STS 临时凭据并写入应用 env（只写不打印明文）。
 *
 * 为什么需要它：`beauty-video-oss-staging.ts` 明确要求 `STS.` 格式的短期三元组，
 * 且**不允许自动续期**（`refreshSTSToken: null`）。所以续期必须由外部定时任务完成：
 * 本脚本用长期 AK（root:root 0600 单独存放）调 AssumeRole，把新的三元组写回
 * `/etc/baolu-secrets/baolu-os-v2.env`，随后由 systemd timer 重启服务生效。
 *
 * 输出只含掩码哈希与到期时间，绝不打印 AccessKeySecret / SecurityToken。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHmac, randomUUID, createHash } from "node:crypto";

const CRED_FILE = process.env.BS_VIDEO_STS_CRED_FILE ?? "/etc/baolu-secrets/bs-video-sts.env";
const APP_ENV = process.env.BS_VIDEO_APP_ENV ?? "/etc/baolu-secrets/baolu-os-v2.env";

function loadEnvFile(path) {
  const out = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const match = /^([A-Za-z0-9_]+)=(.*)$/.exec(raw.trim());
    if (match) out[match[1]] = match[2];
  }
  return out;
}

const cred = loadEnvFile(CRED_FILE);
const roleArn = cred.BS_VIDEO_STS_ROLE_ARN ?? "";
const durationSeconds = Number(cred.BS_VIDEO_STS_DURATION ?? "43200");
if (!cred.BS_VIDEO_STS_AK || !cred.BS_VIDEO_STS_SK || !roleArn) {
  console.error("bs_video_sts_credentials_incomplete");
  process.exit(2);
}

const pct = (value) =>
  encodeURIComponent(value).replace(/\+/g, "%20").replace(/\*/g, "%2A").replace(/%7E/g, "~");

/** 阿里云 RPC 风格 OpenAPI 调用（签名 V1.0，HMAC-SHA1）。 */
async function rpc(endpoint, action, version, extra) {
  const params = {
    AccessKeyId: cred.BS_VIDEO_STS_AK,
    Action: action,
    Format: "JSON",
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: randomUUID(),
    SignatureVersion: "1.0",
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    Version: version,
    ...extra,
  };
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((key) => `${pct(key)}=${pct(params[key])}`)
    .join("&");
  const stringToSign = `GET&${pct("/")}&${pct(canonicalQuery)}`;
  const signature = createHmac("sha1", `${cred.BS_VIDEO_STS_SK}&`).update(stringToSign).digest("base64");
  const response = await fetch(`${endpoint}?${canonicalQuery}&Signature=${pct(signature)}`, {
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, payload };
}

// 一次性运维：把角色最大会话时长提到 12 小时。
// 不改的话角色默认只有 1 小时，STS 每小时过期，服务就得每小时重启一次。
if (process.argv.includes("--set-role-max-session")) {
  const roleName = cred.BS_VIDEO_STS_ROLE_NAME ?? "baolu-video-staging";
  const seconds = String(process.argv[process.argv.indexOf("--set-role-max-session") + 1] ?? "43200");
  const out = await rpc("https://ram.aliyuncs.com/", "SetRole", "2015-05-01", {
    NewMaxSessionDuration: seconds,
    RoleName: roleName,
  });
  console.log(
    JSON.stringify({ setRoleMaxSession: out.ok ? "OK" : out.payload?.Code ?? "failed", status: out.status, seconds }),
  );
  if (!out.ok) process.exit(4);
}

const assumed = await rpc("https://sts.aliyuncs.com/", "AssumeRole", "2015-04-01", {
  DurationSeconds: String(durationSeconds),
  RoleArn: roleArn,
  RoleSessionName: "baolu-video-staging",
});
if (!assumed.ok || !assumed.payload?.Credentials) {
  console.error(`assume_role_failed status=${assumed.status} code=${assumed.payload?.Code ?? "unknown"}`);
  process.exit(3);
}
const payload = assumed.payload;

const triple = payload.Credentials;
const finger = (value) => createHash("sha256").update(value).digest("hex").slice(0, 12);

let text = readFileSync(APP_ENV, "utf8");
const setVar = (source, key, value) => {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  return pattern.test(source) ? source.replace(pattern, line) : `${source.replace(/\n*$/, "\n")}${line}\n`;
};
text = setVar(text, "BEAUTY_VIDEO_OSS_ACCESS_KEY_ID", triple.AccessKeyId);
text = setVar(text, "BEAUTY_VIDEO_OSS_ACCESS_KEY_SECRET", triple.AccessKeySecret);
text = setVar(text, "BEAUTY_VIDEO_OSS_SECURITY_TOKEN", triple.SecurityToken);
text = setVar(text, "BEAUTY_VIDEO_OSS_CREDENTIAL_EXPIRES_AT", triple.Expiration);
writeFileSync(APP_ENV, text, { mode: 0o640 });

console.log(
  JSON.stringify({
    ok: true,
    akPrefix: String(triple.AccessKeyId).slice(0, 5),
    akSha: finger(triple.AccessKeyId),
    skSha: finger(triple.AccessKeySecret),
    tokenSha: finger(triple.SecurityToken),
    expiresAt: triple.Expiration,
  }),
);
