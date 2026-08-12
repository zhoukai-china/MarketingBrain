import type { FC, ReactNode, CSSProperties } from "react";
import avatarSheet from "../../assets/baolu-chief.jpg";


export const TopBar: FC<{
  token: string;
  status: string;
  onBilling: () => void;
}> = ({ token, status, onBilling }) => (
  <div className="topBar">
    <span className={token ? "stateDot online" : "stateDot"} />
    <p>{status}</p>
    <button className="payEntryButton" onClick={onBilling}>
      充值积分
    </button>
  </div>
);

export const NavTabs: FC<{
  view: string;
  setView: (v: string) => void;
}> = ({ view, setView }) => (
  <nav className="workspaceNav" aria-label="主功能切换">
    <button className={view === "consult" ? "active" : ""} onClick={() => setView("consult")}>
      和思潼聊
    </button>
    <button className={view === "daily" ? "active" : ""} onClick={() => setView("daily")}>
      今日简报
    </button>
    <button className={view === "memory" ? "active" : ""} onClick={() => setView("memory")}>
      经营记忆
    </button>
    <button className={view === "audio" ? "active" : ""} onClick={() => setView("audio")}>
      录音卡
    </button>
    <button className={view === "automation" ? "active" : ""} onClick={() => setView("automation")}>
      自动化
    </button>
  </nav>
);

export const ConsultantAvatar: FC<{
  consultant: { name: string; title: string; spriteX: number; spriteY: number; spriteW: number; spriteH: number };
  size?: "mini" | "normal";
}> = ({ consultant, size = "normal" }) => {
  const scale = size === "mini" ? 0.5 : 1;
  const style: CSSProperties = {
    backgroundImage: `url(${avatarSheet})`,
    backgroundPosition: `-${consultant.spriteX * scale}px -${consultant.spriteY * scale}px`,
    backgroundSize: `${768 * scale}px ${192 * scale}px`,
    width: `${consultant.spriteW * scale}px`,
    height: `${consultant.spriteH * scale}px`,
    borderRadius: "50%",
    display: "inline-block",
    flexShrink: 0,
  };
  return <span style={style} title={`${consultant.name} · ${consultant.title}`} />;
};
