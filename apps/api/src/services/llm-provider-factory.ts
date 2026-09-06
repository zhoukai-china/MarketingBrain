import type { LlmProvider } from "@baolu/agent";
import { env, domesticNetworkOnly, domesticOutboundAllowlist } from "../config/env.js";
import {
  DomesticChatProvider,
  type DomesticProviderUsageObservation,
} from "./domestic-chat-provider.js";
import {
  LANQI_TEXT_LOW_RISK_MAX_TOKENS,
  LANQI_TEXT_LOW_RISK_QWEN_CANDIDATE,
  LANQI_TEXT_PRIMARY_MODEL,
  assertLanqiLowRiskCandidateModel,
  resolveLanqiRuntimeModelPolicy,
  type LanqiLowRiskCandidateActivation,
  type LanqiRuntimeTaskClass,
} from "./lanqi-runtime-model-policy.js";

export type RuntimeLlmProvider = LlmProvider & {
  isConfigured(): boolean;
  getModel(): string;
};

export type LanqiTaskLlmProviderConfig = {
  qwenCandidate: LanqiLowRiskCandidateActivation;
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
  aliyunApiKey?: string;
  aliyunBaseUrl?: string;
  timeoutMs: number;
  domesticNetworkOnly: boolean;
  allowedHosts: string[];
  onUsage?: (usage: DomesticProviderUsageObservation) => void;
};

export function createRuntimeLlmProvider(): RuntimeLlmProvider {
  if (env.LLM_PROVIDER === "aliyun") {
    return new DomesticChatProvider({
      providerName: "aliyun",
      apiKey: env.ALIYUN_API_KEY,
      baseUrl: env.ALIYUN_BASE_URL,
      model: env.ALIYUN_MODEL,
      timeoutMs: env.LLM_TIMEOUT_MS,
      domesticNetworkOnly,
      allowedHosts: domesticOutboundAllowlist
    });
  }

  if (env.LLM_PROVIDER === "domestic_compatible") {
    return new DomesticChatProvider({
      providerName: env.DOMESTIC_COMPATIBLE_PROVIDER_NAME,
      apiKey: env.DOMESTIC_COMPATIBLE_API_KEY,
      baseUrl: env.DOMESTIC_COMPATIBLE_BASE_URL,
      model: env.DOMESTIC_COMPATIBLE_MODEL,
      timeoutMs: env.LLM_TIMEOUT_MS,
      domesticNetworkOnly,
      allowedHosts: domesticOutboundAllowlist
    });
  }

  return new DomesticChatProvider({
    providerName: "deepseek",
    apiKey: env.DEEPSEEK_API_KEY,
    baseUrl: env.DEEPSEEK_BASE_URL,
    model: env.DEEPSEEK_MODEL,
    timeoutMs: env.LLM_TIMEOUT_MS,
    domesticNetworkOnly,
    allowedHosts: domesticOutboundAllowlist
  });
}

export function createLanqiTaskLlmProvider(
  taskClass: LanqiRuntimeTaskClass,
  config: LanqiTaskLlmProviderConfig = {
    qwenCandidate: {
      candidateModel: env.LANQI_LOW_RISK_TEXT_MODEL,
      enabled: env.LANQI_LOW_RISK_TEXT_ENABLED === "true",
      evalApproved: env.LANQI_LOW_RISK_TEXT_EVAL_APPROVED === "true",
    },
    deepseekApiKey: env.DEEPSEEK_API_KEY,
    deepseekBaseUrl: env.DEEPSEEK_BASE_URL,
    aliyunApiKey: env.ALIYUN_API_KEY,
    aliyunBaseUrl: env.ALIYUN_BASE_URL,
    timeoutMs: env.LLM_TIMEOUT_MS,
    domesticNetworkOnly,
    allowedHosts: domesticOutboundAllowlist,
  },
): RuntimeLlmProvider {
  const policy = resolveLanqiRuntimeModelPolicy(taskClass, config.qwenCandidate);
  if (policy.model === LANQI_TEXT_PRIMARY_MODEL) {
    return new DomesticChatProvider({
      providerName: "deepseek",
      apiKey: config.deepseekApiKey,
      baseUrl: config.deepseekBaseUrl,
      model: LANQI_TEXT_PRIMARY_MODEL,
      timeoutMs: config.timeoutMs,
      domesticNetworkOnly: config.domesticNetworkOnly,
      allowedHosts: config.allowedHosts,
      onUsage: config.onUsage,
    });
  }

  assertLanqiLowRiskCandidateModel(policy.model);
  const candidate = new DomesticChatProvider({
    providerName: policy.model === LANQI_TEXT_LOW_RISK_QWEN_CANDIDATE ? "aliyun" : "deepseek",
    apiKey: policy.model === LANQI_TEXT_LOW_RISK_QWEN_CANDIDATE ? config.aliyunApiKey : config.deepseekApiKey,
    baseUrl: policy.model === LANQI_TEXT_LOW_RISK_QWEN_CANDIDATE ? config.aliyunBaseUrl : config.deepseekBaseUrl,
    model: policy.model,
    timeoutMs: config.timeoutMs,
    domesticNetworkOnly: config.domesticNetworkOnly,
    allowedHosts: config.allowedHosts,
    onUsage: config.onUsage,
    assertModelAllowed: assertLanqiLowRiskCandidateModel,
  });

  return {
    name: candidate.name,
    isConfigured: () => candidate.isConfigured(),
    getModel: () => candidate.getModel(),
    complete: (messages, options) => candidate.complete(messages, {
      ...options,
      reasoningProfile: "standard",
      thinkingMode: "disabled",
      maxTokens: Math.min(options?.maxTokens ?? LANQI_TEXT_LOW_RISK_MAX_TOKENS, LANQI_TEXT_LOW_RISK_MAX_TOKENS),
    }),
  };
}
