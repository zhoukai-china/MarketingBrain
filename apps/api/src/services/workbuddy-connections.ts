import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "@baolu/db";
import { isProductLoginCode, type ProductLoginCode } from "@baolu/shared";
import { env } from "../config/env.js";

export interface WorkbuddyConnection {
  id: string;
  label: string;
  tenantId: string;
  userId: string;
  agentId?: string;
  mode: "agent" | "marketplace";
  productCode?: ProductLoginCode;
  operatingEntityId?: string;
  scopes: string[];
  expiresAt?: Date;
  rateLimitPerMinute: number;
  source: "database" | "legacy_env";
}

interface LegacyWorkbuddyConnection extends WorkbuddyConnection {
  token: string;
  source: "legacy_env";
}

let cachedSource: string | undefined;
let cachedConnections: LegacyWorkbuddyConnection[] = [];

export async function resolveWorkbuddyConnection(authorization: string | undefined): Promise<WorkbuddyConnection | null> {
  if (env.WORKBUDDY_MCP_ENABLED !== "true") return null;
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return null;
  const databaseConnection = env.DATA_MODE === "database"
    ? await prisma.workbuddyMcpConnection.findUnique({
        where: { tokenHash: hashWorkbuddyToken(token) },
        select: {
          id: true,
          label: true,
          tenantId: true,
          userId: true,
          agentId: true,
          mode: true,
          status: true,
          productCode: true,
          operatingEntityId: true,
          scopes: true,
          expiresAt: true,
          revokedAt: true,
          rateLimitPerMinute: true
        }
      }).catch(() => null)
    : null;
  if (databaseConnection) {
    if (
      databaseConnection.status !== "active"
      || databaseConnection.revokedAt
      || isWorkbuddyConnectionExpired(databaseConnection.expiresAt)
      || (databaseConnection.productCode !== null && !isProductLoginCode(databaseConnection.productCode))
    ) return null;
    return {
      id: databaseConnection.id,
      label: databaseConnection.label,
      tenantId: databaseConnection.tenantId,
      userId: databaseConnection.userId,
      agentId: databaseConnection.agentId ?? undefined,
      mode: databaseConnection.mode === "marketplace" ? "marketplace" : "agent",
      productCode: isProductLoginCode(databaseConnection.productCode) ? databaseConnection.productCode : undefined,
      operatingEntityId: databaseConnection.operatingEntityId ?? undefined,
      scopes: normalizeWorkbuddyScopes(databaseConnection.scopes),
      expiresAt: databaseConnection.expiresAt ?? undefined,
      rateLimitPerMinute: normalizeRateLimit(databaseConnection.rateLimitPerMinute),
      source: "database"
    };
  }
  return getConnections().find((connection) => safeTokenEqual(connection.token, token)) ?? null;
}

export async function markWorkbuddyConnectionUsed(connection: WorkbuddyConnection): Promise<void> {
  if (connection.source !== "database") return;
  await prisma.workbuddyMcpConnection.updateMany({
    where: {
      id: connection.id,
      status: "active",
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
    },
    data: { lastUsedAt: new Date() }
  });
}

export function hashWorkbuddyToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function normalizeWorkbuddyScopes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      .map((item) => item.trim())
  )];
}

export function isWorkbuddyConnectionExpired(
  expiresAt: Date | string | null | undefined,
  now = new Date()
): boolean {
  if (!expiresAt) return false;
  const value = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  return !Number.isFinite(value.getTime()) || value.getTime() <= now.getTime();
}

export function getWorkbuddyConnectionIssues(): string[] {
  if (env.WORKBUDDY_MCP_ENABLED !== "true") return [];
  try {
    const connections = getConnections();
    const issues: string[] = [];
    connections.forEach((connection, index) => {
      if (connection.token.length < 32) issues.push(`WorkBuddy connection ${index + 1} token must be at least 32 characters`);
    });
    return issues;
  } catch (error) {
    return [error instanceof Error ? error.message : "WORKBUDDY_MCP_CONNECTIONS_JSON is invalid"];
  }
}

function getConnections(): LegacyWorkbuddyConnection[] {
  const source = env.WORKBUDDY_MCP_CONNECTIONS_JSON ?? "[]";
  if (source === cachedSource) return cachedConnections;
  const parsed = JSON.parse(source) as unknown;
  if (!Array.isArray(parsed)) throw new Error("WORKBUDDY_MCP_CONNECTIONS_JSON must be a JSON array");
  cachedConnections = parsed.map((value, index) => normalizeConnection(value, index));
  cachedSource = source;
  return cachedConnections;
}

function normalizeConnection(value: unknown, index: number): LegacyWorkbuddyConnection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`WorkBuddy connection ${index + 1} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const required = (key: string): string => {
    const item = record[key];
    if (typeof item !== "string" || !item.trim()) throw new Error(`WorkBuddy connection ${index + 1} requires ${key}`);
    return item.trim();
  };
  const token = required("token");
  return {
    id: `legacy_${hashWorkbuddyToken(token).slice(0, 24)}`,
    label: typeof record.label === "string" && record.label.trim() ? record.label.trim() : `connection-${index + 1}`,
    token,
    tenantId: required("tenantId"),
    userId: required("userId"),
    agentId: required("agentId"),
    mode: "agent",
    scopes: [],
    rateLimitPerMinute: 30,
    source: "legacy_env"
  };
}

function safeTokenEqual(expected: string, actual: string): boolean {
  const expectedHash = createHash("sha256").update(expected).digest();
  const actualHash = createHash("sha256").update(actual).digest();
  return timingSafeEqual(expectedHash, actualHash);
}

function normalizeRateLimit(value: number): number {
  return Number.isInteger(value) && value > 0 && value <= 600 ? value : 30;
}
