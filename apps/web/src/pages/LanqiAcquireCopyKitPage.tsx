// 兰琪美业门店 AI 经营大脑 · 公域获客 / 美业文案十件套（LQ-33）
// 用户 2026-09-15 口径：新增一张卡、独立计费。
// 合同不复制：后端直接读平台正式 Skill `baolu_content_creator`（prompt.md + contract.json）生成与校验。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import { LanqiBrainShell } from "../components/lanqi-brain/LanqiBrainShell.js";

interface StoreInfo { id: string; name: string; city: string | null }

const SECTIONS = [
  "一、选题策划",
  "二、口播逐字稿",
  "三、访谈话术",
  "四、拍摄脚本",
  "五、拍摄注意事项",
  "六、剪辑EDL",
  "七、发布标题与话题",
  "八、最佳发布时间",
  "九、评论区引导",
  "十、投流建议"
];

const PLATFORMS = [
  { k: "all", n: "三个平台都要" },
  { k: "dy", n: "抖音（同城）" },
  { k: "xhs", n: "小红书（种草）" },
  { k: "sph", n: "视频号（熟客）" }
];

const GOALS = [
  { k: "visit", n: "到店体验 / 团单" },
  { k: "private", n: "加店主 / 私域" },
  { k: "franchise", n: "招商 / 加盟" }
];

const BRIEF_PLACEHOLDER =
  "例：主推 399 元水光深层补水体验课，想吸引同城 25-35 岁、皮肤干燥暗沉的女生到店；顾客最怕被推销、怕没效果，我们全程不办卡、先做肤质检测。";

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
  if (!response.ok) {
    const error = new Error(body.message ?? body.code ?? "请求失败") as Error & { code?: string; body?: any };
    error.code = typeof body.code === "string" ? body.code : typeof body.error === "string" ? body.error : "";
    error.body = body;
    throw error;
  }
  return body;
}

function newRequestKey(): string {
  return (window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
}

export function LanqiAcquireCopyKitPage() {
  const [stores, setStores] = useState<StoreInfo[]>([]);
  const [storeId, setStoreId] = useState("");
  const [brief, setBrief] = useState("");
  const [platform, setPlatform] = useState("all");
  const [goal, setGoal] = useState("visit");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [content, setContent] = useState("");
  const [meta, setMeta] = useState<{ creditCost?: number; balance?: number }>({});
  /**
   * 幂等键：**同一份输入复用同一个 requestKey**。
   * 这样「点了一次、响应丢了、再点一次」走服务端缓存，不会重复扣积分；
   * 改了项目 / 人群 / 平台，才换新键（= 新的一次生成）。
   */
  const requestKeyRef = useRef<{ key: string; signature: string }>({ key: "", signature: "" });

  useEffect(() => {
    const token = localStorage.getItem("store_os_token");
    if (!token) {
      window.location.replace(getAppPath("/login"));
      return;
    }
    fetch(apiPath("/lanqi/stores"), { headers: authHeaders() })
      .then((response) => (response.ok ? response.json() : { stores: [] }))
      .then((body) => {
        const list: StoreInfo[] = body.stores ?? [];
        setStores(list);
        if (list.length) setStoreId((current) => current || list[0].id);
      })
      .catch(() => setStores([]));
  }, []);

  const storeName = useMemo(() => stores.find((item) => item.id === storeId)?.name ?? "", [stores, storeId]);

  const generate = useCallback(async () => {
    setError("");
    setNotice("");
    if (!storeId) { setError("门店信息还在加载，请稍后再试一次。"); return; }
    if (brief.trim().length < 12) {
      setError("先多写两句：这条内容主推哪个项目 / 套餐、想让谁看到、顾客的痛点是什么（至少 12 个字）。");
      return;
    }
    setBusy("正在按内容合同生成十件套（约 20–60 秒，比文案改稿慢一些）…");
    try {
      const signature = [storeId, platform, goal, brief.trim()].join("|");
      if (requestKeyRef.current.signature !== signature) {
        requestKeyRef.current = { key: newRequestKey(), signature };
      }
      const response = await fetch(apiPath("/lanqi/acquire/copy-kit"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ storeId, brief, platform, goal, requestKey: requestKeyRef.current.key })
      });
      const body = await readResponse(response);
      if (body.needsInput) {
        setNotice(body.message ?? "还差一些关键信息，补充后我再生成。");
        return;
      }
      setContent(body.result?.content ?? "");
      setMeta({ creditCost: body.creditCost, balance: body.balance });
      setNotice(`已生成十件套${body.cached ? "（这次复用上一次的结果，没有重复扣积分）" : `，本次消耗 ${body.creditCost ?? 0} 积分`}${typeof body.balance === "number" ? `，剩余 ${body.balance} 积分` : ""}。`);
    } catch (cause) {
      const failure = cause as Error & { code?: string; body?: any };
      if (failure.code === "insufficient_credits") {
        setError(`${failure.message ?? "积分不足"}（充值入口：右上角「我的 · 充值」）`);
      } else {
        setError(failure.message || "这次没有生成成功，没有扣积分，请重试。");
      }
    } finally {
      setBusy("");
    }
  }, [storeId, brief, platform, goal]);

  const copyAll = useCallback(async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setNotice("整份十件套已复制，可直接粘进文档或发给拍摄的人。");
    } catch {
      setError("浏览器不允许自动复制，请手动全选复制。");
    }
  }, [content]);

  const downloadMarkdown = useCallback(() => {
    if (!content) return;
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `兰琪文案十件套${storeName ? `_${storeName}` : ""}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [content, storeName]);

  return (
    <LanqiBrainShell active="acquire" subtitle="美业文案十件套 · 一次拿全套可发布内容" crumb="/ 公域获客 / 美业文案十件套">
      <div className="lq-vd__main">
        <section className="lq-vd__left">
          <div className="lq-vd__stage">美业文案十件套 · 说清项目和人群，一次拿全套</div>

          <h3 className="lq-vd__card-title">① 这条内容说什么 <span className="tag green">必填</span></h3>
          <p className="lq-vd__card-sub">用你自己的话说清楚就行，不用写成文案：主推什么项目 / 套餐、想让谁看到、顾客最在意或最怕什么。</p>
          <div className="lq-vd__field">
            <textarea
              id="lq-ck-brief"
              className="lq-vd__area"
              value={brief}
              placeholder={BRIEF_PLACEHOLDER}
              onChange={(event) => setBrief(event.target.value)}
            />
          </div>

          <h3 className="lq-vd__card-title" style={{ marginTop: 14 }}>② 发到哪 / 想要什么结果</h3>
          <div className="lq-vd__field">
            <label>投放平台</label>
            <div className="lq-vd__chips">
              {PLATFORMS.map((item) => (
                <button key={item.k} type="button" className={`lq-vd__chip${platform === item.k ? " on" : ""}`} onClick={() => setPlatform(item.k)}>
                  {item.n}
                </button>
              ))}
            </div>
          </div>
          <div className="lq-vd__field">
            <label>想要的结果</label>
            <div className="lq-vd__chips">
              {GOALS.map((item) => (
                <button key={item.k} type="button" className={`lq-vd__chip${goal === item.k ? " on" : ""}`} onClick={() => setGoal(item.k)}>
                  {item.n}
                </button>
              ))}
            </div>
          </div>

          <button className="lq-vd__btn primary block" type="button" data-lq-ck-submit disabled={Boolean(busy)} onClick={() => void generate()}>
            {busy ? "正在生成十件套…" : "✍️ 生成十件套"}
          </button>
          <div className="lq-vd__note">
            一次交付十节：{SECTIONS.join(" / ")}。按次计费，<b>没生成出来不扣积分</b>；同一句话重复点也不会重复扣。
          </div>
          {notice && <div className="lq-vd__note" data-lq-ck-notice>{notice}</div>}
          {error && <p className="lq-vd__err" data-lq-ck-error>{error}</p>}
          {busy && <p className="lq-vd__busy">{busy}</p>}
        </section>

        <section className="lq-vd__right">
          <div className="lq-vd__sec-title">
            交付内容 <span className="lq-vd__badge">{content ? "已生成" : "待生成"}</span>
          </div>
          {!content && (
            <>
              <div className="lq-vd__note">
                左边写完项目与人群 → 点「生成十件套」→ 这里会出现可直接复制／下载的整套内容；<br />
                缺关键信息时，平台会先问你，而不是编造门店事实。
              </div>
              <div className="lq-vd__placeholder" style={{ height: 180 }}>
                这里出十件套正文<br />（选题 / 口播 / 访谈 / 拍摄 / EDL / 标题 / 时间 / 评论 / 投流）
              </div>
            </>
          )}
          {content && (
            <>
              <div className="lq-vd__chips">
                <button className="lq-vd__btn ghost" type="button" onClick={() => void copyAll()}>📋 复制整份</button>
                <button className="lq-vd__btn ghost" type="button" onClick={downloadMarkdown}>⬇ 导出 Markdown</button>
                {meta.creditCost ? <span className="lq-vd__pill on">本次 {meta.creditCost} 积分</span> : null}
              </div>
              <pre className="lq-vd__shot" data-lq-ck-content style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", padding: 14 }}>{content}</pre>
            </>
          )}
        </section>
      </div>
    </LanqiBrainShell>
  );
}
