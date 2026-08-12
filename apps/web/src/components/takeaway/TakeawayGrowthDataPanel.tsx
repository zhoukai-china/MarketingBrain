import { useEffect, useMemo, useRef, useState } from "react";
import { apiPath } from "../../lib/api.js";
import { takeawayFieldLabel, type TakeawayAnalysisData, type TakeawayWorkbenchDataStatus } from "./takeaway-workbench-config.js";
import { TakeawayAnalysisBoard } from "./TakeawayAnalysisBoard.js";

interface ImportView {
  id: string;
  filename: string;
  sourceKind: "orders" | "funnel" | "products" | "campaigns" | "catalog" | "mixed";
  platform?: string;
  storeName?: string;
  dateFrom?: string;
  dateTo?: string;
  rowCount: number;
  duplicateCount: number;
  qualityScore: number;
  missingFields: string[];
  warnings: string[];
  createdAt: string;
}

interface ImportResult {
  filename: string;
  status: "new" | "duplicate" | "failed";
  detail: string;
}

interface DashboardView {
  generatedAt: string;
  filters: {
    stores: string[];
    platforms: string[];
    selectedStore?: string;
    selectedPlatform?: string;
    dateFrom?: string;
    dateTo?: string;
  };
  dataStatus: {
    importCount: number;
    rowCount: number;
    latestImportedAt?: string;
    latestDataDate?: string;
    qualityScore: number;
    level: "ready" | "partial" | "insufficient";
    productEvidence: "sales" | "catalog_only" | "none";
    campaignEvidence: "detail" | "summary" | "none";
    missingFields: string[];
    warnings: string[];
  };
  summary: {
    effectiveOrders?: number;
    paidAmount?: number;
    averageOrderValue?: number;
    refundAmount?: number;
    refundRate?: number;
    merchantSubsidy?: number;
    platformSubsidy?: number;
    contributionAmount?: number;
    contributionRate?: number;
    averagePrepMinutes?: number;
  };
  funnel: Array<{
    platform: string;
    exposure?: number;
    visits?: number;
    orders?: number;
    effectiveOrders?: number;
    entryRate?: number;
    orderRate?: number;
    completionRate?: number;
  }>;
  trend: Array<{ date: string; effectiveOrders: number; paidAmount: number; refundAmount: number }>;
  products: Array<{ name: string; quantity: number; paidAmount: number; refundAmount: number; contributionAmount?: number }>;
  catalog: Array<{
    name: string;
    category?: string;
    costAmount?: number;
    meituanPrice?: number;
    flashPrice?: number;
    campaignPrice?: number;
    referencePrice?: number;
    costRate?: number;
    portion?: string;
  }>;
  campaigns: Array<{
    name: string;
    platform: string;
    spend: number;
    orders: number;
    gmv: number;
    roi?: number;
    evidence: "detail" | "summary";
    costType: "ad_spend" | "merchant_activity_cost";
  }>;
  anomalies: TakeawayAnalysisData["anomalies"];
  recentImports: ImportView[];
}

const sourceKindLabels: Record<ImportView["sourceKind"], string> = {
  orders: "订单明细",
  funnel: "流量漏斗",
  products: "菜品经营",
  campaigns: "活动投放",
  catalog: "菜品成本/价格货盘",
  mixed: "综合数据"
};

export function TakeawayGrowthDataPanel({
  headers,
  onStartDiagnosis,
  onDashboardChange,
  openImportSignal = 0,
  variant = "panel",
  inputId
}: {
  headers: Record<string, string>;
  onStartDiagnosis: (prompt: string) => void;
  onDashboardChange?: (status: TakeawayWorkbenchDataStatus | null) => void;
  openImportSignal?: number;
  variant?: "panel" | "import-only";
  inputId?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"dashboard" | "import">(variant === "import-only" ? "import" : "dashboard");
  const [dashboard, setDashboard] = useState<DashboardView | null>(null);
  const [selectedStore, setSelectedStore] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState("");
  const [storeHint, setStoreHint] = useState("");
  const [platformHint, setPlatformHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importResults, setImportResults] = useState<ImportResult[]>([]);

  async function loadDashboard(store = selectedStore, platform = selectedPlatform): Promise<void> {
    const query = new URLSearchParams();
    if (store) query.set("storeName", store);
    if (platform) query.set("platform", platform);
    const response = await fetch(apiPath(`/agents/takeaway-growth/dashboard${query.size ? `?${query.toString()}` : ""}`), { headers });
    setDashboard(await readJson<DashboardView>(response));
  }

  useEffect(() => {
    void loadDashboard().catch((reason) => setError(readableError(reason)));
  }, []);

  useEffect(() => {
    if (openImportSignal > 0) setTab("import");
  }, [openImportSignal]);

  useEffect(() => {
    if (variant === "import-only") setTab("import");
  }, [variant]);

  async function upload(files?: FileList | File[]): Promise<void> {
    const selectedFiles = Array.from(files ?? []);
    if (selectedFiles.length === 0 || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    setImportResults([]);
    const completed: Array<{ filename: string; kind: ImportView["sourceKind"]; rows: number; duplicate: boolean }> = [];
    const results: ImportResult[] = [];
    try {
      for (const [index, file] of selectedFiles.entries()) {
        setNotice(`正在识别并校验 ${index + 1}/${selectedFiles.length}：${file.name}`);
        try {
          const query = new URLSearchParams();
          if (storeHint.trim()) query.set("storeName", storeHint.trim());
          if (platformHint) query.set("platform", platformHint);
          const form = new FormData();
          form.append("file", file, file.name);
          const response = await fetch(apiPath(`/agents/takeaway-growth/imports${query.size ? `?${query.toString()}` : ""}`), {
            method: "POST",
            headers,
            body: form
          });
          const payload = await readJson<{ duplicateFile: boolean; import: ImportView; dashboard: DashboardView }>(response);
          setDashboard(payload.dashboard);
          completed.push({ filename: file.name, kind: payload.import.sourceKind, rows: payload.import.rowCount, duplicate: payload.duplicateFile });
          results.push({
            filename: file.name,
            status: payload.duplicateFile ? "duplicate" : "new",
            detail: payload.duplicateFile ? "文件内容与已导入记录一致，已保留原记录" : `${sourceKindLabels[payload.import.sourceKind]} · ${payload.import.rowCount} 行已识别`
          });
          setImportResults([...results]);
        } catch (reason) {
          results.push({ filename: file.name, status: "failed", detail: readableError(reason) });
          setImportResults([...results]);
        }
      }
      setSelectedStore("");
      setSelectedPlatform("");
      if (completed.length > 0) {
        setNotice("本次文件处理完成，请查看下方逐文件明细。");
        setTab("dashboard");
      }
      const failedCount = results.filter((item) => item.status === "failed").length;
      if (failedCount > 0) {
        setError(`有 ${failedCount} 个文件未导入成功；完整原因已在本次导入明细中列出。`);
        if (completed.length === 0) setTab("import");
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function applyFilters(nextStore: string, nextPlatform: string): Promise<void> {
    setSelectedStore(nextStore);
    setSelectedPlatform(nextPlatform);
    setBusy(true);
    setError("");
    try {
      await loadDashboard(nextStore, nextPlatform);
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  }

  const diagnosisPrompt = useMemo(() => {
    const status = dashboard?.dataStatus;
    const summary = dashboard?.summary;
    const funnelFacts = dashboard?.funnel.map((item) => [
      `${item.platform}：曝光 ${formatNumber(item.exposure)}`,
      `进店 ${formatNumber(item.visits)}（${formatPercent(item.entryRate)}）`,
      `下单 ${formatNumber(item.orders)}（${formatPercent(item.orderRate)}）`,
      `有效完成 ${formatNumber(item.effectiveOrders)}（${formatPercent(item.completionRate)}）`
    ].join("，")).join("\n") || "暂无完整平台漏斗";
    const catalogFacts = dashboard?.catalog?.length
      ? `已识别菜品成本/价格货盘 ${dashboard.catalog.length} 项；成本率较高的菜品：${dashboard.catalog.slice(0, 5).map((item) => `${item.name} ${formatPercent(item.costRate)}`).join("、")}。`
      : "菜品成本/价格货盘：待补";
    const productFacts = status?.productEvidence === "sales"
      ? `已识别菜品销量 ${dashboard?.products.length ?? 0} 项。`
      : status?.productEvidence === "catalog_only"
        ? "已识别菜品货盘，但当前结构化表格不含菜品销量；若销量仅在截图中，图片证据尚未结构化。"
        : "当前结构化文件未包含菜品销量。";
    const campaignFacts = status?.campaignEvidence === "detail"
      ? `已识别活动/投放明细 ${dashboard?.campaigns.length ?? 0} 项。`
      : status?.campaignEvidence === "summary"
        ? "已识别平台活动成本汇总，但没有计划名称、广告消耗、曝光和点击明细；不得当作广告投放消耗或计划级 ROI。"
        : "活动与投放：当前结构化文件未识别到可用明细。";
    const anomalyFacts = dashboard?.anomalies?.length
      ? dashboard.anomalies.map((item, index) => `${index + 1}. ${item.title}；证据：${item.evidence}；对比：${item.comparison}；验证：${item.verification}；可信度：${item.confidence === "high" ? "高" : "中"}。`).join("\n")
      : "当前数据未发现达到系统阈值的经营异常；这不代表经营没有问题，只代表现有数据不足以形成可验证异常。";
    return [
      "以下是外卖增长经营看板从已导入文件中计算出的事实。请先完成数据口径审计，再诊断当前最大增长断点。",
      "已确认品牌事实：枕水江南经营城市为沈阳，当前没有上海门店。菜品或套餐名称中的“上海”只代表菜品风格，不得推断为经营城市。",
      `本次使用数据：${status?.importCount ?? 0} 份文件 / ${(status?.rowCount ?? 0).toLocaleString("zh-CN")} 行 / 更新至 ${status?.latestDataDate ?? "待识别"}。`,
      selectedStore ? `门店：${selectedStore}` : "门店：全部已导入门店",
      selectedPlatform ? `平台：${selectedPlatform}` : "平台：全部已导入平台",
      status?.latestDataDate ? `数据更新至：${status.latestDataDate}` : "数据更新日期：待识别",
      `有效完成单：${formatNumber(summary?.effectiveOrders)}；实付成交额：${formatMoney(summary?.paidAmount)}；客单价：${formatMoney(summary?.averageOrderValue)}；退款率：${formatPercent(summary?.refundRate)}；平均出餐：${summary?.averagePrepMinutes === undefined ? "待补" : `${summary.averagePrepMinutes.toFixed(1)} 分钟`}；贡献率：${formatPercent(summary?.contributionRate)}。`,
      "平台漏斗：",
      funnelFacts,
      catalogFacts,
      productFacts,
      campaignFacts,
      "系统异常扫描：",
      anomalyFacts,
      `数据质量：${status?.qualityScore ?? 0}/100；缺失字段：${status?.missingFields.map(takeawayFieldLabel).join("、") || "无已识别缺口"}。`,
      `口径警告：${status?.warnings.join("；") || "暂无已识别警告"}。`,
      status?.warnings.some((warning) => /倒挂|高于下单量|口径不一致/.test(warning)) ? "存在关键漏斗口径异常，修正前不得用该漏斗做增长归因。" : "当前未识别到阻断诊断的漏斗倒挂。",
      "请区分已确认事实、方向性信号和待验证假设，只给一个待审批的单变量实验，并写明利润、退款、履约护栏与止损条件。"
    ].join("\n");
  }, [dashboard, selectedPlatform, selectedStore]);

  useEffect(() => {
    if (!dashboard) {
      onDashboardChange?.(null);
      return;
    }
    onDashboardChange?.({
      importCount: dashboard.dataStatus.importCount,
      rowCount: dashboard.dataStatus.rowCount,
      qualityScore: dashboard.dataStatus.qualityScore,
      level: dashboard.dataStatus.level,
      latestDataDate: dashboard.dataStatus.latestDataDate,
      selectedStore: selectedStore || undefined,
      selectedPlatform: selectedPlatform || undefined,
      missingFields: [...dashboard.dataStatus.missingFields],
      warnings: [...dashboard.dataStatus.warnings],
      sourceFiles: dashboard.recentImports.map((item) => ({
        filename: item.filename,
        rowCount: item.rowCount,
        duplicateCount: item.duplicateCount,
        qualityScore: item.qualityScore,
        missingFields: [...item.missingFields],
        warnings: [...item.warnings]
      })),
      productEvidence: dashboard.dataStatus.productEvidence,
      campaignEvidence: dashboard.dataStatus.campaignEvidence,
      coverage: {
        funnel: dashboard.funnel.length > 0,
        products: dashboard.dataStatus.productEvidence === "sales",
        catalog: dashboard.catalog.length > 0,
        campaigns: dashboard.dataStatus.campaignEvidence !== "none",
        costs: dashboard.catalog.some((item) => item.costAmount !== undefined),
        prices: dashboard.catalog.some((item) => item.referencePrice !== undefined)
      },
      analysis: {
        summary: { ...dashboard.summary },
        funnel: [...dashboard.funnel],
        trend: [...dashboard.trend],
        products: [...dashboard.products],
        catalog: dashboard.catalog.map((item) => ({ name: item.name, costAmount: item.costAmount, referencePrice: item.referencePrice, costRate: item.costRate })),
        campaigns: [...dashboard.campaigns],
        anomalies: [...dashboard.anomalies]
      },
      contextPrompt: diagnosisPrompt
    });
  }, [dashboard, diagnosisPrompt, selectedPlatform, selectedStore]);

  const hasData = Boolean(dashboard?.dataStatus.rowCount);
  const newCount = importResults.filter((item) => item.status === "new").length;
  const duplicateCount = importResults.filter((item) => item.status === "duplicate").length;
  const failedCount = importResults.filter((item) => item.status === "failed").length;
  const importMessages = <>
    {notice && <p className="takeawayDataNotice" role="status">{notice}</p>}
    {error && <p className="takeawayDataError" role="alert">{error}</p>}
  </>;
  const importReceipt = importResults.length ? <section className="takeawayImportReceipt" aria-label="本次导入明细">
    <header><strong>本次导入明细</strong><span>选择 {importResults.length} 份 → 新增 {newCount} 份 / 重复 {duplicateCount} 份 / 失败 {failedCount} 份</span></header>
    <ul>{importResults.map((item, index) => <li key={`${item.filename}-${index}`} className={item.status}><div><b>{item.filename}</b><small>{item.status === "new" ? "新增" : item.status === "duplicate" ? "重复" : "失败"}</small></div><p>{item.detail}</p></li>)}</ul>
  </section> : null;
  const importFeedback = <>{importMessages}{importReceipt}</>;

  const importPane = <section className="takeawayImportPane">
    <div className="takeawayImportIntro"><strong>把外卖经营文件直接交给系统</strong><p>可一次选择多份文件；系统会自动识别订单、流量、菜品销量、菜品成本/价格货盘和投放数据，允许表头前存在标题或说明行。</p></div>
    <label>门店提示（可选）<input value={storeHint} onChange={(event) => setStoreHint(event.target.value)} placeholder="例如：中街店" /></label>
    <label>平台提示（可选）<select value={platformHint} onChange={(event) => setPlatformHint(event.target.value)}><option value="">自动识别</option><option value="美团">美团</option><option value="淘宝闪购">淘宝闪购</option></select></label>
    <button type="button" className="takeawayFileDrop" disabled={busy} onClick={() => inputRef.current?.click()}>
      <span>{busy ? "正在识别并校验…" : "选择经营数据文件（可多选）"}</span>
      <small>支持 XLSX、XLS、CSV、TSV、JSON、TXT；单文件不超过 30MB</small>
    </button>
    <input id={inputId} ref={inputRef} hidden type="file" multiple accept=".xlsx,.xls,.csv,.tsv,.json,.txt" onChange={(event) => void upload(event.target.files ?? undefined)} />
    <div className="takeawayImportBoundary"><strong>隐私边界</strong><p>订单号会单向哈希后保存；顾客姓名、电话、地址不会进入经营看板。</p></div>
    {importFeedback}
    {dashboard?.recentImports.length ? <div className="takeawayRecentImports"><strong>去重后已入库文件（共 {dashboard.recentImports.length} 份）</strong><small>这是可用于分析的唯一文件数；重复上传不会重复计数。右侧是每份文件的识别质量，不是经营业绩分。</small>{dashboard.recentImports.map((item) => <article key={item.id}><div><b>{item.filename}</b><small>{sourceKindLabels[item.sourceKind]} · {item.rowCount} 行</small></div><span>识别 {item.qualityScore} 分</span></article>)}</div> : null}
  </section>;

  return (
    <aside className={`agentContextPanel takeawayDataPanel ${variant === "import-only" ? "takeawayImportEmbed" : ""}`}>
      {variant === "import-only" ? importPane : <>
      <header className="takeawayDataHeader">
        <div><span>GROWTH DATA</span><strong>外卖经营数据</strong></div>
        <em className={dashboard?.dataStatus.level ?? "insufficient"}>{dashboard?.dataStatus.qualityScore ?? 0}</em>
      </header>
      <nav className="takeawayDataTabs">
        <button type="button" className={tab === "dashboard" ? "active" : ""} onClick={() => setTab("dashboard")}>经营看板</button>
        <button type="button" className={tab === "import" ? "active" : ""} onClick={() => setTab("import")}>智能导入</button>
      </nav>

      {tab === "import" ? importPane : !hasData ? (
        <section className="takeawayDashboardEmpty">
          <span>数</span><strong>经营看板等待真实数据</strong><p>先导入一份美团或淘宝闪购导出表。没有真实数据时，系统不会生成占位指标。</p><button type="button" onClick={() => setTab("import")}>开始智能导入</button>
        </section>
      ) : (
        <section className="takeawayDashboardPane">
          <div className="takeawayDashboardFilters">
            <select aria-label="筛选门店" value={selectedStore} onChange={(event) => void applyFilters(event.target.value, selectedPlatform)}><option value="">全部门店</option>{dashboard!.filters.stores.map((store) => <option key={store}>{store}</option>)}</select>
            <select aria-label="筛选平台" value={selectedPlatform} onChange={(event) => void applyFilters(selectedStore, event.target.value)}><option value="">全部平台</option>{dashboard!.filters.platforms.map((platform) => <option key={platform}>{platform}</option>)}</select>
          </div>
           <div className="takeawayFreshness"><span className={dashboard!.dataStatus.level} />更新至 {dashboard!.dataStatus.latestDataDate ?? "待识别"}<b>{dashboard!.dataStatus.rowCount} 行</b></div>
           {importReceipt}
           <div className="takeawayKpiGrid">
            <Kpi label="有效完成单" value={formatNumber(dashboard!.summary.effectiveOrders)} note="剔除退单/退款" />
            <Kpi label="实付成交额" value={formatMoney(dashboard!.summary.paidAmount)} note={`客单 ${formatMoney(dashboard!.summary.averageOrderValue)}`} />
            <Kpi label="退款率" value={formatPercent(dashboard!.summary.refundRate)} note={`退款 ${formatMoney(dashboard!.summary.refundAmount)}`} tone={(dashboard!.summary.refundRate ?? 0) > 0.05 ? "warning" : undefined} />
            <Kpi label="贡献额" value={formatMoney(dashboard!.summary.contributionAmount)} note={dashboard!.summary.contributionAmount === undefined ? "缺少成本，暂不计算" : `贡献率 ${formatPercent(dashboard!.summary.contributionRate)}`} />
            <Kpi label="平均出餐" value={dashboard!.summary.averagePrepMinutes === undefined ? "待补" : `${dashboard!.summary.averagePrepMinutes.toFixed(1)} 分钟`} note="枕水目标 ≤16 分钟" tone={(dashboard!.summary.averagePrepMinutes ?? 0) > 16 ? "warning" : undefined} />
          </div>

          <TakeawayAnalysisBoard data={{ summary: dashboard!.summary, funnel: dashboard!.funnel, trend: dashboard!.trend, products: dashboard!.products, catalog: dashboard!.catalog, campaigns: dashboard!.campaigns, anomalies: dashboard!.anomalies }} compact />

          {dashboard!.products.length > 0 && <div className="takeawayPanelBlock takeawayProductBlock"><header><strong>菜品经营 TOP</strong><small>份数来自商品明细；金额按订单实付比例分摊</small></header>{dashboard!.products.slice(0, 6).map((item, index) => <article key={item.name}><span>{index + 1}</span><div><b>{item.name}</b><small>{item.quantity} 份 · 退款 {formatMoney(item.refundAmount)}</small></div><strong>{formatMoney(item.paidAmount)}</strong></article>)}</div>}
          {dashboard!.catalog?.length > 0 && <div className="takeawayPanelBlock takeawayProductBlock"><header><strong>菜品成本与价格</strong><small>优先显示成本率较高项</small></header>{dashboard!.catalog.slice(0, 6).map((item, index) => <article key={`${item.name}-${index}`}><span>{index + 1}</span><div><b>{item.name}</b><small>成本 {formatMoney(item.costAmount)} · 美团 {formatMoney(item.meituanPrice)} · 闪购 {formatMoney(item.flashPrice)}</small></div><strong>{formatPercent(item.costRate)}</strong></article>)}</div>}
          {dashboard!.campaigns.length > 0 && <div className="takeawayPanelBlock takeawayCampaignBlock"><header><strong>{dashboard!.dataStatus.campaignEvidence === "summary" ? "平台活动汇总" : "活动投放"}</strong><small>{dashboard!.dataStatus.campaignEvidence === "summary" ? "活动成本不等于广告消耗" : "ROI = 成交额 ÷ 消耗"}</small></header>{dashboard!.campaigns.slice(0, 5).map((item) => <article key={`${item.platform}-${item.name}`}><div><b>{item.name}</b><small>{item.platform} · {item.costType === "merchant_activity_cost" ? "商家活动成本" : "消耗"} {formatMoney(item.spend)}</small></div><strong>{item.roi === undefined ? "待补明细" : `${item.roi.toFixed(2)}x`}</strong></article>)}</div>}

          <div className={`takeawayQualityCard ${dashboard!.dataStatus.level}`}><header><strong>数据识别质量 {dashboard!.dataStatus.qualityScore}/100</strong><span>{qualityLabel(dashboard!.dataStatus.level)}</span></header><p>衡量文件和字段是否可用于分析，不代表门店经营好坏，也不表示只读取了这些比例的数据。</p>{dashboard!.dataStatus.missingFields.length > 0 && <p>部分文件未提供：{dashboard!.dataStatus.missingFields.slice(0, 6).map(takeawayFieldLabel).join("、")}</p>}{dashboard!.dataStatus.warnings.slice(0, 3).map((warning) => <small key={warning}>{warning}</small>)}</div>
          <button type="button" className="takeawayDiagnosisButton" onClick={() => onStartDiagnosis(diagnosisPrompt)}>用当前数据启动诊断</button>
        </section>
      )}
       {tab !== "import" && importMessages}
      </>}
    </aside>
  );
}

function Kpi({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "warning" }) {
  return <article className={tone ? `warning ${tone}` : ""}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function FunnelRow({ item }: { item: DashboardView["funnel"][number] }) {
  const stages = [
    { label: "曝光", value: item.exposure, rate: undefined },
    { label: "进店", value: item.visits, rate: item.entryRate },
    { label: "下单", value: item.orders, rate: item.orderRate },
    { label: "有效", value: item.effectiveOrders, rate: item.completionRate }
  ];
  const maximum = Math.max(1, ...stages.map((stage) => stage.value ?? 0));
  return <article className="takeawayFunnelRow"><header><b>{item.platform}</b></header><div>{stages.map((stage) => <span key={stage.label}><i style={{ width: `${Math.max(8, ((stage.value ?? 0) / maximum) * 100)}%` }} /><b>{formatNumber(stage.value)}</b><small>{stage.label}{stage.rate === undefined ? "" : ` · ${formatPercent(stage.rate)}`}</small></span>)}</div></article>;
}

function MiniTrend({ values }: { values: DashboardView["trend"] }) {
  const width = 300;
  const height = 94;
  const maximum = Math.max(1, ...values.map((item) => item.effectiveOrders));
  const points = values.map((item, index) => `${values.length === 1 ? width / 2 : (index / (values.length - 1)) * width},${height - (item.effectiveOrders / maximum) * (height - 12) - 4}`).join(" ");
  return <div className="takeawayMiniTrend"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="有效订单趋势"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />{values.map((item, index) => { const [x, y] = points.split(" ")[index].split(","); return <circle key={item.date} cx={x} cy={y} r="3.5" fill="currentColor"><title>{item.date}：{item.effectiveOrders} 单</title></circle>; })}</svg><footer><span>{values[0]?.date.slice(5)}</span><b>峰值 {maximum} 单</b><span>{values.at(-1)?.date.slice(5)}</span></footer></div>;
}

function formatNumber(value?: number): string {
  return value === undefined ? "待补" : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value);
}

function formatMoney(value?: number): string {
  return value === undefined ? "待补" : `¥${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value)}`;
}

function formatPercent(value?: number): string {
  return value === undefined ? "待补" : `${(value * 100).toFixed(1)}%`;
}

function qualityLabel(level: DashboardView["dataStatus"]["level"]): string {
  return level === "ready" ? "可用于诊断" : level === "partial" ? "部分结论需补数" : "数据不足";
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as { message?: string; error?: string };
  if (!response.ok) throw new Error(payload.message ?? payload.error ?? "数据服务暂时不可用");
  return payload as T;
}

function readableError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  return message && !/^[a-z0-9_:-]+$/i.test(message) ? message : "数据导入失败，请检查文件格式后重试。";
}
