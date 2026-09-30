import { Prisma, prisma } from "@baolu/db";
import { getOrCreateWallet, giftBonusExpiry, readWallet, type WalletSnapshot } from "./sitong-wallet.js";

/**
 * 每日签到（用户 2026-09-30 拍板，改口径必须同改前端文案与 `apps/web` 的签到弹层）。
 *
 * 冻结口径：
 * - 每日 +5，第 7 天 +30（含当天），一个 7 天周期封顶 60；
 * - 断签重置（连续天数回到 0，从 D1 重新开始）；
 * - 所得是**赠送算力**：进 bonus 桶、90 天有效、限思潼自营文字（文生）类智能体。
 *
 * 记账真源：用户级钱包 `WalletLedger`，不另开表。
 * 幂等靠 `refRequestId = signin:<YYYY-MM-DD>`——同一账号同一天最多一条，
 * 重复点「立即签到」不会重复入账（客户端网络重试、连点都安全）。
 */
export const SIGNIN_DAILY_CREDITS = 5;
export const SIGNIN_BONUS_DAY_CREDITS = 30;
export const SIGNIN_CYCLE_DAYS = 7;
/** 一个周期的封顶：前 6 天 ×5 + 第 7 天 +30 = 60（服务端按此发，前端按此展示，不是另算的一份数）。 */
export const SIGNIN_WEEKLY_CAP = SIGNIN_DAILY_CREDITS * (SIGNIN_CYCLE_DAYS - 1) + SIGNIN_BONUS_DAY_CREDITS;
export const SIGNIN_VALID_DAYS = 90;

const SIGNIN_SOURCE = "daily_signin";
const SIGNIN_REF_PREFIX = "signin:";
/** 签到按北京时间的自然日算；服务器时区可能是 UTC，所以统一显式 +8。 */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 北京时间当天的 `YYYY-MM-DD` 键：签到口径的唯一日期真源。 */
export function signinDateKey(at: Date = new Date()): string {
  return new Date(at.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

/** 日期键加减天数（只做日期算术，不涉及时区转换）。 */
export function shiftDateKey(key: string, deltaDays: number): string {
  const base = new Date(`${key}T00:00:00.000Z`);
  return new Date(base.getTime() + deltaDays * DAY_MS).toISOString().slice(0, 10);
}

export interface SigninDayView {
  /** 周期内的第几天（1..7）。 */
  day: number;
  /** 展示标签（D1..D7）。 */
  label: string;
  /** 这一天签到能拿多少算力。 */
  credits: number;
  /** 本轮周期内是否已领。 */
  signed: boolean;
  /** 下一次签到会落在这一天（前端高亮它）。 */
  current: boolean;
}

export interface SigninStatusView {
  /** 今天是否已签。 */
  signedToday: boolean;
  /** 当前连续签到天数（含今天；今天没签就是到昨天为止的连续数）。 */
  streak: number;
  /** 下一次签到会落在周期第几天（1..7）。 */
  cycleDay: number;
  /** 下一次签到的奖励算力（5 或 30）——按钮文案用它，不在前端重复算。 */
  nextCredits: number;
  /** 本轮周期已经拿到多少（前端显示进度）。 */
  earnedInCycle: number;
  weeklyCap: number;
  /** 赠送算力有效期（天）。 */
  validDays: number;
  /** 今天这笔的到期时间（今天没签则 null）。 */
  expiresAt: string | null;
  /** 累计签到天数（全周期，给「已坚持 N 天」用）。 */
  totalSignedDays: number;
  days: SigninDayView[];
}

export interface SigninResult extends SigninStatusView {
  /** 本次调用是否真的入账（false = 今天已经签过，幂等命中）。 */
  granted: boolean;
  /** 本次入账的算力（幂等命中时返回 0）。 */
  grantedCredits: number;
  wallet: WalletSnapshot;
}

/** 已签到的日期键集合（近 `lookbackDays` 天，够算连续天数即可）。 */
async function readSignedKeys(userId: string, lookbackDays = 120): Promise<Set<string>> {
  const since = new Date(Date.now() - lookbackDays * DAY_MS);
  const rows = await prisma.walletLedger.findMany({
    where: { userId, source: SIGNIN_SOURCE, type: "bonus", createdAt: { gte: since } },
    select: { refRequestId: true }
  });
  const keys = new Set<string>();
  for (const row of rows) {
    const raw = row.refRequestId ?? "";
    if (raw.startsWith(SIGNIN_REF_PREFIX)) {
      const key = raw.slice(SIGNIN_REF_PREFIX.length);
      if (/^\d{4}-\d{2}-\d{2}$/.test(key)) keys.add(key);
    }
  }
  return keys;
}

/** 由「已签日期集合」拼出状态视图：连续天数、周期落点、7 天格子。 */
function buildStatus(
  signedKeys: Set<string>,
  todayKey: string,
  wallet: WalletSnapshot,
  todayExpiresAt: string | null
): SigninStatusView {
  const signedToday = signedKeys.has(todayKey);

  // 连续天数：今天签了就从今天往回数，没签就从昨天往回数。
  let streak = 0;
  let cursor = signedToday ? todayKey : shiftDateKey(todayKey, -1);
  while (signedKeys.has(cursor)) {
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }

  const cyclePos = streak % SIGNIN_CYCLE_DAYS; // 当前周期里已领的天数（0..6）
  const cycleDay = cyclePos + 1; // 下一次签到落在第几天
  const nextCredits = cycleDay === SIGNIN_CYCLE_DAYS ? SIGNIN_BONUS_DAY_CREDITS : SIGNIN_DAILY_CREDITS;

  let earnedInCycle = 0;
  for (let day = 1; day <= cyclePos; day += 1) {
    earnedInCycle += day === SIGNIN_CYCLE_DAYS ? SIGNIN_BONUS_DAY_CREDITS : SIGNIN_DAILY_CREDITS;
  }

  const days: SigninDayView[] = Array.from({ length: SIGNIN_CYCLE_DAYS }, (_, index) => {
    const day = index + 1;
    return {
      day,
      label: `D${day}`,
      credits: day === SIGNIN_CYCLE_DAYS ? SIGNIN_BONUS_DAY_CREDITS : SIGNIN_DAILY_CREDITS,
      signed: day <= cyclePos,
      current: day === cycleDay
    };
  });

  return {
    signedToday,
    streak,
    cycleDay,
    nextCredits,
    earnedInCycle,
    weeklyCap: SIGNIN_WEEKLY_CAP,
    validDays: SIGNIN_VALID_DAYS,
    expiresAt: todayExpiresAt,
    totalSignedDays: signedKeys.size,
    days
  };
}

/** 读当前用户的签到状态（不写库）：未登录/无钱包时返回 D1 起步的空状态 + 0 余额。 */
export async function loadSigninStatus(userId: string): Promise<SigninStatusView> {
  const todayKey = signinDateKey();
  const [wallet, signedKeys, todayRow] = await Promise.all([
    readWallet(userId),
    readSignedKeys(userId),
    prisma.walletLedger.findFirst({
      where: { userId, refRequestId: `${SIGNIN_REF_PREFIX}${todayKey}` },
      select: { expiresAt: true },
      orderBy: { createdAt: "desc" }
    })
  ]);
  return buildStatus(signedKeys, todayKey, wallet, todayRow?.expiresAt?.toISOString() ?? null);
}

/**
 * 执行签到：按「当前连续天数」发 D1..D7 对应的算力，进 bonus 桶、90 天有效。
 * 幂等：同一天重复调用命中已有账本，`granted=false`、`grantedCredits=0`，余额不变。
 */
export async function performSignin(userId: string): Promise<SigninResult> {
  const todayKey = signinDateKey();
  const refRequestId = `${SIGNIN_REF_PREFIX}${todayKey}`;

  const outcome = await prisma.$transaction(
    async (tx) => {
      const wallet = await getOrCreateWallet(userId, tx);
      const existing = await tx.walletLedger.findFirst({
        where: { userId, refRequestId },
        select: { id: true, delta: true, expiresAt: true }
      });
      if (existing) {
        return { granted: false, grantedCredits: 0, expiresAt: existing.expiresAt };
      }

      const rows = await tx.walletLedger.findMany({
        where: { userId, source: SIGNIN_SOURCE, type: "bonus" },
        select: { refRequestId: true }
      });
      const signedKeys = new Set<string>();
      for (const row of rows) {
        const raw = row.refRequestId ?? "";
        if (raw.startsWith(SIGNIN_REF_PREFIX)) signedKeys.add(raw.slice(SIGNIN_REF_PREFIX.length));
      }
      // 连续天数只看「今天之前」；今天这一笔本身不能把自己的天数算进去。
      let streak = 0;
      let cursor = shiftDateKey(todayKey, -1);
      while (signedKeys.has(cursor)) {
        streak += 1;
        cursor = shiftDateKey(cursor, -1);
      }
      const cycleDay = (streak % SIGNIN_CYCLE_DAYS) + 1;
      const amount = cycleDay === SIGNIN_CYCLE_DAYS ? SIGNIN_BONUS_DAY_CREDITS : SIGNIN_DAILY_CREDITS;
      const expiresAt = giftBonusExpiry(new Date(), SIGNIN_VALID_DAYS);

      await tx.wallet.update({ where: { id: wallet.id }, data: { bonusBalance: { increment: amount } } });
      await tx.walletLedger.create({
        data: {
          walletId: wallet.id,
          userId,
          delta: amount,
          bucket: "bonus",
          type: "bonus",
          source: SIGNIN_SOURCE,
          refRequestId,
          expiresAt
        }
      });
      return { granted: true, grantedCredits: amount, expiresAt };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );

  const status = await loadSigninStatus(userId);
  return {
    ...status,
    granted: outcome.granted,
    grantedCredits: outcome.grantedCredits,
    expiresAt: status.expiresAt ?? outcome.expiresAt?.toISOString() ?? null,
    wallet: await readWallet(userId)
  };
}
