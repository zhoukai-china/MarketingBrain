const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const fs = require("fs");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  await p.goto("file:///Users/zhoukai/code/MarketingBrain/docs/prototypes/agents-home-tech-demo-20260925.html", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 2500));
  const data = await p.evaluate(() => {
    // 直接读原型全局变量
    const raw = typeof CASE_DATA !== "undefined" ? CASE_DATA : null;
    if (!raw) return { err: "no CASE_DATA" };
    return raw.map((c, i) => ({
      i,
      cat: c.cat, ref: c.ref, refName: c.refName || "",
      img: c.img, tag: c.tag, gain: c.gain, gainSub: c.gainSub || "",
      title: c.title, sub: c.sub,
      before: c.before || "", steps: c.steps || [], cost: c.cost || "", result: c.result || "", inspire: c.inspire || "",
      use: c.use || ""
    }));
  });
  console.log("案例总数:", data.length);
  console.log(data.map(c => `${c.i}: [${c.cat}] ${c.tag} | ${c.title} | use:${c.use} | img:${c.img}`).join("\n"));
  // 字段结构（第 0 条）
  console.log("\n字段样例:", JSON.stringify(data[0], null, 2).slice(0, 1200));
  fs.writeFileSync("/tmp/case-data-raw.json", JSON.stringify(data, null, 2));
  console.log("saved /tmp/case-data-raw.json");
  await b.close();
})();
