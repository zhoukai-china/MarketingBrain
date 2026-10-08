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
  await wait(1500);
  const a = await p.evaluate(() => ({
    root: Boolean(document.querySelector(".app-wrap .ipai")),
    tabs: [...document.querySelectorAll(".ipai-tab")].map((t) => t.textContent.replace(/[^一-龥]/g, "")),
    title: (document.querySelector(".ipai-head h1") || {}).textContent || "",
    hasRec: Boolean(document.querySelector(".ipai-rec")),
    hasLoop: document.querySelectorAll(".ipai-loop-it").length
  }));
  check("A1. 是系统内 React 页面（.app-wrap .ipai）", a.root, a.title);
  check("A2. 4 个底部 tab（首页/高管/定时任务/我的）", a.tabs.join(",") === "首页,高管,定时任务,我的", JSON.stringify(a.tabs));
  check("A3. 首页含今日推荐 + 4 个闭环入口", a.hasRec && a.hasLoop === 4, JSON.stringify({ rec: a.hasRec, loop: a.hasLoop }));

  // B. 高管 tab
  await p.evaluate(() => [...document.querySelectorAll(".ipai-tab")].find((t) => /高管/.test(t.textContent)).click());
  await wait(800);
  const bb = await p.evaluate(() => ({
    cards: document.querySelectorAll(".ipai-agent").length,
    names: [...document.querySelectorAll(".ipai-agent-m b")].map((x) => x.textContent),
    prices: [...document.querySelectorAll(".ipai-price")].map((x) => x.textContent.trim()),
    priceByName: [...document.querySelectorAll(".ipai-agent")].map((c) => (c.querySelector(".ipai-agent-m b") || {}).textContent + ":" + (c.querySelector(".ipai-price") || {}).textContent.trim())
  }));
  check("B1. 9 位数字高管卡", bb.cards === 9, JSON.stringify(bb.names));
  check("B2. 单价与原型一致（庄衡99/苏笺15/甄映120）",
    bb.prices.length === 9 && bb.priceByName.some((x) => /苏笺:15 算力\/次/.test(x)) && bb.priceByName.some((x) => /庄衡:99 算力\/次/.test(x)) && bb.priceByName.some((x) => /甄映:120 算力\/次/.test(x)),
    JSON.stringify(bb.priceByName.slice(0, 3)));

  // 点苏笺 → 工作台（同域）
  await p.evaluate(() => {
    const card = [...document.querySelectorAll(".ipai-agent")].find((c) => /苏笺/.test(c.textContent || ""));
    card.querySelector(".ipai-btn").click();
  });
  await wait(2500);
  const bc = await p.evaluate(() => ({ path: location.pathname, host: location.host }));
  check("B3. 点苏笺进系统内真实工作台（同域）", /\/agent\/ipzone__copy\/workbench$/.test(bc.path) && bc.host === "127.0.0.1:5174", JSON.stringify(bc));

  await p.goto(BASE + "/ipai/franchise", { waitUntil: "networkidle2", timeout: 45000 });
  await wait(1200);

  // C. 定时任务
  await p.evaluate(() => [...document.querySelectorAll(".ipai-tab")].find((t) => /定时任务/.test(t.textContent)).click());
  await wait(700);
  const c1 = await p.evaluate(() => ({
    rows: document.querySelectorAll(".ipai-sch").length,
    on: document.querySelectorAll(".ipai-tgl.on").length
  }));
  check("C1. 3 条定时任务（2 开 1 关，与原型一致）", c1.rows === 3 && c1.on === 2, JSON.stringify(c1));
  await p.evaluate(() => document.querySelector(".ipai-sch .ipai-tgl").click());
  await wait(500);
  const c2 = await p.evaluate(() => ({ on: document.querySelectorAll(".ipai-tgl.on").length, toast: Boolean(document.querySelector(".ipai-toast")) }));
  check("C2. 开关可切换并提示", c2.on !== c1.on && c2.toast, JSON.stringify(c2));
  await p.evaluate(() => [...document.querySelectorAll(".ipai-form .ipai-btn")].find((x) => /保存定时任务/.test(x.textContent)).click());
  await wait(600);
  const c3 = await p.evaluate(() => document.querySelectorAll(".ipai-sch").length);
  check("C3. 可新建定时任务", c3 === 4, "rows=" + c3);

  // D. 我的
  await p.evaluate(() => [...document.querySelectorAll(".ipai-tab")].find((t) => /我的/.test(t.textContent)).click());
  await wait(700);
  const d = await p.evaluate(() => ({
    rights: (document.querySelector(".ipai-rights") || {}).textContent || "",
    billing: [...document.querySelectorAll(".ipai-billing li")].map((x) => x.textContent)
  }));
  check("D1. 年卡权益卡（¥49,800/年 · 基础 3 席位）", /49,800/.test(d.rights) && /3 席位/.test(d.rights), d.rights.slice(0, 60));
  check("D2. 计费口径 4 条（红线文案）", d.billing.length === 4 && d.billing.some((x) => /1元 = 10算力/.test(x)) && d.billing.some((x) => /用后扣费/.test(x)), JSON.stringify(d.billing));

  // E. 说明页
  await p.goto(BASE + "/ipai/franchise/spec", { waitUntil: "networkidle2", timeout: 45000 });
  await wait(1200);
  const e = await p.evaluate(() => ({
    secs: document.querySelectorAll(".ipai-sec").length,
    heads: [...document.querySelectorAll(".ipai-sec h2")].map((x) => x.textContent.slice(0, 16)),
    text: document.body.innerText,
    rows: document.querySelectorAll(".ipai-row").length
  }));
  check("E1. 说明页 5 个章节", e.secs === 5, JSON.stringify(e.heads));
  check("E2. 含 9 位高管条目（单价与场景）", e.rows >= 9, "rows=" + e.rows);
  check("E3. 含计费与免责内容", /算力/.test(e.text) && /免责/.test(e.text));

  check("G. 全程无 JS 报错", errs.length === 0, errs.join(" | "));
  await b.close();
  console.log("\n" + (fail === 0 ? "ALL PASS" : "有失败项") + " — pass=" + pass + " fail=" + fail);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("ERR", e); process.exit(1); });
