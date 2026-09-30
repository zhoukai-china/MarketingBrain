const puppeteer = require("puppeteer-core");
const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const BASE = "http://127.0.0.1:5174";
const API = "http://127.0.0.1:3011";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 每题的问题特征（页面出现它 = AI 已问出这一题）
const Q_MARKS = [
  "先确认一下", "先说说你的项目", "那你的钱是怎么赚的", "最较劲的竞争对手",
  "客户长什么样", "现在说说你自己", "做 IP 你最想拿到", "最后一轮"
];
const FREE = [
  "火锅底料工厂，做川味牛油底料，现在有稳定代工客户",
  "卖给中小餐饮店和火锅店，按件结算，月均复购",
  "川味坊、本地调味品批发市场、超市自有品牌",
  "开火锅店的老板，30-50 岁，最痛的是口味不稳定、供货商老断货",
  "在调味品行业 12 年，自己调方子，说话直",
  "一年内签下 100 家稳定合作餐饮店",
  "抖音 3000 粉但都是同行，出镜自然 7 分，每周能投 6 小时"
];

async function waitQuestion(p, mark, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const shown = await p.evaluate((m) => document.body.innerText.includes(m), mark);
    if (shown) return true;
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
  await p.goto(BASE + "/agent/ipzone__ip-pos/workbench", { waitUntil: "networkidle2", timeout: 45000 });

  // 第 1 题：等问题出现 → 点角色选项
  if (!(await waitQuestion(p, Q_MARKS[0]))) { console.log("FAIL: 第 1 题未出现"); await b.close(); process.exit(1); }
  const pick = await p.evaluate(() => {
    const hit = Array.from(document.querySelectorAll("button.cpw-opt")).find((el) => /本地单店老板/.test(el.textContent || ""));
    if (!hit) return "not-found";
    hit.click();
    return "clicked";
  });
  console.log("第 1 题点「本地单店老板」:", pick);

  // 第 2~8 题：等问题出现 → 输入回车
  let allTyped = true;
  for (let i = 1; i < Q_MARKS.length; i++) {
    if (!(await waitQuestion(p, Q_MARKS[i]))) { console.log(`第 ${i + 1} 题问题未出现`); allTyped = false; break; }
    const r = await typeAndSend(p, FREE[i - 1]);
    if (r !== "ok") { console.log(`第 ${i + 1} 题输入失败:`, r); allTyped = false; break; }
  }

  // 等最后一题的消化成型 + 进入确认态
  await wait(6000);
  const info = await p.evaluate(() => {
    const body = document.body.innerText;
    return {
      reachedConfirm: /确认，开始生成|开始生成/.test(body),
      pendingCount: (body.match(/待填/g) || []).length,
      thinkingLeft: document.querySelectorAll(".cpw-bub .cpw-thinking").length
    };
  });
  console.log("全部作答:", allTyped);
  console.log("进入确认态:", info.reachedConfirm);
  console.log("简报里「待填」个数:", info.pendingCount);
  console.log("残留「思考中」占位:", info.thinkingLeft);

  const ok = pick === "clicked" && allTyped && info.reachedConfirm && info.pendingCount === 0 && info.thinkingLeft === 0;
  console.log(ok ? "\nPASS: 8 问按对话节奏走完，简报 8 项填满" : "\nFAIL");
  await b.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
