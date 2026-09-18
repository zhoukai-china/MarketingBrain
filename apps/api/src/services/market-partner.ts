import { prisma } from "@baolu/db";
import { randomBytes } from "node:crypto";
import { env } from "../config/env.js";

/**
 * 市场合伙人（PLAT-48）第①批：专属链接 → 注册绑定。
 *
 * 命名约定（用户 2026-09-12）：对外一律叫「市场合伙人」，内部继续复用历史表
 * `Distributor` / `ShareLink` / `DistroCustomer`，不在 UI / 文案里出现「分销商」。
 *
 * 安全契约与 PLAT-28 推荐归因保持一致：
 * - 归因只在注册事务提交后执行，失败绝不回滚已创建的工作区；
 * - 无效 / 过期 / 停用 / 自荐 / 重复只拒绝归因，不阻断注册。
 */

export type PartnerBindState = "none" | "bound" | "already_bound" | "invalid_code" | "expired" | "self" | "failed";

export interface PartnerBindOutcome {
  state: PartnerBindState;
  distributorId?: string;
  codePreview?: string;
}

function randomCode(prefix: string): string {
  return `${prefix}${randomBytes(12).toString("base64url").replace(/[-_]/g, "").slice(0, 14)}`;
}

function preview(code: string): string {
  return code.length > 6 ? `${code.slice(0, 4)}…${code.slice(-2)}` : code;
}

export function buildPartnerLink(code: string): string {
  const base = String(env.PUBLIC_WEB_BASE_URL ?? "").replace(/\/+$/, "");
  return `${base}/login?partner=${encodeURIComponent(code)}`;
}

export interface MarketPartnerView {
  id: string;
  name: string;
  phone: string | null;
  code: string;
  status: string;
  links: Array<{
    id: string;
    code: string;
    url: string;
    isActive: boolean;
    registerCount: number;
    clickCount: number;
  }>;
  customerCount: number;
  totalEarnings: number;
  frozenAmount: number;
  availableAmount: number;
}

async function withUniqueCodes<T>(factory: () => Promise<T>, maxRetry = 3): Promise<T> {
  for (let attempt = 0; attempt < maxRetry; attempt += 1) {
    try {
      return await factory();
    } catch (error) {
      if ((error as { code?: string })?.code === "P2002" && attempt < maxRetry - 1) continue;
      throw error;
    }
  }
  throw new Error("code_generation_conflict");
}

export async function createMarketPartner(params: {
  name: string;
  phone?: string | null;
  userId?: string | null;
  tenantId: string;
  createdBy?: string | null;
}): Promise<{ partner: MarketPartnerView; link: string }> {
  const name = params.name.trim();
  if (!name) throw Object.assign(new Error("partner_name_required"), { statusCode: 400 });

  const tenant = await prisma.tenant.findUnique({ where: { id: params.tenantId }, select: { id: true } });
  if (!tenant) throw Object.assign(new Error("tenant_not_found"), { statusCode: 400 });

  if (params.userId) {
    const user = await prisma.user.findUnique({ where: { id: params.userId }, select: { id: true } });
    if (!user) throw Object.assign(new Error("partner_user_not_found"), { statusCode: 400 });
  }

  const distributor = await withUniqueCodes(async () => {
    return prisma.distributor.create({
      data: {
        tenantId: params.tenantId,
        userId: params.userId ?? null,
        name,
        phone: params.phone?.trim() || null,
        level: 1,
        code: randomCode("P"),
        status: "active"
      }
    });
  });

  const shareLink = await withUniqueCodes(async () => {
    const code = randomCode("L");
    return prisma.shareLink.create({
      data: {
        distributorId: distributor.id,
        tenantId: params.tenantId,
        code,
        url: buildPartnerLink(code),
        channel: "wechat",
        title: name,
        isActive: true
      }
    });
  });

  return {
    partner: await readMarketPartner(distributor.id),
    link: buildPartnerLink(shareLink.code)
  };
}

export async function listMarketPartners(): Promise<MarketPartnerView[]> {
  const distributors = await prisma.distributor.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      shareLinks: { orderBy: { createdAt: "desc" } },
      customers: { select: { id: true } }
    }
  });
  return distributors.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    code: row.code,
    status: row.status,
    links: row.shareLinks.map((link) => ({
      id: link.id,
      code: link.code,
      url: link.url,
      isActive: link.isActive,
      registerCount: link.registerCount,
      clickCount: link.clickCount
    })),
    customerCount: row.customers.length,
    totalEarnings: Number(row.totalEarnings),
    frozenAmount: Number(row.frozenAmount),
    availableAmount: Number(row.availableAmount)
  }));
}

async function readMarketPartner(id: string): Promise<MarketPartnerView> {
  const row = await prisma.distributor.findUniqueOrThrow({
    where: { id },
    include: {
      shareLinks: { orderBy: { createdAt: "desc" } },
      customers: { select: { id: true } }
    }
  });
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    code: row.code,
    status: row.status,
    links: row.shareLinks.map((link) => ({
      id: link.id,
      code: link.code,
      url: link.url,
      isActive: link.isActive,
      registerCount: link.registerCount,
      clickCount: link.clickCount
    })),
    customerCount: row.customers.length,
    totalEarnings: Number(row.totalEarnings),
    frozenAmount: Number(row.frozenAmount),
    availableAmount: Number(row.availableAmount)
  };
}

/**
 * 注册成功后把新工作区归因到市场合伙人。
 *
 * 永远 best-effort：任何错误都只记日志并返回 `failed`，绝不把已经创建好的工作区回滚。
 */
export async function bindMarketPartnerForNewUser(params: {
  partnerCode?: string | null;
  referredUserId: string;
  tenantId: string;
  tenantName?: string | null;
  source?: string;
}): Promise<PartnerBindOutcome> {
  const code = (params.partnerCode ?? "").trim();
  if (!code) return { state: "none" };

  try {
    const link = await prisma.shareLink.findUnique({
      where: { code },
      include: { distributor: true }
    });
    if (!link) return { state: "invalid_code", codePreview: preview(code) };
    if (!link.isActive || (link.expiresAt && link.expiresAt.getTime() < Date.now())) {
      return { state: "expired", codePreview: preview(code) };
    }
    if (link.distributor.status !== "active") return { state: "invalid_code", codePreview: preview(code) };
    if (link.distributor.userId && link.distributor.userId === params.referredUserId) {
      return { state: "self", distributorId: link.distributor.id, codePreview: preview(code) };
    }

    const existing = await prisma.distroCustomer.findUnique({
      where: {
        distributorId_customerId_customerType: {
          distributorId: link.distributorId,
          customerId: params.tenantId,
          customerType: "tenant"
        }
      },
      select: { id: true }
    });
    if (existing) return { state: "already_bound", distributorId: link.distributor.id, codePreview: preview(code) };

    await prisma.$transaction(async (tx) => {
      await tx.distroCustomer.create({
        data: {
          distributorId: link.distributorId,
          customerId: params.tenantId,
          customerType: "tenant",
          name: params.tenantName?.trim() || "客户",
          source: params.source ?? "market_partner_link"
        }
      });
      await tx.shareLink.update({
        where: { id: link.id },
        data: { registerCount: { increment: 1 } }
      });
    });

    return { state: "bound", distributorId: link.distributor.id, codePreview: preview(code) };
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") return { state: "already_bound" };
    console.warn(
      "[market-partner] 归因失败（注册不受影响）：",
      error instanceof Error ? error.message : String(error)
    );
    return { state: "failed" };
  }
}
