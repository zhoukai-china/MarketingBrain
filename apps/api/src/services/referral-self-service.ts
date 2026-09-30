import QRCode from "qrcode";
import { prisma } from "@baolu/db";
import { env } from "../config/env.js";
import { issueReferralCode, listReferralCodesOfOwner } from "./referral-attribution.js";
import { getReferralConfig, isWithinReferralCampaignWindow } from "./referral-config.js";

/**
 * 自服务「我的邀请链接」（用户 2026-09-15：平台页面里要有复制我的推荐链接的入口，含二维码）。
 *
 * 安全模型（2026-09-30 修订）：后台下发的码仍遵守 PLAT-28「明文只返回一次」；
 * 但**自助推荐链接是用户自己的分享物料**，用户要随时打开抽屉取回链接/二维码/邀请码，
 * 所以自助签发的码把明文存进 `ReferralCode.codePlaintext`（见迁移 202609300001），GET 随时可回显。
 * 口径：
 * - 已有可回显的自助码 → GET/POST 都直接返回同一个链接（不再每次新签）；
 * - 没有 → 现场签一条（存明文），把明文 + 完整注册链接 + 二维码一起回给本人；
 * - 想换一条 → 显式 `regenerate: true`（页面按钮写明「旧链接仍然有效」）。
 *
 * 签发**不再被活动窗拦住**（2026-09-30 用户：邀请抽屉三个空位要能出数据）：
 * 活动窗只决定**发不发奖励**（referral-rewards 引擎），不决定链接能不能生成；
 * `campaignActive` 照常返回，前端据此调整海报文案，避免「承诺了奖励却不兑现」。
 *
 * 链接由**服务端**用 `PUBLIC_WEB_BASE_URL` 拼，不接受客户端传入的地址（避免被当成免费二维码生成器）。
 */

export interface SelfReferralLinkView {
  /** `none` = 还没有可回显的邀请链接（后端会自动签发，一般不会停留在这个态）。 */
  state: "none" | "existing" | "created";
  /**
   * 推荐活动是否在窗口内（奖励发放的开关，见 referral-rewards）。
   * 与链接签发解耦：false 时链接照常可用，只是海报上「各得 100 算力」暂不生效。
   */
  campaignActive: boolean;
  /** 完整注册链接（`<公开站点>/login?ref=<码>`）。 */
  link: string | null;
  /** 明文推荐码（自助码随取随回）。 */
  code: string | null;
  codePreview: string | null;
  qrSvg: string | null;
  codesCount: number;
  hint: string;
}

/**
 * 邀请链接统一站点源（用户 2026-09-30）：线上 `https://ai.lcppch.top`、本地 `http://localhost:5174`，
 * 与 API 域名（api.lcppch.top）不是同一个，所以走独立配置 `PUBLIC_SITE_ORIGIN`；
 * 未配置时回退 `PUBLIC_WEB_BASE_URL` 的 origin（老环境不配也不至于拼出 404）。
 */
function siteOrigin(): string {
  const configured = String(env.PUBLIC_SITE_ORIGIN ?? "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  return String(env.PUBLIC_WEB_BASE_URL ?? "").replace(/\/+$/, "");
}

function buildReferralLink(code: string): string {
  return `${siteOrigin()}/login?ref=${encodeURIComponent(code)}`;
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
  const [codes, campaignActive] = await Promise.all([
    listReferralCodesOfOwner(userId),
    isReferralCampaignActiveForUi()
  ]);
  const codesCount = codes.length;
  // 可回显的自助码：有明文的那条（最新的优先——按 codesCount 无法判断，直接查库拿最新）。
  const reusable = await prisma.referralCode.findFirst({
    where: { ownerUserId: userId, isActive: true, codePlaintext: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { codePlaintext: true, codePreview: true }
  });
  if (reusable?.codePlaintext) {
    const link = buildReferralLink(reusable.codePlaintext);
    return {
      state: "existing",
      campaignActive,
      link,
      code: reusable.codePlaintext,
      codePreview: reusable.codePreview,
      qrSvg: await renderQrSvg(link),
      codesCount,
      hint: campaignActive
        ? "把链接或二维码发给朋友：对方首次开通工作区时，推荐关系自动登记到你这，奖励自动到账。"
        : "链接已就绪、随时可分享；邀请奖励将在推荐活动开启后自动生效。"
    };
  }
  return {
    state: "none",
    campaignActive,
    link: null,
    code: null,
    codePreview: codes[0]?.codePreview ?? null,
    qrSvg: null,
    codesCount,
    hint: "还没有专属邀请链接，正在为你自动生成…"
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
  /** 这些客户累计给我带来的算力（全量口径，不受分页影响）。 */
  creditsEarned: number;
  page: number;
  pageSize: number;
  totalPages: number;
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
 * 我名下的被邀请客户（推荐关系归因结果 + 已到账奖励），分页（2026-09-30 用户：与算力明细同款翻页）。
 *
 * 奖励真源在 `WalletLedger`：`referral_reward:<kind>:<bindingId>`（见 `referral-rewards.ts`），
 * 所以「有没有拿到首次使用 / 首次充值奖励」直接从我的账本反查，不另建状态表。
 * 姓名 / 手机号一律打码：这是给别人看的清单，不该把客户完整联系方式摆在邀请页上。
 */
export async function listMyInvitees(
  userId: string,
  options: { page?: number; pageSize?: number } = {}
): Promise<MyInviteesView> {
  const page = Math.max(1, Math.trunc(options.page ?? 1) || 1);
  const pageSize = Math.min(50, Math.max(1, Math.trunc(options.pageSize ?? 8) || 8));
  const [total, bindings, rewardRows] = await Promise.all([
    prisma.referralBinding.count({ where: { referrerUserId: userId } }),
    prisma.referralBinding.findMany({
      where: { referrerUserId: userId },
      orderBy: { boundAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
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

  let creditsEarned = 0;
  const rewarded = new Map<string, { firstUse: boolean; firstRecharge: boolean; credits: number }>();
  for (const row of rewardRows) {
    // `referral_reward:<kind>:<bindingId>`：bindingId 自己不含冒号，第 3 段起拼回来更稳。
    const parts = String(row.source ?? "").split(":");
    if (parts.length < 3) continue;
    const kind = parts[1];
    // 新客礼发的是**被推荐人**，不算我的收益，也不进我的明细。
    if (kind === "new_user") continue;
    const bindingId = parts.slice(2).join(":");
    creditsEarned += Math.max(0, row.delta);
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
    creditsEarned,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    invitees
  };
}

export async function issueSelfReferralLink(params: { userId: string; regenerate?: boolean }): Promise<SelfReferralLinkView> {
  const codes = await listReferralCodesOfOwner(params.userId);
  const campaignActive = await isReferralCampaignActiveForUi();
  // 已有可回显的自助码且没有要求换新 → 直接回同一条（不每次新签，避免码无限增长）。
  if (!params.regenerate) {
    const reusable = await prisma.referralCode.findFirst({
      where: { ownerUserId: params.userId, isActive: true, codePlaintext: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { codePlaintext: true, codePreview: true }
    });
    if (reusable?.codePlaintext) {
      const link = buildReferralLink(reusable.codePlaintext);
      return {
        state: "existing",
        campaignActive,
        link,
        code: reusable.codePlaintext,
        codePreview: reusable.codePreview,
        qrSvg: await renderQrSvg(link),
        codesCount: codes.length,
        hint: campaignActive
          ? "把链接或二维码发给朋友：对方首次开通工作区时，推荐关系自动登记到你这，奖励自动到账。"
          : "链接已就绪、随时可分享；邀请奖励将在推荐活动开启后自动生效。"
      };
    }
  }

  // 签发与活动窗解耦（2026-09-30）：活动没开也能生成链接做分享/归因；
  // 奖励是否发放由 referral-rewards 引擎在绑定/使用/充值时按当时的活动窗判断。
  const issued = await issueReferralCode({
    identity: { userId: params.userId },
    label: "我的邀请链接（自服务）",
    createdBy: params.userId,
    persistPlaintext: true
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
    hint: campaignActive
      ? "把链接或二维码发给朋友：对方首次开通工作区时，推荐关系自动登记到你这。"
      : "专属邀请链接已生成；邀请奖励将在推荐活动开启后自动生效。"
  };
}
