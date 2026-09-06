import type { BeautyIndustryProfile, BeautyProfessionalOptions } from "./profile.js";

export const BEAUTY_XHS_TASK_SNAPSHOT_VERSION = "beauty-xhs-task-snapshot-v1" as const;

export type BeautyXhsTaskSnapshot = {
  version: typeof BEAUTY_XHS_TASK_SNAPSHOT_VERSION;
  themeAndPurpose: string;
  project: string;
  audience: string;
  city: string;
  storeFacts: string;
  contentAngle: string;
  tone: string;
  overallVisualRequirements: string;
  confirmedFacts: string;
  prohibitedContent: string;
};

export type BeautyXhsRequiredTaskField = "themeAndPurpose" | "project" | "audience";

export type BeautyXhsTaskReadiness = {
  ready: boolean;
  missingFields: BeautyXhsRequiredTaskField[];
};

const REQUIRED_TASK_FIELDS: readonly BeautyXhsRequiredTaskField[] = ["themeAndPurpose", "project", "audience"];

export function buildBeautyXhsTaskSnapshot(input: {
  question: string;
  profile: BeautyIndustryProfile | null;
  professionalOptions?: BeautyProfessionalOptions;
  confirmedFacts?: string;
}): BeautyXhsTaskSnapshot {
  const options = input.professionalOptions ?? {};
  return {
    version: BEAUTY_XHS_TASK_SNAPSHOT_VERSION,
    themeAndPurpose: clean(input.question, 20_000),
    project: clean(options.project, 200) || input.profile?.services.join("、") || "",
    audience: clean(options.audience, 500) || clean(input.profile?.targetCustomers, 500),
    city: clean(options.city, 80) || clean(input.profile?.city, 80),
    storeFacts: clean(options.storeFacts, 500) || clean(input.profile?.storeName, 120),
    contentAngle: clean(options.contentAngle, 300),
    tone: clean(options.tone, 200),
    overallVisualRequirements: clean(options.visualStyle, 500),
    confirmedFacts: clean(input.confirmedFacts, 2_000),
    prohibitedContent: clean(options.prohibitedContent, 500)
  };
}

export function assessBeautyXhsTaskReadiness(snapshot: BeautyXhsTaskSnapshot): BeautyXhsTaskReadiness {
  const missingFields = REQUIRED_TASK_FIELDS.filter((field) => snapshot[field].trim().length < (field === "themeAndPurpose" ? 6 : 2));
  return { ready: missingFields.length === 0, missingFields };
}

export function assertBeautyXhsTaskReady(snapshot: BeautyXhsTaskSnapshot): void {
  const readiness = assessBeautyXhsTaskReadiness(snapshot);
  if (!readiness.ready) throw new Error(`beauty_xhs_fields_required:${readiness.missingFields.join(",")}`);
}

export function buildBeautyXhsTaskSnapshotDirective(snapshot: BeautyXhsTaskSnapshot): string {
  return `【本次图文任务快照｜仅本次，不写入经营档案】\n${JSON.stringify(snapshot)}`;
}

export function readBeautyXhsTaskSnapshot(input: string | null | undefined): BeautyXhsTaskSnapshot | undefined {
  const match = input?.match(/【本次图文任务快照｜仅本次，不写入经营档案】\n(\{[^\n]+\})/u);
  if (!match) return undefined;
  try {
    const value = JSON.parse(match[1]!) as Record<string, unknown>;
    if (value.version !== BEAUTY_XHS_TASK_SNAPSHOT_VERSION || typeof value.themeAndPurpose !== "string") return undefined;
    return {
      version: BEAUTY_XHS_TASK_SNAPSHOT_VERSION,
      themeAndPurpose: clean(value.themeAndPurpose, 20_000),
      project: clean(value.project, 200),
      audience: clean(value.audience, 500),
      city: clean(value.city, 80),
      storeFacts: clean(value.storeFacts, 500),
      contentAngle: clean(value.contentAngle, 300),
      tone: clean(value.tone, 200),
      overallVisualRequirements: clean(value.overallVisualRequirements, 500),
      confirmedFacts: clean(value.confirmedFacts, 2_000),
      prohibitedContent: clean(value.prohibitedContent, 500)
    };
  } catch {
    return undefined;
  }
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
