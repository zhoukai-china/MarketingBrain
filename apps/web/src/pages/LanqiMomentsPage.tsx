import { useEffect, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import { LanqiBrainShell } from "../components/lanqi-brain/LanqiBrainShell.js";
import { LanqiStoreGateBanner } from "../components/lanqi-brain/LanqiStoreGateBanner.js";
import { useLanqiStoreGate } from "../lib/use-lanqi-store-gate.js";

type Mode = "fast" | "pro";
type Pillar = "work" | "problem" | "method" | "case" | "value" | "life" | "invite";

const PILLAR_META: Record<Pillar, { name: string; pct: number; fields: Array<{ key: string; label: string; required: boolean }> }> = {
  work: { name: "工作现场", pct: 35, fields: [{ key: "storeName", label: "门店名称", required: true }, { key: "today", label: "今天店里发生了什么", required: true }] },
  problem: { name: "客户问题", pct: 30, fields: [{ key: "storeName", label: "门店名称", required: true }, { key: "concern", label: "客户常见的困扰", required: true }, { key: "view", label: "你的观点 / 解法", required: true }] },
  method: { name: "方法论", pct: 15, fields: [{ key: "storeName", label: "门店名称", required: true }, { key: "method", label: "你想分享的方法", required: true }] },
  case: { name: "案例证据", pct: 10, fields: [{ key: "storeName", label: "门店名称", required: true }, { key: "clientCase", label: "客户案例 · 脱敏", required: true }, { key: "result", label: "效果 / 成果", required: true }] },
  value: { name: "价值观边界", pct: 4, fields: [{ key: "storeName", label: "门店名称", required: true }, { key: "stance", label: "你想表达的立场 / 边界", required: true }] },
  life: { name: "生活温度", pct: 3, fields: [{ key: "storeName", label: "门店名称", required: true }, { key: "life", label: "生活片段", required: true }] },
  invite: { name: "软邀约", pct: 3, fields: [{ key: "storeName", label: "门店名称", required: true }, { key: "invite", label: "活动 / 邀请内容", required: true }] }
};

interface CheckItem { ok: boolean; label: string; detail: string }
interface Issue { t: string; why: string }
interface MomentsResult {
  mode: Mode; pillar?: Pillar; goal?: string; tone?: string; level: string; keepMine: boolean;
  body: string; raw: string; rawLen: number; newLen: number; rawScore: number; newScore: number;
  issues: Issue[]; checks: CheckItem[]; placeholder: boolean; needsInput?: boolean; traceId?: string;
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("store_os_token");
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

async function readResponse(response: Response): Promise<any> {
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    localStorage.removeItem("store_os_token");
    window.location.replace(getAppPath("/login/lanqi"));
    throw new Error("登录已失效");
  }
  if (!response.ok) throw new Error(body.message ?? body.error ?? "请求失败");
  return body;
}

function placeholderCaptions(result: MomentsResult): string[] {
  if (result.pillar === "work") return ["今天店里发生了什么", "护理进行中", "客人反馈（脱敏）"];
  if (result.pillar === "case") return ["护理前", "护理后", "客人授权截图"];
  if (result.pillar === "life") return ["生活片段", "店里一角", "一句话心情"];
  if (result.pillar === "invite") return ["活动感画面", "门店环境", "时间 / 名额卡"];
  return ["门店环境实拍", "护理过程特写", "到店体验瞬间"];
}

async function downloadSuggestionPng(name: string, texts: string[]): Promise<void> {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const g = ctx.createLinearGradient(0, 0, 640, 480);
  g.addColorStop(0, "#fbf4ec");
  g.addColorStop(1, "#f4a261");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 640, 480);
  ctx.fillStyle = "#5b4636";
  ctx.font = "bold 30px sans-serif";
  ctx.fillText(name, 34, 70);
  ctx.font = "22px sans-serif";
  texts.forEach((t, i) => ctx.fillText(`${i + 1}. ${t}`, 34, 160 + i * 52));
  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.font = "17px sans-serif";
  ctx.fillText("配图建议 · 占位示例（正式 AI 配图待能力开通后替换）", 34, 430);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}-配图建议.png`;
  a.click();
  URL.revokeObjectURL(url);
}

export function LanqiMomentsPage() {
  const [mode, setMode] = useState<Mode>("fast");
  const [raw, setRaw] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [goal, setGoal] = useState("visit");
  const [tone, setTone] = useState("亲切大姐");
  const [level, setLevel] = useState("std");
  const [keepMine, setKeepMine] = useState(false);
  const [pillar, setPillar] = useState<Pillar>("work");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [result, setResult] = useState<MomentsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [aiImg, setAiImg] = useState<{ url: string; assetId: string; loading: boolean; error: string }>({ url: "", assetId: "", loading: false, error: "" });
  // 门店可用性（Bug7/8/9）：能不能生成、为什么不能、去哪解决，全部由这一个判定给出。
  const { gate, storeId, reload } = useLanqiStoreGate("朋友圈获客");

  useEffect(() => {
    if (!localStorage.getItem("store_os_token")) {
      window.location.replace(getAppPath("/login/lanqi"));
    }
  }, []);

  async function generate() {
    setLoading(true);
    setError("");
    try {
      const body = mode === "fast"
        ? { storeId, mode, raw, goal, tone, level, keepMine }
        : { storeId, mode, pillar, fields };
      const data = await readResponse(await fetch(apiPath("/lanqi/moments/upgrade"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body)
      }));
      setResult(data.result as MomentsResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  async function generateRealImage() {
    if (!result || !storeId) return;
    setAiImg({ url: "", assetId: "", loading: true, error: "" });
    try {
      const caption = `${placeholderCaptions(result)[0]}｜${result.goal ? FAST_GOAL_NAME(result.goal) : ""}`.trim();
      const data = await readResponse(await fetch(apiPath("/lanqi/moments/image"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ storeId, caption, requestKey: result.traceId ?? undefined })
      }));
      // 取图必须校验状态码：此前直接把响应体当图片塞进 <img>，
      // 403/500 的 JSON 错误体会渲染成破图（QA-20260910-017）。
      const assetResponse = await fetch(apiPath(data.asset.url), { headers: authHeaders() });
      if (!assetResponse.ok) throw new Error(`配图读取失败（${assetResponse.status}），请重试`);
      const contentType = assetResponse.headers.get("content-type") ?? "";
      if (!contentType.startsWith("image/")) throw new Error("配图读取失败：返回的不是图片，请重试");
      const blob = await assetResponse.blob();
      setAiImg({ url: URL.createObjectURL(blob), assetId: data.asset.assetId, loading: false, error: "" });
    } catch (e) {
      setAiImg({ url: "", assetId: "", loading: false, error: e instanceof Error ? e.message : "配图生成失败" });
    }
  }

  function setField(key: string, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 1500);
  }

  /**
   * 「复制文案」：WorkBuddy 复测（2026-09-11）指出结果卡片没有任何可操作按钮，
   * 老板只能手动框选出稿。复制成功后给一条可见 toast；剪贴板 API 被浏览器拒绝时
   * 退回 `execCommand("copy")`（旧浏览器 / 非安全上下文）。
   */
  function copyBody() {
    const text = (result?.body ?? "").trim();
    if (!text) {
      flash("还没有可复制的内容");
      return;
    }
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(text).then(
        () => flash("文案已复制"),
        () => flash("复制失败，请手动选中复制")
      );
      return;
    }
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    document.body.removeChild(area);
    flash("文案已复制");
  }

  function onPickPhotos(files: FileList | null) {
    if (!files) return;
    const picked = Array.from(files);
    for (const file of picked) {
      if (photos.length >= 9) break;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setPhotos((prev) => (prev.length >= 9 ? prev : [...prev, reader.result as string]));
        }
      };
      reader.readAsDataURL(file);
    }
  }

  // demo moments.html 的 `#subTitle` 随模式切换；主标题固定为模块名。
  const subtitle = mode === "fast"
    ? "① 传图 + 粘原话 → ② AI 诊断升级 → ③ 对比微调后发布"
    : "① 选七柱类型 → ② 填对应内容 → ③ AI 生成本店老板朋友圈图文";

  return (
    <LanqiBrainShell active="moments" mainTitle="私域营销" subtitle={subtitle} crumb="/ 公域获客 / 私域营销">
    <div className="lq-moments">
      <div className="lq-moments__backline">
        <a href={getAppPath("/lanqi/moments")} className="lq-moments__back">← 返回私域营销板块</a>
      </div>

      {/* demo moments.html modeSwitcher()：模式卡 */}
      <div className="lq-md-wrap">
        <button type="button" className={`lq-md-card${mode === "fast" ? " on" : ""}`} onClick={() => { setMode("fast"); setResult(null); }}>
          {mode === "fast" && <span className="lq-md-card__ck">✓</span>}
          <div className="lq-md-card__top">
            <span className="lq-md-card__ic">⚡</span>
            <span className="lq-md-card__name">快速模式</span>
            <span className="lq-md-card__tag">30 秒出稿</span>
          </div>
          <div className="lq-md-card__desc">你已经写好了一条朋友圈，只是觉得发不出去。把图和原话给 AI，它帮你诊断问题、补钩子、补结尾，直接升级成能发的版本。</div>
          <div className="lq-md-card__flow">流程：传图 → 粘原话 → AI 升级 → 对比/微调 → 发布</div>
        </button>
        <button type="button" className={`lq-md-card${mode === "pro" ? " on" : ""}`} onClick={() => { setMode("pro"); setResult(null); }}>
          {mode === "pro" && <span className="lq-md-card__ck">✓</span>}
          <div className="lq-md-card__top">
            <span className="lq-md-card__ic">🎯</span>
            <span className="lq-md-card__name">专业模式 · 七柱</span>
            <span className="lq-md-card__tag g">体系化</span>
          </div>
          <div className="lq-md-card__desc">还没想好发什么。按七柱内容体系（工作现场 / 客户问题 / 方法论 / 案例证据 / 价值观边界 / 生活温度 / 软邀约）一步步填，AI 从零写出一条完整朋友圈。</div>
          <div className="lq-md-card__flow">流程：选七柱类型 → 填对应内容 → AI 生成 → 配图 → 发布</div>
        </button>
      </div>

      <div className="lq-moments__grid">
        <section className="lq-moments__left">
          {mode === "fast" ? (
            <>
              <div className="lq-moments__photos">
                <span>传图片（最多 9 张 · 仅本地预览，不上传）</span>
                <input id="lq-moments-photo-input" type="file" accept="image/*" multiple hidden onChange={(e) => { onPickPhotos(e.target.files); e.target.value = ""; }} />
                <label htmlFor="lq-moments-photo-input" className="lq-moments__photo-add">＋ 添加照片</label>
                {photos.length > 0 && (
                  <div className="lq-moments__photo-thumbs">
                    {photos.map((p, i) => (
                      <div key={i} className="lq-moments__photo">
                        <img src={p} alt={`预览 ${i + 1}`} />
                        <button onClick={() => setPhotos(photos.filter((_, x) => x !== i))}>×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <label>你的原话（至少 15 字）</label>
              <textarea value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="今天店里来了个客人，做了个清洁护理，皮肤亮了不少……" />
              <div className="lq-moments__row">
                <label>这条想达成
                  <select value={goal} onChange={(e) => setGoal(e.target.value)}>
                    <option value="engage">互动</option>
                    <option value="visit">到店</option>
                    <option value="sell">成交</option>
                    <option value="trust">信任</option>
                    <option value="back">复购</option>
                  </select>
                </label>
                <label>口吻
                  <select value={tone} onChange={(e) => setTone(e.target.value)}>
                    <option>亲切大姐</option>
                    <option>专业院长</option>
                    <option>实在老板娘</option>
                  </select>
                </label>
                <label>升级强度
                  <select value={level} onChange={(e) => setLevel(e.target.value)}>
                    <option value="light">轻改</option>
                    <option value="std">标准</option>
                    <option value="deep">深改</option>
                  </select>
                </label>
              </div>
              <label className="lq-moments__check"><input type="checkbox" checked={keepMine} onChange={(e) => setKeepMine(e.target.checked)} /> 保留原话（一字不改）</label>
            </>
          ) : (
            <>
              <div className="lq-moments__pillars">
                {(Object.keys(PILLAR_META) as Pillar[]).map((p) => (
                  <button key={p} className={pillar === p ? "on" : ""} onClick={() => { setPillar(p); setFields({}); setResult(null); }}>
                    {PILLAR_META[p].name}<em>{PILLAR_META[p].pct}%</em>
                  </button>
                ))}
              </div>
              {PILLAR_META[pillar].fields.map((f) => (
                <label key={f.key}>{f.label}{f.required && <b>*</b>}
                  <textarea value={fields[f.key] ?? ""} onChange={(e) => setField(f.key, e.target.value)} />
                </label>
              ))}
            </>
          )}
          <LanqiStoreGateBanner gate={gate} onRetry={reload} />
          <button className="lq-moments__gen" disabled={loading || !storeId} onClick={generate}>
            {loading ? "生成中…" : "生成朋友圈文案"}
          </button>
          {error && <p className="lq-moments__err">{error}</p>}
        </section>

        <section className="lq-moments__right">
          {!result && !loading && <div className="lq-moments__empty">填好左侧内容，点「生成」看升级后的文案</div>}
          {result && (
            <>
              {result.needsInput ? (
                <div className="lq-moments__needs">
                  <strong>⚠️ 这条素材信息还不够</strong>
                  <p className="lq-moments__body">{result.body}</p>
                  <p className="lq-moments__needs-hint">补充一个关键信息（客人是谁 / 做了什么 / 结果或价格）再生成，会得到更完整的朋友圈；不想编造内容。</p>
                </div>
              ) : (
              <>
              <div className="lq-moments__meta">
                {result.rawLen} 字 → {result.newLen} 字 · 内容分 {result.rawScore} → {result.newScore} · {result.level}
              </div>
              <div className="lq-moments__body">{result.body}</div>
              <div className="lq-moments__checks">
                {result.checks.map((c, i) => (
                  <div key={i} className={c.ok ? "ok" : "warn"}>{c.ok ? "✓" : "!"} {c.label}：{c.detail}</div>
                ))}
              </div>
              {/* WorkBuddy 复测 P2：结果卡片底部要有「复制文案 / 重新生成」，不能只靠手动选中。 */}
              <div className="lq-cw__tools" data-lanqi-moments-tools>
                <button type="button" className="lq-cw__tool" data-lanqi-moments-copy onClick={copyBody}>📋 复制文案</button>
                <button type="button" className="lq-cw__tool" disabled={loading} data-lanqi-moments-regen onClick={() => void generate()}>
                  {loading ? "重新生成中…" : "🔄 重新生成"}
                </button>
              </div>
              <div className="lq-moments__figs">
                {photos.length > 0 && <div className="lq-moments__fig-note">你已传 {photos.length} 张图，可用其中 1 张做封面</div>}
                {placeholderCaptions(result).map((cap, i) => (
                  <div className="lq-moments__fig" key={i}>
                    <div className="lq-moments__fig-ph">{cap}</div>
                    <button className="lq-moments__fig-dl" onClick={() => void downloadSuggestionPng(cap, placeholderCaptions(result))}>⬇ 下载配图建议</button>
                  </div>
                ))}
              </div>
              <div className="lq-moments__aiimg">
                <button className="lq-moments__aiimg-btn" disabled={aiImg.loading} onClick={() => void generateRealImage()}>
                  {aiImg.loading ? "真实配图生成中…" : "✨ 生成真实 AI 配图"}
                </button>
                {aiImg.error && <p className="lq-moments__err">{aiImg.error}</p>}
                {aiImg.url && (
                  <div className="lq-moments__aiimg-view">
                    <img src={aiImg.url} alt="AI 配图" />
                    <a href={aiImg.url} download={`moments-ai-${aiImg.assetId}.png`}>⬇ 保存图片</a>
                  </div>
                )}
              </div>
              {result.issues.length > 0 && (
                <div className="lq-moments__issues">
                  {result.issues.map((it, i) => <div key={i}>{it.t}：{it.why}</div>)}
                </div>
              )}
              </>
              )}
            </>
          )}
        </section>
      </div>
      {toast && <div className="lq-cw__toast" role="status" data-lanqi-moments-toast>{toast}</div>}
      </div>
    </LanqiBrainShell>
  );
}

function FAST_GOAL_NAME(goal: string): string {
  return ({ engage: "互动", visit: "到店", sell: "成交", trust: "信任", back: "复购" } as Record<string, string>)[goal] ?? "";
}
