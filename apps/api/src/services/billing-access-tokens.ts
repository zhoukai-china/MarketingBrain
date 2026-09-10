import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@baolu/db";

export interface ResolvedBillingAccessToken {
  id: string;
  tenantId: string;
  userId: string;
  label: string | null;
  tokenPrefix: string;
  status: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export function createBillingAccessToken(): string {
  return `sitong_bat_${randomBytes(32).toString("base64url")}`;
}

export function hashBillingAccessToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function maskBillingAccessToken(tokenPrefix: string): string {
  return `${tokenPrefix}…`;
}

export function isBillingAccessTokenExpired(
  expiresAt: Date | string | null | undefined,
  now = new Date()
): boolean {
  if (!expiresAt) return false;
  const value = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  return !Number.isFinite(value.getTime()) || value.getTime() <= now.getTime();
}

export async function resolveBillingAccessToken(
  authorization: string | undefined
): Promise<ResolvedBillingAccessToken | null> {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return null;

  const row = await prisma.billingAccessToken
    .findUnique({
      where: { tokenHash: hashBillingAccessToken(token) },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        label: true,
        tokenPrefix: true,
        status: true,
        expiresAt: true,
        revokedAt: true
      }
    })
    .catch(() => null);

  if (!row) return null;
  if (
    row.status !== "active"
    || row.revokedAt
    || isBillingAccessTokenExpired(row.expiresAt)
  ) return null;

  return row;
}

export async function markBillingAccessTokenUsed(id: string): Promise<void> {
  await prisma.billingAccessToken.updateMany({
    where: {
      id,
      status: "active",
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
    },
    data: { lastUsedAt: new Date() }
  });
}
