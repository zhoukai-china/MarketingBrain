import type { Prisma } from "@baolu/db";
import { LANQI_BEAUTY_BRAND_PACKAGE } from "./brand-packages/lanqi.js";

export const BEAUTY_INDUSTRY_BRAND_CONFIG_VERSION = "beauty-industry-brand-v1" as const;
export const BEAUTY_INDUSTRY_BRAND_CODES = ["default", "lanqi"] as const;
export type BeautyIndustryBrandCode = (typeof BEAUTY_INDUSTRY_BRAND_CODES)[number];

export type BeautyIndustryBrandConfig = {
  version: typeof BEAUTY_INDUSTRY_BRAND_CONFIG_VERSION;
  brandCode: BeautyIndustryBrandCode;
  displayName: string;
  productSubtitle: "门店 AI 经营大脑";
  theme: {
    tokenName: "beauty-default" | "lanqi-orange";
    primary: string;
    primaryDark: string;
    primaryLight: string;
    surface: string;
    text: string;
    textOnPrimary: string;
  };
  logo: { kind: "text"; text: string };
  domain: { mode: "shared_current_entry"; hostname: null };
  pageCopy: { workspaceKicker: string; connectionLabel: string };
  knowledgePackRef: null;
  featureFlags: { customBrandKnowledge: false };
};

export type BeautyIndustryBrandKnowledgeContext = {
  status: "not_configured" | "awaiting_authorized_sources";
  authorized: false;
  content?: never;
};

export type BeautyIndustryBrandContext = {
  config: BeautyIndustryBrandConfig;
  knowledge: BeautyIndustryBrandKnowledgeContext;
};

export const BEAUTY_INDUSTRY_COMPOSITION_ORDER = [
  "platform_safety_tenant_evidence",
  "beauty_industry_compliance",
  "authorized_tenant_brand_knowledge",
  "fixed_capability_skill",
  "current_user_input"
] as const;

const DEFAULT_BRAND: BeautyIndustryBrandConfig = Object.freeze<BeautyIndustryBrandConfig>({
  version: BEAUTY_INDUSTRY_BRAND_CONFIG_VERSION,
  brandCode: "default",
  displayName: "美业智能体",
  productSubtitle: "门店 AI 经营大脑",
  theme: {
    tokenName: "beauty-default",
    primary: "#1F6B57",
    primaryDark: "#17352F",
    primaryLight: "#D9EEE7",
    surface: "#F7F5EF",
    text: "#17352F",
    textOnPrimary: "#FFFFFF"
  },
  logo: { kind: "text", text: "美" },
  domain: { mode: "shared_current_entry", hostname: null },
  pageCopy: { workspaceKicker: "门店经营工作台", connectionLabel: "美业专属连接" },
  knowledgePackRef: null,
  featureFlags: { customBrandKnowledge: false }
});

type BeautyIndustryBrandRegistry = Readonly<Partial<Record<BeautyIndustryBrandCode, BeautyIndustryBrandConfig>> & { default: BeautyIndustryBrandConfig }>;

export function createBeautyIndustryBrandRegistry(
  packages: readonly BeautyIndustryBrandConfig[] = [LANQI_BEAUTY_BRAND_PACKAGE]
): BeautyIndustryBrandRegistry {
  return Object.freeze(packages.reduce<Record<string, BeautyIndustryBrandConfig>>(
    (registry, item) => ({ ...registry, [item.brandCode]: item }),
    { default: DEFAULT_BRAND }
  ) as BeautyIndustryBrandRegistry);
}

const BRAND_CONFIGS = createBeautyIndustryBrandRegistry();

export function getBeautyIndustryBrandConfig(code: BeautyIndustryBrandCode): BeautyIndustryBrandConfig {
  return BRAND_CONFIGS[code] ?? BRAND_CONFIGS.default;
}

export function resolveBeautyIndustryBrandContext(
  profileData: unknown,
  registry: BeautyIndustryBrandRegistry = BRAND_CONFIGS
): BeautyIndustryBrandContext {
  const brandCode = readPersistedBrandCode(profileData);
  const config = registry[brandCode] ?? registry.default;
  return {
    config,
    knowledge: config.brandCode === "lanqi"
      ? { status: "awaiting_authorized_sources", authorized: false }
      : { status: "not_configured", authorized: false }
  };
}

export function toBeautyIndustryPublicBrand(context: BeautyIndustryBrandContext) {
  const { knowledgePackRef: _knowledgePackRef, ...publicConfig } = context.config;
  return { ...publicConfig, knowledge: { status: context.knowledge.status, authorized: context.knowledge.authorized } };
}

export function buildBeautyIndustryBrandCompositionReceipt(context: BeautyIndustryBrandContext) {
  if (context.knowledge.authorized || context.config.knowledgePackRef || context.config.featureFlags.customBrandKnowledge) {
    throw new Error("beauty_brand_knowledge_contract_not_ready");
  }
  return {
    order: BEAUTY_INDUSTRY_COMPOSITION_ORDER,
    brandCode: context.config.brandCode,
    brandConfigVersion: context.config.version,
    knowledgeApplied: false,
    knowledgeStatus: context.knowledge.status
  } as const;
}

export function assertNoBeautyIndustryBrandOverride(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  if ("brand" in record || "brandCode" in record || "knowledgePackRef" in record) {
    throw new Error("beauty_brand_override_forbidden");
  }
}

export async function assignBeautyIndustryBrandToTenant(params: {
  transactionClient: any;
  tenantId: string;
  brandCode?: string | null;
  source: "product_invite" | "controlled_acceptance";
}): Promise<BeautyIndustryBrandCode> {
  const brandCode = parseBrandCode(params.brandCode);
  if (brandCode === "default") return brandCode;
  const current = await params.transactionClient.tenantProfile.findUnique({ where: { tenantId: params.tenantId } });
  const data = jsonRecord(current?.data);
  const confirmedData = jsonRecord(current?.confirmedData ?? current?.data);
  const assignment = {
    brandCode,
    configVersion: BEAUTY_INDUSTRY_BRAND_CONFIG_VERSION,
    source: params.source,
    assignedAt: new Date().toISOString()
  };
  const nextData = { ...data, beautyIndustryBrand: assignment };
  const nextConfirmed = { ...confirmedData, beautyIndustryBrand: assignment };
  await params.transactionClient.tenantProfile.upsert({
    where: { tenantId: params.tenantId },
    create: { tenantId: params.tenantId, data: nextData as Prisma.InputJsonValue, confirmedData: nextConfirmed as Prisma.InputJsonValue },
    update: { data: nextData as Prisma.InputJsonValue, confirmedData: nextConfirmed as Prisma.InputJsonValue, version: { increment: 1 } }
  });
  return brandCode;
}

function readPersistedBrandCode(value: unknown): BeautyIndustryBrandCode {
  const record = jsonRecord(value);
  const assignment = jsonRecord(record.beautyIndustryBrand);
  return parseBrandCode(assignment.brandCode);
}

function parseBrandCode(value: unknown): BeautyIndustryBrandCode {
  return value === "lanqi" ? "lanqi" : "default";
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
