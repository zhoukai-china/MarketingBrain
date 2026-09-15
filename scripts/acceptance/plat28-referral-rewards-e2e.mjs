/**
 * PLAT-28 推荐有礼「双向各 100」的端到端内测验收（真实 HTTP + 真实数据库，可跑本地或测试实例）。
 *
 * 用户 2026-09-15 口径：被推荐人 100 积分、推荐人 100 积分；先内测通过，暂不上线。
 *
 * 覆盖（每一步都走**真实接口**，不是直接调 service）：
 *   ① 推荐人 `/auth/dev-login` → 在「我的」页那个接口 `POST /market/me/referral-link` 生成推荐链接；
 *   ② 被推荐人带 `referralCode` 走 `/auth/dev-login` 开通 → 归因落库 + **被推荐人 +100 bonus**；
 *   ③ 推荐人此时**还没拿到**（必须等被推荐人首次真实使用）；
 *   ④ 被推荐人在货架真跑一次文字智能体（真实扣费）→ **推荐人 +100 bonus**；
 *   ⑤ 首充那一段按 2026-09-15 口径关闭：跑完之后不得出现 `referrer_first_recharge` 流水；
 *   ⑥ 全程奖励只进 bonus 桶、paid 桶为 0；脚本按 id 精确清理并核对残留为 0。
 *
 * 用法（本地）：
 *   pnpm.cmd plat28:referral-rewards-e2e
 * 用法（测试实例，在服务器上跑，DATABASE_URL 指向 lanqi_test schema）：
 *   PLAT28_API_URL=http://127.0.0.1:3010 node scripts/acceptance/plat28-referral-rewards-e2e.mjs
 *
 * 成本：第 ④ 步是**一次真实模型调用**（文案智能体，约 ¥0.02 / 40 积分，从被推荐人的奖励积分里扣）。
 *       设 `PLAT28_SKIP_RUN=1` 可跳过第 ④ 步（只验证①②③⑤⑥，用于诊断）。
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { prisma } from "../../apps/api/node_modules/@baolu/db/dist/index.js";

const apiBase = (process.env.PLAT28_API_URL ?? "http://127.0.0.1:3011").replace(/\/+$/, "");
const runSku = process.env.PLAT28_RUN_SKU ?? "ipzone__copy";
const skipRun = process.env.PLAT28_SKIP_RUN === "1";
/** 文字类 SKU 的固定价（2026-09-15 线上价目表：文案智能体 40 积分）。 */
const RUN_PRICE = Number(process.env.PLAT28_RUN_PRICE ?? 40);

const results = [];
const record = (ok, label, detail = "") => {
  results.push({ ok, label, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` :: ${detail}` : ""}`);
};

const created = { userIds: [], tenantIds: [] };

async function devLogin(body) {
  const response = await fetch(`${apiBase}/auth/dev-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status !== 200 || !payload.token) {
    throw new Error(`dev-login 失败（${response.status}）：${JSON.stringify(payload).slice(0, 300)}`);
  }
  created.userIds.push(payload.userId);
  created.tenantIds.push(payload.tenantId);
  return payload;
}

async function walletOf(userId) {
  return prisma.wallet.findUnique({ where: { userId } });
}

async function rewardRows(userId) {
  return prisma.walletLedger.findMany({
    where: { userId, source: { startsWith: "referral_reward:" } },
    orderBy: { createdAt: "asc" }
  });
}

/**
 * 发奖钩子是**异步**的（`void maybeGrantReferralReward(...)`，不阻断注册/生成主流程），
 * 所以验收必须轮询等一下，不能注册完立刻断言。
 */
async function waitFor(check, timeoutMs = 20_000, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * 货架 run：**必须按真实前端的格式发需求单**。
 *
 * `apps/web/src/marketplace/chat-flows.ts#buildRunPrompt` 拼出来的是：
 *   请按「文案」方法论，基于下面业务信息生成最终交付。\n- ① 行业 / 产品卖点：…（5 个槽位）
 * 发自由文本时智能体会一直回澄清问句（`needsInput`，不扣费），这不代表链路坏；这里 1:1 复刻真实请求。
 * 首轮仍可能追问（模型行为），按产品同样支持的方式补一条「补充说明」再发。
 */
async function runUntilCompleted(token, { maxAttempts = 3 } = {}) {
  const brief = (supplement) => [
    "请按「文案」方法论，基于下面业务信息生成最终交付。",
    "- ① 行业 / 产品卖点：美业门店（验收用），主推到店皮肤管理套餐；卖点：不硬推、按肤质定制",
    "- ② 目标人群：25–40 岁爱美的上班族女性",
    "- ③ 平台：朋友圈",
    "- ④ 口播时长：60 秒",
    "- ⑤ 内容类型：获客型（引流到店）",
    ...(supplement ? [`- 补充说明：${supplement}`] : [])
  ].join("\n");

  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const input = brief(attempt === 1 ? "" : "没有更多信息了，请直接用上面这些信息产出成品。");
    const response = await fetch(`${apiBase}/market/skus/${encodeURIComponent(runSku)}/run`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ input })
    });
    last = { status: response.status, body: await response.json().catch(() => ({})) };
    console.log(`[run] 第 ${attempt} 次：status=${last.status} state=${last.body.state ?? "-"} needsInput=${last.body.needsInput ?? false} consumed=${last.body.consumedCredits ?? "-"}`);
    if (last.status === 200 && last.body.state === "completed") return last;
    if (last.status === 200 && last.body.needsInput) continue;
    return last;
  }
  return last;
}

async function cleanup() {
  const userIds = created.userIds.filter(Boolean);
  const tenantIds = created.tenantIds.filter(Boolean);
  try {
    if (userIds.length > 0) {
      await prisma.referralBinding.deleteMany({
        where: { OR: [{ referredUserId: { in: userIds } }, { referrerUserId: { in: userIds } }] }
      });
      await prisma.referralCode.deleteMany({ where: { ownerUserId: { in: userIds } } });
      await prisma.walletLedger.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.marketplaceLedgerEntry.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (tenantIds.length > 0) {
      await prisma.store.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    }
  } catch (error) {
    console.error("[cleanup] 清理失败：", error instanceof Error ? error.message : String(error));
  }
}

async function main() {
  console.log(`# PLAT-28 推荐有礼内测验收 :: api=${apiBase} runSku=${runSku}${skipRun ? " (跳过真实运行)" : ""}`);

  /**
   * `PLAT28_APPLY_CONFIG=1`：把**内测口径**写进当前库的配置位（后台配置位优先于 env）。
   * 只在内测/测试环境用；服务端每次发奖都重新读配置，写完立即生效。
   * 口径＝用户 2026-09-15：被推荐人 100、推荐人 100、首充段 0；活动窗右开到 2026-10-01。
   */
  if (process.env.PLAT28_APPLY_CONFIG === "1") {
    const rows = [
      ["REFERRAL_REWARD_ENABLED", true],
      ["REFERRAL_CAMPAIGN_STARTS_AT", new Date(Date.now() - 60_000).toISOString()],
      ["REFERRAL_CAMPAIGN_ENDS_AT", process.env.PLAT28_CAMPAIGN_ENDS_AT ?? "2026-10-01T00:00:00+08:00"],
      ["REFERRAL_NEW_USER_CREDITS", 100],
      ["REFERRAL_REFERRER_FIRST_USE_CREDITS", 100],
      ["REFERRAL_REFERRER_FIRST_RECHARGE_CREDITS", 0]
    ];
    for (const [key, value] of rows) {
      await prisma.platformSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
    }
    console.log(`[config] 已写入内测口径（${rows.length} 项）：${rows.map(([key, value]) => `${key}=${value}`).join(" ")}`);
  }

  // ① 推荐人：开通 + 生成推荐链接
  const referrer = await devLogin({ tenantRole: "local_business", tenantName: `推荐人验收-${randomUUID().slice(0, 6)}`, productCode: "lanqi" });
  record(true, "① 推荐人开通（dev-login）", `userId=${referrer.userId}`);

  const linkResponse = await fetch(`${apiBase}/market/me/referral-link`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${referrer.token}` },
    body: JSON.stringify({})
  });
  const linkBody = await linkResponse.json().catch(() => ({}));
  const code = linkBody.code;
  record(
    linkResponse.status === 200 && typeof code === "string" && code.startsWith("ref-"),
    "① 推荐人生成推荐链接（/market/me/referral-link）",
    `state=${linkBody.state} code=${code} link=${String(linkBody.link ?? "").slice(0, 60)}`
  );
  record(
    String(linkBody.link ?? "").includes(`ref=${code}`),
    "① 链接里带 ref 参数（老板复制给客户的那条）",
    String(linkBody.link ?? "").slice(0, 80)
  );

  // ② 被推荐人：带推荐码开通 → 归因 + 新客 100
  const referred = await devLogin({
    tenantRole: "personal_ip",
    tenantName: `被推荐人验收-${randomUUID().slice(0, 6)}`,
    referralCode: code
  });
  const binding = await waitFor(() => prisma.referralBinding.findFirst({ where: { referredUserId: referred.userId } }));
  record(Boolean(binding), "② 归因落库（ReferralBinding）", `bindingId=${binding?.id ?? "无"}`);
  record(binding?.referrerUserId === referrer.userId, "② 归因的推荐人正确", `referrerUserId=${binding?.referrerUserId ?? "无"}`);

  const referredWalletAfterSignup = await waitFor(async () => {
    const wallet = await walletOf(referred.userId);
    return wallet?.bonusBalance === 100 ? wallet : null;
  });
  record(referredWalletAfterSignup?.bonusBalance === 100, "② 被推荐人拿到 100 bonus", `bonus=${referredWalletAfterSignup?.bonusBalance} paid=${referredWalletAfterSignup?.paidBalance}`);
  const referredRewards = await rewardRows(referred.userId);
  record(
    referredRewards.length === 1 && referredRewards[0].source === `referral_reward:new_user:${binding?.id}` && referredRewards[0].bucket === "bonus",
    "② 被推荐人账本恰 1 条 new_user 奖励（bonus 桶）",
    JSON.stringify(referredRewards.map((row) => ({ source: row.source, delta: row.delta, bucket: row.bucket, expiresAt: row.expiresAt })))
  );
  record(Boolean(referredRewards[0]?.expiresAt), "② 奖励带到期时间（90 天）", String(referredRewards[0]?.expiresAt ?? "无"));

  const referrerWalletBeforeUse = await walletOf(referrer.userId);
  record((referrerWalletBeforeUse?.bonusBalance ?? 0) === 0, "③ 被推荐人还没用时，推荐人先不拿（0）", `bonus=${referrerWalletBeforeUse?.bonusBalance ?? 0}`);

  // ④ 被推荐人首次真实使用（真实模型 + 真实扣费）→ 推荐人 +100
  let runBody = null;
  if (skipRun) {
    console.log("[SKIP] ④ 真实运行（PLAT28_SKIP_RUN=1）");
  } else {
    const runResult = await runUntilCompleted(referred.token);
    const runResponse = { status: runResult.status };
    runBody = runResult.body;
    record(
      runResponse.status === 200 && runBody.state === "completed",
      `④ 被推荐人真实跑一次 ${runSku}`,
      `status=${runResponse.status} state=${runBody.state ?? "?"} consumed=${runBody.consumedCredits ?? "?"} needsInput=${runBody.needsInput ?? false}`
    );

    const referredWalletAfterRun = await waitFor(async () => {
      const wallet = await walletOf(referred.userId);
      return wallet?.bonusBalance === 100 - RUN_PRICE ? wallet : null;
    });
    record(
      referredWalletAfterRun?.bonusBalance === 100 - RUN_PRICE,
      `④ 被推荐人奖励积分被真实扣掉 ${RUN_PRICE}（只动 bonus）`,
      `bonus=${referredWalletAfterRun?.bonusBalance} paid=${referredWalletAfterRun?.paidBalance}`
    );

    const referrerWalletAfterUse = await waitFor(async () => {
      const wallet = await walletOf(referrer.userId);
      return wallet?.bonusBalance === 100 ? wallet : null;
    });
    record(referrerWalletAfterUse?.bonusBalance === 100, "④ 推荐人拿到 100 bonus", `bonus=${referrerWalletAfterUse?.bonusBalance}`);
    const referrerRewards = await rewardRows(referrer.userId);
    record(
      referrerRewards.length === 1 && referrerRewards[0].source === `referral_reward:referrer_first_use:${binding?.id}`,
      "④ 推荐人账本恰 1 条 first_use 奖励",
      JSON.stringify(referrerRewards.map((row) => ({ source: row.source, delta: row.delta })))
    );
    record(
      !referrerRewards.some((row) => row.source.includes("first_recharge")),
      "⑤ 首充那一段按 2026-09-15 口径关闭（无 first_recharge 流水）",
      JSON.stringify(referrerRewards.map((row) => row.source))
    );
    record((referrerWalletAfterUse?.paidBalance ?? 0) === 0, "⑥ 推荐人 paid 桶仍为 0（奖励只进 bonus）", `paid=${referrerWalletAfterUse?.paidBalance}`);
  }

  const failures = results.filter((item) => !item.ok);
  return { runBody, failures };
}

const outcome = await main().catch((error) => {
  console.error("[plat28-referral-rewards-e2e] 运行失败：", error);
  results.push({ ok: false, label: "脚本执行", detail: error instanceof Error ? error.message : String(error) });
  return { failures: results.filter((item) => !item.ok) };
});

await cleanup();
const residue = {
  users: created.userIds.length > 0 ? await prisma.user.count({ where: { id: { in: created.userIds } } }) : 0,
  tenants: created.tenantIds.length > 0 ? await prisma.tenant.count({ where: { id: { in: created.tenantIds } } }) : 0,
  bindings: created.userIds.length > 0
    ? await prisma.referralBinding.count({ where: { OR: [{ referredUserId: { in: created.userIds } }, { referrerUserId: { in: created.userIds } }] } })
    : 0
};
record(residue.users === 0 && residue.tenants === 0 && residue.bindings === 0, "⑦ 验收数据清理干净（残留 0）", JSON.stringify(residue));

const failed = results.filter((item) => !item.ok).length;
console.log(`plat28_referral_rewards_e2e: ${failed === 0 ? "PASS" : "FAIL"} (${results.length - failed} passed / ${failed} failed)`);
await prisma.$disconnect();
process.exit(failed === 0 ? 0 : 1);
