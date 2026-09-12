// 视频复盘智能体（vidrev）确定性引擎。
//
// 契约来源：CODEX-视频复盘智能体-样例输出.md（WorkBuddy v1 2026-09-10，正式副本见
// packages/skills/skills/baolu_review_engine）。本文件负责三件事：
//   1) 把用户上传的数据（CSV / Markdown 表格 / 口语化数据）解析成同一份可复算的 rows；
//   2) 用这份 rows 重算全部硬口径（加权比率、中位数基线、四象限、自适应时长分桶、健康度、赞分享比）；
//   3) 校验模型输出的 Markdown 报告是否满足 V1–V12 与违禁词硬门槛，并产出前端渲染用 payload。
//
// 设计原则：数字一律由本文件重算，模型只负责措辞与归因；缺失字段传 null，禁止补 0。

export interface VidrevRawRow {
  video_id?: string | null;
  title?: string | null;
  duration_sec?: number | string | null;
  published_at?: string | null;
  plays?: number | string | null;
  likes?: number | string | null;
  comments?: number | string | null;
  shares?: number | string | null;
  saves?: number | string | null;
  completion_rate?: number | string | null;
  completion_5s?: number | string | null;
  conversions?: number | string | null;
  is_paid?: boolean | string | null;
  ad_spend?: number | string | null;
  content_type?: string | null;
}

export interface VidrevVideo {
  id: string;
  index: number;
  title: string;
  durationSec: number | null;
  publishedAt: string | null;
  plays: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  completionRate: number | null;
  completion5s: number | null;
  conversions: number;
  paid: boolean;
  adSpend: number | null;
  contentType: string;
  family: string;
  engagement: number;
  engagementRate: number | null;
  shareRate: number | null;
  playsShare: number;
}

export interface VidrevQuadrant {
  both: string[];
  plays_no_conv: string[];
  conv_no_plays: string[];
  neither: string[];
  notes: string[];
}

export interface VidrevBucket {
  bucket: string;
  count: number;
  avgPlays: number | null;
  /** 与均播同图展示：样例里「均值被极值污染」是关键结论，必须能画出中位数。 */
  medianPlays: number | null;
  completionRate: number | null;
  note?: string;
}

export interface VidrevTypeStat {
  type: string;
  family: string;
  count: number;
  share: number;
  avgPlays: number | null;
  engagementRate: number | null;
  completionRate: number | null;
}

export interface VidrevWeekStat {
  week: string;
  range: string;
  count: number;
  avgPlays: number;
  medianPlays: number;
}

export interface VidrevMetrics {
  count: number;
  videos: VidrevVideo[];
  totalPlays: number;
  totalEngagement: number;
  totalConversions: number;
  totalSaves: number;
  adSpend: number;
  paidCount: number;
  engagementRate: number | null;
  completionRateWeighted: number | null;
  completionCoverage: number;
  completion5sCoverage: number;
  completionStatus: string;
  completion5sStatus: string;
  paidFlagStatus: string;
  commentStatus: string;
  publishTimePrecision: string;
  medianPlays: number;
  medianConversions: number;
  medianEngagementRate: number | null;
  baseline: { median_plays: number; warn_line: number; good_line: number; median_engagement: number | null };
  quadrant: VidrevQuadrant;
  buckets: VidrevBucket[];
  byType: VidrevTypeStat[];
  healthScore: number;
  healthVerdict: string;
  likeShareRatio: number | null;
  engagementDepth: {
    shallowRate: number | null;
    deepRate: number | null;
    likeShareRatio: number | null;
    verdict: string;
    topSharers: Array<{ video_id: string; share_rate: number }>;
  };
  weekly: VidrevWeekStat[];
  softWarnings: string[];
  limitedDimensions: string[];
}

// ---------------------------------------------------------------------------
// 解析：把用户粘贴的数据变成 rows（缺字段一律 null，不补 0）
// ---------------------------------------------------------------------------

const FIELD_ALIASES: Record<keyof VidrevRawRow, string[]> = {
  video_id: ["videoid", "序号", "编号", "视频id", "视频编号", "id"],
  title: ["标题", "视频标题", "作品", "视频", "title"],
  duration_sec: ["时长", "时长秒", "时长s", "视频时长", "秒数", "duration", "durationsec"],
  published_at: ["发布时间", "发布日期", "日期", "发布", "publishedat"],
  plays: ["播放量", "播放", "播放数", "曝光", "曝光量", "plays"],
  likes: ["点赞量", "点赞", "赞", "likes"],
  comments: ["评论量", "评论数", "评论", "评", "comments"],
  shares: ["分享量", "分享数", "分享", "转发", "shares"],
  saves: ["收藏量", "收藏数", "收藏", "saves"],
  completion_rate: ["完播率", "completionrate", "完播"],
  completion_5s: ["5秒完播率", "5s完播率", "五秒完播率", "5秒完播", "completion5s"],
  conversions: ["咨询量", "咨询数", "咨询", "转化数", "转化", "留资量", "留资", "线索", "conversions"],
  is_paid: ["是否投流", "投流标记", "付费标记", "isp Paid", "ispaid", "投流", "付费"],
  ad_spend: ["投流金额", "投流花费", "投流消耗", "消耗", "adspend"],
  content_type: ["内容类型", "内容形式", "类型", "contenttype"]
};

function normalizeKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s_\-（）()：:/月日]/g, "")
    .trim();
}

function buildAliasIndex(): Map<string, keyof VidrevRawRow> {
  const index = new Map<string, keyof VidrevRawRow>();
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as Array<[keyof VidrevRawRow, string[]]>) {
    index.set(normalizeKey(field), field);
    for (const alias of aliases) index.set(normalizeKey(alias), field);
  }
  return index;
}

const ALIAS_INDEX = buildAliasIndex();

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (text.length === 0 || /^(—|-|–|null|无|暂无|待补充|数据缺失)$/i.test(text)) return null;
  const cleaned = text.replace(/[¥￥,%\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return text.includes("%") ? parsed / 100 : parsed;
}

/** 比率：0.31 / 31% / 31 都归一化成 0.31；缺失返回 null（禁止按 0 处理）。 */
export function toRate(value: unknown): number | null {
  const parsed = toNumber(value);
  if (parsed === null) return null;
  if (typeof value === "string" && value.includes("%")) return parsed;
  return parsed > 1 ? parsed / 100 : parsed;
}

/** 时长：68 / "68s" / "1'08\"" / "01:08" 都归一化成秒。 */
export function toDurationSec(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (text.length === 0) return null;
  const clock = /^(\d{1,2}):(\d{1,2})$/.exec(text);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const quote = /^(\d{1,2})['′](\d{1,2})["″]?$/.exec(text);
  if (quote) return Number(quote[1]) * 60 + Number(quote[2]);
  const parsed = toNumber(text.replace(/[s秒]/gi, ""));
  return parsed === null ? null : Math.round(parsed);
}

export function toBooleanFlag(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  const text = String(value).trim();
  if (text.length === 0 || /^(—|-|–|null|未知|未区分|待补充)$/i.test(text)) return null;
  if (/^(是|有|true|yes|y|1|已投流|投流)$/i.test(text)) return true;
  if (/^(否|无|false|no|n|0|未投流|没投流|自然流)$/i.test(text)) return false;
  return null;
}

function splitTableLine(line: string, delimiter: string): string[] {
  if (delimiter === "|") {
    return line
      .replace(/^\s*\|/, "")
      .replace(/\|\s*$/, "")
      .split("|")
      .map((cell) => cell.trim());
  }
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function detectDelimiter(line: string): string | null {
  if (line.includes("|")) return "|";
  if (line.includes("\t")) return "\t";
  if ((line.match(/,|，/g)?.length ?? 0) >= 3) return line.includes("，") && !line.includes(",") ? "，" : ",";
  return null;
}

function isSeparatorLine(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-");
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
}

function rowFromCells(cells: string[], header: Array<keyof VidrevRawRow>): VidrevRawRow {
  const row: VidrevRawRow = {};
  header.forEach((field, index) => {
    const raw = cells[index];
    if (raw === undefined) return;
    switch (field) {
      case "duration_sec":
        row.duration_sec = toDurationSec(raw);
        break;
      case "plays":
      case "likes":
      case "comments":
      case "shares":
      case "saves":
      case "conversions":
      case "ad_spend":
        row[field] = toNumber(raw);
        break;
      case "completion_rate":
      case "completion_5s":
        row[field] = toRate(raw);
        break;
      case "is_paid":
        row.is_paid = toBooleanFlag(raw);
        break;
      default: {
        const text = raw.trim();
        row[field] = text.length === 0 ? null : text;
      }
    }
  });
  return row;
}

function hasAnyValue(row: VidrevRawRow): boolean {
  return Object.values(row).some((value) => value !== null && value !== undefined && value !== "");
}

/** 口语化单行数据：播放 4,100 ｜ 赞 110 ｜ 评 5 ｜ 分享 2 ｜ 完播 31% */
function parseInlineRow(text: string): VidrevRawRow | null {
  const row: VidrevRawRow = {};
  const patterns: Array<[keyof VidrevRawRow, RegExp]> = [
    ["plays", /(?:播放量|播放|曝光量|曝光)\s*[:：]?\s*(\d[\d,.]*%?)/],
    ["likes", /(?:点赞量|点赞|赞)\s*[:：]?\s*(\d[\d,.]*%?)/],
    ["comments", /(?:评论量|评论数|评论|评)\s*[:：]?\s*(\d[\d,.]*%?)/],
    ["shares", /(?:分享量|分享数|分享|转发)\s*[:：]?\s*(\d[\d,.]*%?)/],
    ["saves", /(?:收藏量|收藏数|收藏)\s*[:：]?\s*(\d[\d,.]*%?)/],
    ["completion_rate", /(?:完播率)\s*[:：]?\s*(\d[\d,.]*%?)/],
    ["completion_5s", /(?:5\s*秒完播率|5\s*s完播率)\s*[:：]?\s*(\d[\d,.]*%?)/],
    ["conversions", /(?:咨询量|咨询数|咨询|转化数|留资量|留资)\s*[:：]?\s*(\d[\d,.]*%?)/]
  ];
  let matched = 0;
  for (const [field, pattern] of patterns) {
    const hit = pattern.exec(text);
    if (!hit) continue;
    matched += 1;
    const value = field === "completion_rate" || field === "completion_5s" ? toRate(hit[1]) : toNumber(hit[1]);
    (row as Record<string, number | null>)[field as string] = value;
  }
  if (matched < 2) return null;
  return row;
}

export function parseVidrevRowsFromText(text: string): { rows: VidrevRawRow[]; notes: string[] } {
  const lines = splitLines(text ?? "");
  if (lines.length === 0) return { rows: [], notes: ["输入为空，未解析到数据行。"] };

  for (let start = 0; start < lines.length; start += 1) {
    const delimiter = detectDelimiter(lines[start]);
    if (!delimiter) continue;
    const cells = splitTableLine(lines[start], delimiter);
    if (cells.length < 3) continue;
    const header = cells.map((cell) => ALIAS_INDEX.get(normalizeKey(cell)) ?? null);
    const matched = header.filter((field) => field !== null).length;
    if (matched < 3) continue;

    const rows: VidrevRawRow[] = [];
    for (let i = start + 1; i < lines.length; i += 1) {
      if (isSeparatorLine(lines[i])) continue;
      const lineDelimiter = detectDelimiter(lines[i]);
      if (lineDelimiter !== delimiter) break;
      const cellsRow = splitTableLine(lines[i], delimiter);
      const row = rowFromCells(cellsRow, header as Array<keyof VidrevRawRow>);
      if (hasAnyValue(row)) rows.push(row);
    }
    if (rows.length > 0) {
      return { rows, notes: [`已按表头解析 ${rows.length} 条数据行（缺失字段保持为空，未补 0）。`] };
    }
  }

  const inline = parseInlineRow(lines.join(" ｜ "));
  if (inline) {
    return { rows: [inline], notes: ["已按口语化单条数据解析 1 条记录。"] };
  }

  return {
    rows: [],
    notes: ["未在输入中识别到可复算的数据行（需要表头含标题 / 播放 / 互动等字段，或直接写「播放 xx 赞 xx 评 xx 分享 xx 完播 x%」）。"]
  };
}

// ---------------------------------------------------------------------------
// 重算：加权比率、中位数基线、四象限、自适应分桶、健康度、赞分享比
// ---------------------------------------------------------------------------

function asCount(value: unknown): number {
  const parsed = toNumber(value);
  return parsed === null || parsed < 0 ? 0 : parsed;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function videoFamily(contentType: string): string {
  const text = (contentType ?? "").trim();
  if (/案例拆解|爆款/.test(text)) return "爆款型";
  if (/人设|创业故事|故事型/.test(text)) return "人设型";
  if (/干货|教学|专业/.test(text)) return "专业型";
  if (/入企|证据|实证/.test(text)) return "证据型";
  if (/招商|引流|变现|转化/.test(text)) return "变现型";
  if (/知识分享|填充/.test(text)) return "填充型";
  if (text.length === 0 || /杂项|无标签/.test(text)) return "无标签";
  return "其他";
}

function healthVerdictOf(score: number): string {
  if (score > 0.5) return "🟢";
  if (score >= 0.3) return "🟡";
  return "🔴";
}

function coverageStatus(coverage: number): string {
  if (coverage >= 0.95) return "🟢";
  if (coverage >= 0.7) return "🟡";
  return "🔴";
}

const DEFAULT_BUCKETS: Array<{ label: string; min: number; max: number; to?: number }> = [
  { label: "<30s", min: Number.NEGATIVE_INFINITY, max: 30 },
  { label: "30-45s", min: 30, max: 45 },
  { label: "45-60s", min: 45, max: 60 },
  { label: ">60s", min: 60, max: Number.POSITIVE_INFINITY }
];

/** 自适应时长分桶：默认 <30s / 30-45s / 45-60s / >60s；空桶合并，仍为空则注明无法评估。 */
export function buildDurationBuckets(videos: VidrevVideo[]): VidrevBucket[] {
  const durations = videos.map((video) => video.durationSec).filter((value): value is number => value !== null);
  if (durations.length === 0) {
    return [{ bucket: "<30s / 30-45s / 45-60s / >60s", count: videos.length, avgPlays: null, medianPlays: null, completionRate: null, note: "本周期无时长数据，无法评估" }];
  }
  let groups = DEFAULT_BUCKETS.map((bucket) => ({ ...bucket, members: [] as VidrevVideo[] }));
  const bucketOf = (duration: number): number => {
    if (duration < 30) return 0;
    if (duration < 45) return 1;
    if (duration < 60) return 2;
    return 3;
  };
  for (const video of videos) {
    groups[bucketOf(video.durationSec ?? 0)].members.push(video);
  }

  while (groups.length > 3) {
    const emptyIndex = groups.findIndex((group) => group.members.length === 0);
    if (emptyIndex < 0) break;
    const target = emptyIndex === 0 ? 1 : emptyIndex === groups.length - 1 ? emptyIndex - 1 : emptyIndex + 1;
    const low = Math.min(emptyIndex, target);
    const high = Math.max(emptyIndex, target);
    const merged = {
      label: `${labelOf(groups[low])}-${labelOf(groups[high])}`,
      min: groups[low].min,
      max: groups[high].max,
      members: [...groups[low].members, ...groups[high].members]
    };
    groups = [...groups.slice(0, low), merged as (typeof groups)[number], ...groups.slice(high + 1)];
  }

  return groups.map((group) => {
    const playsList = group.members.map((video) => video.plays);
    const rates = group.members.map((video) => video.completionRate).filter((value): value is number => value !== null);
    const playedSum = group.members.reduce((sum, video) => sum + video.plays, 0);
    const playWeighted = group.members.reduce((sum, video) => sum + (video.completionRate ?? 0) * video.plays, 0);
    return {
      bucket: group.label,
      count: group.members.length,
      avgPlays: playsList.length > 0 ? Math.round(playsList.reduce((a, b) => a + b, 0) / playsList.length) : null,
      medianPlays: playsList.length > 0 ? median(playsList) : null,
      completionRate: rates.length === 0 ? null : playedSum > 0 && rates.length === group.members.length ? playWeighted / playedSum : rates.reduce((a, b) => a + b, 0) / rates.length,
      ...(group.members.length === 0 ? { note: "该桶本周期无内容，无法评估" } : {})
    };
  });
}

function labelOf(group: { label: string; min: number; max: number }): string {
  const low = group.min === Number.NEGATIVE_INFINITY ? "" : `${group.min}`;
  const high = group.max === Number.POSITIVE_INFINITY ? "" : `${group.max}`;
  if (low === "" && high !== "") return `<${high}s`;
  if (low !== "" && high === "") return `>${low}s`;
  return `${low}-${high}s`;
}

function isoWeek(date: Date): { week: number; year: number } {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return { week, year: target.getUTCFullYear() };
}

export function computeVidrevMetrics(rows: VidrevRawRow[]): VidrevMetrics {
  const list = Array.isArray(rows) ? rows : [];
  const videos: VidrevVideo[] = list.map((row, index) => {
    const plays = asCount(row.plays);
    const likes = asCount(row.likes);
    const comments = asCount(row.comments);
    const shares = asCount(row.shares);
    const engagement = likes + comments + shares;
    const contentType = (row.content_type ?? "").trim();
    return {
      id: (row.video_id ?? "").toString().trim() || `v${index + 1}`,
      index: index + 1,
      title: (row.title ?? "").toString().trim() || `视频 ${index + 1}`,
      durationSec: toDurationSec(row.duration_sec ?? null),
      publishedAt: (row.published_at ?? null) ? String(row.published_at).trim() : null,
      plays,
      likes,
      comments,
      shares,
      saves: asCount(row.saves),
      completionRate: toRate(row.completion_rate ?? null),
      completion5s: toRate(row.completion_5s ?? null),
      conversions: asCount(row.conversions),
      paid: toBooleanFlag(row.is_paid ?? null) === true,
      adSpend: toNumber(row.ad_spend ?? null),
      contentType,
      family: videoFamily(contentType),
      engagement,
      engagementRate: plays > 0 ? engagement / plays : null,
      shareRate: plays > 0 ? shares / plays : null,
      playsShare: 0
    };
  });

  const count = videos.length;
  const totalPlays = videos.reduce((sum, video) => sum + video.plays, 0);
  const totalEngagement = videos.reduce((sum, video) => sum + video.engagement, 0);
  const totalConversions = videos.reduce((sum, video) => sum + video.conversions, 0);
  const totalSaves = videos.reduce((sum, video) => sum + video.saves, 0);
  const totalLikes = videos.reduce((sum, video) => sum + video.likes, 0);
  const totalShares = videos.reduce((sum, video) => sum + video.shares, 0);
  const totalDeep = videos.reduce((sum, video) => sum + video.comments + video.shares, 0);
  for (const video of videos) video.playsShare = totalPlays > 0 ? video.plays / totalPlays : 0;

  const paidRows = videos.filter((video) => video.paid);
  const paidKnown = list.some((row) => toBooleanFlag(row.is_paid ?? null) !== null);
  const adSpend = videos.reduce((sum, video) => sum + (video.adSpend ?? 0), 0);

  const completionKnown = videos.filter((video) => video.completionRate !== null).length;
  const completion5sKnown = videos.filter((video) => video.completion5s !== null).length;
  const completionWeightedKnown = videos.filter((video) => video.completionRate !== null);
  const completionWeightedPlays = completionWeightedKnown.reduce((sum, video) => sum + video.plays, 0);
  const completionRateWeighted =
    completionWeightedPlays > 0
      ? completionWeightedKnown.reduce((sum, video) => sum + (video.completionRate ?? 0) * video.plays, 0) / completionWeightedPlays
      : completionKnown > 0
        ? completionWeightedKnown.reduce((sum, video) => sum + (video.completionRate ?? 0), 0) / completionKnown
        : null;

  const medianPlays = median(videos.map((video) => video.plays));
  const medianConversions = median(videos.map((video) => video.conversions));
  const medianEngagementRate = median(
    videos.map((video) => video.engagementRate).filter((value): value is number => value !== null)
  );

  const highPlays = (plays: number): boolean => (medianPlays > 0 ? plays >= 1.5 * medianPlays : plays > 0);
  const lowPlays = (plays: number): boolean => plays < 0.6 * medianPlays;
  const highConv = (conversions: number): boolean => (medianConversions > 0 ? conversions >= 1.5 * medianConversions : conversions > 0);
  const lowConv = (conversions: number): boolean => conversions < 0.6 * medianConversions;

  const quadrant: VidrevQuadrant = { both: [], plays_no_conv: [], conv_no_plays: [], neither: [], notes: [] };
  let middleBand = 0;
  for (const video of videos) {
    const isHighPlays = highPlays(video.plays);
    const isHighConv = highConv(video.conversions);
    if (isHighPlays && isHighConv) {
      quadrant.both.push(video.id);
    } else if (isHighPlays && !isHighConv) {
      quadrant.plays_no_conv.push(video.id);
    } else if (!isHighPlays && isHighConv) {
      quadrant.conv_no_plays.push(video.id);
    } else if (lowPlays(video.plays) && lowConv(video.conversions)) {
      quadrant.neither.push(video.id);
    } else {
      middleBand += 1;
      if (video.plays >= medianPlays) quadrant.plays_no_conv.push(video.id);
      else quadrant.neither.push(video.id);
    }
  }
  if (middleBand > 0) quadrant.notes.push("中间带按播放基线二分");

  const buckets = buildDurationBuckets(videos);

  const typeMap = new Map<string, VidrevVideo[]>();
  for (const video of videos) {
    const key = video.contentType.length > 0 ? video.contentType : "无标签";
    typeMap.set(key, [...(typeMap.get(key) ?? []), video]);
  }
  const byType: VidrevTypeStat[] = [...typeMap.entries()].map(([type, members]) => {
    const playsSum = members.reduce((sum, video) => sum + video.plays, 0);
    const engagementSum = members.reduce((sum, video) => sum + video.engagement, 0);
    const rates = members.map((video) => video.completionRate).filter((value): value is number => value !== null);
    const ratesWeighted = rates.length === members.length && playsSum > 0
      ? members.reduce((sum, video) => sum + (video.completionRate ?? 0) * video.plays, 0) / playsSum
      : rates.length > 0
        ? rates.reduce((a, b) => a + b, 0) / rates.length
        : null;
    return {
      type,
      family: videoFamily(type),
      count: members.length,
      share: count > 0 ? members.length / count : 0,
      avgPlays: members.length > 0 ? playsSum / members.length : null,
      engagementRate: playsSum > 0 ? engagementSum / playsSum : null,
      completionRate: ratesWeighted
    };
  }).sort((a, b) => b.count - a.count);

  const healthScore = count > 0
    ? videos.filter((video) => video.family === "爆款型" || video.family === "人设型").length / count
    : 0;

  const likeShareRatio = totalShares > 0 ? totalLikes / totalShares : null;
  const likeShareVerdict =
    likeShareRatio === null ? "—" : likeShareRatio < 2 ? "🟢" : likeShareRatio <= 4 ? "🟡" : "🔴";
  const topSharers = [...videos]
    .filter((video) => video.shareRate !== null)
    .sort((a, b) => (b.shareRate ?? 0) - (a.shareRate ?? 0))
    .slice(0, 3)
    .map((video) => ({ video_id: video.id, share_rate: video.shareRate ?? 0 }));

  const weeklyMap = new Map<string, VidrevVideo[]>();
  const weeklyOrder: string[] = [];
  for (const video of videos) {
    const published = video.publishedAt ? new Date(video.publishedAt) : null;
    const valid = published && !Number.isNaN(published.getTime());
    const key = valid ? `W${isoWeek(published as Date).week}` : "本周期";
    if (!weeklyMap.has(key)) weeklyOrder.push(key);
    weeklyMap.set(key, [...(weeklyMap.get(key) ?? []), video]);
  }
  const weekly: VidrevWeekStat[] = weeklyOrder.map((week) => {
    const members = weeklyMap.get(week) ?? [];
    const playsSum = members.reduce((sum, video) => sum + video.plays, 0);
    return {
      week,
      range: week,
      count: members.length,
      avgPlays: members.length > 0 ? Math.round(playsSum / members.length) : 0,
      medianPlays: median(members.map((video) => video.plays))
    };
  });

  const softWarnings: string[] = [];
  if (count > 0 && count < 5) softWarnings.push("样本偏少：本周期有效数据不足 5 条，结论强度自动下调一档。");
  const maxPlaysShare = count > 0 ? Math.max(...videos.map((video) => video.playsShare)) : 0;
  if (maxPlaysShare > 0.5) softWarnings.push("单条播放占总量超过 50%，均值被极值污染，请以中位数为准。");
  if (paidRows.length === 0) softWarnings.push("投流条数 = 0：本周期无付费数据，投流相关建议基于自然流推断。");

  const limitedDimensions: string[] = [];
  if (completionKnown < count) {
    const missing = videos.filter((video) => video.completionRate === null).map((video) => video.id).join(" / ");
    limitedDimensions.push(`完播率缺 ${count - completionKnown} 条（${missing}）——该条不做完播归因`);
  }
  if (completion5sKnown < count) {
    const missing = videos.filter((video) => video.completion5s === null).map((video) => video.id).join(" / ");
    limitedDimensions.push(`5秒完播率缺 ${count - completion5sKnown} 条（${missing}）——这 ${count - completion5sKnown} 条不做钩子强度归因，结论强度下调一档`);
  }

  return {
    count,
    videos,
    totalPlays,
    totalEngagement,
    totalConversions,
    totalSaves,
    adSpend,
    paidCount: paidRows.length,
    engagementRate: totalPlays > 0 ? totalEngagement / totalPlays : null,
    completionRateWeighted,
    completionCoverage: count > 0 ? completionKnown / count : 0,
    completion5sCoverage: count > 0 ? completion5sKnown / count : 0,
    completionStatus: coverageStatus(count > 0 ? completionKnown / count : 0),
    completion5sStatus: coverageStatus(count > 0 ? completion5sKnown / count : 0),
    paidFlagStatus: paidKnown ? `已区分（${paidRows.length} 条，合计 ¥${adSpend.toLocaleString("en-US")}）` : "未区分（无投流标记字段）",
    commentStatus: videos.some((video) => video.comments > 0) ? "正常" : "无评论数据",
    publishTimePrecision: videos.every((video) => video.publishedAt !== null) ? "有" : "部分缺失",
    medianPlays,
    medianConversions,
    medianEngagementRate: videos.some((video) => video.engagementRate !== null) ? medianEngagementRate : null,
    baseline: {
      median_plays: medianPlays,
      warn_line: Math.round(0.6 * medianPlays),
      good_line: Math.round(1.5 * medianPlays),
      median_engagement: videos.some((video) => video.engagementRate !== null) ? medianEngagementRate : null
    },
    quadrant,
    buckets,
    byType,
    healthScore,
    healthVerdict: healthVerdictOf(healthScore),
    likeShareRatio,
    engagementDepth: {
      shallowRate: totalPlays > 0 ? totalLikes / totalPlays : null,
      deepRate: totalPlays > 0 ? totalDeep / totalPlays : null,
      likeShareRatio,
      verdict: likeShareVerdict,
      topSharers
    },
    weekly,
    softWarnings,
    limitedDimensions
  };
}

// ---------------------------------------------------------------------------
// 报告结构解析
// ---------------------------------------------------------------------------

const CHAPTER_LABELS: Array<[string, string, string]> = [
  ["零", "data_quality", "数据质量审计"],
  ["一", "overview", "数据总览"],
  ["二", "quadrant", "视频分层"],
  ["三", "content_health", "内容结构健康度"],
  ["四", "deep_dive", "单条深拆"],
  ["五", "completion_attrib", "完播率深层归因"],
  ["六", "engagement_depth", "互动深度分析"],
  ["七", "trend_alert", "趋势预警"],
  ["八", "patterns", "规律总结"],
  ["九", "methodology", "方法论沉淀"],
  ["十", "next_topics", "选题建议"]
];

const CHAPTER_NUMERALS = CHAPTER_LABELS.map(([numeral]) => numeral);

interface ChapterSplit {
  sections: Record<string, string>;
  present: Set<string>;
  title: string;
  headingCount: number;
}

function splitVidrevChapters(markdown: string): ChapterSplit {
  const lines = markdown.split(/\r?\n/);
  const sections: Record<string, string> = {};
  const present = new Set<string>();
  let title = "";
  let headingCount = 0;
  let current: string | null = null;
  const buffers: Record<string, string[]> = {};

  for (const line of lines) {
    const heading = /^\s*(#{1,6})\s*(.+?)\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].replace(/^[*_]{1,2}\s*/, "").replace(/[*_]{1,2}$/, "");
      const match = new RegExp(`^(${CHAPTER_NUMERALS.join("|")})\\s*[、.．]`).exec(text);
      if (match) {
        headingCount += 1;
        const key = CHAPTER_LABELS.find(([numeral]) => numeral === match[1])?.[1];
        if (key) {
          present.add(key);
          current = key;
          buffers[key] = buffers[key] ?? [];
          buffers[key].push(text);
          continue;
        }
      }
      if (level === 1 && title.length === 0) {
        title = text;
        current = null;
        continue;
      }
      if (current) {
        buffers[current].push(line);
        continue;
      }
      continue;
    }
    if (current) buffers[current].push(line);
  }

  for (const [key, buffer] of Object.entries(buffers)) {
    sections[key] = buffer.join("\n");
  }
  return { sections, present, title, headingCount };
}

function sectionOf(split: ChapterSplit, key: string): string {
  return split.sections[key] ?? "";
}

function tableRows(section: string): string[][] {
  const rows: string[][] = [];
  for (const line of section.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    if (isSeparatorLine(trimmed)) continue;
    const cells = splitTableLine(trimmed, "|");
    if (cells.length === 0) continue;
    rows.push(cells);
  }
  return rows;
}

function findTableRowValue(section: string, keyPattern: RegExp): string | null {
  for (const cells of tableRows(section)) {
    if (keyPattern.test(cells[0] ?? "")) return (cells[1] ?? "").trim();
  }
  return null;
}

function numberedItems(text: string): string[] {
  const items: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(\d+)[.、)]\s*(.+?)\s*$/.exec(line);
    if (match) items.push(match[2]);
  }
  return items;
}

function bulletItems(text: string): string[] {
  const items: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:[-*•]|\d+[.、)])\s*(.+?)\s*$/.exec(line);
    if (match) items.push(match[1]);
  }
  return items;
}

// 方法论（第九章）字段名，用于把模型的行内串联写法拆回逐字段行。
const METHOD_FIELD_LABELS = ["类型", "规律", "证据", "置信度", "相关选题", "选题"];
const METHOD_ENTRY_HEAD = /^(?:第?\s*\d+\s*[.、)）．]?\s*)?类型\s*[:：]/;

/**
 * 解析第九章「方法论沉淀」条目。
 *
 * 真实模型在同一份契约下会写出多种等价排版（本仓库实测到的漂移）：
 * - 编号多行：`1. 类型：…` 换行后再写 `规律：…/证据：…/置信度：…/相关选题：…`；
 * - 行内串联：`类型：… / 规律：… / 证据：… / 置信度：… / 相关选题：…`（system prompt 字面就是这种写法）；
 * - 加粗字段名（`**类型**：…`）、项目符号（`- 类型：…`）、或整章用表格列出。
 *
 * 这些写法的字段是齐的，不能因为排版漂移就判「条目不足」（会造成一次合格交付被 422 拒绝）。
 * 这里先归一化（去加粗、把行内「/」拆成多行），再按「类型：」行首切条目；整章表格时按表头列映射兜底。
 */
function parseMethodologyBlocks(section: string): string[] {
  if (section.trim().length === 0) return [];
  const inlineSplit = new RegExp(
    `(?<=[/｜|])\\s*(?=(?:${METHOD_FIELD_LABELS.join("|")})\\s*[:：])`,
    "g"
  );
  const normalizedLines: string[] = [];
  for (const raw of section.split(/\r?\n/)) {
    const normalized = raw.replace(/\*\*/g, "").replace(/[／]/g, "/").replace(inlineSplit, "\n");
    for (const piece of normalized.split("\n")) normalizedLines.push(piece);
  }

  const blocks: string[] = [];
  let current: string[] | null = null;
  for (const line of normalizedLines) {
    const stripped = line.replace(/^\s*(?:[-*+•]|#{1,6})\s*/, "").trim();
    if (METHOD_ENTRY_HEAD.test(stripped)) {
      if (current) blocks.push(current.join("\n"));
      current = [stripped];
      continue;
    }
    if (current) current.push(line);
  }
  if (current) blocks.push(current.join("\n"));
  if (blocks.length > 0) return blocks;

  // 表格兜底：表头同时含「类型」「证据」时，按列名映射成标准条目。
  const rows = tableRows(section);
  const headerIndex = rows.findIndex(
    (cells) => cells.some((cell) => /类型/.test(cell)) && cells.some((cell) => /证据/.test(cell))
  );
  if (headerIndex < 0) return [];
  const header = rows[headerIndex].map((cell) => cell.replace(/\s/g, ""));
  const columnOf = (label: RegExp): number => header.findIndex((cell) => label.test(cell));
  const typeAt = columnOf(/类型/);
  const ruleAt = columnOf(/规律/);
  const evidenceAt = columnOf(/证据/);
  const confidenceAt = columnOf(/置信度/);
  const hintAt = columnOf(/相关选题|选题/);
  for (const row of rows.slice(headerIndex + 1)) {
    if (row.every((cell) => /^[-:\s|]*$/.test(cell))) continue;
    const pick = (index: number): string => (index >= 0 ? (row[index] ?? "").trim() : "");
    if (pick(typeAt).length === 0 && pick(evidenceAt).length === 0) continue;
    blocks.push(
      [
        `类型：${pick(typeAt)}`,
        `规律：${pick(ruleAt)}`,
        `证据：${pick(evidenceAt)}`,
        `置信度：${pick(confidenceAt)}`,
        `相关选题：${pick(hintAt)}`
      ].join("\n")
    );
  }
  return blocks;
}

function percent(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = /(-?\d+(?:\.\d+)?)\s*%/.exec(text);
  if (!match) return null;
  return Number(match[1]) / 100;
}

interface QuadrantTable {
  mapping: Map<string, string>;
  total: number;
  problems: string[];
}

function parseQuadrantTable(section: string): QuadrantTable {
  const mapping = new Map<string, string>();
  const problems: string[] = [];
  let total = 0;
  const labelToKey: Record<string, string> = {
    又爆又赚: "both",
    有量无转: "plays_no_conv",
    有转无量: "conv_no_plays",
    没量没转: "neither"
  };
  for (const cells of tableRows(section)) {
    const label = (cells[0] ?? "").trim();
    const key = labelToKey[label];
    if (!key) continue;
    const id = (cells[1] ?? "").trim().replace(/^#/, "");
    if (id.length === 0) continue;
    total += 1;
    if (mapping.has(id)) {
      problems.push(`视频 ${id} 被归入多个象限（${mapping.get(id)} / ${key}）`);
      continue;
    }
    mapping.set(id, key);
  }
  return { mapping, total, problems };
}

interface DeepDiveItem {
  id: string;
  reasons: string[];
  reusable: string[];
  improve: string[];
}

function parseDeepDive(section: string): DeepDiveItem[] {
  const items: DeepDiveItem[] = [];
  const lines = section.split(/\r?\n/);
  let current: { id: string; body: string[] } | null = null;
  for (const line of lines) {
    // 深拆条目固定为「N. <id>「标题」｜象限」整行格式；理由行的编号行（如「1. 展示的是「…」，不是…」）
    // 在闭合引号后仍有正文，必须排除，否则会把理由误判成新视频。
    const header = /^\s*\d+[.、)]\s*#?([^\s「」，。：:、｜|]{1,24})\s*「[^」]{1,80}」\s*(?:[｜|].*)?$/.exec(line);
    if (header) {
      if (current) items.push(finishDeepDiveItem(current));
      current = { id: header[1], body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  if (current) items.push(finishDeepDiveItem(current));
  return items;
}

function finishDeepDiveItem(raw: { id: string; body: string[] }): DeepDiveItem {
  const body = raw.body.join("\n");
  const reasons: string[] = [];
  const reusable: string[] = [];
  const improve: string[] = [];
  let inReasonBlock = false;
  for (const line of raw.body) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (/为什么/.test(trimmed)) {
      inReasonBlock = true;
      continue;
    }
    const numbered = /^\s*\d+[.、)]\s*(.+?)\s*$/.exec(line);
    if (numbered && inReasonBlock) {
      reasons.push(numbered[1]);
      continue;
    }
    const reusableHit = /^\s*(?:[-*•]\s*)?(?:可复用|复用点|可复制)[:：]?\s*(.+)$/.exec(trimmed);
    if (reusableHit) {
      inReasonBlock = false;
      reusable.push(reusableHit[1]);
      continue;
    }
    const improveHit = /^\s*(?:[-*•]\s*)?(?:改进|优化点|下一步)[:：]?\s*(.+)$/.exec(trimmed);
    if (improveHit) {
      inReasonBlock = false;
      improve.push(improveHit[1]);
      continue;
    }
  }
  if (reusable.length === 0 && /可复用|复用/.test(body)) reusable.push("（见正文）");
  if (improve.length === 0 && /改进/.test(body)) improve.push("（见正文）");
  return { id: raw.id, reasons, reusable, improve };
}

// ---------------------------------------------------------------------------
// payload
// ---------------------------------------------------------------------------

export interface VidrevQuickPayload {
  kind: "vidrev";
  mode: "quick";
  quick: { points: string[]; next_action: string; note: string };
  report_markdown: string;
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
    distribution: Array<{ type: string; count: number; share: number; avg_plays: number | null; engagement_rate: number | null; completion_rate: number | null; verdict: string }>;
    health_score: number;
    verdict: string;
    adjust: { add: string[]; cut: string[]; change: string[] };
  };
  deep_dive: Array<{ video_id: string; title: string; metrics: Record<string, number | string | null>; reasons: string[]; reusable: string[]; improve: string[] }>;
  /**
   * 逐条视频明细（来自确定性重算，不是模型输出）。
   * 前端用它做四象限筛选、明细表与 CSV 导出，避免只能拿到 TOP/BOTTOM 深拆条目。
   */
  videos: Array<{
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
  }>;
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
    weekly: VidrevWeekStat[];
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

export type VidrevPayload = VidrevQuickPayload | VidrevDeepPayload;

// ---------------------------------------------------------------------------
// 校验：V1–V12 + 违禁词（只在第十章候选选题扫描）
// ---------------------------------------------------------------------------

const BANNED_WORDS = ["私信", "电话", "找我", "留个", "加我", "扫码领"];
const CONFIDENCE_VALUES = ["疑似规律", "已确认", "黄金法则"];
const PATTERN_DIMENSIONS: Array<[keyof VidrevDeepPayload["patterns"], string]> = [
  ["hook", "钩子"],
  ["topic", "选题"],
  ["format", "形式"],
  ["timing", "时间"],
  ["conversion", "转化"]
];
const NEXT_TOPIC_DIRECTIONS = ["主力复制", "优化重拍", "投流放量", "放弃方向"];

export interface VidrevValidationInput {
  markdown: string;
  metrics: VidrevMetrics | null;
  mode: "quick" | "deep";
  hasRevenueData: boolean;
}

export interface VidrevValidationResult {
  failures: string[];
  warnings: string[];
  payload: VidrevPayload | null;
}

function validateQuick(markdown: string): { failures: string[]; warnings: string[]; payload: VidrevQuickPayload } {
  const failures: string[] = [];
  const warnings: string[] = [];
  if (!/快速诊断/.test(markdown)) failures.push("Q1 缺少「快速诊断」标题，用户无法判断这是精简版还是完整报告。");
  const actionMatch = /^\s*(?:\*\*)?立即动作(?:\*\*)?[:：]\s*(.+)$/m.exec(markdown);
  if (!actionMatch) failures.push("Q1 快速诊断必须给出恰好 1 条「立即动作」。");
  const pointsBlock = /三个要点[\s\S]*?(?=\n\s*(?:立即动作|\*\*立即动作)|$)/.exec(markdown)?.[0] ?? "";
  const points = numberedItems(pointsBlock).length > 0 ? numberedItems(pointsBlock) : bulletItems(pointsBlock);
  if (points.length < 3) failures.push(`Q2 快速诊断要点必须 3–5 条，实际 ${points.length} 条。`);
  if (points.length > 5) warnings.push("快速诊断要点超过 5 条，建议压缩到 3–5 条。");
  if (!/判定[:：]/.test(markdown)) failures.push("Q3 快速诊断必须给出「判定」结论（象限或基线对比）。");
  const noteMatch = /⚠️[^\n]*/.exec(markdown)?.[0] ?? "";
  if (!noteMatch) failures.push("Q4 快速诊断必须带「⚠️ 本次为快速诊断…」的边界说明。");
  if (noteMatch && !/不重复扣费|不重复收费|同一任务不重复/.test(noteMatch)) {
    failures.push("Q4 快速诊断边界说明必须写明补齐后台数据升级为完整报告时不重复扣费。");
  }
  return {
    failures,
    warnings,
    payload: {
      kind: "vidrev",
      mode: "quick",
      quick: {
        points,
        next_action: actionMatch?.[1]?.trim() ?? "",
        note: noteMatch
      },
      report_markdown: markdown
    }
  };
}

export function validateVidrevReport(input: VidrevValidationInput): VidrevValidationResult {
  const markdown = input.markdown ?? "";
  if (input.mode === "quick") {
    const result = validateQuick(markdown);
    return { failures: result.failures, warnings: result.warnings, payload: result.payload };
  }

  const failures: string[] = [];
  const warnings: string[] = [];
  const metrics = input.metrics;
  if (!metrics || metrics.count === 0) {
    return { failures: ["V0 未解析到可复算的数据行：深度复盘必须有结构化数据（rows 或可解析的数据表）。"], warnings, payload: null };
  }
  const split = splitVidrevChapters(markdown);
  const audit = sectionOf(split, "data_quality");
  const overview = sectionOf(split, "overview");
  const quadrantSection = sectionOf(split, "quadrant");
  const health = sectionOf(split, "content_health");
  const deepDive = sectionOf(split, "deep_dive");
  const completion = sectionOf(split, "completion_attrib");
  const engagement = sectionOf(split, "engagement_depth");
  const trend = sectionOf(split, "trend_alert");
  const patterns = sectionOf(split, "patterns");
  const methodologySection = sectionOf(split, "methodology");
  const nextTopics = sectionOf(split, "next_topics");

  // 报告在「零、数据质量审计」里逐条声明的受限维度，作为前端黄底提示条的权威来源
  let declaredLimitedDimensions: string[] = [];
  // V1 数据质量审计：整块缺失，或受限维度未逐条列出
  if (!split.present.has("data_quality")) {
    failures.push("V1 缺少「零、数据质量审计」章节：没有数据质量声明的报告不允许交付。");
  } else {
    const requiredAudit: Array<[RegExp, string]> = [
      [/总记录数/, "总记录数"],
      [/完播率覆盖/, "完播率覆盖"],
      [/评论数据/, "评论数据"],
      [/发布(?:时间|时段)/, "发布时段"],
      [/投流/, "投流标记"]
    ];
    for (const [pattern, label] of requiredAudit) {
      if (!pattern.test(audit)) failures.push(`V1 数据质量审计缺少「${label}」检查项。`);
    }
    const limitedBlock = /受限维度[:：]?([\s\S]*)$/.exec(audit)?.[1] ?? "";
    const limitedItems = numberedItems(limitedBlock).length > 0 ? numberedItems(limitedBlock) : bulletItems(limitedBlock);
    const declaredNone = /受限维度[:：]?\s*(?:无|无受限|没有)/.test(audit);
    declaredLimitedDimensions = limitedItems;
    if (limitedItems.length === 0 && !declaredNone) {
      failures.push("V1 有受限维度但未逐条列出（每一条缺失维度都要单独说明影响与降级口径）。");
    }
  }

  // V2 十章完整性（样本 <3 条时第七章可不输出，但必须显式说明）
  const missingChapters = CHAPTER_LABELS.filter(([, key]) => !split.present.has(key));
  const smallSample = metrics.count < 3;
  for (const [numeral, key, name] of missingChapters) {
    if (key === "trend_alert" && smallSample) {
      if (/样本不足|不输出趋势|趋势.{0,6}(?:不适用|省略)/.test(markdown)) continue;
      failures.push("V2 样本不足 3 条可以不输出第七章，但必须在报告里显式说明「样本不足，不输出趋势预警」。");
      continue;
    }
    failures.push(`V2 缺少「${numeral}、${name}」章节。`);
  }

  // V3 四象限必须与重算一致，条数之和 = 总条数，每条只归一个象限
  const parsedQuadrant = parseQuadrantTable(quadrantSection);
  if (parsedQuadrant.problems.length > 0) {
    failures.push(`V3 ${parsedQuadrant.problems.join("；")}`);
  }
  const expectedQuadrant = metrics.quadrant;
  const expectedByKey: Record<string, string[]> = {
    both: expectedQuadrant.both,
    plays_no_conv: expectedQuadrant.plays_no_conv,
    conv_no_plays: expectedQuadrant.conv_no_plays,
    neither: expectedQuadrant.neither
  };
  const expectedFlat = Object.values(expectedByKey).flat();
  if (parsedQuadrant.mapping.size !== expectedFlat.length) {
    failures.push(`V3 四象限条数之和 ${parsedQuadrant.mapping.size} ≠ 总条数 ${metrics.count}（应等于总条数，且每条只归一个象限）。`);
  } else {
    for (const [key, ids] of Object.entries(expectedByKey)) {
      const reported = [...parsedQuadrant.mapping.entries()].filter(([, value]) => value === key).map(([id]) => id);
      const expectedSorted = [...ids].sort().join(",");
      const reportedSorted = reported.sort().join(",");
      if (expectedSorted !== reportedSorted) {
        failures.push(`V3 象限「${key}」与重算结果不一致：报告 ${reportedSorted || "（空）"}，重算 ${expectedSorted || "（空）"}。`);
      }
    }
  }

  // V4 深拆条数：总条数 ≥6 时 TOP3+BOTTOM3；<6 时至少 TOP1+BOTTOM1
  const deepItems = parseDeepDive(deepDive);
  const expectedDeep = metrics.count >= 6 ? 6 : Math.min(metrics.count, 2);
  if (deepItems.length < expectedDeep) {
    failures.push(`V4 单条深拆条数不足：总条数 ${metrics.count} 需 ${expectedDeep} 条，实际 ${deepItems.length} 条。`);
  }
  const metricsIds = new Set(metrics.videos.map((video) => video.id));
  for (const item of deepItems) {
    if (!metricsIds.has(item.id)) {
      failures.push(`V4 深拆条目「${item.id}」不在本次数据里，禁止编造视频。`);
    }
  }

  // V5 每条深拆 reasons ≥3、reusable ≥1、improve ≥1
  for (const item of deepItems) {
    if (item.reasons.length < 3) failures.push(`V5 深拆「${item.id}」的 reasons 只有 ${item.reasons.length} 条（需 ≥3）。`);
    if (item.reusable.length < 1) failures.push(`V5 深拆「${item.id}」缺少「可复用」。`);
    if (item.improve.length < 1) failures.push(`V5 深拆「${item.id}」缺少「改进」。`);
  }

  // V6 健康度评分与判定档位一致
  const healthMatch = /健康度评分\s*=\s*[^=]*=\s*(\d+(?:\.\d+)?)\s*%\s*(?:→|->|—|-)?\s*(🔴|🟡|🟢)/.exec(health);
  if (!healthMatch) {
    failures.push("V6 缺少健康度评分（格式：健康度评分 =（…）/ 总数 = X% → 🟢/🟡/🔴）。");
  } else {
    const score = Number(healthMatch[1]) / 100;
    const verdict = healthMatch[2];
    if (Math.abs(score - metrics.healthScore) > 0.01) {
      failures.push(`V6 健康度评分与重算不一致：报告 ${(score * 100).toFixed(1)}%，重算 ${(metrics.healthScore * 100).toFixed(1)}%。`);
    }
    if (verdict !== metrics.healthVerdict) {
      failures.push(`V6 健康度判定档位与分数不一致：报告 ${verdict}，按 >50%🟢 / 30–50%🟡 / <30%🔴 应为 ${metrics.healthVerdict}。`);
    }
  }

  // V7 比率必须加权：用同一份数据重算，误差 > 0.5pp 判失败
  const reportedEngagement = percent(/([0-9.]+\s*%)/.exec(/互动率[^\n]*?([0-9]+(?:\.[0-9]+)?\s*%)/.exec(overview)?.[0] ?? "")?.[1]);
  const engagementText = /互动率\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?\s*%)([^\n]*)?/.exec(overview);
  const reportedRate = engagementText ? Number(engagementText[1].replace("%", "")) / 100 : reportedEngagement;
  if (reportedRate === null || reportedRate === undefined) {
    failures.push("V7 第一章未给出互动率，无法用同一份数据复核加权口径。");
  } else if (metrics.engagementRate !== null && Math.abs(reportedRate - metrics.engagementRate) > 0.005) {
    failures.push(
      `V7 互动率与加权口径重算偏差 ${(Math.abs(reportedRate - metrics.engagementRate) * 100).toFixed(2)}pp（报告 ${(reportedRate * 100).toFixed(2)}%，加权 ${(metrics.engagementRate * 100).toFixed(2)}%），超过 0.5pp 阈值。`
    );
  }
  if (metrics.completionRateWeighted !== null) {
    const reportedCompletion = percent(/(?:总?完播率|整体完播率)[^\n|]*?(\d+(?:\.\d+)?\s*%)/.exec(overview)?.[1] ?? null);
    if (reportedCompletion !== null && Math.abs(reportedCompletion - metrics.completionRateWeighted) > 0.005) {
      failures.push(
        `V7 完播率与加权口径重算偏差超过 0.5pp（报告 ${(reportedCompletion * 100).toFixed(2)}%，加权 ${(metrics.completionRateWeighted * 100).toFixed(2)}%）。`
      );
    }
  }

  // V8 空值不得当 0：无成交金额时 ROI 必须写「数据缺失」
  const roiValue = findTableRowValue(overview, /^ROI/i);
  const roiNumeric = roiValue ? /\d/.test(roiValue) : false;
  if (!input.hasRevenueData) {
    if (roiValue === null) {
      failures.push("V8 第一章缺少 ROI 行；无成交金额字段时必须显式写「数据缺失」而不是省略或填 0。");
    } else if (roiNumeric && !/缺失/.test(roiValue)) {
      failures.push(`V8 无成交金额字段时 ROI 不得填数值（报告「${roiValue}」），必须写「数据缺失」。`);
    } else if (!/缺失|—|-/.test(roiValue)) {
      failures.push("V8 ROI 行必须明确写「数据缺失」并说明缺失原因。");
    }
  }

  // V9 规律总结五维各 ≥1 条，且每条指名支撑视频
  const patternRows = tableRows(patterns);
  const hasPublishTime = metrics.videos.some((video) => video.publishedAt !== null);
  for (const [key, label] of PATTERN_DIMENSIONS) {
    const row = patternRows.find((cells) => (cells[0] ?? "").replace(/\s/g, "") === label);
    if (!row) {
      failures.push(`V9 规律总结缺少「${label}」维度的规律。`);
      continue;
    }
    const support = (row[2] ?? "").trim();
    const supportMissing = support.length === 0 || /^(—|-|–|无|待补充|n\/a)$/i.test(support);
    // 「时间」维度：本次数据完全没有发布时间字段时，只能如实写「数据缺失」，
    // 不能因为没有发布时间就判整份报告失败（与「空值不得当 0」同一口径）。
    if (supportMissing && !(key === "timing" && !hasPublishTime)) {
      failures.push(`V9 规律「${label}」没有指名支撑视频（支撑视频列不能为空或写 —）。`);
    }
  }

  // V10 方法论 ≥2 条，且有证据与置信度
  const methodologyBlocks = parseMethodologyBlocks(methodologySection);
  if (methodologyBlocks.length < 2) {
    failures.push(`V10 方法论沉淀必须 ≥2 条，实际 ${methodologyBlocks.length} 条。`);
  }
  for (const [index, block] of methodologyBlocks.entries()) {
    if (!/证据[:：]\s*\S/.test(block)) failures.push(`V10 方法论第 ${index + 1} 条缺少「证据」。`);
    const confidence = /置信度[:：]\s*([^\n]+)/.exec(block)?.[1]?.trim() ?? "";
    if (confidence.length === 0) {
      failures.push(`V10 方法论第 ${index + 1} 条缺少「置信度」。`);
    } else if (!CONFIDENCE_VALUES.some((value) => confidence.includes(value))) {
      failures.push(`V10 方法论第 ${index + 1} 条置信度「${confidence}」不在 疑似规律 / 已确认 / 黄金法则 之内。`);
    }
  }

  // V11 选题建议四方向齐全 + 候选选题 ≥2 条
  for (const direction of NEXT_TOPIC_DIRECTIONS) {
    if (!nextTopics.includes(direction)) failures.push(`V11 选题建议缺少「${direction}」方向。`);
  }
  const candidateIndex = nextTopics.search(/候选选题/);
  const candidateBlock = candidateIndex >= 0 ? nextTopics.slice(candidateIndex) : "";
  const candidates = bulletItems(candidateBlock).filter((item) => !/候选选题/.test(item));
  if (candidateBlock.length === 0) {
    failures.push("V11 缺少「候选选题」清单（第十章必须直接产出可进选题池的候选选题）。");
  } else if (candidates.length < 2) {
    failures.push(`V11 候选选题必须 ≥2 条，实际 ${candidates.length} 条。`);
  }

  // V12 无数据支撑的结论
  const roiClaim = /ROI[^\n]{0,8}?(\d+(?:\.\d+)?)/.exec(markdown.replace(/数据缺失|无成交|缺失原因/g, ""));
  if (roiClaim && !input.hasRevenueData) {
    failures.push(`V12 无成交金额数据却给出 ROI 数值（「${roiClaim[0].trim()}」）。`);
  }
  if (metrics.paidCount === 0 && /投流(?:效果(?:好|最好|很好)|效率最高|放大效果)|值得加大投流/.test(markdown)) {
    failures.push("V12 本周期没有任何投流数据，却给出投流效果结论。");
  }

  // 违禁词：只扫第十章「候选选题」的标题与评论引导文字
  const bannedHits = BANNED_WORDS.filter((word) => candidateBlock.includes(word));
  if (bannedHits.length > 0) {
    failures.push(`V13 第十章候选选题出现违禁引导词：${bannedHits.join(" / ")}（合规引导请用「看主页 / 评论区 / 关注」）。`);
  }

  // 软校验：不判失败，只提示
  warnings.push(...metrics.softWarnings);
  if (!split.present.has("trend_alert") && !smallSample) {
    warnings.push("报告未包含第七章趋势预警，但样本数量足够，建议补齐。");
  }
  const headingLevels = markdown.split(/\r?\n/).filter((line) => /^#{3,6}\s/.test(line)).length;
  if (headingLevels > 0) warnings.push(`报告出现 ${headingLevels} 处 H3/H4 级标题，排版规范要求章节内不再分小节标题。`);
  const boldCount = (markdown.match(/\*\*/g)?.length ?? 0) / 2;
  if (boldCount > 12) warnings.push(`加粗 ${boldCount} 处，超过 12 处上限。`);

  if (failures.length > 0) {
    return { failures, warnings, payload: null };
  }

  // 通过校验 → 组装 payload（数字全部来自重算）
  const adjustBlock = /调整建议[:：]?([\s\S]*)$/.exec(health)?.[1] ?? "";
  const adjust = {
    add: adjustBlock.split(/\r?\n/).filter((line) => /^\s*[-*•]?\s*增[:：]/.test(line)).map((line) => line.replace(/^\s*[-*•]?\s*增[:：]\s*/, "").trim()),
    cut: adjustBlock.split(/\r?\n/).filter((line) => /^\s*[-*•]?\s*减[:：]/.test(line)).map((line) => line.replace(/^\s*[-*•]?\s*减[:：]\s*/, "").trim()),
    change: adjustBlock.split(/\r?\n/).filter((line) => /^\s*[-*•]?\s*改[:：]/.test(line)).map((line) => line.replace(/^\s*[-*•]?\s*改[:：]\s*/, "").trim())
  };

  const patternValues: VidrevDeepPayload["patterns"] = { hook: "", topic: "", format: "", timing: "", conversion: "" };
  for (const [key, label] of PATTERN_DIMENSIONS) {
    const row = patternRows.find((cells) => (cells[0] ?? "").replace(/\s/g, "") === label);
    if (row) patternValues[key] = `${(row[1] ?? "").trim()}｜支撑：${(row[2] ?? "").trim()}`;
  }

  const methodology = methodologyBlocks.map((block) => {
    const type = /类型[:：]\s*([^\n]+)/.exec(block)?.[1]?.trim() ?? "";
    const rule = /规律[:：]\s*([^\n]+)/.exec(block)?.[1]?.trim() ?? "";
    const evidence = /证据[:：]\s*([^\n]+)/.exec(block)?.[1]?.trim() ?? "";
    const confidence = /置信度[:：]\s*([^\n]+)/.exec(block)?.[1]?.trim() ?? "";
    const topicHint = /(?:相关选题|选题[:：])\s*([^\n]+)/.exec(block)?.[1]?.trim() ?? "";
    return { type, rule, evidence, confidence, topic_hint: topicHint };
  });

  const directionBlock = (label: string, nextLabel: string | null): string[] => {
    const start = nextTopics.indexOf(label);
    if (start < 0) return [];
    const rest = nextTopics.slice(start + label.length);
    const end = nextLabel ? rest.indexOf(nextLabel) : -1;
    const body = end >= 0 ? rest.slice(0, end) : rest;
    return bulletItems(body);
  };

  const alertRows = tableRows(trend).filter((cells) => /🔴|🟡|🟢/.test(cells[0] ?? ""));
  const positivesIndex = trend.search(/积极信号/);
  const positivesBlock = positivesIndex >= 0 ? trend.slice(positivesIndex) : "";

  const deepDivePayload = deepItems.map((item) => {
    const video = metrics.videos.find((entry) => entry.id === item.id);
    return {
      video_id: item.id,
      title: video?.title ?? item.id,
      metrics: {
        plays: video?.plays ?? null,
        likes: video?.likes ?? null,
        comments: video?.comments ?? null,
        shares: video?.shares ?? null,
        saves: video?.saves ?? null,
        completion_rate: video?.completionRate ?? null,
        completion_5s: video?.completion5s ?? null,
        conversions: video?.conversions ?? null,
        ad_spend: video?.adSpend ?? null,
        content_type: video?.contentType ?? null
      },
      reasons: item.reasons,
      reusable: item.reusable,
      improve: item.improve
    };
  });

  const payload: VidrevDeepPayload = {
    kind: "vidrev",
    mode: "deep",
    data_quality: {
      total_records: metrics.count,
      completion_coverage: metrics.completionCoverage,
      completion_status: metrics.completionStatus,
      comment_status: metrics.commentStatus,
      publish_time_precision: metrics.publishTimePrecision,
      paid_flag: metrics.paidFlagStatus,
      limited_dimensions:
        declaredLimitedDimensions.length > 0 ? declaredLimitedDimensions : metrics.limitedDimensions
    },
    overview: {
      video_count: metrics.count,
      total_plays: metrics.totalPlays,
      total_engagement: metrics.totalEngagement,
      engagement_rate: metrics.engagementRate,
      total_conversions: metrics.totalConversions,
      ad_spend: metrics.paidCount > 0 ? metrics.adSpend : null,
      roi: null,
      roi_note: input.hasRevenueData ? "" : "数据缺失（无成交金额字段）",
      trend: findTableRowValue(overview, /^趋势/) ?? "",
      baseline_compare: { median_plays: metrics.medianPlays, median_engagement: metrics.medianEngagementRate },
      median_plays: metrics.medianPlays,
      median_conversions: metrics.medianConversions
    },
    quadrant: metrics.quadrant,
    content_health: {
      distribution: metrics.byType.map((item) => ({
        type: item.type,
        count: item.count,
        share: item.share,
        avg_plays: item.avgPlays,
        engagement_rate: item.engagementRate,
        completion_rate: item.completionRate,
        verdict: tableRows(health).find((cells) => (cells[0] ?? "").includes(item.type))?.[6]?.trim() ?? ""
      })),
      health_score: metrics.healthScore,
      verdict: metrics.healthVerdict,
      adjust
    },
    deep_dive: deepDivePayload,
    videos: metrics.videos.map((video) => ({
      video_id: video.id,
      index: video.index,
      title: video.title,
      duration_sec: video.durationSec,
      published_at: video.publishedAt,
      plays: video.plays,
      likes: video.likes,
      comments: video.comments,
      shares: video.shares,
      saves: video.saves,
      completion_rate: video.completionRate,
      completion_5s: video.completion5s,
      conversions: video.conversions,
      is_paid: video.paid,
      ad_spend: video.adSpend,
      content_type: video.contentType,
      engagement_rate: video.engagementRate
    })),
    completion_attrib: {
      by_duration: metrics.buckets,
      by_type: metrics.byType.map((item) => ({ type: item.type, completion_rate: item.completionRate })),
      best_formula: /最佳配方[:：]\s*([^\n]+)/.exec(completion)?.[1]?.trim() ?? ""
    },
    engagement_depth: {
      shallow_rate: metrics.engagementDepth.shallowRate,
      deep_rate: metrics.engagementDepth.deepRate,
      like_share_ratio: metrics.engagementDepth.likeShareRatio,
      verdict: metrics.engagementDepth.verdict,
      top_sharers: metrics.engagementDepth.topSharers
    },
    trend_alert: {
      baseline: metrics.baseline,
      weekly: metrics.weekly,
      alerts: alertRows.map((cells) => ({
        level: (cells[0] ?? "").trim(),
        item: (cells[1] ?? "").trim(),
        trigger: (cells[2] ?? "").trim(),
        action: (cells[3] ?? "").trim()
      })),
      positives: numberedItems(positivesBlock).length > 0 ? numberedItems(positivesBlock) : bulletItems(positivesBlock)
    },
    patterns: patternValues,
    methodology,
    next_topics: {
      replicate: directionBlock("主力复制", "优化重拍"),
      reoptimize: directionBlock("优化重拍", "投流放量"),
      boost: directionBlock("投流放量", "放弃方向"),
      drop: directionBlock("放弃方向", "候选选题"),
      candidates: candidates.map((item) => {
        const [title, reason] = item.split(/——|—|--/);
        return { title: (title ?? item).trim(), reason: (reason ?? "").trim(), source: "数据复盘" };
      })
    },
    soft_warnings: metrics.softWarnings,
    report_markdown: markdown
  };

  return { failures, warnings, payload };
}

/** 供 prompt / 路由复用：把重算出的关键口径写成给模型的硬约束文本。 */
export function vidrevMetricBrief(metrics: VidrevMetrics): string {
  const rate = metrics.engagementRate === null ? "缺失" : `${(metrics.engagementRate * 100).toFixed(2)}%`;
  const medianRate = metrics.medianEngagementRate === null ? "缺失" : `${(metrics.medianEngagementRate * 100).toFixed(2)}%`;
  return [
    `可复算数据：${metrics.count} 条 / 总播放 ${metrics.totalPlays} / 总互动 ${metrics.totalEngagement}（互动率 ${rate}，加权口径 Σ互动÷Σ播放）/ 总转化 ${metrics.totalConversions}${metrics.paidCount > 0 ? ` / 投流 ${metrics.paidCount} 条合计 ¥${metrics.adSpend}` : " / 无付费数据"}`,
    `基线（中位数）：单条播放 ${metrics.medianPlays}、转化 ${metrics.medianConversions}、互动率 ${medianRate}；警戒线 <${metrics.baseline.warn_line}、优秀线 >${metrics.baseline.good_line}`,
    `四象限（必须照抄，禁止自行改判）：又爆又赚 ${metrics.quadrant.both.join("、") || "无"}；有量无转 ${metrics.quadrant.plays_no_conv.join("、") || "无"}；有转无量 ${metrics.quadrant.conv_no_plays.join("、") || "无"}；没量没转 ${metrics.quadrant.neither.join("、") || "无"}${metrics.quadrant.notes.length > 0 ? `（${metrics.quadrant.notes.join("；")}）` : ""}`,
    `健康度 =（爆款型 + 人设型）/ 总数 = ${(metrics.healthScore * 100).toFixed(1)}% → ${metrics.healthVerdict}`,
    `时长分桶（自适应）：${metrics.buckets.map((bucket) => `${bucket.bucket} ${bucket.count} 条`).join(" / ")}`,
    metrics.weekly.length > 0
      ? `周度基线（第七章趋势章直接引用，不要自己重算）：${metrics.weekly
          .map((week) => `${week.week} ${week.count} 条 / 均播 ${week.avgPlays} / 播放中位数 ${week.medianPlays}`)
          .join("；")}`
      : "",
    metrics.limitedDimensions.length > 0 ? `受限维度：${metrics.limitedDimensions.join("；")}` : "受限维度：无",
    metrics.softWarnings.length > 0 ? `软提示：${metrics.softWarnings.join("；")}` : ""
  ].filter((line) => line.length > 0).join("\n");
}
