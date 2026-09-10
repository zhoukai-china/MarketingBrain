export const defaultHighCapabilityLlmModels = [
  "deepseek-v4-pro",
  "deepseek-v4pro",
  "deepseek-v4-flash",
  "qwen-max",
  "qwen3-max",
  "qwen3-235b-a22b",
  "qwq-plus"
];

const blockedLlmModelPatterns = [
  /deepseek[-_]?reasoner/i,
  /deepseek[-_]?r1/i,
  /(turbo|lite|mini|cheap|small)/i,
  /\bgpt[-_\d]?/i,
  /chatgpt/i,
  /openai/i,
  /claude/i,
  /anthropic/i,
  /gemini/i,
  /mistral/i,
  /llama/i,
  /grok/i
];

export function normalizeLlmModel(model: string): string {
  return model.trim().toLowerCase();
}

export function parseConfiguredHighCapabilityModels(raw?: string): string[] {
  return (raw ?? "")
    .split(",")
    .map((item) => normalizeLlmModel(item))
    .filter(Boolean);
}

export function getHighCapabilityLlmModels(configuredModels?: string): string[] {
  return Array.from(new Set([...defaultHighCapabilityLlmModels, ...parseConfiguredHighCapabilityModels(configuredModels)]));
}

export function isHighCapabilityLlmModel(model: string, configuredModels?: string): boolean {
  const normalized = normalizeLlmModel(model);
  return getHighCapabilityLlmModels(configuredModels).includes(normalized) && !isBlockedLlmModel(model);
}

export function isBlockedLlmModel(model: string): boolean {
  return blockedLlmModelPatterns.some((pattern) => pattern.test(model));
}

export function highCapabilityLlmPolicyMessage(model: string, configuredModels?: string): string {
  return [
    "Sitong AI must use an approved top-tier domestic model only.",
    `Approved model IDs: ${getHighCapabilityLlmModels(configuredModels).join(", ")}.`,
    "Do not connect overseas, low-tier, turbo, lite, mini, or cheap fallback models.",
    "Add a new model with LLM_ALLOWED_MODELS only after confirming it is a top-tier China-hosted model.",
    `Current model: ${model || "<empty>"}.`
  ].join(" ");
}

export function assertHighCapabilityLlmModel(model: string): void {
  if (!isHighCapabilityLlmModel(model, process.env.LLM_ALLOWED_MODELS)) {
    throw new Error(highCapabilityLlmPolicyMessage(model, process.env.LLM_ALLOWED_MODELS));
  }
}
