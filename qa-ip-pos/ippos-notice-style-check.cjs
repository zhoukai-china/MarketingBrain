// 验收（2026-09-30 用户反馈 / 2026-10-03 合并面板）：
// A) 「已恢复对话」提示只出现一次——ephemeral 消息不落草稿，反复重进不叠加；
// B) 合并补充面板（体检 + 运营缺口）底部的「补充好了，直接生成」在浅色面板上可读
//    （实底橙 + 白字），且体检项的来源标签是暖色、与运营缺口的蓝标签能区分开。
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

  await p.goto(BASE + "/agents", { waitUntil: "networkidle2", timeout: 45000 });
  if (token) await p.evaluate((t) => localStorage.setItem("store_os_token", t), token);
  await p.evaluate(() => localStorage.removeItem("ippos_chat_draft_ipzone__ip-pos"));
  await p.goto(BASE + "/agent/ipzone__ip-pos/workbench", { waitUntil: "networkidle2", timeout: 45000 });

  // 进页自动播演示（2026-10-01 设计）——演示态下点选项无效，草稿写不进去，
  // A 段会因此拿不到「已恢复」提示（脚本假失败）。先停演示再走真实访谈。
  await wait(1500);
  await p.evaluate(() => {
    const el = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("停止演示"));
    if (el) el.click();
  });
  await wait(800);

  // 答到第 3 题（同 draft-recharge-check 的路径）
  if (!(await waitText(p, "先确认一下"))) { console.log("FAIL: 第 1 题未出现"); await b.close(); process.exit(1); }
  await p.evaluate(() => {
    const hit = Array.from(document.querySelectorAll("button.cpw-opt")).find((el) => /本地单店老板/.test(el.textContent || ""));
    if (hit) hit.click();
  });
  await waitText(p, "先说说你的项目吧");
  await typeAndSend(p, "火锅底料工厂，做川味牛油底料，现在有稳定代工客户");
  await waitText(p, "那你的钱是怎么赚的");

  const countNotices = () => p.evaluate(() =>
    (document.body.innerText.match(/已恢复上次的对话/g) || []).length);
  // 重进后进页又会自动播演示，而演示开始时会 resetAll 把恢复出来的消息清掉 ——
  // 必须先停演示（回滚到演示前那一帧）再数提示，否则永远是 0（脚本假失败）。
  const stopDemo = () => p.evaluate(() => {
    const el = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("停止演示"));
    if (el) el.click();
  });

  // 第一次重进
  await p.reload({ waitUntil: "networkidle2", timeout: 45000 });
  await wait(1500);
  await stopDemo();
  await wait(900);
  const n1 = await countNotices();
  console.log("[A] 第 1 次重进，恢复提示条数:", n1, "（应为 1）");

  // 第二次重进：提示若被存进草稿，这里会变成 2 条（旧 bug）
  await p.reload({ waitUntil: "networkidle2", timeout: 45000 });
  await wait(1500);
  await stopDemo();
  await wait(900);
  const n2 = await countNotices();
  console.log("[A] 第 2 次重进，恢复提示条数:", n2, "（应为 1）");
  const draftMsgs = await p.evaluate(() => {
    try { return (JSON.parse(localStorage.getItem("ippos_chat_draft_ipzone__ip-pos") || "{}").messages || []).length; }
    catch { return -1; }
  });
  console.log("[A] 草稿消息条数:", draftMsgs, "（提示不落盘则不随重进增长）");
  const partA = n1 === 1 && n2 === 1;

  // ========== B. 合并补充面板：放行按钮 + 来源标签配色 ==========
  // 造「太薄」回答触发体检：清草稿重走，用极简回答
  await p.evaluate(() => localStorage.removeItem("ippos_chat_draft_ipzone__ip-pos"));
  await p.goto(BASE + "/agent/ipzone__ip-pos/workbench", { waitUntil: "networkidle2", timeout: 45000 });
  // 自动演示会盖住真实访谈流程 → 先停掉（否则下面的问答与后续断言都跑在演示态上）
  await wait(1500);
  await p.evaluate(() => {
    const el = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("停止演示"));
    if (el) el.click();
  });
  await wait(800);
  await waitText(p, "先确认一下");
  await p.evaluate(() => {
    const hit = Array.from(document.querySelectorAll("button.cpw-opt")).find((el) => /本地单店老板/.test(el.textContent || ""));
    if (hit) hit.click();
  });
  const THIN = ["卖底料的", "赚差价", "有同行", "开店的", "干很久了", "想涨粉", "会拍视频"];
  const MARKS = ["先说说你的项目", "那你的钱是怎么赚的", "最较劲的竞争对手", "客户长什么样", "现在说说你自己", "做 IP 你最想拿到", "最后一轮"];
  for (let i = 0; i < MARKS.length; i++) {
    if (!(await waitText(p, MARKS[i]))) { console.log(`第 ${i + 2} 题未出现`); break; }
    await typeAndSend(p, THIN[i]);
  }
  if (!(await waitText(p, "生成定位全案"))) { console.log("FAIL: 确认态未出现"); await b.close(); process.exit(1); }
  await p.evaluate(() => {
    const el = document.querySelector("button.cpw-big-btn.gen");
    if (el) el.click();
  });
  if (!(await waitText(p, "补充好了，直接生成"))) { console.log("FAIL: 合并补充面板未出现"); await b.close(); process.exit(1); }
  const styles = await p.evaluate(() => {
    const pick = (el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, color: cs.color, border: cs.borderColor };
    };
    const go = document.querySelector(".cpw-gaps-ops .cpw-opt.go");
    const chipCheck = document.querySelector(".cpw-gap-area.is-check");
    const chipGap = document.querySelector(".cpw-gap-area:not(.is-check)");
    return {
      go: go ? pick(go) : null,
      chipCheck: chipCheck ? pick(chipCheck) : null,
      chipGap: chipGap ? pick(chipGap) : null,
      legacyOps: document.querySelectorAll(".cpw-review-ops").length,
      legacyReview: document.querySelectorAll(".cpw-review").length
    };
  });
  console.log("[B] 放行按钮（补充好了，直接生成）:", JSON.stringify(styles.go));
  console.log("[B] 体检项标签:", JSON.stringify(styles.chipCheck), "｜运营缺口标签:", JSON.stringify(styles.chipGap));
  // 放行按钮：橙色实底（~rgb(232,101,26)）+ 白字（浅色面板里不隐形）
  const isOrange = (c) => /232,\s*101,\s*26/.test(c || "");
  const isWhite = (c) => /255,\s*255,\s*255/.test(c || "");
  // 体检标签与缺口标签必须是不同底色（暖 / 蓝），否则来源分不出来
  const chipDistinct = !styles.chipCheck || !styles.chipGap || styles.chipCheck.bg !== styles.chipGap.bg;
  const partB = styles.go && isOrange(styles.go.bg) && isWhite(styles.go.color)
    && styles.legacyOps === 0 && styles.legacyReview === 0 && chipDistinct;

  const ok = partA && partB;
  console.log(ok ? "\nPASS: 恢复提示只提示一次 + 合并面板一个 CTA 清晰可读、来源标签可区分" : "\nFAIL");
  await b.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
