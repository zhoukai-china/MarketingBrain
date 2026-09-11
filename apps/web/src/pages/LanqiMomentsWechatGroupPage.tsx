import { useEffect, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import { LanqiBrainShell } from "../components/lanqi-brain/LanqiBrainShell.js";
import { LanqiStoreGateBanner } from "../components/lanqi-brain/LanqiStoreGateBanner.js";
import { useLanqiStoreGate } from "../lib/use-lanqi-store-gate.js";

type Scene = "notice" | "activity" | "qa" | "reactivate" | "care";
interface CheckItem { ok: boolean; label: string; detail: string }
interface WechatResult { scene: Scene; tone: string; title: string; body: string; rawLen: number; newLen: number; checks: CheckItem[]; needsInput?: boolean }

const SCENES: Array<{ value: Scene; name: string }> = [
  { value: "notice", name: "群公告 / 门店动态" },
  { value: "activity", name: "活动通知" },
  { value: "qa", name: "客户答疑" },
  { value: "reactivate", name: "沉睡唤醒" },
  { value: "care", name: "节日 / 关怀" }
];

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

export function LanqiMomentsWechatGroupPage() {
  const [scene, setScene] = useState<Scene>("notice");
  const [topic, setTopic] = useState("");
  const [detail, setDetail] = useState("");
  const [tone, setTone] = useState("亲切大姐");
  const [result, setResult] = useState<WechatResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  // 门店可用性（Bug7/8/9）：与朋友圈共用同一判定，不再各写一套。
  const { gate, storeId, reload } = useLanqiStoreGate("微信群话术");
  // 「按钮为什么不能点」必须有可见答案（Bug10：老板填了内容、按钮还是灰的，页面上一个字都没说）。
  // 主题是可选的：只填「具体内容」就能生成，主题留空时由服务端从内容里派生标题。
  const trimmedDetail = detail.trim();
  const blockedReason = loading
    ? ""
    : !storeId
      ? gate.kind === "ready"
        ? ""
        : gate.blockedReason || "门店还没读出来，暂时不能生成。"
      : !trimmedDetail
        ? "还要填「具体内容」——把要说的话写进来，就能生成。"
        : "";
  const canGenerate = !loading && Boolean(storeId) && trimmedDetail.length > 0;

  useEffect(() => {
    if (!localStorage.getItem("store_os_token")) {
      window.location.replace(getAppPath("/login/lanqi"));
    }
  }, []);

  async function generate() {
    setLoading(true);
    setError("");
    try {
      const data = await readResponse(await fetch(apiPath("/lanqi/moments/wechat-group"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ storeId, scene, topic: topic.trim(), detail, tone })
      }));
      setResult(data.result as WechatResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 1500);
  }

  /** 与朋友圈页同一口径：结果卡片底部给「复制文案 / 重新生成」（WorkBuddy 复测 P2）。 */
  function copyBody() {
    const text = (result?.body ?? "").trim();
    if (!text) {
      flash("还没有可复制的内容");
      return;
    }
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(text).then(
        () => flash("群话术已复制"),
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
    flash("群话术已复制");
  }

  return (
    <LanqiBrainShell active="moments" subtitle="微信群营销话术 · 输入目的，AI 一键生成" crumb="/ 私域营销 / 微信群营销话术">
    <div className="lq-moments">
      <div className="lq-moments__backline">
        <a href={getAppPath("/lanqi/moments")} className="lq-moments__back">← 返回私域营销</a>
      </div>

      <div className="lq-moments__grid">
        <section className="lq-moments__left">
          <label>场景
            <select value={scene} onChange={(e) => setScene(e.target.value as Scene)}>
              {SCENES.map((s) => <option key={s.value} value={s.value}>{s.name}</option>)}
            </select>
          </label>
          <label>主题<span className="lq-moments__opt">可选</span>
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="不填就按「具体内容」自动起标题" />
          </label>
          <label data-lanqi-wechat-field="detail">具体内容<span className="lq-moments__req">必填</span>
            <textarea value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="把要说的具体内容写进来，例如活动时间、项目、优惠…" />
          </label>
          <label>口吻
            <select value={tone} onChange={(e) => setTone(e.target.value)}>
              <option>亲切大姐</option>
              <option>专业院长</option>
              <option>实在老板娘</option>
            </select>
          </label>
          <LanqiStoreGateBanner gate={gate} onRetry={reload} />
          {blockedReason && (
            <p className="lq-moments__reason" data-lanqi-wechat-blocked role="status">{blockedReason}</p>
          )}
          <button className="lq-moments__gen" disabled={!canGenerate} onClick={generate}>
            {loading ? "生成中…" : "生成群话术"}
          </button>
          {error && <p className="lq-moments__err">{error}</p>}
        </section>

        <section className="lq-moments__right">
          {!result && !loading && <div className="lq-moments__empty">填好左侧场景与内容，点「生成群话术」</div>}
          {result && (
            <>
              {result.needsInput ? (
                <div className="lq-moments__needs">
                  <strong>⚠️ 这条群消息素材还不够</strong>
                  <p className="lq-moments__body">{result.body}</p>
                  <p className="lq-moments__needs-hint">补充一个具体信息（时间 / 活动 / 优惠 / 名额）再生成，不编造内容。</p>
                </div>
              ) : (
                <>
                  <div className="lq-moments__meta">{result.title} · {result.rawLen} 字 → {result.newLen} 字</div>
                  <div className="lq-moments__body">{result.body}</div>
                  <div className="lq-moments__checks">
                    {result.checks.map((c, i) => (
                      <div key={i} className={c.ok ? "ok" : "warn"}>{c.ok ? "✓" : "!"} {c.label}：{c.detail}</div>
                    ))}
                  </div>
                  <div className="lq-cw__tools" data-lanqi-wechat-tools>
                    <button type="button" className="lq-cw__tool" data-lanqi-wechat-copy onClick={copyBody}>📋 复制文案</button>
                    <button type="button" className="lq-cw__tool" disabled={loading} data-lanqi-wechat-regen onClick={() => void generate()}>
                      {loading ? "重新生成中…" : "🔄 重新生成"}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>
      {toast && <div className="lq-cw__toast" role="status" data-lanqi-wechat-toast>{toast}</div>}
      </div>
    </LanqiBrainShell>
  );
}
