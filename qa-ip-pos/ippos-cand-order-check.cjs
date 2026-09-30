// 时序验收（2026-09-30 用户反馈）：推荐回答必须「先出问题、再出推荐回答」。
// 做法：答完第 1 题后 100ms 轮询；第一次出现「非第 1 题预设选项」的按钮
//（= 生成候选渲染）的那一刻，第 2 题的问题文本必须已经在页面上。
const puppeteer = require("puppeteer-core");
const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const BASE = "http://127.0.0.1:5174";
const API = "http://127.0.0.1:3011";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const Q1_PRESETS = ["连锁品牌总部", "本地单店老板", "OPC 代运营"];
const Q2_MARK = "先说说你的项目吧";

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

  // 等第 1 题
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    if (await p.evaluate(() => document.body.innerText.includes("先确认一下"))) break;
    await wait(300);
  }
  await p.evaluate(() => {
    const hit = Array.from(document.querySelectorAll("button.cpw-opt")).find((el) => /本地单店老板/.test(el.textContent || ""));
    if (hit) hit.click();
  });
  console.log("已点「本地单店老板」，开始 100ms 轮询时序…");

  // 轮询：记录「候选首现」与「Q2 问题首现」的先后
  let candFirstAt = -1, q2FirstAt = -1, sawThinking = false;
  const start = Date.now();
  while (Date.now() - start < 25000) {
    const s = await p.evaluate((presets) => {
      const body = document.body.innerText;
      const genCand = Array.from(document.querySelectorAll("button.cpw-opt"))
        .filter((el) => !presets.some((t) => (el.textContent || "").includes(t)));
      return {
        hasGenCand: genCand.length > 0,
        firstCandText: genCand[0] ? genCand[0].textContent.slice(0, 40) : "",
        q2Shown: body.includes("先说说你的项目吧"),
        thinking: document.querySelectorAll(".cpw-bub .cpw-thinking").length > 0
      };
    }, Q1_PRESETS);
    if (s.thinking) sawThinking = true;
    const now = Date.now() - start;
    if (candFirstAt < 0 && s.hasGenCand) candFirstAt = now;
    if (q2FirstAt < 0 && s.q2Shown) q2FirstAt = now;
    if (candFirstAt >= 0 && q2FirstAt >= 0) {
      console.log("候选首现:", candFirstAt, "ms｜Q2 问题首现:", q2FirstAt, "ms");
      console.log("首条候选:", s.firstCandText);
      break;
    }
    if (q2FirstAt >= 0 && now - q2FirstAt > 12000 && candFirstAt < 0) {
      console.log("Q2 已问出但 12s 内未见候选（模型可能返回空候选）"); break;
    }
    await wait(100);
  }

  const tail = await p.evaluate(() => {
    const msgs = document.querySelectorAll(".cpw-bub");
    const last = msgs.length ? msgs[msgs.length - 1].textContent.slice(0, 160) : "(no msgs)";
    return { lastMsg: last.replace(/\s+/g, " "), msgCount: msgs.length,
             inputDisabled: !!document.querySelector("input") };
  });
  console.log("末条消息:", JSON.stringify(tail));
  const ok = candFirstAt >= 0 && q2FirstAt >= 0 && q2FirstAt <= candFirstAt && sawThinking;
  console.log("出现过「正在消化」占位:", sawThinking);
  console.log(ok
    ? "\nPASS: 先问下一题，再出推荐回答（问题先于候选）"
    : "\nFAIL: 候选抢跑或流程异常");
  await b.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
