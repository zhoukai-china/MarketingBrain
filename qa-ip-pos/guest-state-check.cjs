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
  await p.goto("https://ai.lcppch.top/agents?tab=mine", { waitUntil: "networkidle2", timeout: 45000 });
  await wait(2000);

  const info = await p.evaluate(() => {
    const id = document.querySelector(".me-id");
    const txt = document.body.innerText;
    return {
      idText: id ? id.innerText.replace(/\s+/g, " ").trim() : "(none)",
      saysLoggedIn: /已登录/.test(id ? id.innerText : ""),
      saysGuest: /未登录/.test(id ? id.innerText : ""),
      pageMentionsLoggedIn: /已登录/.test(txt),
      hasToken: !!localStorage.getItem("store_os_token")
    };
  });

  console.log("本地是否有 token:", info.hasToken);
  console.log("账号块显示:", info.idText);
  console.log("账号块说「已登录」:", info.saysLoggedIn);
  console.log("账号块说「未登录」:", info.saysGuest);
  console.log("整页出现「已登录」:", info.pageMentionsLoggedIn);

  const ok = !info.hasToken && info.saysGuest && !info.saysLoggedIn && !info.pageMentionsLoggedIn;
  console.log(ok ? "\nPASS: 游客显示「未登录」" : "\nFAIL");
  await b.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
