/**
 * 兰琪经营驾驶舱口径回归（LQ-20）。
 *
 * 这份用例锁的是「老板一眼看到的数」的口径，而不是实现细节：
 * ① 9 维雷达计分公式与原型逐条对齐（home.html radarScore）；
 * ② 月初未设目标时不得出现 0 / NaN —— 派生值必须为 null；
 * ③ 目标按门店 + 月份各存一条，「本月保存」只认本次请求体里的值；
 * ④ 前台只读、老板/店长可写的 RBAC 口径。
 */
import {
  GOAL_ITEMS,
  RADAR_DIMS,
  buildHealth,
  buildRadar,
  buildTargets,
  buildTodos,
  buildVerdict,
  canEditGoals,
  demoStoreMetrics,
  isValidMonthKey,
  monthContext,
  monthKeyOf,
  normalizeGoalValues,
  previousMonthKey,
  radarColor,
  radarLevel,
  radarScore,
  type GoalValues,
  type StoreMetrics
} from "../apps/api/src/products/lanqi/dashboard-service.js";
import { readGoalMonth, readStoreGoal, resetDemoGoals, saveStoreGoal } from "../apps/api/src/products/lanqi/goal-store.js";

process.env.DATA_MODE = "demo";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`ok - ${name}`);
  } else {
    fail++;
    console.error(`FAIL - ${name}${detail === undefined ? "" : ` :: ${JSON.stringify(detail)}`}`);
  }
}

const CONTAINER_KEYS = ["targets", "verdict", "radar", "health", "todos", "today"] as const;
function containsForbiddenNumber(value: unknown): boolean {
  if (typeof value === "number") return !Number.isFinite(value);
  if (typeof value === "string") return /NaN|Infinity/.test(value);
  if (Array.isArray(value)) return value.some(containsForbiddenNumber);
  if (value && typeof value === "object") return Object.values(value).some(containsForbiddenNumber);
  return false;
}

// ===== 1. 9 维雷达计分公式（照抄 0909 文档 / 原型 home.html radarScore）=====
const forward = RADAR_DIMS.find(d => d.k === "kahao")!; // 正向，健康线 60
const backward = RADAR_DIMS.find(d => d.k === "sleep")!; // 负向，健康线 25
assert("正向：踩健康线 = 85 分", radarScore(forward, 60) === 85);
assert("正向：0 值 = 0 分", radarScore(forward, 0) === 0);
assert("正向：超线 20% 封顶 100", radarScore(forward, 72) === 100);
assert("正向：低于线按比例", radarScore(forward, 30) === Math.round((30 / 60) * 85));
assert("负向：0 值 = 100 分", radarScore(backward, 0) === 100);
assert("负向：踩健康线 = 85 分", radarScore(backward, 25) === 85);
assert("负向：2 倍线 = 60 分", radarScore(backward, 50) === 60);
assert("负向：越差越低", radarScore(backward, 42) < radarScore(backward, 25));
assert("颜色：≥85 绿", radarColor(85) === "#1E8E3E" && radarColor(100) === "#1E8E3E");
assert("颜色：70–84 橙", radarColor(70) === "#E8A33D" && radarColor(84) === "#E8A33D");
assert("颜色：<70 红", radarColor(69) === "#D6394E" && radarColor(0) === "#D6394E");
assert("等级：达标/观察/危险", radarLevel(90) === "达标" && radarLevel(75) === "观察" && radarLevel(40) === "危险");
assert("9 个维度定义完整", RADAR_DIMS.length === 9 && new Set(RADAR_DIMS.map(d => d.k)).size === 9);
assert("4 个手输目标定义完整", GOAL_ITEMS.length === 4);

// ===== 2. 月份口径 =====
assert("月份键格式", monthKeyOf(new Date(2026, 8, 10)) === "2026-09");
assert("月份键补零", monthKeyOf(new Date(2026, 0, 1)) === "2026-01");
assert("上一月跨年", previousMonthKey("2026-01") === "2025-12");
assert("上一月同月", previousMonthKey("2026-09") === "2026-08");
assert("月份合法性", isValidMonthKey("2026-09") && !isValidMonthKey("2026-13") && !isValidMonthKey("2026-9") && !isValidMonthKey(""));
const current = monthContext("2026-09", new Date(2026, 8, 10));
assert("当月：总天数 30", current.totalDays === 30);
assert("当月：已过 10 天", current.passedDays === 10 && current.leftDays === 20 && current.isCurrent);
const past = monthContext("2026-08", new Date(2026, 8, 10));
assert("历史月：整月已过", past.passedDays === 31 && past.leftDays === 0 && !past.isCurrent);
const future = monthContext("2026-10", new Date(2026, 8, 10));
assert("未来月：一天没过", future.passedDays === 0 && future.leftDays === 31);
assert("2 月闰年天数", monthContext("2024-02", new Date(2024, 1, 1)).totalDays === 29);

// ===== 3. 目标归一化（0 = 没填，不是「目标就是 0」）=====
const ok = normalizeGoalValues({ rev: "300000", new: 40, up: 20, wake: 30 });
assert("字符串金额可写入", ok.ok && ok.values.rev === 300000 && ok.values.new === 40);
const zeroAsEmpty = normalizeGoalValues({ rev: 0, new: 40, up: "", wake: null });
assert("0 视为未填（不当成 0 目标）", zeroAsEmpty.ok && zeroAsEmpty.values.rev === null && zeroAsEmpty.values.up === null);
const allEmpty = normalizeGoalValues({ rev: 0, new: null, up: "", wake: undefined });
assert("四个都空 → 还差必填", !allEmpty.ok && allEmpty.message.includes("还差必填"));
const negative = normalizeGoalValues({ rev: -1 });
assert("负数拒绝", !negative.ok);
const tooBig = normalizeGoalValues({ rev: 999_999_999_999 });
assert("超出合理范围拒绝", !tooBig.ok && tooBig.message.includes("超出合理范围"));
const badShape = normalizeGoalValues("300000");
assert("非对象拒绝", !badShape.ok);

// ===== 4. 未设目标：不出现 0 / NaN =====
const metrics = demoStoreMetrics("store-demo-a", "2026-09");
const unsetGoals: GoalValues = { rev: null, new: null, up: null, wake: null };
const month9 = monthContext("2026-09", new Date(2026, 8, 10));
const unsetTargets = buildTargets(unsetGoals, metrics, month9);
assert(
  "未设目标：4 项的达成率/缺口/日均/达标全是 null",
  unsetTargets.every(t => t.goal === null && t.achievedPct === null && t.gap === null && t.perDay === null && t.met === null)
);
assert("未设目标：已完成值仍然照常读数（只读指标）", unsetTargets.every(t => Number.isFinite(t.cur)));
const unsetVerdict = buildVerdict(unsetTargets, month9);
assert("未设目标：结论条进入待设目标态", unsetVerdict.tone === "pending" && unsetVerdict.revPct === null && unsetVerdict.forecast === null);
assert("未设目标：结论条仍给出时间进度", unsetVerdict.timePct === 33);
const unsetRadar = buildRadar(metrics, unsetTargets);
const pendingDims = unsetRadar.dims.filter(d => d.score === null).map(d => d.k);
assert("未设目标：只有依赖目标的 2 维待设目标", pendingDims.length === 2 && pendingDims.includes("newGrow") && pendingDims.includes("wake"));
assert("未设目标：其余 7 维照常出分", unsetRadar.measured === 7);
assert("未设目标：总分是已测维度的平均，不是 0", unsetRadar.total !== null && unsetRadar.total > 0);
const unsetHealth = buildHealth(unsetTargets, metrics, month9);
assert("未设目标：健康度只把业绩进度标为待设", unsetHealth.rules[0].level === "pending");
assert(
  "未设目标：整体 JSON 里没有 NaN / Infinity",
  !containsForbiddenNumber({
    targets: unsetTargets,
    verdict: unsetVerdict,
    radar: unsetRadar,
    health: unsetHealth,
    todos: buildTodos(unsetTargets, metrics, unsetRadar, month9)
  })
);
assert(
  "未设目标：驾驶舱不给假数字（0% 同样禁止）",
  unsetTargets.every(t => t.achievedPct !== 0) && unsetVerdict.revPct !== 0
);

// ===== 5. 已设目标：达成率/缺口/日均 =====
const setGoals: GoalValues = { rev: 300000, new: 40, up: 20, wake: 30 };
const setTargets = buildTargets(setGoals, metrics, month9);
const revT = setTargets.find(t => t.key === "rev")!;
assert("已设目标：业绩达成率", revT.achievedPct === Math.round((metrics.revenue.monthActual / 300000) * 100));
assert("已设目标：缺口不为负", revT.gap !== null && revT.gap >= 0);
assert(
  "已设目标：日均 = ceil(缺口 / 剩余天数)",
  revT.perDay === (revT.gap! > 0 ? Math.ceil(revT.gap! / month9.leftDays) : 0)
);
const setVerdict = buildVerdict(setTargets, month9);
assert("已设目标：结论条给出预测和缺口", setVerdict.forecast !== null && setVerdict.gap !== null && setVerdict.weakestKey !== null);
const setRadar = buildRadar(metrics, setTargets);
assert("已设目标：9 维全部出分", setRadar.measured === 9 && setRadar.pendingKeys.length === 0);

// ===== 6. 原型口径对齐：新客增长维度 = 新客达成率 =====
// 原型 assets/design-system.js：大连总店 new 目标 40 / 已完成 26 → radar.newGrow 65。
const protoMetrics: StoreMetrics = {
  ...metrics,
  acquisition: { newCustomers: 26 },
  wake: { woken: 14 },
  members: { total: 486, sleeping: Math.round(486 * 0.37), sleepRate: 37 },
  revenue: { ...metrics.revenue, monthActual: 182000, aov: 717 },
  kahao: { rate: 63 },
  debt: { rate: 36 },
  churn: { rate: 2.4 },
  block: { rate: 3 },
  rebuy: { rate: 42 }
};
const protoTargets = buildTargets({ rev: 300000, new: 40, up: 20, wake: 30 }, protoMetrics, monthContext("2026-09", new Date(2026, 8, 8)));
const protoRadar = buildRadar(protoMetrics, protoTargets);
const newGrowDim = protoRadar.dims.find(d => d.k === "newGrow")!;
assert("原型对齐：新客增长 = 新客达成率（26/40 = 65）", newGrowDim.value === 65, newGrowDim.value);
assert("原型对齐：复购 42 / 沉睡 37 / 客单价 717 / 卡耗 63 / 负债 36 / 唤醒 47 / 屏蔽 3", [
  protoRadar.dims.find(d => d.k === "rebuy")!.value === 42,
  protoRadar.dims.find(d => d.k === "sleep")!.value === 37,
  protoRadar.dims.find(d => d.k === "aov")!.value === 717,
  protoRadar.dims.find(d => d.k === "kahao")!.value === 63,
  protoRadar.dims.find(d => d.k === "debt")!.value === 36,
  Math.round(protoRadar.dims.find(d => d.k === "wake")!.value!) === 47,
  protoRadar.dims.find(d => d.k === "block")!.value === 3
].every(Boolean));
assert("原型对齐：唤醒达成率 14/30 = 47", protoRadar.dims.find(d => d.k === "wake")!.value === 47);

// ===== 7. 目标存取：门店 + 月份各存一条、只认本次请求体 =====
const accessCases: string[] = [];
async function goalStoreCases() {
  resetDemoGoals();
  const first = await readStoreGoal("tenant-a", "store-1", "2026-09");
  assert("未设目标：状态 unset、值全空", first.status === "unset" && first.values.rev === null && first.updatedAt === null);

  await saveStoreGoal({
    tenantId: "tenant-a",
    storeId: "store-1",
    month: "2026-08",
    values: { rev: 200000, new: 30, up: 10, wake: 12 },
    userId: "u1",
    requestKey: "k-aug"
  });
  const carried = await readStoreGoal("tenant-a", "store-1", "2026-09");
  assert("未设当月但上月有 → 沿用上月并标明来源月份", carried.status === "carried_over" && carried.fromMonth === "2026-08" && carried.values.rev === 200000);

  await saveStoreGoal({
    tenantId: "tenant-a",
    storeId: "store-1",
    month: "2026-09",
    values: { rev: 300000, new: 40, up: 20, wake: 30 },
    userId: "u1",
    requestKey: "k-sep"
  });
  const set = await readStoreGoal("tenant-a", "store-1", "2026-09");
  assert("设过当月 → status=set 且值取自本次请求体", set.status === "set" && set.values.rev === 300000 && set.values.new === 40);
  const augRecord = await readGoalMonth("tenant-a", "store-1", "2026-08");
  assert("历史月份不被覆盖", augRecord !== null && augRecord.values.rev === 200000);

  // 「编辑保存写入旧值」回归：第二次保存必须落第二次的值。
  await saveStoreGoal({
    tenantId: "tenant-a",
    storeId: "store-1",
    month: "2026-09",
    values: { rev: 450000, new: 55, up: 24, wake: 36 },
    userId: "u1",
    requestKey: "k-sep-2"
  });
  const edited = await readStoreGoal("tenant-a", "store-1", "2026-09");
  assert("改完保存的是新值，不是旧值", edited.values.rev === 450000 && edited.values.new === 55 && edited.values.up === 24 && edited.values.wake === 36);

  const otherStore = await readStoreGoal("tenant-a", "store-2", "2026-09");
  assert("同租户另一家门店互相独立", otherStore.status === "unset");
  const otherTenant = await readStoreGoal("tenant-b", "store-1", "2026-09");
  assert("跨租户同 store_id 读不到目标", otherTenant.status === "unset" && otherTenant.values.rev === null);
  accessCases.push("goal-store");
}

// ===== 8. RBAC：老板/店长可写，前台只读 =====
assert("owner 可改目标", canEditGoals("owner"));
assert("admin 可改目标", canEditGoals("admin"));
assert("manager 可改目标", canEditGoals("manager"));
assert("staff 只读", !canEditGoals("staff"));
assert("operator 只读", !canEditGoals("operator"));

async function main() {
  await goalStoreCases();

  console.log(`\nlanqi-dashboard-rules -> ${pass} passed, ${fail} failed (${accessCases.length} async blocks)`);
  if (fail > 0) process.exit(1);
}

void main();
