const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const fs = require("fs");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  await p.goto("file:///Users/zhoukai/code/MarketingBrain/docs/prototypes/agents-home-tech-demo-20260925.html", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 2500));
  const out = await p.evaluate(() => {
    const cats = typeof CASE_CATS !== "undefined" ? CASE_CATS : [];
    const cases = CASE_DATA.map((c, i) => {
      let cover = "";
      const img = document.querySelector(`img[data-cimg="${c.img}"]`);
      if (img && (img.getAttribute("src") || "").startsWith("data:image")) cover = img.getAttribute("src");
      return { i, cat: c.cat, ref: c.ref, refName: c.refName || "", imgKey: c.img,
        tag: c.tag, gain: c.gain, gainSub: c.gainSub || "", title: c.title, sub: c.sub,
        before: c.before || "", steps: c.steps || [], cost: c.cost || "", cycle: c.cycle || "",
        metrics: c.metrics || [], inspire: c.inspire || "", use: c.use || "", cover };
    });
    return { cats, cases };
  });
  console.log("分类:", JSON.stringify(out.cats));
  console.log("案例数:", out.cases.length, "| 带封面:", out.cases.filter(c => c.cover).length);
  fs.mkdirSync("apps/web/public/mall", { recursive: true });
  out.cases.forEach((c) => {
    if (c.cover) {
      const ext = c.cover.includes("image/png") ? "png" : "jpg";
      fs.writeFileSync(`apps/web/public/mall/case${c.i}.${ext}`, Buffer.from(c.cover.split(",")[1], "base64"));
      c.cover = `/mall/case${c.i}.${ext}`;
    } else { c.cover = ""; }
  });
  fs.writeFileSync("/tmp/cases-v2.json", JSON.stringify({ cats: out.cats, cases: out.cases }, null, 2));
  console.log("covers exported, data saved");
  await b.close();
})();
