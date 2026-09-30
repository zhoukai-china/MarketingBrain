/*
 * 工作台「进页自动演示」共享实现（2026-10-01）。
 *
 * 规则（各工作台共用，别各写一套）：
 * 1. 演示 = 纯前端脚本 + 预置示例数据：不调接口、不写草稿、不扣算力。
 * 2. 演示像放视频——叠在当前页面之上；退出时按快照整帧还原（对话/简报/进度/交付）。
 * 3. 文案只用用户听得懂的话：不说「模拟数据 / 不调接口 / 不消耗算力」这类内部术语。
 */
import type { ReactNode } from "react";

/** 演示横幅：一眼能找到停止按钮。hasPrior = 演示前页面上已有用户内容。 */
export function DemoBar({ onStop, hasPrior }: { onStop: () => void; hasPrior: boolean }): ReactNode {
  return (
    <div className="cpw-demo-bar">
      <span className="cpw-demo-txt">
        🎬 <b>演示中</b> · 正在带你走一遍完整流程<span className="cpw-demo-free">（本演示不消耗算力）</span>{hasPrior ? " · 结束后回到你刚才的位置" : ""}
      </span>
      <button className="cpw-demo-stop" onClick={onStop}>
        {hasPrior ? "⏹ 停止演示，回到我的对话" : "⏹ 停止演示，开始使用"}
      </button>
    </div>
  );
}

export interface DemoStep {
  /** 用户气泡里显示的回答 */
  display: string;
  /** 演示给该题的候选（贴合示例案例） */
  candidates: string[];
  /** 消化回应（纯文本，宿主自行 escape） */
  digest: string;
  /** 要填进简报的字段值 */
  values: Record<string, string>;
}

export interface DemoHost {
  later: (fn: () => void, ms: number) => void;
  /** 演示是否还活着（停止后所有排队步骤自动作废） */
  isActive: () => boolean;
  ask: (i: number) => void;
  showCandidates: (i: number, list: string[]) => void;
  hideCandidates: () => void;
  /** 填简报（含字段高亮） */
  fillBrief: (i: number, step: DemoStep) => void;
  pushUser: (i: number, step: DemoStep) => void;
  pushThinking: () => number;
  replaceMsg: (id: number, html: string) => void;
}

/** 排一整轮访谈演示；返回时间线总长 ms（调用方在其后追加「确认 → 生成 → 交付」）。 */
export function scheduleInterviewDemo(steps: DemoStep[], h: DemoHost): number {
  let t = 1100;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    h.later(() => { if (h.isActive()) h.ask(i); }, t); t += 1100;
    h.later(() => { if (h.isActive()) h.showCandidates(i, step.candidates); }, t); t += 1500;
    h.later(() => {
      if (!h.isActive()) return;
      h.hideCandidates();
      h.fillBrief(i, step);
      h.pushUser(i, step);
      const pid = h.pushThinking();
      h.later(() => { if (h.isActive()) h.replaceMsg(pid, step.digest); }, 700);
    }, t); t += 1850;
  }
  return t;
}

/** 模拟生成进度：逐行点亮日志，走完调用 onDone（全程无 fetch）。 */
export function scheduleDemoLog(
  ordered: string[],
  h: { later: (fn: () => void, ms: number) => void; isActive: () => boolean },
  onLine: (line: string, idx: number) => void,
  onDone: () => void
): void {
  let li = 0;
  const step = () => {
    if (!h.isActive()) return;
    li += 1;
    onLine(ordered[li - 1] ?? "", li);
    if (li < ordered.length) h.later(step, 700);
    else h.later(() => { if (h.isActive()) onDone(); }, 900);
  };
  h.later(step, 300);
}
