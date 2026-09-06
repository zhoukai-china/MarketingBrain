import { useEffect, useMemo, useRef, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";

type CopyDraft = { title: string; titleCandidates: string[]; selectedTitle: string; body: string; tags: string[]; callToAction: string; disclosure: string };
type Draft = { id: string; topic: string; copyDraft: CopyDraft; sourceMode: string; createdAt: string; updatedAt: string; knowledgeVersion: { note: string } };
type Direction = { id: string; name: string; positivePrompt: string; negativePrompt: string };
type Preview = { id: string; ratio: string; style: string; selectedDirectionId: string; directions: Direction[]; enhancer: { version: string; source: string }; updatedAt: string };
type MediaJob = { id: string; previewId?: string; status: string; progress: number; creditCost: number; billingStatus: string; assetStatus: string; outputUrl?: string; errorMessage?: string; savedAt?: string; createdAt: string; updatedAt: string };
type Package = { packageId: string; requestId: string; status: "text_ready" | "image_requested" | "partial_success" | "succeeded"; draft: Draft; preview?: Preview; jobs: MediaJob[]; actualCredits: number; imageError?: string; createdAt: string; updatedAt: string };
type PackageQuote = { quoteId: string; imageCount: number; estimatedCredits: number; canConfirm: boolean; billable: boolean; executionMode: "disabled" | "mock" | "real"; blockCode?: string; message: string };

function headers(): HeadersInit {
  const token = localStorage.getItem("store_os_token");
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}
function message(cause: unknown, fallback: string): string {
  return cause instanceof TypeError ? "网络暂时不可用，输入已保留，可以直接重试。" : cause instanceof Error ? cause.message : fallback;
}
async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("clipboard_permission_denied");
  }
}
function selectedDirection(preview?: Preview): Direction | undefined {
  return preview?.directions.find(item => item.id === preview.selectedDirectionId) ?? preview?.directions[0];
}
function packageStatus(item: Package): string {
  if (item.status === "succeeded") return "图文已完成并保存";
  if (item.status === "partial_success") return "文案已保存，图片需要处理";
  if (item.status === "image_requested") return "文案已保存，图片生成中";
  return "文案已保存，图片待生成";
}

export function LanqiContentStudioPage() {
  const [request, setRequest] = useState("");
  const [audience, setAudience] = useState("");
  const [goal, setGoal] = useState("获得附近顾客咨询");
  const [ratio, setRatio] = useState<"1:1" | "3:4" | "16:9" | "9:16">("3:4");
  const [style, setStyle] = useState<"premium" | "clean" | "warm" | "natural" | "clinical_clean">("premium");
  const [allowPeople, setAllowPeople] = useState(false);
  const [overlayTitle, setOverlayTitle] = useState(true);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [quote, setQuote] = useState<PackageQuote | null>(null);
  const [packages, setPackages] = useState<Package[]>([]);
  const [historicalImages, setHistoricalImages] = useState<MediaJob[]>([]);
  const [active, setActive] = useState<Package | null>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [copyBusy, setCopyBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const requestIdRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef(0);
  const settings = useMemo(() => ({ purpose: "xiaohongshu_cover", ratio, style, allowPeople, overlayTitle, rightsConfirmed }), [ratio, style, allowPeople, overlayTitle, rightsConfirmed]);
  const latestJob = active?.jobs?.[0];
  const visibleAssetJobs = useMemo(
    () => [...(active?.jobs ?? []), ...historicalImages].filter(job => job.status === "succeeded" && job.assetStatus === "persisted"),
    [active?.jobs, historicalImages],
  );

  useEffect(() => {
    if (!localStorage.getItem("store_os_token")) {
      localStorage.setItem("store_os_post_login_redirect", window.location.pathname);
      window.location.replace(getAppPath("/login/lanqi"));
      return;
    }
    void load();
  }, []);

  useEffect(() => {
    if (!rightsConfirmed) { setQuote(null); return; }
    const controller = new AbortController();
    void loadQuote(controller.signal);
    return () => controller.abort();
  }, [settings]);

  useEffect(() => {
    if (!busy) { setElapsed(0); return; }
    const timer = window.setInterval(() => setElapsed(Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000))), 500);
    return () => window.clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (!active || !latestJob || ["succeeded", "failed", "canceled"].includes(latestJob.status)) return;
    const timer = window.setInterval(() => void refreshPackage(active.packageId), 2200);
    return () => window.clearInterval(timer);
  }, [active?.packageId, latestJob?.id, latestJob?.status]);

  useEffect(() => {
    if (!active?.preview) return;
    if (["1:1", "3:4", "16:9", "9:16"].includes(active.preview.ratio)) setRatio(active.preview.ratio as typeof ratio);
    if (["premium", "clean", "warm", "natural", "clinical_clean"].includes(active.preview.style)) setStyle(active.preview.style as typeof style);
  }, [active?.packageId]);

  useEffect(() => {
    const controller = new AbortController();
    const urls: Record<string, string> = {};
    let disposed = false;
    void Promise.all(visibleAssetJobs.map(async job => {
      const response = await fetch(apiPath(`/lanqi/media/assets/${job.id}`), { headers: headers(), signal: controller.signal });
      if (!response.ok) throw new Error("image_asset_unavailable");
      urls[job.id] = URL.createObjectURL(await response.blob());
    })).then(() => {
      if (!disposed) setAssetUrls(urls);
    }).catch(cause => {
      if ((cause as { name?: string })?.name !== "AbortError" && !disposed) setNotice("图片已保存，但预览暂时无法读取；可以重试刷新或直接下载。");
    });
    return () => {
      disposed = true;
      controller.abort();
      Object.values(urls).forEach(url => URL.revokeObjectURL(url));
    };
  }, [visibleAssetJobs.map(job => job.id).join("|")]);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch(apiPath("/lanqi/content-studio/packages"), { headers: headers() });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "已保存图文暂时无法加载，请稍后重试。");
      const items = (body.packages ?? []) as Package[];
      setPackages(items); setHistoricalImages((body.historicalImages ?? []) as MediaJob[]);
      setActive(current => items.find(item => item.packageId === current?.packageId) ?? items[0] ?? null);
    } catch (cause) { setNotice(message(cause, "已保存图文暂时无法加载，请稍后重试。")); }
    finally { setLoading(false); }
  }

  async function loadQuote(signal?: AbortSignal) {
    try {
      const response = await fetch(apiPath("/lanqi/content-studio/package-quote"), { method: "POST", headers: headers(), body: JSON.stringify(settings), signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "费用预览暂时不可用。");
      setQuote(body as PackageQuote);
    } catch (cause) {
      if ((cause as { name?: string })?.name !== "AbortError") { setQuote(null); setNotice(message(cause, "费用预览暂时不可用。")); }
    }
  }

  async function createPackage() {
    if (busy || request.trim().length < 6 || !rightsConfirmed || !quote?.canConfirm) return;
    const requestId = requestIdRef.current ?? `lanqi-package-${crypto.randomUUID()}`;
    requestIdRef.current = requestId;
    const controller = new AbortController(); controllerRef.current = controller; startedAtRef.current = Date.now();
    setBusy(true); setNotice("");
    try {
      const response = await fetch(apiPath("/lanqi/content-studio/packages"), {
        method: "POST", headers: headers(), signal: controller.signal,
        body: JSON.stringify({ request, audience: audience || undefined, goal: goal || undefined, ...settings, quoteId: quote.quoteId, requestId, confirmed: true }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 207) throw new Error(body.message ?? "图文暂时没有生成成功，请稍后重试。");
      if (body.package) {
        const item = body.package as Package; upsertPackage(item); setActive(item);
        setNotice(response.status === 207 ? item.imageError ?? "文案已保存，图片暂未完成。" : body.idempotent ? "已恢复同一图文作品，没有重复生成或扣费。" : "图文任务已创建，图片完成后会自动保存。");
      }
    } catch (cause) {
      if ((cause as { name?: string })?.name === "AbortError") setNotice("已取消等待。已完成的文案可刷新恢复；未创建的图片不会扣费。");
      else setNotice(message(cause, "图文暂时没有生成成功，请稍后重试。"));
    } finally { if (controllerRef.current === controller) controllerRef.current = null; setBusy(false); }
  }

  function cancelCreate() {
    controllerRef.current?.abort();
    if (active && latestJob && !["succeeded", "failed", "canceled"].includes(latestJob.status)) void cancelPackage(active.packageId);
  }

  async function cancelPackage(packageId: string) {
    try {
      const response = await fetch(apiPath(`/lanqi/content-studio/packages/${encodeURIComponent(packageId)}/cancel`), { method: "POST", headers: headers(), body: "{}" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "当前任务不能取消。");
      if (body.package) { upsertPackage(body.package); setActive(body.package); }
    } catch (cause) { setNotice(message(cause, "当前任务不能取消。")); }
  }

  async function refreshPackage(packageId: string) {
    try {
      const response = await fetch(apiPath(`/lanqi/content-studio/packages/${encodeURIComponent(packageId)}/refresh`), { method: "POST", headers: headers(), body: "{}" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "图片状态暂时无法刷新。");
      if (body.package) { upsertPackage(body.package); setActive(current => current?.packageId === packageId ? body.package : current); }
    } catch (cause) { setNotice(message(cause, "图片状态暂时无法刷新。")); }
  }

  async function retryImage(item: Package) {
    if (!quote?.canConfirm || busy) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch(apiPath(`/lanqi/content-studio/packages/${encodeURIComponent(item.packageId)}/retry-image`), {
        method: "POST", headers: headers(), body: JSON.stringify({ quoteId: quote.quoteId, requestId: `lanqi-image-retry-${crypto.randomUUID()}`, confirmed: true }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 207) throw new Error(body.message ?? "图片重试没有成功。");
      if (body.package) { upsertPackage(body.package); setActive(body.package); }
      setNotice(response.status === 207 ? body.package?.imageError ?? "图片重试失败，文案仍已保存。" : "只重新创建了图片任务，文案没有重复生成或计费。");
    } catch (cause) { setNotice(message(cause, "图片重试没有成功。")); }
    finally { setBusy(false); }
  }

  async function selectTitle(value: string) {
    if (!active || value === active.draft.copyDraft.selectedTitle) return;
    try {
      const response = await fetch(apiPath(`/lanqi/content-studio/drafts/${active.draft.id}`), { method: "PATCH", headers: headers(), body: JSON.stringify({ selectedTitle: value }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("标题选择暂时无法保存。");
      const next = { ...active, draft: body.draft as Draft }; upsertPackage(next); setActive(next); setNotice("选中标题已保存，刷新后仍会保留。");
    } catch (cause) { setNotice(message(cause, "标题选择暂时无法保存。")); }
  }

  async function copyAll() {
    if (!active) return;
    const copy = active.draft.copyDraft;
    const content = [copy.selectedTitle || copy.title, copy.body, copy.tags.join(" "), copy.callToAction].filter(Boolean).join("\n\n");
    setCopyBusy(true);
    try { await copyText(content); setNotice("全部文字已复制。"); }
    catch { setNotice("浏览器没有允许复制，请检查剪贴板权限后重试。"); }
    finally { setCopyBusy(false); }
  }

  async function downloadImage(job: MediaJob) {
    setDownloadBusy(true);
    try {
      const response = await fetch(apiPath(`/lanqi/media/assets/${job.id}/download`), { headers: headers() });
      if (!response.ok) throw new Error("图片下载失败，请稍后重试。");
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `lanqi-xhs-${job.id.slice(0, 8)}.${blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png"}`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url); setNotice("图片下载已开始。");
    } catch (cause) { setNotice(message(cause, "图片下载失败，请稍后重试。")); }
    finally { setDownloadBusy(false); }
  }

  async function downloadAll() {
    if (!active) return;
    for (const job of active.jobs.filter(job => job.status === "succeeded" && job.assetStatus === "persisted")) await downloadImage(job);
  }
  function upsertPackage(item: Package) { setPackages(items => [item, ...items.filter(existing => existing.packageId !== item.packageId)]); }
  function resetRequestIdentity() { requestIdRef.current = null; }

  const createDisabled = busy || request.trim().length < 6 || !rightsConfirmed || !quote?.canConfirm;
  const direction = selectedDirection(active?.preview);
  const readyImages = active?.jobs.filter(job => job.status === "succeeded" && job.assetStatus === "persisted") ?? [];

  return <div className="lanqiContentPage lanqiPackagePage">
    <header className="lanqiContentHeader"><button onClick={() => window.location.href = getAppPath("/my-ai")}>兰琪美业 <span>小红书图文生成</span></button><div><button onClick={() => window.location.href = getAppPath("/lanqi/business-qa")}>经营问答</button><button onClick={() => window.location.href = getAppPath("/lanqi/store-profile")}>经营档案</button><button onClick={() => window.location.href = getAppPath("/lanqi/execution-plan")}>执行方案</button></div></header>
    <main>
      <section className="lanqiContentHero"><p>兰琪 AI · 小红书图文生成</p><h1>说一次需求，拿到完整图文</h1><span>系统会在同一个任务内生成文案、专业配图提示词和真实图片，并统一保存。你不需要复制提示词或跳转其他页面。</span></section>
      <section className="lanqiContentGrid lanqiPackageGrid">
        <article className="lanqiContentBrief lanqiPackageBrief">
          <div className="sectionKicker">一次输入</div><h2>这次想发什么</h2>
          <label>图文需求<textarea value={request} onChange={event => { setRequest(event.target.value); resetRequestIdentity(); }} placeholder="例如：做一篇初秋补水护理的小红书图文，温柔高级，不出现顾客正脸，吸引附近上班族咨询。" /></label>
          <div className="lanqiPackageFields"><label>目标人群<input value={audience} onChange={event => { setAudience(event.target.value); resetRequestIdentity(); }} placeholder="例如：附近上班族（可不填）" /></label><label>发布目标<input value={goal} onChange={event => { setGoal(event.target.value); resetRequestIdentity(); }} /></label><label>图片画幅<select value={ratio} onChange={event => { setRatio(event.target.value as typeof ratio); resetRequestIdentity(); }}><option value="3:4">3:4 小红书竖图</option><option value="1:1">1:1 方图</option><option value="9:16">9:16 竖屏</option><option value="16:9">16:9 横图</option></select></label><label>视觉风格<select value={style} onChange={event => { setStyle(event.target.value as typeof style); resetRequestIdentity(); }}><option value="premium">温柔高级</option><option value="clean">干净清晰</option><option value="warm">温暖亲和</option><option value="natural">自然真实</option><option value="clinical_clean">专业洁净</option></select></label></div>
          <label className="lanqiPackageCheck"><input type="checkbox" checked={allowPeople} onChange={event => { setAllowPeople(event.target.checked); resetRequestIdentity(); }} />允许出现经授权人物</label><label className="lanqiPackageCheck"><input type="checkbox" checked={overlayTitle} onChange={event => { setOverlayTitle(event.target.checked); resetRequestIdentity(); }} />为中文标题保留后期叠字安全区</label><label className="lanqiPackageCheck"><input type="checkbox" checked={rightsConfirmed} onChange={event => { setRightsConfirmed(event.target.checked); resetRequestIdentity(); }} />我确认本次品牌、图片和人物素材均有权使用</label>
          <div className="lanqiPackageQuote" aria-live="polite"><b>预计积分：{quote?.estimatedCredits ?? "—"}</b><span>图片数量：{quote?.imageCount ?? 1} 张</span><p>{rightsConfirmed ? quote?.message ?? "正在核对报价与可用额度…" : "确认素材权利后显示本次报价；点击主按钮即确认该次报价。"}</p></div>
          <div className="lanqiPackagePrimaryRow"><button disabled={createDisabled} onClick={() => void createPackage()}>{busy ? "正在生成图文…" : quote?.blockCode === "quota_exhausted" ? "当前图文生图额度不足" : "生成小红书图文"}</button>{busy && <button className="secondary" onClick={cancelCreate}>取消</button>}</div>
          {busy && <div className="lanqiPackageProgress" role="status"><b>统一任务处理中</b><span>已耗时 {elapsed} 秒</span><p>{elapsed < 15 ? "正在核对门店事实并生成标题与正文…" : elapsed < 35 ? "正在完成专业图片提示词…" : "仍在处理，可取消；文案失败不会创建图片，已完成内容可刷新恢复。"}</p></div>}
          <small>不会自动发布、投流、充值或发送消息；重复点击和刷新使用同一请求编号，不重复生图或扣费。</small>
        </article>
        <article className="lanqiContentFlow lanqiPackagePromise"><div className="sectionKicker">一次交付</div><h2>一套可直接使用的图文</h2><ol><li><b>3个标题候选</b><span>选择后保存，刷新仍保留</span></li><li><b>正文、标签与承接</b><span>只使用已确认门店事实</span></li><li><b>真实图片</b><span>生成成功后自动保存，可逐张或全部下载</span></li><li><b>安全费用闭环</b><span>部分失败保留文案，只重试图片不重复生成文案</span></li></ol></article>
      </section>
      {notice && <section className="lanqiContentNotice" aria-live="polite">{notice}</section>}
      {active && <section className="lanqiContentOutput lanqiPackageOutput">
        <div className="lanqiOutputHeading"><div><div className="sectionKicker">完整图文作品</div><h2>{active.draft.copyDraft.selectedTitle || active.draft.copyDraft.title}</h2></div><div className="lanqiPackageOutputActions"><button className="secondary" disabled={copyBusy} onClick={() => void copyAll()}>{copyBusy ? "复制中…" : "复制全部文字"}</button>{readyImages.length > 1 && <button className="secondary" disabled={downloadBusy} onClick={() => void downloadAll()}>下载全部图片</button>}</div></div>
        <p className={`lanqiPackageStatus ${active.status}`}>{packageStatus(active)} · {new Date(active.updatedAt).toLocaleString("zh-CN")} · 实际积分 {active.actualCredits}</p>
        <div className="lanqiPackageResultGrid"><article className="lanqiCopyCard"><h3>3个标题候选</h3><div className="lanqiTitleCandidates">{active.draft.copyDraft.titleCandidates.map(title => <button key={title} className={title === active.draft.copyDraft.selectedTitle ? "active" : ""} onClick={() => void selectTitle(title)}>{title}</button>)}</div><h3>完整正文</h3><pre className="lanqiCopy">{active.draft.copyDraft.body}</pre><h3>话题标签</h3><p className="lanqiTags">{active.draft.copyDraft.tags.join(" ")}</p><h3>互动与承接</h3><p>{active.draft.copyDraft.callToAction}</p></article>
          <article className="lanqiPackageImages"><h3>真实图片预览</h3>{readyImages.length ? readyImages.map(job => <figure key={job.id}>{assetUrls[job.id] ? <img src={assetUrls[job.id]} alt="兰琪小红书配图" /> : <div className="lanqiPackageImagePending">正在安全读取图片…</div>}<figcaption><span>已安全保存，不使用供应商临时链接</span><button className="secondary" disabled={downloadBusy} onClick={() => void downloadImage(job)}>下载图片</button></figcaption></figure>) : latestJob && !["failed", "canceled"].includes(latestJob.status) ? <div className="lanqiPackageImagePending"><b>图片生成中 · {latestJob.progress}%</b><button className="secondary" onClick={() => void refreshPackage(active.packageId)}>刷新状态</button></div> : <div className="lanqiPackageImagePending"><b>图片暂未完成</b><p>{active.imageError ?? latestJob?.errorMessage ?? "文案已经保存，可在确认当前费用后只重试图片。"}</p><button disabled={!quote?.canConfirm || busy} onClick={() => void retryImage(active)}>只重试图片（预计 {quote?.estimatedCredits ?? "—"} 积分）</button></div>}</article>
        </div>
        {active.draft.sourceMode === "controlled_draft" && <p className="lanqiDisclosure">受控草稿（专业模型未完成）：仅供继续编辑，不能视为专业生成结果。</p>}
        <p className="lanqiDisclosure">{active.draft.copyDraft.disclosure}</p><p className="lanqiKnowledgeState">知识状态：{active.draft.knowledgeVersion.note}</p>
        {active.preview && <details className="lanqiPackageAdvanced"><summary>高级详情 / 调整图片</summary><p>图片提示词是本图文任务的内部阶段，主流程不需要复制。</p><h3>正向图片提示词</h3><pre>{direction?.positivePrompt}</pre><h3>负向提示词</h3><pre>{direction?.negativePrompt}</pre></details>}
      </section>}
      <section className="lanqiContentHistory"><div className="sectionKicker">本店作品</div><div className="lanqiHistoryHeading"><h2>已保存的小红书图文</h2><button className="secondary" disabled={loading} onClick={() => void load()}>{loading ? "加载中…" : "刷新"}</button></div>{loading ? <p>正在读取本店图文…</p> : packages.length ? packages.map(item => <button key={item.packageId} className={active?.packageId === item.packageId ? "active" : ""} onClick={() => setActive(item)}><b>{item.draft.copyDraft.selectedTitle || item.draft.copyDraft.title}</b><span>{packageStatus(item)} · {new Date(item.updatedAt).toLocaleString("zh-CN")}</span></button>) : <p>还没有图文作品。生成后只在本门店工作区保存。</p>}</section>
      {historicalImages.length > 0 && <section className="lanqiContentHistory lanqiLegacyImages"><div className="sectionKicker">历史兼容</div><h2>旧图片工作室资产</h2><p>以下图片来自旧版独立图片流程，不冒充为当前文案的配图；可继续查看和下载。</p><div className="lanqiLegacyImageGrid">{historicalImages.filter(job => job.status === "succeeded").map(job => <figure key={job.id}>{assetUrls[job.id] ? <img src={assetUrls[job.id]} alt="旧版兰琪图片资产" /> : <div className="lanqiPackageImagePending">正在安全读取图片…</div>}<button className="secondary" onClick={() => void downloadImage(job)}>下载图片</button></figure>)}</div></section>}
    </main>
  </div>;
}
