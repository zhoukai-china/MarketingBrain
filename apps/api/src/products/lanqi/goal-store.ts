/**
 * 兰琪驾驶舱目标存取（LQ-20）
 *
 * 整个兰琪系统里**只有**「本月 4 个目标」是老板/店长手输的数据，因此这里是
 * 唯一的目标写入通道；其余指标（已完成值 / 会员数 / 沉睡率 / 卡耗率 / 预收
 * 负债 / 今日指标 / 9 维雷达）全部由统计口径自动算出，本文件不提供任何写入口。
 *
 * 存储口径：按 `tenantId + storeId + month(YYYY-MM)` 唯一，一月一条，改当月
 * 只更新当月这条，历史月份记录不被覆盖。
 */
import { prisma } from "@baolu/db";
import { env } from "../../config/env.js";
import { previousMonthKey, type GoalItemKey, type GoalValues } from "./dashboard-service.js";

export type GoalStatus = "set" | "carried_over" | "unset";

export interface StoreGoal {
  /** 该月实际落库的目标（含 null：表示这一项没填） */
  values: GoalValues;
  /** 目标来源月份：沿用上月时指向上月，否则等于查询月份 */
  fromMonth: string;
  status: GoalStatus;
  updatedAt: Date | null;
}

const EMPTY_VALUES: GoalValues = { rev: null, new: null, up: null, wake: null };

/** demo 模式（测试实例 / 无库环境）用内存存放，键与库表唯一索引保持一致。 */
const demoGoals = new Map<string, { values: GoalValues; updatedAt: Date }>();

function demoKey(tenantId: string, storeId: string, month: string): string {
  return `${tenantId}::${storeId}::${month}`;
}

function atLeastOneValue(values: GoalValues): boolean {
  return (["rev", "new", "up", "wake"] as GoalItemKey[]).some(key => typeof values[key] === "number");
}

function normalizeRecord(record: {
  rev: number | null;
  newCount: number | null;
  up: number | null;
  wake: number | null;
} | null | undefined): GoalValues {
  if (!record) return { ...EMPTY_VALUES };
  return {
    rev: record.rev ?? null,
    new: record.newCount ?? null,
    up: record.up ?? null,
    wake: record.wake ?? null
  };
}

async function readMonth(tenantId: string, storeId: string, month: string): Promise<{ values: GoalValues; updatedAt: Date | null }> {
  if (env.DATA_MODE === "demo") {
    const found = demoGoals.get(demoKey(tenantId, storeId, month));
    return { values: found ? { ...found.values } : { ...EMPTY_VALUES }, updatedAt: found?.updatedAt ?? null };
  }
  const row = await prisma.lanqiStoreGoal.findUnique({
    where: { tenantId_storeId_month: { tenantId, storeId, month } }
  });
  return { values: normalizeRecord(row), updatedAt: row?.updatedAt ?? null };
}

/** 只读某月**原始记录**（不做「沿用上月」推断），用于目标设置页的对比提示。 */
export async function readGoalMonth(
  tenantId: string,
  storeId: string,
  month: string
): Promise<{ values: GoalValues; updatedAt: Date } | null> {
  const record = await readMonth(tenantId, storeId, month);
  if (!record.updatedAt || !atLeastOneValue(record.values)) return null;
  return { values: record.values, updatedAt: record.updatedAt };
}

/**
 * 读取某门店某月用于驾驶舱计算的目标。
 *
 * 月初未设目标时**不返回 0**：若上月有目标，则返回「沿用上月」并把 `fromMonth`
 * 指向上月，由界面明确提示；若上月也没有，返回 `unset`，界面显示「未设置 · 去
 * 设置目标」，所有派生值（达成率 / 缺口 / 日均）一律为 null。
 */
export async function readStoreGoal(tenantId: string, storeId: string, month: string): Promise<StoreGoal> {
  const current = await readMonth(tenantId, storeId, month);
  if (atLeastOneValue(current.values)) {
    return { values: current.values, fromMonth: month, status: "set", updatedAt: current.updatedAt };
  }
  const prevMonth = previousMonthKey(month);
  const previous = await readMonth(tenantId, storeId, prevMonth);
  if (atLeastOneValue(previous.values)) {
    return { values: previous.values, fromMonth: prevMonth, status: "carried_over", updatedAt: previous.updatedAt };
  }
  return { values: { ...EMPTY_VALUES }, fromMonth: month, status: "unset", updatedAt: null };
}

/**
 * 写入当月目标。`values` 必须来自**本次请求的请求体**（不得回读旧记录），
 * 否则会出现「改完还存旧值」的回归（原型 `goal-setting.html` / `home.html`
 * 的 `save()` 就踩过这个坑）。
 */
export async function saveStoreGoal(params: {
  tenantId: string;
  storeId: string;
  month: string;
  values: GoalValues;
  userId: string | null;
  requestKey: string | null;
}): Promise<StoreGoal> {
  const { tenantId, storeId, month, values, userId, requestKey } = params;
  if (env.DATA_MODE === "demo") {
    const saved = { values: { ...values }, updatedAt: new Date() };
    demoGoals.set(demoKey(tenantId, storeId, month), saved);
    return { values: { ...saved.values }, fromMonth: month, status: "set", updatedAt: saved.updatedAt };
  }

  const data = {
    rev: typeof values.rev === "number" ? values.rev : null,
    newCount: typeof values.new === "number" ? values.new : null,
    up: typeof values.up === "number" ? values.up : null,
    wake: typeof values.wake === "number" ? values.wake : null
  };
  const row = await prisma.lanqiStoreGoal.upsert({
    where: { tenantId_storeId_month: { tenantId, storeId, month } },
    create: { tenantId, storeId, month, ...data, requestKey, updatedBy: userId },
    update: { ...data, requestKey, updatedBy: userId }
  });
  return { values: normalizeRecord(row), fromMonth: month, status: "set", updatedAt: row.updatedAt };
}

/** 只给测试用：清空 demo 内存目标，避免用例之间互相污染。 */
export function resetDemoGoals(): void {
  demoGoals.clear();
}
