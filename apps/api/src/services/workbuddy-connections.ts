import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "@baolu/db";
import { env } from "../config/env.js";

export interface WorkbuddyConnection {
  label: string;
  token: string;
  tenantId: string;
  userId: string;
  agentId: string;
}

let cachedSource: string | undefined;
let cachedConnections: WorkbuddyConnection[] = [];

export async function resolveWorkbuddyConnection(authorization: string | undefined): Promise<WorkbuddyConnection | null> {
  if (env.WORKBUDDY_MCP_ENABLED !== "true") return null;
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return null;
  const databaseConnection = env.DATA_MODE === "database"
    ? await prisma.workbuddyMcpConnection.findUnique({
        where: { tokenHash: hashWorkbuddyToken(token) },
        select: { id: true, label: true, tenantId: true, userId: true, agentId: true, status: true }
      }).catch(() => null)
    : null;
  if (databaseConnection?.status === "active") {
    void prisma.workbuddyMcpConnection.update({
      where: { id: databaseConnection.id },
      data: { lastUsedAt: new Date() }
    }).catch(() => undefined);
    return { ...databaseConnection, token };
  }
  return getConnections().find((connection) => safeTokenEqual(connection.token, token)) ?? null;
}

export function hashWorkbuddyToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
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

function getConnections(): WorkbuddyConnection[] {
  const source = env.WORKBUDDY_MCP_CONNECTIONS_JSON ?? "[]";
  if (source === cachedSource) return cachedConnections;
  const parsed = JSON.parse(source) as unknown;
  if (!Array.isArray(parsed)) throw new Error("WORKBUDDY_MCP_CONNECTIONS_JSON must be a JSON array");
  cachedConnections = parsed.map((value, index) => normalizeConnection(value, index));
  cachedSource = source;
  return cachedConnections;
}

function normalizeConnection(value: unknown, index: number): WorkbuddyConnection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`WorkBuddy connection ${index + 1} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const required = (key: string): string => {
    const item = record[key];
    if (typeof item !== "string" || !item.trim()) throw new Error(`WorkBuddy connection ${index + 1} requires ${key}`);
    return item.trim();
  };
  return {
    label: typeof record.label === "string" && record.label.trim() ? record.label.trim() : `connection-${index + 1}`,
    token: required("token"),
    tenantId: required("tenantId"),
    userId: required("userId"),
    agentId: required("agentId")
  };
}

function safeTokenEqual(expected: string, actual: string): boolean {
  const expectedHash = createHash("sha256").update(expected).digest();
  const actualHash = createHash("sha256").update(actual).digest();
  return timingSafeEqual(expectedHash, actualHash);
}
