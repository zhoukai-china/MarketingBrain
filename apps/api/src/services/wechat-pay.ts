import { createDecipheriv, createPublicKey, createSign, createVerify, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { env, getWechatPayConfigIssues } from "../config/env.js";

export class WechatPayNotConfiguredError extends Error {
  constructor(public readonly issues: string[]) {
    super("wechat_pay_not_configured");
  }
}

export interface WechatNativePrepayInput {
  orderId: string;
  description: string;
  amountCny: number;
  expiresAt: Date;
}

export interface WechatNativePrepayResult {
  codeUrl: string;
  outTradeNo: string;
}

export interface WechatJsapiPrepayInput extends WechatNativePrepayInput {
  openid: string;
}

export interface WechatJsapiPayParams {
  appId: string;
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: "RSA";
  paySign: string;
}

export interface WechatJsapiPrepayResult {
  payParams: WechatJsapiPayParams;
  prepayId: string;
  outTradeNo: string;
}

export interface WechatPayNotificationBody {
  event_type?: string;
  resource?: {
    algorithm?: string;
    ciphertext?: string;
    associated_data?: string;
    nonce?: string;
  };
}

export interface WechatPayDecryptedResource {
  out_trade_no?: string;
  transaction_id?: string;
  trade_state?: string;
  success_time?: string;
}

const WECHAT_PAY_BASE_URL = "https://api.mch.weixin.qq.com";

export function isWechatPayConfigured(): boolean {
  return getWechatPayConfigIssues().length === 0;
}

export async function createWechatNativePrepay(
  input: WechatNativePrepayInput
): Promise<WechatNativePrepayResult> {
  assertWechatPayConfigured();
  const outTradeNo = input.orderId;
  const body = JSON.stringify(buildBasePrepayBody(input, outTradeNo));
  const path = "/v3/pay/transactions/native";
  const authorization = buildWechatPayAuthorization({
    method: "POST",
    path,
    body
  });

  const response = await fetch(`${WECHAT_PAY_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: authorization
    },
    body
  });

  if (!response.ok) {
    throw new Error(`WeChat Pay prepay failed: ${response.status} ${(await response.text()).slice(0, 500)}`);
  }

  const data = (await response.json()) as { code_url?: string };
  if (!data.code_url) {
    throw new Error("WeChat Pay prepay response missing code_url");
  }

  return {
    codeUrl: data.code_url,
    outTradeNo
  };
}

export async function createWechatJsapiPrepay(
  input: WechatJsapiPrepayInput
): Promise<WechatJsapiPrepayResult> {
  assertWechatPayConfigured();
  const outTradeNo = input.orderId;
  const body = JSON.stringify({
    ...buildBasePrepayBody(input, outTradeNo),
    payer: {
      openid: input.openid
    }
  });
  const path = "/v3/pay/transactions/jsapi";
  const authorization = buildWechatPayAuthorization({
    method: "POST",
    path,
    body
  });

  const response = await fetch(`${WECHAT_PAY_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: authorization
    },
    body
  });

  if (!response.ok) {
    throw new Error(`WeChat Pay jsapi prepay failed: ${response.status} ${(await response.text()).slice(0, 500)}`);
  }

  const data = (await response.json()) as { prepay_id?: string };
  if (!data.prepay_id) {
    throw new Error("WeChat Pay jsapi prepay response missing prepay_id");
  }

  return {
    payParams: buildWechatJsapiPayParams(data.prepay_id),
    prepayId: data.prepay_id,
    outTradeNo
  };
}

export function decryptWechatPayResource(
  body: WechatPayNotificationBody
): WechatPayDecryptedResource {
  assertWechatPayConfigured();
  const resource = body.resource;
  if (!resource?.ciphertext || !resource.nonce) {
    throw new Error("wechat_notification_resource_missing");
  }
  if (resource.algorithm && resource.algorithm !== "AEAD_AES_256_GCM") {
    throw new Error(`unsupported_wechat_pay_algorithm:${resource.algorithm}`);
  }

  const ciphertext = Buffer.from(resource.ciphertext, "base64");
  const authTag = ciphertext.subarray(ciphertext.length - 16);
  const encrypted = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(env.WECHAT_PAY_API_V3_KEY!, "utf8"),
    Buffer.from(resource.nonce, "utf8")
  );
  decipher.setAuthTag(authTag);
  if (resource.associated_data) {
    decipher.setAAD(Buffer.from(resource.associated_data, "utf8"));
  }
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8")) as WechatPayDecryptedResource;
}

export function verifyWechatPaySignature(params: {
  timestamp?: string | string[];
  nonce?: string | string[];
  signature?: string | string[];
  bodyText: string;
}): boolean {
  const publicKey = getWechatPayPlatformPublicKey();
  if (!publicKey) {
    return env.NODE_ENV !== "production";
  }

  const timestamp = getHeader(params.timestamp);
  const nonce = getHeader(params.nonce);
  const signature = getHeader(params.signature);
  if (!timestamp || !nonce || !signature) return false;

  const message = `${timestamp}\n${nonce}\n${params.bodyText}\n`;
  const verifier = createVerify("RSA-SHA256");
  verifier.update(message);
  verifier.end();
  return verifier.verify(publicKey, signature, "base64");
}

function buildBasePrepayBody(input: WechatNativePrepayInput, outTradeNo: string) {
  return {
    appid: env.WECHAT_PAY_APPID,
    mchid: env.WECHAT_PAY_MCH_ID,
    description: input.description.slice(0, 120),
    out_trade_no: outTradeNo,
    time_expire: input.expiresAt.toISOString(),
    notify_url: env.WECHAT_PAY_NOTIFY_URL,
    amount: {
      total: Math.round(input.amountCny * 100),
      currency: "CNY"
    }
  };
}

function buildWechatJsapiPayParams(prepayId: string): WechatJsapiPayParams {
  const timeStamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = randomBytes(16).toString("hex");
  const packageValue = `prepay_id=${prepayId}`;
  const message = `${env.WECHAT_PAY_APPID}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`;
  const signer = createSign("RSA-SHA256");
  signer.update(message);
  signer.end();

  return {
    appId: env.WECHAT_PAY_APPID!,
    timeStamp,
    nonceStr,
    package: packageValue,
    signType: "RSA",
    paySign: signer.sign(getWechatPayPrivateKey(), "base64")
  };
}

function buildWechatPayAuthorization(params: {
  method: "POST" | "GET";
  path: string;
  body: string;
}): string {
  const nonce = randomBytes(16).toString("hex");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = `${params.method}\n${params.path}\n${timestamp}\n${nonce}\n${params.body}\n`;
  const signer = createSign("RSA-SHA256");
  signer.update(message);
  signer.end();
  const signature = signer.sign(getWechatPayPrivateKey(), "base64");

  const authorizationParams = [
    `mchid="${env.WECHAT_PAY_MCH_ID}"`,
    `nonce_str="${nonce}"`,
    `timestamp="${timestamp}"`,
    `serial_no="${env.WECHAT_PAY_CERT_SERIAL_NO}"`,
    `signature="${signature}"`
  ].join(",");

  return `WECHATPAY2-SHA256-RSA2048 ${authorizationParams}`;
}

function assertWechatPayConfigured(): void {
  const issues = getWechatPayConfigIssues();
  if (issues.length > 0) {
    throw new WechatPayNotConfiguredError(issues);
  }
}

function getWechatPayPrivateKey(): string {
  const privateKey = readPemValue(env.WECHAT_PAY_PRIVATE_KEY_FILE, env.WECHAT_PAY_PRIVATE_KEY);
  if (!privateKey) {
    throw new WechatPayNotConfiguredError([
      "WECHAT_PAY_PRIVATE_KEY or WECHAT_PAY_PRIVATE_KEY_FILE is required for WeChat Pay"
    ]);
  }
  return privateKey;
}

function getWechatPayPlatformPublicKey(): string | undefined {
  const source = env.WECHAT_PAY_PLATFORM_PUBLIC_KEY_FILE ? "WECHAT_PAY_PLATFORM_PUBLIC_KEY_FILE" : "WECHAT_PAY_PLATFORM_PUBLIC_KEY";
  const pem = readPemValue(env.WECHAT_PAY_PLATFORM_PUBLIC_KEY_FILE, env.WECHAT_PAY_PLATFORM_PUBLIC_KEY);
  if (!pem) return undefined;
  return assertParsablePublicKey(pem, source);
}

/**
 * 微信支付回调验签用的公钥必须是**可解析的 PEM**。
 *
 * 2026-09-12 真实付款验证踩到的坑（QA-20260912-012）：`WECHAT_PAY_PLATFORM_PUBLIC_KEY` 被写成
 * 「单行 + 字面 `\n`」，而 systemd 读 EnvironmentFile 时会把反斜杠吃掉（`\n` → 字面 `n`），
 * 于是运行进程里拿到的是一行非法 PEM；`createVerify().verify()` 抛出
 * `error:1E08010C:DECODER routines::unsupported`，回调 500、微信重试、**订单永远停在 pending**。
 *
 * 所以这里在**使用前就把它解析一次**：解析不了就抛出带明确指引的配置错误，而不是让验签在
 * 客户真的付完钱之后才炸。推荐做法：把公钥放到文件里，用 `WECHAT_PAY_PLATFORM_PUBLIC_KEY_FILE`
 * 指向它（文件里的换行是真实换行，不受 systemd 转义影响）。
 */
/**
 * 运行时密钥探测（QA-20260913-001 加固，2026-09-13 实现）。
 *
 * 2026-09-13 早上的 P0：`/etc/baolu-secrets` 目录权限被改成 700 root:root，
 * 服务（User=admin）启动与 `/ops/wechat-pay-check` 都显示「配置齐全」，只有真正
 * 去 `readFileSync` PEM 文件的支付路径才 EACCES——用户拿不到二维码。这里用**支付路径
 * 同一套读取函数**实际读一次私钥/平台公钥，读不到或解析失败即报错，让检查先于客户红灯。
 */
export interface WechatPayRuntimeProbe {
  privateKeyOk: boolean;
  platformPublicKeyOk: boolean;
  issues: string[];
}

export function probeWechatPayRuntimeKeys(): WechatPayRuntimeProbe {
  const issues: string[] = [];
  let privateKeyOk = false;
  try {
    privateKeyOk = Boolean(getWechatPayPrivateKey());
  } catch (error) {
    issues.push(`运行时读取商户私钥失败（预下单/签名都会失败）：${error instanceof Error ? error.message : String(error)}`);
  }

  let platformPublicKeyOk = true;
  try {
    if (env.WECHAT_PAY_PLATFORM_PUBLIC_KEY_FILE || env.WECHAT_PAY_PLATFORM_PUBLIC_KEY) {
      platformPublicKeyOk = Boolean(getWechatPayPlatformPublicKey());
    }
  } catch (error) {
    platformPublicKeyOk = false;
    issues.push(`运行时读取/解析平台公钥失败（回调验签会失败）：${error instanceof Error ? error.message : String(error)}`);
  }

  return { privateKeyOk, platformPublicKeyOk, issues };
}
export function assertParsablePublicKey(pem: string, source: string): string {
  try {
    createPublicKey(pem);
    return pem;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (pem.includes("-----BEGIN") && !pem.includes("\n")) {
      throw new WechatPayNotConfiguredError([
        `${source} 不是合法 PEM：整个值只有一行、看不到换行。`,
        "常见原因：PEM 以「单行 + 字面 \\n」写进 env 文件，被 systemd 读取时吃掉了反斜杠。",
        "修法：把公钥写成文件，然后设 WECHAT_PAY_PLATFORM_PUBLIC_KEY_FILE=/path/to/wechatpay_platform_public_key.pem（推荐）。",
        `底层错误：${detail}`
      ]);
    }
    throw new WechatPayNotConfiguredError([`${source} 不是合法 PEM：${detail}`]);
  }
}

function readPemValue(filePath?: string, value?: string): string | undefined {
  if (filePath) {
    return normalizePem(readFileSync(filePath, "utf8"));
  }
  return normalizePem(value);
}

function normalizePem(value?: string): string | undefined {
  if (!value) return undefined;
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

function getHeader(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
