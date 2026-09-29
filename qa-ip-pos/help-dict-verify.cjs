// 新手帮助 · 术语词典 与原型对齐核验（2026-09-29 用户反馈「和原型不一致」）
// 核验：8 条 / 术语与说明分行 / 标题左对齐挂小字 / 圆形关闭键 / 图标全为矢量 glyph（无 emoji）
//       窄屏底部抽屉（顶部圆角、贴底、可滚动）/ ≥700px 居中卡（四角圆角）
const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F2FF}]/u;

(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox", "--no-proxy-server"] });
  for (const w of [1440, 1024, 430]) {
    const p = await b.newPage();
    await p.setViewport({ width: w, height: 860 });
    await p.goto("http://localhost:5174/agents", { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(1200);
    // 点「新手帮助」打开词典
    const opened = await p.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((x) => x.textContent?.includes("新手帮助"));
      if (!btn) return false;
      btn.click();
      return true;
    });
    await sleep(700);
    const d = await p.evaluate((EMOJI_SRC) => {
      const re = new RegExp(EMOJI_SRC, "u");
      const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) }; };
      const q = (s) => document.querySelector(s);
      const sheet = q(".eco-sheet");
      const cs = sheet ? getComputedStyle(sheet) : null;
      const head = q(".eco-help-head");
      const items = Array.from(document.querySelectorAll(".eco-help-item"));
      const xBtn = q(".eco-sheet-x");
      const xs = xBtn ? getComputedStyle(xBtn) : null;
      const firstItem = items[0];
      const firstB = firstItem?.querySelector("b");
      const firstSpan = firstItem?.querySelector("span");
      const ib = firstItem ? getComputedStyle(firstItem) : null;
      const headCs = head ? getComputedStyle(head) : null;
      return {
        modalKind: { hasSheet: !!sheet, hasEcoDict: !!q(".eco-dict"), hasHelpList: !!q(".eco-help-list") },
        mask: (() => { const m = q(".eco-modal-mask"); const mc = m ? getComputedStyle(m) : null; return mc ? { alignContent: mc.alignContent, justifyContent: mc.justifyContent, padding: mc.padding, bodyOverflow: getComputedStyle(document.body).overflow } : null; })(),
        sheet: sheet ? {
          rect: rect(sheet),
          maxW: cs.maxWidth, maxH: cs.maxHeight, overflowY: cs.overflowY,
          radius: `${cs.borderTopLeftRadius}/${cs.borderBottomLeftRadius}`,
          borderBottomW: cs.borderBottomWidth,
          scrollable: sheet.scrollHeight > sheet.clientHeight + 1,
          sh: sheet.scrollHeight, ch: sheet.clientHeight
        } : null,
        head: head ? {
          rect: rect(head), textAlign: headCs.textAlign, fontSize: headCs.fontSize, fontWeight: headCs.fontWeight,
          hasSmall: !!head.querySelector("small"),
          smallText: head.querySelector("small")?.textContent?.trim(),
          smallFont: head.querySelector("small") ? getComputedStyle(head.querySelector("small")).fontSize : null,
          text: head.textContent.replace(/\s+/g, " ").trim().slice(0, 60)
        } : null,
        itemCount: items.length,
        itemTitles: items.map((it) => it.querySelector("b")?.textContent?.trim()),
        itemBgs: items.map((it) => it.querySelector("b")?.textContent?.trim()),
        firstItem: firstItem ? {
          rect: rect(firstItem), bg: ib.backgroundColor, border: ib.borderTopWidth + " " + ib.borderTopColor, radius: ib.borderTopLeftRadius, flexDir: ib.flexDirection, gap: ib.gap, padding: ib.padding,
          bRect: rect(firstB), spanRect: rect(firstSpan),
          bAboveSpan: firstB && firstSpan ? firstB.getBoundingClientRect().bottom <= firstSpan.getBoundingClientRect().top + 1 : null
        } : null,
        // 图标：全为 svg glyph，item 标题里不含 emoji
        glyphCount: document.querySelectorAll(".eco-help-item svg.eco-help-ic").length,
        headGlyphCount: document.querySelectorAll(".eco-help-head svg.eco-help-ic").length,
        emojiInTitles: items.filter((it) => re.test(it.querySelector("b")?.textContent?.replace(/[\u2000-\u206F]/g, "") ?? "")).map((it) => it.querySelector("b")?.textContent?.trim()),
        x: xBtn ? { rect: rect(xBtn), radius: xs.borderRadius, bg: xs.backgroundColor, fontSize: xs.fontSize } : null,
        note: q(".eco-help-note")?.textContent?.trim(),
        align: head && firstItem ? { headX: Math.round(head.getBoundingClientRect().x), itemX: Math.round(firstItem.getBoundingClientRect().x), itemBX: Math.round(firstB.getBoundingClientRect().x) } : null,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        bodyScrollW: document.documentElement.scrollWidth
      };
    }, EMOJI.source);
    console.log(`\n===== viewport ${w} (opened=${opened}) =====`);
    console.log(JSON.stringify(d, null, 1));
    await p.close();
  }
  await b.close();
})();
