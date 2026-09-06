export type LanqiKnowledgeTier = "k1_authorized_core" | "k2_headquarters_private" | "k3_store_private" | "k4_session_temporary";
export type LanqiKnowledgeStatus = "draft" | "active" | "retired";

export interface LanqiKnowledgeVersionPolicy {
  knowledgeId: string;
  version: string;
  ownerTenantId: string;
  tier: LanqiKnowledgeTier;
  status: LanqiKnowledgeStatus;
  sourceRef?: string | null;
  reviewer?: string | null;
  approvedAt?: Date | string | null;
  effectiveFrom?: Date | string | null;
  expiresAt?: Date | string | null;
  allowedTenantIds?: string[];
  allowedTenantTypes?: string[];
  allowedRoles?: string[];
  applicability?: Record<string, unknown> | null;
  sessionId?: string | null;
}

export interface LanqiKnowledgeAccessContext {
  tenantId: string;
  tenantType: string;
  role: string;
  sessionId?: string | null;
  authorizedKnowledgeIds?: string[];
  authorizedTiers?: LanqiKnowledgeTier[];
  now?: Date;
}

export type LanqiKnowledgeAccessReason =
  | "allowed"
  | "version_not_active"
  | "not_yet_effective"
  | "version_expired"
  | "missing_authorization"
  | "tenant_not_allowed"
  | "tenant_type_not_allowed"
  | "role_not_allowed"
  | "headquarters_only"
  | "store_private"
  | "session_mismatch";

export interface LanqiKnowledgeAccessDecision {
  allowed: boolean;
  reason: LanqiKnowledgeAccessReason;
}

const KNOWLEDGE_ID = /^lq-[a-z0-9][a-z0-9-]{1,79}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hasValue(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
}

function hasApplicability(policy: LanqiKnowledgeVersionPolicy): boolean {
  return Boolean(policy.applicability && Object.keys(policy.applicability).length > 0);
}

/**
 * Validates data before it may be persisted as an active Lanqi knowledge
 * version. It deliberately fails closed: a draft can be incomplete, but an
 * active version must carry the evidence that lets a later Agent answer cite
 * its source, scope and approval instead of inventing them.
 */
export function validateLanqiKnowledgeVersion(policy: LanqiKnowledgeVersionPolicy): string[] {
  const issues: string[] = [];
  if (!KNOWLEDGE_ID.test(policy.knowledgeId)) issues.push("knowledge_id_invalid");
  if (!VERSION.test(policy.version)) issues.push("version_invalid");
  if (!hasValue(policy.ownerTenantId)) issues.push("owner_tenant_required");

  const effectiveFrom = asDate(policy.effectiveFrom);
  const expiresAt = asDate(policy.expiresAt);
  if (policy.effectiveFrom && !effectiveFrom) issues.push("effective_from_invalid");
  if (policy.expiresAt && !expiresAt) issues.push("expires_at_invalid");
  if (effectiveFrom && expiresAt && expiresAt <= effectiveFrom) issues.push("effective_window_invalid");

  if (policy.tier === "k4_session_temporary" && !hasValue(policy.sessionId)) issues.push("session_id_required");
  if (policy.tier !== "k4_session_temporary" && hasValue(policy.sessionId)) issues.push("session_id_not_allowed");

  if (policy.status !== "active") return issues;
  if (!hasValue(policy.sourceRef)) issues.push("source_ref_required_for_active");
  if (!hasValue(policy.reviewer)) issues.push("reviewer_required_for_active");
  if (!asDate(policy.approvedAt)) issues.push("approval_required_for_active");
  if (!effectiveFrom) issues.push("effective_from_required_for_active");

  if (policy.tier === "k1_authorized_core") {
    if (!hasApplicability(policy)) issues.push("applicability_required_for_core");
    if (!policy.allowedTenantIds?.length && !policy.allowedTenantTypes?.length) {
      issues.push("audience_required_for_core");
    }
    if (!policy.allowedRoles?.length) issues.push("roles_required_for_core");
  }
  return issues;
}

/**
 * Resolves access using only server-trusted identity fields. Callers must not
 * derive tenant, role or authorization from model output or browser input.
 */
export function resolveLanqiKnowledgeAccess(
  policy: LanqiKnowledgeVersionPolicy,
  context: LanqiKnowledgeAccessContext,
): LanqiKnowledgeAccessDecision {
  const now = context.now ?? new Date();
  if (policy.status !== "active") return { allowed: false, reason: "version_not_active" };
  const effectiveFrom = asDate(policy.effectiveFrom);
  if (!effectiveFrom || now < effectiveFrom) return { allowed: false, reason: "not_yet_effective" };
  const expiresAt = asDate(policy.expiresAt);
  if (expiresAt && now >= expiresAt) return { allowed: false, reason: "version_expired" };

  if (policy.tier === "k2_headquarters_private") {
    return context.tenantId === policy.ownerTenantId
      ? { allowed: true, reason: "allowed" }
      : { allowed: false, reason: "headquarters_only" };
  }
  if (policy.tier === "k3_store_private") {
    return context.tenantId === policy.ownerTenantId
      ? { allowed: true, reason: "allowed" }
      : { allowed: false, reason: "store_private" };
  }
  if (policy.tier === "k4_session_temporary") {
    return context.tenantId === policy.ownerTenantId && context.sessionId === policy.sessionId
      ? { allowed: true, reason: "allowed" }
      : { allowed: false, reason: "session_mismatch" };
  }

  const granted = context.authorizedKnowledgeIds?.includes(policy.knowledgeId)
    || context.authorizedTiers?.includes("k1_authorized_core");
  if (!granted) return { allowed: false, reason: "missing_authorization" };
  if (policy.allowedTenantIds?.length && !policy.allowedTenantIds.includes(context.tenantId)) {
    return { allowed: false, reason: "tenant_not_allowed" };
  }
  if (policy.allowedTenantTypes?.length && !policy.allowedTenantTypes.includes(context.tenantType)) {
    return { allowed: false, reason: "tenant_type_not_allowed" };
  }
  if (policy.allowedRoles?.length && !policy.allowedRoles.includes(context.role)) {
    return { allowed: false, reason: "role_not_allowed" };
  }
  return { allowed: true, reason: "allowed" };
}
