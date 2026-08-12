import type { LlmProvider } from "@baolu/agent";
import { env, domesticNetworkOnly, domesticOutboundAllowlist } from "../config/env.js";
import { DomesticChatProvider } from "./domestic-chat-provider.js";

export type RuntimeLlmProvider = LlmProvider & {
  isConfigured(): boolean;
  getModel(): string;
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
