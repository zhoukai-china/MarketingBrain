/**
 * 兰琪美业门店 AI 经营大脑 · 经营驾驶舱与目标设置接口（LQ-20）
 *
 * 口径铁律（0909 总纲 + WorkBuddy 原型补充）：
 * ① 整个系统只有「本月 4 个目标」是手输，其余指标全部自动统计、界面只读；
 * ② 月初未设目标时不允许出现 0 / NaN，只能给「沿用上月」或「未设置 · 去设置」；
 * ③ 所有接口都按会话下发的租户 + 门店过滤，跨租户 / 越权门店一律 404。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { createHash } from "node:crypto";
import { prisma } from "@baolu/db";
import { env } from "../config/env.js";
import { resolveRequestContext, type RequestContext } from "../services/request-context.js";
import { accessLevelForRole, assertStoreVisible, type StoreAccess } from "../services/store-access-guard.js";
import {
  GOAL_ITEMS,
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
  type GoalItemView,
  type StoreMetrics
} from "../products/lanqi/dashboard-service.js";
import { readGoalMonth, readStoreGoal, saveStoreGoal, type GoalStatus } from "../products/lanqi/goal-store.js";
import { demoStoreAccess, listDemoVisibleStores } from "../products/lanqi/demo-scope.js";

const goalBodySchema = z
  .object({
    storeId: z.string().trim().min(1),
    month: z.string().trim().optional(),
    targets: z.record(z.string(), z.unknown()),
    requestKey: z.string().trim().min(4).max(120).optional()
  })
  .strict();

function goalRequestKey(tenantId: string, storeId: string, month: string, payload: unknown): string {
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);
  return `lanqi-goal:${tenantId}:${storeId}:${month}:${digest}`;
}

/** 0909 统一错误体：{ code, message, trace_id } */
function fail(reply: FastifyReply, request: FastifyRequest, status: number, code: string, message: string) {
  return reply.code(status).send({ code, message, trace_id: request.id });
}

/**
 * 解析会话身份。未登录 / membership 失效必须给 **401**（而不是内部错误 500），
 * 否则前端没法据此跳回登录页，会把「没登录」误显示成「系统故障」。
 */
async function resolveContextOrFail(request: FastifyRequest, reply: FastifyReply) {
  try {
    return { ok: true as const, context: await resolveRequestContext(request.headers) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message === "missing_tenant_or_user" || message === "membership_not_found") {
      return { ok: false as const, reply: fail(reply, request, 401, "unauthorized", "请先登录后再访问经营驾驶舱") };
    }
    return { ok: false as const, reply: fail(reply, request, 500, "lanqi_context_error", message) };
  }
}

/**
 * 门店 RBAC 每次请求重算（不缓存到端）：owner/admin = 老板级（全门店），
 * manager/staff/operator = 单店，只认自己在 Membership 上绑定的那家店。
 */
async function loadStoreAccess(context: Pick<RequestContext, "tenantId" | "userId">): Promise<StoreAccess> {
  if (env.DATA_MODE === "demo") {
    return demoStoreAccess(context.tenantId);
  }
  const membership = context.userId
    ? await prisma.membership.findUnique({
        where: { tenantId_userId: { tenantId: context.tenantId, userId: context.userId } },
        select: { role: true, storeId: true }
      })
    : null;
  const role = membership?.role ?? "staff";
  return { role, level: accessLevelForRole(role), membershipStoreId: membership?.storeId ?? null };
}

async function listVisibleStores(
  context: Pick<RequestContext, "tenantId">,
  access: StoreAccess
): Promise<Array<{ id: string; name: string; city: string | null }>> {
  if (env.DATA_MODE === "demo") {
    return listDemoVisibleStores(context.tenantId, access);
  }
  const where =
    access.level === "boss"
      ? { tenantId: context.tenantId }
      : access.membershipStoreId
        ? { tenantId: context.tenantId, id: access.membershipStoreId }
        : null;
  if (!where) return [];
  return prisma.store.findMany({
    where,
    select: { id: true, name: true, city: true },
    orderBy: { createdAt: "asc" }
  });
}

/**
 * 驾驶舱的一期数据源：真实 POS / 收银 / 扣卡流水尚未接入，先用带
 * `dataSource: "demo"` 标记的确定性快照，界面必须把这个标记显式展示出来。
 */
function metricsOf(storeId: string, month: string): StoreMetrics {
  return demoStoreMetrics(storeId, month);
}

export async function registerLanqiDashboardRoutes(app: FastifyInstance): Promise<void> {
  /**
   * 经营驾驶舱读取。`storeId` 由前端从「会话下发的可见门店」里带过来；
   * 不传时取会话绑定的门店（店长/前台），老板级取租户第一家门店。
   */
  app.get("/lanqi/dashboard", async (request, reply) => {
    const resolved = await resolveContextOrFail(request, reply);
    if (!resolved.ok) return resolved.reply;
    const context = resolved.context;
    try {
      const query = request.query as { storeId?: string; month?: string };
      const month = query.month?.trim() || monthKeyOf(new Date());
      if (!isValidMonthKey(month)) {
        return fail(reply, request, 400, "invalid_month", "月份格式必须是 YYYY-MM");
      }

      const access = await loadStoreAccess(context);
      const stores = await listVisibleStores(context, access);
      const requestedStoreId = query.storeId?.trim() || access.membershipStoreId || stores[0]?.id || "";

      if (!requestedStoreId) {
        // 无门店不是错误：前端据此显示「还没有门店」引导（报告 Bug8）。
        return {
          ok: true,
          dataSource: env.DATA_MODE === "demo" ? "demo" : "database",
          state: "no_store",
          store: null,
          stores: [],
          month: monthContext(month),
          goalItems: GOAL_ITEMS as GoalItemView[],
          goalStatus: "unset" satisfies GoalStatus,
          goalFromMonth: month,
          targets: null,
          verdict: null,
          radar: null,
          health: null,
          todos: [],
          today: null
        };
      }

      const store = stores.find(item => item.id === requestedStoreId);
      // 跨租户 / 越权门店一律 404，不泄漏「这家店存在但你看不到」。
      if (!store || !assertStoreVisible(access, requestedStoreId).allowed) {
        return fail(reply, request, 404, "store_not_found", "门店不存在或无权访问");
      }

      const goal = await readStoreGoal(context.tenantId, store.id, month);
      const metrics = metricsOf(store.id, month);
      const monthScope = monthContext(month);
      const targets = buildTargets(goal.values, metrics, monthScope);
      const radar = buildRadar(metrics, targets);
      const health = buildHealth(targets, metrics, monthScope);

      return {
        ok: true,
        dataSource: metrics.dataSource,
        state: "ready",
        store: { id: store.id, name: store.name, city: store.city },
        stores: stores.map(item => ({ id: item.id, name: item.name })),
        month: monthScope,
        goalItems: GOAL_ITEMS as GoalItemView[],
        goalStatus: goal.status,
        goalFromMonth: goal.fromMonth,
        goalUpdatedAt: goal.updatedAt ? goal.updatedAt.toISOString() : null,
        canEditGoals: canEditGoals(access.role),
        targets,
        verdict: buildVerdict(targets, monthScope),
        radar,
        health,
        todos: buildTodos(targets, metrics, radar, monthScope),
        today: {
          revenue: metrics.revenue.today,
          visits: metrics.revenue.todayVisits,
          aov: metrics.revenue.aov,
          aovDeltaPct: metrics.revenue.aovDeltaPct,
          revenueDeltaPct: metrics.revenue.todayDeltaPct,
          visitsDelta: metrics.revenue.visitsDelta,
          membersTotal: metrics.members.total,
          sleeping: metrics.members.sleeping,
          sleepRate: metrics.members.sleepRate,
          kahaoRate: metrics.kahao.rate,
          debtRate: metrics.debt.rate,
          sleepTiers: metrics.sleepTiers
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      return fail(reply, request, 500, "lanqi_dashboard_error", message);
    }
  });

  /** 读取某门店某月目标（含「沿用上月」来源与上一月值，供目标设置页提示）。 */
  app.get("/lanqi/goals", async (request, reply) => {
    const resolved = await resolveContextOrFail(request, reply);
    if (!resolved.ok) return resolved.reply;
    const context = resolved.context;
    try {
      const query = request.query as { storeId?: string; month?: string; previousMonth?: string };
      const month = query.month?.trim() || monthKeyOf(new Date());
      if (!isValidMonthKey(month)) {
        return fail(reply, request, 400, "invalid_month", "月份格式必须是 YYYY-MM");
      }
      const access = await loadStoreAccess(context);
      const stores = await listVisibleStores(context, access);
      const storeId = query.storeId?.trim() || access.membershipStoreId || stores[0]?.id || "";
      if (!storeId) {
        return fail(reply, request, 404, "store_not_found", "当前账号下还没有门店");
      }
      const store = stores.find(item => item.id === storeId);
      if (!store || !assertStoreVisible(access, storeId).allowed) {
        return fail(reply, request, 404, "store_not_found", "门店不存在或无权访问");
      }

      const goal = await readStoreGoal(context.tenantId, store.id, month);
      /**
       * 目标设置页每张卡里的「已完成（自动统计，不可改）」必须显示真实读数。
       * 它是只读派生值：由门店 + 月份的经营快照算出，和驾驶舱用的是同一份
       * `buildTargets`，避免两个页面各算一套导致对不上。
       */
      const completedOf = (() => {
        const [rev, fresh, upgraded, woken] = buildTargets({}, metricsOf(store.id, month), monthContext(month));
        return { rev: rev.cur, new: fresh.cur, up: upgraded.cur, wake: woken.cur };
      })();
      const previousKey = query.previousMonth?.trim() || undefined;
      const previous = previousKey && isValidMonthKey(previousKey)
        ? await prismaMonthGoal(context.tenantId, store.id, previousKey)
        : null;

      return {
        ok: true,
        dataSource: env.DATA_MODE === "demo" ? "demo" : "database",
        store: { id: store.id, name: store.name, city: store.city },
        stores: stores.map(item => ({ id: item.id, name: item.name })),
        month,
        monthName: monthContext(month).name,
        goalItems: GOAL_ITEMS as GoalItemView[],
        status: goal.status,
        fromMonth: goal.fromMonth,
        values: {
          rev: goal.values.rev ?? null,
          new: goal.values.new ?? null,
          up: goal.values.up ?? null,
          wake: goal.values.wake ?? null
        },
        /** 自动统计的「已完成」读数（只读，不参与写入）。 */
        current: completedOf,
        updatedAt: goal.updatedAt ? goal.updatedAt.toISOString() : null,
        canEdit: canEditGoals(access.role),
        previous
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      return fail(reply, request, 500, "lanqi_goals_error", message);
    }
  });

  /**
   * 保存本月 4 个目标（系统里唯一的手输写入口）。
   *
   * 「编辑保存写入旧值」是原型踩过的坑（`home.html` / `goal-setting.html` 的
   * `save()` 写的是 `TARGETS[x].goal` 而不是表单当前值），因此这里只认 **本次
   * 请求体** 里的值，绝不回读记录再原样写回。
   */
  app.post("/lanqi/goals", async (request, reply) => {
    const resolved = await resolveContextOrFail(request, reply);
    if (!resolved.ok) return resolved.reply;
    const context = resolved.context;
    try {
      const parsed = goalBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return fail(reply, request, 400, "invalid_goal_request", "参数不合法：请提交门店、月份和 4 个目标");
      }
      const { storeId, targets: rawTargets, requestKey } = parsed.data;
      const month = parsed.data.month || monthKeyOf(new Date());
      if (!isValidMonthKey(month)) {
        return fail(reply, request, 400, "invalid_month", "月份格式必须是 YYYY-MM");
      }
      const access = await loadStoreAccess(context);
      if (!canEditGoals(access.role)) {
        return fail(reply, request, 403, "goal_write_forbidden", "只有门店老板或店长可以修改本月目标");
      }

      const normalized = normalizeGoalValues(rawTargets);
      if (!normalized.ok) {
        return fail(reply, request, 400, "invalid_goal_values", normalized.message);
      }

      const stores = await listVisibleStores(context, access);
      const store = stores.find(item => item.id === storeId);
      if (!store || !assertStoreVisible(access, storeId).allowed) {
        return fail(reply, request, 404, "store_not_found", "门店不存在或无权访问");
      }

      const saved = await saveStoreGoal({
        tenantId: context.tenantId,
        storeId,
        month,
        values: normalized.values,
        userId: context.userId,
        requestKey: requestKey ?? goalRequestKey(context.tenantId, storeId, month, parsed.data.targets)
      });

      return {
        ok: true,
        event: "lanqi_store_goal_saved",
        month,
        storeId,
        status: saved.status,
        values: {
          rev: saved.values.rev ?? null,
          new: saved.values.new ?? null,
          up: saved.values.up ?? null,
          wake: saved.values.wake ?? null
        },
        updatedAt: saved.updatedAt ? saved.updatedAt.toISOString() : null
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      return fail(reply, request, 500, "lanqi_goal_save_error", message);
    }
  });
}

/** 某月**原始记录**（不做「沿用上月」推断），供目标设置页对比提示使用。 */
async function prismaMonthGoal(tenantId: string, storeId: string, month: string) {
  const record = await readGoalMonth(tenantId, storeId, month);
  if (!record) return null;
  return {
    month,
    values: {
      rev: record.values.rev ?? null,
      new: record.values.new ?? null,
      up: record.values.up ?? null,
      wake: record.values.wake ?? null
    },
    updatedAt: record.updatedAt.toISOString()
  };
}
