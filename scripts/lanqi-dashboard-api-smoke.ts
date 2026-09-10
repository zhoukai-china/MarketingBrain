/**
 * 兰琪经营驾驶舱 / 目标设置接口契约回归（LQ-20）。
 *
 * 这份用例锁的是接口对外可见的行为，不锁实现：
 * ① 驾驶舱只读：未设目标时不得返回 0 / NaN，派生值一律 null；
 * ② 唯一的手输写入口 `POST /lanqi/goals` 只认本次请求体，按门店 + 月份各存一条；
 * ③ 租户隔离 + 门店越权一律 404，未登录一律 401，前台写目标 403；
 * ④ 无门店不是错误，返回 `state: "no_store"` 供前端渲染引导。
 */
import assert from "node:assert/strict";

async function main() {
  process.env.DATA_MODE = "demo";

  const [{ default: Fastify }, { registerLanqiDashboardRoutes }, { setDemoLanqiScope, resetDemoLanqiScopes }] =
    await Promise.all([
      import("../apps/api/node_modules/fastify/fastify.js"),
      import("../apps/api/src/routes/lanqi-dashboard.js"),
      import("../apps/api/src/products/lanqi/demo-scope.js")
    ]);

  const app = Fastify({ logger: false });
  await registerLanqiDashboardRoutes(app);

  const ownerA = { "x-sitong-tenant-id": "lanqi-dash-a", "x-sitong-user-id": "owner-a", "content-type": "application/json" };
  const ownerB = { "x-sitong-tenant-id": "lanqi-dash-b", "x-sitong-user-id": "owner-b", "content-type": "application/json" };
  const emptyC = { "x-sitong-tenant-id": "lanqi-dash-c", "x-sitong-user-id": "manager-c", "content-type": "application/json" };
  const MONTH = "2026-09";

  const VENDOR_WORDS = ["seedance", "豆包", "百炼", "deepseek", "可灵", "通义", "wan2.2"];
  function assertClean(body: string, label: string) {
    assert.doesNotMatch(body, /NaN|Infinity/, `${label} 不应出现 NaN / Infinity`);
    for (const word of VENDOR_WORDS) {
      assert.ok(!body.toLowerCase().includes(word), `${label} 不应出现模型厂商名 ${word}`);
    }
  }

  resetDemoLanqiScopes();

  // ===== 1. 未登录：401，而不是内部错误 =====
  const anonymous = await app.inject({ method: "GET", url: `/lanqi/dashboard?month=${MONTH}` });
  assert.equal(anonymous.statusCode, 401, anonymous.body);
  assert.equal(anonymous.json().code, "unauthorized");
  assert.ok(anonymous.json().trace_id, "错误体必须带 trace_id");

  // ===== 2. 未设目标的驾驶舱：只读、可算、无假数字 =====
  const firstRead = await app.inject({ method: "GET", url: `/lanqi/dashboard?month=${MONTH}`, headers: ownerA });
  assert.equal(firstRead.statusCode, 200, firstRead.body);
  assertClean(firstRead.body, "驾驶舱读取");
  const firstBody = firstRead.json();
  assert.equal(firstBody.ok, true);
  assert.equal(firstBody.state, "ready");
  assert.equal(firstBody.dataSource, "demo");
  assert.equal(firstBody.goalStatus, "unset");
  assert.equal(firstBody.canEditGoals, true);
  assert.equal(firstBody.month.key, MONTH);
  assert.equal(firstBody.targets.length, 4);
  assert.ok(
    firstBody.targets.every((t: any) => t.goal === null && t.achievedPct === null && t.gap === null && t.perDay === null),
    "未设目标时 4 个目标的派生值必须全是 null"
  );
  assert.ok(firstBody.targets.every((t: any) => t.cur !== 0 && t.cur !== null), "已完成值仍要照常读数");
  assert.equal(firstBody.verdict.tone, "pending");
  assert.equal(firstBody.verdict.revPct, null);
  assert.equal(firstBody.radar.measured, 7, "只有依赖目标的 2 维待设目标");
  assert.deepEqual([...firstBody.radar.pendingKeys].sort(), ["newGrow", "wake"]);
  assert.ok(firstBody.radar.total > 0, "总分应是已测维度的平均，不是 0");
  assert.ok(Array.isArray(firstBody.todos) && firstBody.todos.some((t: any) => t.id === "set-goal"), "应提示先设目标");

  // ===== 3. 写目标：唯一手输入口 =====
  const saveBody = {
    storeId: "demo-store-1",
    month: MONTH,
    targets: { rev: 300000, new: 40, up: 20, wake: 30 },
    requestKey: "lanqi-goal-a-202609-01"
  };
  const invalidValues = await app.inject({
    method: "POST",
    url: "/lanqi/goals",
    headers: ownerA,
    payload: { ...saveBody, targets: { rev: 0, new: null, up: "", wake: null } }
  });
  assert.equal(invalidValues.statusCode, 400);
  assert.equal(invalidValues.json().code, "invalid_goal_values");

  const badMonth = await app.inject({
    method: "POST",
    url: "/lanqi/goals",
    headers: ownerA,
    payload: { ...saveBody, month: "2026-9" }
  });
  assert.equal(badMonth.statusCode, 400);
  assert.equal(badMonth.json().code, "invalid_month");

  const missingStore = await app.inject({
    method: "POST",
    url: "/lanqi/goals",
    headers: ownerA,
    payload: { month: MONTH, targets: { rev: 1 } }
  });
  assert.equal(missingStore.statusCode, 400);
  assert.equal(missingStore.json().code, "invalid_goal_request");

  const foreignStore = await app.inject({
    method: "POST",
    url: "/lanqi/goals",
    headers: ownerA,
    payload: { ...saveBody, storeId: "store-not-mine" }
  });
  assert.equal(foreignStore.statusCode, 404);
  assert.equal(foreignStore.json().code, "store_not_found");

  const saved = await app.inject({ method: "POST", url: "/lanqi/goals", headers: ownerA, payload: saveBody });
  assert.equal(saved.statusCode, 200, saved.body);
  assertClean(saved.body, "保存目标");
  assert.equal(saved.json().status, "set");
  assert.deepEqual(saved.json().values, { rev: 300000, new: 40, up: 20, wake: 30 });

  // 同一个幂等键重放：结果稳定
  const replay = await app.inject({ method: "POST", url: "/lanqi/goals", headers: ownerA, payload: saveBody });
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.json().values, saved.json().values);

  // 「编辑保存写回旧值」回归：第二次必须落第二次的值
  const secondSave = {
    ...saveBody,
    targets: { rev: 450000, new: 55, up: 24, wake: 36 },
    requestKey: "lanqi-goal-a-202609-02"
  };
  const updated = await app.inject({ method: "POST", url: "/lanqi/goals", headers: ownerA, payload: secondSave });
  assert.equal(updated.statusCode, 200);
  assert.deepEqual(updated.json().values, { rev: 450000, new: 55, up: 24, wake: 36 }, "保存必须写本次请求体的新值");

  // ===== 4. 设过目标后：达成率 / 雷达全出分 =====
  const afterSet = await app.inject({ method: "GET", url: `/lanqi/dashboard?month=${MONTH}`, headers: ownerA });
  assert.equal(afterSet.statusCode, 200);
  const afterBody = afterSet.json();
  assert.equal(afterBody.goalStatus, "set");
  assert.equal(afterBody.radar.measured, 9);
  assert.equal(afterBody.radar.pendingKeys.length, 0);
  const revTarget = afterBody.targets.find((t: any) => t.key === "rev");
  assert.equal(revTarget.goal, 450000, "驾驶舱要反映最新保存的目标");
  assert.ok(Number.isInteger(revTarget.achievedPct) && revTarget.achievedPct > 0);
  assert.notEqual(afterBody.verdict.tone, "pending");

  // ===== 5. 目标读取接口 =====
  const goalsRead = await app.inject({
    method: "GET",
    url: `/lanqi/goals?storeId=demo-store-1&month=${MONTH}`,
    headers: ownerA
  });
  assert.equal(goalsRead.statusCode, 200, goalsRead.body);
  assertClean(goalsRead.body, "目标读取");
  assert.equal(goalsRead.json().status, "set");
  assert.equal(goalsRead.json().canEdit, true);
  assert.equal(goalsRead.json().values.rev, 450000);
  assert.equal(goalsRead.json().previous, null, "本月已设目标时不应给出「沿用上月」对比");
  // 目标设置页每张卡的「已完成（自动统计）」必须给真实读数，不能是 null / 0 占位
  const goalsCurrent = goalsRead.json().current;
  assert.ok(goalsCurrent, "目标读取必须返回自动统计的已完成值");
  for (const key of ["rev", "new", "up", "wake"]) {
    assert.ok(
      Number.isInteger(goalsCurrent[key]) && goalsCurrent[key] > 0,
      `已完成值 ${key} 必须是正数自动读数，实际为 ${goalsCurrent[key]}`
    );
  }
  const dashCur = afterBody.targets.find((t: any) => t.key === "rev").cur;
  assert.equal(goalsCurrent.rev, dashCur, "目标设置页与驾驶舱的「已完成」必须同源同值");

  // ===== 6. 租户隔离 =====
  const tenantB = await app.inject({ method: "GET", url: `/lanqi/dashboard?month=${MONTH}`, headers: ownerB });
  assert.equal(tenantB.statusCode, 200);
  assert.equal(tenantB.json().goalStatus, "unset", "别的租户读不到 A 的目标");
  const tenantBGoals = await app.inject({ method: "GET", url: `/lanqi/goals?month=${MONTH}`, headers: ownerB });
  assert.equal(tenantBGoals.statusCode, 200);
  assert.equal(tenantBGoals.json().values.rev, null);

  // ===== 7. 前台只读：能看不能改 =====
  setDemoLanqiScope("lanqi-dash-a", { role: "staff" });
  const staffRead = await app.inject({ method: "GET", url: `/lanqi/dashboard?month=${MONTH}`, headers: ownerA });
  assert.equal(staffRead.statusCode, 200);
  assert.equal(staffRead.json().canEditGoals, false);
  assert.equal(staffRead.json().targets.length, 4, "前台一样能看到目标，只是不能改");
  const staffWrite = await app.inject({ method: "POST", url: "/lanqi/goals", headers: ownerA, payload: saveBody });
  assert.equal(staffWrite.statusCode, 403);
  assert.equal(staffWrite.json().code, "goal_write_forbidden");
  assert.ok(staffWrite.json().trace_id);
  resetDemoLanqiScopes();

  // ===== 8. 没有门店不是错误：给 no_store 让前端渲染引导 =====
  setDemoLanqiScope("lanqi-dash-c", { stores: [] });
  const noStore = await app.inject({ method: "GET", url: `/lanqi/dashboard?month=${MONTH}`, headers: emptyC });
  assert.equal(noStore.statusCode, 200, noStore.body);
  assert.equal(noStore.json().state, "no_store");
  assert.equal(noStore.json().store, null);
  assert.equal(noStore.json().targets, null);
  assert.deepEqual(noStore.json().stores, []);
  const noStoreGoals = await app.inject({ method: "GET", url: "/lanqi/goals", headers: emptyC });
  assert.equal(noStoreGoals.statusCode, 404);
  assert.equal(noStoreGoals.json().code, "store_not_found");
  resetDemoLanqiScopes();

  // ===== 9. 越权门店读取也是 404（不泄漏门店是否存在） =====
  setDemoLanqiScope("lanqi-dash-b", {
    role: "manager",
    stores: [{ id: "demo-store-b1", name: "演示门店 B", city: "青岛" }]
  });
  const peerRead = await app.inject({
    method: "GET",
    url: `/lanqi/dashboard?storeId=demo-store-b1&month=${MONTH}`,
    headers: ownerB
  });
  assert.equal(peerRead.statusCode, 200, peerRead.body);
  assert.equal(peerRead.json().store.id, "demo-store-b1");
  const peekOther = await app.inject({
    method: "GET",
    url: "/lanqi/dashboard?storeId=store-not-mine",
    headers: ownerB
  });
  assert.equal(peekOther.statusCode, 404);
  assert.equal(peekOther.json().code, "store_not_found");
  resetDemoLanqiScopes();

  await app.close();
  console.log("lanqi dashboard api smoke passed: 只读口径=PASS, 目标写入口=PASS, 租户/门店隔离=PASS, 未登录401=PASS");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
