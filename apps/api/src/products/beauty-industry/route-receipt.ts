import { createHash } from "node:crypto";
import type { LlmProvider } from "@baolu/agent";
import type { SkillId } from "@baolu/shared";
import type { BeautyIndustryScope } from "./workflows.js";
import { BEAUTY_OUTPUT_CONTRACT_VERSION } from "./output-contract.js";

export const BEAUTY_ROUTE_RECEIPT_VERSION = "beauty-route-receipt-v1" as const;

export interface BeautyRouteReceipt {
  version: typeof BEAUTY_ROUTE_RECEIPT_VERSION;
  product: "beauty-industry";
  channel: "web" | "mcp";
  toolName: string;
  capabilityId: string;
  scope: BeautyIndustryScope;
  skillId: SkillId;
  skillVersion: string;
  constraintVersion: string;
  model: string;
  provider: string;
  parser: typeof BEAUTY_OUTPUT_CONTRACT_VERSION;
  fallbackUsed: boolean;
  requestId: string;
  tenantHash: string;
}

export function buildBeautyRouteReceipt(params: {
  channel: "web" | "mcp";
  toolName: string;
  capabilityId: string;
  scope: BeautyIndustryScope;
  skillChain: Array<{ skillId: SkillId; version: string }>;
  provider: LlmProvider;
  parser: typeof BEAUTY_OUTPUT_CONTRACT_VERSION;
  fallbackUsed: boolean;
  requestId: string;
  tenantId: string;
}): BeautyRouteReceipt {
  const primary = params.skillChain[0];
  if (!primary) throw new Error("beauty_route_receipt_skill_chain_missing");
  const providerWithModel = params.provider as LlmProvider & { getModel?: () => string };
  return {
    version: BEAUTY_ROUTE_RECEIPT_VERSION,
    product: "beauty-industry",
    channel: params.channel,
    toolName: params.toolName,
    capabilityId: params.capabilityId,
    scope: params.scope,
    skillId: primary.skillId,
    skillVersion: primary.version,
    constraintVersion: params.skillChain.slice(1).map((item) => `${item.skillId}@${item.version}`).join("+") || "none",
    model: providerWithModel.getModel?.().trim() || "unknown",
    provider: params.provider.name,
    parser: params.parser,
    fallbackUsed: params.fallbackUsed,
    requestId: fingerprint(params.requestId),
    tenantHash: fingerprint(params.tenantId)
  };
}

export function beautyRouteReceiptQualityFlags(receipt: BeautyRouteReceipt): string[] {
  return [
    `route_receipt:${receipt.version}`,
    `route_product:${receipt.product}`,
    `route_channel:${receipt.channel}`,
    `route_tool:${receipt.toolName}`,
    `route_scope:${receipt.scope}`,
    `route_capability:${receipt.capabilityId}`,
    `route_skill:${receipt.skillId}@${receipt.skillVersion}`,
    `route_constraints:${receipt.constraintVersion}`,
    `route_model:${receipt.provider}/${receipt.model}`,
    `route_parser:${receipt.parser}`,
    `route_fallback:${receipt.fallbackUsed ? "yes" : "no"}`,
    `route_request:${receipt.requestId}`,
    `route_tenant:${receipt.tenantHash}`
  ];
}

function fingerprint(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}
