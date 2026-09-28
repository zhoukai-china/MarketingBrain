const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  await p.goto("file:///Users/zhoukai/code/MarketingBrain/docs/prototypes/agents-home-tech-demo-20260925.html", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 2000));
  const out = await p.evaluate(() => {
    const tab = document.querySelector('.tab[data-tab="cases"]');
    if (tab) tab.click();
    const view = document.getElementById("casesView");
    const chips = Array.from(document.querySelectorAll(".cv-chip")).map(c => c.textContent.trim());
    const card = document.querySelector(".case-card");
    const clone = card ? card.cloneNode(true) : null;
    if (clone) clone.querySelectorAll("img").forEach(i => i.removeAttribute("src"));
    return {
      chips: chips.join("|"),
      head: view ? view.querySelector(".cv-head").innerText.replace(/\n/g, " | ") : "",
      cardHTML: clone ? clone.outerHTML.replace(/\s+/g, " ").slice(0, 1500) : "N/A",
      cardText: card ? card.innerText.replace(/\n/g, " | ") : "N/A"
    };
  });
  console.log(JSON.stringify(out, null, 2).slice(0, 3000));
  await b.close();
})();
