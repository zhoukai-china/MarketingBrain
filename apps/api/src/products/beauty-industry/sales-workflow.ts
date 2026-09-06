import type { BeautyProfessionalOptions, BeautyRunMode } from "./profile.js";

export const BEAUTY_SALES_WORKFLOW_VERSION = "beauty-sales-two-stage-v1" as const;

export const BEAUTY_SALES_PROFESSIONAL_REQUIRED_FIELDS = [
  "project",
  "priceBoundary",
  "customerConcern",
  "communicationStage",
  "allowedNextAction"
] as const;

export type BeautySalesProfessionalField = (typeof BEAUTY_SALES_PROFESSIONAL_REQUIRED_FIELDS)[number];

export function inspectBeautySalesProfessionalInput(
  mode: BeautyRunMode,
  options: BeautyProfessionalOptions | undefined
): BeautySalesProfessionalField[] {
  if (mode !== "professional") return [];
  return BEAUTY_SALES_PROFESSIONAL_REQUIRED_FIELDS.filter((field) => !options?.[field]?.trim());
}

export function assertBeautySalesProfessionalInput(
  mode: BeautyRunMode,
  options: BeautyProfessionalOptions | undefined
): void {
  const missing = inspectBeautySalesProfessionalInput(mode, options);
  if (missing.length > 0) throw new Error(`beauty_sales_professional_fields_required:${missing.join(",")}`);
}
