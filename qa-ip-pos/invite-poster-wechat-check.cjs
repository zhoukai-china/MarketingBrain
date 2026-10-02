/**
 * 邀请海报 · 微信环境长按保存 验证（2026-10-02）
 *
 * 背景：微信内置浏览器不支持网页触发下载，点「下载海报」会弹微信提示「可在浏览器打开此网页来下载文件。」盖住海报。
 * 修法：微信内把预览渲染成真正的 <img>（可长按保存），按钮改为「查看大图 · 长按保存到相册」；普通浏览器保持下载。
 *
 * 本脚本：分别用 微信UA / 普通UA 打开「我的 → 邀请有礼」，断言 DOM 分支正确。
 */
const puppeteer = require("puppeteer-core");

const CHROME =
  "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const BASE = "http://127.0.0.1:5174";
const API = "http://127.0.0.1:3011";
const WECHAT_UA =
  "Mozilla/5.0 (Linux; Android 13; PGT-AN00 Build/HUAWEIPGT-AN00; wv) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.49.2600(0x2800313D) WeChat/arm64 " +
  "Weixin NetType/WIFI Language/zh_CN ABI/arm64";
const NORMAL_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
  // 等海报 <img> 出 data URL
  try {
    await page.waitForFunction(
      () => {
        const img = document.querySelector("img.eh-ips-canvas");
        return !!img && (img.getAttribute("src") || "").startsWith("data:image/png");
      },
      { timeout: 8000 }
    );
  } catch {
    /* 由后续断言判定 */
  }
  return clicked;
}

async function probe(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector(".eh-ips-canvas-src");
    const img = document.querySelector("img.eh-ips-canvas");
    const badge = document.querySelector(".eh-ips-longpress");
    const btn = document.querySelector(".eh-ips-dl");
    const note = document.querySelector(".eh-ips-note");
    return {
      hasOffscreenCanvas: !!canvas,
      offscreenHidden: canvas ? getComputedStyle(canvas).display === "none" : false,
      previewIsPngImg: !!img && (img.getAttribute("src") || "").startsWith("data:image/png"),
      hasLongPressBadge: !!badge,
      btnText: btn ? btn.textContent.trim() : null,
      noteText: note ? note.textContent.trim() : null
    };
  });
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--no-proxy-server", "--disable-gpu"]
  });
  let ok = true;
  const fail = (m) => {
    ok = false;
    console.log("  ❌ " + m);
  };

  // ---------- A) 微信 UA ----------
  console.log("== A) 微信 UA（Android WeChat 8.0.49）==");
  const wx = await browser.newPage();
  await wx.setUserAgent(WECHAT_UA);
  await wx.setViewport({ width: 400, height: 850, isMobile: true, hasTouch: true });
  const token = await loginToken(wx);
  console.log("  dev-login token:", token ? "OK" : "无（接口未起？）");
  const openedWx = await openInvite(wx, token);
  console.log("  打开「邀请有礼」:", openedWx ? "OK" : "未找到入口");
  const a = await probe(wx);
  console.log("  DOM:", JSON.stringify(a, null, 2));
  if (!a.hasOffscreenCanvas) fail("缺少离屏 canvas");
  if (!a.offscreenHidden) fail("离屏 canvas 未隐藏");
  if (!a.previewIsPngImg) fail("预览不是 <img> data:image/png（微信里无法长按保存）");
  if (!a.hasLongPressBadge) fail("缺「长按保存」提示徽标");
  if (!a.btnText || !a.btnText.includes("长按保存")) fail("按钮文案未切换为长按保存");
  if (!a.noteText || !a.noteText.includes("长按")) fail("说明文案未提示长按");

  // 点按钮 → 出全屏大图（而非触发下载）
  const before = await wx.evaluate(() => {
    const el = document.querySelector(".eh-ips-dl");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { disabled: el.disabled, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  console.log("  点击前按钮:", JSON.stringify(before));
  await wx.evaluate(() => document.querySelector(".eh-ips-dl")?.click());
  let zoom = { hasZoom: false, zoomImgIsPng: false, tip: null };
  for (let i = 0; i < 25; i++) {
    zoom = await wx.evaluate(() => {
      const z = document.querySelector(".eh-ips-zoom");
      const zi = document.querySelector(".eh-ips-zoom-img");
      return {
        hasZoom: !!z,
        zoomImgIsPng: !!zi && (zi.getAttribute("src") || "").startsWith("data:image/png"),
        tip: document.querySelector(".eh-ips-zoom-tip")?.textContent || null
      };
    });
    if (zoom.hasZoom) break;
    await wait(100);
  }
  if (!zoom.hasZoom && before) {
    // 兜底：真实鼠标点击再试一次
    await wx.mouse.click(before.x, before.y);
    await wait(500);
    zoom = await wx.evaluate(() => {
      const z = document.querySelector(".eh-ips-zoom");
      const zi = document.querySelector(".eh-ips-zoom-img");
      return {
        hasZoom: !!z,
        zoomImgIsPng: !!zi && (zi.getAttribute("src") || "").startsWith("data:image/png"),
        tip: document.querySelector(".eh-ips-zoom-tip")?.textContent || null
      };
    });
  }
  console.log("  点按钮后:", JSON.stringify(zoom));
  if (!zoom.hasZoom) fail("微信内点按钮未打开全屏大图（应避免触发下载）");
  if (!zoom.zoomImgIsPng) fail("全屏大图不是可长按保存的 <img>");
  if (!zoom.tip || !zoom.tip.includes("长按")) fail("全屏大图缺少长按保存提示");
  // 大图层必须铺满视口（验证 position:fixed 没被抽屉的 transform 困住）
  const zoomBox = await wx.evaluate(() => {
    const z = document.querySelector(".eh-ips-zoom");
    if (!z) return null;
    const r = z.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), vw: window.innerWidth, vh: window.innerHeight, pos: getComputedStyle(z).position };
  });
  console.log("  全屏层盒:", JSON.stringify(zoomBox));
  if (!zoomBox) fail("取不到全屏层");
  else {
    if (zoomBox.pos !== "fixed") fail("全屏层不是 position:fixed");
    if (zoomBox.w < zoomBox.vw - 2 || zoomBox.h < zoomBox.vh - 2) fail("全屏层未铺满视口（可能被抽屉容器限制）");
  }

  // ---------- B) 普通 UA ----------
  console.log("\n== B) 普通浏览器 UA（桌面 Chrome）==");
  const pc = await browser.newPage();
  await pc.setUserAgent(NORMAL_UA);
  await pc.setViewport({ width: 1280, height: 900 });
  await openInvite(pc, token);
  const b = await probe(pc);
  console.log("  DOM:", JSON.stringify(b, null, 2));
  if (!b.previewIsPngImg) fail("普通环境预览不是 <img>");
  if (b.hasLongPressBadge) fail("普通环境不应出现「长按保存」徽标");
  if (!b.btnText || !b.btnText.includes("下载")) fail("普通环境按钮文案应为下载");

  await browser.close();
  console.log(ok ? "\n✅ PASS：微信走长按保存、普通浏览器走下载，分支正确" : "\n❌ FAIL（见上）");
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
