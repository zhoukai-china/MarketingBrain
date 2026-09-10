// 兰琪美业门店 AI 经营大脑 · 公域获客 / 短视频文案改稿
// 对齐 demo `copywriter.html`：原稿 → 开头 → 成稿 → 标题封面（含为什么这样改 / 拍摄和剪辑参考）

import { useEffect, useRef, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import { LanqiBrainShell } from "../components/lanqi-brain/LanqiBrainShell.js";

interface StoreInfo { id: string; name: string; city: string | null }
interface CheckItem { ok: boolean; label: string; detail: string }
interface ScoreDim { key: string; label: string; score: number; max: number; comment: string; advice: string }
interface OpeningCard { key: string; title: string; text: string; why: string }
interface ChangeItem { part: string; before: string; after: string; reason: string }
interface ShotItem { meta: string; scene: string; edit: string }
interface CopywriterResult {
  purpose: string;
  purposeLabel: string;
  goal: string;
  goalLabel: string;
  intent: string;
  highlights: string[];
  scores: ScoreDim[];
  openings: OpeningCard[];
  body: string;
  finalDraft: string;
  titles: Array<{ tag: string; text: string }>;
  cover: { title: string; desc: string };
  changes: ChangeItem[];
  style: string;
  shots: ShotItem[];
  rawLen: number;
  newLen: number;
  checks: CheckItem[];
  placeholder?: boolean;
  needsInput?: boolean;
}

const PURPOSES = [
  { value: "auto", label: "自动判断" },
  { value: "deal", label: "成交型" },
  { value: "aware", label: "了解型" },
  { value: "exposure", label: "曝光型" }
];

const GOALS = [
  { value: "all", label: "综合优化" },
  { value: "completion", label: "完播率" },
  { value: "engagement", label: "互动率" },
  { value: "conversion", label: "转化率" }
];

const STEPS = [
  { n: 1, label: "原稿" },
  { n: 2, label: "开头" },
  { n: 3, label: "成稿" },
  { n: 4, label: "标题封面" }
];

const LOADING_TEXTS = ["正在读稿…", "正在找出最该改的地方…", "正在整理完整口播稿…", "正在等待改稿结果…"];
const DRAFT_STORE_KEY = "lanqi_acquire_copywriter_draft";
const PLACEHOLDER_LINE = "【待你补一句：具体数字】";

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("store_os_token");
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

async function readResponse(response: Response): Promise<any> {
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    localStorage.removeItem("store_os_token");
    window.location.replace(getAppPath("/login"));
    throw new Error("登录已失效");
  }
  if (!response.ok) throw new Error(body.message ?? body.error ?? "请求失败");
  return body;
}

function composeDraft(result: CopywriterResult, openingIndex: number): string {
  const opening = result.openings[openingIndex] ?? result.openings[0];
  if (!opening) return result.body;
  const tail = result.placeholder && !result.body.includes(PLACEHOLDER_LINE) ? `\n\n${PLACEHOLDER_LINE}` : "";
  return `${opening.text}\n\n${result.body}${tail}`;
}

export function LanqiAcquireCopywriterPage() {
  const [storeId, setStoreId] = useState("");
  const [raw, setRaw] = useState("写一个获客文案");
  const [extra, setExtra] = useState("教别人用 AI");
  const [purpose, setPurpose] = useState("auto");
  const [goal, setGoal] = useState("all");
  const [step, setStep] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState(LOADING_TEXTS[0]);
  const [result, setResult] = useState<CopywriterResult | null>(null);
  const [openingIndex, setOpeningIndex] = useState(0);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [whyOpen, setWhyOpen] = useState(false);
  const [shootOpen, setShootOpen] = useState(false);
  const [draftSource, setDraftSource] = useState("");
  const [draftRevision, setDraftRevision] = useState(0);
  const editorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!localStorage.getItem("store_os_token")) {
      window.location.replace(getAppPath("/login"));
      return;
    }
    void loadStores();
  }, []);

  async function loadStores() {
    try {
      const data = await readResponse(await fetch(apiPath("/lanqi/stores"), { headers: authHeaders() }));
      const list: StoreInfo[] = data.stores ?? [];
      if (list.length) setStoreId(list[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "门店加载失败");
    }
  }

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 1500);
  }

  /**
   * 成稿编辑框是 contentEditable，只能通过 DOM 写入。
   * 这里只登记「应该显示的文本」，真正写入放到步骤切换后的 effect 里，
   * 否则在点击事件中同步写 ref 时，成稿步骤的编辑框还没挂载，内容会丢失。
   */
  function applyDraft(text: string) {
    setDraftSource(text);
    setDraftRevision((n) => n + 1);
  }

  useEffect(() => {
    if (step !== 3 || !draftSource) return;
    const el = editorRef.current;
    if (!el || el.textContent === draftSource) return;
    el.textContent = draftSource;
  }, [step, draftSource, draftRevision]);

  function persistDraft(text: string) {
    try {
      localStorage.setItem(DRAFT_STORE_KEY, JSON.stringify({ text, savedAt: Date.now() }));
    } catch {
      /* 本机存储不可用时忽略，不影响主流程 */
    }
  }

  function readPersistedDraft(): string | null {
    try {
      const parsed = JSON.parse(localStorage.getItem(DRAFT_STORE_KEY) ?? "null") as { text?: string } | null;
      return parsed?.text ?? null;
    } catch {
      return null;
    }
  }

  async function revise(mode: "initial" | "regenerate") {
    if (!raw.trim() || raw.trim().length < 3) {
      setError("请先输入原稿内容");
      return;
    }
    setError("");
    if (mode === "initial") {
      setLoading(true);
      setStep(0);
      let i = 0;
      setLoadingText(LOADING_TEXTS[0]);
      const timer = window.setInterval(() => {
        i += 1;
        if (i < LOADING_TEXTS.length) setLoadingText(LOADING_TEXTS[i]);
      }, 500);
      try {
        const data = await readResponse(await fetch(apiPath("/lanqi/acquire/copywriter"), {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ storeId, raw, purpose, goal, extra })
        }));
        const next = data.result as CopywriterResult;
        setResult(next);
        if (next.needsInput) {
          setStep(1);
          return;
        }
        setOpeningIndex(0);
        const draft = composeDraft(next, 0);
        persistDraft(draft);
        applyDraft(draft);
        setStep(2);
      } catch (e) {
        setError(e instanceof Error ? e.message : "改稿失败");
        setStep(1);
      } finally {
        window.clearInterval(timer);
        setLoading(false);
      }
      return;
    }

    setRegenerating(true);
    try {
      const data = await readResponse(await fetch(apiPath("/lanqi/acquire/copywriter"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ storeId, raw, purpose, goal, extra })
      }));
      const next = data.result as CopywriterResult;
      if (next.needsInput) {
        setError("原稿信息还不够，请补充门店、项目或顾客信息后再生成");
        return;
      }
      setResult(next);
      const draft = composeDraft(next, 0);
      setOpeningIndex(0);
      applyDraft(draft);
      persistDraft(draft);
      flash("已重新生成正文");
    } catch (e) {
      setError(e instanceof Error ? e.message : "重新生成失败");
    } finally {
      setRegenerating(false);
    }
  }

  function selectOpening(index: number) {
    if (!result) return;
    setOpeningIndex(index);
    const draft = composeDraft(result, index);
    applyDraft(draft);
    persistDraft(draft);
  }

  function goStep(n: number) {
    setStep(n);
    if (n === 3 && result) {
      // 回到成稿时优先恢复本机已保存的草稿，避免覆盖用户手改过的内容
      const saved = readPersistedDraft();
      applyDraft(saved && saved.trim() ? saved : composeDraft(result, openingIndex));
    }
  }

  function formatDraft() {
    const el = editorRef.current;
    if (!el) return;
    const text = el.textContent ?? "";
    const formatted = text.includes("\n") ? text : text.replace(/。/g, "。\n");
    el.textContent = formatted;
    persistDraft(formatted);
    flash("已按句分段");
  }

  function copyDraft() {
    const text = editorRef.current?.textContent ?? "";
    if (!text.trim()) {
      flash("还没有可复制的内容");
      return;
    }
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(text).then(() => flash("内容已复制"));
      return;
    }
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    document.body.removeChild(area);
    flash("内容已复制");
  }

  function restart() {
    setStep(1);
    setError("");
  }

  const needsInput = Boolean(result?.needsInput);

  // demo copywriter.html：主标题=公域获客，副标题=短视频文案改稿
  return (
    <LanqiBrainShell active="acquire" mainTitle="公域获客" subtitle="短视频文案改稿" crumb="/ 公域获客 / 文案改稿">
      <div className="lq-cw">
        <div className="lq-cw__hero">
          <h2>把已有口播稿，改得更抓人、更顺口</h2>
          <p>保留原意和事实，重点优化开头、节奏和短视频表达。</p>
        </div>

        <div className="lq-cw__stepper">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className={`lq-cw__step${step === s.n ? " on" : ""}${step > s.n ? " done" : ""}`}
            >
              <div className="lq-cw__dot">{s.n}</div>
              <div className="lq-cw__label">{s.label}</div>
            </div>
          ))}
        </div>

        {step === 0 && (
          <div className="lq-cw__panel">
            <div className="lq-cw__loading">
              <div className="lq-cw__spinner" />
              <p>{loadingText}</p>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="lq-cw__panel">
            <div className="lq-cw__card">
              <h3>原稿 <span className="sub">粘贴你的口播文案，AI 来改</span></h3>
              <textarea
                className="lq-cw__area"
                value={raw}
                maxLength={3000}
                placeholder="写一个获客文案"
                onChange={(e) => setRaw(e.target.value)}
              />
              <div className="lq-cw__counter">{raw.length}/3000</div>
            </div>

            <div className="lq-cw__card">
              <h3>这条视频主要用来</h3>
              <div className="lq-cw__seg">
                {PURPOSES.map((p) => (
                  <button key={p.value} className={purpose === p.value ? "on" : ""} onClick={() => setPurpose(p.value)}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="lq-cw__card">
              <h3>这次更想优化</h3>
              <div className="lq-cw__seg">
                {GOALS.map((g) => (
                  <button key={g.value} className={goal === g.value ? "on" : ""} onClick={() => setGoal(g.value)}>
                    {g.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="lq-cw__card">
              <h3>补充要求 <span className="sub">选填</span></h3>
              <textarea
                className="lq-cw__area small"
                value={extra}
                maxLength={500}
                placeholder="例如：面向美业老板、突出同城获客、不要硬广"
                onChange={(e) => setExtra(e.target.value)}
              />
              <div className="lq-cw__counter">{extra.length}/500</div>
            </div>

            {error && <p className="lq-moments__err">{error}</p>}

            {needsInput && result && (
              <div className="lq-moments__needs">
                <strong>⚠️ 这条素材信息还不够</strong>
                <p className="lq-moments__body">{result.body}</p>
                <p className="lq-moments__needs-hint">
                  补充一句真实的门店情况（做什么项目 / 目标顾客是谁 / 想让人做什么），我再按你的原意改稿，不编造内容。
                </p>
              </div>
            )}

            <div className="lq-cw__actions">
              <button className="lq-cw__primary" disabled={loading || !storeId} onClick={() => void revise("initial")}>
                诊断并改稿
              </button>
              <span className="lq-cw__cost">请核对事实后使用</span>
            </div>
          </div>
        )}

        {step === 2 && result && !needsInput && (
          <div className="lq-cw__panel">
            <div className="lq-cw__card plain">
              <h3>选一个开头</h3>
              <p className="lq-cw__hint">三种切入方式，选最适合你表达的一个。</p>
            </div>
            <div className="lq-cw__opts">
              {result.openings.map((o, index) => (
                <button
                  key={o.key}
                  className={`lq-cw__opt${openingIndex === index ? " on" : ""}`}
                  onClick={() => selectOpening(index)}
                >
                  <span className="lq-cw__opt-tag">{openingIndex === index ? "已选择" : "选择"}</span>
                  <h4>{o.title}</h4>
                  <p>{o.text}</p>
                  {o.why && <div className="lq-cw__opt-why">{o.why}</div>}
                </button>
              ))}
            </div>
            <div className="lq-cw__actions spread">
              <button className="lq-cw__ghost" onClick={() => goStep(1)}>上一步：原稿</button>
              <button className="lq-cw__primary" onClick={() => goStep(3)}>下一步：编辑成稿</button>
            </div>
          </div>
        )}

        {step === 3 && result && !needsInput && (
          <div className="lq-cw__panel">
            <div className="lq-cw__editor">
              <div className="lq-cw__editor-hint">开头与正文已合并。<b>点击文字即可修改</b>，修改会自动保存在本机。</div>
              <div
                className="lq-cw__editor-box"
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                onInput={(e) => persistDraft((e.target as HTMLDivElement).textContent ?? "")}
              />
              <div className="lq-cw__tools">
                <button className="lq-cw__tool" disabled={regenerating} onClick={() => void revise("regenerate")}>
                  {regenerating ? "🔄 重新生成中…" : "🔄 重新生成正文"}
                </button>
                <button className="lq-cw__tool" onClick={formatDraft}>📝 一键分段</button>
                <button className="lq-cw__tool" onClick={copyDraft}>📋 复制文案</button>
              </div>
            </div>
            <div className="lq-cw__notice">
              <h3>发布前请确认</h3>
              <p>请确认是否使用 AI 工具，以及是否有具体案例数据。</p>
            </div>
            {result.checks.length > 0 && (
              <div className="lq-moments__checks">
                {result.checks.map((c, i) => (
                  <div key={i} className={c.ok ? "ok" : "warn"}>{c.ok ? "✓" : "!"} {c.label}：{c.detail}</div>
                ))}
              </div>
            )}
            {error && <p className="lq-moments__err">{error}</p>}
            <div className="lq-cw__actions spread">
              <button className="lq-cw__ghost" onClick={() => goStep(2)}>上一步：开头</button>
              <button className="lq-cw__primary" onClick={() => goStep(4)}>下一步：标题与封面</button>
            </div>
          </div>
        )}

        {step === 4 && result && !needsInput && (
          <div className="lq-cw__panel">
            <div className="lq-cw__card plain">
              <h3>标题建议</h3>
            </div>
            <div className="lq-cw__suggest">
              {result.titles.map((t, i) => (
                <div key={i} className="lq-cw__suggest-card">
                  <span className="tag">{t.tag}</span>
                  <p>{t.text}</p>
                </div>
              ))}
            </div>

            <div className="lq-cw__card plain">
              <h3>封面建议</h3>
            </div>
            <div className="lq-cw__cover">
              <div>
                <div className="label">短视频封面 · 排版示意</div>
                <h3>{result.cover.title || "封面大字"}</h3>
              </div>
              <div className="desc">{result.cover.desc || "按正文内容配一张门店实拍画面"}</div>
            </div>

            <div className="lq-cw__collapse">
              <button className="lq-cw__collapse-hd" onClick={() => setWhyOpen((v) => !v)}>
                <span>为什么这样改</span><span className="arrow">{whyOpen ? "▼" : "▶"}</span>
              </button>
              {whyOpen && (
                <div className="lq-cw__collapse-bd">
                  <div className="lq-cw__diag">
                    <div className="lq-cw__diag-item">
                      <h5>核心意图</h5>
                      <p>{result.intent}</p>
                    </div>
                    {result.highlights.length > 0 && (
                      <div className="lq-cw__diag-item">
                        <h5>原稿亮点</h5>
                        <p>{result.highlights.map((h, i) => <span key={i}>• {h}<br /></span>)}</p>
                      </div>
                    )}
                    {result.scores.map((s) => (
                      <div key={s.key} className="lq-cw__diag-item">
                        <h5>{s.label} <span className="score">{s.score}/{s.max}</span></h5>
                        <p>{s.comment}{s.advice && <><br /><b>建议：</b>{s.advice}</>}</p>
                      </div>
                    ))}
                  </div>
                  {result.changes.length > 0 && (
                    <div className="lq-cw__changes">
                      <h3>关键改动</h3>
                      {result.changes.map((c, i) => (
                        <div key={i} className="part">
                          <strong>{c.part}</strong> 原：{c.before} 改：{c.after}
                          {c.reason && <span className="why">{c.reason}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="lq-cw__collapse">
              <button className="lq-cw__collapse-hd" onClick={() => setShootOpen((v) => !v)}>
                <span>拍摄和剪辑参考</span><span className="arrow">{shootOpen ? "▼" : "▶"}</span>
              </button>
              {shootOpen && (
                <div className="lq-cw__collapse-bd">
                  {result.style && <p className="lq-cw__style">{result.style}</p>}
                  <div className="lq-cw__shots">
                    {result.shots.map((s, i) => (
                      <div key={i} className="lq-cw__shot">
                        <div className="meta">{s.meta}</div>
                        <h5>画面</h5>
                        <p>{s.scene}</p>
                        <h5>剪辑</h5>
                        <p>{s.edit}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="lq-cw__actions spread">
              <button className="lq-cw__ghost" onClick={() => goStep(3)}>上一步：编辑成稿</button>
              <button className="lq-cw__ghost" onClick={() => goStep(1)}>返回原稿</button>
              <button className="lq-cw__primary" onClick={restart}>重新诊断并改稿</button>
            </div>
            <p className="lq-cw__foot">AI生成，请核对事实后使用</p>
          </div>
        )}

        {error && step === 4 && <p className="lq-moments__err">{error}</p>}
        {toast && <div className="lq-cw__toast">{toast}</div>}
      </div>
    </LanqiBrainShell>
  );
}
