import type { SkillId, TenantType } from "@baolu/shared";
import { type CreditPackCode, type PlanCode, type ProjectPackageCode } from "@baolu/shared";
export type { PlanCode, CreditPackCode, ProjectPackageCode };

export type View = "growth" | "diagnosis" | "consult" | "onboarding" | "daily" | "memory" | "audio" | "automation" | "billing";
export type ConsultantId = SkillId;
export type MessageRole = "advisor" | "user";
export type BusinessRole = TenantType;

export interface ChatResponse {
  answer?: string;
  error?: string;
  message?: string;
  conversationId?: string;
  agentRunId?: string;
  creditCost?: number;
  skillId?: SkillId | string;
}

export type ChatStreamEvent = ChatResponse & {
  delta?: string;
  skillVersion?: string;
};

export interface ProactiveFeedResponse {
  items?: Array<{
    id: string;
    type: string;
    title: string;
    content: string;
    skillId?: string;
    createdAt: string;
  }>;
  error?: string;
  message?: string;
}

export interface ProactiveThread {
  id: string;
  title: string;
  content: string;
  skillId?: string;
  createdAt: string;
}

export interface Order {
  id: string;
  type: "subscription" | "credit_pack" | "project_package" | "agent_offer";
  status: string;
  amountCny: number;
  planCode?: PlanCode;
  billingPeriod?: string;
  creditPackCode?: CreditPackCode;
  projectPackageCode?: ProjectPackageCode;
  offerId?: string;
  eventId?: string;
  channelId?: string;
  credits?: number;
  codeUrl?: string;
}

export interface OrderResponse {
  order?: Order;
  codeUrl?: string;
  tradeType?: "native" | "jsapi";
  payParams?: WechatJsapiPayParams;
  error?: string;
  message?: string;
}

export interface AudioCardBinding {
  bindingId: string;
  provider: string;
  label: string;
  description?: string;
  mode: "pull";
  webhookUrl: string;
  pullUrl: string;
  pullReady?: boolean;
  tokenHeader: string;
  createdAt: string;
}

export interface AudioCardBindingResponse {
  bindings?: AudioCardBinding[];
  error?: string;
  message?: string;
}

export interface WechatJsapiPayParams {
  appId: string;
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: string;
  paySign: string;
}

export interface WeixinBridgeWindow extends Window {
  WeixinJSBridge?: {
    invoke: (
      method: string,
      params: Record<string, unknown>,
      callback: (result: { err_msg?: string }) => void
    ) => void;
  };
}

export interface Consultant {
  id: ConsultantId;
  name: string;
  title: string;
  description: string;
  spriteX: number;
  spriteY: number;
  spriteW: number;
  spriteH: number;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  consultantId: ConsultantId;
  skillId?: string;
  content: string;
  artifact?: {
    content: string;
    format: "word" | "pdf";
    title: string;
    filename: string;
  } | null;
  createdAt?: string;
}

export interface MemoryState {
  role: BusinessRole;
  tenantName: string;
  industry: string;
  city: string;
  positioning: string;
  customer: string;
  offer: string;
  tone: string;
  acquisition: string;
  sales: string;
  delivery: string;
  management: string;
  diagnosisSummary: string;
}

export interface QuickPrompt {
  title: string;
  subtitle: string;
  buildPrompt: (memory: MemoryState) => string;
}

export interface PlanOption {
  value: PlanCode;
  label: string;
  price: number;
  period: string;
  credits: number;
}

export interface CreditPackOption {
  value: CreditPackCode;
  label: string;
  price: number;
  credits: number;
}

export interface DailyInsight {
  change: string;
  view: string;
}

export interface DiagnosisQuestion {
  key: keyof MemoryState;
  prompt: string;
  placeholder: string;
}
