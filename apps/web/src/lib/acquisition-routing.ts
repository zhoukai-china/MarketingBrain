import { inferAcquisitionCapabilities as inferSharedAcquisitionCapabilities } from "@baolu/shared";

export function inferAcquisitionCapability(input: string, fallback: string): string {
  return inferAcquisitionCapabilities(input)[0] ?? fallback;
}

/**
 * A task keeps the capability chosen on its first turn. Later messages often
 * contain supporting facts (an account name, URL, metric, price, etc.); those
 * facts must not silently replace the task with another capability.
 */
export function resolveAcquisitionTaskCapabilities(
  input: string,
  taskCapabilityId?: string,
  explicitCapabilityIds: string[] = []
): string[] {
  const explicit = Array.from(new Set(explicitCapabilityIds.filter(Boolean)));
  if (explicit.length > 0) return explicit.slice(0, 3);
  if (taskCapabilityId) return [taskCapabilityId];
  return inferAcquisitionCapabilities(input);
}

export function inferAcquisitionCapabilities(input: string): string[] {
  return inferSharedAcquisitionCapabilities(input);
}

interface CapabilityHistoryMessage {
  role: "user" | "assistant";
  content: string;
  capabilityId?: string;
}

const CAPABILITY_MARKERS: Record<string, RegExp> = {
  ip_positioning: /【IP定位系统｜(?:知识库一键生成|资料生成定位|定位修改对话|访谈继续)】|IP定位全案修改/,
  topic_inspiration: /【选题系统｜|【Topic System｜/,
  content_plan: /【内容系统｜批量内容生成】|【Content System｜Refinement】/,
  shooting_editing: /【内容系统｜拍剪优化】/,
  paid_traffic: /【投流系统｜/,
  video_review: /【视频复盘系统｜/,
  live_script: /【直播系统｜/,
  live_review: /【直播复盘系统｜/
};

export function scopeAcquisitionCapabilityHistory<T extends CapabilityHistoryMessage>(messages: T[], capabilityId?: string): T[] {
  if (!capabilityId) return messages;
  const marker = CAPABILITY_MARKERS[capabilityId];
  if (!marker) return messages;
  const lastStart = messages.reduce((latest, message, index) =>
    message.role === "user" && marker.test(message.content) ? index : latest, -1);
  if (lastStart < 0) return [];
  return messages.slice(lastStart).filter((message) =>
    message.role === "user" || !message.capabilityId || message.capabilityId === capabilityId);
}

const IP_POSITIONING_FORMAL_DELIVERY_TERMS = [
  "IP定位全案",
  "1分钟速览",
  "项目定位",
  "目标用户定位",
  "IP人设定位",
  "内容定位",
  "选题方向",
  "投流建议",
  "IP发展规划",
  "执行建议"
];

export function isIpPositioningDelivery(content: string): boolean {
  const text = content.trim();
  if (!text || /投流结论|client_id|account_id|账户快照|P0动作|止损规则/.test(text)) return false;
  return IP_POSITIONING_FORMAL_DELIVERY_TERMS.every((term) => text.includes(term));
}

export function isIpPositioningInterviewResponse(content: string): boolean {
  const text = content.trim();
  if (!text || isIpPositioningDelivery(text)) return false;
  if (/IP定位全案|完整IP定位方案|1分钟速览|一、项目定位|二、目标用户定位|五、选题方向/.test(text)) return false;
  const questionMarks = text.match(/[？?]/g) ?? [];
  return questionMarks.length === 1
    && /确认|明白|追问|请补充|告诉我|说说|项目|品牌|创始人|客户|账号|目标/.test(text);
}
