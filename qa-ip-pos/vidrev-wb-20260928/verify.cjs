// 视频复盘工作台验收（/agent/ipzone__vidrev/workbench）
// 断言：问候话术、拖拽上传→客户端体检（按天汇总 fail-closed 拒收 / 逐条明细通过）、
// 成交金额确认、复述参数、体检面板徽标与覆盖 chips、生成诚实进度（结果未返回前 <100%）、
// 交付复用 VidrevReport（与 chat 同源渲染）、计费口径（积分/按用量结算/失败不扣费）。
const puppeteer = require("puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";

const URL = "http://localhost:5174/agent/ipzone__vidrev/workbench";
let pass = 0, fail = 0;
const log = (ok, name, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " · " + extra : ""}`); };

const DEEP_PAYLOAD = {
  kind: "vidrev", mode: "deep",
  data_quality: { total_records: 4, completion_coverage: 0.9, completion_status: "ok", comment_status: "ok", publish_time_precision: "day", paid_flag: "missing", limited_dimensions: ["投流标记缺失 → 无法区分自然流 / 付费流"] },
  overview: { video_count: 4, total_plays: 49200, total_engagement: 2812, engagement_rate: 0.057, total_conversions: 23, ad_spend: null, roi: null, roi_note: "成交金额缺失，ROI 按缺失处理", trend: "上升", baseline_compare: { median_plays: 11750, median_engagement: 640 }, median_plays: 11750, median_conversions: 5 },
  quadrant: { both: ["餐饮招商v3-加盟商访谈"], plays_no_conv: ["餐饮招商v2-老板出镜"], conv_no_plays: [], neither: ["餐饮招商v4-避坑指南"], notes: [] },
  content_health: { distribution: [{ type: "招商", count: 4, share: 1, avg_plays: 12300, engagement_rate: 0.057, completion_rate: 0.31, verdict: "主力类型" }], health_score: 72, verdict: "基本健康", adjust: { add: ["加盟商访谈"], cut: [], change: [] } },
  deep_dive: [{ video_id: "v3", title: "餐饮招商v3-加盟商访谈", metrics: { plays: 21500 }, reasons: ["真实案例 + 转化引导前置"], reusable: ["访谈形式"], improve: ["前3秒加入数字钩子"] }],
  completion_attrib: { by_duration: [{ bucket: "30-60s", count: 2, avgPlays: 11700, medianPlays: 11700, completionRate: 0.31, note: "" }], by_type: [{ type: "招商", completion_rate: 0.31 }], best_formula: "60s · 加盟商访谈" },
  engagement_depth: { shallow_rate: 0.05, deep_rate: 0.012, like_share_ratio: 6.4, verdict: "分享意愿强", top_sharers: [{ video_id: "v3", share_rate: 0.0035 }] },
  trend_alert: { baseline: { median_plays: 11750, warn_line: 5875, good_line: 17625, median_engagement: 640 }, weekly: [{ week: "W38", range: "08-25~08-31", count: 2, avgPlays: 11700, medianPlays: 11700 }, { week: "W39", range: "09-01~09-08", count: 2, avgPlays: 12900, medianPlays: 12900 }], alerts: [], positives: ["周播放量环比上升"] },
  patterns: { hook: "数字开头", topic: "加盟商真实案例", format: "访谈", timing: "周二 18:00", conversion: "评论区扣关键词" },
  methodology: [{ type: "选题", rule: "加盟商访谈播放中位数最高", evidence: "v3 播放 21500", confidence: "high", topic_hint: "再做一期加盟商回访" }],
  next_topics: { replicate: ["加盟商访谈系列"], reoptimize: ["避坑指南换钩子"], boost: ["v3 投 DOU+"], drop: [], candidates: [{ title: "加盟商回访：3 个月后赚了多少", reason: "复刻 v3", source: "方法论沉淀" }] },
  soft_warnings: [],
  report_markdown: "## 第零章 数据质量审计\n记录 4 条，投流标记缺失。\n\n## 一、数据总览\n总播放 49200。\n\n## 十、下个周期选题建议\n- 加盟商回访：3 个月后赚了多少"
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1100 });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("/market/skus") && !u.includes("/run") && !u.includes("/access") && !u.includes("/media/analyze") && req.method() === "GET") {
      return req.respond({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ skus: [{ skuCode: "ipzone__vidrev", name: "视频复盘智能体", ppu: 100, status: "selling" }] }) });
    }
    if (u.includes("/media/analyze") && req.method() === "POST") {
      // Excel 文档解析打桩：按文件名给不同文本（本测试只传 CSV，一般不会命中）
      return req.respond({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ documentText: "动态描述,播放量\n测试,100" }) });
    }
    if (u.includes("/market/skus/ipzone__vidrev/run") && req.method() === "POST") {
      // 校验结构化入参（与 /chat 的 buildVidrevRunBody 同构）
      const body = JSON.parse(req.postData() || "{}");
      global.__runBody = body;
      return setTimeout(() => req.respond({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ answer: DEEP_PAYLOAD.report_markdown, consumedCredits: 30, payload: DEEP_PAYLOAD }) }), 4000);
    }
    req.continue();
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(URL, { waitUntil: "networkidle2" });
  await page.waitForSelector(".cpw-stage", { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 900));

  // 1) 问候与骨架
  const root = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  log(/老板，我是江流/.test(root) && /先体检、再复盘/.test(root), "问候话术与原型一致");
  log(/视频复盘工作台/.test(root) && /江流/.test(root), "标题与数字员工（江流）");
  log(/待上传数据/.test(root), "体检徽标初始=待上传数据");
  log(/深度复盘 · 11 章/.test(root), "画布初始卡（11 章口径）");
  log(/把数据表拖到这里/.test(root), "拖拽上传框就位");

  // 2) fail-closed：先传「按天汇总」→ 拒收
  const fileInput = await page.$('input[type="file"]');
  await fileInput.uploadFile("/tmp/vidrev-daily.csv");
  await new Promise((r) => setTimeout(r, 900));
  const rej = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  log(/数据体检不通过/.test(rej) && /按天汇总/.test(rej), "按天汇总被拒收（fail-closed）");
  log(/本次不生成报告、不消耗算力/.test(rej), "拒收不扣算力明示");
  log(/体检不通过 · 换数据/.test(rej), "徽标=体检不通过·换数据");
  log(/把数据表拖到这里/.test(rej), "拒收后重新给出上传框");

  // 3) 传合规 CSV（视频号逐条明细）→ 体检通过
  await fileInput.uploadFile("/tmp/视频号动态数据明细_近30天.csv");
  await new Promise((r) => setTimeout(r, 900));
  const ok1 = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  log(/数据体检通过/.test(ok1), "合规 CSV 体检通过");
  log(/识别平台\s*视频号|平台 视频号|视频号/.test(ok1), "平台识别=视频号（来自文件名）");
  log(/4 条/.test(ok1), "记录数=4 条");
  log(/体检通过 · 待确认成交/.test(ok1), "徽标=体检通过·待确认成交");
  log(/有没有成交金额/.test(ok1), "追问成交金额（原型话术）");
  log(/字段覆盖/.test(ok1) && /✓ 播放量/.test(ok1), "字段覆盖 chips 渲染");

  // 4) 回复「有」→ 复述参数 + 可复盘
  await page.type(".cpw-input input", "有");
  await page.click(".cpw-input button");
  await new Promise((r) => setTimeout(r, 700));
  const ok2 = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  log(/复述一遍本次复盘参数/.test(ok2) && /ROI 可核算/.test(ok2), "复述参数话术（原型）");
  log(/体检通过 · 可复盘/.test(ok2), "徽标=体检通过·可复盘");
  const canGen = await page.evaluate(() => !document.querySelector(".cpw-big-btn.gen").disabled);
  log(canGen, "「📊 开始复盘」按钮解锁");

  // 5) 生成：诚实进度（stub /run 4s 返回；日志未走完前 <100%、无报告）
  await page.click(".cpw-big-btn.gen");
  await new Promise((r) => setTimeout(r, 1800));
  const mid = await page.evaluate(() => ({
    logLines: [...document.querySelectorAll(".cpw-genlog .cpw-ln")].map((e) => e.textContent),
    gening: document.querySelectorAll(".cpw-ph.gening").length,
    hasReport: !!document.querySelector(".vrv-stack"),
    pct: parseInt(document.querySelector(".cpw-gp-row b")?.textContent || "0", 10),
  }));
  log(mid.logLines.some((t) => t.includes("注入复盘参数 mode=deep")), "生成日志含复盘参数行");
  log(mid.logLines.every((t) => !t.startsWith("✅")), "后端未返回前日志不出「交付完成」行");
  log(mid.pct > 0 && mid.pct < 100, "后端未返回前进度条 < 100%", "pct=" + mid.pct);
  log(!mid.hasReport, "结果未返回前不出报告");

  // 6) 交付：VidrevReport 渲染（与 chat 同源）+ 费用
  await page.waitForSelector(".vrv-stack", { timeout: 30000 });
  const done = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  log(/已交付/.test(done), "交付头「✓ 已交付」");
  log(/第零章 数据质量审计/.test(done) || /数据质量审计/.test(done), "报告渲染（VidrevReport 与 chat 同源）");
  log(/本次实际消耗\s*30\s*积分/.test(done), "交付费用报实际积分（30 积分）");
  log(/按实际用量结算/.test(done), "计费口径=按实际用量结算");
  const rb = global.__runBody || {};
  log(rb.platform === "视频号" && rb.has_revenue_data === true && typeof rb.input === "string" && rb.input.includes("数据 / 描述"), "/run 结构化入参与 chat 同构（platform/period/has_revenue_data）", JSON.stringify({ platform: rb.platform, has_revenue_data: rb.has_revenue_data, period: rb.period }));

  // 7) 无 JS 异常
  log(errors.length === 0, "无 JS 运行时异常", errors.slice(0, 2).join(" | "));

  await page.screenshot({ path: require("path").resolve(__dirname, "vidrev-done.png"), fullPage: true });
  await browser.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
