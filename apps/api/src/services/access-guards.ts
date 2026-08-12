import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";

export async function requireAdminToken(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!env.ADMIN_TOKEN && env.NODE_ENV !== "production") return;

  const token = getHeaderValue(request.headers["x-sitong-admin-token"]);
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
    await reply.code(401).send({
      error: "admin_token_required",
      message: "Admin token is required"
    });
  }
}

export async function requireOpsToken(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!env.OPS_TOKEN && env.NODE_ENV !== "production") return;

  const token = getHeaderValue(request.headers["x-sitong-ops-token"]);
  if (!env.OPS_TOKEN || token !== env.OPS_TOKEN) {
    await reply.code(401).send({
      error: "ops_token_required",
      message: "Ops token is required"
    });
  }
}

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
