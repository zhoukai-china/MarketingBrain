/**
 * 兰琪经营驾驶舱 / 目标设置的接口客户端（LQ-20）。
 *
 * 口径铁律（与 `apps/api/src/products/lanqi/dashboard-service.ts` 一致）：
 * ① 整个系统里只有「本月 4 个目标」是老板/店长手输，其余字段全部只读；
 * ② 目标缺失时后端返回 `null`，前端必须渲染成引导文案，**不得**降级成 0 / NaN。
 *
 * 因此这里把「可能为 null」的派生值原样保留成 `number | null`，不在客户端补 0。
 */
import { apiPath, getAppPath } from "./api.js";

export type GoalKey = "rev" | "new" | "up" | "wake";
export type GoalStatus = "set" | "carried_over" | "unset";
export type RadarDimKey = "newGrow" | "rebuy" | "sleep" | "churn" | "aov" | "kahao" | "debt" | "wake" | "block";

export interface GoalItem {
  key: GoalKey;
  label: string;
  icon: string;
  unit: string;
  goal: number | null;
  goalSet: boolean;
  cur: number;
  achievedPct: number | null;
  gap: number | null;
  perDay: number | null;
  met: boolean | null;
}

export interface GoalDefinition {
  key: GoalKey;
  label: string;
  icon: string;
  unit: string;
}

export interface MonthContextView {
  key: string;
  name: string;
  totalDays: number;
  passedDays: number;
  leftDays: number;
  isCurrent: boolean;
}

export interface Verdict {
  tone: "ok" | "warn" | "pending";
  timePct: number;
  revPct: number | null;
  forecast: number | null;
  gap: number | null;
  weakestKey: GoalKey | null;
  weakestLabel: string | null;
  weakestPct: number | null;
  weakestBehindPct: number | null;
  weakestLeft: number | null;
  weakestPerDay: number | null;
}

export interface RadarDim {
  k: RadarDimKey;
  n: string;
  ico: string;
  unit: string;
  line: number;
  dir: 1 | -1;
  tip: string;
  act: string;
  value: number | null;
  score: number | null;
  color: string | null;
  level: string;
}

export interface Radar {
  total: number | null;
  level: string;
  measured: number;
  pendingKeys: RadarDimKey[];
  dims: RadarDim[];
}

export interface HealthRule {
  key: string;
  label: string;
  level: "ok" | "warn" | "bad" | "pending";
  detail: string;
}

export interface Health {
  light: "green" | "amber" | "red" | "pending";
  label: string;
  rules: HealthRule[];
}

export interface Todo {
  id: string;
  priority: "R" | "P1" | "P2";
  title: string;
  why: string;
  href: string;
}

export interface SleepTier {
  key: "m1" | "m2" | "m3";
  stock: number;
  cur: number;
  rate: number;
}

export interface TodayMetrics {
  revenue: number;
  visits: number;
  aov: number;
  aovDeltaPct: number;
  revenueDeltaPct: number;
  visitsDelta: number;
  membersTotal: number;
  sleeping: number;
  sleepRate: number;
  kahaoRate: number;
  debtRate: number;
  sleepTiers: SleepTier[];
}

export interface DashboardView {
  ok: true;
  dataSource: "demo" | "database";
  state: "ready" | "no_store";
  store: { id: string; name: string; city: string | null } | null;
  stores: Array<{ id: string; name: string }>;
  month: MonthContextView;
  goalItems: GoalDefinition[];
  goalStatus: GoalStatus;
  goalFromMonth: string;
  goalUpdatedAt?: string | null;
  canEditGoals?: boolean;
  targets: GoalItem[] | null;
  verdict: Verdict | null;
  radar: Radar | null;
  health: Health | null;
  todos: Todo[];
  today: TodayMetrics | null;
}

export interface GoalsView {
  ok: true;
  dataSource: "demo" | "database";
  store: { id: string; name: string; city: string | null };
  stores: Array<{ id: string; name: string }>;
  month: string;
  monthName: string;
  goalItems: GoalDefinition[];
  status: GoalStatus;
  fromMonth: string;
  values: Record<GoalKey, number | null>;
  /** 「已完成」自动统计读数（只读）。目标设置页每张卡右侧那个只读框用的就是它。 */
  current?: Record<GoalKey, number>;
  updatedAt: string | null;
  canEdit: boolean;
  previous: { month: string; values: Record<GoalKey, number | null>; updatedAt: string } | null;
}

export interface ApiErrorBody {
  code?: string;
  message?: string;
  error?: string;
  trace_id?: string;
}

/** 接口错误：保留后端 `code`，界面据此分流文案（例如 403 的具体原因）。 */
export class LanqiApiError extends Error {
  code: string;
  status: number;
  traceId?: string;
  constructor(message: string, code: string, status: number, traceId?: string) {
    super(message);
    this.name = "LanqiApiError";
    this.code = code;
    this.status = status;
    this.traceId = traceId;
  }
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("store_os_token");
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

/** 未登录 / 会话失效：清掉本地会话并回登录页，避免停在空白页。 */
export function redirectToLogin(): void {
  localStorage.removeItem("store_os_token");
  window.location.replace(getAppPath("/login/lanqi"));
}

async function readJson(response: Response): Promise<any> {
  const body = await response.json().catch(() => ({}) as ApiErrorBody);
  if (response.status === 401) {
    redirectToLogin();
    throw new LanqiApiError(body.message ?? "登录已失效，请重新登录", body.code ?? "unauthorized", 401);
  }
  if (!response.ok) {
    throw new LanqiApiError(
      body.message ?? body.error ?? `请求失败（${response.status}）`,
      body.code ?? body.error ?? "request_failed",
      response.status,
      body.trace_id
    );
  }
  return body;
}

export function currentMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export async function fetchDashboard(params: { storeId?: string; month?: string }): Promise<DashboardView> {
  const query = new URLSearchParams();
  if (params.storeId) query.set("storeId", params.storeId);
  query.set("month", params.month ?? currentMonthKey());
  const response = await fetch(apiPath(`/lanqi/dashboard?${query.toString()}`), { headers: authHeaders() });
  return (await readJson(response)) as DashboardView;
}

export async function fetchGoals(params: { storeId?: string; month?: string }): Promise<GoalsView> {
  const query = new URLSearchParams();
  if (params.storeId) query.set("storeId", params.storeId);
  query.set("month", params.month ?? currentMonthKey());
  const response = await fetch(apiPath(`/lanqi/goals?${query.toString()}`), { headers: authHeaders() });
  return (await readJson(response)) as GoalsView;
}

/**
 * 保存本月目标。
 *
 * 只提交**表单当前值**：原型 `goal-setting.html` 的 `save()` 会因为读回旧对象
 * 把编辑前的值又写回去，这里从源头避免——入参就是用户此刻看到的数字。
 */
export async function saveGoals(params: {
  storeId: string;
  month: string;
  targets: Record<GoalKey, number | null>;
  requestKey?: string;
}): Promise<{
  ok: true;
  month: string;
  storeId: string;
  status: GoalStatus;
  values: Record<GoalKey, number | null>;
  updatedAt?: string | null;
}> {
  const response = await fetch(apiPath("/lanqi/goals"), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(params)
  });
  return await readJson(response);
}

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `¥${Number(value).toLocaleString("zh-CN")}`;
}

export function formatNumber(value: number | null | undefined, unit = ""): string {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toLocaleString("zh-CN")}${unit ? ` ${unit}` : ""}`;
}

export function formatValue(key: GoalKey, value: number | null | undefined, unit: string): string {
  return key === "rev" ? formatMoney(value) : formatNumber(value, unit);
}

/**
 * 达成率 / 缺口 / 日均一律可能为 null（目标未设）。界面统一走这里，
 * 保证任何调用点都不会把 null 渲染成 0%。
 */
export function formatPct(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value}%`;
}
