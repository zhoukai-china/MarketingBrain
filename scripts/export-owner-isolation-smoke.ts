import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import { prisma } from "../packages/db/src/index.js";
import { EXPORT_PRICING } from "../packages/shared/src/index.js";
import { env } from "../apps/api/src/config/env.js";
import { createSessionToken } from "../apps/api/src/services/auth-token.js";
import { registerExportRoutes } from "../apps/api/src/routes/exports.js";

// Actual registered HTTP handler, session verifier and unified-wallet charging path.
// Only membership storage is synthetic; the wallet/ledger rows are synthetic fixtures written to
// the local development database and deleted (cascade) at the end of the run.
// No production server, Provider, credential file or customer document is accessed.
const saved = { DATA_MODE: env.DATA_MODE, JWT_SECRET: env.JWT_SECRET };
const originalFind = prisma.membership.findFirst;
const originalFetch = globalThis.fetch;
// 导出按次独立扣 10 积分（不含在其它计费里），扣减需要 users → wallet 外键成立。
const exportPrice = EXPORT_PRICING.docxCredits;
const initialWalletBalance = 1000;
const syntheticUserIds = ["owner", "colleague", "outsider", "broke"];
let ownerCharges = 0;
const payload = { title: "美业执行记录", content: "# 美业执行记录\n本记录用于确认已完成工作的执行顺序。\n\n一、执行步骤\n先核对授权，再记录结果。\n\n二、交付检查\n| 项目 | 状态 |\n| --- | --- |\n| 文档 | 完整 |\n| 文件归属 | 已确认 |" };
async function main() {
  Object.assign(env, { DATA_MODE: "database", JWT_SECRET: "synthetic-export-test-secret-never-deployed" });
  let membershipCalls = 0, externalCalls = 0, databaseError = false, revoked = false;
  (prisma.membership as any).findFirst = async ({ where }: any) => {
    membershipCalls++;
    if (databaseError) throw new Error("synthetic-private-db-error-marker");
    if (revoked || !syntheticUserIds.includes(where.userId)) return null;
    return { tenantId: where.tenantId, userId: where.userId, role: "owner", tenant: {
      id: where.tenantId, name: "合成验收主体", type: "local_business", industry: "beauty-industry",
      city: null, profile: { confirmedData: {} }, creditAccount: { balance: 1000 }, subscriptions: []
    } };
  };
  globalThis.fetch = async () => { externalCalls++; throw new Error("Network forbidden in export smoke"); };
  const headers = (userId: string, tenantId = "synthetic-a") => ({ authorization: `Bearer ${createSessionToken({ userId, tenantId })}` });
  // 每一次成功导出都必须恰好扣 10 积分，且余额严格按次递减。
  const expectSingleCharge = (response: { json: () => unknown }, label: string) => {
    const body = response.json() as { consumedCredits: number; balance: number };
    ownerCharges++;
    assert.equal(body.consumedCredits, exportPrice, `${label}：Word 导出按次独立扣 10 积分`);
    assert.equal(body.balance, initialWalletBalance - ownerCharges * exportPrice, `${label}：导出扣费按次递减，不与其它计费合并`);
  };
  // 合成计费夹具：owner 有余额，broke 无余额（走 402 分支）。
  for (const id of syntheticUserIds) {
    await prisma.user.deleteMany({ where: { id } });
    await prisma.user.create({ data: { id } });
  }
  await prisma.wallet.create({ data: { userId: "owner", paidBalance: initialWalletBalance } });
  const logs: string[] = [];
  const app = Fastify({ disableRequestLogging: true, logger: { stream: { write: (line: string) => logs.push(line) } } });
  await registerExportRoutes(app);
  try {
    for (let round = 0; round < 3; round++) {
      const created = await app.inject({ method: "POST", url: "/exports/docx", headers: headers("owner"), payload });
      assert.equal(created.statusCode, 200);
      expectSingleCharge(created, "首份导出");
      const url = created.json().downloadUrl as string;
      const stolen = await app.inject({ method: "GET", url, headers: headers("colleague") });
      console.log(JSON.stringify({ round, stage: "same_tenant_nonowner", status: stolen.statusCode, docxReturned: stolen.headers["content-type"]?.includes("wordprocessingml") ?? false, providerCalls: 0 }));
      assert.equal(stolen.statusCode, 404, "Another user must not download or consume the creator's temporary export");
      const foreign = await app.inject({ method: "GET", url, headers: headers("outsider", "synthetic-b") });
      assert.equal(foreign.statusCode, 403);
      const countBefore = membershipCalls;
      for (const method of ["POST", "GET"] as const) {
        for (const badHeaders of [{}, { "x-sitong-tenant-id": "synthetic-a", "x-sitong-user-id": "owner" }, { authorization: "Bearer invalid", "x-sitong-tenant-id": "synthetic-a", "x-sitong-user-id": "owner" }, { authorization: `Bearer ${createSessionToken({ tenantId: "synthetic-a", userId: "owner", ttlSeconds: -1 })}` }]) {
          const denied = await app.inject({ method, url: method === "POST" ? "/exports/docx" : url, headers: badHeaders, ...(method === "POST" ? { payload } : {}) });
          assert.equal(denied.statusCode, 401);
        }
      }
      assert.equal(membershipCalls, countBefore, "Invalid credentials must stop before database access or generation");
      const spoof = await app.inject({ method: "GET", url, headers: { ...headers("colleague"), "x-sitong-user-id": "owner" } });
      assert.equal(spoof.statusCode, 404);
      revoked = true;
      assert.equal((await app.inject({ method: "GET", url, headers: headers("owner") })).statusCode, 403);
      revoked = false; databaseError = true;
      for (const method of ["POST", "GET"] as const) {
        const failed = await app.inject({ method, url: method === "POST" ? "/exports/docx" : url, headers: headers("owner"), ...(method === "POST" ? { payload } : {}) });
        assert.equal(failed.statusCode, 503);
        assert.ok(!failed.body.includes("synthetic-private-db-error-marker"));
      }
      databaseError = false;
      const downloaded = await app.inject({ method: "GET", url, headers: headers("owner") });
      assert.equal(downloaded.statusCode, 200);
      assert.equal(downloaded.rawPayload.subarray(0, 2).toString(), "PK");
      assert.match(String(downloaded.headers["content-type"]), /wordprocessingml/);
      assert.match(String(downloaded.headers["content-disposition"]), /filename\*=UTF-8''/);
      assert.equal(downloaded.headers["cache-control"], "private, no-store");
      assert.equal((await app.inject({ method: "GET", url, headers: headers("owner") })).statusCode, 404);
      if (round === 0 && process.env.EXPORT_AUDIT_OUTPUT_DIR) {
        const root = resolve(process.env.EXPORT_AUDIT_OUTPUT_DIR);
        await mkdir(root, { recursive: true });
        await writeFile(resolve(root, "synthetic-export.docx"), downloaded.rawPayload);
        console.log(JSON.stringify({ stage: "docx_artifact", bytes: downloaded.rawPayload.length, sha256: createHash("sha256").update(downloaded.rawPayload).digest("hex") }));
      }
      const again = await app.inject({ method: "POST", url: "/exports/docx", headers: headers("owner"), payload });
      assert.equal(again.statusCode, 200);
      expectSingleCharge(again, "并发下载前的再次导出");
      const simultaneous = await Promise.all([1, 2].map(() => app.inject({ method: "GET", url: again.json().downloadUrl, headers: headers("owner") })));
      assert.deepEqual(simultaneous.map(r => r.statusCode).sort(), [200, 404]);
      const expires = await app.inject({ method: "POST", url: "/exports/docx", headers: headers("owner"), payload });
      assert.equal(expires.statusCode, 200);
      expectSingleCharge(expires, "过期用例导出");
      const realNow = Date.now;
      try {
        const future = realNow() + 11 * 60 * 1000;
        const futureHeaders = headers("owner");
        Date.now = () => future;
        assert.equal((await app.inject({ method: "GET", url: expires.json().downloadUrl, headers: futureHeaders })).statusCode, 404);
      } finally { Date.now = realNow; }
      assert.equal((await app.inject({ method: "POST", url: "/exports/docx", headers: headers("owner"), payload: { content: "" } })).statusCode, 400);
      console.log(JSON.stringify({ round, status: "PASS", auth: "signed_session_and_live_membership", ttlMinutes: 10, oneUse: true, externalCalls }));
    }
    // 余额不足：402 且不生成交付物、不写账本。
    const broke = await app.inject({ method: "POST", url: "/exports/docx", headers: headers("broke"), payload });
    assert.equal(broke.statusCode, 402, "余额不足必须返回 402 而不是生成交付物");
    const brokeBody = broke.json() as { error: string; required: number; balance: number };
    assert.equal(brokeBody.error, "insufficient_credits");
    assert.equal(brokeBody.required, exportPrice);
    assert.equal(brokeBody.balance, 0);
    assert.equal(await prisma.walletLedger.count({ where: { userId: "broke", type: "consume" } }), 0, "扣费失败不得留下账本");

    // 按次独立计费：每次导出恰好一条 -10 账本，走 paid 桶。
    const ownerConsumes = await prisma.walletLedger.findMany({ where: { userId: "owner", type: "consume" } });
    assert.equal(ownerConsumes.length, ownerCharges, "每次导出恰好一条扣费账本");
    assert.ok(ownerConsumes.every((row) => row.delta === -exportPrice && row.bucket === "paid" && row.skillId === "docx_export"), "扣费固定 10 积分/次且标记来源");
    const ownerWallet = await prisma.wallet.findUnique({ where: { userId: "owner" } });
    assert.equal(ownerWallet?.paidBalance, initialWalletBalance - ownerCharges * exportPrice, "导出扣费只发生在导出链路");
    assert.equal(externalCalls, 0);
    assert.ok(!logs.join("").includes("synthetic-private-db-error-marker"));
    assert.ok(!logs.join("").includes(payload.content));
    assert.ok(!logs.join("").includes("Bearer "));
    console.log(JSON.stringify({ status: "PASS", rounds: 3, exportPrice, ownerCharges, insufficientReturns402: true, providerCalls: 0, externalCalls }));
  } finally {
    await app.close();
    await prisma.user.deleteMany({ where: { id: { in: syntheticUserIds } } });
    Object.assign(env, saved); (prisma.membership as any).findFirst = originalFind; globalThis.fetch = originalFetch;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
