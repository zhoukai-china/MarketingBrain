import QRCode from "qrcode";
import { prisma } from "@baolu/db";
import { env } from "../config/env.js";
import { issueReferralCode, listReferralCodesOfOwner } from "./referral-attribution.js";
import { getReferralConfig, isWithinReferralCampaignWindow } from "./referral-config.js";

/**
 * 自服务「我的邀请链接」（用户 2026-09-15：平台页面里要有复制我的推荐链接的入口，含二维码）。
 *
 * 安全模型与 PLAT-28 保持一致：**推荐码明文只在签发时返回一次**（库里只存 hash + preview，
 * 明文无法回收）。因此这里的口径是：
 * - 已经有有效推荐码 → 不新签，只回 `codePreview` 与人话提示（避免"每次点都发新码"）；
 * - 没有 → 现场签一条，把明文 + 完整注册链接 + 二维码一起回给本人；
 * - 想再要一条 → 显式 `regenerate: true`（页面按钮写明「旧链接仍然有效」）。
 *
 * 链接由**服务端**用 `PUBLIC_WEB_BASE_URL` 拼，不接受客户端传入的地址（避免被当成免费二维码生成器）。
 */

export interface SelfReferralLinkView {
  /** `none` = 还没签过推荐码（页面应该给「生成我的邀请链接」）。 */
  state: "none" | "existing" | "created";
  /**
   * 推荐活动是否在窗口内（用户 2026-09-16：活动期 10.1–10.7 才开放，平时「先下架」）。
   * 只有为 `true` 时「我的」页才显示邀请链接卡片；活动开关一开，卡片自己回来。
   */
  campaignActive: boolean;
  /** 完整注册链接（`<公开站点>/login?ref=<码>`）；只有刚签发时才有明文可拼。 */
  link: string | null;
  /** 明文推荐码：只在 `created` 时返回一次。 */
  code: string | null;
  codePreview: string | null;
  qrSvg: string | null;
  codesCount: number;
  hint: string;
}

function buildReferralLink(code: string): string {
  const base = String(env.PUBLIC_WEB_BASE_URL ?? "").replace(/\/+$/, "");
  return `${base}/login?ref=${encodeURIComponent(code)}`;
}

/** 活动窗口是否开放（读后台配置位 + 左闭右开窗口判断，与发奖同一套口径）。 */
async function isReferralCampaignActiveForUi(): Promise<boolean> {
  try {
    const config = await getReferralConfig();
    if (!config.enabled) return false;
    return isWithinReferralCampaignWindow(new Date(), {
      campaignStartsAt: config.campaignStartsAt,
      campaignEndsAt: config.campaignEndsAt
    });
  } catch {
    // 读配置失败按「未开放」处理：宁可先不显示，也不能在没活动时把推荐入口露出来。
    return false;
  }
}

async function renderQrSvg(link: string): Promise<string> {
  // 只对服务端自己拼出来的链接画二维码：不接受调用方传入的 URL。
  return QRCode.toString(link, { type: "svg", margin: 1, width: 320 });
}

export async function readSelfReferralLink(userId: string): Promise<SelfReferralLinkView> {
  const codes = await listReferralCodesOfOwner(userId);
  const active = codes.filter((item) => item.isActive);
  return {
    state: active.length > 0 ? "existing" : "none",
    /**
     * 活动开关（用户 2026-09-16：「暂时不开放，等我通知，预计 10.1–10.7 搞活动再开放，先下架」）。
     * 前端据此决定「我的邀请链接」卡片显不显示——活动一到（后台把开关和活动窗打开）卡片自己回来，不用改代码。
     */
    campaignActive: await isReferralCampaignActiveForUi(),
    link: null,
    code: null,
    codePreview: active[0]?.codePreview ?? null,
    qrSvg: null,
    codesCount: codes.length,
    hint: active.length > 0
      ? "你已经有一个推荐码（明文只在签发时显示过一次，不再重复展示）。点「生成新的邀请链接」可以再签一条——旧链接仍然有效。"
      : "还没有推荐码，点「生成我的邀请链接」即可拿到专属邀请链接和二维码。"
  };
}

/* ------------------------------------------------------------------ *
 * 「被邀请的客户」列表（2026-09-30 用户：邀请有礼里要能看到被邀请的客户列表）
 * ------------------------------------------------------------------ */

export interface MyInviteeItem {
  /** 绑定 id（前端 key，不暴露用户 id）。 */
  id: string;
  /** 已打码的展示名（昵称优先，没有昵称用「微信用户 + 打码手机号」）。 */
  name: string;
  /** 已打码手机号；没有任何联系方式时为 null。 */
  phone: string | null;
  boundAt: string;
  hasWechat: boolean;
  /** 推荐人侧奖励：被邀请人首次真实使用（+100）。 */
  firstUseRewarded: boolean;
  /** 推荐人侧奖励：被邀请人首次真实充值（+200）。 */
  firstRechargeRewarded: boolean;
  /** 该客户给我带来的算力合计（不含发给被邀请人本人的新客礼）。 */
  creditsEarned: number;
}

export interface MyInviteesView {
  /** 我名下的被邀请人总数（不受分页影响）。 */
  total: number;
  /** 这些客户累计给我带来的算力。 */
  creditsEarned: number;
  invitees: MyInviteeItem[];
}

/** 手机号打码：138****8888。位数不足时退回 null（宁可不显示，也不显示掩不全的原串）。 */
function maskPhone(phone: string | null | undefined): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length >= 11) return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
  if (digits.length >= 7) return `${digits.slice(0, 3)}***${digits.slice(-2)}`;
  return null;
}

/** 昵称打码：张三 → 张*；张小三 → 张*三。没昵称就用打码手机号兜底。 */
function maskName(nickname: string | null | undefined, phone: string | null | undefined): string {
  const name = String(nickname ?? "").trim();
  if (name) {
    if (name.length <= 1) return `${name}*`;
    if (name.length === 2) return `${name[0]}*`;
    return `${name[0]}**${name[name.length - 1]}`;
  }
  const masked = maskPhone(phone);
  return masked ? `微信用户 ${masked}` : "微信好友";
}

/**
 * 我名下的被邀请客户（推荐关系归因结果 + 已到账奖励）。
 *
 * 奖励真源在 `WalletLedger`：`referral_reward:<kind>:<bindingId>`（见 `referral-rewards.ts`），
 * 所以「有没有拿到首次使用 / 首次充值奖励」直接从我的账本反查，不另建状态表。
 * 姓名 / 手机号一律打码：这是给别人看的清单，不该把客户完整联系方式摆在邀请页上。
 */
export async function listMyInvitees(userId: string, limit = 50): Promise<MyInviteesView> {
  const take = Math.min(Math.max(Math.trunc(limit) || 50, 1), 100);
  const [total, bindings, rewardRows] = await Promise.all([
    prisma.referralBinding.count({ where: { referrerUserId: userId } }),
    prisma.referralBinding.findMany({
      where: { referrerUserId: userId },
      orderBy: { boundAt: "desc" },
      take,
      select: {
        id: true,
        boundAt: true,
        referred: { select: { nickname: true, phone: true, wechatOpenid: true, wechatUnionid: true } }
      }
    }),
    prisma.walletLedger.findMany({
      where: { userId, source: { startsWith: "referral_reward:" } },
      select: { source: true, delta: true }
    })
  ]);

  const rewarded = new Map<string, { firstUse: boolean; firstRecharge: boolean; credits: number }>();
  for (const row of rewardRows) {
    // `referral_reward:<kind>:<bindingId>`：bindingId 自己不含冒号，第 3 段起拼回来更稳。
    const parts = String(row.source ?? "").split(":");
    if (parts.length < 3) continue;
    const kind = parts[1];
    // 新客礼发的是**被推荐人**，不算我的收益，也不进我的明细。
    if (kind === "new_user") continue;
    const bindingId = parts.slice(2).join(":");
    const current = rewarded.get(bindingId) ?? { firstUse: false, firstRecharge: false, credits: 0 };
    if (kind === "referrer_first_use") current.firstUse = true;
    if (kind === "referrer_first_recharge") current.firstRecharge = true;
    current.credits += Math.max(0, row.delta);
    rewarded.set(bindingId, current);
  }

  const invitees: MyInviteeItem[] = bindings.map((row) => {
    const reward = rewarded.get(row.id);
    return {
      id: row.id,
      name: maskName(row.referred.nickname, row.referred.phone),
      phone: maskPhone(row.referred.phone),
      boundAt: row.boundAt.toISOString(),
      hasWechat: Boolean(row.referred.wechatOpenid || row.referred.wechatUnionid),
      firstUseRewarded: Boolean(reward?.firstUse),
      firstRechargeRewarded: Boolean(reward?.firstRecharge),
      creditsEarned: reward?.credits ?? 0
    };
  });

  return {
    total,
    creditsEarned: invitees.reduce((sum, item) => sum + item.creditsEarned, 0),
    invitees
  };
}

export async function issueSelfReferralLink(params: { userId: string; regenerate?: boolean }): Promise<SelfReferralLinkView> {
  const codes = await listReferralCodesOfOwner(params.userId);
  const active = codes.filter((item) => item.isActive);
  // 活动没开时也不该能签发（页面已隐藏入口，这里再兜一层，避免接口被直接调用）。
  const campaignActive = await isReferralCampaignActiveForUi();
  if (!campaignActive) {
    return {
      state: active.length > 0 ? "existing" : "none",
      campaignActive: false,
      link: null,
      code: null,
      codePreview: active[0]?.codePreview ?? null,
      qrSvg: null,
      codesCount: codes.length,
      hint: "推荐有礼活动暂未开放（预计 10.1–10.7），活动开始后可在这里生成专属邀请链接。"
    };
  }
  if (active.length > 0 && !params.regenerate) {
    return {
      state: "existing",
      campaignActive,
      link: null,
      code: null,
      codePreview: active[0]?.codePreview ?? null,
      qrSvg: null,
      codesCount: codes.length,
      hint: "你已经有一个推荐码（明文只在签发时显示过一次，不再重复展示）。点「生成新的邀请链接」可以再签一条——旧链接仍然有效。"
    };
  }

  const issued = await issueReferralCode({
    identity: { userId: params.userId },
    label: "我的邀请链接（自服务）",
    createdBy: params.userId
  });
  const link = buildReferralLink(issued.code);
  return {
    state: "created",
    campaignActive,
    link,
    code: issued.code,
    codePreview: issued.codePreview,
    qrSvg: await renderQrSvg(link),
    codesCount: codes.length + 1,
    hint: "把链接或二维码发给朋友：对方首次开通工作区时，推荐关系会自动登记到你这。"
  };
}
