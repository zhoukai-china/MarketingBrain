import { createHash } from "node:crypto";
import { prisma } from "@baolu/db";
import type { PlanCode, ProductLoginCode } from "@baolu/shared";
import { env, inviteCodes, inviteRequired } from "../config/env.js";
import { toPrismaJsonOptional } from "./prisma-json.js";

export interface InviteValidationResult {
  ok: boolean;
  /** `not_required`：产品入口没带邀请码时直接放行（2026-09-17 起取消兰琪邀请码制度）。 */
  source?: "database" | "env" | "disabled" | "not_required";
  inviteCodeId?: string;
  planCode?: PlanCode | null;
  productCode?: ProductLoginCode | null;
  brandCode?: "lanqi" | null;
  error?: "invite_code_required" | "invite_code_not_found" | "invite_code_expired" | "invite_code_exhausted" | "invite_code_product_mismatch";
}

export class InviteRedemptionError extends Error {
  constructor() {
    super("invite_code_exhausted");
    this.name = "InviteRedemptionError";
  }
}

export function normalizeInviteCode(inviteCode: string | undefined): string {
  return (inviteCode ?? "").trim().toLowerCase();
}

export function hashInviteCode(inviteCode: string): string {
  return createHash("sha256").update(normalizeInviteCode(inviteCode)).digest("hex");
}

export function previewInviteCode(inviteCode: string): string {
  const normalized = normalizeInviteCode(inviteCode);
  if (normalized.length <= 4) return "****";
  return `${normalized.slice(0, 2)}****${normalized.slice(-2)}`;
}

export async function createInviteCode(params: {
  code: string;
  label?: string;
  planCode?: PlanCode;
  productCode?: ProductLoginCode;
  brandCode?: "lanqi";
  maxUses?: number;
  expiresAt?: Date | string | null;
  createdBy?: string;
}) {
  const normalized = normalizeInviteCode(params.code);
  if (!normalized) {
    throw new Error("invite_code_required");
  }

  return prisma.inviteCode.create({
    data: {
      codeHash: hashInviteCode(normalized),
      codePreview: previewInviteCode(normalized),
      label: params.label,
      planCode: params.planCode,
      productCode: params.productCode,
      brandCode: params.productCode === "beauty-industry" ? params.brandCode : undefined,
      maxUses: params.maxUses ?? 1,
      expiresAt: params.expiresAt,
      createdBy: params.createdBy
    }
  });
}

export async function validateInviteCode(
  inviteCode: string | undefined,
  planCode?: PlanCode,
  productCode?: ProductLoginCode,
): Promise<InviteValidationResult> {
  const normalized = normalizeInviteCode(inviteCode);
  // 2026-09-17 用户口径：取消兰琪邀请码制度，所有产品入口都不再强制邀请码。
  // 显式带了码仍按码校验（品牌归属 / 推荐归因 / 老链接兼容）；无码的产品入口直接放行。
  if (!normalized) {
    if (productCode) return { ok: true, source: "not_required" };
    return inviteRequired
      ? { ok: false, error: "invite_code_required" }
      : { ok: true, source: "disabled" };
  }

  if (env.DATA_MODE === "database") {
    const record = await prisma.inviteCode.findUnique({
      where: {
        codeHash: hashInviteCode(normalized)
      },
      include: { lanqiReferral: true },
    });

    if (record) {
      const now = new Date();
      if (!record.isActive) {
        return { ok: false, source: "database", error: "invite_code_not_found" };
      }
      if (record.expiresAt && record.expiresAt < now) {
        return { ok: false, source: "database", error: "invite_code_expired" };
      }
      if (record.usedCount >= record.maxUses) {
        return { ok: false, source: "database", error: "invite_code_exhausted" };
      }
      if (record.planCode && planCode && record.planCode !== planCode) {
        return { ok: false, source: "database", error: "invite_code_not_found" };
      }
      const recordProductCode = (record.productCode ?? (record.lanqiReferral ? "lanqi" : null)) as ProductLoginCode | null;
      if (productCode && recordProductCode !== productCode) {
        return { ok: false, source: "database", error: "invite_code_product_mismatch" };
      }
      return {
        ok: true,
        source: "database",
        inviteCodeId: record.id,
        planCode: record.planCode as PlanCode | null,
        productCode: recordProductCode,
        brandCode: recordProductCode === "beauty-industry" && record.brandCode === "lanqi" ? "lanqi" : null,
      };
    }
  }

  if (inviteCodes.includes(normalized) && !productCode) {
    return { ok: true, source: "env", planCode };
  }

  return { ok: false, error: "invite_code_not_found" };
}

export async function redeemInviteCode(params: {
  inviteCodeId?: string;
  tenantId: string;
  userId: string;
  planCode: PlanCode;
  metadata?: Record<string, unknown>;
}, transactionClient?: any): Promise<boolean> {
  if (!params.inviteCodeId) return false;

  if (!transactionClient) {
    return prisma.$transaction((tx: any) => redeemInviteCode(params, tx));
  }

  const record = await transactionClient.inviteCode.findUnique({
    where: {
      id: params.inviteCodeId
    }
  });
  const now = new Date();
  if (
    !record ||
    !record.isActive ||
    record.usedCount >= record.maxUses ||
    (record.expiresAt && record.expiresAt < now)
  ) {
    return false;
  }

  const reserved = await transactionClient.inviteCode.updateMany({
    where: {
      id: params.inviteCodeId,
      isActive: true,
      usedCount: record.usedCount
    },
    data: {
      usedCount: {
        increment: 1
      },
      lastUsedAt: now
    }
  });
  if (reserved.count !== 1) return false;

  await transactionClient.inviteCodeRedemption.create({
    data: {
      inviteCodeId: params.inviteCodeId,
      tenantId: params.tenantId,
      userId: params.userId,
      planCode: params.planCode,
      metadata: toPrismaJsonOptional(params.metadata)
    }
  });

  return true;
}
