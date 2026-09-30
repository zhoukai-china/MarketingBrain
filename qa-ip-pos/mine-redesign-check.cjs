const puppeteer = require("puppeteer-core");
const fs = require("fs");

const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const BASE = "http://127.0.0.1:5174";
const API = "http://127.0.0.1:3011";

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "shell",
    args: ["--no-sandbox", "--no-proxy-server", "--disable-gpu"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });

  // 用 dev-login 拿到登录态
  const login = await fetch(API + "/auth/dev-login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ productCode: "lanqi" }),
  });
  const loginData = await login.json().catch(() => ({}));
  const token = loginData.token || (loginData.data && loginData.data.token);
  if (!token) { console.log("NO TOKEN", JSON.stringify(loginData).slice(0, 200)); await browser.close(); process.exit(1); }

  await page.goto(BASE + "/mine", { waitUntil: "networkidle2" });
  await page.evaluate((t) => { localStorage.setItem("store_os_token", t); }, token);
  await page.goto(BASE + "/mine", { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1200));

  const report = await page.evaluate(() => {
    const txt = document.body.innerText;
    const q = (s) => !!document.querySelector(s);
    return {
      url: location.href,
      hasMeHead: q(".me-head"),
      hasMeBalCard: q(".me-bal-card"),
      hasMeList: q(".me-list"),
      meItems: [...document.querySelectorAll(".me-item .mi-txt")].map((e) => e.childNodes[0].textContent.trim()),
      hasTeach: txt.includes("新手教学") || txt.includes("一键自动演示"),
      balNum: (document.querySelector(".me-bal b") || {}).textContent || null,
      hasOrderEmpty: q(".me-order-empty"),
      hasDictInPage: txt.includes("术语词典"),
      hasGetnote: txt.includes("得到大脑"),
    };
  });

  console.log("=== 我的页重设计渲染检查 ===");
  console.log(JSON.stringify(report, null, 2));
  console.log("=== 页面运行期错误 ===");
  console.log(errors.length ? errors.join("\n") : "（无）");

  await page.screenshot({ path: "/tmp/mine-redesign.png", fullPage: true });
  console.log("截图已存 /tmp/mine-redesign.png");
  await browser.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
