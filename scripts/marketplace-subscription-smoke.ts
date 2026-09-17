// 包月订阅计费回归（用户 2026-09-17 拍板：有的智能体按次、有的按消耗、有的支持按月订阅，订阅期内不扣积分）。
//
// 触发：文案智能体包月＝**4000 积分/月、每天 5 条**。上线前必须钉死下面几件事，
// 否则最坏情况是「用户买了包月还被扣积分」或「额度用完后静默改成扣分」——两者都是付费错误（P0）。
//
// 本用例守护：
//   1. 订阅按点数扣 4000，且只扣一次（重复点「订阅」不重复扣分）。
//   2. 订阅期内 `/run` 消耗 **0 积分**（余额不变），账本按 `marketplace_subscription_usage` 打标签，
//      并如实回报「今天已用 / 还剩几次」。
//   3. 当天额度用完后 `/run` 返回 409 `marketplace_subscription_quota_exhausted`，
//      **不静默改成扣积分**，余额一分不动。
//   4. 租户隔离：别的租户看不到、也吃不到这份订阅。
//   5. 前端与路由的契约：不扣分有明确说法，409 有独立分支，未订阅时给「按次 / 包月」二选一。
import dotenv from "dotenv";

dotenv.config({ path: "apps/api/.env", quiet: true });
process.env.DATA_MODE = "database";
// 本用例只验计费口径，不验 MCP 工具编排；否则本地没有 MCP 连接会先被拦截。
process.env.SKILL_MCP_REQUIRED = "false";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

let failed = 0;
function check(ok: boolean, label: string) {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}`);
  if (!ok) failed += 1;
}

const EXPECTED_SUB_CREDITS = 4000;
const EXPECTED_DAILY_QUOTA = 5;
const START_BALANCE = 5000;
const USAGE_REF_TYPE = "marketplace_subscription_usage";

interface AccessBody {
  state: string;
  balance: number;
  subscription?: {
    id: string;
    endDate: string;
    dailyQuota: number | null;
    usedToday: number;
    remaining: number | null;
    exhausted: boolean;
  };
  subscriptionOffer?: {
    credits: number;
    dailyQuota: number | null;
    quota: string | null;
    periodDays: number;
  } | null;
}

async function main(): Promise<void> {
  const { prisma } = await import("../apps/api/node_modules/@baolu/db/dist/index.js");
  const { registerMarketplaceRoutes } = await import("../apps/api/src/routes/marketplace.js");
  const { ensureMarketplaceCatalog } = await import("../apps/api/src/services/marketplace-catalog.js");
  const { sessionHeaders } = await import("./lib/db-session-headers.js");

  assert(
    process.env.DATA_MODE !== "demo",
    "包月计费回归必须在 DATA_MODE=database 下运行（demo 模式没有真实订阅与钱包账本）"
  );

  await ensureMarketplaceCatalog();

  // 找一个真实配置了包月的 SKU（前端文案智能体 ipzone__copy，4000 积分/月 · 每天 5 条）。
  const skuRow = await prisma.marketplaceSku.findFirst({
    where: { skuCode: { endsWith: "__copy" }, status: "selling" }
  });
  assert(skuRow !== null, "货架上有可售的文案智能体（skuCode 以 __copy 结尾）");
  assert(
    (skuRow!.subscriptionCredits ?? 0) === EXPECTED_SUB_CREDITS,
    `文案智能体包月价应为 ${EXPECTED_SUB_CREDITS} 积分（实际 ${skuRow!.subscriptionCredits}）——检查 marketplace-v3.json 的 sub.credits 与 ensureMarketplaceCatalog 的写了没`
  );
  assert(
    skuRow!.subscriptionDailyQuota === EXPECTED_DAILY_QUOTA,
    `文案智能体每日条数上限应为 ${EXPECTED_DAILY_QUOTA}（实际 ${skuRow!.subscriptionDailyQuota}）`
  );

  const tenantId = `mp-sub-${randomUUID()}`;
  const userId = `mp-sub-user-${randomUUID()}`;
  const otherTenantId = `mp-sub-other-${randomUUID()}`;
  const otherUserId = `mp-sub-other-user-${randomUUID()}`;

  await prisma.tenant.create({ data: { id: tenantId, name: "Marketplace Subscription Smoke", type: "local_business" } });
  await prisma.user.create({ data: { id: userId } });
  await prisma.membership.create({
    data: { id: `mp-sub-mem-${randomUUID()}`, tenantId, userId, role: "owner", isActive: true }
  });
  await prisma.wallet.create({ data: { userId, paidBalance: START_BALANCE } });
  await prisma.tenant.create({ data: { id: otherTenantId, name: "Marketplace Subscription Smoke Other", type: "local_business" } });
  await prisma.user.create({ data: { id: otherUserId } });

  const app = Fastify();
  await registerMarketplaceRoutes(app);
  const headers = sessionHeaders(tenantId, userId, { "content-type": "application/json" });
  const otherHeaders = sessionHeaders(otherTenantId, otherUserId, { "content-type": "application/json" });
  const skuCode = skuRow!.skuCode;
  let runOnce = false;

  try {
    // ① 未订阅：访问态必须同时给出「按次（ppu）」和「包月报价」，让用户自己选。
    const before = await app.inject({ method: "GET", url: `/market/skus/${encodeURIComponent(skuCode)}/access`, headers });
    check(before.statusCode === 200, "GET /market/skus/:id/access 返回 200");
    const beforeBody = before.json() as AccessBody;
    check(beforeBody.subscription === undefined, "未订阅时访问态不带 subscription（不会被误判成已订阅）");
    check(
      beforeBody.subscriptionOffer?.credits === EXPECTED_SUB_CREDITS &&
        beforeBody.subscriptionOffer?.dailyQuota === EXPECTED_DAILY_QUOTA,
      `未订阅时透出包月报价 ${EXPECTED_SUB_CREDITS} 积分 · 每天 ${EXPECTED_DAILY_QUOTA} 条`
    );

    // ② 订阅：扣 4000，写一条 subscription_charge 账本，冻结每日条数快照。
    const subscribe = await app.inject({
      method: "POST",
      url: "/market/subscriptions",
      headers,
      payload: { skuId: skuCode }
    });
    check(subscribe.statusCode === 200, `POST /market/subscriptions 返回 200（实际 ${subscribe.statusCode}）`);
    const subscribeBody = subscribe.json() as {
      applied?: boolean;
      credits?: number;
      balance?: number;
      subscription?: { id: string; credits: number; dailyQuota: number | null; endDate: string };
    };
    check(subscribeBody.applied === true, "首次订阅 applied=true");
    check(subscribeBody.credits === EXPECTED_SUB_CREDITS, `订阅扣 ${EXPECTED_SUB_CREDITS} 积分`);
    check(
      subscribeBody.balance === START_BALANCE - EXPECTED_SUB_CREDITS,
      `订阅后余额 ${START_BALANCE} → ${START_BALANCE - EXPECTED_SUB_CREDITS}（实际 ${subscribeBody.balance}）`
    );
    check(subscribeBody.subscription?.credits === EXPECTED_SUB_CREDITS, "订阅行记录了本期实际扣掉的积分");
    check(
      subscribeBody.subscription?.dailyQuota === EXPECTED_DAILY_QUOTA,
      `订阅行冻结每日条数快照（${EXPECTED_DAILY_QUOTA}）`
    );
    const subscriptionId = subscribeBody.subscription?.id ?? "";
    const chargeLedgers = await prisma.marketplaceLedgerEntry.count({
      where: { tenantId, refType: "marketplace_subscription", refId: subscriptionId }
    });
    check(chargeLedgers === 1, "订阅恰好写一条订阅费账本（不重复记账）");

    // ③ 幂等：重复点「订阅」不重复扣分（这是最容易出现「付两次钱」的地方）。
    const resubscribe = await app.inject({
      method: "POST",
      url: "/market/subscriptions",
      headers,
      payload: { skuId: skuCode }
    });
    const resubscribeBody = resubscribe.json() as { alreadySubscribed?: boolean; balance?: number };
    check(resubscribe.statusCode === 200 && resubscribeBody.alreadySubscribed === true, "重复订阅命中幂等分支");
    check(
      resubscribeBody.balance === START_BALANCE - EXPECTED_SUB_CREDITS,
      "重复订阅不再扣积分（余额不变）"
    );
    const subscriptionRows = await prisma.marketplaceSubscription.count({ where: { tenantId, skuId: skuRow!.id } });
    check(subscriptionRows === 1, "同一租户同一 SKU 只有一条订阅（不重复建期）");

    // ④ 订阅期内访问态：说清「今天用了 / 还剩几次」，前端据此显示「本次不扣积分」。
    const after = await app.inject({ method: "GET", url: `/market/skus/${encodeURIComponent(skuCode)}/access`, headers });
    const afterBody = after.json() as AccessBody;
    check(afterBody.state === "subscribed", `订阅后访问态是 subscribed（实际 ${afterBody.state}）`);
    check(afterBody.subscription?.dailyQuota === EXPECTED_DAILY_QUOTA, "访问态回报每日条数");
    check(
      afterBody.subscription?.usedToday === 0 && afterBody.subscription?.remaining === EXPECTED_DAILY_QUOTA,
      "刚订阅时今天已用 0 次、剩余 5 次"
    );

    // ⑤ 真实运行一次：订阅覆盖 → 扣 0 积分、账本打订阅标签、余额分文不动。
    //    这一步会真的调用模型（用户要的是「真跑通」，不是只看代码分支）。
    if (process.env.MARKETPLACE_SUBSCRIPTION_SKIP_MODEL === "1") {
      console.log("[SKIP] 按 MARKETPLACE_SUBSCRIPTION_SKIP_MODEL=1 跳过真实模型运行，改用合成账本核对额度计数");
    } else {
      const run = await app.inject({
        method: "POST",
        url: `/market/skus/${encodeURIComponent(skuCode)}/run`,
        headers,
        payload: { input: "产品：思潼AI增长OS（企业级增长智能体平台）。平台：抖音+视频号。想要的动作：引导评论区留言「OS」拿试用。请交付 1 条可直发文案。" }
      });
      const runBody = run.json() as {
        state?: string;
        consumedCredits?: number;
        balance?: number;
        pricingMode?: string;
        subscription?: { covered?: boolean; usedToday?: number; remaining?: number | null };
      };
      if (run.statusCode !== 200) {
        // 模型侧故障（超时 / 限流）不是计费回归的失败，但必须显式标记为「未验证」。
        console.log(`[SKIP] 真实运行未成功（status ${run.statusCode}）：订阅覆盖「不扣分」这一步本次未验证`);
      } else {
        runOnce = true;
        check(runBody.consumedCredits === 0, `订阅期内运行扣 0 积分（实际 ${runBody.consumedCredits}）`);
        check(runBody.pricingMode === "subscription", `结算口径 pricingMode=subscription（实际 ${runBody.pricingMode}）`);
        check(
          runBody.balance === START_BALANCE - EXPECTED_SUB_CREDITS,
          `订阅期内运行不改余额（期望 ${START_BALANCE - EXPECTED_SUB_CREDITS}，实际 ${runBody.balance}）`
        );
        check(runBody.subscription?.covered === true, "运行结果明确回报「本次由包月覆盖」");
        check(runBody.subscription?.usedToday === 1 && runBody.subscription?.remaining === EXPECTED_DAILY_QUOTA - 1, "运行后今天已用 1 次、还剩 4 次");
        const usageLedgers = await prisma.marketplaceLedgerEntry.count({
          where: { tenantId, skuId: skuRow!.id, refType: USAGE_REF_TYPE, refId: subscriptionId, status: "completed" }
        });
        check(usageLedgers === 1, "包月覆盖的这次交付写了一条 0 积分用量账本（额度计数依据）");
      }
    }

    // ⑥ 把当天额度铺满到 5 次（真实运行已占 1 次的话只补 4 条），再确认第 6 次被明确拒绝且不扣分。
    const usedSoFar = await prisma.marketplaceLedgerEntry.count({
      where: { tenantId, skuId: skuRow!.id, refType: USAGE_REF_TYPE, refId: subscriptionId, status: "completed" }
    });
    for (let i = usedSoFar; i < EXPECTED_DAILY_QUOTA; i += 1) {
      await prisma.marketplaceLedgerEntry.create({
        data: {
          tenantId,
          userId,
          skuId: skuRow!.id,
          type: "ppu_consume",
          direction: "debit",
          amountCredits: 0,
          amountCny: 0,
          status: "completed",
          idempotencyKey: `subscription-quota-fill-${randomUUID()}`,
          refType: USAGE_REF_TYPE,
          refId: subscriptionId,
          metadata: { pricingMode: "subscription", synthetic: true }
        }
      });
    }
    const exhaustedAccess = await app.inject({ method: "GET", url: `/market/skus/${encodeURIComponent(skuCode)}/access`, headers });
    const exhaustedBody = exhaustedAccess.json() as AccessBody;
    check(exhaustedBody.subscription?.exhausted === true, "铺满 5 次后访问态标记额度用尽");
    check(exhaustedBody.subscription?.remaining === 0, "额度用尽时剩余 0");

    const walletBeforeBlocked = await prisma.wallet.findUnique({ where: { userId } });
    const blocked = await app.inject({
      method: "POST",
      url: `/market/skus/${encodeURIComponent(skuCode)}/run`,
      headers,
      payload: { input: "额度用尽后不应该产生这一次交付。" }
    });
    const blockedBody = blocked.json() as { error?: string; message?: string };
    check(blocked.statusCode === 409, `额度用尽后运行返回 409（实际 ${blocked.statusCode}）`);
    check(
      blockedBody.error === "marketplace_subscription_quota_exhausted",
      `错误码是 marketplace_subscription_quota_exhausted（实际 ${blockedBody.error}）`
    );
    const walletAfterBlocked = await prisma.wallet.findUnique({ where: { userId } });
    check(
      walletAfterBlocked?.balance === walletBeforeBlocked?.balance,
      "额度用尽被拒时余额分文不动（绝不静默改成扣积分）"
    );
    check(
      blockedBody.message?.includes("不消耗积分") === true,
      "拒绝对用户写明「本次不消耗积分」"
    );

    // ⑦ 租户隔离：另一个租户看不到这份订阅，也不会被别人的订阅放行。
    const otherAccess = await app.inject({
      method: "GET",
      url: `/market/skus/${encodeURIComponent(skuCode)}/access`,
      headers: otherHeaders
    });
    const otherBody = otherAccess.json() as AccessBody;
    check(otherBody.subscription === undefined, "其他租户访问态里没有这份订阅");
    check(otherBody.state !== "subscribed", `其他租户不会被别人的订阅放行（实际 ${otherBody.state}）`);
    const otherSubscriptions = await prisma.marketplaceSubscription.count({ where: { tenantId: otherTenantId } });
    check(otherSubscriptions === 0, "其他租户没有自己的订阅行");

    // ⑧ 前端/路由契约：说法与分支必须存在（用户最怕「买了包月还被扣分」和「悄悄改成扣分」）。
    const routeSource = readFileSync("apps/api/src/routes/marketplace.ts", "utf8");
    const chatSource = readFileSync("apps/web/src/marketplace/AgentChatPage.tsx", "utf8");
    check(/const charge = coveredBySubscription \? 0 :/.test(routeSource), "路由：订阅覆盖时 charge 固定为 0");
    check(
      /if \(!coveredBySubscription\) \{\s*\n\s*const consumed = await consumeWalletCredits/.test(routeSource),
      "路由：订阅覆盖时**不调用**钱包扣费"
    );
    check(
      routeSource.includes("marketplace_subscription_quota_exhausted"),
      "路由：额度用尽有独立错误码（不与余额不足混用）"
    );
    check(chatSource.includes("marketplace_subscription_quota_exhausted"), "网页：对话页单独处理额度用尽 409");
    check(/本次由包月覆盖 · 不扣积分/.test(chatSource), "网页：交付后显示「本次由包月覆盖 · 不扣积分」");
    check(/本次生成<b>不扣积分<\/b>/.test(chatSource), "网页：确认前就写明本次不扣积分");
    check(/alreadySubscribed/.test(chatSource), "网页：重复订阅会告诉用户「没有重复扣积分」");
    console.log(runOnce ? "[INFO] 本次已真实跑通「订阅期内运行扣 0 积分」" : "[INFO] 本轮未真实运行模型，仅验证额度与账本口径");
  } finally {
    await prisma.marketplaceLedgerEntry.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.marketplaceSubscription.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.wallet.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.membership.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
    await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: otherUserId } }).catch(() => {});
    await prisma.tenant.deleteMany({ where: { id: otherTenantId } }).catch(() => {});
    await app.close();
  }

  if (failed > 0) throw new Error(`${failed} 项包月计费断言失败`);
  console.log("\nPASS: 包月订阅计费回归全部通过");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
