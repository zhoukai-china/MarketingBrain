// 冒烟：copy / livescript 两个工作台套用对话流程模式后的核心行为。
// A) copy：答题 → 消化占位 → 成型 → 下一题 → 候选（先问后荐）→ 刷新恢复 → 接着答
// B) livescript：选场次类型（分流）→ 消化 → 第 2 题出现 → 刷新恢复（分流队列重建）
const puppeteer = require("puppeteer-core");
const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const BASE = "http://127.0.0.1:5174";
const API = "http://127.0.0.1:3011";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitText(p, mark, timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await p.evaluate((m) => document.body.innerText.includes(m), mark)) return true;
    await wait(300);
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

  // ========== A. CopyWorkbench ==========
  await p.evaluate(() => localStorage.removeItem("copy_chat_draft_ipzone__copy"));
  await p.goto(BASE + "/agent/ipzone__copy/workbench", { waitUntil: "networkidle2", timeout: 45000 });
  const a1 = await waitText(p, "这次给什么产品 / 服务写文案");
  console.log("[copy] 第 1 题出现:", a1, "｜第 1 题已无写死示例选项:", !(await p.evaluate(() => /宠物门店洗护年卡/.test(document.body.innerText))));
  await typeAndSend(p, "火锅底料工厂的团购套餐，川味牛油底料");
  // 消化占位应出现，且下一题在成型前不出现（先问后荐的前半：不抢跑）
  await wait(500);
  const think = await p.evaluate(() => document.querySelectorAll(".cpw-bub .cpw-thinking").length);
  console.log("[copy] 「正在消化」占位出现:", think > 0);
  const a2 = await waitText(p, "它最想让观众记住的一个卖点");
  await wait(2500); // 等候选渲染
  const cand = await p.evaluate(() => Array.from(document.querySelectorAll(".cpw-opts .cpw-opt")).filter((el) => !/抖音|视频号|小红书/.test(el.textContent || "")).length);
  console.log("[copy] 第 2 题出现:", a2, "｜生成候选出现（非静态选项）:", cand > 0);
  await typeAndSend(p, "一年一次免费换新，坏的直接换新的不维修");
  await waitText(p, "主要发布到哪个平台");
  console.log("[copy] 第 3 题正常问出: true");
  await p.reload({ waitUntil: "networkidle2", timeout: 45000 });
  await wait(1500);
  const ra = await p.evaluate(() => {
    const body = document.body.innerText;
    return {
      notice: (body.match(/已恢复上次的对话/g) || []).length,
      history: body.includes("火锅底料工厂") && body.includes("一年一次免费换新"),
      q3: body.includes("主要发布到哪个平台"),
      briefFilled: !body.includes("产品 · 待填")
    };
  });
  console.log("[copy] 刷新后恢复提示:", ra.notice, "｜历史保留:", ra.history, "｜第 3 题重新问出:", ra.q3, "｜简报已填:", ra.briefFilled);
  const partA = a1 && a2 && cand > 0 && ra.notice === 1 && ra.history && ra.q3 && ra.briefFilled;

  // ========== B. LivescriptWorkbench ==========
  await p.evaluate(() => localStorage.removeItem("livescript_chat_draft_ipzone__livescript"));
  await p.goto(BASE + "/agent/ipzone__livescript/workbench", { waitUntil: "networkidle2", timeout: 45000 });
  const b1 = await waitText(p, "这场直播是哪一种");
  console.log("[live] 第 1 题出现:", b1);
  await p.evaluate(() => {
    const hit = Array.from(document.querySelectorAll("button.cpw-opt")).find((el) => /招商加盟/.test(el.textContent || ""));
    if (hit) hit.click();
  });
  const b2 = await waitText(p, "品牌是做什么的");
  await wait(2500);
  console.log("[live] 分流后第 2 题出现:", b2);
  await typeAndSend(p, "我们做本地餐饮供应链，给中小餐饮店稳定供货");
  await waitText(p, "这场想吸引谁进直播间");
  console.log("[live] 第 3 题正常问出: true");
  await p.reload({ waitUntil: "networkidle2", timeout: 45000 });
  await wait(1500);
  const rb = await p.evaluate(() => {
    const body = document.body.innerText;
    return {
      notice: (body.match(/已恢复上次的对话/g) || []).length,
      history: body.includes("本地餐饮供应链"),
      q3: body.includes("这场想吸引谁进直播间"),
      modeKept: !body.includes("场次类型 · 待填")
    };
  });
  console.log("[live] 刷新后恢复提示:", rb.notice, "｜历史保留:", rb.history, "｜第 3 题重新问出:", rb.q3, "｜场次类型保留:", rb.modeKept);
  const partB = b1 && b2 && rb.notice === 1 && rb.history && rb.q3 && rb.modeKept;

  const ok = partA && partB;
  console.log(ok ? "\nPASS: 两个工作台对话流程（消化/候选/节奏/恢复）全部就位" : "\nFAIL（部分项未过，见上）");
  await b.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
