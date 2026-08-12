import { createHash } from "node:crypto";
import { prisma } from "@baolu/db";
import type { PlanCode } from "@baolu/shared";
import { env, inviteCodes, inviteRequired } from "../config/env.js";
import { toPrismaJsonOptional } from "./prisma-json.js";

export interface InviteValidationResult {
  ok: boolean;
  source?: "database" | "env" | "disabled";
  inviteCodeId?: string;
  planCode?: PlanCode | null;
  error?: "invite_code_required" | "invite_code_not_found" | "invite_code_expired" | "invite_code_exhausted";
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
      maxUses: params.maxUses ?? 1,
      expiresAt: params.expiresAt,
      createdBy: params.createdBy
    }
  });
}

export async function validateInviteCode(
  inviteCode: string | undefined,
  planCode?: PlanCode
): Promise<InviteValidationResult> {
  if (!inviteRequired) {
    return { ok: true, source: "disabled" };
  }

  const normalized = normalizeInviteCode(inviteCode);
  if (!normalized) {
    return { ok: false, error: "invite_code_required" };
  }

  if (env.DATA_MODE === "database") {
    const record = await prisma.inviteCode.findUnique({
      where: {
        codeHash: hashInviteCode(normalized)
      }
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
      return {
        ok: true,
        source: "database",
        inviteCodeId: record.id,
        planCode: record.planCode as PlanCode | null
      };
    }
  }

  if (inviteCodes.includes(normalized)) {
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
