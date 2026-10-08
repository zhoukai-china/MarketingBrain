/**
 * 招商加盟版原型「集成进系统」本地验收（仅 5174 dev，不碰线上）
 *   A. 商城首页出现 F9 体验专区 + 两张入口卡（招商加盟版 / 本地商家版）
 *   B. 点招商加盟版 → /demo/franchise/index.html 真实渲染（内容级断言：含庄衡、含计费口径）
 *   C. demo 内点苏笺 → 系统内真实工作台 /agent/ipzone__copy/workbench（同域，不再写死线上域名）
 *   D. 浏览器返回 → 回到 demo 页
 *   E. 说明页互跳：demo「我的」→ spec.html 能打开
 *   F. 全程无 JS 报错
 */
const puppeteer = require("puppeteer-core");
const fs = require("fs"), os = require("os"), path = require("path");
const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const BASE = "http://127.0.0.1:5174";
const API = "http://127.0.0.1:3011";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log((ok ? "  PASS " : "  FAIL ") + name + (extra ? "  → " + extra : "")); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "demo-int-"));
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: dir, args: ["--no-proxy-server", "--no-sandbox"] });
  const p = await b.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 90)));
  await p.setViewport({ width: 496, height: 900 });

  const login = await fetch(API + "/auth/dev-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ productCode: "lanqi" }) }).then((r) => r.json()).catch(() => ({}));
  check("预置. dev-login 取到 token", Boolean(login.token));

  await p.goto(BASE + "/agents", { waitUntil: "networkidle2", timeout: 45000 });
  if (login.token) { await p.evaluate((t) => localStorage.setItem("store_os_token", t), login.token); await p.reload({ waitUntil: "networkidle2", timeout: 45000 }); }
  await wait(1200);

  // A. F9 楼层
  const a = await p.evaluate(() => {
    const fl = document.querySelector("#floor-demo");
    if (!fl) return { exists: false };
    const cards = [...fl.querySelectorAll(".eh-demo-card")].map((c) => ({
      title: (c.querySelector(".eh-demo-meta b") || {}).textContent || "",
      names: (c.querySelector(".eh-demo-meta span") || {}).textContent || ""
    }));
    return { exists: true, head: (fl.querySelector(".eh-floor-no") || {}).textContent || "", title: (fl.querySelector(".eh-floor-t") || {}).textContent || "", cards };
  });
  check("A1. 商城首页出现 F9 体验专区", a.exists && a.cards.length === 2, JSON.stringify(a.cards.map((c) => c.title)));
  check("A2. 招商版卡列出 9 位高管名", /庄衡/.test(a.cards[0]?.names || "") && /万契/.test(a.cards[0]?.names || ""), (a.cards[0] || {}).names);

  // B. 进招商版 demo（内容级）
  await Promise.all([
    p.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {}),
    p.evaluate(() => document.querySelectorAll("#floor-demo .eh-demo-card")[0].click())
  ]);
  await wait(1500);
  const bb = await p.evaluate(() => ({
    path: location.pathname,
    text: document.body.innerText.slice(0, 4000),
    src: document.documentElement.innerHTML,
    avatars: document.querySelectorAll(".ava").length,
    tabs: document.querySelectorAll(".tab").length
  }));
  check("B1. 进入 /demo/franchise/index.html", /\/demo\/franchise\/index\.html$/.test(bb.path), bb.path);
  // 计费口径在「我的」页，未渲染时 innerText 取不到 → 查页面源码（红线文案必须在页内）
  check("B2. demo 真实渲染（庄衡在前台 + 计费口径在页内）",
    /庄衡/.test(bb.text) && bb.src.includes("1元=10算力") && bb.src.includes("0元开通"),
    "庄衡=" + /庄衡/.test(bb.text) + " 计费=" + (bb.src.includes("1元=10算力") && bb.src.includes("0元开通")));
  check("B3. 9 位高管头像 + 4 个底部 tab", bb.avatars >= 9 && bb.tabs === 4, JSON.stringify({ avatars: bb.avatars, tabs: bb.tabs }));

  // C. 点苏笺 → 系统内工作台（同域）
  const wbHref = await p.evaluate(() => {
    const cards = [...document.querySelectorAll("#page-agents .agent, .agent")];
    const t = cards.find((c) => /苏笺/.test(c.textContent || ""));
    if (!t) return null;
    const btn = t.querySelector("button[onclick*='openOrder']");
    return btn ? btn.getAttribute("onclick") : null;
  });
  const jumped = await p.evaluate(() => {
    const cards = [...document.querySelectorAll(".agent")];
    const t = cards.find((c) => /苏笺/.test(c.textContent || ""));
    if (!t) return { ok: false, why: "no card" };
    const btn = t.querySelector("button[onclick*='openOrder']");
    if (!btn) return { ok: false, why: "no button" };
    btn.click();
    return { ok: true, href: (window.WB_FILE || {}).qinwen };
  });
  await wait(2500);
  const cc = await p.evaluate(() => ({ path: location.pathname, host: location.host }));
  check("C1. 苏笺卡映射到系统内工作台路由", String(jumped.href || "").indexOf("/agent/ipzone__copy/workbench") >= 0, JSON.stringify(jumped));
  check("C2. 真的跳到同域工作台（host 仍为 5174）", /\/agent\/ipzone__copy\/workbench$/.test(cc.path) && cc.host === "127.0.0.1:5174", JSON.stringify(cc));

  // D. 返回 → demo
  await p.goBack({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
  await wait(1500);
  const dd = await p.evaluate(() => ({ path: location.pathname, hasZhuang: /庄衡/.test(document.body.innerText) }));
  check("D. 浏览器返回回到 demo", /\/demo\/franchise\/index\.html$/.test(dd.path) && dd.hasZhuang, JSON.stringify(dd));

  // E. 说明页互跳
  const spec = await p.evaluate(() => {
    const b = [...document.querySelectorAll("button, a")].find((x) => /产品说明/.test(x.textContent || ""));
    if (!b) return { found: false };
    b.click();
    return { found: true };
  });
  await wait(1800);
  const ee = await p.evaluate(() => ({ path: location.pathname, txt: (document.body.innerText || "").slice(0, 200) }));
  check("E. 说明页可打开（spec.html）", spec.found && /\/demo\/franchise\/spec\.html$/.test(ee.path), JSON.stringify(ee.path));

  check("F. 全程无 JS 报错", errs.length === 0, errs.join(" | "));
  await b.close();
  console.log("\n" + (fail === 0 ? "ALL PASS" : "有失败项") + " — pass=" + pass + " fail=" + fail);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("ERR", e); process.exit(1); });
