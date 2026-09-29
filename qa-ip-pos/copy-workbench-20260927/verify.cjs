// 文案工作台验收（原型对齐版 · /agent/ipzone__copy/workbench）
// 断言原型要素：6 问固定话术与选项 chips、简报 6 字段、确认话术、画布三态（占位/生成中日志+进度/分区 tabs 交付区）、
// 后端同源（stub /run 验证 UI 链路）、计费口径（积分·按用量结算·失败不扣费 tag）。
const puppeteer = require("puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";

const URL = "http://localhost:5174/agent/ipzone__copy/workbench";
let pass = 0, fail = 0;
const log = (ok, name, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " · " + extra : ""}`); };

const TEN = `一、选题策划（选题角度/爆款元素/脚本类型/漏斗层级/内容类型）
- 选题角度：养狗一年洗护轻松花 2000+，年卡 699 全年不限次
- 爆款元素：价格反差（算账类）+ 身份共鸣（铲屎官）
- 脚本类型：聊观点 + 算账
- 漏斗层级：AWARENESS → CONSIDERATION
- 内容类型：获客型

二、口播逐字稿（60秒）
**0-3s 钩子**【直视镜头，笑着提问】你家狗一个月洗澡花多少钱，算过吗？
**3-15s 痛点**散洗一次 88，一个月两次，一年就是两千多。

三、访谈话术
【问·情境式】您家毛孩子现在多久洗一次？
【答】一周一次，有时忙起来两周。

四、拍摄脚本
| 镜号 | 时间 | 景别 | 画面 |
| 1 | 0-15s | 近景 | 老板抱毛孩子正面口播 |

五、拍摄注意事项
- 着装：门店工服或围裙
- 收音：领夹麦必用

六、剪辑EDL
| 段落 | 画面 | 字幕特效 |
| 00:00-00:03 | 口播+B-roll 快切 | 大字钩子 |

七、发布标题与话题
📌 主标题：养狗一年洗护花 2000+？办张年卡 699 全年随便洗
🔁 备选1：为什么聪明铲屎官都办洗护年卡
话题：#养狗 #铲屎官 #宠物美容 #本地生活 #宠物店

八、最佳发布时间
- 抖音：周二/周三 18:00-19:00（备选 12:00-13:00）
- 策略：养宠上班族下班后决策意愿强

九、评论区引导
- 置顶评论：你家毛孩子多久洗一次？扣 1 / 2 / 3
- 意向转化：想带毛孩子来体验的，评论区留言「洗澡」

十、投流建议（PREVIEW_ONLY 草案）
- 自然跑 24h，完播 ≥ 25%、互动 ≥ 3% 再投
- 首测 100 元 / 24h / 智能定向`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1100 });

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("/market/skus") && !u.includes("/run") && !u.includes("/access") && req.method() === "GET") {
      return req.respond({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ skus: [{ skuCode: "ipzone__copy", name: "文案智能体", ppu: 15, status: "selling" }] }) });
    }
    if (u.includes("/market/skus/ipzone__copy/run") && req.method() === "POST") {
      // 延迟 4.5s（长于日志 ~9.8s? 不——日志 13 行 × 750ms ≈ 9.8s，先到的是 run），观察门槛：两者都完成才出交付
      return setTimeout(() => req.respond({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ answer: TEN, consumedCredits: 12, subscription: { covered: false } }) }), 4500);
    }
    req.continue();
  });

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(URL, { waitUntil: "networkidle2" });
  await page.waitForSelector(".cpw-stage", { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 900));

  // 1) 原型骨架
  const root = await page.evaluate(() => ({
    h1: document.querySelector(".cpw-hero h1")?.textContent?.trim() || "",
    hasChat: !!document.querySelector(".cpw-chat"),
    hasWs: !!document.querySelector(".cpw-ws"),
    hasTopbar: !!document.querySelector(".topbar, header nav, .topbar-nav"),
    briefTitle: document.querySelector(".cpw-brief-t b")?.textContent || "",
    bfLabels: [...document.querySelectorAll(".cpw-bf-k")].map((e) => e.textContent.trim()),
    body: document.body.innerText,
  }));
  log(/文案创作工作台/.test(root.h1), "hero 标题=「文案创作工作台」", root.h1);
  log(root.hasChat && root.hasWs, "双栏：暗色对话 + 浅色工作区");
  log(root.briefTitle.includes("创作简报"), "简报标题=「创作简报」");
  const expectLabels = ["产品 / 服务 · 待填", "核心卖点 · 待填", "投放平台 · 待填", "期望动作 · 待填", "交付深度 · 待填", "出镜方式 · 待填"]; // 风格B：图标改 SVG，文本不含 emoji
  log(expectLabels.every((l) => root.bfLabels.includes(l)), "简报 6 字段与原型逐字一致", root.bfLabels.join("|"));

  // 2) 欢迎语 + 第一问话术
  const q1 = await page.evaluate(() => ({
    text: document.body.innerText,
    opts: [...document.querySelectorAll(".cpw-opt")].map((b) => b.textContent.trim()),
  }));
  log(/一次只问一个问题/.test(q1.text) && /金牌文案主笔/.test(q1.text), "欢迎语与原型一致");
  log(/这次给什么产品 \/ 服务写文案？/.test(q1.text), "第 1 问话术逐字一致");
  log(q1.opts.some((o) => o.includes("宠物门店洗护年卡") && o.includes("演示示例：门店年卡锁客类")), "第 1 问选项 chips 与原型一致", q1.opts[0] || "无");

  // 3) 逐题点选项（product/selling/platform/action/depth/camera；depth 点第 2 项=「完整十件套」）
  const optIdx = [0, 0, 0, 0, 1, 0];
  for (let i = 0; i < 6; i++) {
    await page.waitForSelector(".cpw-opt", { timeout: 6000 });
    await page.click(`.cpw-opts .cpw-opt:nth-child(${optIdx[i] + 1})`);
    await new Promise((r) => setTimeout(r, 700));
  }
  const after = await page.evaluate(() => document.body.innerText);
  log(/齐了 ✅ 简报 6\/6/.test(after), "确认话术与原型一致", "齐了 ✅ 简报 6/6");
  log(/简报\s*6\/6|6\/6/.test(after), "简报计数 6/6");
  log(/完整内容十件套/.test(after), "交付深度显示「完整内容十件套」");
  log(/预计消耗约\s*15\s*算力/.test(after.replace(/\s+/g, " ")), "费用行=真实 ppu 15 算力（按用量结算）");
  log(/失败不扣费/.test(after), "「🛡️ 失败不扣费」tag（原型同款）");
  log((after.match(/选题策划/g) || []).length >= 1, "画布出现十件套结构预览");

  // 4) 点生成：日志+进度（原型 genlog），结果未齐不出交付
  await page.click(".cpw-big-btn.gen");
  await new Promise((r) => setTimeout(r, 2000));
  const mid = await page.evaluate(() => ({
    logLines: document.querySelectorAll(".cpw-genlog .cpw-ln").length,
    gening: document.querySelectorAll(".cpw-ph.gening").length,
    hasDl: !!document.querySelector(".cpw-dl-head"),
    hasProg: !!document.querySelector(".cpw-gen-prog"),
  }));
  log(mid.hasProg, "生成中出现进度条（原型 gen-prog）");
  log(mid.logLines > 0, "生成日志逐行出现（原型 genlog）", "lines=" + mid.logLines);
  log(!mid.hasDl, "结果+日志未齐时不展示交付区");

  // 5) 等待交付：分区 tabs + 单件卡
  await page.waitForSelector(".cpw-dl-head", { timeout: 30000 });
  const done = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll(".cpw-tab")].map((t) => t.textContent.trim()),
    pcs: [...document.querySelectorAll(".cpw-pc-h b")].map((b) => b.textContent.trim()),
    okTag: document.querySelector(".cpw-ok-tag")?.textContent || "",
    copyBtns: [...document.querySelectorAll(".cpw-cbtn")].map((b) => b.textContent.trim()),
    body: document.body.innerText.replace(/\s+/g, " "),
  }));
  log(done.okTag.includes("已交付"), "交付头「✓ 已交付」");
  log(done.tabs.length === 6 && done.tabs[0].includes("全部 10"), "分区 tabs：全部/策划/文稿/拍摄/发布/投流", done.tabs.join("|"));
  log(done.pcs.length === 10, "十件套 10 张单件卡", done.pcs.length + "");
  log(done.pcs.some((t) => t.includes("选题策划")) && done.pcs.some((t) => t.includes("口播逐字稿")) && done.pcs.some((t) => t.includes("投流建议")), "单件标题与原型一致");
  log(done.copyBtns.includes("⧉ 复制本件") && done.copyBtns.includes("↓ 导出 Word"), "复制本件/导出 Word 就位");
  log(/本次实际消耗\s*\d+\s*算力/.test(done.body), "交付后报实际消耗（算力口径）");

  // 6) tab 切换
  await page.evaluate(() => {
    const t = [...document.querySelectorAll(".cpw-tab")].find((x) => x.textContent.includes("文稿"));
    t && t.click();
  });
  await new Promise((r) => setTimeout(r, 300));
  const docCount = await page.evaluate(() => document.querySelectorAll(".cpw-pc").length);
  log(docCount === 2, "「文稿」tab 过滤出 2 件（口播稿+访谈）", "pcs=" + docCount);

  // 7) 无 JS 异常
  log(errors.length === 0, "无 JS 运行时异常", errors.slice(0, 2).join(" | "));

  await page.screenshot({ path: require("path").resolve(__dirname, "copy-done.png"), fullPage: true });
  await browser.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
