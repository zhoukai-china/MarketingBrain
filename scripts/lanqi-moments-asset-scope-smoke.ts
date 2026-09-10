/**
 * 兰琪私域营销 · 配图资产「作用域一致性」回归。
 *
 * 锁的是一条对外可见的契约：
 *   配图接口（POST {scope}/moments/image）返回的 `asset.url`，
 *   必须能被客户端在**同一个产品作用域**下取回。
 *
 * 为什么必须有这条回归：
 * 兰琪前端拿到的 url 若仍硬编码成 `/beauty-industry/moments/assets/{id}`，
 * 就会落到「美业单品」作用域。`apps/api/src/server.ts` 给该作用域挂了
 * `requireProductEntitlement("beauty-industry")`，兰琪租户没有该 entitlement，
 * 于是取图必然 403；前端 `fetch(...).blob()` 不校验状态码，把 JSON 错误体当成
 * 图片塞进 `<img>`，用户看到的就是破图（WorkBuddy 2026-09-10 报告「AI 配图没有正常生成」）。
 *
 * 本用例用注入的假 entitlement 钩子复刻 `server.ts` 的作用域组合，因此：
 *   - 修复前：返回的 url 以 `/beauty-industry/` 开头 → 断言 1 失败；
 *   - 修复后：返回的 url 以 `/lanqi/` 开头，且同作用域取回 200 + 真 PNG。
 *
 * 需要本地数据库（与 billing-consume-db-smoke 同级别的前置条件），
 * 不需要任何模型调用：命中幂等键的既有资产会短路返回。
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import { prisma } from "../apps/api/node_modules/@baolu/db/dist/index.js";
import { registerMomentRoutes } from "../apps/api/src/routes/moments.js";
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

// 1x1 透明 PNG，仅用于证明取回的是真图片字节。
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const uploadsRoot = path.resolve(process.env.UPLOAD_DIR || "uploads");

async function main(): Promise<void> {
  const stamp = randomUUID();
  const tenantId = `lq-img-a-${stamp}`;
  const tenantBId = `lq-img-b-${stamp}`;
  const userId = `lq-img-user-${stamp}`;
  const userBId = `lq-img-userb-${stamp}`;
  const storeId = `lq-img-store-${stamp}`;
  const storeBId = `lq-img-storeb-${stamp}`;
  const assetId = randomUUID();
  const externalKey = `asset-scope-${stamp}`;
  const requestKey = `moments-image:${tenantId}:${externalKey}`;
  const caption = "今天店里发生了什么｜到店";
  const assetDir = path.join(uploadsRoot, "moments", tenantId);
  const assetFile = path.join(assetDir, `${assetId}.png`);

  await prisma.tenant.create({ data: { id: tenantId, name: "Lanqi Image Scope Smoke", type: "local_business" } });
  await prisma.tenant.create({ data: { id: tenantBId, name: "Lanqi Image Scope Smoke B", type: "local_business" } });
  await prisma.user.create({ data: { id: userId } });
  await prisma.user.create({ data: { id: userBId } });
  await prisma.membership.create({
    data: { id: `lq-img-mem-${stamp}`, tenantId, userId, role: "owner", isActive: true }
  });
  await prisma.membership.create({
    data: { id: `lq-img-memb-${stamp}`, tenantId: tenantBId, userId: userBId, role: "owner", isActive: true }
  });
  await prisma.store.create({ data: { id: storeId, tenantId, name: "兰琪配图回归门店" } });
  await prisma.store.create({ data: { id: storeBId, tenantId: tenantBId, name: "兰琪配图回归门店B" } });
  await mkdir(assetDir, { recursive: true });
  await writeFile(assetFile, PNG_1X1);
  await prisma.lanqiMomentAsset.create({
    data: {
      id: assetId,
      tenantId,
      userId,
      storeId,
      requestKey,
      kind: "image",
      name: caption,
      url: `/beauty-industry/moments/assets/${assetId}`,
      status: "succeeded"
    }
  });

  const lanqiApp = Fastify({ logger: false });
  await registerMomentRoutes(lanqiApp, "/lanqi");

  // 复刻 server.ts：美业单品作用域整体挂 entitlement 钩子；兰琪租户没有该 entitlement。
  const beautyApp = Fastify({ logger: false });
  beautyApp.addHook("preHandler", async (_request, reply) => {
    reply.code(403).send({ code: "product_not_entitled", message: "当前工作区未开通该产品" });
  });
  await registerMomentRoutes(beautyApp, "/beauty-industry");

  const headers = sessionHeaders(tenantId, userId, { "content-type": "application/json" });
  const headersB = sessionHeaders(tenantBId, userBId, { "content-type": "application/json" });

  try {
    // ===== 1. 兰琪作用域请求配图：命中幂等键，不触发模型调用 =====
    const created = await lanqiApp.inject({
      method: "POST",
      url: "/lanqi/moments/image",
      headers,
      payload: { storeId, caption, requestKey: externalKey }
    });
    assert("兰琪作用域配图接口 200", created.statusCode === 200, `status=${created.statusCode} body=${created.body.slice(0, 160)}`);
    const asset = (created.json() as { asset?: { assetId?: string; url?: string } }).asset ?? {};
    assert("命中幂等键时复用既有资产", asset.assetId === assetId, `assetId=${asset.assetId}`);

    // 核心断言：返回的 url 必须跟请求所用作用域一致（修复前这里是 /beauty-industry/...）
    assert(
      "返回的 asset.url 属于兰琪作用域",
      typeof asset.url === "string" && asset.url.startsWith("/lanqi/moments/assets/"),
      `url=${asset.url}`
    );

    // ===== 2. 客户端拿到的 url 必须真能取回图片 =====
    const fetched = await lanqiApp.inject({ method: "GET", url: String(asset.url), headers });
    assert("同作用域取回资产 200", fetched.statusCode === 200, `status=${fetched.statusCode}`);
    assert("取回内容是图片", fetched.headers["content-type"] === "image/png", `content-type=${fetched.headers["content-type"]}`);
    assert("取回的是真 PNG 字节", fetched.rawPayload.subarray(0, 8).equals(PNG_1X1.subarray(0, 8)), `bytes=${fetched.rawPayload.length}`);

    // ===== 3. 复刻线上 403：硬编码的旧路径为什么取不回来 =====
    const viaBeauty = await beautyApp.inject({ method: "GET", url: `/beauty-industry/moments/assets/${assetId}`, headers });
    assert("美业单品作用域对兰琪租户 403", viaBeauty.statusCode === 403, `status=${viaBeauty.statusCode}`);

    // ===== 4. 租户隔离：别的租户取不到 =====
    const crossTenant = await lanqiApp.inject({ method: "GET", url: `/lanqi/moments/assets/${assetId}`, headers: headersB });
    assert("跨租户取图 404", crossTenant.statusCode === 404, `status=${crossTenant.statusCode}`);

    // ===== 5. 未登录取图：不得返回图片 =====
    // 精确的 401 由 server.ts 的全局鉴权钩子给出（内测实例已实测 401），
    // 这里只锁「没有身份就拿不到字节」。
    const anonymous = await lanqiApp.inject({ method: "GET", url: `/lanqi/moments/assets/${assetId}` });
    assert(
      "未登录取图拿不到图片",
      anonymous.statusCode !== 200 && anonymous.headers["content-type"] !== "image/png",
      `status=${anonymous.statusCode}`
    );
  } finally {
    await lanqiApp.close();
    await beautyApp.close();
    await prisma.lanqiMomentAsset.deleteMany({ where: { tenantId: { in: [tenantId, tenantBId] } } });
    await prisma.store.deleteMany({ where: { tenantId: { in: [tenantId, tenantBId] } } });
    await prisma.membership.deleteMany({ where: { tenantId: { in: [tenantId, tenantBId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, tenantBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, userBId] } } });
    await rm(assetDir, { recursive: true, force: true });
  }

  console.log(`\nlanqi-moments-asset-scope -> ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
