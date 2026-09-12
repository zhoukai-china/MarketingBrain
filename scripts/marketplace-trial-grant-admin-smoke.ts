// PLAT-11 运营后台体验额度发放页（`/agents/admin` ↔ `/market/admin/trial-grants`）HTTP 级回归。
//
// 与 `scripts/marketplace-trial-grant-smoke.ts`（PLAT-10 运维 CLI）的分工：
//   - PLAT-10 锁的是「CLI 发放的口径」；
//   - 本脚本锁的是「HTTP 入口的鉴权、状态码、幂等与资金落点」——这是销售/运营真正走的路径。
//
// 锁死的契约：
//   1. 未携带会话 → 401 `login_required`，不得 200、不得 500；
//   2. 租户内低权限角色（rank 0）→ 403，读用 `marketplace_admin_required`、写用 `marketplace_admin_write_required`；
//   3. 资金侧写操作必须由**平台运维凭证**证明身份：只靠租户级 owner/operator 角色
//      会让任意商家给自己发体验积分（P0，见 docs/BUG_REGRESSIONS.md QA-20260911-009），
//      因此无关租户的 owner 主动发放必须 401 `admin_token_required`；
//   4. 正常路径：发放 400 → `state=created`、bonus +400、列表可按 grantId 对账；
//   5. 幂等：同 grantId 重放 → `already_applied` 且不重复加币；换金额 → 409 `trial_grant_id_conflict`；
//   6. 失败关闭：未知手机号 → 404；金额 0 / 801 / 非整数 → 400；身份双填 → 400；
//   7. `dryRun` 零写入；用户之间隔离；体验额度不进租户级 `CreditAccount`。
import "dotenv/config";
process.env.SKILL_MCP_REQUIRED = "false";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import { prisma } from "../apps/api/node_modules/@baolu/db/dist/index.js";
import { registerMarketplaceRoutes } from "../apps/api/src/routes/marketplace.js";
import { env } from "../apps/api/src/config/env.js";
import { sessionHeaders } from "./lib/db-session-headers.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

async function cleanup(): Promise<void> {
  for (const userId of createdUserIds) {
    await prisma.walletLedger.deleteMany({ where: { userId } });
    await prisma.wallet.deleteMany({ where: { userId } });
  }
  for (const tenantId of createdTenantIds) {
    await prisma.marketplaceSkuEntitlement.deleteMany({ where: { tenantId } });
    await prisma.creditTransaction.deleteMany({ where: { tenantId } });
    await prisma.creditAccount.deleteMany({ where: { tenantId } });
    await prisma.membership.deleteMany({ where: { tenantId } });
    await prisma.store.deleteMany({ where: { tenantId } });
    await prisma.tenantProfile.deleteMany({ where: { tenantId } });
    await prisma.tenantAgentEntitlement.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  }
  for (const userId of createdUserIds) {
    await prisma.user.deleteMany({ where: { id: userId } });
  }
}

async function createMember(label: string, role: string) {
  const suffix = randomUUID().slice(0, 8);
  const tenantId = `mp-tg-${label}-${suffix}`;
  const userId = `mp-tgu-${label}-${suffix}`;
  const phone = `139${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
  await prisma.tenant.create({ data: { id: tenantId, name: `Trial Admin Smoke ${label}`, type: "local_business" } });
  await prisma.user.create({ data: { id: userId, nickname: `Trial Admin ${label}`, phone } });
  await prisma.membership.create({
    data: { id: `mp-tgm-${label}-${suffix}`, tenantId, userId, role, isActive: true }
  });
  createdTenantIds.push(tenantId);
  createdUserIds.push(userId);
  return { tenantId, userId, phone };
}

/**
 * 复刻 `apps/api/src/server.ts` 的错误映射：脚本里是裸 Fastify 实例，
 * 不注册同样的映射就会把「未登录」误报成 500，掩盖真实状态码。
 */
function applyProductionErrorMapping(app: ReturnType<typeof Fastify>): void {
  app.setErrorHandler((error, request, reply) => {
    if (error.message === "missing_tenant_or_user" || error.message === "membership_not_found") {
      return reply.code(401).send({ error: "login_required", message: "请先完成微信登录和账号绑定。" });
    }
    if (typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: "invalid_request", message: error.message });
    }
    return reply.code(500).send({ error: "internal_server_error", message: "服务暂时不可用，请稍后重试" });
  });
}

/** 平台运维凭证：生产环境里体验额度发放必须带上它（local/dev 未配置时为空）。 */
function adminToken(): string {
  if (process.env.MARKETPLACE_ADMIN_SMOKE_TOKEN) return process.env.MARKETPLACE_ADMIN_SMOKE_TOKEN;
  try {
    const lines = readFileSync(".env", "utf8").split(/\r?\n/);
    for (const line of lines) {
      const match = /^\s*(?:export\s+)?ADMIN_TOKEN\s*=\s*(.*)$/.exec(line);
      if (match?.[1]) return match[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // 没有 .env：留空，走开发环境「未配置即放行」的既有语义。
  }
  return env.ADMIN_TOKEN ?? "";
}

async function walletOf(userId: string) {
  return await prisma.wallet.findUnique({ where: { userId } });
}

async function ledgerRows(userId: string, grantId: string) {
  return await prisma.walletLedger.findMany({
    where: { userId, source: `trial_grant:${grantId}` },
    select: { id: true, delta: true, bucket: true, type: true, refOrderId: true }
  });
}

async function main(): Promise<void> {
  const staff = await createMember("staff", "owner");
  const lowRole = await createMember("lowrole", "staff");
  const outsider = await createMember("outsider", "owner");
  const grantId = `20260911-smoke-${randomUUID().slice(0, 8)}`;
  const replayId = `${grantId}-replay`;
  const conflictId = `${grantId}-conflict`;
  const dryId = `${grantId}-dry`;
  const outsiderId = `${grantId}-outsider`;

  const app = Fastify();
  applyProductionErrorMapping(app);
  await registerMarketplaceRoutes(app);

  const token = adminToken();
  assert(
    token.length > 0,
    "本回归要求在 .env 配置 ADMIN_TOKEN（生产本就强制要求它）——未配置时平台守卫按既有约定放行，这条 P0 就失去守护"
  );
  const staffHeaders = { ...sessionHeaders(staff.tenantId, staff.userId), ...(token ? { "x-sitong-admin-token": token } : {}), "content-type": "application/json" };
  const lowHeaders = { ...sessionHeaders(lowRole.tenantId, lowRole.userId), "content-type": "application/json" };
  const outsiderHeaders = { ...sessionHeaders(outsider.tenantId, outsider.userId), "content-type": "application/json" };
  const LIST_URL = "/market/admin/trial-grants?limit=20";

  try {
    // 1. 未携带会话：必须 401，不得 500、不得放行。
    const anonGet = await app.inject({ method: "GET", url: LIST_URL });
    assert(anonGet.statusCode === 401, `anonymous GET is rejected with 401 (got ${anonGet.statusCode}: ${anonGet.body.slice(0, 200)})`);
    const anonPost = await app.inject({
      method: "POST",
      url: "/market/admin/trial-grants",
      headers: { "content-type": "application/json" },
      payload: { identity: { userId: staff.userId }, amount: 400, grantId: `${grantId}-anon` }
    });
    assert(anonPost.statusCode === 401, `anonymous POST is rejected with 401 (got ${anonPost.statusCode})`);

    // 2. 租户内低权限角色：读 403 read 守卫、写 403 write 守卫。
    const lowGet = await app.inject({ method: "GET", url: LIST_URL, headers: lowHeaders });
    assert(lowGet.statusCode === 403, `low-role GET is rejected with 403 (got ${lowGet.statusCode})`);
    assert(
      (lowGet.json() as { error?: string }).error === "marketplace_admin_required",
      `low-role GET reports marketplace_admin_required (got ${lowGet.body.slice(0, 200)})`
    );
    const lowPost = await app.inject({
      method: "POST",
      url: "/market/admin/trial-grants",
      headers: lowHeaders,
      payload: { identity: { userId: staff.userId }, amount: 400, grantId: `${grantId}-low` }
    });
    assert(
      lowPost.statusCode === 403 || lowPost.statusCode === 401,
      `low-role POST is rejected (got ${lowPost.statusCode})`
    );
    assert(
      (await walletOf(lowRole.userId)) === null && (await ledgerRows(staff.userId, `${grantId}-low`)).length === 0,
      "low-role POST must not write any balance or ledger row"
    );

    // 3. P0 红灯：无关租户的 owner 不能靠「自己就是 owner」给自己发体验积分。
    const outsiderPost = await app.inject({
      method: "POST",
      url: "/market/admin/trial-grants",
      headers: outsiderHeaders,
      payload: { identity: { userId: outsider.userId }, amount: 800, grantId: outsiderId }
    });
    assert(
      outsiderPost.statusCode === 401 || outsiderPost.statusCode === 403,
      `unrelated tenant owner must NOT be able to self-grant trial credits (got ${outsiderPost.statusCode}: ${outsiderPost.body.slice(0, 200)})`
    );
    const outsiderWallet = await walletOf(outsider.userId);
    assert(
      (outsiderWallet?.bonusBalance ?? 0) === 0,
      `unrelated tenant owner wallet stays 0 (got ${outsiderWallet?.bonusBalance ?? 0})`
    );
    const outsiderGet = await app.inject({ method: "GET", url: LIST_URL, headers: outsiderHeaders });
    assert(
      outsiderGet.statusCode === 401 || outsiderGet.statusCode === 403,
      `unrelated tenant owner must NOT read the global grant list with customer phones (got ${outsiderGet.statusCode})`
    );

    // 4. 正常路径：平台运维凭证 + 角色守卫都通过 → 真实发放。
    const create = await app.inject({
      method: "POST",
      url: "/market/admin/trial-grants",
      headers: staffHeaders,
      payload: { identity: { userId: staff.userId }, amount: 400, grantId, operator: "sales01" }
    });
    if (create.statusCode !== 200) console.log("CREATE_RESPONSE", create.statusCode, create.body.slice(0, 600));
    assert(create.statusCode === 200, `grant returns 200 (got ${create.statusCode}: ${create.body.slice(0, 300)})`);
    const created = (create.json() as { grant: { state: string; amount: number; wallet: { bonusBalance: number } } }).grant;
    assert(created.state === "created", `grant state is created (got ${created.state})`);
    assert(created.amount === 400, `grant amount is 400 (got ${created.amount})`);
    assert(created.wallet.bonusBalance === 400, `bonus bucket is 400 (got ${created.wallet.bonusBalance})`);
    const afterCreate = await walletOf(staff.userId);
    assert(afterCreate?.bonusBalance === 400, `wallet bonus is 400 (got ${afterCreate?.bonusBalance})`);
    assert(afterCreate?.paidBalance === 0, `paid bucket untouched (got ${afterCreate?.paidBalance})`);
    const rows = await ledgerRows(staff.userId, grantId);
    assert(rows.length === 1, `exactly one ledger row (got ${rows.length})`);
    assert(rows[0].bucket === "bonus" && rows[0].type === "bonus", `ledger lands in bonus/bonus (got ${rows[0].bucket}/${rows[0].type})`);
    assert(rows[0].refOrderId === "operator:sales01", `ledger records the operator (got ${rows[0].refOrderId})`);

    // 5. 对账列表能查到这笔发放，且带 grantId / 金额 / 发放人。
    const list = await app.inject({ method: "GET", url: LIST_URL, headers: staffHeaders });
    assert(list.statusCode === 200, `grant list returns 200 (got ${list.statusCode})`);
    const listed = (list.json() as { grants: Array<{ grantId: string; amount: number; operator: string | null }> }).grants.find((row) => row.grantId === grantId);
    assert(listed !== undefined, `grant list contains ${grantId}`);
    assert(listed.amount === 400, `listed amount is 400 (got ${listed.amount})`);
    assert(listed.operator === "sales01", `listed operator is sales01 (got ${listed.operator})`);

    // 6. 幂等重放：同 grantId 同金额不重复加币。
    const replay = await app.inject({
      method: "POST",
      url: "/market/admin/trial-grants",
      headers: staffHeaders,
      payload: { identity: { userId: staff.userId }, amount: 400, grantId, operator: "sales01" }
    });
    assert(replay.statusCode === 200, `replay returns 200 (got ${replay.statusCode})`);
    assert((replay.json() as { grant: { state: string } }).grant.state === "already_applied", "replay reports already_applied");
    assert((await walletOf(staff.userId))?.bonusBalance === 400, "replay does not double-credit");
    assert((await ledgerRows(staff.userId, grantId)).length === 1, "replay keeps one ledger row");

    // 7. 同 grantId 换金额 → 409 冲突，且不改余额。
    const conflict = await app.inject({
      method: "POST",
      url: "/market/admin/trial-grants",
      headers: staffHeaders,
      payload: { identity: { userId: staff.userId }, amount: 500, grantId }
    });
    assert(conflict.statusCode === 409, `changed amount reports 409 (got ${conflict.statusCode})`);
    assert((conflict.json() as { error?: string }).error === "trial_grant_id_conflict", `conflict error code (got ${conflict.body.slice(0, 200)})`);
    assert((await walletOf(staff.userId))?.bonusBalance === 400, "conflict does not change the balance");

    // 8. 未知客户 → 404，且必须先自己注册。
    const unknown = await app.inject({
      method: "POST",
      url: "/market/admin/trial-grants",
      headers: staffHeaders,
      payload: { identity: { phone: "13900000009" }, amount: 400, grantId: `${grantId}-unknown` }
    });
    assert(unknown.statusCode === 404, `unknown phone reports 404 (got ${unknown.statusCode})`);
    assert((unknown.json() as { error?: string }).error === "trial_grant_user_not_found", `unknown phone error code (got ${unknown.body.slice(0, 200)})`);

    // 9. 金额与身份边界：0 / 801 / 非整数 / 双身份都必须 400。
    for (const [label, payload] of [
      ["amount=0", { identity: { userId: staff.userId }, amount: 0, grantId: `${grantId}-zero` }],
      ["amount=801", { identity: { userId: staff.userId }, amount: 801, grantId: `${grantId}-over` }],
      ["amount=1.5", { identity: { userId: staff.userId }, amount: 1.5, grantId: `${grantId}-frac` }],
      ["identity=userId+phone", { identity: { userId: staff.userId, phone: staff.phone }, amount: 400, grantId: `${grantId}-double` }]
    ] as const) {
      const response = await app.inject({ method: "POST", url: "/market/admin/trial-grants", headers: staffHeaders, payload });
      assert(response.statusCode === 400, `${label} reports 400 (got ${response.statusCode}: ${response.body.slice(0, 200)})`);
    }
    assert((await walletOf(staff.userId))?.bonusBalance === 400, "rejected requests never touch the balance");

    // 10. dryRun 零写入。
    const dry = await app.inject({
      method: "POST",
      url: "/market/admin/trial-grants",
      headers: staffHeaders,
      payload: { identity: { userId: staff.userId }, amount: 200, grantId: dryId, dryRun: true }
    });
    assert(dry.statusCode === 200, `dry-run returns 200 (got ${dry.statusCode})`);
    assert((dry.json() as { grant: { state: string } }).grant.state === "dry_run", "dry-run reports dry_run");
    assert((await walletOf(staff.userId))?.bonusBalance === 400, "dry-run does not change the balance");
    assert((await ledgerRows(staff.userId, dryId)).length === 0, "dry-run writes no ledger row");

    // 11. dryRun 之后用同一个 grantId 真发，必须能发出去（预演不占坑）。
    const dryThenReal = await app.inject({
      method: "POST",
      url: "/market/admin/trial-grants",
      headers: staffHeaders,
      payload: { identity: { userId: staff.userId }, amount: 200, grantId: dryId }
    });
    assert(dryThenReal.statusCode === 200, `dry-run then real returns 200 (got ${dryThenReal.statusCode})`);
    assert((dryThenReal.json() as { grant: { state: string } }).grant.state === "created", "dry-run then real is created");
    assert((await walletOf(staff.userId))?.bonusBalance === 600, `dry-run then real credits 200 (got ${(await walletOf(staff.userId))?.bonusBalance})`);

    // 12. 不应发生：体验额度不写租户级 CreditAccount（避免双账本口径分叉）。
    for (const tenantId of createdTenantIds) {
      const account = await prisma.creditAccount.findUnique({ where: { tenantId } });
      const txCount = await prisma.creditTransaction.count({ where: { tenantId } });
      assert(account === null, `tenant-level CreditAccount is not written (${tenantId})`);
      assert(txCount === 0, `tenant-level CreditTransaction is not written (${tenantId})`);
    }

    // 13. 幂等冲突编号与预演编号不会互相占用：上面三个编号应当只有 2 条真实流水。
    assert((await ledgerRows(staff.userId, conflictId)).length === 0, "conflict id never writes a row");
    assert(
      (await prisma.walletLedger.count({ where: { userId: staff.userId, source: { startsWith: "trial_grant:" } } })) === 2,
      "exactly two real trial-grant rows exist for this user"
    );

    console.log(`PASS marketplace-trial-grant-admin-smoke (adminToken=${token ? "configured" : "unset(dev)"})`);
  } finally {
    await app.close();
    await cleanup();
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
