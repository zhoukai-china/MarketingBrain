const puppeteer = require("puppeteer-core");
const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--no-proxy-server", "--disable-gpu"]
  });
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 1000 });
  await p.goto("https://ai.lcppch.top/agents?tab=mine", { waitUntil: "networkidle2", timeout: 45000 });
  await wait(1800);

  const info = await p.evaluate(() => {
    const txt = document.body.innerText;
    const idBlock = document.querySelector(".me-id");
    const tag = document.querySelector(".eh-ph-tag");
    return {
      hasDemoTag: !!tag,
      demoTagText: tag ? tag.textContent.trim() : "(none)",
      idText: idBlock ? idBlock.innerText.replace(/\s+/g, " ").trim() : "(none)",
      mentionsDemo: txt.includes("演示账号"),
      mentionsVisitor: txt.includes("体验访客"),
      mentionsOldDate: txt.includes("2026-09-25")
    };
  });

  console.log("页面顶部的标签元素:", info.hasDemoTag ? info.demoTagText : "(已移除)");
  console.log("账号块文本:", info.idText);
  console.log("正文是否出现「演示账号」:", info.mentionsDemo);
  console.log("正文是否出现「体验访客」:", info.mentionsVisitor);
  console.log("正文是否出现「2026-09-25」:", info.mentionsOldDate);

  const ok = !info.hasDemoTag && !info.mentionsDemo && !info.mentionsVisitor && !info.mentionsOldDate;
  console.log(ok ? "\nPASS: 占位身份已清除" : "\nFAIL: 仍有残留");
  await b.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
