/**
 * 验证本机 dev(5174) 访问 /mine 时，服务端实际渲染的是新版「我的」还是旧版。
 * 做法：dev-login 拿 token 注入 localStorage(store_os_token)，再导航到 /mine，检查 DOM。
 * 运行：NODE_PATH=<托管node workspace/node_modules> <托管node> qa-ip-pos/mine-route-check.cjs
 */
const puppeteer = require("puppeteer-core");
const HS =
  process.env.HOME +
  "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const APP = "http://127.0.0.1:5174";
const API = "http://127.0.0.1:3011";

(async () => {
  let token = null;
  try {
    const r = await fetch(API + "/auth/dev-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productCode: "lanqi" }),
    });
    const j = await r.json();
    token = j.token || (j.data && j.data.token) || null;
    console.log("dev-login:", r.status, "token:", token ? token.slice(0, 12) + "..." : null, "keys:", Object.keys(j));
  } catch (e) {
    console.log("dev-login err:", e.message);
  }

  const browser = await puppeteer.launch({
    executablePath: HS,
    headless: true,
    args: ["--no-sandbox", "--no-proxy-server"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push("PAGEERR: " + e.message));

  await page.goto(APP + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  if (token) await page.evaluate((t) => localStorage.setItem("store_os_token", t), token);
  await new Promise((r) => setTimeout(r, 1200));

  await page.goto(APP + "/mine", { waitUntil: "domcontentloaded", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 4000));

  const res = await page.evaluate(() => ({
    href: location.href,
    hasMineH1: !!document.querySelector(".mine-h1"),
    mineGroupCount: document.querySelectorAll(".mine-group").length,
    hasMineTop: !!document.querySelector(".mine-top"),
    hasLoginGate: !!document.querySelector(".login-gate"),
    h1: document.querySelector("h1") ? document.querySelector("h1").textContent : null,
    textHead: document.body.innerText.replace(/\s+/g, " ").slice(0, 240),
  }));
  console.log("RESULT", JSON.stringify(res, null, 2));
  console.log("ERRORS", JSON.stringify(errors.slice(0, 8), null, 2));
  await page.screenshot({ path: "/tmp/mine-route-check.png" });
  await browser.close();
})();
