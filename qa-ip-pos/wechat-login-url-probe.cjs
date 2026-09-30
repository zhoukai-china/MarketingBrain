const puppeteer = require("puppeteer-core");
const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const mask = (u) => u.replace(/appid=([0-9a-f]{6})[0-9a-f]*/g, "appid=$1…").replace(/secret=[^&]*/g, "secret=***");

(async () => {
  const b = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--no-proxy-server", "--disable-gpu"]
  });
  const p = await b.newPage();
  // 伪装成微信内置浏览器，触发「微信内一键登录」分支
  await p.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x18003128) NetType/WIFI Language/zh_CN");
  await p.setViewport({ width: 420, height: 900 });

  const authUrls = [];
  p.on("request", (r) => {
    const u = r.url();
    if (u.includes("open.weixin.qq.com/connect/oauth2/authorize")) authUrls.push(u);
  });

  for (const site of ["https://ai.lcppch.top", "https://api.lcppch.top/os-v2"]) {
    authUrls.length = 0;
    await p.goto(site + "/login", { waitUntil: "networkidle2", timeout: 45000 });
    await wait(1200);
    const clicked = await p.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((x) => /微信/.test(x.textContent || ""));
      if (!btn) return false;
      btn.click();
      return true;
    });
    await wait(3500);
    console.log("=== " + site + " ===");
    console.log("  点微信登录:", clicked ? "OK" : "未找到按钮");
    if (authUrls.length === 0) {
      console.log("  （未捕获到授权跳转）");
    } else {
      for (const u of authUrls) {
        const appid = (u.match(/appid=([^&]*)/) || [])[1] || "?";
        const redirect = decodeURIComponent((u.match(/redirect_uri=([^&]*)/) || [])[1] || "?");
        const scope = (u.match(/scope=([^&]*)/) || [])[1] || "?";
        console.log("  appid      =", appid.slice(0, 10) + "…");
        console.log("  redirect   =", redirect);
        console.log("  scope      =", scope);
      }
    }
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
