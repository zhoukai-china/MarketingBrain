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
  await p.setViewport({ width: 1280, height: 1000 });
  await p.goto("https://ai.lcppch.top/agents", { waitUntil: "networkidle2", timeout: 45000 });
  await wait(1500);

  const clicked = await p.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const t = btns.find((x) => /开通/.test(x.textContent || ""));
    if (!t) return false;
    t.click();
    return true;
  });
  await wait(1200);

  const info = await p.evaluate(() => {
    const benefits = document.querySelector(".eco-act-benefits");
    const title = document.querySelector(".eco-activate h3");
    return {
      hasModal: !!document.querySelector(".eco-activate"),
      title: title ? title.textContent.trim() : "(none)",
      benefitsText: benefits ? benefits.innerText.replace(/\s+/g, " ").trim() : "(none)",
      theme: document.documentElement.getAttribute("data-theme")
    };
  });

  console.log("点开弹层:", clicked ? "OK" : "未找到按钮");
  console.log("data-theme =", info.theme);
  console.log("标题:", info.title);
  console.log("权益行:", info.benefitsText);
  const ok = info.benefitsText.includes("30 天") && !info.benefitsText.includes("90 天");
  console.log(ok ? "\nPASS: 新客礼弹层显示 30 天" : "\nFAIL: 仍是旧天数");
  await b.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
