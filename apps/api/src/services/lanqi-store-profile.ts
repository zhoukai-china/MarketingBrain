import type { UserRole } from "@baolu/shared";

export const LANQI_STORE_PROFILE_FIELDS = [
  "storeName",
  "city",
  "businessArea",
  "storeType",
  "mainServices",
  "teamSize",
  "monthlyRevenueRange",
  "monthlyNewCustomersRange",
  "repeatPurchaseRateRange",
  "customerProfile",
  "primaryChannels",
  "currentChallenges",
  "notes",
] as const;

export type LanqiStoreProfileField = typeof LANQI_STORE_PROFILE_FIELDS[number];
export type LanqiStoreProfileFacts = Partial<Record<LanqiStoreProfileField, string | string[]>>;

export interface LanqiStoreProfilePayload {
  confirmedFacts: LanqiStoreProfileFacts;
  estimatedFacts: LanqiStoreProfileFacts;
  needsInput: LanqiStoreProfileField[];
}

export interface LanqiStoreProfileView extends LanqiStoreProfilePayload {
  updatedAt: string | null;
  canEdit: boolean;
}

const demoProfiles = new Map<string, LanqiStoreProfilePayload & { updatedAt: Date }>();

export function getDemoLanqiStoreProfile(tenantId: string): (LanqiStoreProfilePayload & { updatedAt: Date }) | undefined {
  return demoProfiles.get(tenantId);
}

export function saveDemoLanqiStoreProfile(tenantId: string, payload: LanqiStoreProfilePayload): LanqiStoreProfilePayload & { updatedAt: Date } {
  const profile = { ...payload, updatedAt: new Date() };
  demoProfiles.set(tenantId, profile);
  return profile;
}

export function canEditLanqiStoreProfile(role: UserRole): boolean {
  return role === "owner" || role === "admin";
}

export function validateLanqiStoreProfilePayload(payload: LanqiStoreProfilePayload): string[] {
  const confirmed = new Set(Object.keys(payload.confirmedFacts));
  const estimated = new Set(Object.keys(payload.estimatedFacts));
  const errors: string[] = [];

  for (const field of confirmed) {
    if (estimated.has(field)) errors.push(`fact_source_conflict:${field}`);
  }
  for (const field of payload.needsInput) {
    if (confirmed.has(field) || estimated.has(field)) errors.push(`needs_input_conflict:${field}`);
  }
  return errors;
}

export function emptyLanqiStoreProfile(role: UserRole): LanqiStoreProfileView {
  return {
    confirmedFacts: {},
    estimatedFacts: {},
    needsInput: [],
    updatedAt: null,
    canEdit: canEditLanqiStoreProfile(role),
  };
}

export function toLanqiStoreProfileView(record: {
  confirmedFacts: unknown;
  estimatedFacts: unknown;
  needsInput: unknown;
  updatedAt: Date;
}, role: UserRole): LanqiStoreProfileView {
  return {
    confirmedFacts: normalizeFacts(record.confirmedFacts),
    estimatedFacts: normalizeFacts(record.estimatedFacts),
    needsInput: normalizeNeedsInput(record.needsInput),
    updatedAt: record.updatedAt.toISOString(),
    canEdit: canEditLanqiStoreProfile(role),
  };
}

function normalizeFacts(value: unknown): LanqiStoreProfileFacts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: LanqiStoreProfileFacts = {};
  for (const field of LANQI_STORE_PROFILE_FIELDS) {
    const candidate = (value as Record<string, unknown>)[field];
    if (typeof candidate === "string") result[field] = candidate;
    if (Array.isArray(candidate) && candidate.every(item => typeof item === "string")) result[field] = candidate;
  }
  return result;
}

function normalizeNeedsInput(value: unknown): LanqiStoreProfileField[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is LanqiStoreProfileField =>
    typeof item === "string" && LANQI_STORE_PROFILE_FIELDS.includes(item as LanqiStoreProfileField)
  );
}
