/**
 * 「我的 - 历史交付物 - 下载 Word」回归（2026-09-16 客户现场）。
 *
 * 现场：客户在「我的」产物卡点「下载 Word」，什么都没下载下来（弹一句英文报错）。
 *
 * 根因（真实浏览器复现，逐字证据见 docs/BUG_REGRESSIONS.md QA-20260916-010）：
 * MinePage 的下载请求同时给了两份同名请求头——`authHeaders(true)` 里的 `Content-Type`
 * 和页面自己又补的 `content-type`。浏览器按规范把同名头合并成
 * `content-type: application/json, application/json`，服务端 Fastify 无法识别这个媒体类型，
 * 直接 415 `Unsupported Media Type: application/json, application/json`，导出根本没生成。
 *
 * 本脚本不写死「页面应该长什么样」，而是**把线上真正在用的那段源码取出来执行**：
 *   ① 从 `shell.tsx` 取 `authHeaders` 函数体，从 `MinePage.tsx` 取下载请求的 headers 表达式；
 *   ② 用浏览器同款 `Headers` 归一化，断言最终只有一份 content-type 且值恰好是 `application/json`；
 *   ③ 把这份「浏览器真正会发出去的头」打到真实 Fastify 导出路由上，断言 200 + 无头 GET 能拿到 docx。
 *
 * 修复前 ①②③ 全红（② 得到 `application/json, application/json`，③ 得到 415）；修复后全绿。
 * 只有会员存储是合成夹具；钱包/账本写进本地开发库，跑完按 id 级联删除；不碰 Provider、不碰生产。
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import { prisma } from "../packages/db/src/index.js";
import { EXPORT_PRICING } from "../packages/shared/src/index.js";
import { env } from "../apps/api/src/config/env.js";
import { createSessionToken } from "../apps/api/src/services/auth-token.js";
import { registerExportRoutes } from "../apps/api/src/routes/exports.js";

const webSrcRoot = resolve("apps/web/src");
const syntheticUserId = "mine-docx-smoke-user";
const syntheticTenantId = "mine-docx-smoke-tenant";
const initialCredits = 100;
const report: Record<string, unknown>[] = [];

/** 取「我的」页里真正在用的下载请求 headers 表达式（不是测试自己写一份）。 */
async function readDownloadHeadersExpression(): Promise<{ expression: string; fnSource: string }> {
  const source = await readFile(join(webSrcRoot, "marketplace", "MinePage.tsx"), "utf8");
  const start = source.indexOf("async function downloadDeliverable");
  assert.ok(start >= 0, "MinePage.tsx 里找不到 downloadDeliverable：产物下载入口改名了，请同步本回归脚本");
  // 函数体到下一个成员声明之间为止（`const [loading, setLoading]` 是紧跟其后的成员）。
  const end = source.indexOf("const [loading, setLoading]", start);
  assert.ok(end > start, "无法确定 downloadDeliverable 的函数体范围（本回归脚本需要同步）");
  const fnSource = source.slice(start, end);
  assert.ok(/\/exports\/docx/.test(fnSource), "downloadDeliverable 必须打真实导出接口 /exports/docx");
  const matched = fnSource.match(/headers:\s*([\s\S]*?),\s*\n\s*body:/);
  assert.ok(matched, "downloadDeliverable 里找不到 headers 表达式（本回归脚本需要同步）");
  return { expression: matched[1].trim(), fnSource };
}

interface StorageLike {
  getItem(key: string): string | null;
}

/** 取 shell.tsx 的 authHeaders 真实函数体（剥掉 TS 注解后当 JS 执行，localStorage 作为参数注入）。 */
async function readAuthHeadersFactory(): Promise<(store: StorageLike) => (json?: boolean) => Record<string, string>> {
  const source = await readFile(join(webSrcRoot, "marketplace", "shell.tsx"), "utf8");
  const matched = source.match(/export function authHeaders\(json = false\): Record<string, string> \{([\s\S]*?)\n\}/);
  assert.ok(matched, "shell.tsx 里找不到 authHeaders：请同步本回归脚本");
  const body = matched[1];
  // 函数体里不能出现 TS 注解（出现了说明写法变了，本脚本需要同步而不是静默放过）。
  assert.ok(!/:\s*(Record|string|number)\b/.test(body), "authHeaders 函数体出现 TS 注解，本回归脚本需要同步");
  // 把真函数体重新装回一个具名函数，`localStorage` 以参数注入（浏览器里它是全局）。
  return new Function("localStorage", `return function authHeaders(json = false) {${body}}`) as (
    store: StorageLike
  ) => (json?: boolean) => Record<string, string>;
}

/** 全仓守卫：fetch 的 headers 里同时出现 authHeaders(true)（自带 Content-Type）与另一种大小写的 content-type。 */
async function listWebSources(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listWebSources(full)));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

async function checkNoDuplicateContentTypeHeaders(): Promise<void> {
  const violations: string[] = [];
  for (const file of await listWebSources(webSrcRoot)) {
    const source = await readFile(file, "utf8");
    for (const literal of source.match(/\{[^{}]*authHeaders\(\s*true\s*\)[^{}]*\}/g) ?? []) {
      if (/"content-type"/.test(literal)) violations.push(`${file}: ${literal.replace(/\s+/g, " ").trim()}`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    "authHeaders(true) 已经带了 Content-Type，再补一个小写 content-type 会被浏览器合并成“application/json, application/json” → 服务端 415"
  );
  console.log(JSON.stringify({ stage: "repo_guard", duplicatedContentTypeHeaders: 0 }));
}

async function main(): Promise<void> {
  const saved = { DATA_MODE: env.DATA_MODE, JWT_SECRET: env.JWT_SECRET };
  const originalFind = prisma.membership.findFirst;
  const originalFetch = globalThis.fetch;
  try {
    // 先切到本地库 + 合成密钥，再签发会话 token：token 的签名密钥必须和校验时一致。
    Object.assign(env, { DATA_MODE: "database", JWT_SECRET: "synthetic-mine-docx-test-secret-never-deployed" });
    // ---------- ① 源码取真 + 头归一化 ----------
    const makeAuthHeaders = await readAuthHeadersFactory();
    const { expression, fnSource } = await readDownloadHeadersExpression();
    const token = createSessionToken({ userId: syntheticUserId, tenantId: syntheticTenantId });
    const localStorageStub: StorageLike = { getItem: (key: string) => (key === "store_os_token" ? token : null) };
    const authHeaders = makeAuthHeaders(localStorageStub);
    const buildHeaders = new Function("authHeaders", `return (${expression});`) as (
      auth: (json?: boolean) => Record<string, string>
    ) => Record<string, string>;
    const init = buildHeaders(authHeaders);

    // 浏览器同款归一化：同名头会被合并成“值1, 值2”。
    const browserHeaders = new Headers(init);
    const contentTypeEntries = [...browserHeaders.entries()].filter(([key]) => key === "content-type");
    assert.equal(
      contentTypeEntries.length,
      1,
      `下载请求只能带一份 content-type（页面 headers 表达式：${expression}），实际 ${JSON.stringify(contentTypeEntries)}`
    );
    const sentContentType = contentTypeEntries[0][1];
    assert.equal(
      sentContentType,
      "application/json",
      `「我的-产物-下载 Word」的 content-type 必须是 application/json，实际「${sentContentType}」——` +
        "浏览器会把重复同名头合并成“application/json, application/json”，服务端直接 415 Unsupported Media Type，客户点下载没有任何反应"
    );
    assert.ok(browserHeaders.get("authorization")?.startsWith("Bearer "), "下载请求必须带会话 Authorization 头");
    console.log(JSON.stringify({ stage: "headers", expression, contentType: sentContentType }));

    // 失败路径必须是中文人话：401/403（会话失效）与 415（请求被拒）不能把服务端英文原文直接甩给客户。
    assert.match(fnSource, /415/, "下载失败路径必须显式处理 415，并给中文说明");
    assert.match(fnSource, /handleStaleSession\(|401|403/, "下载失败路径必须处理会话失效（401/403）");
    assert.match(fnSource, /导出失败/, "下载失败路径必须有中文兜底文案");

    await checkNoDuplicateContentTypeHeaders();

    // ---------- ② 真实路由端到端 ----------
    (prisma.membership as unknown as { findFirst: unknown }).findFirst = async ({ where }: { where: { tenantId: string; userId: string } }) => ({
      tenantId: where.tenantId,
      userId: where.userId,
      role: "owner",
      tenant: {
        id: where.tenantId,
        name: "合成验收主体",
        type: "local_business",
        industry: "beauty-industry",
        city: null,
        profile: { confirmedData: {} },
        creditAccount: { balance: initialCredits },
        subscriptions: []
      }
    });
    let externalCalls = 0;
    globalThis.fetch = async () => {
      externalCalls += 1;
      throw new Error("Network forbidden in docx download smoke");
    };
    await prisma.user.deleteMany({ where: { id: syntheticUserId } });
    await prisma.user.create({ data: { id: syntheticUserId } });
    await prisma.wallet.create({ data: { userId: syntheticUserId, paidBalance: initialCredits } });

    const app = Fastify({ disableRequestLogging: true });
    await registerExportRoutes(app);
    const payload = {
      title: "历史交付物-IP定位智能体",
      content: "# 探针交付物\n\n一、结论\n这份内容用于确认「我的-产物」能真的拿到 Word。"
    };
    // 用①算出来的「浏览器真正会发出去的头」，不做任何人工修正——修复前这里就是 415。
    const requestHeaders = Object.fromEntries(browserHeaders.entries());
    const created = await app.inject({ method: "POST", url: "/exports/docx", headers: requestHeaders, payload });
    assert.equal(
      created.statusCode,
      200,
      `「我的-产物-下载 Word」必须 200，实际 ${created.statusCode}：${created.body.slice(0, 200)}`
    );
    const createdBody = created.json() as { downloadUrl: string; consumedCredits: number; balance: number; filename: string };
    assert.equal(createdBody.consumedCredits, EXPORT_PRICING.docxCredits, "首次下载仍按次扣 10 积分");
    assert.equal(createdBody.balance, initialCredits - EXPORT_PRICING.docxCredits, "扣费后余额按次递减");
    assert.match(createdBody.downloadUrl, /^\/exports\/docx\/[\w-]+\?t=/, "下载链接必须带一次性令牌（浏览器导航带不了 Authorization）");
    report.push({ stage: "post_docx", status: created.statusCode, credits: createdBody.consumedCredits, balance: createdBody.balance });

    // 浏览器导航那一步：不带任何头，只靠 ?t= 令牌。
    const downloaded = await app.inject({ method: "GET", url: createdBody.downloadUrl });
    assert.equal(downloaded.statusCode, 200, `无头导航下载必须 200，实际 ${downloaded.statusCode}：${downloaded.body.slice(0, 200)}`);
    assert.equal(downloaded.rawPayload.subarray(0, 2).toString(), "PK", "拿到的必须是真正的 docx（zip 魔数 PK）");
    assert.match(String(downloaded.headers["content-type"]), /wordprocessingml/, "下载响应必须是 Word 内容类型");
    assert.match(String(downloaded.headers["content-disposition"]), /attachment/, "下载响应必须触发浏览器下载");
    report.push({ stage: "browser_navigation_download", status: downloaded.statusCode, bytes: downloaded.rawPayload.length });

    // 「不应发生」：连点两次不能重复扣费。
    const second = await app.inject({ method: "POST", url: "/exports/docx", headers: requestHeaders, payload });
    assert.equal(second.statusCode, 200);
    const secondBody = second.json() as { consumedCredits: number; balance: number; redownload: boolean };
    assert.equal(secondBody.redownload, true, "同一份内容重复下载必须识别为重下");
    assert.equal(secondBody.consumedCredits, 0, "重复下载不得再扣积分（同一份内容指纹幂等）");
    assert.equal(secondBody.balance, initialCredits - EXPORT_PRICING.docxCredits, "重复下载后余额不得再变");
    report.push({ stage: "second_click", redownload: secondBody.redownload, credits: secondBody.consumedCredits, balance: secondBody.balance });

    // 会话失效：中文人话 + 不生成文件。
    const unauthorized = await app.inject({ method: "POST", url: "/exports/docx", headers: { ...requestHeaders, authorization: "Bearer invalid" }, payload });
    assert.equal(unauthorized.statusCode, 401);
    assert.match(unauthorized.json().message as string, /登录/, "401 必须给中文人话");
    assert.equal(externalCalls, 0, "本回归不得访问任何外部网络");

    await app.close();
    for (const row of report) console.log(JSON.stringify(row));
    console.log(JSON.stringify({ status: "PASS", docxDownload: "我的-产物-下载 Word 可真实拿到 docx", providerCalls: 0, externalCalls }));
  } finally {
    await prisma.user.deleteMany({ where: { id: syntheticUserId } }).catch(() => undefined);
    Object.assign(env, saved);
    (prisma.membership as unknown as { findFirst: unknown }).findFirst = originalFind;
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
