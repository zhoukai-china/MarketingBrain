import { createHash, randomBytes } from "node:crypto";

export function createDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function getDeviceToken(headers: Record<string, unknown>): string | undefined {
  const value =
    headers["x-sitong-device-token"] ??
    headers["x-Sitong-device-token"] ??
    headers["X-SITONG-DEVICE-TOKEN"];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
