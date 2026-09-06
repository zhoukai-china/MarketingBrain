import { randomBytes } from "node:crypto";
import { hashInviteCode, previewInviteCode } from "./invite-codes.js";

export type LanqiReferralStatus = "pending" | "claimed" | "revoked";

export interface LanqiReferralRecord {
  id: string;
  inviterTenantId: string;
  inviteCodeId: string;
  referredTenantId?: string | null;
  status: LanqiReferralStatus;
  label?: string | null;
  createdAt: Date;
  claimedAt?: Date | null;
  revokedAt?: Date | null;
}

export interface PublicLanqiReferral {
  id: string;
  label?: string;
  status: LanqiReferralStatus;
  createdAt: string;
  claimedAt?: string;
  revokedAt?: string;
}

export function generateLanqiReferralCode(): string {
  return `lq-${randomBytes(12).toString("base64url").toLowerCase()}`;
}

export function buildLanqiReferralInvite(code: string, label?: string): {
  invite: { codeHash: string; codePreview: string; label?: string; maxUses: number };
  plainCode: string;
} {
  return {
    plainCode: code,
    invite: {
      codeHash: hashInviteCode(code),
      codePreview: previewInviteCode(code),
      label: label?.trim() || undefined,
      maxUses: 1,
    },
  };
}

/** Keep referral data intentionally non-identifying for the referrer. */
export function publicLanqiReferral(record: LanqiReferralRecord): PublicLanqiReferral {
  return {
    id: record.id,
    ...(record.label?.trim() ? { label: record.label.trim() } : {}),
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    ...(record.claimedAt ? { claimedAt: record.claimedAt.toISOString() } : {}),
    ...(record.revokedAt ? { revokedAt: record.revokedAt.toISOString() } : {}),
  };
}

export async function claimLanqiReferral(params: {
  inviteCodeId?: string;
  referredTenantId: string;
}, transactionClient: any): Promise<"not_lanqi_referral" | "claimed" | "already_claimed" | "self_referral"> {
  if (!params.inviteCodeId) return "not_lanqi_referral";
  const referral = await transactionClient.lanqiReferral.findUnique({
    where: { inviteCodeId: params.inviteCodeId },
  });
  if (!referral) return "not_lanqi_referral";
  if (referral.inviterTenantId === params.referredTenantId) return "self_referral";
  if (referral.status !== "pending" || referral.referredTenantId) return "already_claimed";

  const claimed = await transactionClient.lanqiReferral.updateMany({
    where: {
      id: referral.id,
      status: "pending",
      referredTenantId: null,
    },
    data: {
      status: "claimed",
      referredTenantId: params.referredTenantId,
      claimedAt: new Date(),
    },
  });
  return claimed.count === 1 ? "claimed" : "already_claimed";
}
