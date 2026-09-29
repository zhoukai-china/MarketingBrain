const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
let pass = 0, fail = 0;
const log = (ok, name, extra = "") => { ok ? pass++ : fail++; console.log((ok ? "✅" : "❌") + " " + name + (extra ? " · " + extra : "")); };
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto("http://localhost:5174/agents", { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1800));

  // ① 顶栏充值 → 抽屉打开（不跳页）
  await p.evaluate(() => {
    const btn = Array.from(document.querySelectorAll(".eh-topbar .eh-mini")).find((b) => b.textContent.includes("充值"));
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 1200));
  let d = await p.evaluate(() => {
    const panel = document.querySelector(".eh-rd-panel");
    if (!panel) return null;
    const r = panel.getBoundingClientRect();
    return { x: Math.round(r.x), w: Math.round(r.width), title: panel.querySelector(".eh-rd-head b")?.textContent, packs: panel.querySelectorAll(".eh-rd-pack").length, url: location.pathname };
  });
  log(d && d.x + d.w === 1440 && d.w === 440, "① 顶栏充值 → 右侧抽屉打开（440px 贴右，不跳页）", d ? JSON.stringify({ x: d.x, w: d.w, url: d.url }) : "未打开");
  log(d && d.title === "算力充值", "抽屉标题");
  const state2 = await p.evaluate(() => {
    const panel = document.querySelector(".eh-rd-panel");
    return { login: Boolean(panel.querySelector(".eh-rd-login")), packs: panel.querySelectorAll(".eh-rd-pack").length };
  });
  log(state2.login || state2.packs === 3, "② 未登录显示登录引导 / 已登录显示三档（同 hook 逻辑）", JSON.stringify(state2));

  // ③ 完整页链接保留
  const full = await p.evaluate(() => document.querySelector(".eh-rd-fullpage")?.textContent || "");
  log(!full.includes("在完整页面打开"), "③ 兜底入口已按用户要求移除");

  // ④ 左侧导航与顶栏仍在（保持不动）
  const chrome = await p.evaluate(() => ({
    side: Boolean(document.querySelector(".eh-tabbar")),
    top: Boolean(document.querySelector(".eh-topbar"))
  }));
  log(chrome.side && chrome.top, "④ 侧栏与顶栏保持不动", JSON.stringify(chrome));

  // ⑤ ✕ 关闭
  await p.evaluate(() => { const x = document.querySelector(".eh-rd-x"); if (x) x.click(); });
  await new Promise((r) => setTimeout(r, 400));
  const closed = await p.evaluate(() => !document.querySelector(".eh-rd-panel"));
  log(closed, "⑤ ✕ 关闭抽屉");
  // 遮罩关闭
  await p.evaluate(() => { const btn = document.querySelector(".eh-nav-bal .eh-mini"); if (btn) btn.click(); });
  await new Promise((r) => setTimeout(r, 800));
  const open2 = await p.evaluate(() => Boolean(document.querySelector(".eh-rd-panel")));
  log(open2, "⑥ TabBar「我的算力」也可打开抽屉");
  await p.evaluate(() => { const ov = document.querySelector(".eh-rd-overlay"); if (ov) ov.click(); });
  await new Promise((r) => setTimeout(r, 400));
  const closed2 = await p.evaluate(() => !document.querySelector(".eh-rd-panel"));
  log(closed2, "⑦ 遮罩点击关闭");

  // 手机版全屏
  await p.setViewport({ width: 390, height: 844 });
  await p.evaluate(() => { const btn = Array.from(document.querySelectorAll(".eh-topbar .eh-mini")).find((b) => b.textContent.includes("充值")); if (btn) btn.click(); });
  await new Promise((r) => setTimeout(r, 800));
  const mob = await p.evaluate(() => { const el = document.querySelector(".eh-rd-panel"); return el ? Math.round(el.getBoundingClientRect().width) : 0; });
  log(mob === 390, "⑧ 手机端抽屉全屏", String(mob));
  await p.screenshot({ path: __dirname + "/recharge-drawer-mobile.png" });

  // 桌面截图（重新打开）
  await p.setViewport({ width: 1440, height: 900 });
  await new Promise((r) => setTimeout(r, 600));
  await p.evaluate(() => { const btn = Array.from(document.querySelectorAll(".eh-topbar .eh-mini")).find((b) => b.textContent.includes("充值")); if (btn) btn.click(); });
  await new Promise((r) => setTimeout(r, 1000));
  await p.screenshot({ path: __dirname + "/recharge-drawer.png" });

  log(errors.length === 0, "无 JS 异常");
  await b.close();
  console.log("PASS " + pass + " / FAIL " + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
