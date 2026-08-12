import type { AgentRequest, TenantProfileSnapshot } from "@baolu/agent";
import type { PlanCode, UserRole } from "@baolu/shared";

export interface DemoAuthContext {
  tenantId: string;
  userId: string;
  role: UserRole;
  planCode: PlanCode;
  profile: TenantProfileSnapshot;
  source?: "demo" | "database";
  creditBalance?: number;
}

export function getDemoContext(headers: Record<string, unknown>): DemoAuthContext {
  const planHeader = String(readHeader(headers, "x-sitong-plan") ?? "local_standard");
  const planCode = normalizePlanCode(planHeader);
  const tenantType = planCode.startsWith("chain") ? "chain_brand" : planCode.startsWith("ip") ? "personal_ip" : "local_business";
  const savedProfile = readSavedProfile(readHeader(headers, "x-sitong-profile"));
  return {
    tenantId: String(readHeader(headers, "x-sitong-tenant-id") ?? "demo-tenant"),
    userId: String(readHeader(headers, "x-sitong-user-id") ?? "demo-user"),
    role: "owner",
    planCode,
    source: "demo",
    creditBalance: 300,
    profile: {
      tenantId: String(readHeader(headers, "x-sitong-tenant-id") ?? "demo-tenant"),
      tenantName: tenantType === "chain_brand" ? "演示连锁品牌" : "演示本地商家",
      tenantType,
      industry: savedProfile.industry ?? String(readHeader(headers, "x-sitong-industry") ?? "本地生活服务"),
      city: savedProfile.city ?? String(readHeader(headers, "x-sitong-city") ?? "杭州"),
      data: {
        stage: "v2-mvp",
        note: "正式版会从 tenant_profiles 表读取画像",
        ...(savedProfile.offer ? { offer: savedProfile.offer } : {}),
        ...(savedProfile.customer ? { customer: savedProfile.customer } : {})
      }
    }
  };
}

function readSavedProfile(value: unknown): Partial<Record<"industry" | "city" | "offer" | "customer", string>> {
  if (!value) return {};
  try {
    const raw = decodeURIComponent(String(value));
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      ["industry", "city", "offer", "customer"]
        .map((key) => [key, typeof parsed[key] === "string" ? parsed[key].trim() : ""])
        .filter(([, item]) => Boolean(item))
    );
  } catch {
    return {};
  }
}

function readHeader(headers: Record<string, unknown>, name: string): unknown {
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
}

function normalizePlanCode(value: string): PlanCode {
  if (
    value === "local_standard" ||
    value === "local_premium" ||
    value === "ip_standard" ||
    value === "ip_premium" ||
    value === "chain_standard" ||
    value === "chain_premium"
  ) {
    return value;
  }
  return "local_standard";
}

export function toAgentRequest(params: {
  auth: DemoAuthContext;
  input: string;
  routingInput?: AgentRequest["routingInput"];
  requestedSkillId?: AgentRequest["requestedSkillId"];
  capabilityId?: AgentRequest["capabilityId"];
  capabilityLocked?: AgentRequest["capabilityLocked"];
  deliveryPolicy?: AgentRequest["deliveryPolicy"];
  skillPrompt?: AgentRequest["skillPrompt"];
  skillVersionOverride?: AgentRequest["skillVersionOverride"];
  history?: AgentRequest["history"];
  analysisMode?: AgentRequest["analysisMode"];
  channel: AgentRequest["channel"];
}): AgentRequest {
  return {
    tenantId: params.auth.tenantId,
    userId: params.auth.userId,
    role: params.auth.role,
    planCode: params.auth.planCode,
    input: params.input,
    routingInput: params.routingInput,
    requestedSkillId: params.requestedSkillId,
    capabilityId: params.capabilityId,
    capabilityLocked: params.capabilityLocked,
    deliveryPolicy: params.deliveryPolicy,
    skillPrompt: params.skillPrompt,
    skillVersionOverride: params.skillVersionOverride,
    history: params.history,
    analysisMode: params.analysisMode,
    tenantProfile: params.auth.profile,
    channel: params.channel
  };
}
