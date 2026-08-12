import type { ConsultantId } from "../../types";
import { useChat } from "../../hooks/useChat";
import { ChatMessages, ChatComposer } from "../chat";
import type { IpAcquisitionCapability, IpAcquisitionCapabilityId } from "../../data/ipAcquisitionAgent";

interface ConsultViewWrapperProps {
  token: string;
  headers: Record<string, string>;
  currentConsultantId: ConsultantId;
  capabilityId?: IpAcquisitionCapabilityId;
  currentAbilityLabel: string;
  currentAbilitySubtitle: string;
  agentId?: string;
  allowDemoChat?: boolean;
  draftPrompt?: string;
  onDraftPromptConsumed?: () => void;
  onSelectConsultant: (id: ConsultantId) => void;
  onOpenCapability?: (id: IpAcquisitionCapabilityId) => void;
  onOpenBilling: () => void;
  onNeedLogin: () => void;
}

export function ConsultViewWrapper({
  token,
  headers,
  currentConsultantId,
  capabilityId,
  currentAbilityLabel,
  currentAbilitySubtitle,
  agentId,
  allowDemoChat,
  draftPrompt,
  onDraftPromptConsumed,
  onOpenCapability,
  onOpenBilling,
  onNeedLogin,
}: ConsultViewWrapperProps) {
  const {
    messages,
    inputValue,
    setInputValue,
    busy,
    thinkingStep,
    chatEndRef,
    inputRef,
    handleQuickPrompt,
    handleSend,
    handleKeyDown,
  } = useChat({
    token,
    headers,
    currentConsultantId,
    capabilityId,
    agentId,
    allowDemoChat,
    draftPrompt,
    onDraftPromptConsumed,
    onOpenBilling,
    onNeedLogin
  });

  function handleQuickCapability(capability: IpAcquisitionCapability) {
    if (onOpenCapability) {
      onOpenCapability(capability.id);
      return;
    }
    handleQuickPrompt(capability.buildPrompt);
  }

  return (
    <div
      className="consultConsultView"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--panel)",
      }}
    >
      <div
        className="consultHeader"
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid var(--line)",
          background: "var(--panel)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <strong style={{ display: "block", color: "#fff", fontSize: 16 }}>{currentAbilityLabel}</strong>
          <span style={{ display: "block", marginTop: 4, color: "var(--muted)", fontSize: 13 }}>
            {currentAbilitySubtitle}
          </span>
        </div>
      </div>

      <ChatMessages
        messages={messages}
        busy={busy}
        thinkingStep={thinkingStep}
        currentConsultantId={currentConsultantId}
        capabilityId={capabilityId}
        chatEndRef={chatEndRef}
        onQuickPrompt={handleQuickCapability}
      />

      <ChatComposer
        inputValue={inputValue}
        busy={busy}
        currentConsultantId={currentConsultantId}
        capabilityId={capabilityId}
        headers={headers}
        inputRef={inputRef}
        onInputChange={setInputValue}
        onKeyDown={handleKeyDown}
        onSend={handleSend}
      />
    </div>
  );
}
