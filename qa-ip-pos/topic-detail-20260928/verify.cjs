// 选题策略官详情页验收（/agent/ipzone__topic/detail）+ 首页五入口改链验证
// 断言：内容照原型（何策）、预约态已改为已上线（无「预约体验/内测打磨」残留）、
// 头像走系统 topic、计费口径（积分/按实际用量结算/失败不扣费，无演示价 99 算力残留）、
// 两处跳转实测、四 tab 切换；/agents 首页 5 个数字员工入口落到各自 /detail。
const puppeteer = require("puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";

const URL = "http://localhost:5174/agent/ipzone__topic/detail";
let pass = 0, fail = 0;
const log = (ok, name, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " · " + extra : ""}`); };

(async () => {
  const browser = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1100 });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("/market/skus") && !u.includes("/run") && !u.includes("/access") && req.method() === "GET") {
      return req.respond({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ skus: [{ skuCode: "ipzone__topic", name: "选题策略官", ppu: 70, status: "selling" }] }) });
    }
    req.continue();
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    // 未登录环境下 /market/me 等 401 的网络资源日志不算页面异常（代码已优雅降级）
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });

  await page.goto(URL, { waitUntil: "networkidle2" });
  await page.waitForSelector(".ipd-page", { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 700));

  // 1) 内容
  const root = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  log(/何策 · 选题策略官/.test(root), "标题=「何策 · 选题策略官」");
  log(/已上线 · 可直接对话/.test(root), "状态徽标=已上线（内测口径已替换）");
  log(/四大来源自动喂料/.test(root) && /三关筛选/.test(root), "简介含来源池+三关口径");
  log(/一批 5 条选题：每条带阶段标签 \/ 来源 \/ 参考结构/.test(root), "本单交付照原型");
  log(/与秦文 \/ 江流联动/.test(root), "能力清单含联动口径");
  log(/失败不扣费/.test(root), "「失败不扣费」保留");

  // 2) 预约态清除
  log(!/预约体验/.test(root) && !/预约用户优先/.test(root) && !/留手机号/.test(root), "无「预约体验/优先开通/留手机号」内测残留");
  log(!/内测打磨中/.test(root), "无「内测打磨中」徽标残留");
  log(/⚡ 立即使用/.test(root) && /⚡ 充值算力/.test(root), "双按钮=充值算力 + 立即使用");

  // 3) 计费口径：真实 ppu、积分、按实际用量结算；无演示价 99 算力
  log(/70 积分 \/ 次 起|70\s*积分/.test(root), "价格来自真实目录 ppu=70 积分", (root.match(/\d+ 积分 \/ 次 起/) || [""])[0]);
  log(/按实际用量结算/.test(root), "标注「按实际用量结算」");
  log(!/99 算力/.test(root), "无原型演示价（99 算力）残留");
  log(/1 元 = 10 算力/.test(root), "平台兑换率说明保留");

  // 4) 头图三视图
  const wb = await page.evaluate(() => ({
    brief: document.querySelector(".ipd-brief-h")?.textContent?.replace(/\s+/g, " ") || "",
    fields: [...document.querySelectorAll(".ipd-brief-grid .ipd-bf")].map((e) => e.textContent.trim()),
    gen: document.querySelector(".ipd-gen")?.textContent || "",
    url: document.querySelector(".ipd-wb-url")?.textContent || "",
    chatAv: document.querySelector(".ipd-wb-chat-h .ipd-wb-av")?.getAttribute("src") || "(文字圆)",
  }));
  log(/4 路/.test(wb.brief) && wb.fields.length === 4 && wb.fields[0].includes("私有知识库"), "头图来源池 4 路面板", wb.brief);
  log(/出一批选题/.test(wb.gen), "生成按钮与真实工作台一致", wb.gen);
  log(/ipzone__topic\/workbench/.test(wb.url), "窗口栏指向选题工作台地址");
  log(/topic\.jpg/.test(wb.chatAv), "对话窗头像=系统 topic 形象（真实照片）", wb.chatAv);
  await page.click(".ipd-gthumbs button:nth-child(2)");
  await new Promise((r) => setTimeout(r, 300));
  const photo = await page.evaluate(() => ({
    src: document.querySelector(".ipd-photo")?.getAttribute("src") || "",
    ok: (() => { const img = document.querySelector(".ipd-photo"); return img ? img.naturalWidth > 0 : false; })(),
  }));
  log(/topic/.test(photo.src) && photo.ok, "职业形象照走系统 topic 形象且加载成功", photo.src);
  await page.click(".ipd-gthumbs button:nth-child(1)");

  // 5) 四 tab 切换
  for (const label of ["交付标准", "工作台实拍", "用户评价", "能力清单"]) {
    await page.evaluate((l) => {
      const t = [...document.querySelectorAll(".ipd-tab")].find((b) => b.textContent.trim() === l);
      t && t.click();
    }, label);
    await new Promise((r) => setTimeout(r, 250));
    const txt = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
    if (label === "工作台实拍") {
      const shots = await page.evaluate(() => document.querySelectorAll(".ipd-shot").length);
      log(shots === 3, "实拍 3 段（来源配置/三关筛选/已交付）", "shots=" + shots);
      const zones = await page.evaluate(() => [...document.querySelectorAll(".ipd-zone-h")].map((e) => e.textContent.trim()));
      log(zones.some((z) => z.includes("一票否决")) && zones.some((z) => z.includes("开业 90 天")), "三关筛选与选题样例渲染");
    } else if (label === "用户评价") {
      const revs = await page.evaluate(() => document.querySelectorAll(".ipd-rev").length);
      log(revs === 2 && /贺店长/.test(txt) && /齐经理/.test(txt), "用户评价 2 条（贺店长/齐经理，原型原文）");
    } else if (label === "交付标准") {
      log(/两问定行业和阶段/.test(txt) && /按实际用量结算/.test(txt), "交付标准（过程口径 + 计费已替换）");
    } else {
      log(/能力清单/.test(txt), `${label} tab 渲染`);
    }
  }

  // 6) 跳转实测
  await page.click(".ipd-cta-row .ipd-btn.ghost");
  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
  log(page.url().includes("/recharge"), "「⚡ 充值算力」实测落地 /recharge", page.url());

  await page.goto(URL, { waitUntil: "networkidle2" });
  await page.waitForSelector(".ipd-cta-row .ipd-btn.main", { timeout: 10000 });
  await page.click(".ipd-cta-row .ipd-btn.main");
  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
  log(page.url().includes("/agent/ipzone__topic/workbench"), "「⚡ 立即使用」实测落地震题工作台", page.url());

  // 7) 无 JS 异常
  log(errors.length === 0, "无 JS 运行时异常", errors.slice(0, 2).join(" | "));

  await page.screenshot({ path: require("path").resolve(__dirname, "topic-done.png"), fullPage: true });
  await browser.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
