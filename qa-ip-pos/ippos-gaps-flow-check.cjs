/* 本地端到端：IP 定位工作台「合并填空面板 + 待补标签」回归验证（不跑真实生成、不扣算力）。
 * 复刻 2026-10-02 用户实测的问题 + 2026-10-03 用户的新要求：
 *   ① precheck 返回「只有 gaps、没有 issues」时，旧代码因陈旧闭包不暂停 → 面板根本不出现；
 *   ② 补全卡标签被表格竖线/提示词尾句污染 → 「需用户确认月预算 | 40% |」看不懂；
 *   ③ 2026-10-03（用户截图）「这两个合并成一个，都按第二个填空的方式」——体检 issues 与运营
 *      gaps 必须渲染在**同一个填空面板**里（体检项带暖色标签），不再有独立的体检块和双按钮。
 * 做法：直接种一份「已交付」草稿（含截图同款脏标记）+ 打桩 precheck（issues=1 + gaps=5），
 *      断言 合并面板出现 & 不自动开跑 & 放行按钮真能开跑 & 体检项填的值也进需求单 & 无旧块残留。
 * 跑法：node qa-ip-pos/ippos-gaps-flow-check.cjs
 */
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const os = require("os");
const path = require("path");
const CHROME = "/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const BASE = "http://127.0.0.1:5174";
const API = "http://127.0.0.1:3011";
const SKU = "ipzone__ip-pos";
const WORKBENCH = `${BASE}/agent/${SKU}/workbench`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const fails = [];
const check = (cond, msg) => { console.log(`${cond ? "✓" : "✗"} ${msg}`); if (!cond) fails.push(msg); };

// 截图同款脏数据：6.4 月度预算表 3 行同一标记 + 提示词尾句泄漏 + 散文式标记
const PAYLOAD = {
  meta: { brand: "测试烧腊", industry: "餐饮", goal: "获客", generatedAt: "2026-10-02" },
  overview: {
    project: "广式现制烧腊", user: "周边写字楼白领", persona: "厨师出身的实在老板", archetype: "领路型",
    ip_status: "起步期", content_focus: "门店信任感", platform: "抖音", month_actions: "每周 3 条出镜"
  },
  stats: { topic_total: 80, by_type: { trust: 22, cognitive: 22, connection: 22, conversion: 14 } },
  validation: { passed: true, errors: [] },
  sections: {
    ads: [
      "六、投流建议",
      "",
      "### 6.4 月预算分配",
      "| 项目 | 金额 | 占比 |",
      "|---|---|---|",
      "| DOU+ | 待补充：需用户确认月预算 | 60% |",
      "| 本地推 | 待补充：需用户确认月预算 | 40% |",
      "| **合计** | 待补充：需用户确认月预算** | **100%** |",
      "",
      "| 场景 | 金额 | 范围 |",
      "|---|---|---|",
      "| 城市定向 | 待补充：需用户确认目标城市」，不要编造。 | 5km |"
    ].join("\n"),
    execution: ["八、执行建议", "", "门店数：待补充：门店数。"].join("\n")
  }
};

const BRIEF = {
  role: "老板本人下场出镜", project: "广式现制烧腊三店", biz: "堂食+外卖", comp: "老牌烧腊店与连锁快餐",
  user: "1.5km 内白领与家庭客", founder: "12 年厨师出身", goal: "给新店养熟客", status: "粉丝 4300/抖音"
};

(async () => {
  const loginRes = await fetch(API + "/auth/dev-login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ productCode: "lanqi" })
  }).then((r) => r.json()).catch(() => ({}));
  const token = loginRes.token || "";
  if (!token) { console.log("✗ dev-login 失败"); process.exit(1); }
  console.log("✓ dev-login 成功");

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ippos-gaps-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, userDataDir,
    args: ["--no-proxy-server", "--no-sandbox", "--disable-gpu"]
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)));

  let precheckHits = 0, runHits = 0, runBody = "", completeHits = 0;
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url(), method = req.method();
    const cors = {
      "access-control-allow-origin": BASE,
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "authorization,content-type",
      "access-control-allow-methods": "POST,OPTIONS"
    };
    if (url.includes("/precheck")) {
      if (method === "OPTIONS") return req.respond({ status: 204, headers: cors, body: "" });
      precheckHits += 1;
      // 2026-10-03：issues 也给**填空句**（sentence）——与 gaps 合并进同一个填空面板；
      // 旧代码这里只认 followup（疑问句 + 独立的体检块），本脚本用来卡住回归。
      return req.respond({
        status: 200, contentType: "application/json", headers: cors,
        body: JSON.stringify({
          ok: true, degraded: false,
          issues: [
            {
              slot: "stage", verdict: "weak",
              sentence: "我在抖音和小红书主要发【内容方向】，其中带来过加盟咨询的有【咨询数】条",
              followup: "抖音和小红书这两个号分别主要发什么内容，目前有没有哪条内容带来过加盟咨询？"
            }
          ],
          gaps: [
            { area: "预算/投放", sentence: "我希望主投【目标城市】，每月投放预算【月预算】" },
            { area: "产品/定价", sentence: "加盟费约【加盟费】，设备物料约【物料成本】" },
            { area: "团队/规模", sentence: "目前总部【人数】人，今年计划开到【门店数】家加盟店" },
            { area: "渠道/内容", sentence: "主阵地是【平台】，已有【案例数】个可引用的真实案例" },
            { area: "转化/承接", sentence: "加盟咨询由【承接人】承接，目前每月【线索量】条线索" }
          ]
        })
      });
    }
    if (url.includes("/run") && method === "POST") {
      runHits += 1;
      try { runBody = req.postData() || ""; } catch { /* ignore */ }
      return req.abort();
    }
    if (url.includes("/ip-pos/complete") && method === "POST") {
      completeHits += 1;
      // 桩：模拟小模型二次加工——把章节里所有待补充标记清掉（测试填满后零残留；真实替换逻辑由单测覆盖）。
      const sections = JSON.parse(JSON.stringify(PAYLOAD.sections));
      for (const k of Object.keys(sections)) {
        sections[k] = sections[k].replace(/【待补(?:充)?[^】]{0,40}】|待补(?:充)?[:：][^<\n]{0,40}/g, "");
      }
      return req.respond({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ sections, consumedCredits: 25 }) });
    }
    req.continue();
  });

  await page.goto(BASE + "/agents", { waitUntil: "domcontentloaded", timeout: 45000 });
  // 指纹必须用**与 readSessionIdentity 完全一致**的规则算：JWT 里 tenantId/userId 都是字符串才用
  // `tenantId:userId`，否则退回 token 末 8 位（node 侧自己拆 JWT 容易与前端不一致 → payload 读不回来）。
  const seededFp = await page.evaluate((t, s, payload, draft) => {
    localStorage.setItem("store_os_token", t);
    let fp = "";
    const parts = t.split(".");
    if (parts.length === 3) {
      try {
        const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const p = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
        if (typeof p.tenantId === "string" && typeof p.userId === "string") fp = `${p.tenantId}:${p.userId}`;
      } catch { /* 兜底 */ }
    }
    if (!fp) fp = t.slice(-8);
    localStorage.setItem(`sitong_ippos_payload_${s}`, JSON.stringify({ fp, payload, savedAt: Date.now() }));
    localStorage.setItem(`ippos_chat_draft_${s}`, JSON.stringify(draft));
    return fp;
  }, token, SKU, PAYLOAD, {
    v: 1, phase: "confirm", qi: 5, optsQ: null, confirmOpts: true, brief: BRIEF, genCandidates: null,
    messages: [
      { id: 1, who: "ai", html: "先确认一下你的角色？" },
      { id: 2, who: "user", html: BRIEF.role },
      { id: 3, who: "ai", html: "简报齐了，可以生成了。" }
    ]
  });
  console.log(`✓ 已种入交付物草稿，会话指纹=${seededFp}`);

  await page.goto(WORKBENCH, { waitUntil: "domcontentloaded", timeout: 45000 });
  await wait(2000);
  // 进页会**自动播演示**（2026-10-01 设计）→ 先停掉，回到我们种的那一帧
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("停止演示"));
    if (b) b.click();
  });
  await wait(1500);

  // ---------- ① 结果区一级 tab：交付内容 / 增强项目（2026-10-03：右栏 → 全宽 tab 切换）----------
  const vt = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll(".cpw-view-tabs .cpw-vtab")].map((b) => (b.textContent || "").replace(/\s+/g, " ").trim()),
    active: (document.querySelector(".cpw-view-tabs .cpw-vtab.act")?.textContent || "").replace(/\s+/g, " ").trim(),
    rail: document.querySelectorAll(".cpw-enh-rail").length,
    grid: document.querySelectorAll(".cpw-dl-grid").length,
    pieces: document.querySelectorAll(".cpw-pc").length,
    panel: document.querySelectorAll(".cpw-enh-panel").length
  }));
  console.log("\n=== 结果区一级 tab ===");
  console.log(JSON.stringify(vt, null, 1));
  check(vt.tabs.length === 2, `结果区顶部是一级 tab：交付内容 / 增强项目（实测 ${vt.tabs.length} 个）`);
  check(vt.tabs.some((t) => t.includes("交付内容")), "有「📄 交付内容」tab");
  check(vt.tabs.some((t) => t.includes("增强项目")), "有「✨ 增强项目」tab（带条数）");
  check(vt.rail === 0, "旧的右侧 320px 窄栏 .cpw-enh-rail 已删除（不再全部堆在一条里）");
  check(vt.grid === 0, "旧的左右分栏 .cpw-dl-grid 已删除");
  check(vt.active.includes("交付内容"), `默认停在「交付内容」视图（实测 act=「${vt.active}」）`);
  check(vt.pieces > 0, `默认视图里正文可见（${vt.pieces} 件）`);
  check(vt.panel === 0, "默认视图不显示增强项目面板（一次只给一件事，不再并排挤）");

  // 结果正文：待补充只以低调占位出现，不该有裸「待补充：xxx / 【待补」标记本体
  const chips = await page.evaluate(() => {
    const el = document.querySelector(".cpw-dl");
    return {
      count: document.querySelectorAll(".cpw-gap-chip").length,
      rawMarker: /(待补充[:：]|【待补|待补(?:充)?[:：])/.test(el?.textContent || "")
    };
  });
  check(chips.count >= 1, `结果正文把待补充渲染成低调占位 chip（共 ${chips.count} 个）`);
  check(!chips.rawMarker, "结果正文不再出现裸「待补充：… / 【待补」标记本体（只是占位，不像正文内容）");
  const badge = await page.evaluate(() => (document.querySelector(".cpw-badge-enh")?.textContent || "").trim());
  check(/可增强/.test(badge), `结果头显示「${badge}」角标，且是可点入口`);

  // 点角标 → 切到「增强项目」（全宽 + 章节 tab，一次只填一章）
  await page.evaluate(() => document.querySelector(".cpw-badge-enh")?.click());
  await wait(600);
  const enh = await page.evaluate(() => {
    const p = document.querySelector(".cpw-enh-panel");
    if (!p) return { found: false };
    return {
      found: true,
      width: Math.round(p.getBoundingClientRect().width),
      secTabs: [...p.querySelectorAll(".cpw-sec-tabs .cpw-stab")].map((t) => (t.textContent || "").replace(/\s+/g, " ").trim()),
      act: (p.querySelector(".cpw-stab.act")?.textContent || "").replace(/\s+/g, " ").trim(),
      rawText: (p.textContent || "").includes("原文："),
      btn: (p.querySelector(".enh-btn")?.textContent || "").trim()
    };
  });
  console.log("\n=== 增强项目（全宽 + 章节 tab）===");
  console.log(JSON.stringify(enh, null, 1));
  check(enh.found, "点「可增强 N 处」后出现全宽增强项目面板 .cpw-enh-panel");
  check(enh.found && enh.secTabs.length === 2, `面板内按章节分 tab，共 2 章（实测 ${enh.secTabs.length}）`);
  check(enh.found && enh.secTabs.some((t) => t.includes("六、投流建议")), "有「六、投流建议」章节 tab");
  check(enh.found && enh.secTabs.some((t) => t.includes("八、执行建议")), "有「八、执行建议」章节 tab");
  check(enh.found && enh.width > 600, `增强项目已占满内容宽（实测 ${enh.width}px；旧窄栏只有 320px）`);
  check(enh.found && !enh.rawText, "不再渲染重复的「原文：」一行（填空句本身已带上下文）");

  // 切到「六、投流建议」：一次只显示这一章的填空
  await page.evaluate(() => {
    [...document.querySelectorAll(".cpw-enh-panel .cpw-stab")].find((b) => (b.textContent || "").includes("六、投流建议"))?.click();
  });
  await wait(500);
  const ads = await page.evaluate(() => {
    const p = document.querySelector(".cpw-enh-panel");
    return {
      items: p.querySelectorAll(".enh-item").length,
      labels: [...p.querySelectorAll(".ei-label")].map((e) => (e.textContent || "").replace(/\s+/g, " ").trim()),
      blanks: [...p.querySelectorAll(".enh-blank")].map((e) => e.getAttribute("placeholder")),
      lines: [...p.querySelectorAll(".fill-line")].map((e) => (e.textContent || "").replace(/\s+/g, " ").trim()),
      act: (p.querySelector(".cpw-stab.act")?.textContent || "").replace(/\s+/g, " ").trim()
    };
  });
  console.log("\n=== 章节「六、投流建议」===");
  console.log(JSON.stringify(ads, null, 1));
  check(ads.act.includes("六、投流建议"), "章节 tab 高亮切到「六、投流建议」");
  check(ads.items === 2, `一次只显示本章 2 张填空卡（实测 ${ads.items}）`);
  check(ads.blanks.length === 2, `本章 2 个填空输入框（实测 ${ads.blanks.length}）`);
  check(["月预算", "目标城市"].every((n) => ads.blanks.includes(n)), "填空标签已归一（月预算/目标城市）");
  check(ads.labels.some((l) => l.includes("月预算")), "卡片顶部用缺口名做标签（月预算），不再重复章名");
  for (const junk of ["|", "｜", "**", "不要编造", "60%", "40%", "100%"]) {
    check(ads.blanks.every((b) => !b.includes(junk)), `填空标签不含垃圾「${junk}」`);
  }
  check(ads.labels.some((l) => l.includes("全章共 3 处")), "表格 3 处同标记合并为一张卡（全章共 3 处）");
  check(ads.lines.every((l) => !l.includes("待补充") && !l.includes("待补：")), "填空句里不含裸「待补充：xxx」标记（同行两标记的残留已修）");

  // 切到「八、执行建议」
  await page.evaluate(() => {
    [...document.querySelectorAll(".cpw-enh-panel .cpw-stab")].find((b) => (b.textContent || "").includes("八、执行建议"))?.click();
  });
  await wait(500);
  const execView = await page.evaluate(() => {
    const p = document.querySelector(".cpw-enh-panel");
    return {
      items: p.querySelectorAll(".enh-item").length,
      blanks: [...p.querySelectorAll(".enh-blank")].map((e) => e.getAttribute("placeholder")),
      lines: [...p.querySelectorAll(".fill-line")].map((e) => (e.textContent || "").replace(/\s+/g, " ").trim())
    };
  });
  check(execView.items === 1 && execView.blanks[0] === "门店数", "切到「八、执行建议」后只显示 1 张卡（门店数）——切 tab 真的换内容");
  check(execView.lines.every((l) => !l.includes("待补充")), "门店数卡的填空句不含裸标记");

  // 注：还原态 phase 恒为 confirm（产品设定：恢复后回到确认态让用户改简报重生成），
  // 而「补全并优化 →」按钮仅在 done 态（生成后）可点，故其实时点击只能在生成后路径测。
  // 「填空 → 二次加工 → 结果零残留【待补充】」由纯函数单测 ippos-enhance-check.ts 证明（applyFilledAnswers）。
  // 此处仅验证增强项目的填空交互位已正确落到受控输入、且按钮存在。
  const enhInputs2 = await page.$$(".cpw-enh-panel .enh-blank");
  await enhInputs2[0]?.click();
  await enhInputs2[0]?.type("5 家");
  await wait(200);
  const typed = await page.evaluate(() => document.querySelector(".cpw-enh-panel .enh-blank")?.value || "");
  check(typed === "5 家", "增强项目填空框是受控输入（键入值可落到 state）");
  check(!!(await page.$(".cpw-enh-panel .enh-btn")), "面板底部有「补全并优化 →」按钮");

  // ---------- ② 点生成：面板必须出现、且**不许**自动开跑 ----------
  const hasGenBtn = await page.evaluate(() => Boolean(document.querySelector(".cpw-big-btn.gen")));
  check(hasGenBtn, "恢复后停在确认阶段（有「生成定位全案」按钮）");
  await page.evaluate(() => document.querySelector(".cpw-big-btn.gen")?.click());
  await wait(2500);
  const gaps = await page.evaluate(() => {
    const g = document.querySelector(".cpw-gaps");
    if (!g) return { found: false };
    return {
      found: true,
      title: (g.querySelector(".ir-t")?.textContent || "").trim(),
      mix: (g.querySelector(".cpw-gaps-mix")?.textContent || "").trim(),
      sub: (g.querySelector(".cpw-gaps-sub")?.textContent || "").trim(),
      fills: g.querySelectorAll(".cpw-gap-fill").length,
      areas: [...g.querySelectorAll(".cpw-gap-area")].map((e) => ({ t: e.textContent.trim(), check: e.classList.contains("is-check") })),
      blanks: [...g.querySelectorAll(".cpw-gap-blank")].map((e) => e.getAttribute("placeholder")),
      freeInputs: g.querySelectorAll(".cpw-gap-in").length,
      note: (g.querySelector(".cpw-gap-note")?.textContent || "").trim(),
      escape: [...g.querySelectorAll("button")].map((b) => (b.textContent || "").trim().slice(0, 16)),
      legacyReview: document.querySelectorAll(".cpw-review").length,
      legacySkip: [...document.querySelectorAll("button")].filter((b) => /跳过体检|按提示补充/.test(b.textContent || "")).length
    };
  });
  // 2026-10-02（用户「不要这么说，应该表达补充会让效果更好」）：AI 消息与面板都不许再出现
  // 「不补也能生成 / 选答题 / 跳过 / 留空」这类消极措辞，改成正向表述。
  const NEG = /不补|跳过|留空|选答题|不填也能/;
  const aiSaid = await page.evaluate((negSrc) => {
    const t = document.body.innerText;
    const neg = new RegExp(negSrc);
    // 只看「生成后补问」这段 AI 消息：抓取包含「把空填上」的那条
    return { hasFill: t.includes("把空填上"), hasWeigh: t.includes("填多少都算数"), hasNeg: neg.test(t) };
  }, NEG.source);
  console.log("\n=== 点「生成」之后（合并填空面板）===");
  console.log(JSON.stringify(gaps, null, 1));
  console.log(`precheck 调用=${precheckHits}  /run 调用=${runHits}  填空引导=${JSON.stringify(aiSaid)}`);
  check(gaps.found, "合并后的补充面板出现了（旧代码此处永远为 false）");
  check(gaps.found && gaps.fills === 6, `体检补强 1 条 + 运营缺口 5 条合并进同一个面板，共 6 条填空题（实测 ${gaps.fills}）`);
  check(gaps.found && gaps.blanks.length === 12, `共解析出 12 个空当输入框（2 空 × 6 条，实测 ${gaps.blanks.length}）`);
  check(gaps.found && ["内容方向", "咨询数", "目标城市", "月预算", "人数", "门店数", "平台"].every((n) => gaps.blanks.includes(n)), "空里的名词就是提示语（内容方向/咨询数/目标城市/月预算/人数/门店数/平台）");
  check(gaps.found && gaps.freeInputs === 0, "全部走填空题，没有旧的自由输入框");
  check(gaps.found && gaps.areas.length === 6, `每条一个来源标签（实测 ${gaps.areas.length}）`);
  check(gaps.found && gaps.areas.filter((a) => a.check).length === 1, "体检补强项带暖色来源标签（is-check）");
  check(gaps.found && gaps.areas.filter((a) => !a.check).length === 5, "运营缺口保持蓝标签（来源可辨，但在同一块里）");
  check(gaps.found && (gaps.areas[0] || {}).t === "现状与投入", "体检项排在最前，标签用简报字段名「现状与投入」");
  check(gaps.found && /含体检补强 1 项/.test(gaps.mix || ""), "标题里交代「含体检补强 1 项」");
  check(/再补这 6 项/.test(gaps.title || ""), "标题是「💡 再补这 6 项，全案会更贴你的实际」");
  check(/更贴你的实际/.test(gaps.title || ""), "标题点明补充的价值（更贴你的实际）");
  check(/补充会让方案更准/.test(gaps.sub || ""), "副标题保持正向：补充会让方案更准");
  check(!NEG.test(gaps.title || "") && !NEG.test(gaps.sub || "") && !NEG.test(gaps.note || ""), "面板文案里不再出现「不补/跳过/留空/选答题/不填也能」");
  check(gaps.found && gaps.legacyReview === 0, "旧的独立体检块 .cpw-review 已删除（两个面板合并成一个）");
  check(gaps.found && gaps.legacySkip === 0, "不再有「跳过体检 / 按提示补充」双按钮（放行只需底部那一个 CTA）");
  check(aiSaid.hasFill && aiSaid.hasWeigh, "AI 消息改成「按句子把空填上 + 填多少都算数」");
  check(runHits === 0, "有补充项时**没有**自动开跑（不拦人，等用户决定）");

  // ---------- ③ 填空 → 放行：填的值必须进 /run 需求单，且不许死循环 ----------
  check(!!gaps.escape && gaps.escape.some((t) => t.includes("补充好了，直接生成")), "按钮改成正向 CTA「补充好了，直接生成」");
  // 第 1 条是**体检补强项**（现状与投入）→ 两个空全填；验证「体检项填的也进生成」
  const fillBlocks = await page.$$(".cpw-gaps .cpw-gap-fill");
  const checkBlanks = fillBlocks[0] ? await fillBlocks[0].$$(".cpw-gap-blank") : [];
  if (checkBlanks[0]) { await checkBlanks[0].click(); await checkBlanks[0].type("探店口播"); }
  if (checkBlanks[1]) { await checkBlanks[1].click(); await checkBlanks[1].type("3"); }
  // 第 2 条（预算/投放）**两个空全填** → 应还原成整句
  const itsBlanks = fillBlocks[1] ? await fillBlocks[1].$$(".cpw-gap-blank") : [];
  if (itsBlanks[0]) { await itsBlanks[0].click(); await itsBlanks[0].type("上海、杭州"); }
  if (itsBlanks[1]) { await itsBlanks[1].click(); await itsBlanks[1].type("3 万"); }
  // 第 3 条（产品/定价）**只填一个空** → 「部分填写也必须应用」（报「名词：值」，不拼病句）
  const b2 = fillBlocks[2] ? await fillBlocks[2].$$(".cpw-gap-blank") : [];
  if (b2[0]) { await b2[0].click(); await b2[0].type("12 万"); }
  await wait(300);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll(".cpw-gaps button")].find((x) => (x.textContent || "").includes("补充好了"));
    if (b) b.click();
  });
  await wait(2000);
  check(runHits >= 1, `点「补充好了，直接生成」后真的开跑了（/run 调用 ${runHits} 次）`);
  console.log("\n=== /run 需求单里的补充信息 ===");
  const supp = /【预采集补充】[^"\\]*/.exec(runBody || "");
  console.log(supp ? supp[0] : "(未捕获到补充信息)");
  check(!!supp && supp[0].includes("现状与投入：我在抖音和小红书主要发探店口播，其中带来过加盟咨询的有3条"), "体检补强项填的值也进了需求单（合并后体检项走同一条补充链路）");
  check(!!supp && supp[0].includes("预算/投放：我希望主投上海、杭州，每月投放预算3 万"), "全填的那条还原成整句进了需求单");
  check(!!supp && supp[0].includes("产品/定价：加盟费：12 万"), "**只填一半**的那条也进了需求单（报「名词：值」，不拼病句）");

  // ---------- ③-b 用户填的「额外补充」必须展示在右侧定位简报里 ----------
  const extra = await page.evaluate(() => {
    const e = document.querySelector(".cpw-brief-extra");
    if (!e) return { found: false };
    return {
      found: true,
      key: (e.querySelector(".cpw-be-k")?.textContent || "").replace(/\s+/g, "").trim(),
      lines: [...e.querySelectorAll(".cpw-be-line")].map((x) => x.textContent.trim())
    };
  });
  console.log("\n=== 右侧定位简报 · 额外补充 ===");
  console.log(JSON.stringify(extra, null, 1));
  check(extra.found, "点生成后，右侧定位简报里出现了「额外补充」块");
  check(extra.found && extra.key.includes("额外补充"), "块标题就是「额外补充」");
  check(extra.found && extra.lines.some((l) => l.includes("现状与投入") && l.includes("探店口播")), "体检补强项填的内容也展示在简报里（合并后一视同仁）");
  check(extra.found && extra.lines.some((l) => l.includes("预算/投放") && l.includes("上海、杭州") && l.includes("3 万")), "全填的那条以整句展示在简报里");
  check(extra.found && extra.lines.some((l) => l.includes("产品/定价") && l.includes("12 万")), "只填一半的那条也展示在简报里");

  // ---------- ④ 不许重复提醒：run 失败退回确认页后，再点生成直接开做 ----------
  const precheckBefore = precheckHits;
  const panelAfterFail = await page.evaluate(() => ({
    gaps: Boolean(document.querySelector(".cpw-gaps")),
    genBtn: Boolean(document.querySelector(".cpw-big-btn.gen"))
  }));
  check(!panelAfterFail.gaps, "展开过一次后，失败退回确认页不再挂着补问面板（不重复提醒）");
  check(panelAfterFail.genBtn, "退回确认页仍可再点「生成定位全案」");
  runBody = "";
  await page.evaluate(() => document.querySelector(".cpw-big-btn.gen")?.click());
  await wait(2500);
  check(precheckHits === precheckBefore, `第二次点生成**不再重复体检**（precheck 仍为 ${precheckHits} 次）`);
  check(!(await page.evaluate(() => Boolean(document.querySelector(".cpw-gaps")))), "第二次点生成也不会再弹一遍补问面板");
  check(runHits >= 2, `第二次点生成直接开做（/run 累计 ${runHits} 次）`);
  const supp2 = /【预采集补充】[^"\\]*/.exec(runBody || "");
  console.log("\n=== 第二次 /run 的补充信息（重试不能丢）===");
  console.log(supp2 ? supp2[0] : "(未捕获到补充信息)");
  check(!!supp2 && supp2[0].includes("预算/投放：我希望主投上海、杭州，每月投放预算3 万"), "重试时用户填的补充信息仍在（快照兜住，没被丢掉）");

  console.log(`\n页面 JS 错误数: ${pageErrors.length}`);
  pageErrors.slice(0, 5).forEach((e) => console.log("   ⚠ " + e));
  check(pageErrors.length === 0, "无 JS 报错");

  await browser.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  console.log(fails.length === 0 ? "\nALL PASS ✅（仅本地验证，未部署）" : `\nFAILED ${fails.length} ❌`);
  process.exit(fails.length === 0 ? 0 : 1);
})().catch((e) => { console.error("脚本异常：", e); process.exit(1); });
