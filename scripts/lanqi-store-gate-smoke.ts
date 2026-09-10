/**
 * 兰琪「门店可用性」判定回归（LQ-20，WorkBuddy 2026-09-10 报告 Bug7 / Bug8 / Bug9）。
 *
 * 这三条 Bug 的现场是同一个：图标能点、表单能填、生成按钮是灰的，
 * 页面上只有一句「当前企业尚未开通此产品，请联系服务团队。」——
 * 老板分不清是没开通、已到期、没门店还是网络挂了，也没有任何自助出口。
 *
 * 因此这里锁的不是实现细节，而是三条用户可感知的契约：
 * ① 不同原因必须给出**不同**文案（未开通 / 已到期 / 已停用 / 无权限 / 读取失败）；
 * ② 按钮点不了时必须能读到一个非空的 `blockedReason`（不能静默 disabled）；
 * ③ 除「读取中」以外，每个不能生成的状态都必须给出出口（CTA 或重试）。
 */
import {
  describeLanqiStoreGate,
  storeErrorCodeOf,
  type LanqiStoreGate,
  type LanqiStoreRef
} from "../apps/web/src/lib/lanqi-store-gate.js";

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

const STORES: LanqiStoreRef[] = [
  { id: "store-1", name: "兰琪美业·城南店", city: "杭州" }
];

function gateWith(errorCode: string, errorMessage = "服务返回了错误"): LanqiStoreGate {
  return describeLanqiStoreGate({ stores: null, errorCode, errorMessage, featureLabel: "朋友圈获客" });
}

// ===== 1. 读取中：不假装「没有门店」，也不提前说不能生成 =====
const loading = describeLanqiStoreGate({ loading: true, stores: null, featureLabel: "朋友圈获客" });
assert("读取中 → kind=loading", loading.kind === "loading");
assert("读取中 → 不能生成", !loading.canGenerate);
assert("读取中 → 也有原因说明（不是空白）", loading.blockedReason.trim().length > 0);
assert("读取中 → 不显示 CTA（避免乱跳）", loading.cta === null && loading.secondaryCta === null);

// ===== 2. 正常：读出唯一门店 → 可以生成，不占版面 =====
const ready = describeLanqiStoreGate({ stores: STORES, featureLabel: "朋友圈获客" });
assert("有门店 → kind=ready", ready.kind === "ready");
assert("有门店 → canGenerate=true", ready.canGenerate);
assert("有门店 → storeId 取自唯一门店（一期单店）", ready.kind === "ready" && ready.storeId === "store-1");
assert("有门店 → blockedReason 为空（按钮不会显示禁用原因）", ready.blockedReason === "");
assert("有门店 → 不显示引导条", ready.cta === null && ready.secondaryCta === null);

// 一期单店：即使后端多返回几家，也只能锁定第一家，界面上不存在门店切换。
const multi = describeLanqiStoreGate({
  stores: [...STORES, { id: "store-2", name: "兰琪美业·城西店", city: "杭州" }],
  featureLabel: "朋友圈获客"
});
assert("多门店也锁定第一家（一期不出现门店切换器）", multi.kind === "ready" && multi.storeId === "store-1");

// ===== 3. Bug8：「暂无门店」不能只说一句就完事，必须给出口 =====
const empty = describeLanqiStoreGate({ stores: [], featureLabel: "朋友圈获客" });
assert("没有门店 → kind=empty", empty.kind === "empty");
assert("没有门店 → 不能生成", !empty.canGenerate);
assert("没有门店 → 有 primary CTA（去完善门店档案）", empty.cta !== null && empty.cta.href === "/lanqi/store-profile");
assert("没有门店 → 有 secondary CTA（门店后台）", empty.secondaryCta !== null && empty.secondaryCta.href === "/lanqi/store");
assert("没有门店 → blockedReason 说明是不能生成的原因", empty.blockedReason.includes("没有可用门店"));
assert("没有门店 → 原因不等于「产品未开通」", !empty.blockedReason.includes("未开通"));

// ===== 4. Bug7：403 必须按原因分文案，不能一律「尚未开通」=====
const cases: Array<{ code: string; reason: string; headlineKeyword: string }> = [
  { code: "product_entitlement_missing", reason: "entitlement_missing", headlineKeyword: "还没有开通" },
  { code: "product_entitlement_required", reason: "entitlement_missing", headlineKeyword: "还没有开通" },
  { code: "product_entitlement_expired", reason: "entitlement_expired", headlineKeyword: "到期" },
  { code: "product_entitlement_inactive", reason: "entitlement_inactive", headlineKeyword: "停用" },
  { code: "store_forbidden", reason: "forbidden", headlineKeyword: "权限" }
];
const headlines = new Set<string>();
for (const item of cases) {
  const gate = gateWith(item.code);
  assert(`${item.code} → reason=${item.reason}`, gate.kind === "error" && gate.reason === item.reason);
  assert(`${item.code} → 文案含「${item.headlineKeyword}」`, gate.headline.includes(item.headlineKeyword));
  assert(`${item.code} → 页面上必须能看到原因`, gate.blockedReason.trim().length > 0);
  headlines.add(gate.headline);
}
// `product_entitlement_required`（旧口径）与 `product_entitlement_missing` 都是「没开通」，
// 允许合并同一句文案；剩下三种必须各不相同。
assert("403 文案按原因分成 4 类（Bug7 的核心：不再一律「尚未开通」）", headlines.size === 4, [...headlines]);

const missing = gateWith("product_entitlement_missing");
assert("未开通 → CTA 是用邀请码登录", missing.cta !== null && missing.cta.href === "/login/lanqi");
const expired = gateWith("product_entitlement_expired");
assert("已到期 → 说明续期后数据不丢", expired.detail.includes("数据不会丢失"));
assert("已到期 → 不需要「重试」（重试也解决不了）", expired.kind === "error" && !expired.retry);
const forbidden = gateWith("store_forbidden");
assert("无权限 → 不给「重试」按钮（重试也没用）", forbidden.kind === "error" && !forbidden.retry);

// ===== 5. 网络类失败：必须能就地重试，不逼用户刷新整页 =====
const network = gateWith("");
assert("未知错误 → kind=error / reason=network", network.kind === "error" && network.reason === "network");
assert("读取失败 → 标记 retry（页面据此渲染「重新读取门店」）", network.kind === "error" && network.retry);
assert("读取失败 → 显示原始提示而不是编造原因", network.detail.includes("服务返回了错误"));
assert("读取失败 → 不误报成「没有门店」", network.kind !== "empty");

// 优先级：接口失败时不能先教老板去建门店（顺序错了会把人带沟里）。
const errorBeatsEmpty = describeLanqiStoreGate({
  stores: [],
  errorCode: "product_entitlement_missing",
  errorMessage: "未开通",
  featureLabel: "朋友圈获客"
});
assert("接口报错优先于「没门店」", errorBeatsEmpty.kind === "error");

// ===== 6. 后端错误字段解析：新 code 优先，兼容旧 error =====
assert("取新字段 code", storeErrorCodeOf({ code: "product_entitlement_expired", error: "product_entitlement_required" }) === "product_entitlement_expired");
assert("旧字段 error 仍能识别", storeErrorCodeOf({ error: "product_entitlement_required" }) === "product_entitlement_required");
assert("非对象 / 空对象不炸", storeErrorCodeOf(null) === null && storeErrorCodeOf({}) === null);

console.log(`\nlanqi-store-gate -> ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
