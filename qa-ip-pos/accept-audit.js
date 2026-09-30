// Headless acceptance for MarketingBrain store-os audit fixes (2026-09-30).
// Verifies two pure client-side behaviors that do NOT need the backend:
//   1) Workbench login gate: /agent/<sku>/workbench without a token must redirect to /login.
//   2) Login page referral code (optional) field is rendered.
const puppeteer = require("puppeteer-core");

const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const BASE = "http://localhost:5174";

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} | ${name} | ${detail}`);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--no-proxy-server", "--disable-gpu", "--disable-dev-shm-usage"]
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

  // ---- Test 1: workbench login gate ----
  try {
    await page.goto(BASE + "/agent/ipzone__ip-pos/workbench", { waitUntil: "domcontentloaded" });
    // ensure a clean (logged-out) state, then reload to trigger the gate
    await page.evaluate(() => localStorage.removeItem("store_os_token"));
    await page.goto(BASE + "/agent/ipzone__ip-pos/workbench", { waitUntil: "domcontentloaded" });
    // the gate uses window.location.replace -> wait for URL to move to /login
    await page.waitForFunction(
      () => /(\/login)/.test(location.pathname),
      { timeout: 8000 }
    ).catch(() => {});
    const url = page.url();
    const redirected = /(\/login)/.test(new URL(url).pathname);
    record(
      "workbench-gate-redirect",
      redirected,
      redirected ? `redirected to ${new URL(url).pathname}` : `stayed at ${new URL(url).pathname}`
    );
  } catch (e) {
    record("workbench-gate-redirect", false, "exception: " + e.message);
  }

  // ---- Test 2: login page referral (optional) field ----
  try {
    await page.goto(BASE + "/login", { waitUntil: "networkidle2", timeout: 15000 });
    const hasReferral = await page.evaluate(() => {
      const input = document.querySelector('input[aria-label*="推荐码"]');
      const label = document.querySelector(".loginReferralField");
      return Boolean(input) && Boolean(label);
    });
    record("login-referral-field", hasReferral, hasReferral ? "found .loginReferralField + 推荐码 input" : "referral field NOT found");
  } catch (e) {
    record("login-referral-field", false, "exception: " + e.message);
  }

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(2);
});
