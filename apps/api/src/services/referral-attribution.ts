import { createHash, randomBytes, randomInt } from "node:crypto";
import { prisma } from "@baolu/db";

/**
 * 推荐有礼 · 推荐码与归因（PLAT-28 第①批）。
 *
 * 冻结口径（用户 2026-09-12）：
 * - 归因三要素：推荐人（unionid / openid） + 被推荐人 + 绑定时间；
 * - 同一微信只能被推荐一次 → 被推荐人 userId / unionid / openid 三重唯一；
 * - 重复绑定**只拒绝归因**，不阻断注册（否则一条过期链接就能把新用户挡在门外）；
 * - 不带推荐码注册照常，行为与上线前完全一致；
 * - 第①批只落归因，不发任何奖励（奖励由第②批按活动窗发放）。
 *
 * 生产实测（2026-09-12，`baolu_os_v2`）：User 204 人 / 有 unionid 0 人 / 有 openid 17 人。
 * 微信网页授权当前拿不到 unionid，所以「同一微信只能被推荐一次」必须 openid 兜底，
 * 否则这条风控在真实数据上等于不存在；两个字段都为空时才只剩 userId 唯一这一道。
 */

export const REFERRAL_CODE_PREFIX = "ref-";

export type ReferralBindState =
  | "none"
  | "bound"
  | "invalid_code"
  | "expired"
  | "exhausted"
  | "self_referral"
  | "already_bound"
  | "failed";

export interface ReferralBindOutcome {
  state: ReferralBindState;
  /** 只回预览（前 2 后 2），绝不回完整推荐码 */
  codePreview?: string;
  referrerUserId?: string;
}

export interface ReferralIdentity {
  userId?: string;
  phone?: string;
  wechatOpenid?: string;
  wechatUnionid?: string;
}

export class ReferralCodeError extends Error {
  readonly code:
    | "referral_identity_required"
    | "referral_user_not_found"
    | "referral_user_ambiguous"
    | "referral_label_invalid";

  constructor(code: ReferralCodeError["code"], message: string) {
    super(message);
    this.name = "ReferralCodeError";
    this.code = code;
  }
}

export function normalizeReferralCode(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

export function hashReferralCode(code: string): string {
  return createHash("sha256").update(normalizeReferralCode(code)).digest("hex");
}

export function previewReferralCode(code: string): string {
  const normalized = normalizeReferralCode(code);
  if (normalized.length <= 6) return "****";
  return `${normalized.slice(0, 4)}****${normalized.slice(-2)}`;
}

/**
 * 推荐码字符表：**只用小写字母 + 数字**。
 *
 * 不用 base64url 的原因（2026-09-12 生产实测）：base64url 会生成 `_` / `-`，
 * 这次的验收码就正好以 `_` 结尾（`ref-…zpo_`）——分享到聊天工具或手抄时，
 * 结尾的下划线/连字符最容易被截断或吃掉，链接就废了。12 位 36 进制 ≈ 62 bit 熵，
 * 对「不可枚举」足够。
 */
const REFERRAL_CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const REFERRAL_CODE_LENGTH = 12;

/** 推荐码：`ref-` + 12 位小写字母数字，足够短、可手抄、不可枚举。 */
export function generateReferralCode(): string {
  let body = "";
  for (let index = 0; index < REFERRAL_CODE_LENGTH; index += 1) {
    body += REFERRAL_CODE_ALPHABET[randomInt(REFERRAL_CODE_ALPHABET.length)];
  }
  return `${REFERRAL_CODE_PREFIX}${body}`;
}

function resolveIdentitySelector(identity: ReferralIdentity): { label: string; where: Record<string, string> } {
  const selectors: Array<{ label: string; where: Record<string, string> | null }> = [
    { label: "user_id", where: identity.userId ? { id: identity.userId.trim() } : null },
    { label: "phone", where: identity.phone ? { phone: identity.phone.trim() } : null },
    { label: "wechat_openid", where: identity.wechatOpenid ? { wechatOpenid: identity.wechatOpenid.trim() } : null },
    { label: "wechat_unionid", where: identity.wechatUnionid ? { wechatUnionid: identity.wechatUnionid.trim() } : null }
  ];
  const picked = selectors.filter((item) => item.where !== null) as Array<{ label: string; where: Record<string, string> }>;
  if (picked.length !== 1) {
    throw new ReferralCodeError(
      "referral_identity_required",
      "必须且只能提供一个推荐人身份：手机号 / 微信 openid / 微信 unionid / user-id"
    );
  }
  return picked[0];
}

export interface IssuedReferralCode {
  /** 明文只在这一次返回；库里只有 sha256，之后无法再取回，只能看预览。 */
  code: string;
  codePreview: string;
  label: string | null;
  createdAt: string;
  owner: {
    id: string;
    nickname: string | null;
    phone: string | null;
    hasUnionid: boolean;
    hasOpenid: boolean;
  };
  /** 既无 unionid 也无 openid 时的提醒（此时风控只剩 userId 唯一） */
  warning?: string;
}

/**
 * 给一个已注册用户下发推荐码（后台/运营入口）。
 * 每次调用都会签发一个新码，历史码保持有效（已发出去的链接不能因为再签一个就失效）；
 * 明文无法回收，因此不返回历史码明文，只返回本次这一个。
 */
export async function issueReferralCode(params: {
  identity: ReferralIdentity;
  label?: string | null;
  createdBy?: string | null;
}): Promise<IssuedReferralCode> {
  const { label: identityLabel, where } = resolveIdentitySelector(params.identity ?? {});
  const users = await prisma.user.findMany({
    where,
    select: { id: true, nickname: true, phone: true, wechatOpenid: true, wechatUnionid: true },
    take: 5
  });
  if (users.length === 0) {
    throw new ReferralCodeError(
      "referral_user_not_found",
      `没有找到匹配的推荐人（${identityLabel}）。推荐人必须先自己微信登录过思潼 AI。`
    );
  }
  if (users.length > 1) {
    throw new ReferralCodeError("referral_user_ambiguous", `匹配到 ${users.length} 个用户，请改用手机号或用户 ID 精确定位`);
  }
  const owner = users[0];
  const label = (params.label ?? "").trim() || null;
  if (label && label.length > 40) throw new ReferralCodeError("referral_label_invalid", "备注最多 40 个字");

  const code = generateReferralCode();
  const row = await prisma.referralCode.create({
    data: {
      ownerUserId: owner.id,
      ownerUnionid: owner.wechatUnionid,
      ownerOpenid: owner.wechatOpenid,
      codeHash: hashReferralCode(code),
      codePreview: previewReferralCode(code),
      label,
      createdBy: params.createdBy?.trim() || null
    }
  });
  const hasUnionid = Boolean(owner.wechatUnionid);
  const hasOpenid = Boolean(owner.wechatOpenid);
  return {
    code,
    codePreview: row.codePreview,
    label: row.label,
    createdAt: row.createdAt.toISOString(),
    owner: {
      id: owner.id,
      nickname: owner.nickname,
      phone: owner.phone,
      hasUnionid,
      hasOpenid
    },
    ...(hasUnionid || hasOpenid
      ? {}
      : { warning: "该推荐人既无 unionid 也无 openid：被推荐人的「同一微信只能被推荐一次」将退化为仅按 userId 去重。" })
  };
}

interface BindCandidate {
  codeId: string;
  codePreview: string;
  referrerUserId: string;
  referrerUnionid: string | null;
  referrerOpenid: string | null;
}

type ReferralCodeLookup = { ok: true; candidate: BindCandidate } | { ok: false; outcome: ReferralBindOutcome };

async function lookupCode(normalizedCode: string): Promise<ReferralCodeLookup> {
  const record = await prisma.referralCode.findUnique({
    where: { codeHash: hashReferralCode(normalizedCode) },
    select: {
      id: true,
      codePreview: true,
      isActive: true,
      maxUses: true,
      usedCount: true,
      expiresAt: true,
      ownerUserId: true,
      ownerUnionid: true,
      ownerOpenid: true
    }
  });
  if (!record) return { ok: false, outcome: { state: "invalid_code" } };
  if (!record.isActive) return { ok: false, outcome: { state: "invalid_code", codePreview: record.codePreview } };
  if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
    return { ok: false, outcome: { state: "expired", codePreview: record.codePreview } };
  }
  if (record.maxUses !== null && record.usedCount >= record.maxUses) {
    return { ok: false, outcome: { state: "exhausted", codePreview: record.codePreview } };
  }
  return {
    ok: true,
    candidate: {
      codeId: record.id,
      codePreview: record.codePreview,
      referrerUserId: record.ownerUserId,
      referrerUnionid: record.ownerUnionid,
      referrerOpenid: record.ownerOpenid
    }
  };
}

/**
 * 给「刚刚注册完成」的被推荐人落归因。
 *
 * 契约：
 * - **绝不抛错给调用方**（注册已经成功，归因失败只能记日志，不能把用户挡在门外）；
 * - 重复绑定 / 自荐 / 无效码 → 返回对应状态，不写任何行；
 * - 并发抢同一个被推荐人时靠唯一索引兜底，后到者返回 already_bound。
 */
export async function bindReferralForNewUser(params: {
  referralCode?: string | null;
  referredUserId: string;
  tenantId?: string | null;
  source?: string;
}): Promise<ReferralBindOutcome> {
  const normalizedCode = normalizeReferralCode(params.referralCode);
  if (!normalizedCode) return { state: "none" };
  try {
    const referred = await prisma.user.findUnique({
      where: { id: params.referredUserId },
      select: { id: true, wechatOpenid: true, wechatUnionid: true }
    });
    if (!referred) return { state: "failed", codePreview: undefined };

    const found = await lookupCode(normalizedCode);
    if (!found.ok) return found.outcome;
    const candidate = found.candidate;

    const selfReferral =
      candidate.referrerUserId === referred.id ||
      (Boolean(candidate.referrerUnionid) && candidate.referrerUnionid === referred.wechatUnionid) ||
      (Boolean(candidate.referrerOpenid) && candidate.referrerOpenid === referred.wechatOpenid);
    if (selfReferral) {
      return { state: "self_referral", codePreview: candidate.codePreview, referrerUserId: candidate.referrerUserId };
    }

    const duplicate = await prisma.referralBinding.findFirst({
      where: {
        OR: [
          { referredUserId: referred.id },
          ...(referred.wechatUnionid ? [{ referredUnionid: referred.wechatUnionid }] : []),
          ...(referred.wechatOpenid ? [{ referredOpenid: referred.wechatOpenid }] : [])
        ]
      },
      select: { id: true }
    });
    if (duplicate) {
      return { state: "already_bound", codePreview: candidate.codePreview, referrerUserId: candidate.referrerUserId };
    }

    await prisma.$transaction(async (tx) => {
      await tx.referralBinding.create({
        data: {
          referralCodeId: candidate.codeId,
          referrerUserId: candidate.referrerUserId,
          referrerUnionid: candidate.referrerUnionid,
          referrerOpenid: candidate.referrerOpenid,
          referredUserId: referred.id,
          referredUnionid: referred.wechatUnionid,
          referredOpenid: referred.wechatOpenid,
          tenantId: params.tenantId ?? null,
          source: params.source ?? "registration",
          metadata: {
            // 归因当时的活动窗快照留给第②批/第③批核对：第①批绑定通常发生在活动窗开始之前，
            // 按冻结口径这些绑定不会产生奖励，写下来是为了将来不产生歧义。
            boundVia: "registration_referral_link"
          }
        }
      });
      await tx.referralCode.update({ where: { id: candidate.codeId }, data: { usedCount: { increment: 1 } } });
    });
    return { state: "bound", codePreview: candidate.codePreview, referrerUserId: candidate.referrerUserId };
  } catch (error) {
    // 唯一索引冲突（并发/同微信第二个账号）按「已绑定过」处理，其余记日志后放弃归因。
    const code = (error as { code?: string })?.code;
    if (code === "P2002") return { state: "already_bound" };
    console.warn(
      "[referral-attribution] 归因失败（注册不受影响）：",
      error instanceof Error ? error.message : String(error)
    );
    return { state: "failed" };
  }
}

export interface ReferralBindingListItem {
  id: string;
  codePreview: string;
  referrer: { userId: string; nickname: string | null; phone: string | null };
  referred: { userId: string; nickname: string | null; phone: string | null; hasWechat: boolean };
  tenantId: string | null;
  source: string;
  boundAt: string;
}

/** 后台核对用：最近的推荐归因（第③批的「推荐明细」会在此基础上做推荐人视角汇总）。 */
export async function listReferralBindings(limit: number): Promise<ReferralBindingListItem[]> {
  const take = Math.min(Math.max(Math.trunc(limit) || 20, 1), 100);
  const rows = await prisma.referralBinding.findMany({
    orderBy: { boundAt: "desc" },
    take,
    select: {
      id: true,
      tenantId: true,
      source: true,
      boundAt: true,
      referralCode: { select: { codePreview: true } },
      referrer: { select: { id: true, nickname: true, phone: true } },
      referred: { select: { id: true, nickname: true, phone: true, wechatOpenid: true, wechatUnionid: true } }
    }
  });
  return rows.map((row) => ({
    id: row.id,
    codePreview: row.referralCode.codePreview,
    referrer: { userId: row.referrer.id, nickname: row.referrer.nickname, phone: row.referrer.phone },
    referred: {
      userId: row.referred.id,
      nickname: row.referred.nickname,
      phone: row.referred.phone,
      hasWechat: Boolean(row.referred.wechatOpenid || row.referred.wechatUnionid)
    },
    tenantId: row.tenantId,
    source: row.source,
    boundAt: row.boundAt.toISOString()
  }));
}

export interface ReferrerCodeSummary {
  codePreview: string;
  label: string | null;
  isActive: boolean;
  createdAt: string;
  usedCount: number;
}

/** 某个推荐人名下的推荐码清单（明文不可回收，只给预览）。 */
export async function listReferralCodesOfOwner(userId: string): Promise<ReferrerCodeSummary[]> {
  const rows = await prisma.referralCode.findMany({
    where: { ownerUserId: userId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { codePreview: true, label: true, isActive: true, createdAt: true, usedCount: true }
  });
  return rows.map((row) => ({
    codePreview: row.codePreview,
    label: row.label,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    usedCount: row.usedCount
  }));
}
