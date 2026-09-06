import assert from "node:assert/strict";
import {
  resolveLanqiKnowledgeAccess,
  validateLanqiKnowledgeVersion,
  type LanqiKnowledgeVersionPolicy,
} from "../apps/api/src/services/lanqi-knowledge.ts";

const now = new Date("2026-08-13T08:00:00.000Z");
const core: LanqiKnowledgeVersionPolicy = {
  knowledgeId: "lq-service-pricing",
  version: "2026.08.1",
  ownerTenantId: "lanqi-headquarters",
  tier: "k1_authorized_core",
  status: "active",
  sourceRef: "lanqi-controlled-source-001",
  reviewer: "lanqi-business-reviewer",
  approvedAt: "2026-08-01T00:00:00.000Z",
  effectiveFrom: "2026-08-01T00:00:00.000Z",
  allowedTenantTypes: ["local_business"],
  allowedRoles: ["owner", "manager"],
  applicability: { region: "试点区域", project: "皮肤管理", storeType: "加盟店" },
};

assert.deepEqual(validateLanqiKnowledgeVersion(core), []);
assert.deepEqual(
  resolveLanqiKnowledgeAccess(core, {
    tenantId: "franchisee-a",
    tenantType: "local_business",
    role: "owner",
    authorizedKnowledgeIds: ["lq-service-pricing"],
    now,
  }),
  { allowed: true, reason: "allowed" },
);

assert.equal(
  resolveLanqiKnowledgeAccess(core, {
    tenantId: "unlicensed-store",
    tenantType: "local_business",
    role: "owner",
    now,
  }).reason,
  "missing_authorization",
);
assert.equal(
  resolveLanqiKnowledgeAccess(core, {
    tenantId: "franchisee-a",
    tenantType: "local_business",
    role: "staff",
    authorizedKnowledgeIds: ["lq-service-pricing"],
    now,
  }).reason,
  "role_not_allowed",
);

const incomplete = { ...core, sourceRef: undefined, approvedAt: undefined, applicability: null };
assert.deepEqual(validateLanqiKnowledgeVersion(incomplete).sort(), [
  "applicability_required_for_core",
  "approval_required_for_active",
  "source_ref_required_for_active",
]);
assert.equal(
  resolveLanqiKnowledgeAccess({ ...core, expiresAt: "2026-08-13T07:59:59.000Z" }, {
    tenantId: "franchisee-a", tenantType: "local_business", role: "owner", authorizedKnowledgeIds: ["lq-service-pricing"], now,
  }).reason,
  "version_expired",
);

const headquarters = { ...core, tier: "k2_headquarters_private" as const };
assert.equal(resolveLanqiKnowledgeAccess(headquarters, {
  tenantId: "franchisee-a", tenantType: "local_business", role: "owner", now,
}).reason, "headquarters_only");

const storePrivate = { ...core, ownerTenantId: "store-a", tier: "k3_store_private" as const };
assert.equal(resolveLanqiKnowledgeAccess(storePrivate, {
  tenantId: "store-b", tenantType: "local_business", role: "owner", now,
}).reason, "store_private");

const temporary = { ...core, ownerTenantId: "store-a", tier: "k4_session_temporary" as const, sessionId: "session-a" };
assert.equal(resolveLanqiKnowledgeAccess(temporary, {
  tenantId: "store-a", tenantType: "local_business", role: "owner", sessionId: "session-b", now,
}).reason, "session_mismatch");

console.log("Lanqi knowledge foundation smoke passed.");
