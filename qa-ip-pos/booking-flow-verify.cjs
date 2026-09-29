// 接替验收：F3-F7 首页卡片改预约模式 + 详情页预约/充值抽屉
const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
let pass = 0, fail = 0;
const log = (ok, name, extra = "") => { ok ? pass++ : fail++; console.log((ok ? "✅" : "❌") + " " + name + (extra ? " · " + extra : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto("http://localhost:5174/agents", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(1800);

  // ---- 首页 F4-F6 商品卡：预约按钮 / 无购买按钮 ----
  const cards = await p.evaluate(() => {
    const list = Array.from(document.querySelectorAll(".eh-pcard"));
    let book = 0, buy = 0, cart = 0;
    const names = [];
    for (const c of list) {
      names.push(c.querySelector(".eh-pname")?.textContent?.trim().slice(0, 12) || "?");
      if (c.querySelector(".eh-buy-now.book")) book++;
      if (Array.from(c.querySelectorAll(".eh-buy-now")).some((x) => !x.classList.contains("book"))) buy++;
      if (c.querySelector(".eh-cart-mini")) cart++;
    }
    return { n: list.length, book, buy, cart, names };
  });
  log(cards.n === 6, "F4-F6 共 6 张商品卡", "cards=" + cards.n);
  log(cards.book === 6, "6 张卡均显示「预约上线提醒」按钮", "book=" + cards.book);
  log(cards.buy === 0, "无「立即购买」按钮（已全部改为预约）", "buy=" + cards.buy);
  log(cards.cart === 0, "无「加购」按钮", "cart=" + cards.cart);

  // ---- 首页 F3 保禄卡：预约按钮 / 无购买 ----
  const f3 = await p.evaluate(() => {
    const c = document.querySelector(".eh-cons-card");
    if (!c) return null;
    return {
      book: Boolean(c.querySelector(".eh-buy-now.book")),
      buy: Array.from(c.querySelectorAll(".eh-buy-now")).some((x) => !x.classList.contains("book")),
      cart: Boolean(c.querySelector(".eh-cart-mini")),
      txt: c.innerText.replace(/\n/g, " ").slice(0, 30)
    };
  });
  log(f3 && f3.book && !f3.buy && !f3.cart, "F3 保禄卡改为「预约上线提醒」", JSON.stringify(f3));

  // ---- 首页 F7 行业工作台 ----
  const f7 = await p.evaluate(() => {
    const el = document.querySelector(".eh-brand-hero");
    return el ? el.innerText : "";
  });
  log(f7.includes("预约上线提醒"), "F7 行业工作台为预约态", f7.slice(0, 20));

  // ---- 点首页预约按钮 → 打开 BookingModal ----
  await p.evaluate(() => {
    const btn = document.querySelector(".eh-pcard .eh-buy-now.book");
    if (btn) btn.click();
  });
  await sleep(900);
  const modal = await p.evaluate(() => {
    const m = document.querySelector(".eh-bk-mask");
    return m ? { open: true, hasInput: Boolean(m.querySelector(".eh-bk-form input")), title: m.querySelector(".eh-bk-head b")?.textContent || "" } : { open: false };
  });
  log(modal.open && modal.hasInput, "点预约按钮 → 预约弹窗打开（含手机号输入）", JSON.stringify(modal));
  // 关闭
  await p.evaluate(() => { const x = document.querySelector(".eh-bk-sheet .eh-cd-x"); if (x) x.click(); });
  await sleep(400);

  // ---- 详情页：未上线·预约中 + 预约 CTA + 无购买 ----
  const detail = await b.newPage();
  await detail.setViewport({ width: 1440, height: 1000 });
  const dErr = [];
  detail.on("pageerror", (e) => dErr.push(String(e)));
  await detail.goto("http://localhost:5174/product/hwRec/detail", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(1600);
  const pd = await detail.evaluate(() => {
    const main = document.querySelector("main");
    const txt = main ? main.innerText : "";
    return {
      status: txt.includes("未上线") && txt.includes("预约中"),
      cta: Boolean(Array.from(document.querySelectorAll(".ipd-cta-row button")).find((b) => b.textContent.includes("预约"))),
      buy: txt.includes("立即购买") || txt.includes("加入购物车"),
      thumbs: document.querySelectorAll(".ipd-gthumbs button").length,
      cover: Boolean(document.querySelector(".ipd-pcover"))
    };
  });
  log(pd.status, "F4-F6 详情页「未上线·预约中」态", JSON.stringify({ status: pd.status }));
  log(pd.cta, "详情页有「预约」CTA");
  log(!pd.buy, "详情页无购买按钮", "buy=" + pd.buy);
  log(pd.thumbs === 3 && pd.cover, "三视图缩略图结构（对齐原型）", "thumbs=" + pd.thumbs);

  // ---- 详情页 充值 → 右侧抽屉（不跳页） ----
  // F4-F6 未上线预约页无充值入口；充值抽屉事件在 6 个有「⚡充值算力」的详情页（Copy/IpPos 等）。
  await detail.goto("http://localhost:5174/agent/ipzone__copy/detail", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(1600);
  const hasRecharge = await detail.evaluate(() => Boolean(Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("充值算力"))));
  log(hasRecharge, "Copy 详情页含「充值算力」入口");
  const beforeUrl = detail.url();
  await detail.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("充值算力"));
    if (btn) btn.click();
  });
  await sleep(1100);
  const rd = await detail.evaluate(() => {
    const panel = document.querySelector(".eh-rd-panel");
    return panel ? { open: true, url: location.pathname } : { open: false, url: location.pathname };
  });
  log(rd.open && rd.url === beforeUrl.replace(/^https?:\/\/[^/]+/, ""), "详情页充值 → 右侧抽屉（不跳页）", JSON.stringify(rd));

  log(errors.length === 0 && dErr.length === 0, "无 JS 异常", "home=" + errors.length + " detail=" + dErr.length);
  await b.close();
  console.log("PASS " + pass + " / FAIL " + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
