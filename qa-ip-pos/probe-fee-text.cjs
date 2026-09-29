const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  for (const url of ["http://localhost:5174/agent/ipzone__copy/workbench", "http://localhost:5174/agent/ipzone__livescript/workbench", "http://localhost:5174/agent/ipzone__ip-pos/workbench"]) {
    await p.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 1800));
    const t = await p.evaluate(() => {
      const fee = Array.from(document.querySelectorAll(".cpw-fee, .cpw-modal-t, [class*=fee], [class*=price]")).map(e => e.textContent.trim()).filter(x => x.includes("算力") || x.includes("消耗") || x.includes("一口价"));
      const bf = [...document.querySelectorAll(".cpw-bf-k")].map(e => e.textContent.trim()).join(" | ");
      return { fee: fee.slice(0, 3), bf: bf.slice(0, 160) };
    });
    console.log(url.split("/agent/")[1], JSON.stringify(t, null, 1));
  }
  await b.close();
})();
