/**
 * 兰琪私域营销 · 输入错误路径回归（QA-20260911-007）。
 *
 * 锁的是一条对外可见的契约：**老板填错了** 和 **我们这边出故障了** 必须走不同的出口。
 *
 *   - 输入类（快速模式空原话 / 原话不足 15 字 / 专业模式缺必填 / 缺门店 / 违规引导词）
 *     → 4xx（422），并把给老板看的填表提示原样回显；
 *   - 其余（Provider / 网络 / 未知）
 *     → 5xx（500），只回一句人话，原始报错只进服务端日志（不把 `deepseek_provider_http_error`
 *       这类模型/厂商串渲染到老板页面上）。
 *
 * 为什么必须有这条回归（2026-09-11）：
 * WorkBuddy 复测把「快速模式空输入提示『请先写一句你的原话』」记成 P1 页面缺陷；
 * 真相反查出来的是服务端状态码错了——`fastGate()` 抛的这条文案没进 `INVALID_MSG` 正则，
 * 于是被判成服务端故障，`POST /lanqi/moments/upgrade` 返回 **HTTP 500**（测试实例
 * journalctl 08:22:58 / 08:23:19 两次 `statusCode:500`）。状态码一错，5xx 告警被污染，
 * 而且同一分支会把原始报错直接回显给前端。
 *
 * 本用例不调用任何模型：4xx 用例在调用 Provider **之前**就抛出，5xx 分支只用规则层
 * 与导出函数做判定（避免在回归里打真实 Provider）。
 *
 * 需要本地数据库（与 `lanqi-moments-asset-scope-smoke` 同级别前置条件）。
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import { prisma } from "../apps/api/node_modules/@baolu/db/dist/index.js";
import {
  isMomentsInputError,
  registerMomentRoutes,
  userFacingGenerationError
} from "../apps/api/src/routes/moments.js";
import {
  generateWechatGroup,
  upgradeMoments,
  validateStoreScope,
  type MomentsUpgradeInput
} from "../apps/api/src/products/beauty-industry/moments-service.js";
import { fastGate, missingRequired } from "../apps/api/src/products/beauty-industry/moments-rules.js";
import { sessionHeaders } from "./lib/db-session-headers.js";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`ok - ${name}${detail ? ` :: ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`FAIL - ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

/** 服务端不该出现在用户页面上的内部串（模型名 / 厂商名 / 内部错误码）。 */
const LEAK_PATTERN = /deepseek|llm_|provider|api[_-]?key|http_error|stack|at .*\.ts:/i;

async function main(): Promise<void> {
  const stamp = randomUUID();
  const tenantId = `lq-err-${stamp}`;
  const userId = `lq-err-user-${stamp}`;
  const storeId = `lq-err-store-${stamp}`;

  await prisma.tenant.create({ data: { id: tenantId, name: "Lanqi Moments Input Error Smoke", type: "local_business" } });
  await prisma.user.create({ data: { id: userId } });
  await prisma.membership.create({
    data: { id: `lq-err-mem-${stamp}`, tenantId, userId, role: "owner", isActive: true }
  });
  await prisma.store.create({ data: { id: storeId, tenantId, name: "兰琪输入校验回归门店" } });

  const app = Fastify({ logger: false });
  await registerMomentRoutes(app, "/lanqi");
  const headers = sessionHeaders(tenantId, userId, { "content-type": "application/json" });

  try {
    // ===== 1. 快速模式：空原话必须是 422（不是 500）=====
    const emptyRaw = await app.inject({
      method: "POST",
      url: "/lanqi/moments/upgrade",
      headers,
      payload: { storeId, mode: "fast", raw: "", goal: "visit", tone: "亲切大姐", level: "std", keepMine: false }
    });
    assert(
      "快速模式空原话 → 422（不是 500）",
      emptyRaw.statusCode === 422,
      `status=${emptyRaw.statusCode} body=${emptyRaw.body.slice(0, 160)}`
    );
    assert("空原话回执码是输入类", emptyRaw.json().code === "invalid_moments_input", `code=${emptyRaw.json().code}`);
    assert(
      "空原话回显给老板的填表提示",
      emptyRaw.json().message === "请先写一句你的原话",
      `message=${emptyRaw.json().message}`
    );

    // ===== 2. 快速模式：原话不足 15 字 → 422 =====
    const tooShort = await app.inject({
      method: "POST",
      url: "/lanqi/moments/upgrade",
      headers,
      payload: { storeId, mode: "fast", raw: "太短了", goal: "visit", tone: "亲切大姐", level: "std", keepMine: false }
    });
    assert("快速模式原话不足 15 字 → 422", tooShort.statusCode === 422, `status=${tooShort.statusCode}`);
    assert(
      "不足 15 字提示可读（含字数口径）",
      typeof tooShort.json().message === "string" && tooShort.json().message.includes("至少 15 字"),
      `message=${tooShort.json().message}`
    );

    // ===== 3. 专业模式：没选七柱 → 422 =====
    const noPillar = await app.inject({
      method: "POST",
      url: "/lanqi/moments/upgrade",
      headers,
      payload: { storeId, mode: "pro", fields: { storeName: "本店" } }
    });
    assert("专业模式未选七柱 → 422", noPillar.statusCode === 422, `status=${noPillar.statusCode}`);
    assert(
      "未选七柱提示可读",
      String(noPillar.json().message ?? "").includes("请先选择内容类型"),
      `message=${noPillar.json().message}`
    );

    // ===== 4. 专业模式：缺必填 → 422 =====
    const missingField = await app.inject({
      method: "POST",
      url: "/lanqi/moments/upgrade",
      headers,
      payload: { storeId, mode: "pro", pillar: "work", fields: { storeName: "本店" } }
    });
    assert("专业模式缺必填 → 422", missingField.statusCode === 422, `status=${missingField.statusCode}`);
    assert(
      "缺必填点名了具体字段",
      String(missingField.json().message ?? "").includes("还差必填"),
      `message=${missingField.json().message}`
    );

    // ===== 5. 门店不存在：必须是 404，不能被当成输入错误或服务端故障 =====
    const foreignStore = await app.inject({
      method: "POST",
      url: "/lanqi/moments/upgrade",
      headers,
      payload: { storeId: "store-not-mine", mode: "fast", raw: "今天店里来了个客人，做了清洁护理，皮肤亮了不少。" }
    });
    assert("别人的门店 → 404", foreignStore.statusCode === 404, `status=${foreignStore.statusCode}`);

    // ===== 6. 防泄露：非输入类失败只说人话，不回显 Provider 串 =====
    // 只做判定层断言，避免在回归里真的打一次模型。
    const leaky = [
      "llm_provider_not_configured",
      "deepseek_provider_http_error",
      "llm_output_invalid_structure",
      "fetch failed ECONNRESET"
    ];
    assert(
      "Provider / 网络类错误不被判成输入类",
      leaky.every((message) => isMomentsInputError(message) === false),
      leaky.join(" / ")
    );
    for (const kind of ["moments", "wechat", "image"] as const) {
      const text = userFacingGenerationError(kind);
      assert(
        `对老板的失败文案（${kind}）不含模型/厂商串`,
        !LEAK_PATTERN.test(text) && text.length > 8,
        text
      );
    }

    // ===== 7. 契约守护：规则层真实抛出的每一条校验文案都必须被判成输入类 =====
    // 这条是给「以后再加一句校验提示、却忘了同步正则」准备的红灯：
    // 文案从真实函数里取，不在测试里复述常量。
    const thrown: string[] = [];
    const grab = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        if (error instanceof Error) thrown.push(error.message);
      }
    };
    const fastBase: MomentsUpgradeInput = { storeId: "s1", mode: "fast", goal: "visit", tone: "亲切大姐", level: "std" };
    grab(() => upgradeMoments({ ...fastBase, raw: "" }));
    grab(() => upgradeMoments({ ...fastBase, raw: "太短了" }));
    grab(() => upgradeMoments({ storeId: "s1", mode: "pro" }));
    grab(() => upgradeMoments({ storeId: "s1", mode: "pro", pillar: "problem", fields: { storeName: "本店" } }));
    grab(() => upgradeMoments({ ...fastBase, mode: "wechat" as unknown as MomentsUpgradeInput["mode"] }));
    grab(() => validateStoreScope({ ...fastBase, storeId: "  " }));
    grab(() => generateWechatGroup({ storeId: "s1", scene: "notice", detail: "   " }));
    // 违规引导词：直接过正则口径（这里不构造真实 Provider 输出）。
    thrown.push("生成内容包含违规引导词，请改写后重试");

    assert("规则层至少覆盖到 8 条校验文案", thrown.length >= 8, `count=${thrown.length}`);
    const unrecognized = thrown.filter((message) => !isMomentsInputError(message));
    assert(
      "每条规则层校验文案都被判成输入类（新增提示忘同步正则即红灯）",
      unrecognized.length === 0,
      unrecognized.length ? `漏判=${JSON.stringify(unrecognized)}` : `已覆盖 ${thrown.length} 条`
    );
    assert(
      "空原话文案确实在规则层里（不是测试自造）",
      thrown.includes(fastGate("") ?? "__never__"),
      `fastGate("")=${fastGate("")}`
    );
    assert(
      "缺必填文案确实由 missingRequired 派生",
      thrown.some((message) => message.startsWith("还差必填：") && missingRequired("work", { storeName: "本店" }).length === 1),
      `missing=${missingRequired("work", { storeName: "本店" }).map((f) => f.label).join("、")}`
    );
  } finally {
    await app.close();
    await prisma.store.deleteMany({ where: { tenantId } });
    await prisma.membership.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }

  console.log(`\nlanqi-moments-input-error-paths -> ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
