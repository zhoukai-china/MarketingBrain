/**
 * 登出后「怎么再登录」探针（2026-09-30）
 *
 * 背景：在商城「我的」里点退出登录后，需要确认落到的登录页提供了哪些可用入口。
 * 本机 /auth/wechat-config 返回 configured:false（微信未配），所以要实测页面上到底还有哪些能点的东西。
 *
 * 跑法：
 *   NODE_PATH=/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhoukai/.workbuddy/binaries/node/versions/22.22.2/bin/node qa-ip-pos/login-relogin-probe.cjs
 */
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const WEB = "http://127.0.0.1:5174";

/** 抓一页上所有可见的可点元素文案 + 页面主要文本。 */
async function snap(page, url, tag) {
  await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
  await new Promise((r) => setTimeout(r, 2500));
  const data = await page.evaluate(() => {
    const clickable = Array.from(document.querySelectorAll("button, a, [role=button]"))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map((el) => `${(el.textContent || "").trim().slice(0, 40)}${el.disabled ? " [禁用]" : ""}`)
      .filter(Boolean);
    const inputs = Array.from(document.querySelectorAll("input")).map(
      (el) => `input:${el.type}${el.placeholder ? `(${el.placeholder.slice(0, 20)})` : ""}`
    );
    return {
      url: location.href,
      title: document.title,
      clickable: [...new Set(clickable)],
      inputs: [...new Set(inputs)],
      text: (document.body.innerText || "").replace(/\n{2,}/g, "\n").slice(0, 900)
    };
  });
  const file = `qa-ip-pos/login-probe-${tag}.png`;
  await page.screenshot({ path: file, fullPage: true });
  console.log(`\n===== ${tag} =====`);
  console.log(`URL   : ${data.url}`);
  console.log(`标题  : ${data.title}`);
  console.log(`可点击: ${JSON.stringify(data.clickable, null, 0)}`);
  console.log(`输入框: ${JSON.stringify(data.inputs)}`);
  console.log(`正文  :\n${data.text}`);
  console.log(`截图  : ${file}`);
  return data;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "shell",
    args: ["--no-sandbox", "--no-proxy-server", "--disable-dev-shm-usage"]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  // 以「未登录」状态开始：清掉本地会话
  await page.goto(`${WEB}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());

  // ① 登出会跳到的目标：/login
  await snap(page, `${WEB}/login`, "login");

  // ② dev 专用兜底入口：/internal/onboarding（登录页上也挂了链接）
  await snap(page, `${WEB}/internal/onboarding`, "internal-onboarding");

  // ③ 走一遍真实流程：dev-login 注入登录态 → 首页「我的」→ 点退出登录 → 看落到哪
  const res = await fetch("http://127.0.0.1:3011/auth/dev-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productCode: "lanqi", tenantRole: "local_business", tenantName: "本机思潼商城工作区" })
  });
  const login = await res.json();
  if (!login.token) {
    console.log("\n[dev-login 失败] " + JSON.stringify(login).slice(0, 200));
  } else {
    await page.goto(`${WEB}/agents`, { waitUntil: "domcontentloaded" });
    await page.evaluate((t) => {
      localStorage.setItem("store_os_token", t);
    }, login.token);
    await page.goto(`${WEB}/agents`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 2000));

    // 点「我的」标签
    const clickedMine = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("button, a, [role=button]")).find(
        (n) => (n.textContent || "").trim() === "我的"
      );
      if (el) { el.click(); return true; }
      return false;
    });
    await new Promise((r) => setTimeout(r, 1500));

    // 点「退出登录」
    const clickedLogout = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("button, a, [role=button]")).find(
        (n) => (n.textContent || "").includes("退出登录")
      );
      if (el) { el.click(); return true; }
      return false;
    });
    await new Promise((r) => setTimeout(r, 3500));
    const after = await page.evaluate(() => ({
      url: location.href,
      token: localStorage.getItem("store_os_token") || "(已清除)",
      text: (document.body.innerText || "").replace(/\n{2,}/g, "\n").slice(0, 500)
    }));
    const file = "qa-ip-pos/login-probe-after-logout.png";
    await page.screenshot({ path: file, fullPage: true });
    console.log("\n===== 我的 → 退出登录 之后 =====");
    console.log(`我的标签可点: ${clickedMine}`);
    console.log(`退出登录可点: ${clickedLogout}`);
    console.log(`落点 URL    : ${after.url}`);
    console.log(`本地 token  : ${after.token}`);
    console.log(`正文        :\n${after.text}`);
    console.log(`截图        : ${file}`);
  }

  await browser.close();
  if (!fs.existsSync("qa-ip-pos/login-probe-login.png")) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
