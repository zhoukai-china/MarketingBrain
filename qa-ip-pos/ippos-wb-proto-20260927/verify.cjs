// IP 定位工作台验收（原型对齐版 · /agent/ipzone__ip-pos/workbench）
// 断言：8 字段简报、6 问话术+digest、确认卡（99 算力双按钮）、生成日志+逐张点亮、
// 结果+日志双门槛才出交付、5 分区 tabs 交付区、后端同源（/precheck 与 /run 均被调用）。
const puppeteer = require("puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";

const URL = "http://localhost:5174/agent/ipzone__ip-pos/workbench";
let pass = 0, fail = 0;
const log = (ok, name, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " · " + extra : ""}`); };

const ANSWER = `# IP定位全案\n\n## 速览\n项目定位：手机后市场供应链驱动的连锁加盟\n\n## 一、项目定位\n**一句话定位**：帮想小成本创业的人以贴膜为入口做手机全链条生意。\n\n## 二、目标用户定位\n30-45岁想小成本创业的男性。\n\n## 三、IP人设定位\n供应链老炮，说话直接。\n\n## 四、内容定位\n信任型内容打头。\n\n## 五、选题方向\n- 选题1\n- 选题2\n\n## 六、投流建议\n前置门槛通过后 DOU+ 优先。\n\n## 七、IP发展规划\n三阶段路径。\n\n## 八、执行建议\n30天执行清单。`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1100 });

  const hit = { precheck: 0, run: 0 };
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("/precheck") && req.method() === "POST") {
      hit.precheck += 1;
      return req.respond({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ issues: [] }) });
    }
    if (u.includes("/market/skus/ipzone__ip-pos/run") && req.method() === "POST") {
      hit.run += 1;
      return setTimeout(() => req.respond({
        status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          answer: ANSWER, consumedCredits: 99,
          payload: {
            meta: { brand: "XX贴膜", industry: "手机后市场", goal: "招商获客", generatedAt: "2026-09-27" },
            overview: { project: "手机后市场供应链驱动的连锁加盟", user: "30-45岁想小成本创业的男性", persona: "供应链老炮", archetype: "领路型+同行型", ip_status: "抖音1.3w粉", content_focus: "信任型内容打头", platform: "抖音", month_actions: "信任型密集输出" },
            stats: { topic_total: 80, by_type: { trust: 40, cognitive: 30, connection: 20, conversion: 10 } },
            validation: { passed: true, errors: [] },
            topics: { trust: [], cognitive: [], connection: [], conversion: [], top10: [], calendar30: [] },
            sections: {
              positioning: "## 一句话定位\n帮想小成本创业的人以贴膜为入口做手机全链条生意。",
              user: "30-45岁想小成本创业的男性，「不知道做什么、怕被坑」。",
              ip: "供应链老炮，说话直接、不装。",
              content: "信任型内容打头：拍仓库、拍门店。",
              topics: "- 选题1\n- 选题2",
              ads: "前置门槛通过后 DOU+ 优先。",
              growth: "三阶段路径。",
              execution: "30天执行清单。"
            }
          }
        })
      }), 4500);
    }
    req.continue();
  });

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(URL, { waitUntil: "networkidle2" });
  await page.waitForSelector(".cpw-stage", { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 900));

  // 1) 骨架
  const root = await page.evaluate(() => ({
    h1: document.querySelector(".cpw-hero h1")?.textContent?.trim() || "",
    bar: document.querySelector(".cpw-url")?.textContent || "",
    bfLabels: [...document.querySelectorAll(".cpw-bf-k")].map((e) => e.textContent.trim()),
    phCount: document.querySelectorAll(".cpw-ph").length,
    body: document.body.innerText.replace(/\s+/g, " "),
  }));
  log(/IP定位工作台/.test(root.h1), "hero 标题=「IP定位工作台」", root.h1);
  log(/IP定位工作台/.test(root.bar), "舞台栏标题统一", root.bar);
  const expectLabels = ["角色 · 待填", "项目 · 待填", "商业模式 · 待填", "竞争格局 · 待填", "目标用户 · 待填", "创始人 · 待填", "IP目标 · 待填", "现状与投入 · 待填"]; // 风格B
  log(expectLabels.every((l) => root.bfLabels.includes(l)), "简报 8 字段与原型逐字一致");
  log(/0\/8/.test(root.body), "简报计数 0/8");
  log(root.phCount === 9, "画布 9 件结构预览", "ph=" + root.phCount);
  log(/你好，我是沈定，首席定位官/.test(root.body) && /6 步访谈/.test(root.body) && /99 算力 \/ 份/.test(root.body), "欢迎语与原型逐字一致");

  // 2) Q1 话术 + 3 chips；第 1 问用自由输入回答
  await page.waitForSelector(".cpw-opt", { timeout: 8000 });
  const q1 = await page.evaluate(() => ({
    opts: [...document.querySelectorAll(".cpw-opt")].map((b) => b.textContent.trim()),
  }));
  log(/先确认一下——你是老板本人，还是代运营？品牌是单店还是连锁？/.test(await page.evaluate(() => document.body.innerText)), "第 1 问话术逐字一致");
  log(q1.opts.length === 3 && q1.opts[0].includes("连锁品牌总部 · 老板本人"), "第 1 问 3 张选项卡与原型一致", q1.opts[0] || "无");
  // 2b) Q1 用 rec 选项回答（digest 固定话术只在 chip 路径出现）
  await page.click(".cpw-opts .cpw-opt:nth-child(1)");
  await new Promise((r) => setTimeout(r, 1100));

  // 2c) 舞台栏状态与简报计数同口径（都用 /8 字段数，不再 6/8 混用）
  const st = await page.evaluate(() => ({
    status: document.querySelector(".cpw-st span:last-child")?.textContent || "",
    meter: document.querySelector(".cpw-meter span")?.textContent || "",
  }));
  log(st.status.includes("引导中（1/8）") && st.meter.includes("1/8"), "舞台栏状态与简报计数同口径（/8）", `${st.status} vs ${st.meter}`);

  // 3) Q2-Q6 逐题点 rec 选项
  for (let i = 0; i < 5; i++) {
    await page.waitForSelector(".cpw-opt", { timeout: 8000 });
    await page.click(".cpw-opts .cpw-opt:nth-child(1)");
    await new Promise((r) => setTimeout(r, 1100));
  }
  const after = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  log(/8 项信息齐了 ✅/.test(after), "确认话术与原型一致");
  log(/明白了——连锁品牌总部，老板本人出镜/.test(after), "digest 消化回应与原型一致");
  log(/8\/8/.test(after), "简报计数 8/8");
  log(/本次交付：定位全案 9 件（速览 \+ 8 章）· 99 算力/.test(after), "确认态费用行=99 算力固定价");
  log(/✓ 确认，开始生成/.test(after) && /✎ 改一下再生成/.test(after), "确认卡双按钮与原型一致");

  // 3b) 确认态自由输入 = 追加说明（真实并入需求单）
  await page.type(".cpw-input input", "补充：我们主要做抖音");
  await page.click(".cpw-input button");
  await new Promise((r) => setTimeout(r, 600));

  // 4) 点确认 → 生成中：日志 + 点亮；结果+日志未齐不出交付
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".cpw-opt")].find((b) => b.textContent.includes("确认，开始生成"));
    btn && btn.click();
  });
  await new Promise((r) => setTimeout(r, 2500));
  const mid = await page.evaluate(() => ({
    logLines: [...document.querySelectorAll(".cpw-genlog .cpw-ln")].map((e) => e.textContent),
    gening: document.querySelectorAll(".cpw-ph.gening").length,
    hasDl: !!document.querySelector(".cpw-dl-head"),
  }));
  log(mid.logLines.some((t) => t.includes("Step1 项目定位 · 定位三角自检")), "生成日志带原型 Step 细节行", mid.logLines[mid.logLines.length - 1] || "");
  log(mid.gening >= 1, "9 件逐张点亮（gening 卡）", "gening=" + mid.gening);
  log(!mid.hasDl, "结果+日志未齐时不展示交付区");
  log(mid.logLines.every((t) => !t.startsWith("✅")), "后端未返回前日志不出「生成完成」行", `lines=${mid.logLines.length}`);
  const gp = await page.evaluate(() => parseInt(document.querySelector(".cpw-gp-row b")?.textContent || "0", 10));
  log(gp > 0 && gp < 100, "后端未返回前进度条 < 100%", "pct=" + gp);

  // 5) 交付
  await page.waitForSelector(".cpw-dl-head", { timeout: 30000 });
  const done = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll(".cpw-tab")].map((t) => t.textContent.trim()),
    pcs: [...document.querySelectorAll(".cpw-pc-h b")].map((b) => b.textContent.trim()),
    ovRow: document.querySelector(".cpw-pc-c table")?.textContent || "",
    body: document.body.innerText.replace(/\s+/g, " "),
    copyBtns: [...document.querySelectorAll(".cpw-cbtn")].map((b) => b.textContent.trim()),
  }));
  log(done.tabs.length === 6 && done.tabs[0].includes("全部 9"), "分区 tabs：全部/速览区/定位区/人设区/内容区/增长区", done.tabs.join("|"));
  log(done.pcs.length === 9, "交付 9 张单件卡（速览 + 8 章）", done.pcs.length + "");
  log(done.ovRow.includes("项目定位") && done.ovRow.includes("供应链驱动的连锁加盟"), "速览卡=overview 8 维表", done.ovRow.slice(0, 40));
  log(done.pcs.some((t) => t.includes("项目定位")) && done.pcs.some((t) => t.includes("执行建议")), "章节标题与原型一致");
  log(done.copyBtns.includes("⧉ 复制本件") && done.copyBtns.includes("↓ 导出 Word"), "复制本件/导出 Word 就位");
  log(/交付完成 ✅/.test(done.body) && /本次消耗 99 算力/.test(done.body), "交付话术报 99 算力");
  log(hit.precheck >= 1, "后端体检 /precheck 已调用（保留原能力）", "hits=" + hit.precheck);
  log(hit.run === 1, "后端 /run 已调用（同源）");

  // 6) 无 JS 异常
  log(errors.length === 0, "无 JS 运行时异常", errors.slice(0, 2).join(" | "));

  await page.screenshot({ path: require("path").resolve(__dirname, "ippos-done.png"), fullPage: true });
  await browser.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
