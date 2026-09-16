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
//
// 2026-09-16 契约变更（客户现场：微信/手机点下载拿到 blob: 链接打不开）：
//   ① 会话 Bearer 下载 —— 老前端与脚本路径，语义不变（租户 403 / 非创建者 404 / 凭证无效 401）；
//   ② 一次性直链 `?t=<HMAC 令牌>` —— 手机、微信内置浏览器与 WPS 走的路径，浏览器导航带不了
//      Authorization 头，所以令牌本身即「持有即可取件一次」的能力；取件后记录删除，同一条链接
//      对任何人都失效；令牌不进日志、不落库，10 分钟后随导出记录一起过期；
//   ③ 计费 —— 幂等键 = 用户 + 标题 + 正文指纹，同一份报告只有第一次真扣费，重下（换手机、
//      下载失败重试、清缓存）命中同一 requestId 不重复扣，零余额也允许重下自己已付费的那份。
const saved = { DATA_MODE: env.DATA_MODE, JWT_SECRET: env.JWT_SECRET };
const originalFind = prisma.membership.findFirst;
const originalFetch = globalThis.fetch;
// 导出按次独立扣 10 积分（不含在其它计费里），扣减需要 users → wallet 外键成立。
const exportPrice = EXPORT_PRICING.docxCredits;
const initialWalletBalance = 1000;
const syntheticUserIds = ["owner", "colleague", "outsider", "broke"];
const rounds = 3;
const localBase = "http://synthetic.local";
/** 真实扣费次数，等于 owner 的 consume 账本条数。 */
let chargedExports = 0;
let expectedBalance = initialWalletBalance;
const issuedTokens: string[] = [];
const payload = { title: "美业执行记录", content: "# 美业执行记录\n本记录用于确认已完成工作的执行顺序。\n\n一、执行步骤\n先核对授权，再记录结果。\n\n二、交付检查\n| 项目 | 状态 |\n| --- | --- |\n| 文档 | 完整 |\n| 文件归属 | 已确认 |" };

type InjectResponse = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  rawPayload: Buffer;
  body: string;
  json: () => any;
};

const downloadUrlOf = (response: InjectResponse): string => String(response.json().downloadUrl);
const tokenOf = (url: string): string => new URL(url, localBase).searchParams.get("t") ?? "";
/** 同一条记录的下载地址，把令牌换成无效值：强制走会话鉴权分支。 */
const withoutValidToken = (url: string): string => {
  const parsed = new URL(url, localBase);
  parsed.searchParams.set("t", "invalid-token");
  return `${parsed.pathname}?${parsed.searchParams.toString()}`;
};

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
  // 计费断言：本次导出实际扣多少、余额降到哪、是不是幂等重下，三件事必须同时成立。
  const expectExportCharge = (
    response: InjectResponse,
    label: string,
    expectation: { credits: number; redownload: boolean }
  ) => {
    const body = response.json() as { consumedCredits: number; balance: number; redownload: boolean; downloadUrl: string; id: string };
    if (expectation.credits > 0) chargedExports++;
    expectedBalance -= expectation.credits;
    assert.equal(body.consumedCredits, expectation.credits, `${label}：本次实际扣费积分`);
    assert.equal(body.balance, expectedBalance, `${label}：钱包余额（首次扣费、同内容重下不重复扣）`);
    assert.equal(body.redownload, expectation.redownload, `${label}：redownload 标记`);
    return body;
  };
  // 取件断言：一次性直链与会话下载都必须是真实 docx 字节，且明确不可缓存。
  const expectDocxPayload = (response: InjectResponse, label: string) => {
    assert.equal(response.statusCode, 200, `${label}：应取件成功`);
    assert.equal(response.rawPayload.subarray(0, 2).toString(), "PK", `${label}：必须是真实 docx 字节`);
    assert.match(String(response.headers["content-type"]), /wordprocessingml/, `${label}：content-type`);
    assert.match(String(response.headers["content-disposition"]), /filename\*=UTF-8''/, `${label}：下载文件名`);
    assert.equal(response.headers["cache-control"], "private, no-store", `${label}：交付物不得被浏览器/代理缓存`);
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
    for (let round = 0; round < rounds; round++) {
      const created = await app.inject({ method: "POST", url: "/exports/docx", headers: headers("owner"), payload });
      assert.equal(created.statusCode, 200);
      // 同一份内容：第一轮真扣 10，之后是幂等重下（不扣费但仍能拿到文件）。
      const createdBody = expectExportCharge(created, "首份导出", { credits: round === 0 ? exportPrice : 0, redownload: round !== 0 });
      const url = createdBody.downloadUrl;
      assert.match(url, /^\/exports\/docx\/[0-9a-f-]{36}\?t=/, "下载直链必须带一次性令牌");
      const token = tokenOf(url);
      issuedTokens.push(token);
      assert.ok(token.length > 20, "一次性令牌不得为空或缺席");
      // 会话隔离整组走「无效令牌」地址，确保测的是鉴权而不是令牌直通。
      const sessionUrl = withoutValidToken(url);

      const stolen = await app.inject({ method: "GET", url: sessionUrl, headers: headers("colleague") });
      console.log(JSON.stringify({ round, stage: "same_tenant_nonowner", status: stolen.statusCode, docxReturned: stolen.headers["content-type"]?.includes("wordprocessingml") ?? false, providerCalls: 0 }));
      assert.equal(stolen.statusCode, 404, "Another user must not download or consume the creator's temporary export");
      assert.ok(!stolen.headers["content-type"]?.includes("wordprocessingml"), "同租户非创建者不得拿到 docx 字节");
      const foreign = await app.inject({ method: "GET", url: sessionUrl, headers: headers("outsider", "synthetic-b") });
      assert.equal(foreign.statusCode, 403);
      const countBefore = membershipCalls;
      for (const method of ["POST", "GET"] as const) {
        for (const badHeaders of [{}, { "x-sitong-tenant-id": "synthetic-a", "x-sitong-user-id": "owner" }, { authorization: "Bearer invalid", "x-sitong-tenant-id": "synthetic-a", "x-sitong-user-id": "owner" }, { authorization: `Bearer ${createSessionToken({ tenantId: "synthetic-a", userId: "owner", ttlSeconds: -1 })}` }]) {
          const denied = await app.inject({ method, url: method === "POST" ? "/exports/docx" : sessionUrl, headers: badHeaders, ...(method === "POST" ? { payload } : {}) });
          assert.equal(denied.statusCode, 401);
        }
      }
      assert.equal(membershipCalls, countBefore, "Invalid credentials must stop before database access or generation");
      const spoof = await app.inject({ method: "GET", url: sessionUrl, headers: { ...headers("colleague"), "x-sitong-user-id": "owner" } });
      assert.equal(spoof.statusCode, 404);
      revoked = true;
      assert.equal((await app.inject({ method: "GET", url: sessionUrl, headers: headers("owner") })).statusCode, 403);
      revoked = false; databaseError = true;
      for (const method of ["POST", "GET"] as const) {
        const failed = await app.inject({ method, url: method === "POST" ? "/exports/docx" : sessionUrl, headers: headers("owner"), ...(method === "POST" ? { payload } : {}) });
        assert.equal(failed.statusCode, 503);
        assert.ok(!failed.body.includes("synthetic-private-db-error-marker"));
      }
      databaseError = false;
      // 创建者带会话仍可走老路径取件（令牌被替换成无效值时回落会话校验），取件后同一条记录失效。
      const downloaded = await app.inject({ method: "GET", url: sessionUrl, headers: headers("owner") });
      expectDocxPayload(downloaded, "创建者会话下载");
      assert.equal((await app.inject({ method: "GET", url: sessionUrl, headers: headers("owner") })).statusCode, 404, "同一份导出只能取件一次（会话路径）");
      assert.equal((await app.inject({ method: "GET", url })).statusCode, 404, "同一份导出只能取件一次（令牌路径）");
      if (round === 0 && process.env.EXPORT_AUDIT_OUTPUT_DIR) {
        const root = resolve(process.env.EXPORT_AUDIT_OUTPUT_DIR);
        await mkdir(root, { recursive: true });
        await writeFile(resolve(root, "synthetic-export.docx"), downloaded.rawPayload);
        console.log(JSON.stringify({ stage: "docx_artifact", bytes: downloaded.rawPayload.length, sha256: createHash("sha256").update(downloaded.rawPayload).digest("hex") }));
      }

      // 一次性直链：手机/微信内置浏览器不带 Authorization 头，必须直接拿到文件。
      const direct = await app.inject({ method: "POST", url: "/exports/docx", headers: headers("owner"), payload });
      const directBody = expectExportCharge(direct, "直链用例导出", { credits: 0, redownload: true });
      const directToken = tokenOf(directBody.downloadUrl);
      issuedTokens.push(directToken);
      const directDownload = await app.inject({ method: "GET", url: directBody.downloadUrl });
      expectDocxPayload(directDownload, "一次性直链无人值守下载");
      assert.equal((await app.inject({ method: "GET", url: directBody.downloadUrl })).statusCode, 404, "一次性直链取件后立即失效");
      assert.equal((await app.inject({ method: "GET", url: directBody.downloadUrl, headers: headers("colleague") })).statusCode, 404, "已取件的直链泄漏给同事也不可用");

      // 令牌只对它自己那份记录有效：把 A 的令牌套到 B 的记录上校验不过（回落会话 → 401）。
      const linkA = await app.inject({ method: "POST", url: "/exports/docx", headers: headers("owner"), payload });
      const linkABody = expectExportCharge(linkA, "跨记录令牌用例 A", { credits: 0, redownload: true });
      const linkB = await app.inject({ method: "POST", url: "/exports/docx", headers: headers("owner"), payload });
      const linkBBody = expectExportCharge(linkB, "跨记录令牌用例 B", { credits: 0, redownload: true });
      issuedTokens.push(tokenOf(linkABody.downloadUrl), tokenOf(linkBBody.downloadUrl));
      assert.notEqual(linkABody.id, linkBBody.id, "每次导出必须换发新的记录 id");
      const crossed = await app.inject({ method: "GET", url: `/exports/docx/${linkABody.id}?t=${encodeURIComponent(tokenOf(linkBBody.downloadUrl))}` });
      assert.equal(crossed.statusCode, 401, "别的记录的令牌不得打开本记录");
      expectDocxPayload(await app.inject({ method: "GET", url: linkABody.downloadUrl }), "跨记录令牌用例 A 自取");
      expectDocxPayload(await app.inject({ method: "GET", url: linkBBody.downloadUrl }), "跨记录令牌用例 B 自取");

      const again = await app.inject({ method: "POST", url: "/exports/docx", headers: headers("owner"), payload });
      assert.equal(again.statusCode, 200);
      const againBody = expectExportCharge(again, "并发下载前的再次导出", { credits: 0, redownload: true });
      const simultaneous = await Promise.all([1, 2].map(() => app.inject({ method: "GET", url: againBody.downloadUrl })));
      assert.deepEqual(simultaneous.map(r => r.statusCode).sort(), [200, 404], "并发取件只能有一个成功");
      const expires = await app.inject({ method: "POST", url: "/exports/docx", headers: headers("owner"), payload });
      assert.equal(expires.statusCode, 200);
      const expiresBody = expectExportCharge(expires, "过期用例导出", { credits: 0, redownload: true });
      const realNow = Date.now;
      try {
        const future = realNow() + 11 * 60 * 1000;
        Date.now = () => future;
        assert.equal((await app.inject({ method: "GET", url: expiresBody.downloadUrl })).statusCode, 404, "超过 10 分钟的导出记录必须失效");
      } finally { Date.now = realNow; }
      assert.equal((await app.inject({ method: "POST", url: "/exports/docx", headers: headers("owner"), payload: { content: "" } })).statusCode, 400, "空内容不得生成交付物");
      console.log(JSON.stringify({ round, status: "PASS", auth: "signed_session_or_one_time_link", ttlMinutes: 10, oneUse: true, externalCalls }));
    }

    // 幂等键是「用户 + 标题 + 正文」，不是「同一用户永久免费」：换一份报告必须重新扣 10 积分。
    const another = await app.inject({ method: "POST", url: "/exports/docx", headers: headers("owner"), payload: { ...payload, content: `${payload.content}\n\n三、追加检查\n另一份报告必须单独计费。` } });
    assert.equal(another.statusCode, 200);
    expectExportCharge(another, "另一份报告导出", { credits: exportPrice, redownload: false });

    // 余额为 0 时仍要能重下自己已经付过费的那份报告（幂等键命中就不该报 402）。
    await prisma.wallet.update({ where: { userId: "owner" }, data: { paidBalance: 0 } });
    const zeroBalance = await app.inject({ method: "POST", url: "/exports/docx", headers: headers("owner"), payload });
    assert.equal(zeroBalance.statusCode, 200, "已付费的报告在零余额下必须能重下");
    const zeroBody = zeroBalance.json() as { consumedCredits: number; balance: number; redownload: boolean };
    assert.equal(zeroBody.consumedCredits, 0, "零余额重下：不得扣费");
    assert.equal(zeroBody.redownload, true, "零余额重下：必须是幂等重下");
    assert.equal(zeroBody.balance, 0, "零余额重下：返回真实余额，不虚构");
    await prisma.wallet.update({ where: { userId: "owner" }, data: { paidBalance: expectedBalance } });

    // 余额不足：402 且不生成交付物、不写账本。
    const broke = await app.inject({ method: "POST", url: "/exports/docx", headers: headers("broke"), payload });
    assert.equal(broke.statusCode, 402, "余额不足必须返回 402 而不是生成交付物");
    const brokeBody = broke.json() as { error: string; required: number; balance: number };
    assert.equal(brokeBody.error, "insufficient_credits");
    assert.equal(brokeBody.required, exportPrice);
    assert.equal(brokeBody.balance, 0);
    assert.equal(await prisma.walletLedger.count({ where: { userId: "broke", type: "consume" } }), 0, "扣费失败不得留下账本");

    // 按次独立计费：每次真实导出恰好一条 -10 账本，幂等重下不新增账本。
    const ownerConsumes = await prisma.walletLedger.findMany({ where: { userId: "owner", type: "consume" } });
    assert.equal(ownerConsumes.length, chargedExports, "每次真实导出恰好一条扣费账本，重下不重复计费");
    assert.ok(ownerConsumes.every((row) => row.delta === -exportPrice && row.bucket === "paid" && row.skillId === "docx_export"), "扣费固定 10 积分/次且标记来源");
    const ownerWallet = await prisma.wallet.findUnique({ where: { userId: "owner" } });
    assert.equal(ownerWallet?.paidBalance, expectedBalance, "导出扣费只发生在导出链路");
    assert.equal(externalCalls, 0);
    assert.ok(!logs.join("").includes("synthetic-private-db-error-marker"));
    assert.ok(!logs.join("").includes(payload.content));
    assert.ok(!logs.join("").includes("Bearer "));
    // 一次性直链是「持有即可取件一次」的能力，令牌落到日志等于泄漏。
    assert.ok(issuedTokens.length >= rounds * 4 && issuedTokens.every((value) => value.length > 20 && !logs.join("").includes(value)), "下载令牌不得出现在日志里");
    console.log(JSON.stringify({ status: "PASS", rounds, exportPrice, chargedExports, idempotentRedownloads: true, insufficientReturns402: true, oneTimeLink: true, providerCalls: 0, externalCalls }));
  } finally {
    await app.close();
    await prisma.user.deleteMany({ where: { id: { in: syntheticUserIds } } });
    Object.assign(env, saved); (prisma.membership as any).findFirst = originalFind; globalThis.fetch = originalFetch;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
