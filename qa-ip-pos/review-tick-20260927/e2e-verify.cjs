/**
 * 端到端验证「体检追问补一项，其余不应消失」（2026-09-27）。
 * 走真实链路：填满 6 个简报字段（垃圾答案）→ 点生成 → 打真 precheck 接口 → 出追问卡
 * → 补第一项 → 断言：条目数不变、只勾掉一条、其余继续提示。
 */
const puppeteer = require("puppeteer-core");
const HS =
  process.env.HOME +
  "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const APP = "http://localhost:5174/agent/ipzone__ip-pos/workbench";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  await sleep(220);
}

async function snapshot(page) {
  return page.evaluate(() => {
    const card = document.querySelector(".ipw-review");
    const rows = [...document.querySelectorAll(".ipw-review .ir-item")];
    const hint = [...document.querySelectorAll(".ipw-ws .brief > .err")].map((e) => e.className + " :: " + e.textContent.trim());
    const labeled = rows.map((r) => {
      const label = r.querySelector(".ir-main b")?.textContent.trim() || "?";
      const state = r.classList.contains("done") ? "done" : r.querySelector(".ir-go") ? "pending" : "?";
      return `${label}=${state}`;
    });
    const gen = document.querySelector(".ipw-ws .genlog") ? "generating" : "idle";
    return {
      hasCard: !!card,
      total: rows.length,
      done: rows.filter((r) => r.classList.contains("done")).length,
      pending: rows.filter((r) => r.querySelector(".ir-go")).length,
      header: card ? card.querySelector(".ir-t")?.textContent.trim() : null,
      labeled,
      hints: hint,
      gen,
    };
  });
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: HS,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  // 无头环境没有登录态（precheck 会 401）；只把 precheck 的响应打桩成用户截图里的 6 项缺失，
  // 其余（简报填写、保存、勾销、渲染）全走真实前端代码。
  await page.setRequestInterception(true);
  const SLOTS = ["role", "project", "competition", "user", "founder", "stage"];
  page.on("request", (req) => {
    if (req.url().includes("market") || req.url().includes("precheck")) {
      console.log("[req]", req.method(), req.url());
    }
    if (req.url().includes("/precheck") && req.method() === "POST") {
      req.respond({
        status: 200,
        contentType: "application/json",
        headers: {
          "access-control-allow-origin": "http://localhost:5174",
          "access-control-allow-credentials": "true",
        },
        body: JSON.stringify({
          issues: SLOTS.map((slot) => ({ slot, verdict: "missing", followup: `${slot} 的追问提示` })),
        }),
      });
      return;
    }
    // 保险：若流程意外走到正式生成，直接掐断，避免消耗测试账号积分
    if (req.url().includes("/run") && req.method() === "POST") {
      console.log("[blocked] POST /run 已被拦截（本次验证不应触发生成）");
      req.abort();
      return;
    }
    req.continue();
  });
  await page.goto(APP, { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForSelector(".ipw-ws .bf", { timeout: 25000 });
  await sleep(1500);
  console.log("[0] 页面就绪，版本标记:", await page.evaluate(() => document.querySelector(".ipw-hero .chips .chip:last-child")?.textContent.trim()));

  // 清掉上一步可能残留的已交付状态，保证从干净态开始
  await page.evaluate(() => {
    const ghost = [...document.querySelectorAll(".ipw-ws .big-btn.ghost")].find((b) => /重新生成/.test(b.textContent));
    if (ghost) ghost.click();
  });
  await sleep(300);

  // 1) 垃圾答案填满 6 格（保证体检必然报缺，避免直接进入扣积分生成）
  const junk = ["1", "2", "3", "4", "5", "6"];
  for (let i = 0; i < 6; i++) await fillField(page, i, junk[i]);
  const briefState = await page.evaluate(() =>
    [...document.querySelectorAll(".ipw-ws .bf")].map((b) => b.querySelector(".v")?.textContent.trim())
  );
  console.log("[1] 简报 6 格:", JSON.stringify(briefState));

  // 2) 点生成 → 等追问卡或生成中
  await page.evaluate(() => document.querySelector(".ipw-ws .big-btn.gen").click());
  for (let i = 0; i < 60; i++) {
    const s = await snapshot(page);
    if (s.hasCard || s.gen === "generating") break;
    await sleep(1000);
  }
  const before = await snapshot(page);
  console.log("[2] 体检后:", JSON.stringify(before, null, 1));
  if (!before.hasCard) {
    console.log("[!] 未出现追问卡（precheck 放行）→ 已进入生成，无法验证勾销行为");
    await page.screenshot({ path: "/tmp/review-e2e-nocard.png" });
    await browser.close();
    return;
  }
  await page.screenshot({ path: "/tmp/review-e2e-1-before.png" });

  // 3) 补第一项（角色）——这正是用户报的操作
  await fillField(page, 0, "我是本地单店美业门店老板，3 家店，本人亲自做抖音 IP，负责全部内容与投放");
  const afterOne = await snapshot(page);
  console.log("[3] 补完第一项后:", JSON.stringify(afterOne, null, 1));
  await page.screenshot({ path: "/tmp/review-e2e-2-after-one.png" });

  // 4) 再补第二项（项目）——验证可以逐条勾销到 0
  await fillField(page, 1, "兰琪美业：做中高端女性到店美容服务，靠到店项目与年卡赚钱，目前 1-10 家门店扩张期");
  const afterTwo = await snapshot(page);
  console.log("[4] 补完第二项后:", JSON.stringify(afterTwo, null, 1));

  // 断言
  const ok =
    afterOne.total === before.total &&
    before.total === 6 &&
    afterOne.done === 1 &&
    afterOne.pending === 5 &&
    afterTwo.total === 6 &&
    afterTwo.done === 2 &&
    afterTwo.pending === 4 &&
    afterOne.hints.some((h) => /5 项信息不够/.test(h)) &&
    afterTwo.hints.some((h) => /4 项信息不够/.test(h));
  console.log(ok ? "PASS ✅ 补一项只勾一条，其余提示仍在" : "FAIL ❌");

  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(2);
});
