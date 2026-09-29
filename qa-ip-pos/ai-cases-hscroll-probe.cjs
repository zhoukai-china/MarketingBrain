const puppeteer = require("puppeteer-core");
const HS = "/Users/zhoukai/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const VIEWS = [1440, 1280, 1180, 1024, 768, 430, 390];

(async () => {
  const b = await puppeteer.launch({
    executablePath: HS,
    headless: true,
    args: ["--no-sandbox", "--no-proxy-server", "--disable-gpu"],
  });
  for (const w of VIEWS) {
    const p = await b.newPage();
    await p.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
    try {
      await p.goto("http://127.0.0.1:5174/agents", { waitUntil: "networkidle2", timeout: 30000 });
      // 切到「AI案例」tab（底部 tabbar 第二个 .eh-tab）
      await p.waitForSelector(".eh-tabbar .eh-tab", { timeout: 15000 });
      await p.evaluate(() => {
        const tabs = Array.from(document.querySelectorAll(".eh-tabbar .eh-tab"));
        const t = tabs.find((x) => /AI案例|案例/.test(x.textContent || "")) || tabs[1];
        if (t) t.click();
      });
      await p.waitForSelector(".eh-cases-view", { timeout: 15000 });
      await p.evaluate(() => {
        const el = document.querySelector(".eh-cases-view");
        if (el) el.scrollIntoView({ block: "center" });
      });
      await new Promise((r) => setTimeout(r, 500));
      const data = await p.evaluate((vw) => {
        const de = document.documentElement;
        const sw = de.scrollWidth, iw = window.innerWidth;
        const offenders = [];
        const root = document.querySelector(".eh-cases-view") || document.body;
        const all = root.querySelectorAll("*");
        for (const e of all) {
          const r = e.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > vw + 1.5 || r.left < -1.5) {
            offenders.push({
              tag: e.tagName.toLowerCase(),
              cls: (e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className || "").toString().slice(0, 60),
              left: Math.round(r.left * 10) / 10,
              right: Math.round(r.right * 10) / 10,
              w: Math.round(r.width * 10) / 10,
            });
          }
        }
        // 只看前 12 个、去重相近
        const seen = new Set();
        const uniq = [];
        for (const o of offenders) {
          const k = o.cls + "|" + o.left;
          if (seen.has(k)) continue;
          seen.add(k); uniq.push(o);
          if (uniq.length >= 12) break;
        }
        const head = document.querySelector(".eh-cv-head");
        const headRect = head ? head.getBoundingClientRect() : null;
        const appWrap = document.querySelector(".app-wrap");
        const aw = appWrap ? getComputedStyle(appWrap) : null;
        return {
          scrollW: sw, innerW: iw, overflow: sw > iw + 1,
          appWrapOverflowX: aw ? aw.overflowX : "n/a",
          headLeft: headRect ? Math.round(headRect.left * 10) / 10 : null,
          headRight: headRect ? Math.round(headRect.right * 10) / 10 : null,
          offenders: uniq,
        };
      }, w);
      console.log(`\n===== viewport ${w} =====`);
      console.log(JSON.stringify(data, null, 2));
    } catch (e) {
      console.log(`\n===== viewport ${w} ERROR =====`);
      console.log(e.message);
    }
    await p.close();
  }
  await b.close();
})();
