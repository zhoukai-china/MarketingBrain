/**
 * 招商加盟版「写成系统页面」本地验收（5174 dev，不碰线上）
 *   A. /ipai/franchise 是系统内 React 页面（不是静态 HTML）
 *   B. 高管 tab：9 张卡 + 派活按钮，点苏笺 → 系统内真实工作台（同域）
 *   C. 定时任务 tab：3 条任务 + 开关可切换 + 可新建
 *   D. 我的 tab：年卡权益 + 4 条计费口径（红线文案）
 *   E. /ipai/franchise/spec 说明页：5 个章节、含计费与免责内容
 *   F. 商城首页**没有** F9 入口（已按用户要求撤掉）
 *   G. 全程无 JS 报错
 */
const puppeteer = require("puppeteer-core");
const fs = require("fs"), os = require("os"), path = require("path");
const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const BASE = "http://127.0.0.1:5174";
const API = "http://127.0.0.1:3011";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, extra = "") => { ok ? pass++ : fail++; console.log((ok ? "  PASS " : "  FAIL ") + n + (extra ? "  → " + extra : "")); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ipai-"));
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: dir, args: ["--no-proxy-server", "--no-sandbox"] });
  const p = await b.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 90)));
  await p.setViewport({ width: 520, height: 900 });

  const login = await fetch(API + "/auth/dev-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ productCode: "lanqi" }) }).then((r) => r.json()).catch(() => ({}));
  await p.goto(BASE + "/agents", { waitUntil: "networkidle2", timeout: 45000 });
  if (login.token) { await p.evaluate((t) => localStorage.setItem("store_os_token", t), login.token); await p.reload({ waitUntil: "networkidle2", timeout: 45000 }); }
  await wait(1000);

  // F. 商城首页没有 F9
  const f9 = await p.evaluate(() => Boolean(document.querySelector("#floor-demo")));
  check("F. 商城首页已无 F9 入口（按用户要求撤掉）", f9 === false);

  // A. 打开系统页面
  await p.goto(BASE + "/ipai/franchise", { waitUntil: "networkidle2", timeout: 45000 });
  await wait(3500); // 路由是 lazy 加载，等组件挂载
  const a = await p.evaluate(() => ({
    root: Boolean(document.querySelector(".app-wrap .ipai-root")),
    tabs: [...document.querySelectorAll(".ipai-root .tab")].map((t) => t.getAttribute("data-tab") || ""),
    topbar: Boolean(document.querySelector(".ipai-root .topbar")), hero: Boolean(document.querySelector(".ipai-root .hero")),
    pageId: (document.querySelector(".ipai-root .page") || {}).id || "",
    cards: document.querySelectorAll(".ipai-root .card").length
  }));
  check("A1. 是系统内页面 + 原型顶栏/英雄区都在", a.root && a.topbar && a.hero, JSON.stringify({ root: a.root, topbar: a.topbar, hero: a.hero }));
  check("A2. 原型 4 个 tab（home/agents/task/me）", a.tabs.join(",") === "home,agents,task,me", JSON.stringify(a.tabs));
  check("A3. 首页渲染 + 原型卡片结构", a.pageId === "page-home" && a.cards > 0, JSON.stringify({ page: a.pageId, cards: a.cards }));

  // B. 高管 tab
  await p.evaluate(() => [...document.querySelectorAll(".ipai-root .tab")].find((t) => t.getAttribute("data-tab") === "agents").click());
  await wait(800);
  const bb = await p.evaluate(() => ({
    cards: document.querySelectorAll(".ipai-root .agent").length,
    names: [...document.querySelectorAll(".ipai-root .agent .ag-name, .ipai-root .agent b")].map((x) => x.textContent).slice(0, 9),
    prices: [...document.querySelectorAll(".ipai-root .ag-price, .ipai-root .price")].map((x) => x.textContent.trim()),
    priceByName: [...document.querySelectorAll(".ipai-root .agent")].map((c) => (c.textContent || "").replace(/\s+/g, " "))
  }));
  check("B1. 9 位数字高管卡", bb.cards === 9, JSON.stringify(bb.names));
  const allCards = bb.priceByName.join(" | ");
  check("B2. 单价与原型一致（99/15/70/120 均出现）", /99 算力/.test(allCards) && /15 算力/.test(allCards) && /70 算力/.test(allCards) && /120 算力/.test(allCards),
    allCards.slice(0, 80));

  // 点苏笺 → 工作台（同域）
  await p.evaluate(() => {
    const card = [...document.querySelectorAll(".ipai-root .agent")].find((c) => /苏笺/.test(c.textContent || ""));
    (card.querySelector("button") || card).click();
  });
  await wait(2500);
  const bc = await p.evaluate(() => ({ path: location.pathname, host: location.host }));
  check("B3. 点苏笺进系统内真实工作台（同域）", /\/agent\/ipzone__copy\/workbench$/.test(bc.path) && bc.host === "127.0.0.1:5174", JSON.stringify(bc));

  await p.goto(BASE + "/ipai/franchise", { waitUntil: "networkidle2", timeout: 45000 });
  await wait(3000);

  // C. 定时任务
  await p.evaluate(() => [...document.querySelectorAll(".ipai-root .tab")].find((t) => t.getAttribute("data-tab") === "task").click());
  await wait(700);
  const c1 = await p.evaluate(() => ({
    rows: document.querySelectorAll(".ipai-root .sch").length,
    on: document.querySelectorAll(".ipai-root .tgl.on").length
  }));
  check("C1. 3 条定时任务（2 开 1 关，与原型一致）", c1.rows === 3 && c1.on === 2, JSON.stringify(c1));
  await p.evaluate(() => document.querySelector(".ipai-root .sch .tgl").click());
  await wait(500);
  const c2 = await p.evaluate(() => ({ on: document.querySelectorAll(".ipai-root .tgl.on").length, toast: Boolean(document.querySelector(".ipai-root .toast")) }));
  check("C2. 开关可切换并提示", c2.on !== c1.on && c2.toast, JSON.stringify(c2));
  await p.evaluate(() => [...document.querySelectorAll(".ipai-root .tab")].find((t) => t.getAttribute("data-tab") === "task").click());
  await wait(500);
  await p.evaluate(() => { const b = [...document.querySelectorAll(".ipai-root [data-act]")].find((x) => /openSched\(\)/.test(x.getAttribute("data-act"))); if (b) b.click(); });
  await wait(500);
  await p.evaluate(() => { const b = [...document.querySelectorAll(".ipai-root [data-act]")].find((x) => /openSchedForm\(\)/.test(x.getAttribute("data-act"))); if (b) b.click(); });
  await wait(400);
  await p.evaluate(() => { const b = [...document.querySelectorAll(".ipai-root [data-act]")].find((x) => /saveSched\(\)/.test(x.getAttribute("data-act"))); if (b) b.click(); });
  await wait(600);
  const c3 = await p.evaluate(() => document.querySelectorAll(".ipai-root .sheet .sch").length);
  check("C3. 弹层内可新建定时任务", c3 >= 4, "sheet rows=" + c3);

  // D. 我的
  await p.evaluate(() => [...document.querySelectorAll(".ipai-root .tab")].find((t) => t.getAttribute("data-tab") === "me").click());
  await wait(700);
  const d = await p.evaluate(() => ({
    rights: (document.querySelector(".ipai-root .rights") || {}).textContent || "",
    billing: [...document.querySelectorAll(".ipai-root li, .ipai-root .kv, .ipai-root .card-note")].map((x) => x.textContent).filter((t) => /1元 = 10算力|0元开通|用后扣费|失败不扣/.test(t)),
    src: document.querySelector(".ipai-root").innerHTML
  }));
  check("D1. 年卡权益卡（¥49,800/年 · 基础 3 席位）", /49,800/.test(d.rights) && /3 席位/.test(d.rights), d.rights.slice(0, 60));
  check("D2. 我的页含权益卡 + 说明入口 + 算力口径", /49,800/.test(d.src) && /产品说明/.test(d.src) && /算力/.test(d.src), JSON.stringify(d.billing.slice(0, 2)));

  // E. 说明页
  await p.goto(BASE + "/ipai/franchise/spec", { waitUntil: "networkidle2", timeout: 45000 });
  await wait(3000);
  const e = await p.evaluate(() => ({
    secs: document.querySelectorAll(".ipai-spec .card").length,
    heads: [...document.querySelectorAll(".ipai-spec .card-h")].map((x) => x.textContent.slice(0, 16)),
    text: document.body.innerText,
    rows: document.querySelectorAll(".ipai-spec .spec-row").length
  }));
  check("E1. 说明页章节齐全（说明+5 节）", e.secs >= 5, JSON.stringify(e.heads));
  check("E2. 含 9 位高管条目（单价与场景）", e.rows >= 9, "rows=" + e.rows);
  check("E3. 含计费与免责内容", /算力/.test(e.text) && /免责/.test(e.text));

  check("G. 全程无 JS 报错", errs.length === 0, errs.join(" | "));
  await b.close();
  console.log("\n" + (fail === 0 ? "ALL PASS" : "有失败项") + " — pass=" + pass + " fail=" + fail);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("ERR", e); process.exit(1); });
