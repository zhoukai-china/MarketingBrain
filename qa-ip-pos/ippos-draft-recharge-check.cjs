// 验收（2026-09-30 用户要求）：
// A) 对话全程缓存：答到一半刷新/关闭页面，重进后整个对话恢复、能接着答；
// B) 算力不足充值走新版：/recharge 旧链接重定向到商城充值抽屉（?recharge=1），
//    带 next 时到账后出现「返回继续生成」。
const puppeteer = require("puppeteer-core");
const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const BASE = "http://127.0.0.1:5174";
const API = "http://127.0.0.1:3011";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitText(p, mark, timeoutMs = 20000) {
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
  p.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
  p.on("console", (m) => { const t = m.text(); if (m.type() === "error" || t.includes("draft")) console.log("[console]", m.type(), t.slice(0, 220)); });

  // ========== A. 对话全程缓存 ==========
  await p.goto(BASE + "/agents", { waitUntil: "networkidle2", timeout: 45000 });
  if (token) await p.evaluate((t) => localStorage.setItem("store_os_token", t), token);
  // 清掉旧草稿，从干净状态开始
  await p.evaluate(() => localStorage.removeItem("ippos_chat_draft_ipzone__ip-pos"));
  await p.goto(BASE + "/agent/ipzone__ip-pos/workbench", { waitUntil: "networkidle2", timeout: 45000 });

  if (!(await waitText(p, "先确认一下"))) { console.log("FAIL: 第 1 题未出现"); await b.close(); process.exit(1); }
  await p.evaluate(() => {
    const hit = Array.from(document.querySelectorAll("button.cpw-opt")).find((el) => /本地单店老板/.test(el.textContent || ""));
    if (hit) hit.click();
  });
  // 等第 2 题问出来再答（先问后荐的节奏）
  if (!(await waitText(p, "先说说你的项目吧"))) { console.log("FAIL: 第 2 题未出现"); await b.close(); process.exit(1); }
  await typeAndSend(p, "火锅底料工厂，做川味牛油底料，现在有稳定代工客户");
  await waitText(p, "那你的钱是怎么赚的");
  console.log("[A] 已答完 2 题，到达第 3 题 —— 模拟中途离开（刷新页面）");
  const draftProbe = await p.evaluate(() => {
    const raw = localStorage.getItem("ippos_chat_draft_ipzone__ip-pos");
    if (!raw) return { exists: false };
    try { const d = JSON.parse(raw); return { exists: true, msgs: (d.messages || []).length, phase: d.phase, qi: d.qi, briefKeys: Object.keys(d.brief || {}) }; }
    catch (e) { return { exists: true, parseError: String(e) }; }
  });
  console.log("[A] reload 前草稿:", JSON.stringify(draftProbe));

  await p.reload({ waitUntil: "networkidle2", timeout: 45000 });
  await wait(1500);
  const draftAfter = await p.evaluate(() => {
    const raw = localStorage.getItem("ippos_chat_draft_ipzone__ip-pos");
    if (!raw) return { exists: false };
    try { const d = JSON.parse(raw); return { exists: true, msgs: (d.messages || []).length, phase: d.phase }; }
    catch (e) { return { exists: true, parseError: String(e) }; }
  });
  console.log("[A] reload 后草稿:", JSON.stringify(draftAfter));
  const after = await p.evaluate(() => {
    const body = document.body.innerText;
    return {
      restoredNotice: body.includes("已恢复上次的对话"),
      historyKept: body.includes("本地单店老板") && body.includes("火锅底料工厂"),
      q3Reasked: body.includes("那你的钱是怎么赚的"),
      briefFilled: !body.includes("项目 · 待填"),
      thinkingStuck: document.querySelectorAll(".cpw-bub .cpw-thinking").length
    };
  });
  console.log("[A] 恢复提示:", after.restoredNotice, "｜历史对话保留:", after.historyKept,
    "｜第 3 题重新问出:", after.q3Reasked, "｜简报已填:", after.briefFilled, "｜无卡死占位:", after.thinkingStuck === 0);

  // 接着答第 3 题，验证流程真的能继续
  await typeAndSend(p, "卖给中小餐饮店和火锅店，按件结算，月均复购");
  const cont = await waitText(p, "最较劲的竞争对手");
  console.log("[A] 接着答第 3 题后第 4 题正常问出:", cont);
  const partA = after.restoredNotice && after.historyKept && after.q3Reasked && after.briefFilled && after.thinkingStuck === 0 && cont;

  // ========== B. 充值新入口 ==========
  // B1: 旧链接 /recharge?from=agent&skill=X&next=Y → 重定向到商城并弹出充值抽屉
  await p.goto(BASE + "/recharge?from=agent&skill=ipzone__ip-pos&next=%2Fagent%2Fipzone__ip-pos%2Fworkbench", { waitUntil: "networkidle2", timeout: 45000 });
  await wait(1200);
  const b1 = await p.evaluate(() => ({
    url: location.pathname + location.search,
    drawerOpen: !!document.querySelector(".eh-rd-panel"),
  }));
  console.log("[B1] 旧 /recharge 重定向后 URL:", b1.url);
  console.log("[B1] 充值抽屉已打开:", b1.drawerOpen);

  // B2: 商城直入 ?recharge=1&next=... → 抽屉打开；模拟到账后出现「返回继续生成」
  await p.goto(BASE + "/agents?recharge=1&next=%2Fagent%2Fipzone__ip-pos%2Fworkbench", { waitUntil: "networkidle2", timeout: 45000 });
  await wait(1200);
  const drawer = await p.evaluate(() => !!document.querySelector(".eh-rd-panel"));
  console.log("[B2] ?recharge=1 直达抽屉:", drawer);
  // 本机 + 3011：走模拟支付到账
  await p.evaluate(() => {
    const el = Array.from(document.querySelectorAll("button")).find((x) => /确认充值/.test(x.textContent || ""));
    if (el) el.click();
  });
  let mock = "no-order-btn";
  const t0b = Date.now();
  while (Date.now() - t0b < 12000) {
    mock = await p.evaluate(() => {
      const el = Array.from(document.querySelectorAll("button")).find((x) => /模拟支付到账/.test(x.textContent || ""));
      if (!el) return "waiting";
      el.click();
      return "clicked";
    });
    if (mock === "clicked") break;
    await wait(400);
  }
  let resumeShown = false;
  if (mock === "clicked") {
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      if (await p.evaluate(() => /返回继续生成/.test(document.body.innerText))) { resumeShown = true; break; }
      await wait(400);
    }
  } else {
    console.log("[B2] 无模拟支付按钮（可能非本机模式）:", mock);
  }
  console.log("[B2] 到账后出现「返回继续生成」:", resumeShown);
  const partB = b1.url.startsWith("/agents") && b1.drawerOpen && drawer && resumeShown;

  const ok = partA && partB;
  console.log(ok ? "\nPASS: 对话全程可恢复 + 充值走新版抽屉且可返回继续生成" : "\nFAIL");
  await b.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
