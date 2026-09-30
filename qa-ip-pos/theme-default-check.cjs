const puppeteer = require("puppeteer-core");
const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--no-proxy-server", "--disable-gpu"]
  });
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 900 });
  const results = [];
  for (const url of ["https://ai.lcppch.top/agents", "https://ai.lcppch.top/login"]) {
    await p.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
    await wait(1500);
    const info = await p.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        theme: document.documentElement.getAttribute("data-theme"),
        stored: localStorage.getItem("sitong-theme"),
        bgVar: root.getPropertyValue("--bg").trim(),
        textVar: root.getPropertyValue("--text").trim()
      };
    });
    const ok = info.theme === "light" && info.stored === null;
    results.push(ok);
    console.log((ok ? "PASS" : "FAIL") + "  " + url + "  data-theme=" + info.theme + " localStorage=" + info.stored + " --bg=" + info.bgVar + " --text=" + info.textVar);
  }
  console.log(results.every(Boolean) ? "\nALL PASS: 未存偏好的浏览器现在默认浅色" : "\nSOME FAILED");
  await b.close();
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
