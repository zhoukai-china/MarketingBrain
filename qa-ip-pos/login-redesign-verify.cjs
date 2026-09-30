const puppeteer = require("puppeteer-core");
const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const BASE = "http://127.0.0.1:5174";

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ["--no-proxy-server", "--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1200));

  const lum = (c) => {
    const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return null;
    const [r, g, b] = [+m[1], +m[2], +m[3]].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const data = await page.evaluate(() => {
    const lum = (c) => {
      const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return null;
      const [r, g, b] = [+m[1], +m[2], +m[3]].map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const wall = document.querySelector(".loginHeroWall");
    const card = document.querySelector(".loginCard");
    const vw = window.innerWidth;
    const box = (el) => (el ? el.getBoundingClientRect() : null);
    const txt = (s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : ""; };
    const cs = (s, p) => { const e = document.querySelector(s); return e ? getComputedStyle(e)[p] : ""; };
    const risky = [];
    const effBg = (el) => {
      const layers = []; let node = el; let base = null;
      while (node && node !== document.documentElement) {
        const s = getComputedStyle(node);
        if (s.backgroundImage && s.backgroundImage !== "none") {
          if (node.classList.contains("loginHeroWall")) base = [244, 240, 232];
          else if (node.classList.contains("lhw-mark") || node.classList.contains("loginSubmit")) base = [30, 24, 20];
          else if (node.classList.contains("wechatLoginBtn")) base = [11, 138, 70];
          else base = [255, 255, 255];
          break;
        }
        const bg = s.backgroundColor;
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
          const p = bg.match(/[\d.]+/g).map(Number);
          const a = p.length > 3 ? p[3] : 1;
          if (a >= 0.999) { base = [p[0], p[1], p[2]]; break; }
          layers.push([p[0], p[1], p[2], a]);
        }
        node = node.parentElement;
      }
      if (!base) base = [255, 255, 255];
      let [r, g, b] = base;
      for (let i = layers.length - 1; i >= 0; i--) {
        const [lr, lg, lb, la] = layers[i];
        r = lr * la + r * (1 - la); g = lg * la + g * (1 - la); b = lb * la + b * (1 - la);
      }
      return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
    };
    document.querySelectorAll(".loginPage *").forEach((el) => {
      if (el.children.length > 0) return;
      const t = (el.textContent || "").trim();
      if (!t) return;
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") return;
      const lc = lum(s.color); const lb = lum(effBg(el));
      if (lc === null || lb === null) return;
      const c = (Math.max(lc, lb) + 0.05) / (Math.min(lc, lb) + 0.05);
      if (c < 2 && t.length < 60) risky.push({ text: t.slice(0, 26), color: s.color, bg: effBg(el), c: +c.toFixed(2) });
    });

    return {
      vw,
      wallBox: box(wall) ? { x: Math.round(box(wall).x), w: Math.round(box(wall).width), h: Math.round(box(wall).height) } : null,
      wallBgImage: cs(".loginHeroWall", "backgroundImage"),
      wallBgColor: cs(".loginHeroWall", "backgroundColor"),
      hasOrbit: !!document.querySelector(".lhw-orbit"),
      orbitCircles: document.querySelectorAll(".lhw-orbit circle").length,
      mark: txt(".lhw-mark"),
      h2: txt(".loginHeroWall h2"),
      tag: txt(".lhw-tag"),
      hasRule: !!document.querySelector(".lhw-rule"),
      hasChips: !!document.querySelector(".lhw-chips"),
      hasSlogan: !!document.querySelector(".lhw-slogan"),
      hasGradientText: !!document.querySelector(".loginHeroWall em"),
      cardBox: box(card) ? { x: Math.round(box(card).x) } : null,
      brandH1Color: cs(".loginBrand h1", "color"),
      inputBg: cs(".loginForm input", "backgroundColor"),
      inputColor: cs(".loginForm input", "color"),
      submitBg: cs(".loginSubmit", "backgroundColor"),
      footerHasTerms: /服务条款/.test(txt(".loginFooter")) && /隐私政策/.test(txt(".loginFooter")),
      pageText: document.querySelector(".loginPage").textContent,
      risky,
    };
  });

  const expWall = Math.round(data.vw * 0.44);
  const checks = {
    "品牌墙 44% 宽": Math.abs(data.wallBox.w - expWall) <= 2,
    "品牌墙铺满全高": data.wallBox.h >= 890,
    "纸底（无渐变墙）": data.wallBgImage === "none" && data.wallBgColor === "rgb(244, 240, 232)",
    "圆弧 SVG 存在": data.hasOrbit && data.orbitCircles >= 4,
    "印记=思": data.mark === "思",
    "标题含所有数字员工": data.h2.includes("所有数字员工"),
    "有一句说明文案": data.tag.length > 8,
    "有橙色短规": data.hasRule,
    "已移除卖点标签": !data.hasChips,
    "已移除 0元开通胶囊": !data.hasSlogan,
    "无渐变文字": !data.hasGradientText,
    "右面板在墙右侧": data.cardBox.x >= expWall - 2,
    "面板标题深色": data.brandH1Color === "rgb(30, 24, 20)",
    "输入浅底深字": data.inputBg === "rgb(252, 250, 246)" && data.inputColor === "rgb(30, 24, 20)",
    "主按钮墨底": data.submitBg === "rgb(30, 24, 20)",
    "隐私条款保留": data.footerHasTerms,
    "无内部数字外泄": !/算力\s*\/\s*次|¥/.test(data.pageText),
    "无浅底浅字": data.risky.length === 0,
  };

  console.log("=== 登录页 v3 方案A 实测（1440x900）===");
  console.log("墙    :", JSON.stringify(data.wallBox), "bgImg:", data.wallBgImage, "bgColor:", data.wallBgColor);
  console.log("圆弧  :", data.hasOrbit, "圆数量:", data.orbitCircles, "| 印记:", data.mark);
  console.log("标题  :", JSON.stringify(data.h2));
  console.log("说明  :", JSON.stringify(data.tag));
  console.log("右面板:", JSON.stringify(data.cardBox), "标题色:", data.brandH1Color, "按钮底:", data.submitBg);
  console.log("");
  Object.entries(checks).forEach(([k, v]) => console.log((v ? "✅" : "❌") + " " + k));
  if (data.risky.length) {
    console.log("\n⚠️ 低对比:");
    data.risky.slice(0, 10).forEach((r) => console.log(`   "${r.text}" ${r.color} on ${r.bg} = ${r.c}:1`));
  }
  await page.screenshot({ path: "qa-ip-pos/login-v3-desktop.png", fullPage: true });
  await browser.close();
  const ok = Object.values(checks).every(Boolean);
  console.log(ok ? "\n✅ PASS：v3 方案A（纸底 + 圆弧）已生效" : "\n❌ FAIL");
})().catch((e) => { console.error(e); process.exit(1); });
