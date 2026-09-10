// chat-test 真实支付验收（准备阶段）：建 QA 工作区 → 建 pack_50 订单 → native 预支付 → 出二维码。
// 只做准备和取证，不代替用户付款；付款由真人用微信扫码完成。
// 用法：REALPAY_API_BASE=https://api.lcppch.top/lanqi-test/api node scripts/tmp/test-real-payment-prepare.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const apiBase = (process.env.REALPAY_API_BASE ?? "https://api.lcppch.top/lanqi-test/api").replace(/\/+$/, "");
const outDir = process.env.REALPAY_OUT_DIR ?? path.join(process.env.TEMP ?? ".", `realpay-${Date.now()}`);
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const tenantName = process.env.REALPAY_TENANT_NAME ?? `qa-realpay-${stamp}`;

const require = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const QRCode = require("qrcode");

async function call(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

await mkdir(outDir, { recursive: true });

// 1. 建一个独立 QA 工作区（chat-test 是 DIRECT_TEST_LOGIN 内测免登录实例，可用 dev-login）。
const login = await call(`${apiBase}/auth/dev-login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ tenantRole: "local_business", tenantName, planCode: "local_standard" })
});
assert.equal(login.status, 200, `dev-login 失败：${login.status} ${JSON.stringify(login.body)}`);
const token = login.body.token;
const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };

const wechatConfig = await call(`${apiBase}/auth/wechat-config`);
const walletBefore = await call(`${apiBase}/wallet`, { headers });
assert.equal(walletBefore.status, 200, `读取支付前余额失败：${walletBefore.status}`);

// 2. 建最小档订单（pack_50 = ¥50 / 1000 积分），与充值页 createOrder 完全同一条链路。
const created = await call(`${apiBase}/billing/orders`, {
  method: "POST",
  headers,
  body: JSON.stringify({ type: "credit_pack", creditPackCode: "pack_50" })
});
assert.equal(created.status, 200, `建单失败：${created.status} ${JSON.stringify(created.body)}`);
const orderId = created.body.order.id;

// 3. native 预支付，拿真实 code_url（微信支付下单，会按测试环境的 WECHAT_PAY_NOTIFY_URL 回调）。
const prepay = await call(`${apiBase}/billing/orders/${orderId}/wechat-prepay`, {
  method: "POST",
  headers,
  body: JSON.stringify({ tradeType: "native" })
});
assert.equal(prepay.status, 200, `预支付失败：${prepay.status} ${JSON.stringify(prepay.body)}`);
const codeUrl = prepay.body.codeUrl;
assert.match(String(codeUrl), /^weixin:\/\//, `code_url 不是微信支付链接：${codeUrl}`);

const orderAfterPrepay = await call(`${apiBase}/billing/orders/${orderId}`, { headers });

const qrPng = path.join(outDir, "wechatpay-qr.png");
await QRCode.toFile(qrPng, codeUrl, { width: 640, margin: 2 });
const qrSvgRes = await fetch(`${apiBase}/billing/orders/${orderId}/wechat-qr.svg`);
assert.equal(qrSvgRes.status, 200, `二维码接口不可用：${qrSvgRes.status}`);
await writeFile(path.join(outDir, "wechatpay-qr.svg"), await qrSvgRes.text(), "utf8");

const report = {
  apiBase,
  tenantName,
  tenantId: login.body.tenantId,
  userId: login.body.userId,
  wechatConfig: wechatConfig.body,
  walletBefore: walletBefore.body,
  orderId,
  amountCny: orderAfterPrepay.body?.order?.amountCny,
  credits: orderAfterPrepay.body?.order?.credits,
  orderStatus: orderAfterPrepay.body?.order?.status,
  providerOrderId: orderAfterPrepay.body?.order?.providerOrderId,
  creditPackCode: orderAfterPrepay.body?.order?.creditPackCode,
  codeUrl,
  qrPng,
  rechargePage: apiBase.replace(/\/api$/, "") + "/recharge",
  prepareReport: path.join(outDir, "prepare-report.json")
};
await writeFile(report.prepareReport, JSON.stringify(report, null, 2), "utf8");

console.log("test_real_payment_prepare:READY");
console.log(JSON.stringify(report, null, 2));
