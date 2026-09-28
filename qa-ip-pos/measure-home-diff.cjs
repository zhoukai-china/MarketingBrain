// 原型 vs 本地页面：几何 / 样式数值比对（逐元素）
const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const PROTO = "file:///Users/zhoukai/code/MarketingBrain/docs/prototypes/agents-home-tech-demo-20260925.html";
const LOCAL = "http://localhost:5174/agents";

const SPEC = [
  ["容器", ".page", "main.eh"],
  ["顶栏", ".topbar", ".eh-topbar"],
  ["品牌名", ".brand-txt b", ".eh-brand-txt b"],
  ["余额chip", ".bal", ".eh-bal"],
  ["充值按钮", "#rechargeBtn", ".eh-topbar .eh-mini"],
  ["侧边栏", "nav.tabbar", ".eh-tabbar"],
  ["侧栏项", ".tab", ".eh-tab"],
  ["侧栏余额卡", ".nav-bal", ".eh-nav-bal"],
  ["Hero卡", ".hero", ".eh-hero"],
  ["Hero头像", ".hero-ava", ".eh-hero-ava"],
  ["Hero标题", ".hero-title", ".eh-hero-title"],
  ["Hero打字行", ".hero-type", ".eh-hero-type"],
  ["Hero胶囊", ".hero-slogan", ".eh-hero-slogan"],
  ["Hero大按钮", ".hero-cta .big-btn", ".eh-big"],
  ["Hero次按钮", ".hero-cta .ghost-btn", ".eh-ghost"],
  ["Hero备注", ".hero-note", ".eh-hero-note"],
  ["搜索框", ".search", ".eco-search"],
  ["邀约横幅", ".ad-inv", ".eco-invite-banner"],
  ["金刚容器", ".kingkong", ".eco-kingkong"],
  ["金刚格", ".kk", ".eco-kk-item"],
  ["金刚瓷贴", ".kk-ico", ".eco-kk-ico"],
  ["今日卡", ".t-card", ".eco-today-item"],
  ["今日图标", ".t-ico", ".eco-today-ico"],
  ["楼层头", ".floor-head", ".eco-floor-head"],
  ["楼层徽标", ".floor-no", ".eco-floor-no"],
  ["楼层标题", ".floor-title", ".eco-floor-title h2"],
  ["员工卡栅格", ".emps", ".eco-products"],
  ["员工卡", ".emp", ".eco-product"],
  ["员工头像", ".emp-ava", ".eco-ava"],
  ["员工名", ".emp-name", ".eco-p-name"],
  ["员工简介", ".emp-hook", ".eco-p-desc"],
  ["价格区", ".emp-buy", ".eco-p-buy"]
];

function measure(sel) {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    x: Math.round(r.x), y: Math.round(r.y + window.scrollY),
    w: Math.round(r.width), h: Math.round(r.height),
    fs: cs.fontSize, fw: cs.fontWeight,
    radius: cs.borderTopLeftRadius,
    pad: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
    bg: cs.backgroundColor, color: cs.color
  };
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const get = async (url) => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 40000 });
    await new Promise((r) => setTimeout(r, 2200));
    const data = await page.evaluate((_spec, _fn) => {
      const fn = new Function("sel", "return (" + _fn + ")(sel)");
      const out = {};
      for (const [name, protoSel] of _spec) out[name] = { p: fn(protoSel) };
      return out;
    }, SPEC.map(([n, p]) => [n, p]), measure.toString());
    // 本地侧用各元素自己的选择器
    for (const [name, , localSel] of SPEC) {
      const v = await page.evaluate((sel, _fn) => {
        const fn = new Function("sel", "return (" + _fn + ")(sel)");
        const el = document.querySelector(sel);
        return fn(sel);
      }, localSel, measure.toString());
      data[name].l = v;
    }
    await page.close();
    return data;
  };

  const proto = await get(PROTO);
  const local = await get(LOCAL);

  console.log("元素".padEnd(14) + "原型 (x,y,w,h) 字号/圆角".padEnd(52) + "本地 (x,y,w,h) 字号/圆角      差异");
  console.log("-".repeat(150));
  for (const [name] of SPEC) {
    const p = proto[name].p, l = local[name].l;
    const pr = p ? `${p.x},${p.y} ${p.w}×${p.h} ${p.fs}/${p.radius}` : "N/A";
    const lr = l ? `${l.x},${l.y} ${l.w}×${l.h} ${l.fs}/${l.radius}` : "N/A";
    let delta = "—";
    if (p && l) {
      const d = [];
      if (Math.abs(p.x - l.x) > 2) d.push(`x${p.x - l.x > 0 ? "→左" : "→右"}${Math.abs(p.x - l.x)}`);
      if (Math.abs(p.w - l.w) > 2) d.push(`w差${p.w - l.w}`);
      if (Math.abs(p.h - l.h) > 2) d.push(`h差${p.h - l.h}`);
      if (p.fs !== l.fs) d.push(`字号${p.fs}≠${l.fs}`);
      if (p.radius !== l.radius) d.push(`圆角${p.radius}≠${l.radius}`);
      if (p.pad !== l.pad) d.push(`内距 原=${p.pad} 本=${l.pad}`);
      delta = d.length ? d.join(" | ") : "✅";
    }
    console.log(name.padEnd(14) + pr.padEnd(38) + lr.padEnd(38) + delta);
  }
  await browser.close();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
