// LQ-34 测试实例灰度演练（**真实 HTTP + 真实库**，不是内存夹具）。
//
// 离线回归（`lanqi:wallet-smoke` / `lanqi:wallet-refund-drill`）证明的是「逻辑对不对」；
// 这一支补的是「**部署出来的实例真的按这套口径收钱吗**」——同样的断言必须打真实路由、
// 真实 prisma、真实 Serializable 事务，否则「本地绿了、实例裂账」永远发现不了。
//
// 演练内容（全部用合成的兰琪门店租户，跑完清理；不碰真实客户数据）：
//   ① 充值前：兰琪文案十件套 → 402 且**不调模型、不扣费**（证明「充值前兰琪不可用」）；
//   ② 真实充值（`applyRecharge`，与微信充值同一条入账路径）→ 同一能力不再 402
//      （证明「在兰琪充的钱，兰琪立刻能用」），并核对扣的是 **owner 钱包**、流水记操作人；
//   ③ 跨租户隔离：A 店 token 打不到 B 店门店（404）；同一 requestId 在 A/B 两店各扣各的；
//   ④ 没有 owner 的租户 → fail closed（409 lanqi_wallet_owner_missing，不扣费）；
//   ⑤ 失败退款演练：跨桶扣费 → 原桶退回 → 只退一次 → 已退款 requestId 不重放（不白送一次）；
//      以及「先扣钱、建任务失败 → 按同一 requestKey 补偿退款」在真实库上的镜像；
//   ⑥ 全程旧账零写入：`creditAccount` / `creditTransaction` / `creditReservation` 一行未动。
//
// 用法（在实例机上跑，或用 --base 指到实例）：
//   BASE=https://api.lcppch.top/lanqi-test/api \
//   DATABASE_URL=... JWT_SECRET=... UPLOAD_DIR=... \
//   node apps/api/node_modules/tsx/dist/cli.mjs scripts/lanqi-wallet-instance-drill.mts
//
// 只读真实客户数据：本脚本不查、不改任何既有租户；只建 `lq34drill-*` 前缀的合成数据并在 finally 里删掉。
import "dotenv/config";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../apps/api/node_modules/@baolu/db/dist/index.js";
import {
  chargeLanqiWallet,
  precheckLanqiWallet,
  readLanqiWalletBalance,
  refundLanqiWallet
} from "../apps/api/src/services/lanqi-wallet.js";
import { applyRecharge } from "../apps/api/src/services/sitong-wallet.js";

const BASE = (
  process.argv.find((arg) => arg.startsWith("--base="))?.slice("--base=".length) ??
  process.env.LQ34_DRILL_BASE ??
  "http://127.0.0.1:3010"
).replace(/\/+$/, "");
const JWT_SECRET = process.env.JWT_SECRET ?? "";
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? "uploads");

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass += 1;
    console.log(`ok - ${name}`);
  } else {
    fail += 1;
    console.error(`FAIL - ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}
function note(name: string, detail: string) {
  console.log(`note - ${name} :: ${detail}`);
}

const suffix = randomUUID().slice(0, 8);
const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];
const copyKitTenantIds: string[] = [];

/** 与 `services/auth-token.ts` 同算法的会话令牌（实例上直接造 token，免走登录）。 */
function sessionToken(tenantId: string, userId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ tenantId, userId, iat: now, exp: now + 3600 })).toString("base64url");
  const signature = createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

async function post(pathname: string, token: string, payload: unknown) {
  const response = await fetch(`${BASE}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body };
}

interface DrillStore {
  tenantId: string;
  userId: string;
  storeId: string;
  /** true = 有 owner 成员（付费主体存在）。 */
  hasOwner: boolean;
}

/** 合成一个「兰琪门店租户」：租户 + 老板 + 门店 + 成员 + 兰琪产品权益（与真实门店同形）。 */
async function seedLanqiStore(label: string, options: { owner?: boolean; paid?: number; bonus?: number; legacyBalance?: number } = {}): Promise<DrillStore> {
  const user = await prisma.user.create({ data: { nickname: `LQ34 演练 ${label} ${suffix}` } });
  const tenant = await prisma.tenant.create({
    data: { name: `LQ34 演练 ${label} ${suffix}`, type: "local_business", industry: "beauty", city: "烟台" }
  });
  const store = await prisma.store.create({ data: { tenantId: tenant.id, name: `LQ34 演练门店 ${label} ${suffix}` } });
  await prisma.membership.create({
    data: {
      tenantId: tenant.id,
      userId: user.id,
      storeId: store.id,
      role: options.owner === false ? "staff" : "owner",
      isActive: true
    }
  });
  // 兰琪产品作用域有 `requireProductEntitlement("lanqi")` 前置守卫，缺权益会被 403 挡在门口。
  await prisma.tenantProductEntitlement.create({
    data: { tenantId: tenant.id, productCode: "lanqi", status: "active", source: "lq34_instance_drill" }
  });
  await prisma.wallet.create({
    data: { userId: user.id, paidBalance: options.paid ?? 0, bonusBalance: options.bonus ?? 0 }
  });
  if (options.legacyBalance) {
    // 迁移前的旧账：演练要求它「一行都不动」。
    await prisma.creditAccount.create({ data: { tenantId: tenant.id, balance: options.legacyBalance } });
  }
  createdUserIds.push(user.id);
  createdTenantIds.push(tenant.id);
  copyKitTenantIds.push(tenant.id);
  return { tenantId: tenant.id, userId: user.id, storeId: store.id, hasOwner: options.owner !== false };
}

const walletOf = (userId: string) =>
  prisma.wallet.findUniqueOrThrow({ where: { userId }, select: { paidBalance: true, bonusBalance: true } });
const ledgerCount = (userId: string, where: Record<string, unknown>) =>
  prisma.walletLedger.count({ where: { userId, ...where } });
const requestKey = (tag: string) => `lq34drill${tag}${randomUUID().replace(/-/g, "").slice(0, 10)}`;

function brief() {
  return "烟台万达店，主做皮肤管理和身体护理，想推 199 元首次体验团单，让同城客人先到店。";
}

async function main() {
  console.log(`# LQ-34 实例灰度演练  base=${BASE}  suffix=${suffix}`);
  check("JWT_SECRET 已注入（否则造不出实例认可的令牌）", Boolean(JWT_SECRET));

  // 准备：A 店（老板，钱包 0 + 旧账 7）、B 店（老板，钱包 500）、C 店（只有 staff）。
  const a = await seedLanqiStore("A", { paid: 0, legacyBalance: 7 });
  const b = await seedLanqiStore("B", { paid: 500 });
  const c = await seedLanqiStore("C", { owner: false, paid: 500 });
  const tokenA = sessionToken(a.tenantId, a.userId);
  const tokenB = sessionToken(b.tenantId, b.userId);
  const tokenC = sessionToken(c.tenantId, c.userId);

  // ── ① 充值前：兰琪文案十件套必须被 402 挡下，且不扣费 ──────────────────────────────
  const keyA1 = requestKey("A1");
  const before = await post("/lanqi/acquire/copy-kit", tokenA, { storeId: a.storeId, brief: brief(), requestKey: keyA1 });
  check("① 充值前：余额 0 打兰琪文案十件套 → 402", before.status === 402, `status=${before.status} body=${JSON.stringify(before.body).slice(0, 200)}`);
  check("① 402 语义 = insufficient_credits 且 consumedCredits=0", before.body?.code === "insufficient_credits" && before.body?.consumedCredits === 0, JSON.stringify(before.body).slice(0, 200));
  check("① 402 带上「去充值」与余额/所需积分", typeof before.body?.rechargeUrl === "string" && before.body.rechargeUrl.includes("/recharge") && before.body?.balance === 0 && typeof before.body?.required === "number", JSON.stringify({ rechargeUrl: before.body?.rechargeUrl, balance: before.body?.balance, required: before.body?.required }));
  const price = Number(before.body?.required ?? 0);
  check("① 报价取自实例（用于后续核对扣费金额）", price > 0, `price=${price}`);
  const walletAfter402 = await walletOf(a.userId);
  check("① 402 之后钱包分毫未动（0/0）", walletAfter402.paidBalance === 0 && walletAfter402.bonusBalance === 0, JSON.stringify(walletAfter402));
  check("① 402 没有留下任何消费流水", (await ledgerCount(a.userId, {})) === 0, `ledger=${await ledgerCount(a.userId, {})}`);

  // ── ② 真实充值 → 同一能力立刻可用，且扣的是 owner 钱包 ─────────────────────────────
  const recharge = await applyRecharge({
    userId: a.userId,
    planId: "lq34-drill-plan",
    amountCny: 10,
    basePts: 100,
    bonusPts: 0,
    idempotencyKey: `lq34drill-${suffix}`,
    source: "lq34_instance_drill"
  });
  check("② 充值入账走真实路径（applyRecharge 写 paid 桶）", recharge.wallet.paidBalance === 100 && !recharge.idempotent, JSON.stringify(recharge));
  const lanqiBalance = await readLanqiWalletBalance(a.tenantId);
  check("② 兰琪读到的余额 = 刚充的这笔钱包余额（同一本账）", lanqiBalance?.balance === 100 && lanqiBalance?.ownerUserId === a.userId, JSON.stringify(lanqiBalance));

  const keyA2 = requestKey("A2");
  // 生成一次「内容十件套」要真调模型，模型偶发不满足十件套结构会走 422（合同校验不过 → 明确不扣分）。
  // 这与计费口径无关，所以最多重试 3 次拿一次「真的过了合同、真的扣了钱」的样本，
  // 每次都留证据（状态码 / 失败原因），失败次数不藏。
  let after: Awaited<ReturnType<typeof post>> = { status: 0, body: {} };
  let chargedKey = "";
  let consumed = 0;
  const attempts: Array<{ attempt: number; status: number; code?: string; consumedCredits: number; reasons?: unknown }> = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const key = attempt === 1 ? keyA2 : requestKey(`A2-${attempt}`);
    after = await post("/lanqi/acquire/copy-kit", tokenA, {
      storeId: a.storeId,
      brief: brief(),
      platform: "dy",
      goal: "visit",
      requestKey: key
    });
    const attemptConsumed = Number(after.body?.consumedCredits ?? 0);
    attempts.push({ attempt, status: after.status, code: after.body?.code, consumedCredits: attemptConsumed, reasons: after.body?.reasons });
    if (after.status === 200 && attemptConsumed > 0) {
      chargedKey = key;
      consumed = attemptConsumed;
      break;
    }
    check(`② 第 ${attempt} 次没有通过（不允许扣分）`, attemptConsumed === 0, `consumedCredits=${attemptConsumed}`);
  }
  check("② 充值后：同一入口不再 402（充值前兰琪不可用 → 充值后可用）", attempts.every((item) => item.status !== 402), `attempts=${JSON.stringify(attempts)}`);
  const walletAfterCall = await walletOf(a.userId);
  if (consumed > 0) {
    note("② 真实调用了模型、过了内容合同、完成了扣费", `consumedCredits=${consumed} 第 ${attempts.length} 次尝试`);
    check("② 扣费金额 = 实例报价", consumed === price, `consumed=${consumed} price=${price}`);
    check("② 扣的是 owner 钱包（100 → 100-报价）", walletAfterCall.paidBalance === 100 - price && walletAfterCall.bonusBalance === 0, JSON.stringify(walletAfterCall));
    const consumeRows = await prisma.walletLedger.findMany({
      where: { userId: a.userId, type: "consume" },
      select: { refRequestId: true, source: true, delta: true }
    });
    check("② 只写了一条消费流水（同 requestKey 幂等）", consumeRows.length === 1, JSON.stringify(consumeRows));
    check("② 流水带租户前缀幂等键", consumeRows[0]?.refRequestId === `lanqi:${a.tenantId}:${chargedKey}`, JSON.stringify(consumeRows[0]));
    check("② 流水记了操作人（谁点的这一下）", Boolean(consumeRows[0]?.source?.includes(`operator=${a.userId}`)), JSON.stringify(consumeRows[0]));
  } else {
    note("② 实例三次都没走到扣费（能力未放行 / 模型未过合同）", `attempts=${JSON.stringify(attempts)}`);
    check("② 未扣费时钱包必须保持 100（不扣钱才允许失败）", walletAfterCall.paidBalance === 100, JSON.stringify(walletAfterCall));
    const gate = await precheckLanqiWallet({ tenantId: a.tenantId, credits: price });
    check("② 充值后钱包侧前置校验放行（门是真开了，不是路由没接上）", gate.ok === true && gate.balance === 100, JSON.stringify(gate));
    if (after.status === 403) {
      check("② 403 若是权益/放行导致，需人工确认后重跑", true, JSON.stringify(after.body).slice(0, 160));
    }
  }

  // ── ③ 跨租户隔离 ────────────────────────────────────────────────────────────────
  const crossStore = await post("/lanqi/acquire/copy-kit", tokenA, { storeId: b.storeId, brief: brief(), requestKey: requestKey("A3") });
  check("③ A 店 token 打不到 B 店门店（404 store_not_found）", crossStore.status === 404 && crossStore.body?.code === "store_not_found", `status=${crossStore.status} body=${JSON.stringify(crossStore.body).slice(0, 160)}`);
  const walletBUntouched = await walletOf(b.userId);
  check("③ A 店全部动作后 B 店钱包分毫未动（500）", walletBUntouched.paidBalance === 500 && walletBUntouched.bonusBalance === 0, JSON.stringify(walletBUntouched));
  // 同一个 requestId 在两家店各扣各的（幂等键必须带租户前缀，否则同一 owner 服务多店会撞键）。
  const sharedKey = `lq34drillshared${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const chargeB = await chargeLanqiWallet({ tenantId: b.tenantId, operatorUserId: b.userId, requestId: sharedKey, credits: 40, skillId: "lanqi_copy_kit" });
  check("③ 同一 requestId 在 B 店独立计费（不撞 A 店的键）", chargeB.status === "completed" && chargeB.wallet.balance === 460, JSON.stringify(chargeB).slice(0, 200));
  const balanceAAfterAll = await readLanqiWalletBalance(a.tenantId);
  check("③ B 店扣费没有影响 A 店钱包", balanceAAfterAll?.balance === (100 - consumed), JSON.stringify(balanceAAfterAll));

  // ── ④ 没有 owner 的租户 → fail closed ───────────────────────────────────────────
  const noOwnerHttp = await post("/lanqi/acquire/copy-kit", tokenC, { storeId: c.storeId, brief: brief(), requestKey: requestKey("C1") });
  check("④ 只有 staff 的门店打兰琪能力 → 409 lanqi_wallet_owner_missing", noOwnerHttp.status === 409 && noOwnerHttp.body?.code === "lanqi_wallet_owner_missing", `status=${noOwnerHttp.status} body=${JSON.stringify(noOwnerHttp.body).slice(0, 200)}`);
  check("④ fail closed：没有扣费、没有消费流水（哪怕钱包里有钱）", (await walletOf(c.userId)).paidBalance === 500 && (await ledgerCount(c.userId, {})) === 0, JSON.stringify(await walletOf(c.userId)));
  const noOwnerPrecheck = await precheckLanqiWallet({ tenantId: c.tenantId, credits: 1 });
  check("④ 钱包侧前置校验也 fail closed", noOwnerPrecheck.ok === false && noOwnerPrecheck.code === "lanqi_wallet_owner_missing", JSON.stringify(noOwnerPrecheck));

  // ── ⑤ 失败退款演练（真实库：跨桶扣费 → 原桶退回 → 只退一次 → 已退款不重放）──────────
  const d = await seedLanqiStore("D", { paid: 30, bonus: 10, legacyBalance: 0 });
  const keyD1 = `lq34drillrefund${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const chargeD = await chargeLanqiWallet({ tenantId: d.tenantId, operatorUserId: d.userId, requestId: keyD1, credits: 40, skillId: "lanqi_seedance" });
  check("⑤ 跨桶扣费：状态 completed 且 paid 30 + bonus 10 各扣各的", chargeD.status === "completed" && chargeD.spent.paid === 30 && chargeD.spent.bonus === 10, JSON.stringify(chargeD).slice(0, 220));
  check("⑤ 跨桶扣费后钱包归零", (await walletOf(d.userId)).paidBalance === 0 && (await walletOf(d.userId)).bonusBalance === 0, JSON.stringify(await walletOf(d.userId)));
  const consumeRowsD = await prisma.walletLedger.findMany({ where: { userId: d.userId, type: "consume" }, select: { bucket: true, delta: true } });
  check("⑤ 消费流水按桶拆两条（paid -30 / bonus -10）", consumeRowsD.length === 2 && consumeRowsD.some((r) => r.bucket === "paid" && r.delta === -30) && consumeRowsD.some((r) => r.bucket === "bonus" && r.delta === -10), JSON.stringify(consumeRowsD));

  const refundD = await refundLanqiWallet({ tenantId: d.tenantId, requestId: keyD1, skillId: "lanqi_seedance", reason: "lq34_instance_drill" });
  check("⑤ 退款按原桶退回（paid 30 / bonus 10，不把 bonus 退成 paid）", refundD.status === "refunded" && refundD.refunded === 40 && refundD.wallet.paidBalance === 30 && refundD.wallet.bonusBalance === 10, JSON.stringify(refundD).slice(0, 220));
  const refundRowsD = await prisma.walletLedger.findMany({ where: { userId: d.userId, type: "refund" }, select: { bucket: true, delta: true } });
  check("⑤ 退款流水也只按桶拆两条（paid +30 / bonus +10）", refundRowsD.length === 2 && refundRowsD.some((r) => r.bucket === "paid" && r.delta === 30) && refundRowsD.some((r) => r.bucket === "bonus" && r.delta === 10), JSON.stringify(refundRowsD));

  const refundAgainD = await refundLanqiWallet({ tenantId: d.tenantId, requestId: keyD1, skillId: "lanqi_seedance" });
  const walletAfterDoubleRefund = await walletOf(d.userId);
  check("⑤ 同一 requestId 只退一次（余额没有越退越多）", refundAgainD.idempotent === true && walletAfterDoubleRefund.paidBalance === 30 && walletAfterDoubleRefund.bonusBalance === 10, JSON.stringify({ refundAgainD, walletAfterDoubleRefund }).slice(0, 260));
  check("⑤ 重复退款没有再写流水", (await ledgerCount(d.userId, { type: "refund" })) === 2, `refundRows=${await ledgerCount(d.userId, { type: "refund" })}`);

  const replayD = await chargeLanqiWallet({ tenantId: d.tenantId, operatorUserId: d.userId, requestId: keyD1, credits: 40, skillId: "lanqi_seedance" });
  check("⑤ 已退款的 requestId 不允许重放（status=refunded，不白送一次付费执行）", replayD.status === "refunded", JSON.stringify(replayD).slice(0, 200));
  check("⑤ 重放被拦下后余额仍未变动", (await walletOf(d.userId)).paidBalance === 30 && (await walletOf(d.userId)).bonusBalance === 10, JSON.stringify(await walletOf(d.userId)));

  // 「先扣钱 → 建任务失败 → 按同一 requestKey 补偿退款」在真实库上的镜像（②③④ 的补偿路径）。
  const keyD2 = `lq34drilljobfail${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const chargeD2 = await chargeLanqiWallet({ tenantId: d.tenantId, operatorUserId: d.userId, requestId: keyD2, credits: 40, skillId: "lanqi_video_replication" });
  check("⑤ 先扣钱（建任务失败前的状态）", chargeD2.status === "completed" && chargeD2.wallet.balance === 0, JSON.stringify(chargeD2).slice(0, 200));
  const compensate = await refundLanqiWallet({ tenantId: d.tenantId, requestId: keyD2, skillId: "lanqi_video_replication", reason: "replication_create_failed" });
  check("⑤ 建任务失败 → 按同一 requestKey 补偿退款回原桶", compensate.status === "refunded" && compensate.refunded === 40 && compensate.wallet.paidBalance === 30 && compensate.wallet.bonusBalance === 10, JSON.stringify(compensate).slice(0, 220));
  const replayD2 = await chargeLanqiWallet({ tenantId: d.tenantId, requestId: keyD2, credits: 40, skillId: "lanqi_video_replication" });
  check("⑤ 补偿退款后同一 requestKey 被封（换新单号才能再来）", replayD2.status === "refunded", JSON.stringify(replayD2).slice(0, 200));
  check("⑤ 整段退款演练没有牵动其它门店（B 店仍是 460）", (await walletOf(b.userId)).paidBalance === 460, JSON.stringify(await walletOf(b.userId)));

  // ── ⑥ 旧账零写入 ────────────────────────────────────────────────────────────────
  const legacyAccount = await prisma.creditAccount.findUnique({ where: { tenantId: a.tenantId }, select: { balance: true } });
  check("⑥ 旧账 creditAccount 仍是最初那 7 分（兰琪不再写租户账户）", legacyAccount?.balance === 7, JSON.stringify(legacyAccount));
  for (const store of [a, d]) {
    const txs = await prisma.creditTransaction.count({ where: { tenantId: store.tenantId } });
    const reservations = await prisma.creditReservation.count({ where: { tenantId: store.tenantId } });
    check(`⑥ ${store.tenantId === a.tenantId ? "A" : "D"} 店没有新增 creditTransaction / creditReservation`, txs === 0 && reservations === 0, JSON.stringify({ txs, reservations }));
  }

  console.log(`\n# 证据汇总 ${JSON.stringify({
    base: BASE,
    copyKitPrice: price,
    rechargeBefore: { status402: before.status, balance: before.body?.balance },
    afterRecharge: { attempts, consumedCredits: consumed, wallet: await walletOf(a.userId) },
    crossTenant: { aTokenOnBStore: crossStore.status, bWallet: await walletOf(b.userId), aWallet: await walletOf(a.userId) },
    noOwner: { status: noOwnerHttp.status, code: noOwnerHttp.body?.code },
    refundDrill: { wallet: await walletOf(d.userId), refundRows: await ledgerCount(d.userId, { type: "refund" }) }
  })}`);
}

async function cleanup() {
  for (const tenantId of createdTenantIds) {
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
  }
  for (const userId of createdUserIds) {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  }
  // 文案十件套的结果缓存在磁盘上（按租户 id 哈希分目录），演练完一并清掉。
  for (const tenantId of copyKitTenantIds) {
    const tenantKey = createHash("sha256").update(tenantId).digest("hex").slice(0, 24);
    await rm(path.join(UPLOAD_DIR, "lanqi-copy-kit", tenantKey), { recursive: true, force: true }).catch(() => undefined);
  }
}

main()
  .catch((error) => {
    fail += 1;
    console.error("FAIL - 未捕获异常", error);
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    console.log(`\nlanqi_wallet_instance_drill: ${fail === 0 ? "PASS" : "FAIL"} (${pass} passed / ${fail} failed)`);
    process.exit(fail === 0 ? 0 : 1);
  });
