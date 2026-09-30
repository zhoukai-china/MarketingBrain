const puppeteer = require("puppeteer-core");
const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const BASE = "http://127.0.0.1:5174";
const API = "http://127.0.0.1:3011";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 8 题的真实回答（第 1 题点选项，其余自由输入）
const FREE = [
  "火锅底料工厂，做川味牛油底料，现在有稳定代工客户",
  "卖给中小餐饮店和火锅店，按件结算，月均复购",
  "川味坊、本地调味品批发市场、超市自有品牌",
  "开火锅店的老板，30-50 岁，最痛的是口味不稳定、供货商老断货",
  "在调味品行业 12 年，自己调方子，说话直",
  "一年内签下 100 家稳定合作餐饮店",
  "抖音 3000 粉但都是同行，出镜自然 7 分，每周能投 6 小时"
];

(async () => {
  const b = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
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
  await wait(3000);

  // 第 1 题：点角色选项
  const pick = await p.evaluate(() => {
    const hit = Array.from(document.querySelectorAll("button.cpw-opt")).find((el) => /本地单店老板/.test(el.textContent || ""));
    if (!hit) return "not-found";
    hit.click();
    return "clicked";
  });
  console.log("第 1 题点「本地单店老板」:", pick);
  await wait(1800);

  // 第 2~8 题：自由输入 + 回车
  let genCandidatesSeen = false;
  for (let i = 0; i < FREE.length; i++) {
    const typed = await p.evaluate((text) => {
      const el = document.querySelector("input");
      if (!el) return "no-input";
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      return "ok";
    }, FREE[i]);
    if (typed !== "ok") { console.log("第 " + (i + 2) + " 题输入失败:", typed); break; }
    // 第 2 题答完（进入第 3 题）后，等模型生成回来——第 3 题没有预设选项，
    // 此时出现的 .cpw-opt 按钮必然是模型生成的候选 ✓
    if (i === 0) {
      await wait(5000);
      genCandidatesSeen = await p.evaluate(() => document.querySelectorAll("button.cpw-opt").length > 0);
      console.log("模型生成的候选出现在界面上:", genCandidatesSeen);
    }
    await wait(1800);
  }

  await wait(2000);
  const info = await p.evaluate(() => {
    const body = document.body.innerText;
    const pending = (body.match(/待填/g) || []).length;
    return {
      reachedConfirm: /确认，开始生成|开始生成/.test(body),
      stillAsking: /先说说你的项目吧|最后一轮/.test(body),
      pendingCount: pending,
      tail: body.slice(-260).replace(/\s+/g, " ")
    };
  });

  console.log("进入确认态:", info.reachedConfirm);
  console.log("还停在提问中:", info.stillAsking);
  console.log("简报里「待填」个数:", info.pendingCount);
  console.log("页面尾部片段:", info.tail);

  const ok = pick === "clicked" && info.reachedConfirm && info.pendingCount === 0;
  console.log(ok ? "\nPASS: 8 问走完，简报 8 项已填满" : "\nFAIL");
  await b.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
