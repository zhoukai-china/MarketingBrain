/**
 * 邀请抽屉 · 品牌更名 + 去掉「邀请码/邀请链接」两行（2026-10-03 用户口径）
 *
 * 背景：用户在微信里截图指出两件事——
 *   ① 微信顶栏品牌名要「思潼AI商城」（原来是「思潼AI 行业智能体平台」）；
 *   ② 「邀请有礼」抽屉里「邀请码 ref-xxx 复制」「邀请链接 https://… 复制」两行挤在一起，去掉。
 *
 * 本脚本断言：
 *   1. 静态 HTML（未登录也能看）<title> / meta description 已是「思潼AI商城」，且不含旧名；
 *   2. 抽屉里 .eh-inv-rows / .eh-inv-fld / .eh-inv-copy 全部消失，正文不再出现「邀请码 / 邀请链接」字样；
 *   3. 抽屉仍保留：海报（<img>）、「换一条新链接」、被邀请的客户列表；
 *   4. 0 console error。
 *
 * 前置：本机 web dev server :5174、api dev :3011（脚本会自行 dev-login 换 token）。
 */
const puppeteer = require("puppeteer-core");

const CHROME =
  "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const BASE = "http://127.0.0.1:5174";
const API = "http://127.0.0.1:3011";
const UA =
  "Mozilla/5.0 (Linux; Android 13; PGT-AN00 Build/HUAWEIPGT-AN00; wv) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.49.2600(0x2800313D) WeChat/arm64 " +
  "Weixin NetType/WIFI Language/zh_CN ABI/arm64";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = true;
const check = (cond, msg) => {
  console.log(`  ${cond ? "✅" : "❌"} ${msg}`);
  if (!cond) ok = false;
};

async function loginToken(page) {
  await page.goto(BASE + "/agents", { waitUntil: "networkidle2", timeout: 30000 });
  const r = await page.evaluate(async (api) => {
    const res = await fetch(api + "/auth/dev-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productCode: "lanqi" })
    });
    return await res.text();
  }, API);
  try {
    const j = JSON.parse(r);
    return j?.token || j?.data?.token || null;
  } catch {
    return null;
  }
}

async function openInvite(page, token) {
  await page.goto(BASE + "/agents", { waitUntil: "networkidle2", timeout: 30000 });
  if (token) await page.evaluate((t) => localStorage.setItem("store_os_token", t), token);
  await page.reload({ waitUntil: "networkidle2" });
  await wait(1200);
  await page.evaluate(() => {
    const t = Array.from(document.querySelectorAll(".eh-tab")).find(
      (b) => b.textContent && b.textContent.includes("我的")
    );
    if (t) t.click();
  });
  await wait(900);
  const clicked = await page.evaluate(() => {
    const inv = Array.from(document.querySelectorAll(".me-item")).find(
      (b) => b.textContent && b.textContent.includes("邀请有礼")
    );
    if (!inv) return false;
    inv.click();
    return true;
  });
  try {
    await page.waitForFunction(() => !!document.querySelector(".eh-inv-body"), { timeout: 8000 });
  } catch {
    /* 由断言判定 */
  }
  await wait(600);
  return clicked;
}

(async () => {
  // ---------- 1) 静态 HTML 品牌名 ----------
  console.log("== 1) 静态 HTML（dev server 直出）==");
  const html = await fetch(BASE + "/agents").then((r) => r.text());
  check(/<title>思潼AI商城<\/title>/.test(html), "<title> 已是「思潼AI商城」");
  check(!/行业智能体平台/.test(html), "静态 HTML 不再出现旧品牌名「行业智能体平台」");
  check(/思潼AI商城——/.test(html), "meta description 同步为「思潼AI商城」");

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--no-proxy-server", "--disable-gpu"]
  });
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 400, height: 850, isMobile: true, hasTouch: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  const token = await loginToken(page);
  console.log("  dev-login token:", token ? "OK" : "无（接口未起？）");

  // ---------- 2) 抽屉 DOM ----------
  console.log("\n== 2) 「邀请有礼」抽屉 ==");
  const opened = await openInvite(page, token);
  check(opened, "从「我的」点开「邀请有礼」");
  const probe = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const body = q(".eh-inv-body");
    return {
      hasDrawer: !!body,
      rows: document.querySelectorAll(".eh-inv-rows").length,
      flds: document.querySelectorAll(".eh-inv-fld").length,
      copies: document.querySelectorAll(".eh-inv-copy").length,
      regen: !!q(".eh-inv-regen"),
      regenText: q(".eh-inv-regen")?.textContent?.trim() ?? null,
      invitees: !!q(".eh-inv-sec"),
      poster: !!q("img.eh-ips-canvas"),
      text: body ? body.innerText : ""
    };
  });
  console.log("  DOM:", JSON.stringify({ ...probe, text: probe.text.slice(0, 260) }, null, 1));
  check(probe.hasDrawer, "抽屉已打开（.eh-inv-body 存在）");
  check(probe.rows === 0, `「邀请码 / 邀请链接」行容器已删除（.eh-inv-rows = ${probe.rows}）`);
  check(probe.flds === 0, `字段行已删除（.eh-inv-fld = ${probe.flds}）`);
  check(probe.copies === 0, `「复制」按钮已删除（.eh-inv-copy = ${probe.copies}）`);
  check(!/邀请码/.test(probe.text), "抽屉正文里不再出现「邀请码」字样");
  check(!/邀请链接/.test(probe.text), "抽屉正文里不再出现「邀请链接」字样");
  check(!/ref-/.test(probe.text), "抽屉正文里不再出现裸邀请码 ref-xxx");
  check(!/^\s*复制\s*$/m.test(probe.text), "抽屉正文里不再有孤立的「复制」按钮文案");
  check(probe.poster, "海报 <img> 仍在（长按保存入口不受影响）");
  check(probe.regen && /换一条新链接/.test(probe.regenText || ""), `「${probe.regenText}」仍在`);
  check(probe.invitees, "「被邀请的客户」区块仍在");

  // 留一张截图给人看（本机脚本跑完可直接翻）
  const shot = "qa-ip-pos/invite-drawer-after-20261004.png";
  await page.screenshot({ path: shot });
  console.log(`  截图：${shot}`);

  // ---------- 3) 全局无旧品牌名 ----------
  console.log("\n== 3) 页面正文品牌名 ==");
  const bodyText = await page.evaluate(() => document.body.innerText);
  check(!/行业智能体平台/.test(bodyText), "页面正文不再出现旧品牌名「行业智能体平台」");

  await browser.close();
  console.log("\n  console errors:", errors.length);
  if (errors.length) console.log("   ", errors.slice(0, 4).join("\n    "));
  check(errors.length === 0, "0 console / page error");

  console.log(ok ? "\nALL PASS ✅" : "\nFAILED ❌");
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
