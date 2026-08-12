import type { TakeawayAnalysisData } from "./takeaway-workbench-config.js";

const dimensionLabels: Record<TakeawayAnalysisData["anomalies"][number]["dimension"], string> = {
  trend: "时间趋势", funnel: "转化漏斗", product: "菜品结构", profit: "利润空间", campaign: "活动投放", fulfillment: "履约出餐"
};

export type TakeawayAnalysisView = "overview" | "mature" | "new" | "menu" | "campaign";

export function TakeawayAnalysisBoard({ data, compact = false, view = "overview" }: { data: TakeawayAnalysisData; compact?: boolean; view?: TakeawayAnalysisView }) {
  const dimensions = view === "menu" ? new Set(["product", "profit"])
    : view === "campaign" ? new Set(["campaign"])
      : view === "mature" || view === "new" ? new Set(["trend", "funnel", "fulfillment"])
        : undefined;
  const anomalies = dimensions ? data.anomalies.filter((item) => dimensions.has(item.dimension)) : data.anomalies;
  const showTrend = (view === "overview" || view === "mature" || view === "new") && data.trend.length >= 4;
  const showFunnel = (view === "overview" || view === "mature" || view === "new") && data.funnel.length > 0;
  const showProducts = (view === "overview" || view === "menu") && data.products.length >= 2;
  const showCosts = (view === "overview" || view === "menu") && data.catalog.some((item) => item.costRate !== undefined);
  const showCampaigns = (view === "overview" || view === "campaign") && data.campaigns.length > 0;
  const showPlatformEfficiency = (view === "overview" || view === "mature" || view === "new") && data.funnel.length >= 2;
  const showPlatformInvestment = (view === "overview" || view === "mature" || view === "new") && data.funnel.length >= 2;
  const showRefundTrend = (view === "overview" || view === "mature" || view === "new") && data.trend.length >= 4 && data.trend.some((item) => item.refundAmount > 0);
  const chartCount = [showTrend, showFunnel, showPlatformEfficiency, showPlatformInvestment, showRefundTrend, showProducts, showCosts, showCampaigns].filter(Boolean).length;
  const title = view === "menu" ? "菜单与利润证据" : view === "campaign" ? "活动与投放证据" : view === "new" ? "新店起量基线" : view === "mature" ? "老店历史基线" : "经营驾驶舱总览";
  const eyebrow = view === "overview" ? "CEO COCKPIT · AI发现了什么异常 · 基于已导入数据" : "当前任务专属数据";
  return <section className={`takeawayAnalysisBoard ${compact ? "compact" : ""}`} aria-label={`${title}分析`}>
    <header className="takeawayAnalysisHeader"><div><span>{eyebrow}</span><strong>{title}</strong><p>先看经营结果与风险，再看趋势、漏斗和结构。缺失数据只显示待补，不作推断。</p></div><em>{anomalies.length} 个异常 · {chartCount} 个分析视角</em></header>

    {view === "overview" && <CockpitOverview data={data} anomalies={anomalies} />}

    <section className="takeawayPrioritySection" aria-label="异常优先级">
      <header><strong>异常优先级</strong><span>先处理高可信、高影响问题；每项都保留验证方法</span></header>
      <div className="takeawayAnomalyGrid">
        {anomalies.length ? anomalies.slice(0, compact ? 3 : 6).map((item, index) => <article key={item.id} className={item.severity}>
          <header><b>{index + 1}</b><div><small>{dimensionLabels[item.dimension]} · {item.confidence === "high" ? "高可信" : "中可信"}</small><strong>{item.title}</strong></div></header>
          <dl><div><dt>发现依据</dt><dd>{item.evidence}</dd></div><div><dt>怎么比较</dt><dd>{item.comparison}</dd></div><div><dt>科学验证</dt><dd>{item.verification}</dd></div></dl>
        </article>) : <div className="takeawayNoAnomaly"><strong>当前没有发现达到阈值的异常</strong><p>这不代表经营没有问题，只代表现有数据暂时不足以形成可验证的异常。补充日、平台、时段、菜品和履约明细后再扫描。</p></div>}
      </div>
    </section>

    <div className="takeawayChartGrid">
      {showTrend && <TrendChart values={data.trend} />}
      {showFunnel && <FunnelChart values={data.funnel} />}
      {showPlatformEfficiency && <PlatformEfficiencyChart values={data.funnel} />}
      {showPlatformInvestment && <PlatformInvestmentDecisionCard values={data.funnel} />}
      {showRefundTrend && <RefundTrendChart values={data.trend} />}
      {showProducts && <ProductChart values={data.products} />}
      {showCosts && <CostChart values={data.catalog} />}
      {showCampaigns && <CampaignChart values={data.campaigns} />}
    </div>
  </section>;
}

function PlatformInvestmentDecisionCard({ values }: { values: TakeawayAnalysisData["funnel"] }) {
  const shown = values.slice(0, 4);
  const comparable = shown.filter((item) => (item.transactionEvidence === "detail" || item.transactionEvidence === "aligned") && item.effectiveOrders !== undefined && item.paidAmount !== undefined);
  const needsTransactionAlignment = shown.some((item) => item.transactionEvidence === "conflicting");
  const spendReady = comparable.length >= 2 && comparable.every((item) => item.campaignEvidence === "detail" && item.adSpend !== undefined && item.adGmv !== undefined && item.adSpend > 0);
  const rankedByRoi = spendReady ? [...comparable].sort((a, b) => (b.adRoi ?? 0) - (a.adRoi ?? 0)) : [];
  const leader = rankedByRoi[0];
  const runnerUp = rankedByRoi[1];
  const materiallyAhead = leader && runnerUp && (leader.adRoi ?? 0) >= (runnerUp.adRoi ?? 0) * 1.2;
  const decision = !spendReady
    ? needsTransactionAlignment ? "暂不判断新增投入：订单口径待对齐" : "暂不判断新增投入"
    : materiallyAhead
      ? `优先验证 ${leader!.platform} 的新增投入`
      : "两平台回收接近，保持投入并做单变量测试";
  const nextStep = !spendReady
    ? needsTransactionAlignment
      ? "先统一两个平台的订单明细与漏斗文件周期、门店和取消/退款口径；校准后再补齐同周期、计划级广告消耗与广告成交额。"
      : "请补齐两个平台同周期、计划级广告消耗与广告成交额；活动补贴汇总不能当作投放回报。"
    : materiallyAhead
      ? `将新增预算候选优先放在 ${leader!.platform}，但只做待确认的小预算、7天单变量测试；不得直接扩大投放。`
      : "预算暂不倾斜；用同一商品、时段与预算上限做7天对照，再决定是否调整。";
  return <figure className="takeawayChartCard wide takeawayPlatformInvestment" aria-label="双平台投入决策对比">
    <figcaption><strong>淘宝闪购与美团：平台投入决策</strong><span>比较同一筛选范围内的订单、成交、退款和广告成交回收。广告回收=广告成交额÷广告消耗，不等于净利润或边际回报。</span></figcaption>
    <div className={`takeawayInvestmentDecision ${spendReady ? "ready" : "pending"}`}><b>{decision}</b><span>{nextStep}</span></div>
    <div className="takeawayInvestmentGrid">{shown.map((item) => <article key={item.platform}>
      <header><strong>{item.platform}</strong><span>{item.campaignEvidence === "detail" ? "投放明细完整" : item.campaignEvidence === "summary" ? "仅活动成本汇总" : "无投放明细"}</span></header>
      <p>{item.transactionEvidence === "aligned" ? "订单口径：漏斗与订单明细一致" : item.transactionEvidence === "detail" ? "订单口径：订单明细可用" : item.transactionEvidence === "funnel" ? "订单口径：仅漏斗汇总" : item.transactionEvidence === "conflicting" ? "订单口径：漏斗与订单明细不一致，不能用于投入决策" : "订单口径：待补"}</p>
      <dl>
        <div><dt>有效完成单</dt><dd>{formatNumber(item.effectiveOrders)}</dd></div><div><dt>实付成交额</dt><dd>{formatMoney(item.paidAmount)}</dd></div>
        <div><dt>客单价</dt><dd>{formatMoney(item.averageOrderValue)}</dd></div><div><dt>退款率</dt><dd>{formatPercent(item.refundRate)}</dd></div>
        <div><dt>广告消耗</dt><dd>{formatMoney(item.adSpend)}</dd></div><div><dt>广告成交回收</dt><dd>{item.adRoi === undefined ? "待补" : `${item.adRoi.toFixed(2)}x`}</dd></div>
      </dl>
    </article>)}</div>
  </figure>;
}

function CockpitOverview({ data, anomalies }: { data: TakeawayAnalysisData; anomalies: TakeawayAnalysisData["anomalies"] }) {
  const { summary } = data;
  const highRisk = anomalies.filter((item) => item.severity === "high").length;
  return <section className="takeawayCockpitOverview" aria-label="经营驾驶舱关键指标">
    <div className="takeawayKpiGrid">
      <KpiCard label="有效完成单" value={formatNumber(summary.effectiveOrders)} note="剔除退单/退款" />
      <KpiCard label="实付成交额" value={formatMoney(summary.paidAmount)} note={summary.averageOrderValue === undefined ? "客单价待补" : `客单价 ${formatMoney(summary.averageOrderValue)}`} />
      <KpiCard label="退款率" value={formatPercent(summary.refundRate)} note={summary.refundRate === undefined ? "退款明细待补" : "按订单退单/退款识别"} tone="risk" />
      <KpiCard label="贡献率" value={formatPercent(summary.contributionRate)} note={summary.contributionAmount === undefined ? "成本或成交额待补" : `贡献 ${formatMoney(summary.contributionAmount)}`} />
    </div>
    <aside className={`takeawayCockpitSignal ${highRisk > 0 ? "risk" : ""}`}><strong>{highRisk > 0 ? `${highRisk} 个高优先级风险` : "先从趋势与漏斗找增长断点"}</strong><span>{data.trend.length ? `${data.trend[0]?.date} 至 ${data.trend.at(-1)?.date}` : "当前没有可用时间序列"}</span></aside>
  </section>;
}

function KpiCard({ label, value, note, tone = "normal" }: { label: string; value: string; note: string; tone?: "normal" | "risk" }) {
  return <article className={`takeawayCockpitKpi ${tone}`}><small>{label}</small><strong>{value}</strong><span>{note}</span></article>;
}

function TrendChart({ values }: { values: TakeawayAnalysisData["trend"] }) {
  const width = 680;
  const height = 230;
  const inset = { left: 38, right: 42, top: 22, bottom: 31 };
  const plotWidth = width - inset.left - inset.right;
  const plotHeight = height - inset.top - inset.bottom;
  const maxPaid = Math.max(1, ...values.map((item) => item.paidAmount));
  const maxOrders = Math.max(1, ...values.map((item) => item.effectiveOrders));
  const barWidth = Math.max(5, Math.min(28, plotWidth / values.length * 0.58));
  const points = values.map((item, index) => {
    const x = inset.left + (values.length === 1 ? plotWidth / 2 : index / (values.length - 1) * plotWidth);
    return { x, y: inset.top + (1 - item.effectiveOrders / maxOrders) * plotHeight, item };
  });
  const labels = new Set([0, values.length - 1, ...values.map((_, index) => index).filter((index) => values.length <= 6 || index % Math.ceil(values.length / 5) === 0)]);
  return <figure className="takeawayChartCard wide takeawayRevenueTrend" aria-label="每日有效订单趋势">
    <figcaption><strong>成交额与有效订单趋势</strong><span>柱：实付成交额（左轴，元） · 线：有效订单（右轴，单） · 双轴仅用于同步观察规模变化</span></figcaption>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="成交额柱状图与有效订单折线图">
      {[0, .5, 1].map((ratio) => <line key={ratio} x1={inset.left} y1={inset.top + plotHeight * ratio} x2={width - inset.right} y2={inset.top + plotHeight * ratio} className="chartGuide" />)}
      <text x={inset.left} y={13}>成交额 ¥{shortNumber(maxPaid)}</text><text x={width - inset.right} y={13} textAnchor="end">有效单 {shortNumber(maxOrders)}</text>
      {values.map((item, index) => { const x = points[index]!.x; const barHeight = item.paidAmount / maxPaid * plotHeight; return <g key={item.date}><rect x={x - barWidth / 2} y={inset.top + plotHeight - barHeight} width={barWidth} height={barHeight} rx="3" className="chartRevenueBar"><title>{`${item.date}：实付 ${formatMoney(item.paidAmount)}，有效订单 ${formatNumber(item.effectiveOrders)} 单`}</title></rect>{labels.has(index) && <text x={x} y={height - 8} textAnchor="middle">{item.date.slice(5)}</text>}</g>; })}
      <polyline points={points.map((point) => `${point.x},${point.y}`).join(" ")} className="chartOrderLine" />
      {points.map((point) => <circle key={point.item.date} cx={point.x} cy={point.y} r="3.4" className="chartOrderPoint" />)}
    </svg>
  </figure>;
}

function FunnelChart({ values }: { values: TakeawayAnalysisData["funnel"] }) {
  const stages = [
    { label: "曝光", value: sumDefined(values.map((item) => item.exposure)) }, { label: "进店", value: sumDefined(values.map((item) => item.visits)) },
    { label: "下单", value: sumDefined(values.map((item) => item.orders)) }, { label: "有效完成", value: sumDefined(values.map((item) => item.effectiveOrders)) }
  ];
  const usable = stages.filter((stage) => stage.value !== undefined);
  const maximum = Math.max(1, ...usable.map((stage) => stage.value ?? 0));
  return <figure className="takeawayChartCard">
    <figcaption><strong>经营漏斗全景</strong><span>汇总已筛选平台；阶段缺失时不计算转化率</span></figcaption>
    <div className="takeawayFunnelStages">{usable.map((stage, index) => <div key={stage.label}><header><span>{stage.label}</span><strong>{formatNumber(stage.value)}</strong></header><i><em style={{ width: `${Math.max(6, (stage.value ?? 0) / maximum * 100)}%` }} /></i>{index > 0 && <small>较上一步 {formatPercent(ratio(stage.value, usable[index - 1]?.value))}</small>}</div>)}</div>
    <div className="takeawayFunnelPlatform"><b>平台转化效率对比</b>{values.map((item) => <span key={item.platform}>{item.platform}：进店→下单 {formatPercent(item.orderRate)}</span>)}</div>
  </figure>;
}

function PlatformEfficiencyChart({ values }: { values: TakeawayAnalysisData["funnel"] }) {
  const shown = values.filter((item) => item.orderRate !== undefined || item.completionRate !== undefined).slice(0, 6);
  const maximum = Math.max(0.01, ...shown.flatMap((item) => [item.orderRate ?? 0, item.completionRate ?? 0]));
  return <figure className="takeawayChartCard takeawayPlatformEfficiency" aria-label="平台转化效率图">
    <figcaption><strong>平台转化效率对比</strong><span>深绿：进店→下单；浅绿：下单→有效完成。缺失阶段不显示，不推断。</span></figcaption>
    <div className="takeawayPlatformBars">{shown.map((item) => <div key={item.platform}>
      <header><strong>{item.platform}</strong><span>{item.orderRate === undefined ? "进店→下单待补" : `进店→下单 ${formatPercent(item.orderRate)}`}</span></header>
      <div><i><em style={{ width: `${(item.orderRate ?? 0) / maximum * 100}%` }} /></i><b>{formatPercent(item.orderRate)}</b></div>
      <div><i className="completion"><em style={{ width: `${(item.completionRate ?? 0) / maximum * 100}%` }} /></i><b>{formatPercent(item.completionRate)}</b></div>
    </div>)}</div>
  </figure>;
}

function RefundTrendChart({ values }: { values: TakeawayAnalysisData["trend"] }) {
  const totalPaid = Math.max(1, ...values.map((item) => item.paidAmount));
  const labels = new Set([0, values.length - 1, ...values.map((_, index) => index).filter((index) => values.length <= 6 || index % Math.ceil(values.length / 5) === 0)]);
  return <figure className="takeawayChartCard wide takeawayRefundTrend" aria-label="退款金额与退款率趋势">
    <figcaption><strong>退款金额与退款率趋势</strong><span>柱：退款金额；标签：退款金额 ÷ 当日实付成交额。仅展示已识别退款，不把空值当作零。</span></figcaption>
    <div className="takeawayRefundBars">{values.map((item, index) => {
      const rate = item.paidAmount > 0 ? item.refundAmount / item.paidAmount : undefined;
      return <div key={item.date}><i><em style={{ height: `${Math.max(3, item.refundAmount / totalPaid * 100)}%` }} /><span>{item.refundAmount > 0 ? formatMoney(item.refundAmount) : "—"}</span></i>{labels.has(index) && <small>{item.date.slice(5)}</small>}<b>{rate === undefined ? "待补" : formatPercent(rate)}</b></div>;
    })}</div>
  </figure>;
}

function ProductChart({ values }: { values: TakeawayAnalysisData["products"] }) {
  const shown = values.slice(0, 6); const maximum = Math.max(1, ...shown.map((item) => item.paidAmount));
  return <figure className="takeawayChartCard"><figcaption><strong>菜品成交额结构</strong><span>TOP {shown.length} · 用于识别过度集中和弱势菜品</span></figcaption><div className="takeawayRankBars">{shown.map((item) => <div key={item.name}><span title={item.name}>{item.name}</span><i><em style={{ width: `${item.paidAmount / maximum * 100}%` }} /></i><strong>{formatMoney(item.paidAmount)}</strong></div>)}</div></figure>;
}

function CostChart({ values }: { values: TakeawayAnalysisData["catalog"] }) {
  const shown = values.filter((item) => item.costRate !== undefined).sort((a, b) => (b.costRate ?? 0) - (a.costRate ?? 0)).slice(0, 6);
  return <figure className="takeawayChartCard"><figcaption><strong>菜品成本率风险</strong><span>成本 ÷ 当前参考售价 · 不含平台、包装和配送</span></figcaption><div className="takeawayRankBars cost">{shown.map((item) => <div key={item.name}><span title={item.name}>{item.name}</span><i><em style={{ width: `${Math.min(100, (item.costRate ?? 0) * 100)}%` }} /></i><strong>{formatPercent(item.costRate)}</strong></div>)}</div></figure>;
}

function CampaignChart({ values }: { values: TakeawayAnalysisData["campaigns"] }) {
  const shown = values.slice(0, 5); const maximum = Math.max(1, ...shown.map((item) => item.spend)); const isDetail = shown.some((item) => item.evidence === "detail");
  return <figure className="takeawayChartCard"><figcaption><strong>{isDetail ? "投放消耗与成交回收" : "商家活动成本分布"}</strong><span>{isDetail ? "只有计划明细完整时才计算ROI" : "活动成本不是广告投放消耗"}</span></figcaption><div className="takeawayRankBars campaign">{shown.map((item) => <div key={`${item.platform}-${item.name}`}><span title={item.name}>{item.platform} · {item.name}</span><i><em style={{ width: `${item.spend / maximum * 100}%` }} /></i><strong>{item.roi === undefined ? formatMoney(item.spend) : `${item.roi.toFixed(2)}x`}</strong></div>)}</div></figure>;
}

function sumDefined(values: Array<number | undefined>): number | undefined { const known = values.filter((value): value is number => value !== undefined); return known.length ? known.reduce((sum, value) => sum + value, 0) : undefined; }
function ratio(value?: number, total?: number): number | undefined { return value !== undefined && total !== undefined && total > 0 ? value / total : undefined; }
function formatNumber(value?: number): string { return value === undefined ? "待补" : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value); }
function formatMoney(value?: number): string { return value === undefined ? "待补" : `¥${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value)}`; }
function formatPercent(value?: number): string { return value === undefined ? "待补" : `${(value * 100).toFixed(1)}%`; }
function shortNumber(value: number): string { return value >= 10000 ? `${(value / 10000).toFixed(1)}万` : formatNumber(value); }
