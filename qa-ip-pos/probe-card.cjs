const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  await p.goto("file:///Users/zhoukai/code/MarketingBrain/docs/prototypes/agents-home-tech-demo-20260925.html", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 2500));
  const info = await p.evaluate(() => {
    const card = document.querySelector("#empOk .emp");
    return { text: card ? card.innerText : "N/A", html: card ? card.outerHTML.slice(0, 900) : "" };
  });
  console.log("=== 原型首张员工卡可见文本 ===");
  console.log(info.text);
  console.log("=== 结构（截断）===");
  console.log(info.html);
  await b.close();
})();
