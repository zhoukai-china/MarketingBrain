// chat-test 真实支付验收（复验阶段）：轮询订单 → 校验到账 → 输出证据。
// 不发起任何支付，只做只读核对；付款由真人用微信扫码完成。
// 用法：REALPAY_REPORT=<prepare-report.json> node scripts/tmp/test-real-payment-verify.mjs
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const reportPath =
  process.env.REALPAY_REPORT ??
  path.join(process.env.TEMP ?? ".", "realpay-test-0910", "prepare-report.json");
const report = JSON.parse(await readFile(reportPath, "utf8"));

const apiBase = String(report.apiBase).replace(/\/+$/, "");
const orderId = report.orderId;
const timeoutMs = Number(process.env.REALPAY_TIMEOUT_MS ?? 90000);
const intervalMs = Number(process.env.REALPAY_INTERVAL_MS ?? 5000);

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

// 复用准备阶段的会话：dev-login 用同一租户名拿回同一工作区。
const login = await call(`${apiBase}/auth/dev-login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    tenantRole: "local_business",
    tenantName: report.tenantName,
    planCode: "local_standard"
  })
});
assert.equal(login.status, 200, `dev-login 失败：${login.status} ${JSON.stringify(login.body)}`);
assert.equal(
  login.body.tenantId,
  report.tenantId,
  `会话租户与下单租户不一致：${login.body.tenantId} != ${report.tenantId}`
);
const headers = { "content-type": "application/json", authorization: `Bearer ${login.body.token}` };

const startedAt = Date.now();
let order = null;
let lastStatus = null;
while (Date.now() - startedAt < timeoutMs) {
  const res = await call(`${apiBase}/billing/orders/${orderId}`, { headers });
  assert.equal(res.status, 200, `查询订单失败：${res.status} ${JSON.stringify(res.body)}`);
  order = res.body.order ?? res.body;
  lastStatus = order.status;
  if (order.status === "paid") break;
  await new Promise((r) => setTimeout(r, intervalMs));
}

const walletAfter = await call(`${apiBase}/wallet`, { headers });
assert.equal(walletAfter.status, 200, `读取支付后余额失败：${walletAfter.status}`);

const paidDelta = Number(walletAfter.body.paidBalance ?? 0) - Number(report.walletBefore?.paidBalance ?? 0);
const evidence = {
  checkedAt: new Date().toISOString(),
  apiBase,
  tenantId: report.tenantId,
  orderId,
  amountCny: order.amountCny,
  credits: order.credits,
  orderStatus: order.status,
  providerOrderId: order.providerOrderId ?? null,
  paidAt: order.paidAt ?? null,
  walletBefore: report.walletBefore,
  walletAfter: walletAfter.body,
  paidBalanceDelta: paidDelta,
  expectedCredits: report.credits,
  elapsedSeconds: Math.round((Date.now() - startedAt) / 1000)
};

const failures = [];
if (order.status !== "paid") failures.push(`order_status=${order.status}（期望 paid）`);
if (paidDelta !== Number(report.credits)) {
  failures.push(`paid_balance_delta=${paidDelta}（期望 ${report.credits}）`);
}

evidence.failures = failures;
const outFile = path.join(path.dirname(reportPath), "verify-report.json");
await writeFile(outFile, JSON.stringify(evidence, null, 2), "utf8");
evidence.verifyReport = outFile;

console.log(failures.length === 0 ? "test_real_payment_verify:PASS" : "test_real_payment_verify:FAIL");
console.log(JSON.stringify(evidence, null, 2));
if (failures.length > 0) process.exitCode = 1;
