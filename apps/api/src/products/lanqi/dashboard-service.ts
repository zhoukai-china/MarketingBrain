/**
 * 兰琪美业门店 AI 经营大脑 · 经营驾驶舱口径（LQ-20 / 0909 总纲）
 *
 * 驾驶舱的数据口径只有两条铁律：
 * ① 整个系统里老板/店长只需要手输「本月 4 个目标」（业绩 / 新客 / 升单 / 唤醒），
 *    按 store_id + 月份各存一条；其余全部自动统计，界面只读、不设录入框。
 * ② 月初未设目标时不能显示 0、也不能显示 NaN：要么沿用上月并明确提示，要么
 *    显示「未设置 · 去设置目标」。任何派生值在目标缺失时一律返回 null，由界面
 *    渲染成引导文案。
 *
 * 本文件同时是 9 维雷达的计分权威实现（照抄 0909 文档 radarScore）：
 *   正向（越大越好）：踩线 85 分，超线 20% 满分
 *   负向（越小越好）：0 值 100 分，踩线 85 分，2 倍线 60 分
 */

export type GoalItemKey = "rev" | "new" | "up" | "wake";

/**
 * 谁能改「本月 4 个目标」：老板 / 管理员 / 店长可写，前台（staff/operator）只读。
 * 与原型 `goal-setting.html`「前台只读（disabled + 提示）」一致。
 */
export function canEditGoals(role: string): boolean {
  return role === "owner" || role === "admin" || role === "manager";
}

export const GOAL_ITEMS: Array<{ key: GoalItemKey; label: string; icon: string; unit: string }> = [
  { key: "rev", label: "业绩目标", icon: "💰", unit: "元" },
  { key: "new", label: "新客目标", icon: "🆕", unit: "人" },
  { key: "up", label: "升单目标", icon: "⬆️", unit: "人" },
  { key: "wake", label: "沉睡唤醒", icon: "🔔", unit: "人" }
];

export type RadarDimKey =
  | "newGrow"
  | "rebuy"
  | "sleep"
  | "churn"
  | "aov"
  | "kahao"
  | "debt"
  | "wake"
  | "block";

export interface RadarDim {
  k: RadarDimKey;
  n: string;
  ico: string;
  line: number;
  dir: 1 | -1;
  unit: string;
  tip: string;
  act: string;
}

/** 9 维维度定义与健康线：健康线后续按租户可配置，一期取 0909 文档给定值。 */
export const RADAR_DIMS: RadarDim[] = [
  { k: "newGrow", n: "新客增长", ico: "🆕", line: 60, dir: 1, unit: "%", tip: "本月新增客户达成率 ÷ 时间进度，看拉新跟不跟得上", act: "低于时间进度：加大本地推投放 / 上老带新" },
  { k: "rebuy", n: "复购活跃", ico: "🔁", line: 40, dir: 1, unit: "%", tip: "90 天内消费 ≥2 次的会员占比，美业健康线 40%", act: "低于 40%：做项目组合包 / 疗程续卡提醒" },
  { k: "sleep", n: "沉睡控制", ico: "😴", line: 25, dir: -1, unit: "%", tip: "M1/M2/M3 沉睡会员占总会员比，越低越好", act: "高于 25%：进入沉睡客唤醒引擎，先要名单" },
  { k: "churn", n: "流失控制", ico: "🚪", line: 3, dir: -1, unit: "%", tip: "本月流失会员占比（90 天未到店且无预约），越低越好", act: "高于 3%：查是不是服务 / 技师出问题" },
  { k: "aov", n: "客单价", ico: "💰", line: 700, dir: 1, unit: "元", tip: "平均客单价，对标门店目标 700 元", act: "低于目标：推升单组合 / 高客单项目前置" },
  { k: "kahao", n: "卡耗健康", ico: "🎫", line: 60, dir: 1, unit: "%", tip: "卡项消耗率，达标线 60% —— 消耗越快负债越轻", act: "低于 60%：排消耗计划，先催高频卡顾客" },
  { k: "debt", n: "预收健康", ico: "⚠️", line: 40, dir: -1, unit: "%", tip: "未消费余额 ÷ 累计预收。卖卡越多负债越重，这是美业最大的雷", act: "高于 40%：暂停大额卡促销，先消课" },
  { k: "wake", n: "唤醒执行", ico: "🔔", line: 60, dir: 1, unit: "%", tip: "沉睡唤醒目标达成率，看团队有没有真的在跟进", act: "低于 60%：把唤醒任务拆到人、设每日指标" },
  { k: "block", n: "触达覆盖", ico: "📵", line: 5, dir: -1, unit: "%", tip: "屏蔽 / 退订会员占比，越高说明内容被嫌烦了", act: "高于 5%：降频 + 换内容方向，别硬推" }
];

/** 照抄 0909 文档 radarScore，不得改写公式。 */
export function radarScore(dim: Pick<RadarDim, "line" | "dir">, value: number): number {
  const L = dim.line;
  let sc: number;
  if (dim.dir > 0) sc = value <= L ? (value / L) * 85 : 85 + ((value - L) / L) * 75;
  else sc = value <= L ? 100 - (value / L) * 15 : 85 - ((value - L) / L) * 25;
  return Math.max(0, Math.min(100, Math.round(sc)));
}

export function radarColor(score: number): string {
  return score >= 85 ? "#1E8E3E" : score >= 70 ? "#E8A33D" : "#D6394E";
}

export function radarLevel(score: number): "达标" | "观察" | "危险" {
  return score >= 85 ? "达标" : score >= 70 ? "观察" : "危险";
}

// ===== 月份口径 =====

export interface MonthContext {
  key: string;
  name: string;
  totalDays: number;
  passedDays: number;
  leftDays: number;
  isCurrent: boolean;
}

export function monthKeyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function previousMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split("-").map((v) => Number(v));
  const d = new Date(Date.UTC(y, m - 2, 1));
  return monthKeyOf(new Date(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function isValidMonthKey(monthKey: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) return false;
  const year = Number(monthKey.slice(0, 4));
  return year >= 2000 && year <= 2100;
}

export function monthContext(monthKey: string, today = new Date()): MonthContext {
  const [year, month] = monthKey.split("-").map((v) => Number(v));
  const totalDays = new Date(year, month, 0).getDate();
  const currentKey = monthKeyOf(today);
  const isCurrent = monthKey === currentKey;
  const passedDays = isCurrent
    ? today.getDate()
    : monthKey < currentKey
      ? totalDays
      : 0;
  return {
    key: monthKey,
    name: `${year}年${month}月`,
    totalDays,
    passedDays,
    leftDays: Math.max(0, totalDays - passedDays),
    isCurrent
  };
}

// ===== 目标归一化 =====

export type GoalValues = Partial<Record<GoalItemKey, number | null>>;

export const GOAL_MAX: Record<GoalItemKey, number> = { rev: 100_000_000, new: 100_000, up: 100_000, wake: 100_000 };

/**
 * 目标写入校验：只接受 4 个正整数或显式清空（null）。
 * 传 0 视为「没填」而不是「目标就是 0」——0 目标在驾驶舱里等同于未设置，
 * 会再次触发「未设置 / 沿用上月」引导，避免界面出现无意义的 0%。
 */
export function normalizeGoalValues(raw: unknown): { ok: true; values: GoalValues } | { ok: false; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "参数不合法：目标必须是对象" };
  }
  const source = raw as Record<string, unknown>;
  const values: GoalValues = {};
  for (const item of GOAL_ITEMS) {
    const value = source[item.key];
    if (value === undefined || value === null || value === "") {
      values[item.key] = null;
      continue;
    }
    const num = typeof value === "number" ? value : Number(String(value).replace(/[^\d]/g, ""));
    if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) {
      return { ok: false, message: `参数不合法：${item.label}必须是正整数` };
    }
    if (num > GOAL_MAX[item.key]) {
      return { ok: false, message: `参数不合法：${item.label}超出合理范围` };
    }
    values[item.key] = num === 0 ? null : num;
  }
  const atLeastOne = GOAL_ITEMS.some((item) => typeof values[item.key] === "number");
  if (!atLeastOne) {
    return { ok: false, message: "还差必填：四个目标至少要填一个" };
  }
  return { ok: true, values };
}

// ===== 门店经营数据源 =====

export interface StoreMetrics {
  dataSource: "demo" | "pos";
  members: { total: number; sleeping: number; sleepRate: number };
  revenue: { monthActual: number; today: number; todayVisits: number; aov: number; aovDeltaPct: number; todayDeltaPct: number; visitsDelta: number };
  acquisition: { newCustomers: number };
  upgrade: { upgraded: number };
  wake: { woken: number };
  kahao: { rate: number };
  debt: { rate: number };
  churn: { rate: number };
  block: { rate: number };
  rebuy: { rate: number };
  sleepTiers: Array<{ key: "m1" | "m2" | "m3"; stock: number; cur: number; rate: number }>;
}

function seedOf(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick(seed: number, min: number, max: number, salt: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const mixed = (seed ^ Math.imul(salt + 1, 2654435761)) >>> 0;
  const ratio = mixed / 4294967295;
  return Math.round(lo + ratio * (hi - lo));
}

/**
 * 一期演示数据源。
 *
 * 真实 POS / 收银 / 扣卡流水尚未接入（见 LQ-20 任务卡「本次不做」），因此这里按
 * storeId + 月份生成一组确定性的门店经营快照：同一门店同一月份每次取值完全一致
 * （刷新、重进不会跳数），但**不是真实经营数据**。所有消费方必须把
 * `dataSource: "demo"` 原样传给界面并在界面上显式标注数据来源，不允许当成真账。
 */
export function demoStoreMetrics(storeId: string, monthKey: string): StoreMetrics {
  const seed = seedOf(`${storeId}::${monthKey}`);
  const membersTotal = pick(seed, 320, 1450, 1);
  const sleeping = pick(seed, Math.round(membersTotal * 0.12), Math.round(membersTotal * 0.33), 2);
  const monthActual = pick(seed, 90000, 420000, 3);
  const todayVisits = pick(seed, 5, 26, 4);
  const aov = pick(seed, 480, 980, 5);
  const m1 = pick(seed, 20, 90, 6);
  const m2 = pick(seed, 12, 60, 7);
  const m3 = Math.max(4, sleeping - m1 - m2);
  return {
    dataSource: "demo",
    members: { total: membersTotal, sleeping, sleepRate: Math.round((sleeping / membersTotal) * 100) },
    revenue: {
      monthActual,
      today: todayVisits * aov,
      todayVisits,
      aov,
      aovDeltaPct: pick(seed, -9, 12, 8) - 3,
      todayDeltaPct: pick(seed, -14, 22, 9) - 4,
      visitsDelta: pick(seed, -4, 6, 10) - 2
    },
    acquisition: { newCustomers: pick(seed, 8, 52, 11) },
    upgrade: { upgraded: pick(seed, 3, 26, 12) },
    wake: { woken: pick(seed, 5, 38, 13) },
    kahao: { rate: pick(seed, 42, 78, 14) },
    debt: { rate: pick(seed, 22, 62, 15) },
    churn: { rate: pick(seed, 1, 7, 16) },
    block: { rate: pick(seed, 1, 9, 17) },
    rebuy: { rate: pick(seed, 24, 58, 18) },
    sleepTiers: [
      { key: "m1", stock: m1, cur: pick(seed, 3, Math.max(4, m1), 19), rate: pick(seed, 32, 71, 20) },
      { key: "m2", stock: m2, cur: pick(seed, 2, Math.max(3, m2), 21), rate: pick(seed, 20, 55, 22) },
      { key: "m3", stock: m3, cur: pick(seed, 1, Math.max(2, m3), 23), rate: pick(seed, 8, 34, 24) }
    ]
  };
}

// ===== 驾驶舱装配 =====

export type GoalStatus = "set" | "carried_over" | "unset";

export interface GoalItemView {
  key: GoalItemKey;
  label: string;
  icon: string;
  unit: string;
  goal: number | null;
  goalSet: boolean;
}

export interface TargetView extends GoalItemView {
  /** 已完成值：自动统计，界面只读 */
  cur: number;
  /** 目标未设置时为 null，界面必须渲染成引导文案，不得降级成 0 或 NaN */
  achievedPct: number | null;
  gap: number | null;
  perDay: number | null;
  met: boolean | null;
}

export interface VerdictView {
  tone: "ok" | "warn" | "pending";
  timePct: number;
  revPct: number | null;
  forecast: number | null;
  gap: number | null;
  weakestKey: GoalItemKey | null;
  weakestLabel: string | null;
  weakestPct: number | null;
  weakestBehindPct: number | null;
  weakestLeft: number | null;
  weakestPerDay: number | null;
}

export interface RadarDimView {
  k: RadarDimKey;
  n: string;
  ico: string;
  unit: string;
  line: number;
  dir: 1 | -1;
  tip: string;
  act: string;
  /** 目标未设置导致算不出来的维度，值为 null，界面显示「待设目标」 */
  value: number | null;
  score: number | null;
  color: string | null;
  level: string;
}

export interface RadarView {
  total: number | null;
  level: string;
  measured: number;
  pendingKeys: RadarDimKey[];
  dims: RadarDimView[];
}

export interface HealthRuleView {
  key: string;
  label: string;
  level: "ok" | "warn" | "bad" | "pending";
  detail: string;
}

export interface HealthView {
  light: "green" | "amber" | "red" | "pending";
  label: string;
  rules: HealthRuleView[];
}

export interface TodoView {
  id: string;
  priority: "R" | "P1" | "P2";
  title: string;
  why: string;
  href: string;
}

function round(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function achievedPctOf(cur: number, goal: number | null): number | null {
  if (goal === null || goal <= 0) return null;
  return Math.round((cur / goal) * 100);
}

function perDayOf(gap: number, leftDays: number): number | null {
  if (gap <= 0) return 0;
  if (leftDays <= 0) return null;
  return Math.ceil(gap / leftDays);
}

export function buildTargets(goals: GoalValues, metrics: StoreMetrics, month: MonthContext): TargetView[] {
  const curOf: Record<GoalItemKey, number> = {
    rev: metrics.revenue.monthActual,
    new: metrics.acquisition.newCustomers,
    up: metrics.upgrade.upgraded,
    wake: metrics.wake.woken
  };
  return GOAL_ITEMS.map((item) => {
    const goal = typeof goals[item.key] === "number" ? (goals[item.key] as number) : null;
    const cur = curOf[item.key];
    const achievedPct = achievedPctOf(cur, goal);
    const gap = goal === null ? null : Math.max(0, goal - cur);
    return {
      key: item.key,
      label: item.label,
      icon: item.icon,
      unit: item.unit,
      goal,
      goalSet: goal !== null,
      cur,
      achievedPct,
      gap,
      perDay: gap === null ? null : perDayOf(gap, month.leftDays),
      met: gap === null ? null : gap === 0
    };
  });
}

export function buildVerdict(targets: TargetView[], month: MonthContext): VerdictView {
  const timePct = month.totalDays > 0 ? Math.round((month.passedDays / month.totalDays) * 100) : 0;
  const rev = targets.find((t) => t.key === "rev") as TargetView;
  const measured = targets.filter((t) => t.goalSet);
  if (!measured.length || !rev.goalSet || rev.goal === null) {
    return {
      tone: "pending",
      timePct,
      revPct: null,
      forecast: null,
      gap: null,
      weakestKey: null,
      weakestLabel: null,
      weakestPct: null,
      weakestBehindPct: null,
      weakestLeft: null,
      weakestPerDay: null
    };
  }
  const revPct = achievedPctOf(rev.cur, rev.goal) ?? 0;
  const curPerDay = month.passedDays > 0 ? rev.cur / month.passedDays : 0;
  const needPerDay = perDayOf(Math.max(0, rev.goal - rev.cur), month.leftDays);
  const forecast = Math.round(rev.cur + curPerDay * month.leftDays);
  const gap = forecast - rev.goal;

  let weakest = measured[0];
  let weakestDiff = Number.POSITIVE_INFINITY;
  for (const target of measured) {
    const diff = (target.achievedPct ?? 0) - timePct;
    if (diff < weakestDiff) {
      weakestDiff = diff;
      weakest = target;
    }
  }
  return {
    tone: gap >= 0 ? "ok" : "warn",
    timePct,
    revPct,
    forecast,
    gap,
    weakestKey: weakest.key,
    weakestLabel: weakest.label,
    weakestPct: weakest.achievedPct,
    weakestBehindPct: round(weakestDiff, 1),
    weakestLeft: weakest.gap,
    weakestPerDay: weakest.gap === null ? null : perDayOf(weakest.gap, month.leftDays)
  };
}

/**
 * 9 维雷达取值。
 *
 * 口径说明（新客增长维度）：原型 `home.html` 给该维的 tip 文案是
 * 「本月新增客户达成率 ÷ 时间进度」，但原型 mock 数据里该维取值就是
 * **新客目标达成率本身**（大连总店 26/40 → 65，开发区店 19/28 → 68，
 * 三店合计 69/103 → 67，与 `assets/design-system.js` 中 radar.newGrow
 * 的 65 / 68 / 67 逐条吻合）。为避免雷达点与健康线 60 的语义打架，
 * 这里按原型**数据**口径取值 = 本月新客达成率；文案与取值的这处不一致
 * 已在 LQ-20 任务卡登记为待产品确认的残余风险。
 */
export function buildRadar(metrics: StoreMetrics, targets: TargetView[]): RadarView {
  const wakeTarget = targets.find((t) => t.key === "wake") as TargetView;
  const newTarget = targets.find((t) => t.key === "new") as TargetView;

  const values: Record<RadarDimKey, number | null> = {
    newGrow: newTarget.achievedPct,
    rebuy: metrics.rebuy.rate,
    sleep: metrics.members.sleepRate,
    churn: metrics.churn.rate,
    aov: metrics.revenue.aov,
    kahao: metrics.kahao.rate,
    debt: metrics.debt.rate,
    wake: wakeTarget.achievedPct,
    block: metrics.block.rate
  };

  const dims: RadarDimView[] = RADAR_DIMS.map((dim) => {
    const value = values[dim.k];
    if (value === null) {
      return { ...dim, value: null, score: null, color: null, level: "待设目标" };
    }
    const score = radarScore(dim, value);
    return { ...dim, value, score, color: radarColor(score), level: radarLevel(score) };
  });
  const scored = dims.filter((d) => d.score !== null) as Array<RadarDimView & { score: number }>;
  const total = scored.length ? Math.round(scored.reduce((sum, d) => sum + d.score, 0) / scored.length) : null;
  return {
    total,
    level: total === null ? "待设目标" : radarLevel(total),
    measured: scored.length,
    pendingKeys: dims.filter((d) => d.score === null).map((d) => d.k),
    dims
  };
}

export function buildHealth(targets: TargetView[], metrics: StoreMetrics, month: MonthContext): HealthView {
  const timePct = month.totalDays > 0 ? Math.round((month.passedDays / month.totalDays) * 100) : 0;
  const rev = targets.find((t) => t.key === "rev") as TargetView;
  const rules: HealthRuleView[] = [];

  if (!rev.goalSet || rev.achievedPct === null) {
    rules.push({ key: "revPace", label: "业绩进度", level: "pending", detail: "未设本月业绩目标，先设置目标才能比进度" });
  } else {
    const diff = rev.achievedPct - timePct;
    rules.push({
      key: "revPace",
      label: "业绩进度",
      level: diff >= 0 ? "ok" : diff >= -10 ? "warn" : "bad",
      detail: `达成 ${rev.achievedPct}%，时间进度 ${timePct}%`
    });
  }

  const kahao = metrics.kahao.rate;
  rules.push({
    key: "kahao",
    label: "卡耗率",
    level: kahao >= 60 ? "ok" : kahao >= 50 ? "warn" : "bad",
    detail: `当前 ${kahao}%，健康线 60%`
  });

  const sleep = metrics.members.sleepRate;
  rules.push({
    key: "sleep",
    label: "沉睡率",
    level: sleep <= 25 ? "ok" : sleep <= 35 ? "warn" : "bad",
    detail: `当前 ${sleep}%，健康线 ≤25%`
  });

  const debt = metrics.debt.rate;
  rules.push({
    key: "debt",
    label: "预收健康",
    level: debt <= 40 ? "ok" : debt <= 55 ? "warn" : "bad",
    detail: `未消费率 ${debt}%，健康线 ≤40%`
  });

  const active = rules.filter((r) => r.level !== "pending");
  const bad = active.filter((r) => r.level === "bad").length;
  const warn = active.filter((r) => r.level === "warn").length;
  const light: HealthView["light"] = bad > 0 ? "red" : warn > 0 ? "amber" : active.length ? "green" : "pending";
  return {
    light,
    label: light === "green" ? "健康" : light === "amber" ? "需关注" : light === "red" ? "有风险" : "待设目标",
    rules
  };
}

/** 「今天干什么」：只从当前已算出的信号生成规则化动作，不做无依据的推荐。 */
export function buildTodos(targets: TargetView[], metrics: StoreMetrics, radar: RadarView, month: MonthContext): TodoView[] {
  const todos: TodoView[] = [];
  const rev = targets.find((t) => t.key === "rev") as TargetView;
  const wake = targets.find((t) => t.key === "wake") as TargetView;

  if (!rev.goalSet) {
    todos.push({
      id: "set-goal",
      priority: "P1",
      title: "先设本月 4 个目标",
      why: "整个系统只有这一处需要老板手输；没设目标，驾驶舱的达成率 / 缺口 / 日均都算不出来",
      href: "/lanqi/goal-setting"
    });
  } else if (rev.gap !== null && rev.gap > 0) {
    todos.push({
      id: "rev-gap",
      priority: "P1",
      title: `本月业绩还差 ¥${rev.gap.toLocaleString("zh-CN")}`,
      why: month.leftDays > 0
        ? `剩 ${month.leftDays} 天，按当前节奏预测月末 ¥${(rev.cur + Math.round(rev.cur / Math.max(1, month.passedDays)) * month.leftDays).toLocaleString("zh-CN")}`
        : "本月已结束，核对实际完成情况",
      href: "/lanqi/brain"
    });
  }

  if (wake.goalSet && wake.gap !== null && wake.gap > 0) {
    todos.push({
      id: "wake-gap",
      priority: "P1",
      title: `沉睡唤醒还差 ${wake.gap} 人`,
      why: `沉睡存量 ${metrics.members.sleeping} 人（沉睡率 ${metrics.members.sleepRate}%），M1 档成功率最高，先打 M1`,
      href: "/lanqi/moments"
    });
  }

  if (metrics.kahao.rate < 60) {
    todos.push({
      id: "kahao",
      priority: "P2",
      title: `卡耗率 ${metrics.kahao.rate}% 低于健康线 60%`,
      why: "消耗越慢预收负债越重，先排高频卡顾客的消耗计划",
      href: "/lanqi/brain"
    });
  }

  if (radar.pendingKeys.length) {
    todos.push({
      id: "radar-pending",
      priority: "P2",
      title: "补全本月目标，让 9 维雷达算全",
      why: `当前有 ${radar.pendingKeys.length} 个维度因为缺目标暂时算不出来`,
      href: "/lanqi/goal-setting"
    });
  }

  return todos.slice(0, 6);
}
