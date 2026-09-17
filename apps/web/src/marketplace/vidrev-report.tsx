// 视频复盘（vidrev）结构化渲染。
// 契约：CODEX-视频复盘智能体-样例输出.md §七 ——
// 第零章审计置顶且不可折叠、四象限 2×2 可点击筛选、第三章横向堆叠条（悬停看均播/互动率/完播率）、
// 第五章分桶与第七章周趋势柱状图同时画均值+中位数、¥ 与百分比两位小数、null 显示「数据缺失」、
// 第十章候选选题可一键带入选题智能体、移动端图表横滚且表格前三列固定。
// 下载口径（用户 2026-09-17）：「下方有下载精美 word，所以这里的输出不用再说输出 markdown 和 csv，
// 也不需要展开 markdown 原文」——报告卡片里不再有任何导出按钮与原文折叠，唯一下载入口是
// 对话页底部那颗「⬇ 下载精美 Word / WPS 报告」。
import { useState } from "react";
import { getAppPath } from "../lib/api.js";

const MISSING = "数据缺失";
/** 选中候选选题跳转时写进 sessionStorage，由选题智能体对话页读取（一次性）。 */
export const VIDREV_PREFILL_KEY = "store_os_chat_prefill";

export interface VidrevBucket {
  bucket: string;
  count: number;
  avgPlays: number | null;
  medianPlays: number | null;
  completionRate: number | null;
  note?: string;
}

export interface VidrevVideoRow {
  video_id: string;
  index: number;
  title: string;
  duration_sec: number | null;
  published_at: string | null;
  plays: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  completion_rate: number | null;
  completion_5s: number | null;
  conversions: number;
  is_paid: boolean;
  ad_spend: number | null;
  content_type: string;
  engagement_rate: number | null;
}

export interface VidrevDeepPayload {
  kind: "vidrev";
  mode: "deep";
  data_quality: {
    total_records: number;
    completion_coverage: number;
    completion_status: string;
    comment_status: string;
    publish_time_precision: string;
    paid_flag: string;
    limited_dimensions: string[];
  };
  overview: {
    video_count: number;
    total_plays: number;
    total_engagement: number;
    engagement_rate: number | null;
    total_conversions: number;
    ad_spend: number | null;
    roi: number | null;
    roi_note: string;
    trend: string;
    baseline_compare: { median_plays: number; median_engagement: number | null };
    median_plays: number;
    median_conversions: number;
  };
  quadrant: { both: string[]; plays_no_conv: string[]; conv_no_plays: string[]; neither: string[]; notes: string[] };
  content_health: {
    distribution: Array<{
      type: string;
      count: number;
      share: number;
      avg_plays: number | null;
      engagement_rate: number | null;
      completion_rate: number | null;
      verdict: string;
    }>;
    health_score: number;
    verdict: string;
    adjust: { add: string[]; cut: string[]; change: string[] };
  };
  deep_dive: Array<{
    video_id: string;
    title: string;
    metrics: Record<string, number | string | null>;
    reasons: string[];
    reusable: string[];
    improve: string[];
  }>;
  videos?: VidrevVideoRow[];
  completion_attrib: {
    by_duration: VidrevBucket[];
    by_type: Array<{ type: string; completion_rate: number | null }>;
    best_formula: string;
  };
  engagement_depth: {
    shallow_rate: number | null;
    deep_rate: number | null;
    like_share_ratio: number | null;
    verdict: string;
    top_sharers: Array<{ video_id: string; share_rate: number }>;
  };
  trend_alert: {
    baseline: { median_plays: number; warn_line: number; good_line: number; median_engagement: number | null };
    weekly: Array<{ week: string; range: string; count: number; avgPlays: number; medianPlays: number }>;
    alerts: Array<{ level: string; item: string; trigger: string; action: string }>;
    positives: string[];
  };
  patterns: { hook: string; topic: string; format: string; timing: string; conversion: string };
  methodology: Array<{ type: string; rule: string; evidence: string; confidence: string; topic_hint: string }>;
  next_topics: {
    replicate: string[];
    reoptimize: string[];
    boost: string[];
    drop: string[];
    candidates: Array<{ title: string; reason: string; source: string }>;
  };
  soft_warnings: string[];
  report_markdown: string;
}

export interface VidrevQuickPayload {
  kind: "vidrev";
  mode: "quick";
  quick: { points: string[]; next_action: string; note: string };
  report_markdown: string;
}

export type VidrevPayload = VidrevQuickPayload | VidrevDeepPayload;

export function isVidrevPayload(payload: unknown): payload is VidrevPayload {
  const candidate = payload as { kind?: unknown } | null | undefined;
  return Boolean(candidate) && candidate?.kind === "vidrev";
}

// ---------------------------------------------------------------------------
// 数值格式：¥ 与百分比一律两位小数；null / undefined 显示「数据缺失」，禁止当 0
// ---------------------------------------------------------------------------

function isNum(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function pct(value: number | null | undefined): string {
  return isNum(value) ? `${(value * 100).toFixed(2)}%` : MISSING;
}

function money(value: number | null | undefined): string {
  if (!isNum(value)) return MISSING;
  return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function int(value: number | null | undefined): string {
  return isNum(value) ? value.toLocaleString("zh-CN") : MISSING;
}

function txt(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  return text && text !== "-" && text !== "—" ? text : MISSING;
}

function metricOf(item: { metrics: Record<string, number | string | null> }, key: string): number | null {
  const value = item.metrics?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[¥￥,%\s]/g, ""));
    if (Number.isFinite(parsed)) return value.includes("%") ? parsed / 100 : parsed;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 图表（纯 CSS，无第三方依赖）
// ---------------------------------------------------------------------------

const STACK_COLORS = ["#f47920", "#4aa8ff", "#37c98b", "#b98bff", "#ffb020", "#ff6b81", "#5fd0d8", "#9aa4b2"];

/** 横向堆叠条：占比 + 悬停显示均播 / 互动率 / 完播率。 */
function ShareStack({
  items
}: {
  items: Array<{ type: string; count: number; share: number; avgPlays: number | null; engagementRate: number | null; completionRate: number | null }>;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = items.reduce((sum, item) => sum + (isNum(item.share) ? item.share : 0), 0);
  const active = hover !== null ? items[hover] : null;
  return (
    <div className="vrv-stack">
      <div className="vrv-stack-bar">
        {items.map((item, index) => (
          <span
            key={item.type}
            className="vrv-stack-seg"
            style={{
              width: `${total > 0 ? Math.max(item.share / total, 0.005) * 100 : 0}%`,
              background: STACK_COLORS[index % STACK_COLORS.length]
            }}
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover((current) => (current === index ? null : current))}
            title={`${item.type}｜${item.count} 条｜均播 ${int(item.avgPlays)}｜互动率 ${pct(item.engagementRate)}｜完播率 ${pct(item.completionRate)}`}
          >
            {item.share >= 0.08 ? <em>{pct(item.share)}</em> : null}
          </span>
        ))}
      </div>
      <div className="vrv-stack-legend">
        {items.map((item, index) => (
          <span key={item.type} className={hover === index ? "on" : ""} onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)}>
            <i style={{ background: STACK_COLORS[index % STACK_COLORS.length] }} />
            {item.type} · {item.count} 条 · {pct(item.share)}
          </span>
        ))}
      </div>
      <div className="vrv-stack-tip">
        {active
          ? `${active.type}：均播 ${int(active.avgPlays)}｜互动率 ${pct(active.engagementRate)}｜完播率 ${pct(active.completionRate)}`
          : "把鼠标放到色条上，看该类型的均播 / 互动率 / 完播率"}
      </div>
    </div>
  );
}

/** 分组柱状图：同一张图同时画均值与中位数（均值被极值污染是本智能体的关键结论）。 */
function MeanMedianBars({ rows }: { rows: Array<{ label: string; sub?: string; mean: number | null; median: number | null }> }) {
  const max = Math.max(
    1,
    ...rows.flatMap((row) => [isNum(row.mean) ? row.mean : 0, isNum(row.median) ? row.median : 0])
  );
  return (
    <div className="vrv-bars">
      <div className="vrv-bars-legend">
        <span><i className="mean" />均值</span>
        <span><i className="median" />中位数</span>
      </div>
      <div className="vrv-scroll">
        <div className="vrv-bars-grid" style={{ minWidth: `${Math.max(rows.length * 96, 320)}px` }}>
          {rows.map((row) => (
            <div className="vrv-bars-col" key={`${row.label}-${row.sub ?? ""}`}>
              <div className="vrv-bars-plot">
                <span className="vrv-bar mean" style={{ height: `${isNum(row.mean) ? (row.mean / max) * 100 : 0}%` }} title={`均值 ${int(row.mean)}`}>
                  <em>{isNum(row.mean) ? int(row.mean) : MISSING}</em>
                </span>
                <span className="vrv-bar median" style={{ height: `${isNum(row.median) ? (row.median / max) * 100 : 0}%` }} title={`中位数 ${int(row.median)}`}>
                  <em>{isNum(row.median) ? int(row.median) : MISSING}</em>
                </span>
              </div>
              <b className="vrv-bars-label">{row.label}</b>
              {row.sub ? <span className="vrv-bars-sub">{row.sub}</span> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

const QUADRANTS: Array<{ key: keyof VidrevDeepPayload["quadrant"]; label: string; hint: string; pos: string }> = [
  { key: "conv_no_plays", label: "有转无量", hint: "非高播放 + 高转化", pos: "tl" },
  { key: "both", label: "又爆又赚", hint: "高播放 + 高转化", pos: "tr" },
  { key: "neither", label: "没量没转", hint: "低播放 + 低转化", pos: "bl" },
  { key: "plays_no_conv", label: "有量无转", hint: "高播放 + 非高转化", pos: "br" }
];

const PATTERN_ROWS: Array<[string, keyof VidrevDeepPayload["patterns"]]> = [
  ["钩子", "hook"],
  ["选题", "topic"],
  ["形式", "format"],
  ["时间", "timing"],
  ["转化", "conversion"]
];

const NEXT_TOPIC_BLOCKS: Array<[string, keyof VidrevDeepPayload["next_topics"], string]> = [
  ["主力复制（又爆又赚池）", "replicate", "🟢"],
  ["优化重拍（有量无转池）", "reoptimize", "🟡"],
  ["投流放量（有转无量池）", "boost", "🔵"],
  ["放弃方向", "drop", "🔴"]
];

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV 中文表头与契约 §三 字段表一致；缺失一律留空，禁止补 0。 */
export function vidrevCsv(videos: VidrevVideoRow[]): string {
  const header = ["序号", "标题", "时长(秒)", "发布时间", "播放", "点赞", "评论", "分享", "收藏", "完播率", "5秒完播率", "咨询量", "是否投流", "投流金额", "内容类型"];
  const lines = [header.join(",")];
  for (const video of videos) {
    lines.push(
      [
        video.video_id,
        video.title,
        video.duration_sec ?? null,
        video.published_at ?? null,
        video.plays,
        video.likes,
        video.comments,
        video.shares,
        video.saves,
        isNum(video.completion_rate) ? `${(video.completion_rate * 100).toFixed(2)}%` : null,
        isNum(video.completion_5s) ? `${(video.completion_5s * 100).toFixed(2)}%` : null,
        video.conversions,
        video.is_paid ? "是" : "否",
        isNum(video.ad_spend) ? video.ad_spend : null,
        video.content_type
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return lines.join("\r\n");
}

export function VidrevReport({
  payload,
  renderMarkdown,
  topicSkuCode
}: {
  payload: VidrevPayload;
  renderMarkdown: (markdown: string) => string;
  /** 同专区「选题」智能体的 skuCode；点「加入选题池」时带着候选选题跳过去。 */
  topicSkuCode?: string | null;
}) {
  const [quadrant, setQuadrant] = useState<string | null>(null);
  const [queued, setQueued] = useState<string | null>(null);

  /** §七.6：候选选题带标题+来源跳选题智能体（写一次性 prefill，由对话页带入该轮问题）。 */
  function queueTopic(title: string, reason: string) {
    const value = `【来自视频复盘 · 数据复盘】候选选题：${title}${reason ? `\n理由：${reason}` : ""}`;
    try {
      sessionStorage.setItem(VIDREV_PREFILL_KEY, JSON.stringify({ sku: "topic", slotKey: "data", value, note: `已带入视频复盘的候选选题：${title}` }));
    } catch {
      // 隐私模式下写入失败不阻断跳转。
    }
    setQueued(title);
    if (topicSkuCode) {
      window.location.href = getAppPath(`/agent/${encodeURIComponent(topicSkuCode)}/chat`);
    } else {
      window.location.href = getAppPath("/agents");
    }
  }

  /**
   * 用户 2026-09-17 口径：「下方有下载精美 word，所以这里的输出不用再说输出 markdown 和 csv，
   * 也不需要展开 markdown 原文」——报告卡片的下载入口只保留模板底部那颗 Word / WPS 按钮，
   * 这里不再放 Markdown / CSV 导出，也不再展开 md 原文（那两种格式装不下整篇报告，只会让人误解）。
   * 只留下「已带入选题池」这一句操作反馈。
   */
  const exportBar = queued ? (
    <div className="vrv-export">
      <span className="vrv-queued">✓ 已带入选题池：{queued}</span>
    </div>
  ) : null;

  if (payload.mode === "quick") {
    return (
      <div className="vrv">
        <div className="chat-report vrv-quick">
          <div className="cr-head">🚀 快速诊断</div>
          <div className="cr-sec">
            <ul className="cr-list">
              {payload.quick.points.map((point, index) => <li key={index}>{point}</li>)}
            </ul>
            <div className="vrv-action">立即动作：{txt(payload.quick.next_action)}</div>
          </div>
          <div className="cr-foot"><span>{txt(payload.quick.note)}</span></div>
        </div>
        {exportBar}
      </div>
    );
  }

  const videos = payload.videos ?? [];
  const videoById = new Map(videos.map((video) => [video.video_id, video]));
  const selectedIds = quadrant ? (payload.quadrant[quadrant as keyof VidrevDeepPayload["quadrant"]] as string[] | undefined) ?? [] : [];
  const selectedVideos = selectedIds.map((id) => videoById.get(id)).filter((item): item is VidrevVideoRow => Boolean(item));
  const byDurationRows = payload.completion_attrib.by_duration.map((bucket) => ({
    label: bucket.bucket,
    sub: `${bucket.count} 条 · 完播 ${pct(bucket.completionRate)}`,
    mean: bucket.avgPlays,
    median: bucket.medianPlays
  }));
  const weeklyRows = payload.trend_alert.weekly.map((week) => ({
    label: week.week,
    sub: `${week.range || ""} · ${week.count} 条`.trim(),
    mean: week.avgPlays,
    median: week.medianPlays
  }));
  const sharerById = new Map(videos.map((video) => [video.video_id, video]));

  return (
    <div className="vrv">
      {/* 第零章：置顶且不可折叠 */}
      <div className="chat-report vrv-audit">
        <div className="cr-head">⓪ 数据质量审计</div>
        <div className="cr-sec">
          <div className="vrv-scroll">
            <table className="report-table vrv-table-fix">
              <tbody>
                <tr><th scope="row">总记录数</th><td>{int(payload.data_quality.total_records)} 条</td></tr>
                <tr><th scope="row">完播率覆盖</th><td>{pct(payload.data_quality.completion_coverage)} {payload.data_quality.completion_status}</td></tr>
                <tr><th scope="row">评论数据</th><td>{txt(payload.data_quality.comment_status)}</td></tr>
                <tr><th scope="row">发布时段</th><td>{txt(payload.data_quality.publish_time_precision)}</td></tr>
                <tr><th scope="row">投流标记</th><td>{txt(payload.data_quality.paid_flag)}</td></tr>
              </tbody>
            </table>
          </div>
          {payload.data_quality.limited_dimensions.length > 0 && (
            <div className="vrv-warn">
              <b>受限维度（结论强度已下调）</b>
              <ol>
                {payload.data_quality.limited_dimensions.map((item, index) => <li key={index}>{item}</li>)}
              </ol>
            </div>
          )}
          {payload.soft_warnings.length > 0 && (
            <div className="vrv-warn soft">
              <b>软校验提示（不影响交付，仅提醒）</b>
              <ul>{payload.soft_warnings.map((item, index) => <li key={index}>{item}</li>)}</ul>
            </div>
          )}
        </div>
      </div>

      {/* 第一章 */}
      <div className="chat-report">
        <div className="cr-head">一、数据总览</div>
        <div className="cr-sec">
          <div className="vrv-scroll">
            <table className="report-table vrv-table-fix">
              <tbody>
                <tr><th scope="row">视频总数</th><td>{int(payload.overview.video_count)} 条</td></tr>
                <tr><th scope="row">总播放</th><td>{int(payload.overview.total_plays)}</td></tr>
                <tr><th scope="row">总互动</th><td>{int(payload.overview.total_engagement)}（互动率 {pct(payload.overview.engagement_rate)}，加权）</td></tr>
                <tr><th scope="row">总转化</th><td>{int(payload.overview.total_conversions)}</td></tr>
                <tr><th scope="row">投流金额</th><td>{money(payload.overview.ad_spend)}</td></tr>
                <tr><th scope="row">ROI</th><td>{isNum(payload.overview.roi) ? payload.overview.roi.toFixed(2) : MISSING}{payload.overview.roi_note ? `（${payload.overview.roi_note}）` : ""}</td></tr>
                <tr><th scope="row">趋势</th><td>{txt(payload.overview.trend)}</td></tr>
                <tr><th scope="row">账号基线</th><td>单条播放中位数 {int(payload.overview.baseline_compare.median_plays)}；互动率中位数 {pct(payload.overview.baseline_compare.median_engagement)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="vrv-note">
            判断账号健康度一律看中位数：本周期均播 {int(payload.overview.total_plays / Math.max(payload.overview.video_count, 1))}，中位数 {int(payload.overview.median_plays)}。
          </div>
        </div>
      </div>

      {/* 第二章：四象限 2×2，可点击筛选 */}
      <div className="chat-report">
        <div className="cr-head">二、视频分层</div>
        <div className="cr-sec">
          <div className="vrv-quad-meta">
            分层口径：播放中位数 {int(payload.overview.median_plays)}、转化中位数 {int(payload.overview.median_conversions)}；
            高线 = 中位数 ×1.5，低线 = 中位数 ×0.6。
          </div>
          <div className="vrv-quad">
            {QUADRANTS.map((item) => {
              const ids = (payload.quadrant[item.key] as string[] | undefined) ?? [];
              const on = quadrant === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`vrv-quad-cell ${item.pos}${on ? " on" : ""}`}
                  onClick={() => setQuadrant(on ? null : item.key)}
                >
                  <b>{item.label}</b>
                  <span className="vrv-quad-count">{ids.length} 条</span>
                  <em>{item.hint}</em>
                  <span className="vrv-quad-ids">{ids.join(" / ") || "—"}</span>
                </button>
              );
            })}
          </div>
          <div className="vrv-quad-axis">横轴：播放量（左低右高）　·　纵轴：转化数（上高下低）　·　点象限筛选下方视频卡片</div>
          {payload.quadrant.notes.length > 0 && (
            <ul className="cr-list vrv-quad-notes">{payload.quadrant.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
          )}
          {quadrant && (
            <div className="vrv-quad-detail">
              <div className="cr-sub-h">
                {QUADRANTS.find((item) => item.key === quadrant)?.label} · {selectedVideos.length} 条
                {selectedIds.length > selectedVideos.length ? `（${selectedIds.length - selectedVideos.length} 条无明细数据）` : ""}
                <button className="ipr-copy" onClick={() => setQuadrant(null)}>收起</button>
              </div>
              <div className="vrv-video-grid">
                {selectedVideos.map((video) => (
                  <div className="vrv-video-card" key={video.video_id}>
                    <b>{video.title}</b>
                    <span className="vrv-video-sub">#{video.video_id} · {video.content_type || "未标注"}{video.duration_sec !== null ? ` · ${video.duration_sec}s` : ""}</span>
                    <div className="vrv-video-metrics">
                      <span>播放 {int(video.plays)}</span>
                      <span>转化 {int(video.conversions)}</span>
                      <span>完播 {pct(video.completion_rate)}</span>
                      <span>{video.is_paid ? `投流 ${money(video.ad_spend)}` : "自然流"}</span>
                    </div>
                  </div>
                ))}
                {selectedVideos.length === 0 && <div className="vrv-video-card">该象限没有可用明细。</div>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 第三章：配比堆叠条 */}
      <div className="chat-report">
        <div className="cr-head">三、内容结构健康度</div>
        <div className="cr-sec">
          <ShareStack
            items={payload.content_health.distribution.map((item) => ({
              type: item.type,
              count: item.count,
              share: item.share,
              avgPlays: item.avg_plays,
              engagementRate: item.engagement_rate,
              completionRate: item.completion_rate
            }))}
          />
          <div className="vrv-scroll">
            <table className="report-table vrv-table-fix">
              <thead>
                <tr><th>类型</th><th>条数</th><th>占比</th><th>均播</th><th>互动率</th><th>完播率</th><th>判定</th></tr>
              </thead>
              <tbody>
                {payload.content_health.distribution.map((item) => (
                  <tr key={item.type}>
                    <td>{item.type}</td>
                    <td>{int(item.count)}</td>
                    <td>{pct(item.share)}</td>
                    <td>{int(item.avg_plays)}</td>
                    <td>{pct(item.engagement_rate)}</td>
                    <td>{pct(item.completion_rate)}</td>
                    <td>{txt(item.verdict)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="vrv-note">
            健康度评分 =（爆款型 + 人设型）/ 总数 = {pct(payload.content_health.health_score)} → {txt(payload.content_health.verdict)}
          </div>
          <div className="vrv-adjust">
            <div><b>增</b><ul>{(payload.content_health.adjust.add ?? []).map((item, index) => <li key={index}>{item}</li>)}{payload.content_health.adjust.add.length === 0 && <li>{MISSING}</li>}</ul></div>
            <div><b>减</b><ul>{(payload.content_health.adjust.cut ?? []).map((item, index) => <li key={index}>{item}</li>)}{payload.content_health.adjust.cut.length === 0 && <li>{MISSING}</li>}</ul></div>
            <div><b>改</b><ul>{(payload.content_health.adjust.change ?? []).map((item, index) => <li key={index}>{item}</li>)}{payload.content_health.adjust.change.length === 0 && <li>{MISSING}</li>}</ul></div>
          </div>
        </div>
      </div>

      {/* 第四章 */}
      <div className="chat-report">
        <div className="cr-head">四、单条深拆（TOP3 + BOTTOM3）</div>
        <div className="cr-sec">
          {payload.deep_dive.map((item, index) => (
            <div className="vrv-dive" key={item.video_id}>
              <div className="cr-sub-h">{index + 1}. #{item.video_id}「{item.title}」</div>
              <div className="vrv-dive-metrics">
                播放 {int(metricOf(item, "plays"))}｜赞 {int(metricOf(item, "likes"))}｜评 {int(metricOf(item, "comments"))}｜分享 {int(metricOf(item, "shares"))}｜收藏 {int(metricOf(item, "saves"))}｜完播 {pct(metricOf(item, "completion_rate"))}｜5秒完播 {pct(metricOf(item, "completion_5s"))}｜咨询 {int(metricOf(item, "conversions"))}｜{isNum(metricOf(item, "ad_spend")) ? `投流 ${money(metricOf(item, "ad_spend"))}` : "自然流"}
              </div>
              <div className="cr-sub-h">为什么是它</div>
              <ul className="cr-list">{item.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>
              <div className="cr-sub-h">可复用</div>
              <ul className="cr-list">{item.reusable.map((line, i) => <li key={i}>{line}</li>)}</ul>
              <div className="cr-sub-h">改进</div>
              <ul className="cr-list">{item.improve.map((line, i) => <li key={i}>{line}</li>)}</ul>
            </div>
          ))}
        </div>
      </div>

      {/* 第五章：分桶柱状图（均值 + 中位数） */}
      <div className="chat-report">
        <div className="cr-head">五、完播率深层归因</div>
        <div className="cr-sec">
          <div className="cr-sub-h">按时长分桶（自适应 {payload.completion_attrib.by_duration.length} 桶）：均播 vs 中位数</div>
          <MeanMedianBars rows={byDurationRows} />
          <div className="vrv-scroll">
            <table className="report-table vrv-table-fix">
              <thead><tr><th>时长区间</th><th>条数</th><th>均播</th><th>播放中位数</th><th>完播率</th></tr></thead>
              <tbody>
                {payload.completion_attrib.by_duration.map((bucket) => (
                  <tr key={bucket.bucket}>
                    <td>{bucket.bucket}</td>
                    <td>{int(bucket.count)}</td>
                    <td>{int(bucket.avgPlays)}</td>
                    <td>{int(bucket.medianPlays)}</td>
                    <td>{pct(bucket.completionRate)}{bucket.note ? `（${bucket.note}）` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="cr-sub-h">按类型分桶（完播率）</div>
          <div className="vrv-scroll">
            <table className="report-table vrv-table-fix">
              <thead><tr><th>类型</th><th>完播率</th></tr></thead>
              <tbody>
                {payload.completion_attrib.by_type.map((item) => <tr key={item.type}><td>{item.type}</td><td>{pct(item.completion_rate)}</td></tr>)}
              </tbody>
            </table>
          </div>
          <div className="vrv-note">最佳配方：{txt(payload.completion_attrib.best_formula)}</div>
        </div>
      </div>

      {/* 第六章 */}
      <div className="chat-report">
        <div className="cr-head">六、互动深度分析</div>
        <div className="cr-sec">
          <div className="vrv-scroll">
            <table className="report-table vrv-table-fix">
              <thead><tr><th>指标</th><th>数值</th></tr></thead>
              <tbody>
                <tr><td>浅层互动率（赞）</td><td>{pct(payload.engagement_depth.shallow_rate)}</td></tr>
                <tr><td>深层互动率（评论 + 分享）</td><td>{pct(payload.engagement_depth.deep_rate)}</td></tr>
                <tr><td>赞 / 分享比</td><td>{isNum(payload.engagement_depth.like_share_ratio) ? `${payload.engagement_depth.like_share_ratio.toFixed(2)} : 1` : MISSING} {payload.engagement_depth.verdict}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="cr-sub-h">分享王者 TOP3（按分享率）</div>
          <div className="vrv-scroll">
            <table className="report-table vrv-table-fix">
              <thead><tr><th>#</th><th>标题</th><th>分享</th><th>分享率</th></tr></thead>
              <tbody>
                {payload.engagement_depth.top_sharers.map((item) => {
                  const video = sharerById.get(item.video_id);
                  return (
                    <tr key={item.video_id}>
                      <td>{item.video_id}</td>
                      <td>{video?.title ?? MISSING}</td>
                      <td>{int(video?.shares ?? null)}</td>
                      <td>{pct(item.share_rate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 第七章：周趋势柱状图（均值 + 中位数） */}
      <div className="chat-report">
        <div className="cr-head">七、趋势预警</div>
        <div className="cr-sec">
          <div className="cr-sub-h">账号基线（中位数口径）</div>
          <div className="vrv-scroll">
            <table className="report-table vrv-table-fix">
              <thead><tr><th>指标</th><th>中位数</th><th>警戒线</th><th>优秀线</th></tr></thead>
              <tbody>
                <tr><td>单条播放</td><td>{int(payload.trend_alert.baseline.median_plays)}</td><td>&lt;{int(payload.trend_alert.baseline.warn_line)}</td><td>&gt;{int(payload.trend_alert.baseline.good_line)}</td></tr>
                <tr><td>互动率</td><td>{pct(payload.trend_alert.baseline.median_engagement)}</td><td>—</td><td>—</td></tr>
              </tbody>
            </table>
          </div>
          <div className="cr-sub-h">{payload.trend_alert.weekly.length} 周趋势：均播 vs 中位数</div>
          <MeanMedianBars rows={weeklyRows} />
          {payload.trend_alert.alerts.length > 0 && (
            <div className="vrv-scroll">
              <table className="report-table vrv-table-fix">
                <thead><tr><th>级别</th><th>异常</th><th>触发条件</th><th>立即行动</th></tr></thead>
                <tbody>
                  {payload.trend_alert.alerts.map((alert, index) => (
                    <tr key={index}><td>{alert.level}</td><td>{alert.item}</td><td>{alert.trigger}</td><td>{alert.action}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {payload.trend_alert.positives.length > 0 && (
            <>
              <div className="cr-sub-h">积极信号</div>
              <ul className="cr-list">{payload.trend_alert.positives.map((line, index) => <li key={index}>{line}</li>)}</ul>
            </>
          )}
        </div>
      </div>

      {/* 第八章 */}
      <div className="chat-report">
        <div className="cr-head">八、规律总结</div>
        <div className="cr-sec">
          <div className="vrv-scroll">
            <table className="report-table vrv-table-fix">
              <thead><tr><th>维度</th><th>规律</th></tr></thead>
              <tbody>
                {PATTERN_ROWS.map(([label, key]) => <tr key={key}><td>{label}</td><td>{txt(payload.patterns[key])}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 第九章 */}
      <div className="chat-report">
        <div className="cr-head">九、方法论沉淀</div>
        <div className="cr-sec">
          {payload.methodology.map((item, index) => (
            <div className="vrv-method" key={index}>
              <div className="cr-sub-h">{index + 1}. 类型：{txt(item.type)}｜置信度：{txt(item.confidence)}</div>
              <p>{txt(item.rule)}</p>
              <div className="vrv-method-meta">证据：{txt(item.evidence)}</div>
              <div className="vrv-method-meta">相关选题：{txt(item.topic_hint)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 第十章 */}
      <div className="chat-report">
        <div className="cr-head">十、下个周期选题建议</div>
        <div className="cr-sec">
          {NEXT_TOPIC_BLOCKS.map(([label, key, icon]) => {
            const items = (payload.next_topics[key] as string[] | undefined) ?? [];
            return (
              <div className="vrv-next" key={key}>
                <div className="cr-sub-h">{icon} {label}</div>
                <ul className="cr-list">{items.map((line, index) => <li key={index}>{line}</li>)}{items.length === 0 && <li>{MISSING}</li>}</ul>
              </div>
            );
          })}
          <div className="cr-sub-h">候选选题（来源：数据复盘 · 可直接进选题池）</div>
          <div className="vrv-candidates">
            {payload.next_topics.candidates.map((candidate, index) => (
              <div className="vrv-candidate" key={`${candidate.title}-${index}`}>
                <b>{candidate.title}</b>
                {candidate.reason ? <span>{candidate.reason}</span> : null}
                <div className="vrv-candidate-foot">
                  <span className="chip soon">来源：{txt(candidate.source)}</span>
                  <button className="btn primary sm" onClick={() => queueTopic(candidate.title, candidate.reason)}>＋ 加入选题池</button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="cr-foot"><span>报告口径：空值不当 0、比率用加权平均、时长分桶自适应。</span></div>
      </div>

      {exportBar}
    </div>
  );
}
