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
  // 点击后立刻检查节奏：占位在、下一题还没冒出来（上一句没说完不冒下一句）
  await wait(400);
  const early = await p.evaluate(() => ({
    hasThinking: !!document.querySelector(".cpw-bub .cpw-thinking"),
    nextQShown: /先说说你的项目吧/.test(document.body.innerText)
  }));
  console.log("点击后 400ms：占位显示 =", early.hasThinking, "｜下一题已提前出现 =", early.nextQShown);

  // 等模型成型（最多 10s；9s 超时会落兜底并推进）
  let digestSeen = "(等待超时)";
  for (let t = 0; t < 20; t++) {
    await wait(500);
    const done = await p.evaluate(() => !document.querySelector(".cpw-bub .cpw-thinking"));
    if (done) {
      digestSeen = await p.evaluate(() => {
        const i = document.body.innerText.indexOf("明白了");
        return i >= 0 ? document.body.innerText.slice(i, i + 70).replace(/\s+/g, " ") : "(已成型)";
      });
      break;
    }
  }
  // 成型检测发生在占位消失的瞬间，advance 的 600ms 停顿可能还没走完 → 再给 1.5s
  await wait(1500);
  const final = await p.evaluate(() => ({
    nextQShown: /先说说你的项目吧/.test(document.body.innerText),
    thinkingLeft: document.querySelectorAll(".cpw-bub .cpw-thinking").length
  }));
  console.log("成型后话术:", digestSeen);
  console.log("成型后下一题才出现:", final.nextQShown, "｜残留占位:", final.thinkingLeft);

  const ok = clicked === "clicked" && early.hasThinking && !early.nextQShown && final.nextQShown && final.thinkingLeft === 0;
  console.log(ok ? "\nPASS: 节奏正确——占位 → 成型 → 才问下一题" : "\nFAIL: 节奏不对");
  await b.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
