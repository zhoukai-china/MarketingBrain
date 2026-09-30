const puppeteer = require("puppeteer-core");
const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const BASE = "http://127.0.0.1:5174";
const API = "http://127.0.0.1:3011";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--no-proxy-server", "--disable-gpu"]
  });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });

  // dev 登录拿 token
  const lr = await p.evaluate(async (api) => {
    const r = await fetch(api + "/auth/dev-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
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
  await wait(3500);

  // 找到「本地单店老板」选项并点击（选项是 <button class="cpw-opt">）
  const clicked = await p.evaluate(() => {
    const opts = Array.from(document.querySelectorAll("button.cpw-opt"));
    if (opts.length === 0) return "no-cpw-opt";
    const hit = opts.find((el) => /本地单店老板/.test(el.textContent || ""));
    if (!hit) return "not-found:" + opts.map((o) => (o.textContent || "").slice(0, 8)).join("|");
    hit.click();
    return "clicked";
  });
  await wait(2000);

  const after = await p.evaluate(() => {
    const body = document.body.innerText;
    const i = body.indexOf("明白了");
    return {
      digestSeen: i >= 0 ? body.slice(i, i + 120).replace(/\s+/g, " ") : "(未找到消化回应)",
      // 新文案的独特短语（只有「本地单店」那条 digest 才有）
      hasLocalDigest: /本地获客型创始人IP/.test(body),
      hasChainDigest: /招商获客型创始人IP/.test(body),
      hasChainClaim: /连锁品牌总部，老板本人出镜/.test(body)
    };
  });

  console.log("点击「本地单店老板」:", clicked);
  console.log("消化回应:", after.digestSeen);
  console.log("出现「本地获客型创始人IP」(应 true):", after.hasLocalDigest);
  console.log("出现「招商获客型创始人IP」(应 false):", after.hasChainDigest);
  console.log("出现「连锁品牌总部，老板本人出镜」(应 false):", after.hasChainClaim);

  const ok = clicked === "clicked" && after.hasLocalDigest && !after.hasChainDigest && !after.hasChainClaim;
  console.log(ok ? "\nPASS: 选「本地单店」，回应已匹配" : "\nFAIL: 仍未匹配（注意 dev server 是否热更新）");
  await b.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
