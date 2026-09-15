// PLAT-28 第②批（推荐奖励实际发放）服务级回归。
// 覆盖：启用+活动窗内三段发放（新客/推荐人首用/推荐人首充）、bonus 桶入账、
//      幂等（同源只发一次）、窗外/停用不发、退款冲正、月度超阈值只告警、
//      以及清理后残留为 0。
// 环境：需要 DATABASE_URL（本地/测试库）。仓库 .env 为 DATA_MODE=database。
import "dotenv/config";
process.env.SKILL_MCP_REQUIRED = "false";
import { randomUUID } from "node:crypto";
import { prisma } from "../apps/api/node_modules/@baolu/db/dist/index.js";
import { env } from "../apps/api/src/config/env.js";
import {
  generateReferralCode,
  hashReferralCode,
  previewReferralCode
} from "../apps/api/src/services/referral-attribution.js";
import {
  maybeGrantReferralReward,
  reverseReferralReward
} from "../apps/api/src/services/referral-rewards.js";
import { resetReferralConfigCacheForTests } from "../apps/api/src/services/referral-config.js";
import { consumeWalletCredits } from "../apps/api/src/services/sitong-wallet.js";

let pass = 0;
const failures: string[] = [];
const createdUserIds: string[] = [];
const createdSettingKeys: string[] = [];

function check(name: string, condition: unknown, detail = ""): void {
  if (condition) {
    pass += 1;
    console.log(`PASS  ${name}${detail ? ` :: ${detail}` : ""}`);
  } else {
    failures.push(name);
    console.error(`FAIL  ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

async function cleanup(): Promise<void> {
  try {
    if (createdUserIds.length > 0) {
      await prisma.referralBinding.deleteMany({
        where: { OR: [{ referredUserId: { in: createdUserIds } }, { referrerUserId: { in: createdUserIds } }] }
      });
      await prisma.referralCode.deleteMany({ where: { ownerUserId: { in: createdUserIds } } });
      await prisma.walletLedger.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.wallet.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    if (createdSettingKeys.length > 0) {
      await prisma.platformSetting.deleteMany({ where: { key: { in: createdSettingKeys } } });
    }
  } catch (error) {
    console.error("[cleanup] 清理失败：", error instanceof Error ? error.message : String(error));
  }
}

async function setSetting(key: string, value: unknown): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value }
  });
  createdSettingKeys.push(key);
}

async function createUser(label: string, extra: { unionid?: string; openid?: string } = {}) {
  const userId = `mp-reward-${label}-${randomUUID().slice(0, 8)}`;
  await prisma.user.create({
    data: {
      id: userId,
      nickname: `Reward ${label}`,
      phone: `138${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`,
      ...(extra.unionid ? { wechatUnionid: extra.unionid } : {}),
      ...(extra.openid ? { wechatOpenid: extra.openid } : {})
    }
  });
  createdUserIds.push(userId);
  return { userId };
}

async function main(): Promise<void> {
  const now = new Date();
  const starts = new Date(now.getTime() - 3600_000).toISOString();
  const ends = new Date(now.getTime() + 3600_000).toISOString();
  /**
   * 默认口径（用户 2026-09-15）：被推荐人 100、推荐人 100，首充那一段默认关闭。
   * 只在没有 env 覆盖时断言，避免测试实例/CI 显式配了 env 就把这条契约误判成红。
   */
  if (
    process.env.REFERRAL_NEW_USER_CREDITS === undefined &&
    process.env.REFERRAL_REFERRER_FIRST_USE_CREDITS === undefined &&
    process.env.REFERRAL_REFERRER_FIRST_RECHARGE_CREDITS === undefined
  ) {
    check("默认口径：被推荐人 100", env.REFERRAL_NEW_USER_CREDITS === 100, `got ${env.REFERRAL_NEW_USER_CREDITS}`);
    check("默认口径：推荐人 100", env.REFERRAL_REFERRER_FIRST_USE_CREDITS === 100, `got ${env.REFERRAL_REFERRER_FIRST_USE_CREDITS}`);
    check(
      "默认口径：首充段 0（2026-09-15 只做双向各 100）",
      env.REFERRAL_REFERRER_FIRST_RECHARGE_CREDITS === 0,
      `got ${env.REFERRAL_REFERRER_FIRST_RECHARGE_CREDITS}`
    );
  }
  await setSetting("REFERRAL_REWARD_ENABLED", true);
  await setSetting("REFERRAL_CAMPAIGN_STARTS_AT", starts);
  await setSetting("REFERRAL_CAMPAIGN_ENDS_AT", ends);
  await setSetting("REFERRAL_NEW_USER_CREDITS", 100);
  await setSetting("REFERRAL_REFERRER_FIRST_USE_CREDITS", 100);
  // 用户 2026-09-15 口径：「先只做推荐有礼，被推荐人 100、推荐人 100」→ 首充那一段先关闭。
  await setSetting("REFERRAL_REFERRER_FIRST_RECHARGE_CREDITS", 0);
  await setSetting("REFERRAL_REWARD_VALID_DAYS", 90);
  await setSetting("REFERRAL_REWARD_ALERT_THRESHOLD_CREDITS", 50);
  resetReferralConfigCacheForTests();

  const referrer = await createUser("referrer", { unionid: `ru-${randomUUID().slice(0, 10)}`, openid: `ro-${randomUUID().slice(0, 10)}` });
  const referred = await createUser("referred", { unionid: `du-${randomUUID().slice(0, 10)}`, openid: `do-${randomUUID().slice(0, 10)}` });
  const code = generateReferralCode();
  const codeRow = await prisma.referralCode.create({
    data: {
      ownerUserId: referrer.userId,
      codeHash: hashReferralCode(code),
      codePreview: previewReferralCode(code),
      label: "referral-rewards-smoke"
    }
  });
  const binding = await prisma.referralBinding.create({
    data: {
      referralCodeId: codeRow.id,
      referrerUserId: referrer.userId,
      referredUserId: referred.userId,
      referredUnionid: `du-${randomUUID().slice(0, 10)}`,
      referredOpenid: `do-${randomUUID().slice(0, 10)}`,
      source: "registration"
    }
  });

  // ① 新客 100 → 被推荐人 bonus
  const newUser = await maybeGrantReferralReward({ referredUserId: referred.userId, kind: "new_user" });
  check("新客奖励发放", newUser.granted && newUser.amount === 100 && newUser.receiverUserId === referred.userId, JSON.stringify(newUser));
  const dupNewUser = await maybeGrantReferralReward({ referredUserId: referred.userId, kind: "new_user" });
  check("新客奖励幂等（只发一次）", dupNewUser.granted === false, JSON.stringify(dupNewUser));

  // ② 推荐人首用 100
  const firstUse = await maybeGrantReferralReward({ referredUserId: referred.userId, kind: "referrer_first_use" });
  check("推荐人首用奖励 100", firstUse.granted && firstUse.amount === 100 && firstUse.receiverUserId === referrer.userId, JSON.stringify(firstUse));

  // ③ 首充段按 2026-09-15 口径关闭（0）：不发、不写账本、不报错
  const firstRecharge = await maybeGrantReferralReward({ referredUserId: referred.userId, kind: "referrer_first_recharge" });
  check("首充段关闭时不发奖（no_amount，不报错）", firstRecharge.granted === false && firstRecharge.reason === "no_amount", JSON.stringify(firstRecharge));

  // ④ 余额核对（2026-09-15 口径）：被推荐人 bonus 100；推荐人 bonus 100
  const referredWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: referred.userId } });
  const referrerWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: referrer.userId } });
  check("被推荐人 bonus=100", referredWallet.bonusBalance === 100, `got ${referredWallet.bonusBalance}`);
  check("推荐人 bonus=100", referrerWallet.bonusBalance === 100, `got ${referrerWallet.bonusBalance}`);
  check("paid 桶为 0（奖励只进 bonus）", referredWallet.paidBalance === 0 && referrerWallet.paidBalance === 0);

  const ledgerCount = await prisma.walletLedger.count({
    where: { userId: { in: [referred.userId, referrer.userId] }, source: { startsWith: "referral_reward:" } }
  });
  check("账本恰 2 条奖励流水（双向各一条）", ledgerCount === 2, `got ${ledgerCount}`);


  // ④b 到期：账本写 expiresAt（约 90 天）；已到期的推荐奖励不可消费
  const newUserGrant = await prisma.walletLedger.findFirstOrThrow({
    where: { userId: referred.userId, source: { startsWith: "referral_reward:new_user:" } }
  });
  check("新客奖励账本带到期时间", newUserGrant.expiresAt !== null, String(newUserGrant.expiresAt));
  const dayMs = 86_400_000;
  check(
    "到期约 90 天",
    Boolean(newUserGrant.expiresAt && Math.abs(newUserGrant.expiresAt.getTime() - (newUserGrant.createdAt.getTime() + 90 * dayMs)) < dayMs),
    String(newUserGrant.expiresAt)
  );
  await prisma.walletLedger.update({
    where: { id: newUserGrant.id },
    data: { expiresAt: new Date(Date.now() - 3600_000) }
  });
  const expiredConsume = await consumeWalletCredits({
    userId: referred.userId,
    requestId: `expiry-${randomUUID().slice(0, 8)}`,
    price: 40,
    skillId: "ipzone__copy"
  });
  check("过期推荐奖励不可消费（insufficient）", expiredConsume.status === "insufficient", JSON.stringify(expiredConsume));

  // ⑤ 机制没被削掉：把首充段改回 200 → 仍按 200 发、仍触发超阈值告警、仍能退款冲正
  //    （2026-09-12 的三段口径可随时恢复，只改这一个数）
  await setSetting("REFERRAL_REFERRER_FIRST_RECHARGE_CREDITS", 200);
  resetReferralConfigCacheForTests();
  const firstRechargeEnabled = await maybeGrantReferralReward({ referredUserId: referred.userId, kind: "referrer_first_recharge" });
  check("首充段改回 200 后照常发奖（机制保留）", firstRechargeEnabled.granted && firstRechargeEnabled.amount === 200, JSON.stringify(firstRechargeEnabled));
  check("月累计超阈值置告警标记", firstRechargeEnabled.alerted === true, `alerted=${firstRechargeEnabled.alerted}`);
  const referrerWalletAfterGrant = await prisma.wallet.findUniqueOrThrow({ where: { userId: referrer.userId } });
  check("发奖后推荐人 bonus=300", referrerWalletAfterGrant.bonusBalance === 300, `got ${referrerWalletAfterGrant.bonusBalance}`);

  const reversal = await reverseReferralReward({ referredUserId: referred.userId, kind: "referrer_first_recharge" });
  check("首充奖励冲正成功", reversal.granted === true, JSON.stringify(reversal));
  const referrerWalletAfter = await prisma.wallet.findUniqueOrThrow({ where: { userId: referrer.userId } });
  check("冲正后推荐人 bonus=100", referrerWalletAfter.bonusBalance === 100, `got ${referrerWalletAfter.bonusBalance}`);
  const reversal2 = await reverseReferralReward({ referredUserId: referred.userId, kind: "referrer_first_recharge" });
  check("冲正幂等（不重复扣）", reversal2.granted === false, JSON.stringify(reversal2));

  // ⑥ 停用 / 窗外不发
  await setSetting("REFERRAL_CAMPAIGN_STARTS_AT", new Date(now.getTime() + 2_600_000).toISOString());
  resetReferralConfigCacheForTests();
  const outside = await maybeGrantReferralReward({ referredUserId: referred.userId, kind: "referrer_first_use" });
  check("活动窗外不发", outside.granted === false && outside.reason === "outside_window", JSON.stringify(outside));
  await setSetting("REFERRAL_REWARD_ENABLED", false);
  resetReferralConfigCacheForTests();
  const disabled = await maybeGrantReferralReward({ referredUserId: referred.userId, kind: "referrer_first_use" });
  check("总开关关闭不发", disabled.granted === false && disabled.reason === "disabled", JSON.stringify(disabled));

  if (failures.length > 0) {
    console.error(`referral_rewards_smoke: FAIL (${failures.length} failed)`);
    process.exitCode = 1;
    return;
  }
  console.log(`referral_rewards_smoke: PASS (${pass} passed / 0 failed)`);
}

main()
  .catch((error) => {
    console.error("referral_rewards_smoke: CRASH", error);
    process.exitCode = 1;
  })
  .finally(() => cleanup().then(() => console.log("[cleanup] done")));
