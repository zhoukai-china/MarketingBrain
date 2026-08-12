import { useState, useEffect, useRef, useCallback } from "react";
import type { ConsultantId, ChatMessage } from "../types";
import type { IpAcquisitionCapabilityId } from "../data/ipAcquisitionAgent";
import { apiBase } from "../data/constants";
import { getStoredMemory } from "../lib/utils";
import { currentDeviceScope } from "../lib/device-scope";
import type { DeviceScope } from "@baolu/shared";

interface UseChatOptions {
  token: string;
  headers: Record<string, string>;
  currentConsultantId: ConsultantId;
  capabilityId?: IpAcquisitionCapabilityId;
  agentId?: string;
  allowDemoChat?: boolean;
  draftPrompt?: string;
  onDraftPromptConsumed?: () => void;
  onOpenBilling: () => void;
  onNeedLogin: () => void;
}

interface ChatSessionSnapshot {
  deviceScope: DeviceScope;
  messages: ChatMessage[];
  inputValue: string;
  conversationId?: string;
}

export function useChat({
  token,
  headers,
  currentConsultantId,
  capabilityId,
  agentId,
  allowDemoChat = false,
  draftPrompt,
  onDraftPromptConsumed,
  onOpenBilling,
  onNeedLogin
}: UseChatOptions) {
  const deviceScopeRef = useRef<DeviceScope>(currentDeviceScope());
  const deviceScope = deviceScopeRef.current;
  const sessionKey = `sitong_ip_agent_chat_${deviceScope}_${agentId || "default"}`;
  const initialSession = readChatSession(sessionKey, deviceScope, agentId || "default");
  const [messages, setMessages] = useState<ChatMessage[]>(initialSession.messages);
  const [inputValue, setInputValue] = useState(initialSession.inputValue);
  const [busy, setBusy] = useState(false);
  const [thinkingStep, setThinkingStep] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const conversationIdRef = useRef<string | undefined>(initialSession.conversationId);
  const memory = getStoredMemory();

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [currentConsultantId, busy]);

  useEffect(() => {
    if (!busy) {
      setThinkingStep("");
      return;
    }
    const steps = getPublicThinkingSteps(currentConsultantId, capabilityId);
    let index = 0;
    setThinkingStep(steps[index]);
    const timer = window.setInterval(() => {
      index = Math.min(index + 1, steps.length - 1);
      setThinkingStep(steps[index]);
    }, 1100);
    return () => window.clearInterval(timer);
  }, [busy, currentConsultantId, capabilityId]);

  useEffect(() => {
    saveChatSession(sessionKey, {
      messages,
      inputValue,
      deviceScope,
      conversationId: conversationIdRef.current
    });
  }, [sessionKey, messages, inputValue]);

  useEffect(() => {
    if (!draftPrompt) return;
    setInputValue(draftPrompt);
    onDraftPromptConsumed?.();
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [draftPrompt, onDraftPromptConsumed]);

  const appendAdvisorMessage = useCallback(
    (content: string) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: "advisor",
          consultantId: currentConsultantId,
          content
        }
      ]);
    },
    [currentConsultantId]
  );

  const handleQuickPrompt = useCallback(
    (promptFn: (m: typeof memory) => string) => {
      if (!token && !allowDemoChat) {
        onNeedLogin();
        return;
      }
      setInputValue(promptFn(memory));
      inputRef.current?.focus();
    },
    [token, allowDemoChat, memory, onNeedLogin]
  );

  const handleSend = useCallback(async (inputOverride?: string, displayOverride?: string) => {
    const text = (inputOverride ?? inputValue).trim();
    const displayText = (displayOverride ?? text).trim();
    if (!text || busy) return;
    if (!token && !allowDemoChat) {
      onNeedLogin();
      return;
    }

    setInputValue("");
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      consultantId: currentConsultantId,
      content: displayText
    };
    setMessages((prev) => [...prev, userMsg]);
    setBusy(true);

    try {
      const entry = memory.role === "chain_brand" ? "franchise" : "local";
      const requestedSkillId = currentConsultantId === "general_qa" ? undefined : currentConsultantId;
      const res = await fetch(`${apiBase}/chat`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          input: text,
          prompt: text,
          agentId,
          capabilityId,
          skillId: requestedSkillId,
          conversationId: conversationIdRef.current,
          deviceScope,
          entry,
          context: { memory }
        })
      });

      if (res.status === 402) {
        appendAdvisorMessage("当前积分不足，先充值积分，我再继续帮你往下做。");
        onOpenBilling();
        setBusy(false);
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const friendlyMessage = friendlyChatErrorMessage(errData, res.status);
        if (res.status === 401 || readErrorCode(errData) === "login_required") {
          onNeedLogin();
          appendAdvisorMessage(friendlyMessage);
          setBusy(false);
          return;
        }
        if (res.status === 403 && readErrorCode(errData) === "subscription_required") {
          appendAdvisorMessage(friendlyMessage);
          onOpenBilling();
          setBusy(false);
          return;
        }
        appendAdvisorMessage(friendlyMessage);
        setBusy(false);
        return;
      }

      const data = await res.json();
      if (data.conversationId) {
        conversationIdRef.current = data.conversationId;
        saveChatSession(sessionKey, {
          messages,
          inputValue: "",
          deviceScope,
          conversationId: data.conversationId
        });
      }
      const answer = data.answer ?? data.message ?? "";
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "advisor",
          consultantId: currentConsultantId,
          content: answer
        }
      ]);
    } catch {
      appendAdvisorMessage("网络连接失败，请检查网络后重试。");
    }
    setBusy(false);
  }, [
    inputValue,
    busy,
    token,
    allowDemoChat,
    currentConsultantId,
    capabilityId,
    agentId,
    headers,
    memory,
    sessionKey,
    messages,
    onOpenBilling,
    onNeedLogin,
    appendAdvisorMessage
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return {
    messages,
    inputValue,
    setInputValue,
    busy,
    thinkingStep,
    chatEndRef,
    inputRef,
    handleQuickPrompt,
    handleSend,
    handleKeyDown
  };
}

function getPublicThinkingSteps(currentConsultantId: ConsultantId, capabilityId?: IpAcquisitionCapabilityId): string[] {
  if (capabilityId === "industry_hotspots") {
    return [
      "正在整理近期行业热点线索...",
      "正在判断哪些热点适合转成获客内容...",
      "正在生成选题、平台切入和今日动作...",
      "正在做质量检查，马上给你热点方案..."
    ];
  }
  if (capabilityId === "shooting_editing") {
    return [
      "正在读取文件和视频上下文...",
      "正在锁定拍摄问题、镜头结构和剪辑节奏...",
      "正在整理分镜、EDL 和发布前检查...",
      "正在做质量检查，马上给你完整建议..."
    ];
  }
  if (capabilityId === "paid_traffic") {
    return [
      "正在核对平台、目标、素材和预算边界...",
      "正在判断当前素材是否适合放大...",
      "正在生成小额测试、监控指标和止损条件...",
      "正在整理投流执行草案，马上给你建议..."
    ];
  }
  if (capabilityId === "video_review") {
    return [
      "正在逐行读取后台数据文件...",
      "正在审计字段覆盖并计算总览、分层和内容健康度...",
      "正在完成单条深拆、趋势、规律和方法论沉淀...",
      "正在做质量检查，马上给你视频数据复盘..."
    ];
  }
  if (capabilityId === "live_script" || currentConsultantId === "live_script_planner") {
    return [
      "正在识别直播场景和转化目标...",
      "正在拆开场、留人、互动和逼单节奏...",
      "正在补齐运营配合、合规提醒和下播跟进...",
      "正在做质量检查，马上给你可用话术..."
    ];
  }
  if (capabilityId === "moments_private" || currentConsultantId === "moments_generator") {
    return [
      "正在提炼朋友圈可用信息...",
      "正在匹配信任建立、私聊承接和成交引导...",
      "正在整理可直接发布的朋友圈内容...",
      "正在做质量检查，马上给你交付件..."
    ];
  }
  return [
    "正在识别产品、客户和发布目标...",
    "正在按内容九件套组织交付结构...",
    "正在补齐脚本、拍摄、剪辑和发布动作...",
    "正在做质量检查，马上给你完整内容..."
  ];
}

function readChatSession(key: string, deviceScope: DeviceScope, agentKey: string): ChatSessionSnapshot {
  if (typeof window === "undefined") return { deviceScope, messages: [], inputValue: "" };
  try {
    const raw = window.sessionStorage.getItem(key)
      ?? (deviceScope === "desktop" ? window.sessionStorage.getItem(`sitong_ip_agent_chat_${agentKey}`) : null);
    if (!raw) return { deviceScope, messages: [], inputValue: "" };
    const parsed = JSON.parse(raw) as Partial<ChatSessionSnapshot>;
    if (parsed.deviceScope && parsed.deviceScope !== deviceScope) return { deviceScope, messages: [], inputValue: "" };
    return {
      deviceScope,
      messages: Array.isArray(parsed.messages) ? parsed.messages.filter(isChatMessage).slice(-30) : [],
      inputValue: typeof parsed.inputValue === "string" ? parsed.inputValue : "",
      conversationId: typeof parsed.conversationId === "string" ? parsed.conversationId : undefined
    };
  } catch {
    return { deviceScope, messages: [], inputValue: "" };
  }
}

function saveChatSession(key: string, snapshot: ChatSessionSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify({
      messages: snapshot.messages.slice(-30),
      inputValue: snapshot.inputValue,
      deviceScope: snapshot.deviceScope,
      conversationId: snapshot.conversationId
    }));
  } catch {
    // Session history is a convenience feature; ignore storage limits.
  }
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string"
    && (item.role === "user" || item.role === "advisor")
    && typeof item.consultantId === "string"
    && typeof item.content === "string";
}

function friendlyChatErrorMessage(errData: unknown, status: number): string {
  const error = readErrorCode(errData);
  const message = readMessage(errData);

  if (message && !isInternalErrorText(message)) return message;
  if (status === 401 || error === "login_required" || error === "membership_not_found" || error === "missing_tenant_or_user") {
    return "登录状态已失效，请重新登录或完成企业入驻。";
  }
  if (status === 402 || error === "insufficient_credits") {
    return "当前积分不足，先充值积分，我再继续帮你往下做。";
  }
  if (status === 403 && error === "subscription_required") {
    return "当前账号暂时无法使用，请联系服务团队。";
  }
  if (error === "agent_run_failed") {
    return "这次会诊没有成功，我已经把问题收住了。请稍后重试，或先切回思潼顾问处理。";
  }
  return "出了点问题，请稍后再试。";
}

function readErrorCode(value: unknown): string {
  return isRecord(value) && typeof value.error === "string" ? value.error : "";
}

function readMessage(value: unknown): string {
  return isRecord(value) && typeof value.message === "string" ? value.message.trim() : "";
}

function isInternalErrorText(value: string): boolean {
  return /membership_not_found|missing_tenant_or_user|subscription_not_found|agent_run_failed|internal_server_error/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
