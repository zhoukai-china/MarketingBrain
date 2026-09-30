/* IP定位工作台 · 自动演示模式验收
 * A：进页 → 演示横幅出现 → 对话自动推进 → 演示不落草稿 → 点「停止演示」→ 真实访谈第 1 题出现且草稿开始落盘
 * B：全新进页 → 等演示完整走完 → 出现「演示完成」+ 交付区 9 件 → 点停止 → 回真实访谈
 */
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const BASE = "http://127.0.0.1:5174";
const WORKBENCH = BASE + "/agent/ipzone__ip-pos/workbench";
const DRAFT_KEY = "ippos_chat_draft_ipzone__ip-pos";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const token = await fetch(BASE.replace("5174", "3011") + "/auth/dev-login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ productCode: "lanqi" })
  }).then((r) => r.json()).then((d) => d.token || "").catch(() => "");
  if (!token) { console.log("dev-login 失败"); process.exit(1); }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ippos-demo-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, userDataDir,
    args: ["--no-proxy-server", "--no-sandbox", "--disable-gpu"]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });

  const clearAndOpen = async () => {
    await page.goto(BASE + "/agents", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.evaluate((t) => {
      localStorage.setItem("store_os_token", t);
      localStorage.removeItem("ippos_chat_draft_ipzone__ip-pos");
      localStorage.removeItem("sitong_ippos_payload_ipzone__ip-pos");
    }, token);
    await page.goto(WORKBENCH, { waitUntil: "domcontentloaded", timeout: 45000 });
    await wait(1200);
  };

  /* ---------- A：演示启动 + 中途停止接管 ---------- */
  await clearAndOpen();
  const banner0 = await page.evaluate(() => Boolean(document.querySelector(".cpw-demo-bar")));
  const stopBtn = await page.evaluate(() => {
    const b = document.querySelector(".cpw-demo-stop");
    return b ? b.textContent.trim() : null;
  });

  // 演示自动推进：15 秒内消息应持续增长
  const c0 = await page.evaluate(() => document.querySelectorAll(".cpw-msg").length);
  await wait(9000);
  const c1 = await page.evaluate(() => document.querySelectorAll(".cpw-msg").length);
  const draftDuringDemo = await page.evaluate((k) => localStorage.getItem(k) !== null, DRAFT_KEY);

  // 中途停止（约第 2-3 题时）
  await page.evaluate(() => { const b = document.querySelector(".cpw-demo-stop"); if (b) b.click(); });
  await wait(900);
  const bannerGone = await page.evaluate(() => !document.querySelector(".cpw-demo-bar"));
  const realQ1 = await page.evaluate(() => document.body.innerText.includes("先确认一下——你是老板本人"));
  await wait(2500);
  const draftAfterStop = await page.evaluate((k) => localStorage.getItem(k) !== null, DRAFT_KEY);

  const partA = banner0 && !!stopBtn && c1 > c0 && !draftDuringDemo && bannerGone && realQ1 && draftAfterStop;
  console.log(`[A] 横幅:${banner0 ? "✓" : "✗"}｜停止按钮:"${stopBtn}"｜消息推进 ${c0}→${c1}:${c1 > c0 ? "✓" : "✗"}｜演示中不落草稿:${draftDuringDemo ? "✗泄漏!" : "✓"}`);
  console.log(`[A] 停止后横幅消失:${bannerGone ? "✓" : "✗"}｜真实 Q1 出现:${realQ1 ? "✓" : "✗"}｜停止后草稿开始落盘:${draftAfterStop ? "✓" : "✗"}`);
  console.log("[A]", partA ? "PASS" : "FAIL");

  /* ---------- B：完整演示到交付 ---------- */
  await clearAndOpen();
  let demoDone = false, piecesShown = false, noApiLeak = true;
  const reqs = [];
  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("/interview-hints") || u.includes("/precheck") || u.includes("/run") || u.includes("/industry-hotspots")) reqs.push(u);
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 95000) {
    const st = await page.evaluate(() => ({
      done: document.body.innerText.includes("演示完成"),
      pieces: document.querySelectorAll(".cpw-pc").length,
      doneCls: document.querySelectorAll(".cpw-pc").length
    })).catch(() => ({ done: false, pieces: 0, doneCls: 0 }));
    if (st.done && st.pieces >= 9) { demoDone = true; piecesShown = true; break; }
    if (false && Math.round((Date.now() - t0) / 1000) % 15 === 0) {
      const dbg = await page.evaluate(() => ({
        msgs: document.querySelectorAll(".cpw-msg").length,
        last: (Array.from(document.querySelectorAll(".cpw-bub")).pop()?.textContent || "").slice(0, 60).replace(/\s+/g, " "),
        st: document.querySelector(".cpw-st")?.textContent || "",
        ph: document.querySelectorAll(".cpw-pc").length,
        phDone: document.querySelectorAll(".cpw-pc").length
      })).catch((e) => ({ err: String(e).slice(0, 80) }));
      console.log(`  [${Math.round((Date.now() - t0) / 1000)}s]`, JSON.stringify(dbg));
    }
    await wait(1200);
  }
  const draftAfterFull = await page.evaluate((k) => localStorage.getItem(k) !== null, DRAFT_KEY);
  const stopB = await page.evaluate(() => { const b = document.querySelector(".cpw-demo-stop"); if (b) b.click(); return true; });
  await wait(900);
  const realQ1AfterFull = await page.evaluate(() => document.body.innerText.includes("先确认一下——你是老板本人"));

  console.log(`[B] 完整演到交付（9 件点亮）:${demoDone && piecesShown ? "✓" : "✗"}｜全程演示不落草稿:${draftAfterFull ? "✗泄漏!" : "✓"}｜演示期间业务接口调用数:${reqs.length}${reqs.length === 0 ? " ✓" : " ✗泄漏!"}`);
  console.log(`[B] 演完点停止 → 真实 Q1:${realQ1AfterFull ? "✓" : "✗"}｜停止按钮可用:${stopB ? "✓" : "✗"}`);
  const partB = demoDone && piecesShown && !draftAfterFull && reqs.length === 0 && realQ1AfterFull;
  console.log("[B]", partB ? "PASS" : "FAIL");

  await browser.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  console.log(partA && partB ? "ALL PASS" : "HAS FAIL");
  process.exit(partA && partB ? 0 : 1);
})();
