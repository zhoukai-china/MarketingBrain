// 客户充值到账通知（企业微信）离线契约回归 —— 2026-09-16 用户：
// 「用户付费了我咋样才能知道呢？也给我推送到企业微信吧（跟服务器空间不足预警一样）」。
//
// 只验证**纯函数与失败关闭**，不发任何网络请求：
//   1. 通知文案必须带齐经营要看的四件事：客户、金额、到账积分、该客户当前余额；
//   2. 多送积分要单独标出来（老板一眼看到「这一单多送了多少」）；
//   3. 没有 webhook 时 `notifyOps` 必须**只写日志、返回 false**，绝不抛异常——
//      付费入账不能被通知失败拖垮（这条是资金链路的硬约束）。
import { buildRechargeNotice, notifyOps } from "../apps/api/src/services/ops-alert.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function main(): Promise<void> {
  const notice = buildRechargeNotice({
    tenantName: "汽配信息网",
    userName: "王老板",
    amountCny: 100,
    basePts: 2000,
    bonusPts: 200,
    balance: 2200,
    method: "wechat",
    orderId: "order_test_1"
  });

  for (const needle of ["汽配信息网", "王老板", "¥100", "2200 积分", "2200 积分", "多送 200", "order_test_1"]) {
    assert(notice.includes(needle), `notice mentions ${needle}`);
  }
  assert(notice.startsWith("【思潼AI增长OS · 客户充值到账】"), "notice starts with the recharge title");
  assert(notice.includes("2000 + 200") || notice.includes("2200"), "notice states the credited total");

  // 没有多送时不该出现「多送」字样，避免老板误以为每单都多送。
  const plain = buildRechargeNotice({ tenantName: "测试门店", amountCny: 50, basePts: 1000, bonusPts: 0, balance: 1000 });
  assert(!plain.includes("多送"), "no bonus means no '多送' wording");

  const previous = process.env.SITONG_ALERT_WEBHOOK;
  delete process.env.SITONG_ALERT_WEBHOOK;
  try {
    const sent = await notifyOps("smoke: 不应发出任何请求");
    assert(sent === false, "notifyOps returns false when no webhook is configured (fail closed, no throw)");
  } finally {
    if (previous !== undefined) process.env.SITONG_ALERT_WEBHOOK = previous;
  }

  console.log("PASS ops-recharge-notice-smoke");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
