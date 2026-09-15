import QRCode from "qrcode";
import { env } from "../config/env.js";
import { issueReferralCode, listReferralCodesOfOwner } from "./referral-attribution.js";

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

async function renderQrSvg(link: string): Promise<string> {
  // 只对服务端自己拼出来的链接画二维码：不接受调用方传入的 URL。
  return QRCode.toString(link, { type: "svg", margin: 1, width: 320 });
}

export async function readSelfReferralLink(userId: string): Promise<SelfReferralLinkView> {
  const codes = await listReferralCodesOfOwner(userId);
  const active = codes.filter((item) => item.isActive);
  return {
    state: active.length > 0 ? "existing" : "none",
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

export async function issueSelfReferralLink(params: { userId: string; regenerate?: boolean }): Promise<SelfReferralLinkView> {
  const codes = await listReferralCodesOfOwner(params.userId);
  const active = codes.filter((item) => item.isActive);
  if (active.length > 0 && !params.regenerate) {
    return {
      state: "existing",
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
    link,
    code: issued.code,
    codePreview: issued.codePreview,
    qrSvg: await renderQrSvg(link),
    codesCount: codes.length + 1,
    hint: "把链接或二维码发给朋友：对方首次开通工作区时，推荐关系会自动登记到你这。"
  };
}
