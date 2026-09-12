import { prisma } from "@baolu/db";

/**
 * 思潼AI 货架体验额度发放（PLAT-10 / PLAT-11）。
 *
 * 口径与运维 CLI `scripts/grant-marketplace-trial-credits.mjs` 完全一致：
 * - 只写**用户级钱包 `bonus` 桶**（货架展示与扣费同源），不写租户级遗留 `CreditAccount`；
 * - 幂等键为流水 `source = "trial_grant:<grant-id>"`：重放返回 `already_applied` 且不重复加币，
 *   同一 grant-id 换金额报 `trial_grant_id_conflict`；
 * - 单笔金额硬上限 `MAX_TRIAL_CREDITS`（防误输入把「体验」发成大额赠送）；
 * - 默认 `dryRun=false`，dry-run 时零写入。
 *
 * 该服务被 admin 路由复用，销售/运营无需再登录服务器跑脚本。
 */

/** 体验额度发放流水前缀：`trial_grant:<grant-id>`，用来做幂等键与后续对账检索。 */
export const TRIAL_GRANT_SOURCE_PREFIX = "trial_grant:";
/** 单笔体验额度硬上限：防止误输入把「体验」发成「大额赠送」。 */
export const MAX_TRIAL_CREDITS = 800;
/** 默认体验额度（2026-09-11 用户拍板：400 积分 / 3 天）。 */
export const DEFAULT_TRIAL_CREDITS = 400;
export const DEFAULT_TRIAL_VALID_DAYS = 3;

export interface TrialGrantIdentity {
  userId?: string;
  phone?: string;
  wechatOpenid?: string;
  wechatUnionid?: string;
}

export interface TrialGrantInput {
  identity: TrialGrantIdentity;
  amount: number;
  grantId: string;
  operator?: string | null;
  tenantId?: string | null;
  dryRun?: boolean;
}

export type TrialGrantState = "created" | "already_applied" | "dry_run";

export interface TrialGrantResult {
  state: TrialGrantState;
  grantId: string;
  amount: number;
  user: {
    id: string;
    nickname: string | null;
    phone: string | null;
    wechatOpenid: string | null;
  };
  wallet: { paidBalance: number; bonusBalance: number; balance: number };
  grantedAt: string | null;
}

export type TrialGrantErrorCode =
  | "trial_grant_identity_required"
  | "trial_grant_invalid_grant_id"
  | "trial_grant_invalid_amount"
  | "trial_grant_user_not_found"
  | "trial_grant_user_ambiguous"
  | "trial_grant_tenant_mismatch"
  | "trial_grant_id_conflict";

export class TrialGrantError extends Error {
  readonly code: TrialGrantErrorCode;

  constructor(code: TrialGrantErrorCode, message: string) {
    super(message);
    this.name = "TrialGrantError";
    this.code = code;
  }
}

/** grant-id 只允许字母/数字/连字符/下划线，长度 8-80（与 CLI 一致）。 */
export function isValidTrialGrantId(grantId: string): boolean {
  return /^[A-Za-z0-9_-]{8,80}$/.test(grantId);
}

function resolveIdentitySelector(identity: TrialGrantIdentity): { label: string; where: Record<string, string> } {
  const selectors: Array<{ label: string; where: Record<string, string> | null }> = [
    { label: "user_id", where: identity.userId ? { id: identity.userId.trim() } : null },
    { label: "phone", where: identity.phone ? { phone: identity.phone.trim() } : null },
    { label: "wechat_openid", where: identity.wechatOpenid ? { wechatOpenid: identity.wechatOpenid.trim() } : null },
    { label: "wechat_unionid", where: identity.wechatUnionid ? { wechatUnionid: identity.wechatUnionid.trim() } : null }
  ];
  const picked = selectors.filter((item) => item.where !== null) as Array<{ label: string; where: Record<string, string> }>;
  if (picked.length !== 1) {
    throw new TrialGrantError(
      "trial_grant_identity_required",
      "必须且只能提供一个身份：手机号 / 微信 openid / 微信 unionid / user-id"
    );
  }
  return picked[0];
}

export async function grantMarketplaceTrialCredits(input: TrialGrantInput): Promise<TrialGrantResult> {
  const grantId = String(input.grantId ?? "").trim();
  if (!isValidTrialGrantId(grantId)) {
    throw new TrialGrantError("trial_grant_invalid_grant_id", "发放编号只允许字母、数字、- 和 _，长度 8-80");
  }
  const amount = Number(input.amount);
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_TRIAL_CREDITS) {
    throw new TrialGrantError(
      "trial_grant_invalid_amount",
      `发放积分必须是 1-${MAX_TRIAL_CREDITS} 的整数`
    );
  }
  const { label: identityLabel, where: identityWhere } = resolveIdentitySelector(input.identity ?? {});
  const tenantIdFilter = input.tenantId?.trim() || null;
  const operator = input.operator?.trim() || null;
  const dryRun = input.dryRun === true;
  const source = `${TRIAL_GRANT_SOURCE_PREFIX}${grantId}`;

  return await prisma.$transaction(async (tx) => {
    const users = await tx.user.findMany({
      where: identityWhere,
      select: { id: true, nickname: true, phone: true, wechatOpenid: true },
      take: 5
    });
    if (users.length === 0) {
      throw new TrialGrantError(
        "trial_grant_user_not_found",
        `没有找到匹配的用户（${identityLabel}）。该客户必须先自己扫码注册登入思潼AI。`
      );
    }
    if (users.length > 1) {
      throw new TrialGrantError(
        "trial_grant_user_ambiguous",
        `匹配到 ${users.length} 个用户，请改用手机号或用户 ID 精确定位`
      );
    }
    const user = users[0];

    if (tenantIdFilter) {
      const membership = await tx.membership.findFirst({
        where: { userId: user.id, tenantId: tenantIdFilter },
        select: { id: true }
      });
      if (!membership) {
        throw new TrialGrantError(
          "trial_grant_tenant_mismatch",
          "该用户不属于指定工作区，为避免发错工作区已拒绝发放"
        );
      }
    }

    const existing = await tx.walletLedger.findFirst({
      where: { userId: user.id, source },
      select: { id: true, delta: true, createdAt: true }
    });

    const wallet = dryRun
      ? await tx.wallet.findUnique({ where: { userId: user.id } })
      : await tx.wallet.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } });

    const balances = {
      paidBalance: wallet?.paidBalance ?? 0,
      bonusBalance: wallet?.bonusBalance ?? 0
    };

    if (existing) {
      if (existing.delta !== amount) {
        throw new TrialGrantError(
          "trial_grant_id_conflict",
          `发放编号 ${grantId} 已经按 ${existing.delta} 积分发放过，不能改成 ${amount}`
        );
      }
      return {
        state: "already_applied" as const,
        grantId,
        amount,
        user,
        wallet: { ...balances, balance: balances.paidBalance + balances.bonusBalance },
        grantedAt: existing.createdAt.toISOString()
      };
    }

    if (dryRun || !wallet) {
      return {
        state: "dry_run" as const,
        grantId,
        amount,
        user,
        wallet: { ...balances, balance: balances.paidBalance + balances.bonusBalance },
        grantedAt: null
      };
    }

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { bonusBalance: { increment: amount } }
    });
    const ledger = await tx.walletLedger.create({
      data: {
        walletId: wallet.id,
        userId: user.id,
        delta: amount,
        bucket: "bonus",
        type: "bonus",
        source,
        refOrderId: operator ? `operator:${operator}` : null
      }
    });
    return {
      state: "created" as const,
      grantId,
      amount,
      user,
      wallet: {
        paidBalance: updated.paidBalance,
        bonusBalance: updated.bonusBalance,
        balance: updated.paidBalance + updated.bonusBalance
      },
      grantedAt: ledger.createdAt.toISOString()
    };
  });
}

export interface TrialGrantListItem {
  id: string;
  grantId: string;
  amount: number;
  userId: string;
  nickname: string | null;
  phone: string | null;
  operator: string | null;
  createdAt: string;
}

/** 列出最近的体验额度发放流水（`source` 以 `trial_grant:` 开头），供后台核对。 */
export async function listMarketplaceTrialGrants(limit: number): Promise<TrialGrantListItem[]> {
  const take = Math.min(Math.max(Math.trunc(limit) || 20, 1), 100);
  const rows = await prisma.walletLedger.findMany({
    where: { source: { startsWith: TRIAL_GRANT_SOURCE_PREFIX } },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      delta: true,
      source: true,
      refOrderId: true,
      createdAt: true,
      userId: true,
      user: { select: { nickname: true, phone: true } }
    }
  });
  return rows.map((row) => ({
    id: row.id,
    grantId: row.source.slice(TRIAL_GRANT_SOURCE_PREFIX.length),
    amount: row.delta,
    userId: row.userId,
    nickname: row.user?.nickname ?? null,
    phone: row.user?.phone ?? null,
    operator: row.refOrderId?.startsWith("operator:") ? row.refOrderId.slice("operator:".length) : null,
    createdAt: row.createdAt.toISOString()
  }));
}
