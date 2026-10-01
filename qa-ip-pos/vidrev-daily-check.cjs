/* 视频复盘 · 抖音「按天汇总」表识别验收
 * 1) 按天汇总 + 首行说明行 + GBK 编码 → 识别为「按天汇总」+ 平台抖音，不再误报「无法识别」
 * 2) 按天汇总 + UTF-8 → 同上
 * 3) 逐条作品明细 → 体检通过
 */
const puppeteer = require("puppeteer-core");
const fs = require("fs"), os = require("os"), path = require("path");
const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const BASE = "http://127.0.0.1:5174";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const token = await fetch("http://127.0.0.1:3011/auth/dev-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ productCode: "lanqi" }) }).then(r => r.json()).then(d => d.token || "");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vr-"));
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: dir, args: ["--no-proxy-server", "--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  await p.goto(BASE + "/agents", { waitUntil: "domcontentloaded" });
  await p.evaluate((t) => { localStorage.setItem("store_os_token", t); localStorage.removeItem("vidrev_chat_draft_ipzone__vidrev"); }, token);
  await p.goto(BASE + "/agent/ipzone__vidrev/workbench", { waitUntil: "domcontentloaded", timeout: 45000 });
  await wait(1800);
  await p.evaluate(() => { const el = document.querySelector(".cpw-demo-stop"); if (el) el.click(); });
  await wait(800);
  const input = await p.$("input[type=file]");
  if (!input) { console.log("没找到文件输入框"); process.exit(1); }

  const upload = async (file, name) => {
    await input.uploadFile(file);
    await wait(2400);
    return p.evaluate(() => {
      const body = document.body.innerText;
      return {
        daily: body.includes("按天汇总"),
        unknown: body.includes("无法识别的表结构"),
        unrecognizedPlatform: body.includes("没有识别出平台"),
        pass: body.includes("数据体检通过"),
        guide: body.includes("导出数据") && body.includes("作品数据")
      };
    }).then((r) => { console.log(`[${name}]`, JSON.stringify(r)); return r; });
  };

  const r1 = await upload("/tmp/vidrev-test/douyin-daily-gbk.csv", "按天汇总+说明行+GBK");
  const r2 = await upload("/tmp/vidrev-test/douyin-daily-utf8.csv", "按天汇总+UTF8");
  const r3 = await upload("/tmp/vidrev-test/douyin-per-item.csv", "逐条明细");
  const r4 = await upload("/Users/zhoukai/Downloads/视频号动态数据明细.csv", "视频号真实导出");

  const pass1 = r1.daily && r1.guide && !r1.unknown && !r1.unrecognizedPlatform;
  const pass2 = r2.daily && r2.guide && !r2.unknown && !r2.unrecognizedPlatform;
  const pass3 = r3.pass;
  console.log(`按天(GBK+说明行) → 识别为按天汇总+明确引导，不再误报「无法识别」: ${pass1 ? "PASS" : "FAIL"}`);
  console.log(`按天(UTF8) → 同上: ${pass2 ? "PASS" : "FAIL"}`);
  console.log(`逐条明细 → 体检通过: ${pass3 ? "PASS" : "FAIL"}`);
  const pass4 = r4.pass;
  console.log(`视频号真实导出 → 体检通过（回归）: ${pass4 ? "PASS" : "FAIL"}`);
  const all = pass1 && pass2 && pass3 && pass4;
  console.log(all ? "ALL PASS" : "HAS FAIL");
  await b.close(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(all ? 0 : 1);
})();
