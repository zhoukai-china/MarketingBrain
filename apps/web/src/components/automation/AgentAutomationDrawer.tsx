import { useEffect, useMemo, useState, type FormEvent } from "react";
import { apiPath } from "../../lib/api.js";

interface AgentAutomationAction {
  enabled: boolean;
  buttonLabel: string;
  defaultTaskType: string;
  defaultInstruction: string;
  allowedTaskTypes: string[];
  capabilityId?: string;
}

interface AutomationTaskView {
  id: string;
  type: string;
  status: string;
  payload?: Record<string, unknown>;
  runAt: string;
  createdAt?: string;
}

interface AutomationTaskPreset {
  type: string;
  label: string;
  description: string;
  requiresConfirmation?: boolean;
}

const TASK_PRESETS: AutomationTaskPreset[] = [
  { type: "daily_business_advice", label: "经营简报", description: "定时汇总经营信号、风险与行动建议" },
  { type: "weekly_topic_push", label: "每周选题", description: "基于新增知识与业务目标生成获客选题" },
  { type: "moments_push", label: "朋友圈内容", description: "按计划生成建立信任和承接私聊的内容" },
  { type: "inactive_user_wakeup", label: "客户跟进提醒", description: "识别待跟进客户并生成下一步动作建议" },
  { type: "file_analysis_followup", label: "新文件跟进", description: "资料更新后提醒当前智能体继续分析" },
  { type: "audio_card_analysis", label: "录音资料分析", description: "新录音转写进入知识库后触发分析" },
  { type: "local_push_ad_plan", label: "投放计划草案", description: "生成投放计划，提交前必须人工确认", requiresConfirmation: true },
  { type: "video_publish_plan", label: "视频发布计划", description: "生成发布草案，正式发布前必须确认", requiresConfirmation: true },
  { type: "ceo_action_order", label: "行动令跟进", description: "跟进已批准行动令的进度与证据" }
];

const STATUS_LABELS: Record<string, string> = {
  draft: "待确认",
  pending: "等待执行",
  claimed: "准备执行",
  running: "执行中",
  awaiting_confirmation: "等待确认",
  completed: "已完成",
  succeeded: "已完成",
  requires_user_confirm: "等待确认",
  failed: "失败",
  paused: "已暂停",
  canceled: "已取消"
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("store_os_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = payload as Record<string, unknown>;
    throw new Error(typeof record.message === "string" ? record.message : typeof record.error === "string" ? record.error : "请求失败");
  }
  return payload as T;
}

function nextRunAt(schedule: string, time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  const result = new Date();
  result.setSeconds(0, 0);
  result.setHours(Number.isFinite(hour) ? hour : 9, Number.isFinite(minute) ? minute : 0, 0, 0);
  if (result.getTime() <= Date.now()) result.setDate(result.getDate() + 1);
  if (schedule === "weekly") {
    const daysUntilMonday = (8 - result.getDay()) % 7 || 7;
    result.setDate(result.getDate() + daysUntilMonday);
  }
  return result.toISOString();
}

function formatRunAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间待确认" : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function AgentAutomationDrawer({
  open,
  agent,
  action,
  onClose
}: {
  open: boolean;
  agent: { id: string; slug: string; name: string };
  action: AgentAutomationAction;
  onClose: () => void;
}) {
  const presets = useMemo(() => action.allowedTaskTypes.map((type) => TASK_PRESETS.find((item) => item.type === type) ?? {
    type,
    label: type,
    description: "当前智能体专属自动化任务"
  }), [action.allowedTaskTypes]);
  const [tasks, setTasks] = useState<AutomationTaskView[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [type, setType] = useState(action.defaultTaskType);
  const [instruction, setInstruction] = useState(action.defaultInstruction);
  const [schedule, setSchedule] = useState("daily");
  const [time, setTime] = useState("09:00");

  async function loadTasks() {
    setLoading(true);
    setError("");
    try {
      const result = await fetch(apiPath("/automation/tasks"), { headers: authHeaders() })
        .then((response) => readJson<{ tasks: AutomationTaskView[] }>(response));
      setTasks(result.tasks.filter((task) => task.payload?.agentId === agent.id || task.payload?.agentSlug === agent.slug));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "自动化任务加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setType(action.defaultTaskType);
    setInstruction(action.defaultInstruction);
    setError("");
    setNotice("");
    void loadTasks();
  }, [open, agent.id, action.defaultTaskType, action.defaultInstruction]);

  async function createTask(event: FormEvent) {
    event.preventDefault();
    if (!instruction.trim()) {
      setError("请先填写自动化要完成的任务。");
      return;
    }
    const preset = presets.find((item) => item.type === type);
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await fetch(apiPath("/automation/tasks"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          runAt: nextRunAt(schedule, time),
          payload: {
            agentId: agent.id,
            agentSlug: agent.slug,
            agentName: agent.name,
            capabilityId: action.capabilityId,
            title: `${agent.name} · ${preset?.label ?? "自动化"}`,
            instruction: instruction.trim(),
            schedule: { frequency: schedule, time, timezone: "Asia/Shanghai" },
            knowledgeMode: "agent_scope",
            requiresConfirmation: Boolean(preset?.requiresConfirmation),
            source: "agent_workspace"
          }
        })
      }).then((response) => readJson(response));
      setNotice("自动化已创建。系统只会读取当前企业和当前智能体有权限的知识；涉及发布、投放或资金操作仍需你确认。");
      await loadTasks();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "自动化创建失败");
    } finally {
      setSaving(false);
    }
  }

  async function updateTask(task: AutomationTaskView, actionName: "pause" | "resume" | "cancel" | "run-now") {
    setError("");
    setNotice("");
    try {
      const suffix = actionName === "run-now" ? "/run-now" : "";
      await fetch(apiPath(`/automation/tasks/${task.id}${suffix}`), {
        method: actionName === "run-now" ? "POST" : "PATCH",
        headers: actionName === "run-now" ? authHeaders() : { ...authHeaders(), "Content-Type": "application/json" },
        body: actionName === "run-now" ? undefined : JSON.stringify({ action: actionName })
      }).then((response) => readJson(response));
      setNotice(actionName === "run-now" ? "已加入立即执行队列。" : actionName === "pause" ? "任务已暂停。" : actionName === "resume" ? "任务已恢复。" : "任务已取消。\n");
      await loadTasks();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "任务操作失败");
    }
  }

  if (!open) return null;
  return <div className="automationDrawerBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="agentAutomationDrawer" role="dialog" aria-modal="true" aria-label={`${agent.name}自动化`}>
      <header className="automationDrawerHeader">
        <div><span>当前智能体自动化</span><h2>{agent.name}</h2><p>自动化是底层能力，任务、权限和知识范围都归属当前智能体。</p></div>
        <button type="button" onClick={onClose} aria-label="关闭">×</button>
      </header>

      <form className="automationCreateForm" onSubmit={createTask}>
        <div className="automationPresetOptions">
          {presets.map((preset) => <button key={preset.type} type="button" className={type === preset.type ? "active" : ""} onClick={() => setType(preset.type)}>
            <strong>{preset.label}</strong><small>{preset.description}</small>
          </button>)}
        </div>
        <label>自动化任务<textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} rows={5} placeholder="例如：每周一根据本客户项目新增录音，提炼10个招商获客选题。" /></label>
        <div className="automationScheduleRow">
          <label>执行周期<select value={schedule} onChange={(event) => setSchedule(event.target.value)}><option value="daily">每天</option><option value="weekly">每周一</option><option value="once">仅执行一次</option></select></label>
          <label>执行时间<input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label>
        </div>
        <div className="automationKnowledgeScope"><strong>知识调用范围</strong><p>自动使用当前智能体可访问的企业、IP和客户项目知识；不复制资料，不跨企业读取。原始录音和敏感项目资料仍遵循现有授权。</p></div>
        <button className="automationPrimaryButton" type="submit" disabled={saving}>{saving ? "正在创建…" : action.buttonLabel}</button>
      </form>

      <section className="agentAutomationTaskSection">
        <header><div><span>已配置</span><h3>当前智能体的自动化</h3></div><button type="button" onClick={() => void loadTasks()}>刷新</button></header>
        {loading && <p className="agentAutomationEmpty">正在加载…</p>}
        {!loading && tasks.length === 0 && <p className="agentAutomationEmpty">还没有自动化。上面选择一种任务即可创建。</p>}
        {tasks.map((task) => {
          const preset = TASK_PRESETS.find((item) => item.type === task.type);
          const title = typeof task.payload?.title === "string" ? task.payload.title : preset?.label ?? task.type;
          const paused = task.status === "paused";
          const ended = task.status === "canceled" || task.status === "completed" || task.status === "succeeded";
          return <article className="agentAutomationTask" key={task.id}>
            <div><span className={`agentAutomationStatus status-${task.status}`}>{STATUS_LABELS[task.status] ?? task.status}</span><strong>{title}</strong><small>下次：{formatRunAt(task.runAt)}</small></div>
            <p>{typeof task.payload?.instruction === "string" ? task.payload.instruction : "按配置执行当前智能体任务。"}</p>
            <footer>
              {!ended && <button type="button" onClick={() => void updateTask(task, paused ? "resume" : "pause")}>{paused ? "恢复" : "暂停"}</button>}
              {!ended && <button type="button" onClick={() => void updateTask(task, "run-now")}>立即执行</button>}
              {!ended && <button type="button" className="danger" onClick={() => void updateTask(task, "cancel")}>取消</button>}
            </footer>
          </article>;
        })}
      </section>
      {notice && <p className="agentAutomationNotice">{notice}</p>}
      {error && <p className="agentAutomationError">{error}</p>}
    </aside>
  </div>;
}
