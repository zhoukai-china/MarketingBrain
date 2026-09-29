// AI 案例区块错位测量（2026-09-29 用户反馈「上面都错位了」）
const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox", "--no-proxy-server"] });
  for (const w of [1440, 1024, 430]) {
    const p = await b.newPage();
    await p.setViewport({ width: w, height: 1000 });
    await p.goto("http://localhost:5174/agents", { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(1500);
    // 切到 AI 案例视图
    await p.evaluate(() => {
      const el = Array.from(document.querySelectorAll("a,button,div")).find((x) => x.textContent?.trim() === "AI案例");
      if (el) el.click();
    });
    await sleep(900);
    const d = await p.evaluate(() => {
      const r = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return { x: Math.round(b.x), w: Math.round(b.width), padL: cs.paddingLeft, maxW: cs.maxWidth, ml: cs.marginLeft, mr: cs.marginRight };
      };
      const chips = Array.from(document.querySelectorAll(".eh-cv-chip"));
      return {
        head: r(".eh-cv-head"),
        headIn: r(".eh-cv-head-in"),
        title: r(".eh-cv-title"),
        titleB: r(".eh-cv-title b"),
        slogan: r(".eh-cv-slogan"),
        chipsWrap: r(".eh-cv-chips"),
        chip0: r(".eh-cv-chip"),
        chipLast: chips.length ? (() => { const b = chips[chips.length - 1].getBoundingClientRect(); return { t: chips[chips.length - 1].textContent, left: Math.round(b.left), right: Math.round(b.right) }; })() : null,
        wrap: r(".eh-cv-wrap"),
        card: r(".eh-case-card"),
        bodyScrollW: document.documentElement.scrollWidth,
        chipsScrollW: (() => { const c = document.querySelector(".eh-cv-chips"); return c ? { sw: c.scrollWidth, cw: c.clientWidth } : null; })()
      };
    });
    console.log(`\n===== viewport ${w} =====`);
    console.log(JSON.stringify(d, null, 1));
    await p.screenshot({ path: `${__dirname}/ai-cases-${w}.png`, clip: { x: 0, y: 0, width: w, height: Math.min(700, 1000) } });
    await p.close();
  }
  await b.close();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
