import { useEffect, useMemo, useState } from "react";
import { apiPath, getAppPath } from "../lib/api.js";
import PersonaClipLabApp from "./PersonaClipLabApp.js";

interface SampleClip {
  id: string;
  filename: string;
  byteSize: number;
  durationSeconds: number;
  width: number;
  height: number;
  thumbnailUrl: string;
  temporary?: boolean;
}

type CropMode = "wide" | "speaker" | "product" | "evidence";

interface TimelineSegment {
  segmentId: string;
  sourceId: string;
  startSeconds: number;
  endSeconds: number;
  transcript: string;
  role: string;
  cropMode: CropMode;
  reason: string;
  highlightScore?: number;
  highlightTags?: string[];
  editableStartSeconds?: number;
  editableEndSeconds?: number;
  visual?: { summary: string; ocrText: string; matchScore: number; matched: boolean; reviewReason: string };
}

interface CandidateGroup { role: string; label: string; candidates: TimelineSegment[] }
interface ProductRange { sourceId: string; startSeconds: number; endSeconds: number }
interface ProductChapter {
  productId: string;
  name: string;
  ranges: ProductRange[];
  durationSeconds: number;
  confidence: number;
  reviewReason: string;
}
interface ProductCatalog {
  catalogId: string;
  products: ProductChapter[];
  unassignedRanges: ProductRange[];
  transcriptSegmentCount: number;
  analyzeMs: number;
}

interface ClaimFlag {
  segmentId: string;
  claim: string;
  requiresConfirmation: boolean;
  reason: string;
}

interface AssetMatch {
  id: string;
  role: string;
  queryZh: string;
  queryEn: string;
  sourcePolicy: "enterprise" | "stock";
  reason: string;
  status: "matched" | "search_available" | "human_required";
  matchedAsset?: { id: string; filename: string; type: string };
  searchLinks: Array<{ label: string; url: string }>;
}

interface RoughCutPlan {
  planId: string;
  title: string;
  summary: string;
  estimatedDurationSeconds: number;
  selected: TimelineSegment[];
  candidateGroups: CandidateGroup[];
  product?: { productId: string; name: string; ranges: ProductRange[] };
  assetNeeds: AssetMatch[];
  claimFlags: ClaimFlag[];
  humanChecklist: string[];
  transcriptSegmentCount: number;
  sourceCount: number;
  asrCalls: number;
  asrMode: "word_timestamp";
  storyStages: Array<{ role: string; label: string; count: number; complete: boolean }>;
  qualityFlags: string[];
  analyzeMs: number;
}

interface StockAsset {
  provider: "pexels" | "pixabay";
  id: string;
  title: string;
  pageUrl: string;
  previewUrl: string;
  downloadUrl: string;
  creator: string;
  durationSeconds?: number;
  licenseLabel: string;
}

interface StockSearchResponse {
  configured: boolean;
  query: string;
  results: StockAsset[];
  manualLinks: Array<{ label: string; url: string }>;
  notice: string;
}

interface RenderedResult {
  outputUrl: string;
  outputBytes: number;
  renderMs: number;
  segmentCount: number;
  brollCount: number;
  backgroundMusicUsed?: string;
  aiWork: string[];
  humanChecklist: string[];
  qualityFlags: string[];
  totalMs: number;
  unresolvedAssetCount: number;
  autoImportedAssetCount?: number;
  userProvidedAssetCount?: number;
  estimatedHumanMinutes: number;
  musicHandoff?: "jianying" | "mixed" | "none";
  expiresAt?: string;
}

interface UploadedMusic {
  id: string;
  filename: string;
  byteSize: number;
}

interface UploadedAsset {
  id: string;
  filename: string;
  byteSize: number;
  type: "video" | "image";
}

interface ClipperHandoff {
  sourceAgent: "acquisition";
  taskTitle: string;
  capabilityId?: string;
  summary?: string;
  createdAt: string;
}

function readClipperHandoff(): ClipperHandoff | null {
  try {
    const raw = sessionStorage.getItem("sitong_clipper_handoff");
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ClipperHandoff>;
    if (value.sourceAgent !== "acquisition" || !value.taskTitle || !value.createdAt) return null;
    return value as ClipperHandoff;
  } catch {
    return null;
  }
}

const storyTemplates = [
  { id: "evidence_conversion", icon: "证", title: "证据成交", desc: "产品强开头→信任证据→规格销量→价格→场景口感→行动", roles: ["hook", "evidence", "specification", "social_proof", "price", "benefit", "usage", "experience", "action"] },
  { id: "experience_recommendation", icon: "荐", title: "体验推荐", desc: "观点→好处→场景→证据→行动", roles: ["hook", "experience", "benefit", "usage", "evidence", "price", "action"] },
  { id: "audience_fit", icon: "人", title: "适合人群", desc: "人群问题→产品价值→证据→行动", roles: ["hook", "answer", "benefit", "specification", "evidence", "usage", "price", "action"] },
  { id: "question_answer", icon: "问", title: "问题解答", desc: "顾客疑问→回答→证明→行动", roles: ["hook", "answer", "evidence", "benefit", "objection", "price", "action"] }
];

export default function ClipLabApp() {
  const [mode, setMode] = useState<"commerce" | "persona">("commerce");
  const [handoff, setHandoff] = useState<ClipperHandoff | null>(() => readClipperHandoff());
  function clearHandoff(): void {
    sessionStorage.removeItem("sitong_clipper_handoff");
    setHandoff(null);
  }
  return <><nav className="clipModeSwitch" aria-label="视频类型"><button className={mode === "commerce" ? "isSelected" : ""} onClick={() => setMode("commerce")}><strong>带货视频</strong><span>按成交逻辑浓缩一条成片</span></button><button className={mode === "persona" ? "isSelected" : ""} onClick={() => setMode("persona")}><strong>人设 / 观点视频</strong><span>识别多个话题，生成多条成片</span></button></nav>{handoff && <section className="clipperHandoffBanner"><div><span>来自获客智能体</span><strong>{handoff.taskTitle}</strong><p>当前任务摘要已经带入。请上传与这项内容对应的直播或视频素材，再由自由组片工作台完成拆片和初剪。</p></div><button type="button" onClick={clearHandoff}>不再显示</button></section>}{mode === "persona" ? <PersonaClipLabApp /> : <CommerceClipLabApp />}</>;
}

function CommerceClipLabApp() {
  const [sourceMode, setSourceMode] = useState<"livestream" | "product">("livestream");
  const [samples, setSamples] = useState<SampleClip[]>([]);
  const [sampleIds, setSampleIds] = useState<string[]>([]);
  const [directProductName, setDirectProductName] = useState("");
  const [template, setTemplate] = useState("evidence_conversion");
  const [targetDurationSeconds, setTargetDurationSeconds] = useState(45);
  const [confirmedFacts, setConfirmedFacts] = useState("");
  const [personalAngle, setPersonalAngle] = useState("先展示真实证据，再说明家庭使用场景");
  const [loading, setLoading] = useState(true);
  const [uploadingSources, setUploadingSources] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [cataloging, setCataloging] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<RoughCutPlan | null>(null);
  const [catalog, setCatalog] = useState<ProductCatalog | null>(null);
  const [products, setProducts] = useState<ProductChapter[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [timeline, setTimeline] = useState<TimelineSegment[]>([]);
  const [selectedTimelineIndex, setSelectedTimelineIndex] = useState(0);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragCandidate, setDragCandidate] = useState<TimelineSegment | null>(null);
  const [previewSegment, setPreviewSegment] = useState<TimelineSegment | null>(null);
  const [assetMatches, setAssetMatches] = useState<AssetMatch[]>([]);
  const [musicMode, setMusicMode] = useState<"jianying" | "upload" | "none">("jianying");
  const [musicUpload, setMusicUpload] = useState<UploadedMusic | null>(null);
  const [uploadingMusic, setUploadingMusic] = useState(false);
  const [uploadedAssets, setUploadedAssets] = useState<Record<string, UploadedAsset>>({});
  const [uploadingAsset, setUploadingAsset] = useState("");
  const [claimsConfirmed, setClaimsConfirmed] = useState(false);
  const [searchingAsset, setSearchingAsset] = useState("");
  const [stockSearches, setStockSearches] = useState<Record<string, StockSearchResponse>>({});
  const [result, setResult] = useState<RenderedResult | null>(null);

  useEffect(() => {
    fetch(apiPath("/clip-lab/samples"))
      .then(async (response) => {
        if (!response.ok) throw new Error("无法读取可用视频");
        return response.json() as Promise<{ samples: SampleClip[] }>;
      })
      .then((data) => {
        setSamples(data.samples);
        setSampleIds(data.samples.slice(0, 2).map((sample) => sample.id));
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "读取素材失败"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!planning && !rendering && !cataloging) return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, [planning, rendering, cataloging]);

  const unresolvedClaims = useMemo(() => {
    const selectedIds = new Set(timeline.flatMap((segment) => [segment.segmentId, segment.segmentId.split("::")[0]]));
    return plan?.claimFlags.filter((flag) => flag.requiresConfirmation && selectedIds.has(flag.segmentId)) ?? [];
  }, [plan, timeline]);
  const timelineDuration = useMemo(() => timeline.reduce((sum, segment) => sum + segment.endSeconds - segment.startSeconds, 0), [timeline]);
  const selectedTimelineSegment = timeline[selectedTimelineIndex] ?? null;
  const activeProduct = products.find((product) => product.productId === selectedProductId);
  const currentProductName = sourceMode === "product" ? directProductName.trim() : activeProduct?.name ?? "";

  function changeSourceMode(nextMode: "livestream" | "product") {
    setSourceMode(nextMode);
    setCatalog(null); setProducts([]); setSelectedProductId(""); setPlan(null); setTimeline([]); setResult(null); setError("");
  }

  function toggleSample(sampleId: string) {
    setSampleIds((current) => current.includes(sampleId) ? current.filter((id) => id !== sampleId) : [...current, sampleId]);
    setCatalog(null);
    setProducts([]);
    setSelectedProductId("");
    setPlan(null);
  }

  async function identifyProducts() {
    if (!sampleIds.length || cataloging) return;
    setCataloging(true); setElapsed(0); setError(""); setPlan(null); setResult(null);
    try {
      const response = await fetch(apiPath("/clip-lab/product-catalog"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sampleIds, contextText: confirmedFacts })
      });
      const data = await response.json() as { catalog?: ProductCatalog; message?: string };
      if (!response.ok || !data.catalog) throw new Error(data.message ?? "商品分段失败");
      setCatalog(data.catalog); setProducts(data.catalog.products);
      setSelectedProductId(data.catalog.products[0]?.productId ?? "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "商品分段失败"); }
    finally { setCataloging(false); }
  }

  async function generatePlan() {
    if (sampleIds.length === 0 || planning || !currentProductName) return;
    if (sourceMode === "livestream" && (!catalog || !activeProduct)) return;
    setPlanning(true);
    setElapsed(0);
    setError("");
    setResult(null);
    setClaimsConfirmed(false);
    try {
      const response = await fetch(apiPath("/clip-lab/plan"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sampleIds, sourceMode, template: "evidence_conversion", targetDurationSeconds, confirmedFacts, personalAngle,
          catalogId: sourceMode === "livestream" ? catalog?.catalogId : undefined,
          productId: sourceMode === "livestream" ? activeProduct?.productId : undefined,
          productName: currentProductName,
          productRanges: sourceMode === "livestream" ? activeProduct?.ranges : samples.filter((sample) => sampleIds.includes(sample.id)).map((sample) => ({ sourceId: sample.id, startSeconds: 0, endSeconds: sample.durationSeconds }))
        })
      });
      const data = await response.json() as { plan?: RoughCutPlan; assetMatches?: AssetMatch[]; message?: string };
      if (!response.ok || !data.plan) throw new Error(data.message ?? "粗剪方案生成失败");
      setPlan(data.plan);
      setTemplate("evidence_conversion");
      setTimeline(data.plan.selected);
      setSelectedTimelineIndex(0);
      setAssetMatches(data.assetMatches ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "粗剪方案生成失败");
    } finally {
      setPlanning(false);
    }
  }

  function applyCommerceTemplate(templateId: string) {
    const selectedTemplate = storyTemplates.find((item) => item.id === templateId);
    if (!plan || !selectedTemplate) return;
    setTemplate(templateId);
    setTimeline((current) => {
      const roleRank = new Map(selectedTemplate.roles.map((role, index) => [role, index]));
      const arranged = current.filter((segment) => roleRank.has(segment.role));
      const usedSegmentIds = new Set(arranged.map((segment) => segment.segmentId));
      for (const role of selectedTemplate.roles) {
        if (arranged.some((segment) => segment.role === role)) continue;
        const candidate = plan.candidateGroups
          .find((group) => group.role === role)
          ?.candidates.find((item) => item.role === role && !usedSegmentIds.has(item.segmentId));
        if (candidate) {
          arranged.push(candidate);
          usedSegmentIds.add(candidate.segmentId);
        }
      }
      return arranged
        .filter((segment) => roleRank.has(segment.role))
        .filter((segment, index, list) => list.findIndex((item) => item.segmentId === segment.segmentId) === index)
        .sort((left, right) => (roleRank.get(left.role) ?? 99) - (roleRank.get(right.role) ?? 99));
    });
    setSelectedTimelineIndex(0);
  }

  function moveSegment(index: number, offset: number) {
    setTimeline((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const copy = [...current];
      const [item] = copy.splice(index, 1);
      copy.splice(target, 0, item);
      return copy;
    });
  }

  function updateSegment(index: number, patch: Partial<TimelineSegment>) {
    setTimeline((current) => current.map((segment, itemIndex) => itemIndex === index ? { ...segment, ...patch } : segment));
  }

  function dropSegment(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) return setDragIndex(null);
    setTimeline((current) => {
      const copy = [...current]; const [item] = copy.splice(dragIndex, 1); copy.splice(targetIndex, 0, item); return copy;
    });
    setSelectedTimelineIndex(targetIndex); setDragIndex(null);
  }

  function dropOnTimeline(targetIndex: number) {
    if (dragCandidate) {
      setTimeline((current) => {
        const existingIndex = current.findIndex((item) => isSameTimelineUse(item, dragCandidate));
        if (existingIndex >= 0) return current;
        const copy = [...current];
        copy.splice(Math.min(targetIndex, copy.length), 0, dragCandidate);
        return copy;
      });
      setSelectedTimelineIndex(Math.min(targetIndex, timeline.length));
      setDragCandidate(null);
      setDragIndex(null);
      return;
    }
    dropSegment(targetIndex);
  }

  function addCandidate(candidate: TimelineSegment, replace: boolean) {
    const existingIndex = timeline.findIndex((item) => isSameTimelineUse(item, candidate));
    if (replace && selectedTimelineSegment) {
      if (existingIndex === selectedTimelineIndex) return;
      if (existingIndex >= 0) {
        const copy = [...timeline];
        [copy[selectedTimelineIndex], copy[existingIndex]] = [copy[existingIndex], copy[selectedTimelineIndex]];
        setTimeline(copy);
        return;
      }
      setTimeline(timeline.map((item, index) => index === selectedTimelineIndex ? candidate : item));
      return;
    }
    if (existingIndex >= 0) {
      setSelectedTimelineIndex(existingIndex);
      return;
    }
    setTimeline([...timeline, candidate]);
    setSelectedTimelineIndex(timeline.length);
  }

  function removeTimelineSegment(index: number) {
    setTimeline((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setSelectedTimelineIndex((current) => Math.max(0, Math.min(current, timeline.length - 2)));
  }

  function updateProduct(productId: string, patch: Partial<ProductChapter>) {
    setProducts((current) => current.map((product) => product.productId === productId ? { ...product, ...patch } : product));
  }

  function updateProductRange(productId: string, rangeIndex: number, patch: Partial<ProductRange>) {
    setProducts((current) => current.map((product) => product.productId !== productId ? product : {
      ...product, ranges: product.ranges.map((range, index) => index === rangeIndex ? { ...range, ...patch } : range)
    }));
  }

  function mergeProductIntoPrevious(productIndex: number) {
    if (productIndex <= 0) return;
    const source = products[productIndex]; const target = products[productIndex - 1];
    setProducts((current) => current.filter((item) => item.productId !== source.productId).map((item) =>
      item.productId === target.productId ? { ...item, ranges: [...item.ranges, ...source.ranges], durationSeconds: item.durationSeconds + source.durationSeconds } : item));
    setSelectedProductId(target.productId);
  }

  async function rescanAssets() {
    if (!plan) return;
    const response = await fetch(apiPath(`/clip-lab/plans/${plan.planId}/assets`));
    const data = await response.json() as { assetMatches?: AssetMatch[] };
    setAssetMatches(data.assetMatches ?? []);
  }

  async function uploadSourceFiles(files: FileList | null) {
    if (!files?.length || uploadingSources) return;
    setUploadingSources(true);
    setError("");
    try {
      const uploaded: SampleClip[] = [];
      for (const file of Array.from(files).slice(0, 5)) {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch(apiPath("/clip-lab/uploads?kind=source"), { method: "POST", body: form });
        const data = await response.json() as { sample?: SampleClip; message?: string };
        if (!response.ok || !data.sample) throw new Error(data.message ?? `${file.name} 上传失败`);
        uploaded.push(data.sample);
      }
      setSamples((current) => [...uploaded, ...current.filter((item) => !uploaded.some((next) => next.id === item.id))]);
      setSampleIds((current) => [...new Set([...current, ...uploaded.map((item) => item.id)])].slice(0, 5));
      setCatalog(null); setProducts([]); setSelectedProductId(""); setPlan(null); setTimeline([]); setResult(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "视频上传失败");
    } finally {
      setUploadingSources(false);
    }
  }

  async function uploadMusicFile(file: File | undefined) {
    if (!file || uploadingMusic) return;
    setUploadingMusic(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(apiPath("/clip-lab/uploads?kind=music"), { method: "POST", body: form });
      const data = await response.json() as { music?: UploadedMusic; message?: string };
      if (!response.ok || !data.music) throw new Error(data.message ?? "音乐上传失败");
      setMusicUpload(data.music);
      setMusicMode("upload");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "音乐上传失败");
    } finally {
      setUploadingMusic(false);
    }
  }

  async function uploadAssetFile(need: AssetMatch, file: File | undefined) {
    if (!file || uploadingAsset) return;
    setUploadingAsset(need.id);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(apiPath("/clip-lab/uploads?kind=asset"), { method: "POST", body: form });
      const data = await response.json() as { asset?: UploadedAsset; message?: string };
      if (!response.ok || !data.asset) throw new Error(data.message ?? "补充素材上传失败");
      setUploadedAssets((current) => ({ ...current, [need.id]: data.asset! }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "补充素材上传失败");
    } finally {
      setUploadingAsset("");
    }
  }

  async function searchAsset(asset: AssetMatch) {
    setSearchingAsset(asset.id);
    setError("");
    try {
      const response = await fetch(apiPath(`/clip-lab/assets/search?q=${encodeURIComponent(asset.queryEn || asset.queryZh)}`));
      const data = await response.json() as StockSearchResponse & { message?: string };
      if (!response.ok) throw new Error(data.message ?? "素材搜索失败");
      setStockSearches((current) => ({ ...current, [asset.id]: data }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "素材搜索失败");
    } finally {
      setSearchingAsset("");
    }
  }

  async function importStock(assetNeedId: string, stock: StockAsset, query: string) {
    setSearchingAsset(assetNeedId);
    try {
      const response = await fetch(apiPath("/clip-lab/assets/import"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...stock, query, needId: assetNeedId })
      });
      const data = await response.json() as { message?: string };
      if (!response.ok) throw new Error(data.message ?? "素材导入失败");
      await rescanAssets();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "素材导入失败");
    } finally {
      setSearchingAsset("");
    }
  }

  async function renderPlan() {
    if (!plan || rendering) return;
    if (musicMode === "upload" && !musicUpload) {
      setError("请先选择并上传一首你有权使用的音乐，或者改选“到剪映选音乐”。");
      return;
    }
    setRendering(true);
    setElapsed(0);
    setError("");
    setResult(null);
    try {
      const response = await fetch(apiPath("/clip-lab/render-plan"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: plan.planId,
          claimsConfirmed,
          autoFillAssets: false,
          musicMode: "jianying",
          musicUploadId: musicMode === "upload" ? musicUpload?.id : undefined,
          assetUploads: Object.entries(uploadedAssets).map(([needId, asset]) => ({ needId, uploadId: asset.id })),
          selected: timeline.map(({ segmentId, cropMode, startSeconds, endSeconds }) => ({ segmentId, cropMode, startSeconds, endSeconds }))
        })
      });
      const data = await response.json() as { result?: RenderedResult; message?: string };
      if (!response.ok || !data.result) throw new Error(data.message ?? "成片生成失败");
      setResult(data.result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "成片生成失败");
    } finally {
      setRendering(false);
    }
  }

  return (
    <main className="clipLabPage">
      <header className="clipLabHeader">
        <a className="clipLabBrand" href={getAppPath("/agents")}><span className="clipLabLogo">思潼</span><span>自由组片智能体</span></a>
        <span className="clipLabStatus"><i /> 带货视频 · AI 初剪工作台</span>
      </header>

      <section className="clipLabHero clipLabHeroV2">
        <div>
          <span className="clipLabEyebrow">整场直播按商品拆分 · 每个商品独立成片</span>
          <h1>AI先找对素材，<br /><em>剪辑手再自由组片。</em></h1>
          <p>先把几小时直播按商品切成项目，再标出开头、证据、规格、价格、场景和行动等候选片段。系统按模板排出第一版，剪辑手像拼积木一样拖动、替换和微调。</p>
        </div>
        <div className="clipLabPromise"><strong>AI 会先为你完成</strong><div><span>01</span> 按商品分段与高光识别</div><div><span>02</span> 候选素材分类与成交排列</div><div><span>03</span> 导出干净初剪片到剪映精修</div></div>
      </section>

      <section className="clipCapabilityMap">
        <div className="clipCapabilityIntro"><span>从原始素材到可交给剪映精修的AI成片</span><h2>AI做完重复劳动，人只把三道关</h2><p>这条生产线的目标不是让人继续逐帧剪，而是把人工集中到事实、授权和最后的审美确认。</p></div>
        <div className="clipCapabilityStages">
          <article><i>AI</i><strong>理解内容</strong><span>逐字识别、画面与文字核对、成交信息切分</span></article>
          <article><i>AI</i><strong>组织成交</strong><span>语义浓缩、结构排序、节奏与完整结尾</span></article>
          <article><i>AI</i><strong>完成初剪</strong><span>按模板排列、音画连续、统一画幅与干净人声</span></article>
          <article className="human"><i>人</i><strong>自由组片</strong><span>拖动、替换、微调切点，再到剪映加字幕和音乐</span></article>
        </div>
      </section>

      <section className="clipV2Shell">
        <section className="clipV2Config">
          <StepHeader number="01" title="先确认你拿到的是哪一层素材" hint="整场直播先按商品切；已切商品素材直接进入第二步" />
          <div className="clipSourceModeGrid">
            <button className={sourceMode === "livestream" ? "isSelected" : ""} onClick={() => changeSourceMode("livestream")}><i>整</i><strong>整场直播</strong><span>可能有几个小时、包含多个商品，先识别换品边界。</span><b>{sourceMode === "livestream" ? "当前入口" : "选择"}</b></button>
            <button className={sourceMode === "product" ? "isSelected" : ""} onClick={() => changeSourceMode("product")}><i>品</i><strong>已切好的商品素材</strong><span>已经只讲一个商品，可以是一条或多条，直接切价格、规格、销量等细片段。</span><b>{sourceMode === "product" ? "当前入口" : "选择"}</b></button>
          </div>
          <label className="clipUploadSource">
            <input type="file" accept="video/mp4,video/quicktime,video/webm,.m4v" multiple onChange={(event) => uploadSourceFiles(event.target.files)} />
            <strong>{uploadingSources ? "正在上传视频…" : sourceMode === "livestream" ? "上传整场直播素材" : "上传已经切好的商品素材"}</strong>
            <span>{sourceMode === "livestream" ? "支持一场直播拆成多个文件上传；下一步会先按商品归组。" : "支持同一商品的一条或多条素材；不会再次错误拆成多个商品。"} 处理文件临时保留24小时。</span>
          </label>
          {loading ? <div className="clipLabLoading">正在读取素材…</div> : <div className="clipSourceGrid">
            {samples.map((sample) => <button key={sample.id} className={`clipSourceCard ${sampleIds.includes(sample.id) ? "isSelected" : ""}`} onClick={() => toggleSample(sample.id)}>
              <img src={apiPath(sample.thumbnailUrl)} alt={`${sample.filename} 预览`} />
              <span className="clipSourceInfo"><strong>{sample.filename}</strong><small>{formatDuration(sample.durationSeconds)} · {sample.width}×{sample.height} · {formatBytes(sample.byteSize)}</small></span>
              <b>{sampleIds.includes(sample.id) ? "已加入" : "加入"}</b>
            </button>)}
          </div>}

          {sourceMode === "livestream" ? <>
            <div className="clipLayerTransition"><b>流程第1步</b><strong>整场直播 → 商品片段</strong><span>先只解决“当前在讲哪个商品”，不在这里做成交剪辑。</span></div>
            <button className="clipPlanButton clipCatalogButton" onClick={identifyProducts} disabled={cataloging || sampleIds.length === 0}>
              {cataloging ? <><span className="clipSpinner" /> 正在识别换品边界 · {formatDuration(elapsed)}</> : `识别 ${sampleIds.length} 条素材里的商品章节`}
            </button>
          </> : <div className="clipDirectProductSetup"><div><b>流程第1步已完成</b><strong>你上传的已经是商品片段</strong><span>系统将把所选文件视为同一个商品的原始素材，不再做换品识别。</span></div><label>商品名称<input value={directProductName} onChange={(event) => setDirectProductName(event.target.value)} placeholder="例如：笨榨大豆油" maxLength={60} /></label></div>}
          {sourceMode === "livestream" && products.length > 0 && <div className="clipProductCatalog">
            <div className="clipCatalogSummary"><strong>识别到 {products.length} 个商品项目</strong><span>请先校正名称和起止时间；低置信度边界必须人工看一眼。</span></div>
            {products.map((product, productIndex) => <article key={product.productId} className={selectedProductId === product.productId ? "isSelected" : ""}>
              <button className="clipProductSelect" onClick={() => setSelectedProductId(product.productId)}><span>{String(productIndex + 1).padStart(2, "0")}</span><strong>{product.name}</strong><b>{formatDuration(product.durationSeconds)}</b></button>
              <label>商品名称<input value={product.name} onChange={(event) => updateProduct(product.productId, { name: event.target.value })} /></label>
              <div className="clipProductRanges">{product.ranges.map((range, rangeIndex) => <div key={`${range.sourceId}-${rangeIndex}`}><b>{range.sourceId}</b><label>开始<input type="number" step="0.1" min="0" value={roundTime(range.startSeconds)} onChange={(event) => updateProductRange(product.productId, rangeIndex, { startSeconds: Number(event.target.value) })} /></label><label>结束<input type="number" step="0.1" min={range.startSeconds + 1} value={roundTime(range.endSeconds)} onChange={(event) => updateProductRange(product.productId, rangeIndex, { endSeconds: Number(event.target.value) })} /></label></div>)}</div>
              <p>{Math.round(product.confidence * 100)}% 置信度 · {product.reviewReason}</p>
              {productIndex > 0 && <button className="clipMergeProduct" onClick={() => mergeProductIntoPrevious(productIndex)}>识别多了？合并到上一个商品</button>}
            </article>)}
          </div>}

          <StepHeader number="02" title="商品片段 → 价格、规格、销量、场景等细素材" hint="AI先把可用原话全部分类，暂时不限制你最后怎么组合" />
          <div className="clipSegmentationBrief">
            <div><b>这一环节只负责切细</b><span>价格可以切出1段、2段或更多；规格、销量、场景也一样。系统保留所有可用候选，不在这里限制成片时长。</span></div>
            <div className="clipSegmentationRoles"><span>开头</span><span>证据</span><span>规格</span><span>销量</span><span>价格</span><span>场景</span><span>行动</span></div>
            <label><span>已确认商品事实 <b>可选，用于标记需要核对的价格、保险、销量等声明</b></span><textarea value={confirmedFacts} onChange={(event) => setConfirmedFacts(event.target.value)} placeholder="例如：商品规格、当前价格、保险名称、赔付依据、真实销量、产地。只填写已经核验的事实。" /></label>
          </div>

          <button className="clipPlanButton" onClick={generatePlan} disabled={planning || !currentProductName || (sourceMode === "livestream" && !selectedProductId)}>
            {planning ? <><span className="clipSpinner" /> {planningStage(elapsed)} · {formatDuration(elapsed)}</> : currentProductName ? `识别并切分“${currentProductName}”的细素材` : sourceMode === "product" ? "请填写商品名称" : "请先识别并选择一个商品"}
          </button>
          <p className="clipPlanHint">{planning ? "正在逐段识别原话和画面，把价格、规格、销量、场景等分别放入素材货架。" : "点击后先进入细分素材陈列台；确认素材切得合适，再进入第三步排列组合。"}</p>
        </section>

        {plan && <section className="clipV2Plan">
          <div className="clipPlanHeader"><div><span>流程第2步已经完成</span><h2>“{currentProductName}”细分素材陈列台</h2><p>这里展示AI从商品片段中切出的全部可用小片段。每个类别可以有多段；先试听和挑选，再拖到下方成片轨道。</p></div><div className="clipPlanStats"><strong>{plan.candidateGroups.reduce((sum, group) => sum + group.candidates.length, 0)}</strong><span>个候选</span><strong>{plan.candidateGroups.filter((group) => group.candidates.length > 0).length}</strong><span>个类别</span><strong>{formatDuration(plan.analyzeMs / 1000)}</strong><span>分析耗时</span></div></div>

          <section className="clipMaterialBoard">
            <div className="clipMaterialBoardHead"><div><b>02 · 切好的细分素材</b><h3>素材货架</h3><p>画面就是该片段起点附近的真实画面。可以保留同一类别的多段，例如两段价格或三段使用场景。</p></div><span>拖动卡片到第3步的成片轨道，或点击“加入末尾”</span></div>
            <div className="clipMaterialShelves">{(plan.candidateGroups ?? []).filter((group) => group.candidates.length > 0).map((group, groupIndex) => <article key={group.role} className="clipMaterialShelf">
              <header><span>{String(groupIndex + 1).padStart(2, "0")}</span><strong>{group.label}</strong><b>{group.candidates.length} 段</b></header>
              <div>{group.candidates.map((candidate, candidateIndex) => <section key={`${group.role}-${candidate.segmentId}`} draggable onDragStart={() => { setDragCandidate(candidate); setDragIndex(null); }} onDragEnd={() => setDragCandidate(null)} className={isCandidateInTimeline(candidate, timeline) ? "isUsed" : ""}>
                <div className="clipMaterialFrame"><img loading="lazy" src={segmentThumbnailUrl(candidate)} alt={`${group.label}片段 ${candidateIndex + 1}`} /><span>{formatDuration(candidate.endSeconds - candidate.startSeconds)}</span><b>{isCandidateInTimeline(candidate, timeline) ? "已在轨道" : `片段 ${candidateIndex + 1}`}</b></div>
                <div className="clipMaterialCardBody"><small>{formatRange(candidate.startSeconds, candidate.endSeconds)} · {candidate.sourceId}</small><p>{candidate.transcript}</p><em>{candidate.highlightScore ? `高光 ${candidate.highlightScore} 分` : roleLabel(candidate.role)}</em></div>
                <footer><button onClick={() => setPreviewSegment(candidate)}>▶ 预览</button><button onClick={() => addCandidate(candidate, false)}>＋ 加入末尾</button>{selectedTimelineSegment && <button onClick={() => addCandidate(candidate, true)}>替换当前</button>}</footer>
              </section>)}</div>
            </article>)}</div>
          </section>

          {previewSegment && <section className="clipSourcePreview"><div><strong>原片试听 · {previewSegment.sourceId} · {formatRange(previewSegment.startSeconds, previewSegment.endSeconds)}</strong><button onClick={() => setPreviewSegment(null)}>关闭</button></div><video controls autoPlay src={`${apiPath(`/clip-lab/samples/${encodeURIComponent(previewSegment.sourceId)}/video`)}#t=${Math.max(0, previewSegment.startSeconds - 1)},${previewSegment.endSeconds + 1}`} /></section>}

          <section className="clipCompositionStep">
            <StepHeader number="03" title="把细分素材放进成片轨道" hint="点模板自动排一版，或者清空轨道后完全自由组合" />
            <div className="clipComposeSettings"><label><span>成片目标时长</span><select value={targetDurationSeconds} onChange={(event) => setTargetDurationSeconds(Number(event.target.value))}><option value={35}>约35秒</option><option value={45}>约45秒（推荐）</option><option value={60}>约60秒</option></select></label><label><span>本条表达角度</span><input value={personalAngle} onChange={(event) => setPersonalAngle(event.target.value)} maxLength={200} /></label><div><span>当前轨道</span><strong>{timeline.length} 段 · {formatDuration(timelineDuration)}</strong></div></div>
            <div className="clipTemplateGrid clipTemplateGridFour">
              {storyTemplates.map((item) => <button key={item.id} className={template === item.id ? "isSelected" : ""} onClick={() => applyCommerceTemplate(item.id)}>
                <i>{item.icon}</i><strong>{item.title}</strong><span>{item.desc}</span>
              </button>)}
            </div>
            <div className="clipFreeComposeNote"><b>自由组合</b><span>不想套模板，可以清空轨道，再从上方素材货架逐段拖入。价格、规格等类别均可放入多段。</span><button onClick={() => { setTimeline([]); setSelectedTimelineIndex(0); }}>清空轨道，自己拼</button><button onClick={() => applyCommerceTemplate(template)}>恢复当前模板</button></div>
          </section>

          <section className="clipUnderstandingPanel">
            <div><strong>当前组合结构</strong><span>模板自动排列后仍可自由编辑</span></div>
            <div className="clipStageStrip">{(storyTemplates.find((item) => item.id === template)?.roles ?? []).map((role) => { const count = timeline.filter((segment) => segment.role === role).length; return <span key={role} className={count > 0 ? "isComplete" : "isMissing"}>{count > 0 ? "✓" : "!"} {roleLabel(role)}{count > 0 ? ` ${count}` : ""}</span>; })}</div>
            {plan.qualityFlags.length > 0 && <p className="clipPlanQualityFlags">需要处理：{plan.qualityFlags.join("；")}</p>}
          </section>

          <section className="clipSequenceWorkbench">
            <div className="clipSequenceHead"><div><b>03 · 成片排列组合</b><h3>成片轨道</h3><p>从左到右就是最终播放顺序。拖动轨道卡片重新排序，也可以把上方任意素材直接拖到指定位置。</p></div><strong>{timeline.length} 段 · {formatDuration(timelineDuration)}</strong></div>
            <div className={`clipSequenceRail ${timeline.length === 0 ? "isEmpty" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={() => dropOnTimeline(timeline.length)}>
              {timeline.length === 0 && <div className="clipEmptyTrack"><b>轨道还是空的</b><span>从上方素材货架拖入片段，或点击一个成交模板自动排列。</span></div>}
              {timeline.map((segment, index) => <article key={segment.segmentId} draggable onDragStart={() => { setDragIndex(index); setDragCandidate(null); }} onDragEnd={() => setDragIndex(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.stopPropagation(); dropOnTimeline(index); }} onClick={() => setSelectedTimelineIndex(index)} className={selectedTimelineIndex === index ? "isSelected" : ""}>
                <div className="clipSequenceFrame"><img src={segmentThumbnailUrl(segment)} alt={`第${index + 1}段画面`} /><span>{String(index + 1).padStart(2, "0")}</span><b>{formatDuration(segment.endSeconds - segment.startSeconds)}</b></div>
                <strong>{roleLabel(segment.role)}</strong><p>{segment.transcript}</p>
                <footer><button aria-label={`将第 ${index + 1} 段上移`} disabled={index === 0} onClick={(event) => { event.stopPropagation(); moveSegment(index, -1); }}>←</button><button aria-label={`将第 ${index + 1} 段下移`} disabled={index === timeline.length - 1} onClick={(event) => { event.stopPropagation(); moveSegment(index, 1); }}>→</button><button aria-label={`删除第 ${index + 1} 段：${roleLabel(segment.role)}`} onClick={(event) => { event.stopPropagation(); removeTimelineSegment(index); }}>删除</button></footer>
              </article>)}
              {timeline.length > 0 && <div className="clipTrackDropTail">拖到这里放最后</div>}
            </div>

            {selectedTimelineSegment && <section className="clipSegmentInspector">
              <div className="clipInspectorPreview"><video key={`${selectedTimelineSegment.segmentId}-${selectedTimelineSegment.startSeconds}-${selectedTimelineSegment.endSeconds}`} controls playsInline preload="metadata" poster={segmentThumbnailUrl(selectedTimelineSegment)} src={segmentVideoUrl(selectedTimelineSegment)} /><button onClick={() => setPreviewSegment(selectedTimelineSegment)}>⛶ 放大预览当前片段</button></div>
              <div className="clipInspectorBody"><div className="clipTimelineMeta"><span>第 {selectedTimelineIndex + 1} 段 · {roleLabel(selectedTimelineSegment.role)}</span><b>{selectedTimelineSegment.sourceId} · {formatRange(selectedTimelineSegment.startSeconds, selectedTimelineSegment.endSeconds)}</b></div><p>原话：{selectedTimelineSegment.transcript}</p>{selectedTimelineSegment.highlightScore !== undefined && <small>{selectedTimelineSegment.highlightScore >= 30 ? `高光信号 ${selectedTimelineSegment.highlightScore} 分` : "结构补全片段（非高光）"}{selectedTimelineSegment.highlightTags?.length ? ` · ${selectedTimelineSegment.highlightTags.join("、")}` : ""}</small>}
                <div className="clipTrimControls"><label>入点<input type="number" step="0.1" min={selectedTimelineSegment.editableStartSeconds ?? selectedTimelineSegment.startSeconds} max={selectedTimelineSegment.endSeconds - 0.35} value={roundTime(selectedTimelineSegment.startSeconds)} onChange={(event) => updateSegment(selectedTimelineIndex, { startSeconds: Number(event.target.value) })} /></label><label>出点<input type="number" step="0.1" min={selectedTimelineSegment.startSeconds + 0.35} max={selectedTimelineSegment.editableEndSeconds ?? selectedTimelineSegment.endSeconds} value={roundTime(selectedTimelineSegment.endSeconds)} onChange={(event) => updateSegment(selectedTimelineIndex, { endSeconds: Number(event.target.value) })} /></label><label>画面处理<select value={selectedTimelineSegment.cropMode} onChange={(event) => updateSegment(selectedTimelineIndex, { cropMode: event.target.value as CropMode})}><option value="wide">保留全景</option><option value="speaker">人物近景</option><option value="product">商品特写</option><option value="evidence">证据特写</option></select></label></div>
                <small>{selectedTimelineSegment.reason}</small>{selectedTimelineSegment.visual && <div className={`clipVisualCheck ${selectedTimelineSegment.visual.matched ? "matched" : "mismatch"}`}><b>{selectedTimelineSegment.visual.matched ? `音画已核对 ${Math.round(selectedTimelineSegment.visual.matchScore)}分` : "音画需要处理"}</b><span>{selectedTimelineSegment.visual.matched ? selectedTimelineSegment.visual.summary : selectedTimelineSegment.visual.reviewReason}</span>{selectedTimelineSegment.visual.ocrText && <em>画面文字：{selectedTimelineSegment.visual.ocrText}</em>}</div>}
              </div>
            </section>}
          </section>

          <div className="clipPlanColumns">
            <section className="clipClaimPanel"><h3>需要人工确认的事实</h3>{unresolvedClaims.length === 0 ? <p className="clipSuccessText">已确认资料覆盖了本次强声明。</p> : unresolvedClaims.map((flag) => <div key={flag.segmentId}><strong>{flag.claim}</strong><span>{flag.reason}</span></div>)}
              {unresolvedClaims.length > 0 && <label className="clipConfirmClaims"><input type="checkbox" checked={claimsConfirmed} onChange={(event) => setClaimsConfirmed(event.target.checked)} /><span>我已经对照商品资料确认以上声明</span></label>}
            </section>

            <section className="clipAssetPanel clipCleanHandoff"><h3>本工作台只交付干净初剪</h3><p>不会烧入字幕，不会抓取或混入网络音乐，也不会自动添加来源不明的画中画。下载 MP4 后，在剪映等软件里完成字幕、音乐、花字和少量审美精修。</p><div><strong>AI完成</strong><span>按品切分、候选分类、成交排列、切点保护、画幅与音量统一</span></div><div><strong>剪辑手完成</strong><span>事实确认、片段替换、字幕、账号可用音乐和最终发布</span></div></section>
          </div>

          <div className="clipRenderBar"><div><strong>生成可交给剪映精修的干净初剪片</strong><span>{timeline.length} 段真实口播 · 可拖拽排序和微调切点 · 不加字幕音乐 · {unresolvedClaims.length} 项强声明</span></div><button onClick={renderPlan} disabled={rendering || timeline.length < 2 || (unresolvedClaims.length > 0 && !claimsConfirmed)}>{rendering ? <><span className="clipSpinner" /> 正在剪辑 · {formatDuration(elapsed)}</> : "生成并下载干净初剪"}</button></div>
        </section>}
      </section>

      {error && <div className="clipLabError">{error}</div>}
      {result && <ResultPanel result={result} />}
    </main>
  );
}

function StepHeader({ number, title, hint }: { number: string; title: string; hint: string }) {
  return <div className="clipStepHeader"><span>{number}</span><h2>{title}</h2><p>{hint}</p></div>;
}

function StockResults({ search, busy, onImport }: { search: StockSearchResponse; busy: boolean; onImport: (stock: StockAsset) => void }) {
  return <div className="clipStockResults"><p>{search.notice}</p>{search.results.length > 0 ? <div>{search.results.map((stock) => <article key={`${stock.provider}-${stock.id}`}><img src={stock.previewUrl} alt={stock.title} /><span><strong>{stock.title}</strong><small>{stock.licenseLabel} · {stock.durationSeconds ?? "?"}秒</small><a href={stock.pageUrl} target="_blank" rel="noreferrer">查看来源</a></span><button disabled={busy} onClick={() => onImport(stock)}>导入素材库</button></article>)}</div> : <div className="clipManualLinks">{search.manualLinks.map((link) => <a key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.label}</a>)}</div>}</div>;
}

function ResultPanel({ result }: { result: RenderedResult }) {
  const videoUrl = apiPath(result.outputUrl);
  const musicLabel = result.backgroundMusicUsed ? "已自动混入" : result.musicHandoff === "jianying" ? "到剪映添加" : "未添加";
  return <section className="clipResultSection">
    <div className="clipResultHeading"><span>AI粗剪完成 · 可交给剪映精修</span><h2>AI完成绝大部分任务，人工只做最后一遍审美确认</h2><p>处理文件临时保留24小时，请下载到自己的设备后导入剪映、Premiere等软件。</p></div>
    <div className="clipResultGrid"><div className="clipVideoCard"><video controls playsInline src={videoUrl} /><a href={videoUrl} download>下载 MP4 到剪映精修</a></div><div className="clipMetrics"><Metric value={formatDuration(result.totalMs / 1000)} label="实际生成耗时" /><Metric value={`${result.segmentCount} 段`} label="重组真实口播" /><Metric value={`${result.brollCount} 个`} label="已插入全屏补画面" /><Metric value={`${result.autoImportedAssetCount ?? 0} 个`} label="AI自动导入素材" /><Metric value={`${result.userProvidedAssetCount ?? 0} 个`} label="用户提供真实素材" /><Metric value={musicLabel} label="背景音乐" /><Metric value={`${result.estimatedHumanMinutes} 分钟`} label="预计人工确认" /><Metric value={`${result.unresolvedAssetCount} 个`} label="仍缺真实素材" /><Metric value={formatBytes(result.outputBytes)} label="成片大小" /></div></div>
    <div className="clipJianyingHandoff"><strong>最后20%：导入剪映等软件精修</strong><span>{result.musicHandoff === "jianying" ? "选择账号可用音乐，" : "音乐已经处理，"}按需要添加字幕、调整个别转场并检查整体观感；满意后由用户自行导出发布。</span></div>
    <div className="clipResponsibilityGrid"><article><span className="clipRole machine">AI已完成</span>{result.aiWork.map((item) => <p key={item}>✓ {item}</p>)}</article><article><span className="clipRole human">人工只确认</span>{result.humanChecklist.map((item) => <p key={item}>□ {item}</p>)}</article></div>{result.qualityFlags.length > 0 && <div className="clipWarnings">需要留意：{result.qualityFlags.join("；")}</div>}
  </section>;
}

function Metric({ value, label }: { value: string; label: string }) { return <div><strong>{value}</strong><span>{label}</span></div>; }

function planningStage(seconds: number): string {
  if (seconds < 20) return "正在提取并上传语音";
  if (seconds < 90) return "正在生成逐字时间码";
  if (seconds < 140) return "正在切分功能、规格、场景和价格";
  return "正在核对同期画面并组织成交时间线";
}

function roleLabel(role: string): string {
  return ({ hook: "开头钩子", evidence: "信任证据", benefit: "功能好处", specification: "商品规格", usage: "使用场景", usage_advice: "使用建议", social_proof: "口碑服务", price: "价格权益", objection: "异议消除", experience: "体验观点", answer: "问题回答", action: "行动提示" } as Record<string, string>)[role] ?? "内容片段";
}

function segmentThumbnailUrl(segment: TimelineSegment): string {
  return apiPath(`/clip-lab/samples/${encodeURIComponent(segment.sourceId)}/thumbnail?at=${Math.max(0, segment.startSeconds).toFixed(1)}`);
}

function segmentVideoUrl(segment: TimelineSegment): string {
  return `${apiPath(`/clip-lab/samples/${encodeURIComponent(segment.sourceId)}/video`)}#t=${Math.max(0, segment.startSeconds).toFixed(1)},${Math.max(segment.startSeconds + 0.35, segment.endSeconds).toFixed(1)}`;
}

function isCandidateInTimeline(candidate: TimelineSegment, timeline: TimelineSegment[]): boolean {
  return timeline.some((item) => isSameTimelineUse(item, candidate));
}

function isSameTimelineUse(left: TimelineSegment, right: TimelineSegment): boolean {
  return left.segmentId === right.segmentId || (
    left.sourceId === right.sourceId
    && left.role === right.role
    && Math.abs(left.startSeconds - right.startSeconds) < 0.15
    && Math.abs(left.endSeconds - right.endSeconds) < 0.15
  );
}

function formatRange(start: number, end: number): string { return `${formatDuration(start)}–${formatDuration(end)}`; }
function roundTime(seconds: number): number { return Math.round(seconds * 10) / 10; }
function formatDuration(seconds: number): string { const safe = Math.max(0, Math.round(seconds)); return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`; }
function formatBytes(bytes: number): string { return `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`; }
