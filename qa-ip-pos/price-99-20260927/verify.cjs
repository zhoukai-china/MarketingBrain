/**
 * 端到端验证「IP 定位工作台计价 400 积分 → 99 算力」（2026-09-27）。
 *
 * 走真实前端代码（真实 5174 页面 + 真实简报填写/费用行/交付头渲染），只打桩两个接口：
 *  - POST /market/skus/:skuId/precheck → 200 { issues: [] }（无登录态，直接放行生成）
 *  - POST /market/skus/:skuId/run      → 200 mock 交付（**绝不触碰真实模型、不扣真实算力**）
 * 断言：按钮/费用行/标签/交付头都显示 99 算力，且不再出现 400 积分；固定价徽标「失败不扣费」在。
 */
const puppeteer = require("puppeteer-core");
const HS =
  process.env.HOME +
  "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const APP = "http://localhost:5174/agent/ipzone__ip-pos/workbench";
const SHOT_DIR = "/Users/zhoukai/code/MarketingBrain/qa-ip-pos/price-99-20260927";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MOCK_PAYLOAD = {
  meta: { brand: "兰琪美业", industry: "美业", goal: "招商加盟", generatedAt: "2026-09-27" },
  overview: { project: "验证桩数据", user: "验证桩数据", persona: "验证桩数据", archetype: "验证桩数据", ip_status: "验证桩数据", content_focus: "验证桩数据", platform: "验证桩数据", month_actions: "验证桩数据" },
  stats: { topic_total: 82, by_type: { trust: 22, cognitive: 22, connection: 22, conversion: 16 } },
  validation: { passed: true, errors: [] },
  topics: { trust: ["t1"], cognitive: ["c1"], connection: ["n1"], conversion: ["v1"], top10: ["top1"], calendar30: ["d1"] },
  sections: { overview: "## 速览\n- 验证用", positioning: "## 一、项目定位\n- 验证用" },
};

async function setTextarea(page, value) {
  await page.evaluate((v) => {
    const ta = document.querySelector(".ipw-modal textarea");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, v);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function fillField(page, index, value) {
  await page.evaluate((i) => document.querySelectorAll(".ipw-ws .bf")[i].click(), index);
  await page.waitForSelector(".ipw-modal textarea", { timeout: 6000 });
  await setTextarea(page, value);
  await page.click(".im-btn.save");
  await sleep(200);
}

const readTexts = (page) =>
  page.evaluate(() => {
    const t = (sel) => document.querySelector(sel)?.textContent.replace(/\s+/g, " ").trim() ?? null;
    const promise = document.querySelector(".ipw-ws .ipw-promise");
    const promiseStyle = promise ? getComputedStyle(promise) : null;
    return {
      version: t(".ipw-hero .chips .chip:last-child"),
      heroAbility: t(".ipw-hero .ability"),
      genButton: t(".ipw-ws .big-btn.gen"),
      fee: t(".ipw-ws .fee"),
      promiseChip: promise ? promise.textContent.trim() : null,
      promiseBg: promiseStyle ? promiseStyle.backgroundColor : null,
      promiseColor: promiseStyle ? promiseStyle.color : null,
      placeholderTags: [...document.querySelectorAll(".ipw-ws .ph-note .tag")].map((e) => e.textContent.trim()),
      deliveredHead: t(".ipw-ws .dl-head .ok-tag"),
      deliveredTime: t(".ipw-ws .dl-head .time"),
      docTitle: document.title,
    };
  });

(async () => {
  const browser = await puppeteer.launch({
    executablePath: HS,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  // 清掉本机残留的已交付 payload，保证从「未生成」干净态开始
  await page.evaluateOnNewDocument(() => {
    try {
      Object.keys(localStorage)
        .filter((k) => k.includes("ip-pos") || k.includes("ip_pos"))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
  });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/precheck") && req.method() === "POST") {
      return req.respond({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "http://localhost:5174", "access-control-allow-credentials": "true" },
        body: JSON.stringify({ issues: [] }),
      });
    }
    if (url.includes("/run") && req.method() === "POST") {
      console.log("[stub] POST /run → 返回 mock 交付（不调用真实模型、不扣算力）");
      return req.respond({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "http://localhost:5174", "access-control-allow-credentials": "true" },
        body: JSON.stringify({ answer: "## 速览\n- 验证用", consumedCredits: 99, payload: MOCK_PAYLOAD }),
      });
    }
    if (req.method() === "OPTIONS") {
      return req.respond({
        status: 204,
        headers: {
          "access-control-allow-origin": "http://localhost:5174",
          "access-control-allow-credentials": "true",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "*",
        },
      });
    }
    req.continue();
  });

  await page.goto(APP, { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForSelector(".ipw-ws .bf", { timeout: 25000 });
  await sleep(1200);
  const idle = await readTexts(page);
  console.log("[1] 未生成态:", JSON.stringify(idle, null, 1));
  await page.screenshot({ path: `${SHOT_DIR}/1-未生成-99算力.png` });

  // 填满 6 格简报 → 允许生成
  for (let i = 0; i < 6; i++) await fillField(page, i, `验证用第 ${i + 1} 项：本地美业门店老板，3 家店自己做抖音 IP`);
  await page.evaluate(() => document.querySelector(".ipw-ws .big-btn.gen").click());
  for (let i = 0; i < 40; i++) {
    if (await page.$(".ipw-ws .dl-head")) break;
    await sleep(500);
  }
  await sleep(500);
  const done = await readTexts(page);
  console.log("[2] 已交付态:", JSON.stringify(done, null, 1));
  await page.screenshot({ path: `${SHOT_DIR}/2-已交付-99算力.png` });

  // 断言：三处价格文案都是 99 算力，且页面上不再出现「400 积分」
  const bodyText = await page.evaluate(() => document.body.innerText);
  const checks = {
    "按钮显示 99 算力": /生成定位全案 · 99 算力/.test(idle.genButton ?? ""),
    "未生成费用行 99 算力/次": /99 算力\/次/.test(idle.fee ?? ""),
    "未生成标签 99 算力": (idle.placeholderTags ?? []).includes("99 算力"),
    "交付费用行报本次交付 99 算力": /本次交付：定位全案 9 件（速览 \+ 8 章）· 99 算力/.test(done.fee ?? ""),
    "交付行实际消耗 99 算力": /实际消耗 99 算力/.test(done.deliveredTime ?? ""),
    "固定价徽标=失败不扣费": done.promiseChip === "🏅 失败不扣费",
    "徽标为绿底绿字": done.promiseBg === "rgb(230, 245, 238)" && done.promiseColor === "rgb(15, 138, 95)",
    "页面无 400 积分残留": !/400\s*积分/.test(bodyText),
    "版本标记已更新": /99算力/.test(idle.version ?? ""),
  };
  console.log("\n断言结果:");
  for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✅" : "❌"} ${k}`);
  const ok = Object.values(checks).every(Boolean);
  console.log(ok ? "\nPASS ✅ IP 定位工作台 = 99 算力（前后端口径一致）" : "\nFAIL ❌");
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(2);
});
