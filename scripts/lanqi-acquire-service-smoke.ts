// 公域获客 · 短视频文案改稿服务契约冒烟（确定性分支，不调用真实 Provider）
import { ACQUIRE_SERVICE_VERSION, rewriteShortVideoCopy } from "../apps/api/src/products/beauty-industry/acquire-service.js";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`ok - ${name}`);
  } else {
    fail++;
    console.error(`FAIL - ${name}`);
  }
}

async function rejects(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function main() {
  // 1. 门店隔离：必须带 store_id
  const noStore = await rejects(() => rewriteShortVideoCopy({ storeId: "  ", raw: "今天店里做了 8 单，姐妹们到店体验。" }));
  assert("缺 store_id 拒绝", (noStore ?? "").includes("缺少门店标识"));

  // 2. 输入门禁：空 / 过短
  const emptyRaw = await rejects(() => rewriteShortVideoCopy({ storeId: "store_1", raw: "" }));
  assert("空原稿拒绝", (emptyRaw ?? "").includes("请先贴"));
  const tooShort = await rejects(() => rewriteShortVideoCopy({ storeId: "store_1", raw: "太" }));
  assert("过短原稿也不报错，走请补充分支", tooShort === null);

  // 3. 素材不足时 fail closed：不编造，返回 needsInput
  const thin = await rewriteShortVideoCopy({ storeId: "store_1", raw: "写一个获客文案" });
  assert("素材不足返回 needsInput", thin.needsInput === true);
  assert("素材不足不产出正文", thin.finalDraft === "" && thin.body.length > 0);
  assert("素材不足不产出标题/开头", thin.titles.length === 0 && thin.openings.length === 0);
  assert("素材不足仍给确定性评分", thin.scores.length === 5);
  assert("素材不足有 traceId", typeof thin.traceId === "string" && (thin.traceId ?? "").startsWith("acquire:"));
  assert("素材不足不触发合规拦截项", thin.checks.length === 0);

  // 4. 用途推断在素材不足分支同样生效
  const asDeal = await rewriteShortVideoCopy({ storeId: "store_1", raw: "写一个获客文案", purpose: "deal" });
  assert("显式选成交型时用途为 deal", asDeal.purpose === "deal" && asDeal.purposeLabel === "成交型");
  const autoDeal = await rewriteShortVideoCopy({ storeId: "store_1", raw: "写一个获客文案", goal: "conversion" });
  assert("目标转化率时自动判成交型", autoDeal.purpose === "deal");
  assert("非法用途回落到自动判断", (await rewriteShortVideoCopy({ storeId: "store_1", raw: "写一个获客文案", purpose: "viral" as never })).purpose === "exposure");

  assert("服务版本号存在", ACQUIRE_SERVICE_VERSION === "acquire_service_v2");

  console.log(`\n${ACQUIRE_SERVICE_VERSION} -> ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
