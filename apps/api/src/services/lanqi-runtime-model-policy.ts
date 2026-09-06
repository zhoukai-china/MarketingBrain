import type { LlmProvider } from "@baolu/agent";
import { env } from "../config/env.js";

export const LANQI_TEXT_PRIMARY_MODEL = "deepseek-v4-pro" as const;
export const LANQI_TEXT_LOW_RISK_CANDIDATE = "deepseek-v4-flash" as const;
export const LANQI_TEXT_LOW_RISK_QWEN_CANDIDATE = "qwen3.8-flash" as const;
export const LANQI_TEXT_LOW_RISK_MAX_TOKENS = 2048 as const;

export type LanqiLowRiskCandidateModel =
  | typeof LANQI_TEXT_LOW_RISK_CANDIDATE
  | typeof LANQI_TEXT_LOW_RISK_QWEN_CANDIDATE;

export type LanqiLowRiskCandidateActivation = {
  candidateModel: LanqiLowRiskCandidateModel;
  enabled: boolean;
  evalApproved: boolean;
};

export type LanqiRuntimeTaskClass =
  | "knowledge_content_synthesis"
  | "xiaohongshu_strategy_copy"
  | "professional_prompt_enhancement"
  | "visual_intent_revision"
  | "fact_authorization_review"
  | "low_risk_formatting";

export type LanqiRuntimeModelPolicy = {
  model: typeof LANQI_TEXT_PRIMARY_MODEL | LanqiLowRiskCandidateModel;
  reasoningTag: "reasoning_high" | "reasoning_standard";
  reasoningProfile: "deep" | "standard";
};

export function assertLanqiLowRiskCandidateModel(model: string): asserts model is LanqiLowRiskCandidateModel {
  if (![LANQI_TEXT_LOW_RISK_CANDIDATE, LANQI_TEXT_LOW_RISK_QWEN_CANDIDATE].includes(model as LanqiLowRiskCandidateModel)) {
    throw new Error(`lanqi_low_risk_candidate_not_allowed:${model || "missing"}`);
  }
}

export function resolveLanqiRuntimeModelPolicy(
  taskClass: LanqiRuntimeTaskClass,
  candidate: boolean | LanqiLowRiskCandidateActivation,
): LanqiRuntimeModelPolicy {
  const activation: LanqiLowRiskCandidateActivation = typeof candidate === "boolean"
    ? { candidateModel: LANQI_TEXT_LOW_RISK_CANDIDATE, enabled: candidate, evalApproved: candidate }
    : candidate;
  if (taskClass === "low_risk_formatting" && activation.enabled && activation.evalApproved) {
    assertLanqiLowRiskCandidateModel(activation.candidateModel);
    return { model: activation.candidateModel, reasoningTag: "reasoning_standard", reasoningProfile: "standard" };
  }
  return { model: LANQI_TEXT_PRIMARY_MODEL, reasoningTag: "reasoning_high", reasoningProfile: "deep" };
}

export function assertLanqiProfessionalTextModel(provider: LlmProvider & { getModel?: () => string }): LanqiRuntimeModelPolicy {
  const actualModel = (typeof provider.getModel === "function" ? provider.getModel() : env.DEEPSEEK_MODEL).trim().toLowerCase();
  if (actualModel !== LANQI_TEXT_PRIMARY_MODEL) throw new Error(`lanqi_pro_model_required:${actualModel || "missing"}`);
  return resolveLanqiRuntimeModelPolicy("professional_prompt_enhancement", false);
}
