const puppeteer = require("puppeteer-core");
const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const BASE = "http://127.0.0.1:5174";
const OUT = "docs/prototypes/assets";

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ["--no-proxy-server", "--no-sandbox", "--disable-dev-shm-usage"],
  });
  const shots = [
    { url: "/agents", name: "mall-home.png", sel: null, h: 900 },
    { url: "/agent/ipzone__ip-pos/detail", name: "ippos-detail.png", sel: ".ipd-gmain", h: 900 },
  ];
  for (const s of shots) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: s.h, deviceScaleFactor: 2 });
    await page.goto(`${BASE}${s.url}`, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    let ok = false;
    if (s.sel) {
      const el = await page.$(s.sel);
      if (el) { await el.screenshot({ path: `${OUT}/${s.name}` }); ok = true; }
    }
    if (!ok) await page.screenshot({ path: `${OUT}/${s.name}` });
    console.log("saved", s.name, s.sel ? `(el ${s.sel})` : "(viewport)");
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
