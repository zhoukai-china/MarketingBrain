/* 文案 / 直播工作台 · 自动演示冒烟
 * 每个工作台：进页 → 演示横幅出现 → 对话自动推进 → 演示期间不落草稿 → 停止 → 真实第 1 题出现且草稿开始落盘
 */
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const BASE = "http://127.0.0.1:5174";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const CASES = [
  { sku: "ipzone__copy", draft: "copy_chat_draft_ipzone__copy", q1: "这次给什么产品", name: "文案" },
  { sku: "ipzone__livescript", draft: "livescript_chat_draft_ipzone__livescript", q1: "这场直播是哪一种", name: "直播" }
];

(async () => {
  const token = await fetch("http://127.0.0.1:3011/auth/dev-login", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ productCode: "lanqi" })
  }).then((r) => r.json()).then((d) => d.token || "").catch(() => "");
  if (!token) { console.log("dev-login 失败"); process.exit(1); }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "demo-cl-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, userDataDir,
    args: ["--no-proxy-server", "--no-sandbox", "--disable-gpu"]
  });
  let allPass = true;

  for (const c of CASES) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(BASE + "/agents", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.evaluate((t, k) => {
      localStorage.setItem("store_os_token", t);
      localStorage.removeItem(k);
    }, token, c.draft);
    await page.goto(`${BASE}/agent/${c.sku}/workbench`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await wait(1600);

    const banner = await page.evaluate(() => Boolean(document.querySelector(".cpw-demo-bar")));
    const freeHint = await page.evaluate(() => (document.querySelector(".cpw-demo-bar")?.textContent || "").includes("不消耗算力"));
    const jargon = await page.evaluate(() => {
      const t = document.querySelector(".cpw-demo-bar")?.textContent || "";
      return t.includes("模拟数据") || t.includes("不调接口");
    });
    const c0 = await page.evaluate(() => document.querySelectorAll(".cpw-msg").length);
    await wait(9000);
    const c1 = await page.evaluate(() => document.querySelectorAll(".cpw-msg").length);
    const draftDuring = await page.evaluate((k) => localStorage.getItem(k) !== null, c.draft);

    await page.evaluate(() => { const b = document.querySelector(".cpw-demo-stop"); if (b) b.click(); });
    await wait(1200);
    const gone = await page.evaluate(() => !document.querySelector(".cpw-demo-bar"));
    const q1 = await page.evaluate((q) => document.body.innerText.includes(q), c.q1);
    await wait(2600);
    const draftAfter = await page.evaluate((k) => localStorage.getItem(k) !== null, c.draft);

    const pass = banner && freeHint && !jargon && c1 > c0 && !draftDuring && gone && q1 && draftAfter;
    console.log(`[${c.name}] 横幅:${banner ? "✓" : "✗"}｜含「不消耗算力」:${freeHint ? "✓" : "✗"}｜无内部术语:${jargon ? "✗" : "✓"}｜消息推进 ${c0}→${c1}:${c1 > c0 ? "✓" : "✗"}｜演示中不落草稿:${draftDuring ? "✗" : "✓"}`);
    console.log(`[${c.name}] 停止后横幅消失:${gone ? "✓" : "✗"}｜真实第 1 题:${q1 ? "✓" : "✗"}｜停止后落草稿:${draftAfter ? "✓" : "✗"} → ${pass ? "PASS" : "FAIL"}`);
    if (!pass) allPass = false;
    await page.close();
  }

  await browser.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  console.log(allPass ? "ALL PASS" : "HAS FAIL");
  process.exit(allPass ? 0 : 1);
})();
