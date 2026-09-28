// 选题策略官 · 工作台（/agent/<skuCode>/workbench）
//
// UI 落地自设计原型 v1.5：docs/prototypes/topic-strategist-demo-20260922.html
// 结构、文案、示例数据与原稿一致；样式抽到 styles/topic-strategist-workbench.css
// （作用域 .ts-wb，避免污染全局）。
//
// 说明：本页当前为**设计落地**，示例数据为原型演示数据；四大来源的真实取数、
// 三关筛选与「一键生成」尚未接后端（见 HANDOFF-topic-strategist-mobile-20260924.md）。

import { useCallback, useEffect, useRef, useState } from "react";
import { apiPath, getAppPath, getPublicAssetPath } from "../lib/api.js";
import { authHeaders, fetchMarketMe, Topbar } from "./shell.js";
import { knowledgeSyncProgressText, runKnowledgeSync, latestKnowledgeSync } from "../lib/knowledge-sync.js";

// ---------------- 第三关：账号阶段配比（原型 STAGES） ----------------
const STAGES = [
  {
    note: "重点：把体量做起来。人性共识开路，别急着收客资。",
    q: [
      ["人性", 5, "#d64545"],
      ["时代", 2, "#2563eb"],
      ["利益", 2, "#0f8a5f"],
      ["专业", 1, "#0c6b49"],
      ["热点", 0, "#7c3aed"]
    ] as Array<[string, number, string]>
  },
  {
    note: "重点：认知+转化并行。利益共识做主力，开始攒精准客资。",
    q: [
      ["人性", 3, "#d64545"],
      ["时代", 3, "#2563eb"],
      ["利益", 3, "#0f8a5f"],
      ["专业", 1, "#0c6b49"],
      ["热点", 0, "#7c3aed"]
    ] as Array<[string, number, string]>
  },
  {
    note: "重点：流量变客资。专业共识加重，放心收客资。",
    q: [
      ["人性", 2, "#d64545"],
      ["时代", 2, "#2563eb"],
      ["利益", 3, "#0f8a5f"],
      ["专业", 3, "#0c6b49"],
      ["热点", 0, "#7c3aed"]
    ] as Array<[string, number, string]>
  }
];
const STAGE_NAMES = ["起号期", "增长期", "变现期"];

function quotaLabel(v: number): string {
  if (!v) return "看时机";
  if (v >= 5) return "主打";
  if (v >= 3) return "主力";
  if (v === 2) return "辅助";
  return "少量";
}

// ---------------- 交付选题（真实生成后由后端返回，不预置演示数据） ----------------
type Topic = {
  id: number;
  title: string;
  type: string;
  typeCls: string;
  source: string;
  evState: "pass" | "todo";
  evNote: string;
  consensus: string;
  consCls: string;
  stars: string;
  stage: string;
  advise: string;
};
const PIPE_STEPS = [
  { n: 1, b: "配置四大来源", s: "私有知识库 · 行业热点 · 对标账号 · 数据复盘" },
  { n: 2, b: "候选池涌现", s: "按配额出 16–20 条，缺源自动重分配" },
  { n: 3, b: "三关筛选", s: "一票否决 → 贴标签 → 按你选的阶段" },
  { n: 4, b: "交付 10 条", s: "带证据状态 + 创作建议，直接开拍" }
];

type ConclusionStat = { docs: number; coreViews: number; quotes: number; customerQuotes: number };
type ConclusionStats = { stored: ConclusionStat; confirmed: ConclusionStat } | null;

// 抽屉里单条素材（与后端 getnote-materials 返回对齐）
type MatType = "coreView" | "quote" | "customerQuote";
type Mat = { id: string; type: MatType; text: string; source: string };
// 用户「应用选中」的素材（与后端 topic-staged-materials 返回对齐）；真源在后端。
type StagedItem = { id: string; text: string; type: string; source: string };
// 生成接口返回的选题行（与后端 TopicRow 对齐）
type GenTopic = { id: string; title: string; type: string; source: string; consensus: string; precision: string; advice: string; stage: string };

export function TopicStrategistWorkbench({ skuId }: { skuId?: string }) {
  // 商城共用顶栏的积分余额（与 AgentChatPage 同款取法）
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchMarketMe<{ creditBalance: number }>()
      .then((data) => {
        if (!cancelled) setBalance(data ? data.creditBalance : null);
      })
      .catch(() => {
        if (!cancelled) setBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 上一次同步结论（持久展示）：本地已存条数 + 更新时间；未同步 / 失败分别提示。
  const formatSyncTime = (iso?: string | null): string => {
    if (!iso) return "未知";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  // 来源 1（私有知识库 / 得到大脑）真实状态：连接取自「关联应用」同一份配置
  // 注意：这组 useState 必须放在 loadLastSync / loadSource1 的 useCallback 之前声明，
  // 否则依赖数组 [gnConnectionId] 在求值时会命中 const 的暂时性死区（TDZ）导致组件崩溃。
  const [gnConnectionId, setGnConnectionId] = useState<string | null>(null);
  const [gnStatus, setGnStatus] = useState<string>("");
  const [gnConfigured, setGnConfigured] = useState(false); // 存在且 status==="active"
  const [gnLoading, setGnLoading] = useState(true);
  const [syncProgress, setSyncProgress] = useState("");
  const [syncConclusion, setSyncConclusion] = useState("");
  const [syncError, setSyncError] = useState("");
  // 已同步结论体量（核心观点 / 金句 / 客户原话），用于把统计结论简洁展示给用户。
  const [conclusionStats, setConclusionStats] = useState<ConclusionStats>(null);
  // 素材抽屉：列出 getnote 已同步素材，用户勾选后临时带入本次生成。
  const [materials, setMaterials] = useState<Mat[]>([]);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [materialTab, setMaterialTab] = useState<"all" | MatType>("all");
  const [materialSearch, setMaterialSearch] = useState("");
  const [materialSelected, setMaterialSelected] = useState<Set<string>>(new Set());
  // 已「应用选中」的素材（放进备选，不自动生成）。真源在后端 topic_staged_material_selections，
  // 这里只是前端镜像；挂载时从 GET /market/topic-staged-materials 回填，刷新后保留、与后端口径一致。
  const [stagedMaterials, setStagedMaterials] = useState<StagedItem[]>([]);
  // 本次真实生成结果（替换演示选题表）
  const [genTopics, setGenTopics] = useState<GenTopic[] | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState("");
  const loadLastSync = useCallback(async (explicitId?: string | null) => {
    const connId = explicitId ?? gnConnectionId;
    if (!connId) return;
    try {
      const job = await latestKnowledgeSync(connId, authHeaders());
      if (!job) { setSyncConclusion("尚未同步：连接已就绪，点「同步并分析笔记」拉取"); return; }
      if (job.status === "running" || job.status === "queued") { setSyncConclusion("正在同步中…"); return; }
      if (job.status !== "succeeded") { setSyncConclusion("上次同步未通过，尚未同步数据（点上方按钮重试）"); return; }
      const count = job.analyzedReused ?? job.created + job.updated + job.unchanged;
      setSyncConclusion(`本地已存储 ${count} 条已同步且分析的笔记，最近更新时间 ${formatSyncTime(job.completedAt)}`);
    } catch {
      setSyncConclusion("同步状态读取失败，点上方按钮重新同步");
    }
  }, [gnConnectionId]);

  // 来源 1：读取「关联应用」里配置的得到大脑连接（不再预检待同步数，避免向客户展示抓取内部口径）
  const loadSource1Busy = useRef(false);
  const loadSource1 = useCallback(async () => {
    if (loadSource1Busy.current) return; // 请求中守卫：避免 StrictMode / 重复挂载并发调用
    loadSource1Busy.current = true;
    setGnLoading(true); setSyncError("");
    try {
      const connData = (await fetch(apiPath("/knowledge-base/connections"), { headers: authHeaders(), cache: "no-store" }).then((r) => r.json())) as {
        connections?: Array<{ id: string; provider: string; status: string }>;
      };
      const conn = connData.connections?.find((c) => c.provider === "getnote") ?? null;
      if (!conn) {
        setGnConfigured(false); setGnConnectionId(null); setGnStatus("");
        return;
      }
      setGnConnectionId(conn.id); setGnStatus(conn.status);
      const configured = conn.status === "active";
      setGnConfigured(configured);
      if (configured) void loadLastSync(conn.id);
    } catch (reason) {
      setSyncError(reason instanceof Error ? reason.message : "读取得到大脑连接失败");
    } finally {
      setGnLoading(false);
      loadSource1Busy.current = false;
    }
  }, [loadLastSync]);

  useEffect(() => { void loadSource1(); }, [loadSource1]);

  // 拉取已同步结论体量（核心观点 / 金句 / 客户原话），作为结论展示给用户。
  useEffect(() => {
    let cancelled = false;
    void fetch(apiPath("/knowledge-base/getnote-conclusions"), { headers: authHeaders(), cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled && data) setConclusionStats(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  // 挂载时从后端回填「已应用选中」的素材（真源在后端，刷新后保留，与 /run 注入同源）。
  useEffect(() => {
    let cancelled = false;
    void fetch(apiPath("/market/topic-staged-materials"), { headers: authHeaders(), cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { selected?: StagedItem[] } | null) => {
        if (!cancelled && data?.selected) setStagedMaterials(data.selected);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  // 挂载时从后端回填来源2（行业热点）配置快照；刷新后保留，与 /run 注入同源。
  useEffect(() => {
    let cancelled = false;
    void fetch(apiPath("/market/industry-hotspots"), { headers: authHeaders(), cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { industry?: string; result?: { hot: { fetched: boolean; items: string[]; note: string } } | null; selected?: string[] | null; retrievedAt?: string | null } | null) => {
        if (cancelled || !data) return;
        setIndustryInput(data.industry ?? "");
        setIndustryHotspots(data.result ? { industry: data.industry ?? "", result: data.result, selected: data.selected ?? null, retrievedAt: data.retrievedAt ?? null } : null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  // 挂载时从后端回填来源4（数据复盘）解析快照与开关状态；刷新后保留，与 /run 注入同源。
  useEffect(() => {
    let cancelled = false;
    void fetch(apiPath("/market/topic-review-upload"), { headers: authHeaders(), cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { enabled?: boolean; upload?: { fileName: string; platform: string | null; rowCount: number; topTitles: string[]; uploadedAt: string | null } | null } | null) => {
        if (cancelled || !data) return;
        if (data.enabled === false) setSrc3On(false);
        setReviewData(data.upload ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  // 来源2「拉取热点」：配置时调用，结果落后端库；拉取成功后默认全量勾选并保存，保证口径一致。
  const fetchIndustryHotspots = async () => {
    const industry = industryInput.trim();
    if (!industry) { setIhError("请先填写行业"); return; }
    setIhLoading(true); setIhError("");
    try {
      const resp = await fetch(apiPath("/market/industry-hotspots"), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ industry })
      });
      if (!resp.ok) { const e = (await resp.json().catch(() => ({}))) as { message?: string }; setIhError(e.message ?? `拉取失败（HTTP ${resp.status}）`); return; }
      const data = (await resp.json()) as { industry: string; result: { hot: { fetched: boolean; items: string[]; note: string } }; retrievedAt: string };
      const snapshot = { industry: data.industry, result: data.result, selected: data.result.hot.items, retrievedAt: data.retrievedAt };
      setIndustryHotspots(snapshot);
      // 拉取后默认全量勾选（可再进抽屉改），与 /run 注入口径一致。
      if (data.result.hot.items.length > 0) await saveHotspotSelection(data.result.hot.items);
    } catch (reason) {
      setIhError(reason instanceof Error ? reason.message : "拉取请求失败");
    } finally {
      setIhLoading(false);
    }
  };
  // 保存热点勾选到后端（与应用选中同源；/run 只注入这里保存的标题）。
  const saveHotspotSelection = async (titles: string[]) => {
    try {
      const resp = await fetch(apiPath("/market/industry-hotspots/select"), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ selected: titles })
      });
      if (!resp.ok) return;
      setIndustryHotspots((prev) => (prev ? { ...prev, selected: titles } : prev));
    } catch { /* 保存失败时保留本地态，下次打开抽屉可重试 */ }
  };
  // 第三关：阶段
  const [stage, setStage] = useState<number | null>(null);
  // 来源 4（数据复盘）开关 —— 关闭时触发配额重分配与降级提示
  const [src3On, setSrc3On] = useState(true);
  // 各来源的演示态
  const [synced, setSynced] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // 来源 2（行业热点）：行业输入 + 后端配置快照（配置页「拉取」后落库，运行时只读勾选结果）。
  const [industryInput, setIndustryInput] = useState("");
  // 后端已配置的行业热点快照（GET /market/industry-hotspots 回填）；result 非空即视为已配置。
  // selected：用户勾选的热点标题（string[]）；null = 拉取后未挑选（默认全量带入）。
  const [industryHotspots, setIndustryHotspots] = useState<{
    industry: string;
    result: { hot: { fetched: boolean; items: string[]; note: string } } | null;
    selected: string[] | null;
    retrievedAt: string | null;
  } | null>(null);
  const [ihLoading, setIhLoading] = useState(false);
  const [ihError, setIhError] = useState("");
  // 热点抽屉（与来源1素材抽屉同交互：右侧弹层 + 勾选 + 应用选中）
  const [ihDrawerOpen, setIhDrawerOpen] = useState(false);
  const [ihSearch, setIhSearch] = useState("");
  const [ihTemp, setIhTemp] = useState<Set<string>>(new Set());
  const ihItems = industryHotspots?.result?.hot.items ?? [];
  const ihFiltered = ihSearch.trim() ? ihItems.filter((t) => t.includes(ihSearch.trim())) : ihItems;
  // 已选数展示口径：selected 为 null（未挑选）时按全量算，与 /run 默认全量注入一致。
  const ihSelectedCount = industryHotspots ? (industryHotspots.selected ?? (industryHotspots.result?.hot.fetched ? industryHotspots.result.hot.items : [])).length : 0;
  const openHotspotDrawer = () => {
    if (!industryHotspots?.result || !industryHotspots.result.hot.fetched) return;
    const saved = industryHotspots.selected ?? industryHotspots.result.hot.items;
    setIhTemp(new Set(ihItems.filter((t) => saved.includes(t))));
    setIhSearch("");
    setIhDrawerOpen(true);
  };
  const applyHotspots = async () => {
    const chosen = ihItems.filter((t) => ihTemp.has(t));
    await saveHotspotSelection(chosen);
    setIhDrawerOpen(false);
  };
  const [guideOpen, setGuideOpen] = useState(false);
  // 来源4（数据复盘）：后端解析快照（真源 topic_review_uploads，挂载 GET 回填，刷新不丢）。
  // 前端把文件读成 base64 上传，解析/重算全部在后端复用 vidrev 确定性引擎完成。
  const [reviewData, setReviewData] = useState<{
    fileName: string;
    platform: string | null;
    rowCount: number;
    topTitles: string[];
    uploadedAt: string | null;
  } | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewMsg, setReviewMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // 文件 → base64（分块拼接，避免大文件 call stack 溢出）
  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("读取文件失败"));
      reader.onload = () => {
        const bytes = new Uint8Array(reader.result as ArrayBuffer);
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
          bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        resolve(btoa(bin));
      };
      reader.readAsArrayBuffer(file);
    });

  // 上传数据表：POST base64 → 后端解析落库 → 回填摘要
  const onReviewFile = async (file: File | undefined) => {
    if (!file) return;
    setReviewBusy(true);
    setReviewMsg("");
    try {
      const dataBase64 = await fileToBase64(file);
      const resp = await fetch(apiPath("/market/topic-review-upload"), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ fileName: file.name, dataBase64 })
      });
      const data = (await resp.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        fileName?: string;
        platform?: string | null;
        rowCount?: number;
        topTitles?: string[];
        uploadedAt?: string;
      };
      if (!resp.ok || !data.ok) {
        setReviewMsg(data.message ?? `解析失败（HTTP ${resp.status}）`);
        return;
      }
      setReviewData({
        fileName: data.fileName ?? file.name,
        platform: data.platform ?? null,
        rowCount: data.rowCount ?? 0,
        topTitles: data.topTitles ?? [],
        uploadedAt: data.uploadedAt ?? null
      });
    } catch (reason) {
      setReviewMsg(reason instanceof Error ? reason.message : "上传失败，请重试");
    } finally {
      setReviewBusy(false);
    }
  };

  // 来源4 开关：同步到后端（/run 只注入 enabled=true 的快照）；未上传过时后端会 400，静默保留本地态。
  const toggleSource4 = async (on: boolean) => {
    setSrc3On(on);
    try {
      await fetch(apiPath("/market/topic-review-upload/enable"), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ enabled: on })
      });
    } catch { /* 本地态已更新，下次上传时会重置为开启 */ }
  };
  // 换一批：仅控制视觉旋转态，真实重生成由下方选题生成流程触发
  const [refreshing, setRefreshing] = useState(false);
  const doRefresh = () => {
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 1200);
  };

  const doSync = () => {
    if (!gnConfigured || !gnConnectionId) {
      window.location.href = getAppPath("/mine");
      return;
    }
    setSyncing(true); setSyncProgress(""); setSyncError("");
    runKnowledgeSync(gnConnectionId, authHeaders(), (progress) => setSyncProgress(knowledgeSyncProgressText(progress)), {})
      .then((result) => {
        if (result.status !== "succeeded") throw new Error("没有同步");
      })
      .catch((reason) => setSyncError(reason instanceof Error ? (reason.message || "没有同步") : "没有同步"))
      .finally(() => { setSyncing(false); void loadLastSync(); });
  };

  // 抽屉：打开时拉取素材清单（按类型/搜索在前端过滤；后端一次性吐全量）
  const openMaterials = useCallback(async () => {
    setMaterialsOpen(true);
    if (materials.length > 0) {
      // 重新打开时，按已持久化的备选 id 还原勾选状态，保证抽屉勾选数与卡片一致。
      const stagedIds = new Set(stagedMaterials.map((s) => s.id));
      setMaterialSelected(new Set(materials.filter((m) => stagedIds.has(m.id)).map((m) => m.id)));
      return;
    }
    setMaterialsLoading(true);
    try {
      const data = (await fetch(apiPath("/knowledge-base/getnote-materials"), { headers: authHeaders(), cache: "no-store" }).then((r) => (r.ok ? r.json() : null))) as { materials?: Mat[] } | null;
      if (data?.materials) {
        setMaterials(data.materials);
        // 首次打开即按已持久化的备选 id 还原勾选状态。
        const stagedIds = new Set(stagedMaterials.map((s) => s.id));
        setMaterialSelected(new Set(data.materials.filter((m) => stagedIds.has(m.id)).map((m) => m.id)));
      }
    } catch {
      /* 忽略，抽屉内显示空 */
    } finally {
      setMaterialsLoading(false);
    }
  }, [materials.length, stagedMaterials]);

  const toggleMaterial = (id: string) => {
    setMaterialSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 一键生成：调用 run（workbench 入口）。已选素材由后端从库内读取注入，前端无需再传（避免双源口径不一致）。
  // 注意：选中只是「放入备选」，不会在这里被触发；只有用户点「一键生成 / 换一批」才调用。
  const doGenerate = useCallback(async () => {
    if (stage === null) {
      setGenError("请先在「第三关·配比校准」点选你的账号阶段，再点生成。");
      return;
    }
    setGenLoading(true); setGenError("");
    try {
      const useMaterials = stagedMaterials.length;
      const prompt =
        "请为我的账号生成 10 条视频选题。" +
        (stage !== null ? `账号阶段：${STAGE_NAMES[stage]}。` : "") +
        (useMaterials
          ? "请结合我在私有知识库里选定的客户素材进行选题与切角，让选题扎根于真实客户洞察。"
          : "请基于四大来源的通用方法论生成。");
      const body = { input: prompt, entry: "workbench" };
      const resp = await fetch(apiPath(`/market/skus/${encodeURIComponent(skuId ?? "ipzone__topic")}/run`), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify(body)
      });
      if (!resp.ok) {
        const e = (await resp.json().catch(() => ({}))) as { message?: string };
        setGenError(e.message ?? `生成失败（HTTP ${resp.status}）`);
        return;
      }
      const data = (await resp.json()) as { topics?: GenTopic[] };
      setGenTopics(data.topics ?? null);
    } catch (reason) {
      setGenError(reason instanceof Error ? reason.message : "生成请求失败");
    } finally {
      setGenLoading(false);
    }
  }, [stage, stagedMaterials, skuId]);

  // 应用选中：把勾选项「放进备选」并写入后端（唯一真源），关闭抽屉。**不触发生成**——生成由独立「一键生成」完成。
  const applyMaterials = async () => {
    const chosen: StagedItem[] = materials
      .filter((m) => materialSelected.has(m.id))
      .map((m) => ({ id: m.id, text: m.text, type: m.type, source: m.source }));
    setMaterialsOpen(false);
    setStagedMaterials(chosen); // 乐观更新
    try {
      const resp = await fetch(apiPath("/market/topic-staged-materials"), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ selected: chosen })
      });
      if (resp.ok) {
        const data = (await resp.json()) as { selected: StagedItem[] };
        setStagedMaterials(data.selected); // 以后端返回的为准
      }
    } catch {
      /* 忽略：本地仍保留乐观状态 */
    }
  };

  // 配额比（各来源占候选池的比例）由后台默认配置决定，前端不写死。

  // 抽屉内：按类型 + 搜索过滤后的素材
  const filteredMaterials = materials.filter((m) => {
    if (materialTab !== "all" && m.type !== materialTab) return false;
    const q = materialSearch.trim();
    if (q && !(m.text.includes(q) || m.source.includes(q))) return false;
    return true;
  });

  // 真实生成结果替换演示选题表：统一成 Topic 形状供同一套表格渲染
  const typeClsOf = (t: string): string => {
    if (t.includes("认知")) return "c1";
    if (t.includes("信任")) return "c2";
    if (t.includes("连接")) return "c3";
    if (t.includes("转化")) return "c4";
    return "c1";
  };
  const consClsOf = (c: string): string => {
    if (c.includes("人性")) return "rx";
    if (c.includes("时代")) return "sd";
    if (c.includes("利益")) return "lr";
    if (c.includes("热点")) return "rd";
    if (c.includes("专业")) return "zy";
    return "zy";
  };
  const dispRows: Topic[] = (genTopics ?? []).map((t: GenTopic) => ({
    id: String(t.id),
    title: t.title,
    type: t.type,
    typeCls: typeClsOf(t.type),
    source: t.source,
    evState: "pass" as const,
    evNote: "模型交付",
    consensus: t.consensus,
    consCls: consClsOf(t.consensus),
    stars: t.precision || "★★★☆☆",
    stage: t.stage || "—",
    advise: t.advice
  })) as unknown as Topic[];

  // ---------- 生成闸门：来源齐备 + 第三关阶段已选，二者都满足才允许生成 ----------
  // 来源3（对标账号）开发中，不参与配置校验，生成不依赖它。
  const s1Ready = gnConfigured; // 私有知识库：得到大脑连接已 active
  const s2Ready = Boolean(industryHotspots?.result?.hot.fetched); // 行业热点：已在配置页拉取并落库
  const s4Ready = !src3On || reviewData !== null; // 数据复盘：关闭（主动跳过）或已上传并解析成功
  const stageReady = stage !== null; // 第三关·配比校准：必须点选账号阶段才允许生成
  const allSourcesReady = s1Ready && s2Ready && s4Ready;
  const canGenerate = allSourcesReady && stageReady;
  const readyCount = (s1Ready ? 1 : 0) + (s2Ready ? 1 : 0) + (s4Ready ? 1 : 0);
  const unreadySources = [
    !s1Ready && "① 私有知识库：去「关联应用」连接得到大脑",
    !s2Ready && "② 行业热点：在来源 2 填写行业并点「拉取热点」",
    !s4Ready && "④ 数据复盘：在来源 4 上传数据表（或关闭该来源）",
    !stageReady && "③ 第三关·配比校准：在上方点选你的账号阶段（起号期 / 增长期 / 变现期）"
  ].filter(Boolean) as string[];

  return (
    /* 与对话页同款容器：桌面端 max-width 1200px 居中（sitong-design.css .app-wrap），顶栏才有两侧留白 */
    <>
      <main className="app-wrap">
      {/* 商城共用顶栏（与 /agent/<skuCode>/chat 一致：导航 / 主题切换 / 积分 / 退出）。
          放在 .app-wrap 内：顶栏 1200 居中不顶格（与 chat/详情页一致）。 */}
      <Topbar active="chat" balance={balance} onNavigate={(path) => { window.location.href = getAppPath(path); }} />
      <div className="ts-wb">
      {/* ---------- hero ---------- */}
      <header className="hero">
        <div className="wrap">
          <button
            className="ts-backbtn"
            type="button"
            onClick={() => { window.location.href = getAppPath(`/agent/${encodeURIComponent(skuId ?? "ipzone__topic")}/detail`); }}
          >
            ← 返回
          </button>
          <div className="chips">
            <span className="chip">四大来源 · 三关筛选</span>
          </div>
          <h1>
            <img className="emoji" style={{ objectFit: "cover" }} alt="选题策略官头像" src={getPublicAssetPath("/avatars/topic.jpg")} />
            选题策略官
          </h1>
          <p className="hook">我是你的选题策略官。每天给你挑好「今天拍哪条能火」，还讲清为什么。</p>
          <p className="ability">私有知识库 + 行业热点 + 对标账号 + 数据复盘 → 四大来源三关筛选出 10 条。</p>
          <span
            className={canGenerate ? "cta" : "cta disabled"}
            role="button"
            tabIndex={0}
            onClick={() => { if (canGenerate) void doGenerate(); }}
          >
            ▶ 一键生成今天选题{" "}
            <small>
              {!allSourcesReady
                ? `请先完成来源配置（已配置 ${readyCount}/3）`
                : !stageReady
                ? "请先在「第三关·配比校准」点选账号阶段"
                : "约 1–3 分钟 · 可随时追问「换一批」"}
            </small>
          </span>
        </div>
      </header>

      {/* ---------- 四步流水线 ---------- */}
      <div className="wrap" id="pipeWrap">
        <div className="pipe">
          {PIPE_STEPS.map((s, i) => (
            <div key={s.n} style={{ display: "contents" }}>
              <div className="step">
                <b>
                  <span className="num">{s.n}</span>
                  {s.b}
                </b>
                <span>{s.s}</span>
              </div>
              {i < PIPE_STEPS.length - 1 && <div className="arrow">→</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="wrap">
        {/* ---------- 第 1 步 · 四大来源 ---------- */}
        <section id="sources">
          <div className="sec-head">
            <h2>
              第 1 步 · <span className="k">四大来源</span>配置与扫描
            </h2>
            <span className="desc">来源齐备后方可生成（对标账号开发中暂不计入）· 当前已配置 {readyCount}/3</span>
          </div>
          <div className="sources">
            {/* 来源 1 */}
            <div className="src" id="src1">
              <div className="head">
                <span className="no">1</span>
                <b>私有知识库</b>
              </div>
              <div className="ctrl">
                {!gnConfigured ? (
                  <div className="inline">
                    <span className="ctrl-lab">得到大脑</span>
                    <span className="sync-warn">
                      {gnLoading ? "查询中…" : gnConnectionId ? "连接状态异常，请到「关联应用」重连" : "尚未在「关联应用」中连接得到大脑"}
                    </span>
                    <button className="mini-btn act" onClick={() => { window.location.href = getAppPath("/mine"); }}>
                      去「关联应用」配置
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="inline">
                      <span className="ctrl-lab">得到大脑</span>
                      <span className="sync-idle">
                        {gnLoading ? "查询中…（同步按钮已锁定）" : "已连接，可拉取并分析笔记"}
                      </span>
                      <button className="mini-btn act" onClick={doSync} disabled={syncing || gnLoading}>
                        {syncing ? "⟳ 同步中…" : gnLoading ? "⟳ 查询中…" : "⟳ 同步并分析笔记"}
                      </button>
                    </div>
                    {syncing && <div className="scan-line">{syncProgress || "正在读取得到大脑笔记 → 去重 → 解析智能总结 → 写入本地知识库…"}</div>}
                    {syncError && <div className="sync-result err"><b>⚠️ {syncError}</b></div>}
                    {syncConclusion && !syncError && (
                      <div className="sync-result">
                        <b>{syncConclusion}</b>
                      </div>
                    )}
                    {conclusionStats && conclusionStats.stored.docs > 0 && (
                      <div className="sync-result conclusion clickable" onClick={openMaterials} role="button" tabIndex={0}>
                        <b>已沉淀选题素材 <span className="pick-hint">· 点击挑选应用 ›</span></b>
                        <span className="cstat">
                          <i>核心观点 {conclusionStats.stored.coreViews}</i>
                          <i>金句 {conclusionStats.stored.quotes}</i>
                          <i>客户原话 {conclusionStats.stored.customerQuotes}</i>
                        </span>
                        <small>来自 {conclusionStats.stored.docs} 篇已同步笔记</small>
                        {stagedMaterials.length > 0 && (
                          <small className="staged" onClick={openMaterials} role="button" tabIndex={0}>
                            已选 {stagedMaterials.length} 条素材 · 已放入备选，生成时带入 ›
                          </small>
                        )}
                      </div>
                    )}
                  </>
                )}
                <div className="inline">
                  <span className="ctrl-lab">客户声音</span>
                  <span style={{ fontSize: 12.5, color: "var(--sub)" }}>评论 / 私信 / 销售客服记录自动汇入，无需手动填</span>
                </div>
              </div>
              <p className="way">同步得到大脑笔记（录音卡 / 日常笔记）：客户往来 / 成交案例 / 心得灵感 / 评论私信 / 销售客服记录</p>
              <ul>
                <li>已同步笔记自动提取<b>客户高频问题</b>与<b>成交案例</b>，供选题直接引用</li>
                <li>核心观点 / 金句 / 章节概要直接采用得到大脑自带的智能总结</li>
              </ul>
              <div className="foot">
                人设匹配度天然高 · <b>主力来源</b>
              </div>
            </div>

            {/* 来源 2 */}
            <div className="src" id="src2">
              <div className="head">
                <span className="no">2</span>
                <b>行业热点</b>
              </div>
              <div className="ctrl">
                <div className="inline hot-line">
                  <span className="ctrl-lab">我的行业</span>
                  <input className="txt" placeholder="填写你的行业，如：餐饮·火锅 / 美业·皮肤管理" value={industryInput} onChange={(e) => setIndustryInput(e.target.value)} />
                  <button className="mini-btn act" disabled={ihLoading} onClick={() => void fetchIndustryHotspots()}>
                    {ihLoading ? "拉取中…" : industryHotspots ? "重新拉取" : "拉取热点"}
                  </button>
                </div>
                {ihError && <div className="scan-line warn">{ihError}</div>}
              </div>
              {industryHotspots?.result ? (
                <div className="ih-result">
                  <div className="ih-head">
                    <span className={`pill ${industryHotspots.result.hot.fetched ? "ok" : "no"}`}>
                      {industryHotspots.result.hot.fetched ? `行业热点 · ${industryHotspots.result.hot.items.length} 条` : "行业热点 · 未取到"}
                    </span>
                    {industryHotspots.result.hot.fetched && (
                      <span className="ih-open" onClick={openHotspotDrawer}>
                        已选 {ihSelectedCount} 条 · 选择热点 ›
                      </span>
                    )}
                    <span className="ih-time">已配置 · 拉取于 {formatSyncTime(industryHotspots.retrievedAt)}</span>
                  </div>
                </div>
              ) : (
                <div className="scan-line">填写行业后点「拉取热点」，结果将落库并在生成时作为已配置来源带入；未拉取则来源2 不挂载实时热点。</div>
              )}
              <p className="way">按行业关键词检索公开页热点标题，逐条核验来源</p>
              <ul>
                <li>每条热点必须可回溯来源，<b>无来源热榜不算</b></li>
                <li>在抽屉里勾选热点后「应用选中」，生成时只带入勾选的热点</li>
              </ul>
              <div className="foot">
                每条热点必须可回溯 · <b>无来源热榜不算</b>
              </div>
            </div>

            {/* 来源 3：对标账号 —— 开发中（抖音抓取方案调研中），置灰展示，不参与生成闸门 */}
            <div className="src off" id="src4">
              <div className="head">
                <span className="no">3</span>
                <b>对标账号</b>
                <span className="pill todo">🚧 开发中</span>
              </div>
              <div className="ctrl">
                <div className="inline">
                  <span className="ctrl-lab">对标账号</span>
                  <span style={{ fontSize: 12.5, color: "var(--sub)" }}>
                    抖音对标账号分析正在调研接入方案，上线后开放配置；当前生成不依赖本来源。
                  </span>
                </div>
              </div>
              <p className="way">
                规划能力：粘贴抖音<b>主页链接或某条视频链接</b> → 视频链接自动定位所属账号并抓取整个主页 → 输出对标分析（近期选题 / 流量数据 / 可借鉴角度）
              </p>
              <ul>
                <li>
                  <span className="pill purple">对标分析</span>自动归类该号近期选题 + 流量数据，标记「可借鉴」角度入池
                </li>
                <li>
                  <span className="pill todo">待核验</span>无互动数据回溯的公开线索，只借鉴结构、不写「同行已验证」
                </li>
                <li>
                  只借鉴角度与结构 · <b>不照搬文案</b>
                </li>
              </ul>
              <div className="foot">有可回溯证据才能写「同行已验证」</div>
            </div>

            {/* 来源 4 */}
            <div className={src3On ? "src" : "src off"} id="src3">
              <div className="head">
                <span className="no">4</span>
                <b>数据复盘</b>
              </div>
              <div className="ctrl">
                <div className="inline">
                  <span className="ctrl-lab">数据复盘</span>
                  <label className="switch">
                    <input type="checkbox" checked={src3On} onChange={(e) => toggleSource4(e.target.checked)} />
                    <i />
                  </label>
                  <button className="mini-btn act" onClick={() => setGuideOpen((v) => !v)}>
                    📥 视频数据导出指南
                  </button>
                </div>
                {guideOpen && (
                  <div className="guide">
                    <div className="g-t">📥 视频数据导出指南</div>
                    <div className="g-s">不知道数据从哪来、怎么传，先看这里</div>
                    <p className="g-p">
                      请先从你发视频的平台后台导出<b>近 30 天数据表格（CSV / Excel）</b>，然后直接拖到这里上传。
                    </p>
                    <div className="g-h">视频号</div>
                    <ol className="g-ol">
                      <li>登录视频号助手：channels.weixin.qq.com/login.html（扫码登录）</li>
                      <li>进入：数据中心 → 视频数据 → 单篇视频</li>
                      <li>选择日期范围（建议「近 30 天」）→ 下载表格</li>
                      <li>
                        把下载好的表格<b>拖到对话框上传</b>，输入「复盘」
                      </li>
                    </ol>
                    <div className="g-h">上传后我会做什么</div>
                    <ul className="g-ul">
                      <li>自动识别平台字段，缺字段会告诉你哪些数据缺失、是否影响结论</li>
                      <li>一次只复盘一个平台；想换平台请重新上传对应表格</li>
                      <li>建议 5–50 条视频，太少趋势不可信，太多建议拆周期</li>
                    </ul>
                  </div>
                )}
                <div className="drop" onClick={() => fileRef.current?.click()}>
                  {reviewBusy ? "⏳ 正在解析数据表…" : reviewData ? "⬆ 已有数据，点击可重新上传替换" : "⬇ 把近 30 天数据表格（CSV / Excel）拖到这里，或点击选择文件"}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.xls,.xlsx,.tsv,.txt"
                  hidden
                  onChange={(e) => {
                    void onReviewFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                {reviewMsg && <div className="scan-line" style={{ marginTop: 6, color: "var(--amber)" }}>{reviewMsg}</div>}
                {reviewData ? (
                  <div className="scan-line" style={{ marginTop: 6 }}>
                    已上传：<b>{reviewData.fileName}</b> · 平台 {reviewData.platform ?? "未识别"} · {reviewData.rowCount} 条视频 · 上传于 {formatSyncTime(reviewData.uploadedAt)}
                  </div>
                ) : (
                  !reviewMsg && <div className="scan-line" style={{ marginTop: 6 }}>尚未上传数据表。上传后自动解析（不扣积分），生成时带入高表现选题与数据口径。</div>
                )}
                <div className="inline">
                  <span className="ctrl-lab">只显示选题</span>
                  <span style={{ fontSize: 12.5, color: "var(--sub)" }}>复盘报告等其余内容不在此展示，详见「视频数据复盘智能体」</span>
                </div>
                <div className="inline">
                  <span className="ctrl-lab">复盘推荐</span>
                  {reviewData && reviewData.topTitles.length > 0 ? (
                    reviewData.topTitles.slice(0, 3).map((title) => (
                      <span className="rec-chip" key={title} title={title}>
                        {title.length > 18 ? `${title.slice(0, 18)}…` : title}
                      </span>
                    ))
                  ) : (
                    <span style={{ fontSize: 12.5, color: "var(--sub)" }}>上传数据表后，这里显示播放 TOP 视频标题</span>
                  )}
                </div>
              </div>
              <p className="way">上传抖音 / 视频号数据 → 由「视频数据复盘智能体」分析 → 本模块只取推荐选题</p>
              <ul>
                <li>上传 CSV / Excel 后由「视频数据复盘智能体」分析，输出 TOP5 / BOTTOM5 排名（播放 / 互动 / 完播）</li>
                <li>复盘结论只取推荐选题，缺数据时标注「待补」不冒充结论</li>
              </ul>
              <div className="foot">
                所有选题决策有数据支撑 · <b>不凭感觉</b>
              </div>
            </div>
          </div>

          {!src3On && (
            <div className="degrade">
              <span>⚠️</span>
              <span>
                <b>来源 4（数据复盘）已关闭并跳过。</b>配额按后台默认配置自动重分配，候选池相应缩减；其余三源已配置即可生成（已在上方配置校验中放行），缺口在报告中标注「未发现 / 待补」。
              </span>
            </div>
          )}
        </section>

        {/* ---------- 第 2 步 · 三关筛选 ---------- */}
        <section id="gates">
          <div className="sec-head">
            <h2>
              第 2 步 · <span className="k">三关筛选</span>
            </h2>
            <span className="desc">
              ⚙ 前两关自动完成 · 第三关你来选阶段 · 来源≠好坏：自动回答「值不值得拍」，不评分、贴标签
            </span>
          </div>
          <p className="sec-note">两套逻辑完全解耦：来源决定从哪挖，三关决定拍不拍、怎么定位、何时用。</p>
          <div className="gates">
            <div className="gate">
              <span className="gtag">第一关 · 一票否决</span>
              <h3>目标用户想不想看？</h3>
              <p className="sub">只认已有资料里的证据，不额外抓取任何账号数据。</p>
              <div className="rule">
                <b>① 评论区证据</b>
                <br />
                私有知识库同步的评论 / 私信 / 客户原话里，有人问过类似问题吗？
              </div>
              <div className="rule">
                <b>② 同行热度证据</b>
                <br />
                对标账号检索结果里，同类视频有高赞的吗？（与来源③共用同一取数，不另抓）
              </div>
              <div className="stat">
                证据全部来自四大来源既有资料，不做自动抓取账号数据；没有证据时标「待验证」不冒充通过，可继续走后面两关但与「已通过」明确区分，并给出最小验证动作。
              </div>
            </div>

            <div className="gate">
              <span className="gtag">第二关 · 对号入座</span>
              <h3>共识层级 × 客资精准度</h3>
              <p className="sub">共识越高流量越大但客资越泛；每层各有使命，不分好坏。</p>
              <div className="lv-wrap">
                <table className="lv">
                  <tbody>
                    <tr>
                      <th>层级</th>
                      <th>流量</th>
                      <th>客资</th>
                      <th>战略目的</th>
                    </tr>
                    <tr>
                      <td className="name">
                        <span className="cons rx">人性共识</span>
                      </td>
                      <td>百万级</td>
                      <td className="stars">★☆☆☆☆</td>
                      <td className="goal">
                        <b>拉流量</b>，做大体量
                      </td>
                    </tr>
                    <tr>
                      <td className="name">
                        <span className="cons sd">时代共识</span>
                      </td>
                      <td>几十万</td>
                      <td className="stars">★★★☆☆</td>
                      <td className="goal">
                        <b>建认知</b>，让客户认识你
                      </td>
                    </tr>
                    <tr>
                      <td className="name">
                        <span className="cons lr">利益共识</span>
                      </td>
                      <td>几万~十几万</td>
                      <td className="stars">★★★★☆</td>
                      <td className="goal">
                        <b>主力内容</b>，流量客资双拿
                      </td>
                    </tr>
                    <tr>
                      <td className="name">
                        <span className="cons rd">热点共识</span>
                      </td>
                      <td>不稳定</td>
                      <td className="stars">★★★☆☆</td>
                      <td className="goal">
                        <b>借势曝光</b>，趁热打铁
                      </td>
                    </tr>
                    <tr>
                      <td className="name">
                        <span className="cons zy">专业共识</span>
                      </td>
                      <td>几千~几万</td>
                      <td className="stars">★★★★★</td>
                      <td className="goal">
                        <b>收客资</b>，看了就想咨询
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="gate">
              <span className="gtag">第三关 · 配比校准</span>
              <h3>你在哪个阶段？</h3>
              <p className="sub">第一步 · 点选你所在的阶段（选好后下方会显示配比侧重）：</p>
              <div className={stage === null ? "stages" : "stages chosen"}>
                {STAGE_NAMES.map((name, i) => (
                  <button key={name} className={stage === i ? "stage-btn on" : "stage-btn"} onClick={() => setStage(i)}>
                    {name}
                  </button>
                ))}
              </div>
              {stage === null ? (
                <p className="stage-hint">👆 先点上方「起号期 / 增长期 / 变现期」· 选好后这里显示配比侧重</p>
              ) : (
                <div className="quota-bar">
                  {STAGES[stage].q.map(([lab, v, c]) => (
                    <div className="qb" key={lab}>
                      <span className="lab">{lab}</span>
                      <span className="track">
                        <span className="fill" style={{ width: `${(v / 5) * 100}%`, background: c }} />
                      </span>
                      <span className="val">{quotaLabel(v)}</span>
                    </div>
                  ))}
                </div>
              )}
              {stage !== null && <p className="stage-note">{STAGES[stage].note}</p>}
            </div>
          </div>
        </section>

        {/* ---------- 第 3 步 · 交付 10 条 ---------- */}
        <section id="deliver">
          <div className="sec-head">
            <h2>
              第 3 步 · <span className="k">交付 10 条</span>可开拍选题
            </h2>
            <span className="desc">每条带证据状态、标签与创作建议</span>
          </div>
          <p className="sec-note">点击「一键生成」后将基于你选定的私有知识库素材（或通用方法论）生成 10 条选题。不满意可「换一批」重新生成。</p>
          {!canGenerate && (
            <div className="gate-banner">
              <b>{allSourcesReady ? "请先在「第三关·配比校准」点选账号阶段，才能生成" : `来源尚未齐备，暂不能生成（已配置 ${readyCount}/3）`}</b>
              <ul>
                {unreadySources.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="topics-card">
            <div className="bar">
              <b>📋 本批选题（{genTopics ? genTopics.length : 0} 条）</b>
              {!src3On && <span className="src3note show">本次未使用来源 4 · 配额已重分配</span>}
              {/* 没有数据时展示「一键生成」，有数据后才是「换一批」；来源未配置齐时不可点击 */}
              {genTopics && genTopics.length > 0 ? (
                <span
                  className={refreshing ? "refresh busy" : "refresh"}
                  onClick={() => { if (canGenerate) { doRefresh(); void doGenerate(); } }}
                >
                  ↻ 换一批
                </span>
              ) : (
                <span
                  className={canGenerate ? "refresh" : "refresh off"}
                  onClick={() => { if (canGenerate) void doGenerate(); }}
                >
                  ▶ 一键生成
                </span>
              )}
            </div>
            {genTopics === null && (
              <div className="deliver-empty">
                还没有生成选题。点上方「▶ 一键生成今天选题」，系统会基于你选定的私有知识库素材（或通用方法论）生成 10 条可开拍选题。
              </div>
            )}
            <table className="ten">
              <thead>
                <tr>
                  <th>#</th>
                  <th>最终选题</th>
                  <th>类型</th>
                  <th>来源</th>
                  <th>第一关证据</th>
                  <th>共识层级</th>
                  <th>客资准度</th>
                  <th>适用阶段</th>
                  <th>创作建议</th>
                </tr>
              </thead>
              <tbody>
                {dispRows.map((t) => (
                  <tr key={t.id}>
                    <td>{t.id}</td>
                    <td className="t">{t.title}</td>
                    <td>
                      <span className={`type ${t.typeCls}`}>{t.type}</span>
                    </td>
                    <td>{t.source}</td>
                    <td className={t.evState === "pass" ? "ev pass" : "ev todo"}>
                      {t.evState === "pass" ? "通过" : "待验证"}
                      <small>{t.evNote}</small>
                    </td>
                    <td>
                      <span className={`cons ${t.consCls}`}>{t.consensus}</span>
                    </td>
                    <td className="stars">{t.stars}</td>
                    <td>
                      <span className="stage-chip">{t.stage}</span>
                    </td>
                    <td className="advise">{t.advise}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* 手机端卡片视图 */}
            <div className="ten-cards">
              {dispRows.map((t) => (
                <div className="tcard" key={t.id}>
                  <div className="row1">
                    <span className="idx">{t.id}</span>
                    <span className="title">{t.title}</span>
                  </div>
                  <div className="tags">
                    <span className={`type ${t.typeCls}`}>{t.type}</span>
                    <span className={`cons ${t.consCls}`}>{t.consensus}</span>
                    <span className="stars">{t.stars}</span>
                    <span className="stage-chip">{t.stage}</span>
                    <span className={t.evState === "pass" ? "ev pass" : "ev todo"}>
                      {t.evState === "pass" ? "✓ 通过" : "⏳ 待验证"} · {t.evNote}
                    </span>
                  </div>
                  <p className="advise">{t.advise}</p>
                </div>
              ))}
            </div>
          </div>

        </section>
        {genLoading && (
          <div className="wrap">
            <div className="sync-result">
              <b>正在生成选题…（调用模型，约 1–3 分钟）</b>
            </div>
          </div>
        )}
        {genError && (
          <div className="wrap">
            <div className="sync-result err">
              <b>⚠️ {genError}</b>
            </div>
          </div>
        )}
        {genTopics && !genLoading && (
          <div className="wrap">
            <div className="sync-result conclusion">
              <b>已生成 {genTopics.length} 条选题（基于{stagedMaterials.length ? ` 你选的 ${stagedMaterials.length} 条素材` : "通用方法论"}）</b>
            </div>
          </div>
        )}
      </div>

      {materialsOpen && (
        <div className="mat-overlay" onClick={() => setMaterialsOpen(false)}>
          <div className="mat-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="mat-head">
              <div>
                <p className="mat-title">选题素材库</p>
                <p className="mat-sub">已沉淀 {materials.length || conclusionStats?.stored.docs || 0} 条 · 来自 {conclusionStats?.stored.docs || 0} 篇笔记</p>
              </div>
              <div className="mat-x" onClick={() => setMaterialsOpen(false)}>×</div>
            </div>
            <div className="mat-tabs">
              {(["all", "coreView", "quote", "customerQuote"] as const).map((t) => (
                <span key={t} className={materialTab === t ? "mat-tab on" : "mat-tab"} onClick={() => setMaterialTab(t)}>
                  {t === "all" ? "全部" : t === "coreView" ? `核心观点 ${materials.filter((m) => m.type === "coreView").length}` : t === "quote" ? `金句 ${materials.filter((m) => m.type === "quote").length}` : `客户原话 ${materials.filter((m) => m.type === "customerQuote").length}`}
                </span>
              ))}
            </div>
            <input className="mat-search" placeholder="搜索素材内容 / 来源笔记" value={materialSearch} onChange={(e) => setMaterialSearch(e.target.value)} />
            <div className="mat-list">
              {materialsLoading && <div className="mat-empty">加载中…</div>}
              {!materialsLoading && filteredMaterials.length === 0 && <div className="mat-empty">没有匹配的素材</div>}
              {filteredMaterials.map((m) => (
                <div key={m.id} className="mat-row" onClick={() => toggleMaterial(m.id)}>
                  <div className={"mat-box" + (materialSelected.has(m.id) ? " on" : "")} />
                  <span className={"mat-chip " + (m.type === "coreView" ? "cv" : m.type === "quote" ? "qt" : "cu")}>
                    {m.type === "coreView" ? "观点" : m.type === "quote" ? "金句" : "原话"}
                  </span>
                  <span className="mat-tx">
                    {m.text}
                    <small className="mat-src">来源：{m.source}</small>
                  </span>
                </div>
              ))}
            </div>
            <div className="mat-foot">
              <span className="n">已选 <b>{materialSelected.size}</b> 条</span>
              <button className="mat-apply" onClick={applyMaterials}>应用选中</button>
            </div>
          </div>
        </div>
      )}

      {ihDrawerOpen && (
        <div className="mat-overlay" onClick={() => setIhDrawerOpen(false)}>
          <div className="mat-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="mat-head">
              <div>
                <p className="mat-title">行业热点</p>
                <p className="mat-sub">共 {ihItems.length} 条 · 来自公开检索（{industryHotspots?.industry || "—"}）</p>
              </div>
              <div className="mat-x" onClick={() => setIhDrawerOpen(false)}>×</div>
            </div>
            <input className="mat-search" placeholder="搜索热点标题" value={ihSearch} onChange={(e) => setIhSearch(e.target.value)} />
            <div className="mat-list">
              {ihItems.length === 0 && <div className="mat-empty">还没有热点，先在卡片里点「拉取热点」</div>}
              {ihItems.length > 0 && ihFiltered.length === 0 && <div className="mat-empty">没有匹配的热点</div>}
              {ihFiltered.map((t) => (
                <div key={t} className="mat-row" onClick={() => setIhTemp((prev) => { const next = new Set(prev); if (next.has(t)) next.delete(t); else next.add(t); return next; })}>
                  <div className={"mat-box" + (ihTemp.has(t) ? " on" : "")} />
                  <span className="mat-chip cv">热点</span>
                  <span className="mat-tx">
                    {t}
                    <small className="mat-src">来源：搜狗微信 · {industryHotspots?.industry || "行业"}热点检索</small>
                  </span>
                </div>
              ))}
            </div>
            <div className="mat-foot">
              <span className="n">已选 <b>{ihTemp.size}</b> 条</span>
              <button className="mat-apply" onClick={() => void applyHotspots()}>应用选中</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </main>
    </>
  );
}
