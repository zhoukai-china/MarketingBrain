import QRCode from "qrcode";
import { prisma } from "@baolu/db";
import { randomBytes } from "node:crypto";
import { buildPartnerLink } from "./market-partner.js";

/**
 * 市场合伙人自助生成专属链接（PLAT-49）。
 *
 * 资格边界（老板 2026-09-18 确认）：**管理员先授予「市场合伙人」资格（fail-closed）**，
 * 未授予的用户调接口返回 `forbidden`，前端也不渲染入口。不做完整审批流，只加资格开关。
 *
 * 与推荐有礼自服务（PLAT-38）不同：`ShareLink.code` 是明文落库（不是只存 hash），
 * 所以「重复进入复用同一链接」是安全的，读接口可直接返回完整链接；`regenerate` 才生成新链接。
 */

export interface SelfPartnerLinkView {
  state: "forbidden" | "none" | "existing" | "created";
  link: string | null;
  code: string | null;
  codePreview: string | null;
  qrSvg: string | null;
  linksCount: number;
  hint: string;
}

function newLinkCode(): string {
  return `L${randomBytes(12).toString("base64url").replace(/[-_]/g, "").slice(0, 14)}`;
}

function newPartnerCode(): string {
  return `P${randomBytes(12).toString("base64url").replace(/[-_]/g, "").slice(0, 14)}`;
}

function preview(code: string): string {
  return code.length > 6 ? `${code.slice(0, 4)}…${code.slice(-2)}` : code;
}

async function renderQrSvg(link: string): Promise<string> {
  return QRCode.toString(link, { type: "svg", margin: 1, width: 320 });
}

export async function hasMarketPartnerGrant(userId: string): Promise<boolean> {
  const grant = await prisma.marketPartnerGrant.findUnique({ where: { userId }, select: { userId: true } });
  return Boolean(grant);
}

function forbiddenView(): SelfPartnerLinkView {
  return {
    state: "forbidden",
    link: null,
    code: null,
    codePreview: null,
    qrSvg: null,
    linksCount: 0,
    hint: "你还没有市场合伙人资格，请联系管理员开通后再生成专属链接。"
  };
}

async function latestActiveLink(params: { distributorId: string }) {
  return prisma.shareLink.findFirst({
    where: { distributorId: params.distributorId, isActive: true },
    orderBy: { createdAt: "desc" }
  });
}

export async function readSelfPartnerLink(params: { userId: string; tenantId: string }): Promise<SelfPartnerLinkView> {
  if (!(await hasMarketPartnerGrant(params.userId))) return forbiddenView();

  const distributor = await prisma.distributor.findUnique({
    where: { tenantId_userId: { tenantId: params.tenantId, userId: params.userId } }
  });
  if (!distributor) {
    return {
      state: "none",
      link: null,
      code: null,
      codePreview: null,
      qrSvg: null,
      linksCount: 0,
      hint: "生成后即可获得你的市场合伙人专属链接和二维码。"
    };
  }

  const link = await latestActiveLink({ distributorId: distributor.id });
  if (!link) {
    return {
      state: "none",
      link: null,
      code: null,
      codePreview: null,
      qrSvg: null,
      linksCount: 0,
      hint: "生成后即可获得你的市场合伙人专属链接和二维码。"
    };
  }

  return {
    state: "existing",
    link: link.url,
    code: link.code,
    codePreview: preview(link.code),
    qrSvg: await renderQrSvg(link.url),
    linksCount: 1,
    hint: "这是你的市场合伙人专属链接，复制发给客户即可；客户经此链接首次注册会归因到你名下。"
  };
}

export async function issueSelfPartnerLink(params: {
  userId: string;
  tenantId: string;
  regenerate?: boolean;
}): Promise<SelfPartnerLinkView> {
  if (!(await hasMarketPartnerGrant(params.userId))) return forbiddenView();

  const user = await prisma.user.findUnique({ where: { id: params.userId }, select: { nickname: true } });
  const distributor = await prisma.distributor.upsert({
    where: { tenantId_userId: { tenantId: params.tenantId, userId: params.userId } },
    update: {},
    create: {
      tenantId: params.tenantId,
      userId: params.userId,
      name: user?.nickname?.trim() || "市场合伙人",
      level: 1,
      code: newPartnerCode(),
      status: "active"
    }
  });

  if (!params.regenerate) {
    const existing = await latestActiveLink({ distributorId: distributor.id });
    if (existing) {
      return {
        state: "existing",
        link: existing.url,
        code: existing.code,
        codePreview: preview(existing.code),
        qrSvg: await renderQrSvg(existing.url),
        linksCount: 1,
        hint: "这是你的市场合伙人专属链接，复制发给客户即可；客户经此链接首次注册会归因到你名下。"
      };
    }
  }

  const code = newLinkCode();
  const link = buildPartnerLink(code);
  await prisma.shareLink.create({
    data: {
      distributorId: distributor.id,
      tenantId: params.tenantId,
      code,
      url: link,
      channel: "wechat",
      title: distributor.name,
      isActive: true
    }
  });

  return {
    state: "created",
    link,
    code,
    codePreview: preview(code),
    qrSvg: await renderQrSvg(link),
    linksCount: 1,
    hint: "已生成专属链接，复制或保存后即可发给客户。"
  };
}

/**
 * PLAT-49 最后一公里：管理员在后台授予资格时要能「按人挑」。
 *
 * 只靠粘贴 userId 授予资格在后台里是走不通的——老板看不到用户 ID 从哪来。
 * 这里给出最近注册的用户 + 是否已有资格，后台表格直接挂「授予 / 撤销」按钮。
 *
 * 口径：
 * - 只读，不产生任何写动作；授予/撤销仍走 `POST/DELETE /admin/market-partner-grants`。
 * - `granted` 是**当前真实资格状态**（读 MarketPartnerGrant），不是「曾经授予过」。
 * - 手机号按原样返回：本接口只在管理员令牌后面（`requireAdminToken`），
 *   后台已有「客户手机号」列，这里保持一致，不新造脱敏口径。
 */
export interface MarketPartnerCandidate {
  userId: string;
  nickname: string | null;
  phone: string | null;
  tenantId: string | null;
  tenantName: string | null;
  granted: boolean;
  createdAt: string;
}

const CANDIDATE_MAX_LIMIT = 50;

export async function listMarketPartnerCandidates(
  params: { query?: string; limit?: number } = {}
): Promise<MarketPartnerCandidate[]> {
  const keyword = (params.query ?? "").trim();
  const requested = Number.isFinite(params.limit) ? Math.trunc(params.limit as number) : 20;
  const limit = Math.min(Math.max(requested, 1), CANDIDATE_MAX_LIMIT);

  const users = await prisma.user.findMany({
    where: keyword
      ? {
          OR: [
            // 精确 userId 在最前：后台里最常用的是「把这个 ID 授权」。
            { id: keyword },
            { nickname: { contains: keyword, mode: "insensitive" } },
            { phone: { contains: keyword } }
          ]
        }
      : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      nickname: true,
      phone: true,
      createdAt: true,
      marketPartnerGrant: { select: { userId: true } },
      memberships: {
        where: { isActive: true },
        take: 1,
        select: { tenantId: true, tenant: { select: { name: true } } }
      }
    }
  });

  return users.map((user) => ({
    userId: user.id,
    nickname: user.nickname,
    phone: user.phone,
    tenantId: user.memberships[0]?.tenantId ?? null,
    tenantName: user.memberships[0]?.tenant?.name ?? null,
    granted: Boolean(user.marketPartnerGrant),
    createdAt: user.createdAt.toISOString()
  }));
}
