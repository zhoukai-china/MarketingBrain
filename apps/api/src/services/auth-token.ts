import { createHmac, timingSafeEqual } from "node:crypto";
import type { PlanCode } from "@baolu/shared";
import { env } from "../config/env.js";

export interface SessionPayload {
  tenantId: string;
  userId: string;
  planCode?: PlanCode;
  iat: number;
  exp: number;
}

export interface OnboardingPayload {
  purpose: "onboarding";
  userId: string;
  iat: number;
  exp: number;
}

function getSecret(): string {
  if (env.JWT_SECRET) return env.JWT_SECRET;
  if (env.NODE_ENV === "production" || env.DATA_MODE === "database") {
    throw new Error("JWT_SECRET is required outside demo development");
  }
  return "Sitong-dev-secret";
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function sign(data: string): string {
  return createHmac("sha256", getSecret()).update(data).digest("base64url");
}

export function createSessionToken(params: {
  tenantId: string;
  userId: string;
  planCode?: PlanCode;
  ttlSeconds?: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    tenantId: params.tenantId,
    userId: params.userId,
    planCode: params.planCode,
    iat: now,
    exp: now + (params.ttlSeconds ?? 60 * 60 * 24 * 30)
  };
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(`${header}.${body}`);
  return `${header}.${body}.${signature}`;
}

export function createOnboardingToken(params: {
  userId: string;
  ttlSeconds?: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: OnboardingPayload = {
    purpose: "onboarding",
    userId: params.userId,
    iat: now,
    exp: now + (params.ttlSeconds ?? 60 * 30)
  };
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(`${header}.${body}`);
  return `${header}.${body}.${signature}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, body, signature] = parts;
  const expected = sign(`${header}.${body}`);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
  if (!payload.tenantId || !payload.userId || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}

export function verifyOnboardingToken(token: string): OnboardingPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, body, signature] = parts;
  const expected = sign(`${header}.${body}`);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OnboardingPayload;
  if (
    payload.purpose !== "onboarding" ||
    !payload.userId ||
    payload.exp < Math.floor(Date.now() / 1000)
  ) {
    return null;
  }
  return payload;
}

export function getBearerToken(headers: Record<string, unknown>): string | undefined {
  const authorization = headers.authorization;
  if (!authorization || typeof authorization !== "string") return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1];
}
