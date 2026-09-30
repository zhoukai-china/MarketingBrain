// 验收：点「生成定位全案」必须有可见反馈；体检改为建议（可跳过直接生成）。
// 2026-09-30（用户）：按钮点了没反应 + 「太薄」校验不要拦人。
// 两条路径：A) 回答太薄 → 体检卡 + 「跳过体检，直接生成」→ 点击后进生成；
//          B) 回答完整 → 无体检卡，直接进生成。
const puppeteer = require("puppeteer-core");
const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const BASE = "http://127.0.0.1:5174";
const API = "http://127.0.0.1:3011";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const Q_MARKS = [
  "先确认一下", "先说说你的项目", "那你的钱是怎么赚的", "最较劲的竞争对手",
  "客户长什么样", "现在说说你自己", "做 IP 你最想拿到", "最后一轮"
];
// 太薄的回答：故意每个字段只给几个字，触发体检「缺失/太薄」
const THIN = ["卖底料的", "赚差价", "有同行", "开店的", "干很久了", "想涨粉", "会拍视频"];

async function waitQuestion(p, mark, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await p.evaluate((m) => document.body.innerText.includes(m), mark)) return true;
    await wait(400);
  }
  return false;
}
async function typeAndSend(p, text) {
  return p.evaluate((t) => {
    const el = document.querySelector("input");
    if (!el) return "no-input";
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, t);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    return "ok";
  }, text);
}

(async () => {
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ["--no-sandbox", "--no-proxy-server", "--disable-gpu"]
  });
  const p = await b.newPage();
  await p.setViewport({ width: 1500, height: 1100 });

  const lr = await p.evaluate(async (api) => {
    const r = await fetch(api + "/auth/dev-login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ productCode: "lanqi" })
    });
    return { status: r.status, text: await r.text() };
  }, API);
  let token = null;
  try { const j = JSON.parse(lr.text); token = j.token || j.data?.token; } catch { /* ignore */ }
  console.log("dev-login:", lr.status, token ? "OK" : "NO TOKEN");

  await p.goto(BASE + "/agents", { waitUntil: "networkidle2", timeout: 45000 });
  if (token) await p.evaluate((t) => localStorage.setItem("store_os_token", t), token);
  p.on("response", (res) => {
    if (res.url().includes("/precheck")) console.log("[precheck]", res.status(), res.request().method());
  });
  p.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 160)));
  p.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 160)); });
  await p.goto(BASE + "/agent/ipzone__ip-pos/workbench", { waitUntil: "networkidle2", timeout: 45000 });

  if (!(await waitQuestion(p, Q_MARKS[0]))) { console.log("FAIL: 第 1 题未出现"); await b.close(); process.exit(1); }
  await p.evaluate(() => {
    const hit = Array.from(document.querySelectorAll("button.cpw-opt")).find((el) => /本地单店老板/.test(el.textContent || ""));
    if (hit) hit.click();
  });
  for (let i = 1; i < Q_MARKS.length; i++) {
    if (!(await waitQuestion(p, Q_MARKS[i]))) { console.log(`第 ${i + 1} 题问题未出现`); await b.close(); process.exit(1); }
    await typeAndSend(p, THIN[i - 1]);
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    if (await p.evaluate(() => /确认，开始生成/.test(document.body.innerText))) break;
    await wait(400);
  }
  console.log("已到确认态（生成按钮出现）");

  const btnState = await p.evaluate(() => {
    const el = document.querySelector("button.cpw-big-btn.gen");
    return el ? { disabled: el.disabled, text: el.textContent.replace(/\s+/g, " ").trim() } : null;
  });
  console.log("生成按钮:", JSON.stringify(btnState), "（filled<8 时也不应无声无息，此处 8/8 应可点）");

  // 点击生成 → 轮询：或见「校验中」按钮态，或见体检卡，或直接进生成
  await p.evaluate(() => {
    const el = document.querySelector("button.cpw-big-btn.gen");
    if (el) el.click();
  });
  let sawBusy = false, reviewShown = false, genStarted = false;
  for (let i = 0; i < 60; i++) {
    const s = await p.evaluate(() => {
      const el = document.querySelector("button.cpw-big-btn.gen");
      return {
        busy: !!el && /校验中/.test(el.textContent || ""),
        review: !!document.querySelector(".cpw-review"),
        gen: /读取定位简报（8\/8 字段齐全）/.test(document.body.innerText)
      };
    });
    if (s.busy) sawBusy = true;
    if (s.review) { reviewShown = true; break; }
    if (s.gen) {
      const why = await p.evaluate(() => document.body.innerText.slice(0, 400).replace(/\s+/g, " "));
      console.log("[gen 文本命中] 页面头部片段:", why);
      genStarted = true; break;
    }
    await wait(150);
  }
  console.log("路径A（太薄回答）：看到「校验中」:", sawBusy, "｜体检卡出现:", reviewShown, "｜直接生成:", genStarted);

  let ok = btnState && !btnState.disabled;
  if (reviewShown) {
    const skipLink = await p.evaluate(() => {
      const a = document.querySelector(".cpw-review-ops .cpw-opt.go");
      if (!a) return "not-found";
      a.click();
      return "clicked";
    });
    console.log("体检卡跳过链接:", skipLink);
    await wait(2500);
    const genState = await p.evaluate(() => ({
      phaseGen: /读取定位简报（8\/8 字段齐全）/.test(document.body.innerText),
      reviewGone: !document.querySelector(".cpw-review")
    }));
    console.log("跳过体检后进入生成:", JSON.stringify(genState));
    ok = ok && skipLink === "clicked" && genState.phaseGen && genState.reviewGone;
  } else {
    // 没触发体检卡也行（预检放行即直接生成），但必须真的进了生成态
    ok = ok && genStarted;
  }
  console.log(ok ? "\nPASS: 点击有可见反馈；体检只是建议、可跳过直接生成" : "\nFAIL");
  await b.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
