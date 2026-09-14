#!/usr/bin/env node
/**
 * 兰琪工作台「品牌标识 + 上线板块口径」前端契约 smoke（只读源码：不连网、不调模型、不花钱）。
 *
 * 锁定用户 2026-09-11 的两条要求，防止回归：
 *  ① 侧栏左上角品牌位必须是真实兰琪品牌图，不能再是被挤成两行的「兰琪」纯文本；
 *  ② 当前口径是「只有私域营销可正常上线，其余板块显示开发中」——侧栏、八板块总览、
 *     未上线板块页面与登录默认落地必须一致，不能把未验收板块写成「可体验 / 已可用」。
 *
 * 这是源码级契约（structure/smoke），真实页面证据由内测实例探针负责。
 */
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

const root = fileURLToPath(new URL("../", import.meta.url));
const shell = read("apps/web/src/components/lanqi-brain/LanqiBrainShell.tsx");
const brainHome = read("apps/web/src/pages/LanqiBrainHomePage.tsx");
const placeholder = read("apps/web/src/pages/LanqiPlaceholderPage.tsx");
const momentsHome = read("apps/web/src/pages/LanqiMomentsHomePage.tsx");
const main = read("apps/web/src/main.tsx");
const lanqiRoutes = read("apps/web/src/routes/lanqi.tsx");
const css = read("apps/web/src/styles/lanqi-moments.css");
const shared = read("packages/shared/src/index.ts");
const packageJson = read("package.json");

const results = [];
let failures = 0;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` :: ${detail}` : ""}`);
}

function requireMatch(source, pattern, name) {
  const hit = pattern.test(source);
  record(name, hit, hit ? `命中 ${String(pattern)}` : `缺少 ${String(pattern)}`);
}

function forbidMatch(source, pattern, name) {
  const hit = pattern.test(source);
  record(name, !hit, hit ? `仍存在 ${String(pattern)}` : "未出现");
}

/* ---- 对比度实算：侧栏配色不允许「悄悄变淡」 ---- */
function hexToRgb(hex) {
  const raw = String(hex ?? "").replace("#", "").trim();
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}
function rgbaToParts(text) {
  const nums = String(text ?? "").split(",").map((v) => Number(v.trim()));
  if (nums.length < 3 || nums.some((v) => Number.isNaN(v))) return null;
  return [nums[0], nums[1], nums[2], nums.length > 3 ? nums[3] : 1];
}
function channelLuminance(value) {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function luminance([r, g, b]) {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}
function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
/** 半透明色叠在不透明底色上的实际观感色。 */
function blendOver(parts, background) {
  const [r, g, b, a] = parts;
  return [r, g, b].map((v, i) => Math.round(a * v + (1 - a) * background[i]));
}

// ① 品牌图资产：必须是真实 JPEG，且落在 web 静态目录
const logoFile = fileURLToPath(new URL("../apps/web/public/lanqi-logo.jpg", import.meta.url));
let logoOk = false;
let logoDetail = "";
try {
  const stat = statSync(logoFile);
  const head = readFileSync(logoFile).subarray(0, 2);
  logoOk = stat.isFile() && stat.size > 10000 && head[0] === 0xff && head[1] === 0xd8;
  logoDetail = `size=${stat.size} magic=${head[0].toString(16)}${head[1].toString(16)}`;
} catch (error) {
  logoDetail = `读取失败：${error.message}`;
}
record("资产：apps/web/public/lanqi-logo.jpg 存在且是真实 JPEG", logoOk, logoDetail);

// ② 品牌位：用真实图片，不再把「兰琪」两字当 Logo
requireMatch(
  shell,
  /className="lq-pd__logo"\s*\n?\s*src=\{getAppPath\("\/lanqi-logo\.jpg"\)\}/,
  "外壳：品牌位 <img className=\"lq-pd__logo\"> 指向 getAppPath(\"/lanqi-logo.jpg\")"
);
requireMatch(shell, /alt="兰琪·爱美荟"/, "外壳：品牌图 alt=\"兰琪·爱美荟\"");
forbidMatch(
  shell,
  /lq-pd__logo">兰琪</,
  "外壳：品牌位不再用纯文本「兰琪」当 Logo"
);
requireMatch(
  shell,
  /lq-pd__brand-name">[^<]*兰琪/,
  "外壳：品牌名仍含「兰琪」"
);

// ③ 侧栏上线状态：恰好 1 项 online（私域营销），其余 7 项 dev
const navMatch = shell.match(/const NAV:[^=]*=\s*\[([\s\S]*?)\n\];/);
record("外壳：能解析出 NAV 数组", Boolean(navMatch), navMatch ? "已解析" : "未匹配到 NAV 数组");
const navBody = navMatch ? navMatch[1] : "";
const onlineCount = (navBody.match(/status:\s*"online"/g) ?? []).length;
const devCount = (navBody.match(/status:\s*"dev"/g) ?? []).length;
record("外壳：NAV 恰好 2 项 status=online（私域营销 + 公域获客）", onlineCount === 2, `online=${onlineCount}`);
record("外壳：NAV 其余 6 项 status=dev", devCount === 6, `dev=${devCount}`);
requireMatch(navBody, /key:\s*"moments"[\s\S]*?status:\s*"online"/, "外壳：「私域营销」是 online");
requireMatch(navBody, /key:\s*"acquire"[\s\S]*?status:\s*"online"/, "外壳：「公域获客」是 online");
requireMatch(shell, /开发中/, "外壳：dev 板块渲染「开发中」文案");
forbidMatch(shell, /badge:\s*"新"/, "外壳：移除「门店后台 · 新」徽标（与本轮口径冲突）");

// ④ 八板块总览：只有私域营销 done
const boardsMatch = brainHome.match(/const BOARDS:[^=]*=\s*\[([\s\S]*?)\n\];/);
record("总览：能解析出 BOARDS 数组", Boolean(boardsMatch), boardsMatch ? "已解析" : "未匹配到 BOARDS 数组");
const boardsBody = boardsMatch ? boardsMatch[1] : "";
const doneCount = (boardsBody.match(/done:\s*true/g) ?? []).length;
record("总览：BOARDS 恰好 2 项 done=true（私域营销 + 公域获客）", doneCount === 2, `done=${doneCount}`);
requireMatch(boardsBody, /key:\s*"moments"[\s\S]*?done:\s*true/, "总览：「私域营销」done=true");
requireMatch(boardsBody, /key:\s*"acquire"[\s\S]*?done:\s*true/, "总览：「公域获客」done=true");
requireMatch(brainHome, /当前已开放[\s\S]*公域获客/, "总览：公域获客已进入已开放清单");
forbidMatch(brainHome, /公域获客[^。]*均在开发中/, "总览：公域获客不再列入开发中清单");
forbidMatch(
  brainHome,
  /已可体验：经营驾驶舱/,
  "总览：页脚不再写「已可体验：经营驾驶舱…」"
);
requireMatch(brainHome, /开发中/, "总览：页脚/卡片保留「开发中」口径");

// ⑤ 占位页：不再把公域获客/驾驶舱写成已可用，并明说开发中
forbidMatch(placeholder, /（已可用）/, "占位页：不再出现「（已可用）」");
requireMatch(placeholder, /开发中/, "占位页：保留「开发中」口径");
requireMatch(placeholder, /私域营销[\s\S]*?（已上线）|（已上线）[\s\S]*?私域营销/, "占位页：工具区把私域营销标为已上线");
requireMatch(placeholder, /export function LanqiDashboardInDevelopmentPage/, "占位页：新增经营驾驶舱「开发中」页组件");
requireMatch(placeholder, /export function LanqiAcquireInDevelopmentPage/, "占位页：新增公域获客「开发中」页组件");

// ⑥ 私域营销首页不再把返回链接指向未上线的公域获客
forbidMatch(momentsHome, /返回公域获客/, "私域营销首页：不再「返回公域获客」");
requireMatch(momentsHome, /返回板块总览/, "私域营销首页：返回链接指向板块总览");

// ⑦ 路由口径：默认落地私域营销；未上线板块渲染「开发中」占位
requireMatch(lanqiRoutes, /LANQI_MOMENTS_ONLY_LAUNCH/, "路由：存在单点开关 LANQI_MOMENTS_ONLY_LAUNCH");
requireMatch(lanqiRoutes, /LanqiDashboardInDevelopmentPage/, "路由：经营驾驶舱被「开发中」占位接管");
requireMatch(lanqiRoutes, /LANQI_ACQUIRE_LAUNCHED/, "路由：存在公域获客放开开关 LANQI_ACQUIRE_LAUNCHED");
requireMatch(lanqiRoutes, /LANQI_MOMENTS_ONLY_LAUNCH && !LANQI_ACQUIRE_LAUNCHED/, "路由：仅未放开时公域获客才命中「开发中」占位");
forbidMatch(
  lanqiRoutes,
  /window\.location\.replace\(getAppPath\("\/lanqi\/dashboard"\)\)/,
  "路由：入口不再默认跳经营驾驶舱"
);
// 三个「默认落地」站点逐一断言，避免用「出现次数」这种容易被无关字符串凑出来的口径：
// ① 内测免登录网关（DirectTestLoginGate）入口重定向；② `/lanqi` 入口重定向；
// ③ 登录成功后的回跳（brainEntry，路径再交给 getAppPath 拼接 base）。
record(
  "路由：免登录网关入口默认落地私域营销",
  /if \(isEntry\) window\.location\.replace\(getAppPath\("\/lanqi\/moments"\)\)/.test(main),
  "DirectTestLoginGate isEntry 重定向"
);
record(
  "路由：`/lanqi` 入口默认落地私域营销",
  /path === "\/lanqi" \|\| path === "\/lanqi\/"\)\s*\{\s*window\.location\.replace\(getAppPath\("\/lanqi\/moments"\)\)/.test(lanqiRoutes),
  "`/lanqi` 重定向"
);
record(
  "路由：登录回跳默认落地私域营销（brainEntry）",
  /const brainEntry =[\s\S]{0,220}?"\/lanqi\/moments"/.test(main),
  "brainEntry 回跳分支"
);
requireMatch(shared, /defaultPath:\s*"\/lanqi\/moments"/, "共享：lanqi 产品默认落地改为 /lanqi/moments");

// ⑧ 样式：品牌位是 48×40 的图，且有移动端不溢出规则
requireMatch(
  css,
  /\.lq-pd__logo\s*\{[^}]*width:\s*48px;[^}]*height:\s*40px;[^}]*object-fit:\s*contain/,
  "样式：.lq-pd__logo 为 48×40 + object-fit:contain"
);
requireMatch(css, /\.lq-pd__brand-name\s*\{[^}]*min-width:\s*0/, "样式：品牌名允许收缩不撑破侧栏");

// ⑩ 侧栏配色：橙底白字（用户 2026-09-11 口径：「一级导航页的字体从黑色改成白色」）
//
// 为什么不是「白字 + 任意橙」：白字压在兰琪品牌橙 #F37021 上只有 2.94:1，低于 WCAG AA
// 的 4.5:1（原来的深棕字 #2D1A10 是 5.64:1）。用户要白字的观感，所以**保留品牌橙**、改白字，
// 同时把侧栏里**字号最小**的那处（10px「开发中」徽标）单独提亮：徽标底色从「橙上浅棕蒙层」
// 改成「橙上深棕蒙层」，白字压在上面的对比度反而从 2.71:1 升到 4.5:1 以上。
//
// 本节对比度是**实算**的（从 CSS 里取色再算），不是写死的期望值：谁把侧栏底色调浅、
// 或把徽标底色改回浅棕，这里就会红。导航白字那条是「不得变差」的回归下限，
// 不是 AA 达标声明——AA 例外已在 docs/agents/lanqi-beauty/tasks/LQ-22 里写明。
const sidebarBgHex = (css.match(/\.lq-pd__side\s*\{[^}]*background:\s*(#[0-9A-Fa-f]{6})\s*;/) ?? [])[1];
record("配色：侧栏底色仍是兰琪品牌橙 #F37021", (sidebarBgHex ?? "").toUpperCase() === "#F37021", `background=${sidebarBgHex}`);

const navTextHex = (css.match(/\.lq-pd__item\s*\{[^}]*color:\s*(#[0-9A-Fa-f]{3,8})\s*;/) ?? [])[1];
record("配色：侧栏导航文字改为白色", /^#(?:fff|ffffff)$/i.test(navTextHex ?? ""), `color=${navTextHex}`);
record("配色：导航行悬停态用白色蒙层（不再是深棕蒙层）", /\.lq-pd__item:hover\s*\{\s*background:\s*rgba\(255,\s*255,\s*255,/.test(css), "hover=rgba(255,255,255,…)");

const brandBlockColor = (css.match(/\.lq-pd__brand\s*\{[^}]*color:\s*(#[0-9A-Fa-f]{3,8})\s*;/) ?? [])[1];
const brandNameColor = (css.match(/\.lq-pd__brand-name\s*\{[^}]*color:\s*(#[0-9A-Fa-f]{3,8})\s*;/) ?? [])[1];
record("配色：品牌位文字同步改为白色", /^#(?:fff|ffffff)$/i.test(brandBlockColor ?? "") && /^#(?:fff|ffffff)$/i.test(brandNameColor ?? ""), `.lq-pd__brand=${brandBlockColor} .lq-pd__brand-name=${brandNameColor}`);

const devBadgeRule = (css.match(/\.lq-pd__badge--dev\s*\{([^}]*)\}/) ?? [])[1] ?? "";
const devBadgeColor = (devBadgeRule.match(/color:\s*(#[0-9A-Fa-f]{3,8})\s*;/) ?? [])[1];
const devBadgeRgba = rgbaToParts((devBadgeRule.match(/background:\s*rgba\(([^)]*)\)\s*;/) ?? [])[1]);
record("配色：「开发中」徽标改为白字", /^#(?:fff|ffffff)$/i.test(devBadgeColor ?? ""), `color=${devBadgeColor}`);

const sidebarBg = hexToRgb(sidebarBgHex);
const navText = hexToRgb(navTextHex);
if (sidebarBg && navText) {
  const navContrast = contrastRatio(navText, sidebarBg);
  record(
    "对比度：侧栏导航白字在品牌橙上不得低于 2.9:1（本轮基线，AA 例外见 LQ-22）",
    navContrast >= 2.9,
    `${navContrast.toFixed(2)}:1`
  );
} else {
  record("对比度：侧栏导航白字在品牌橙上不得低于 2.9:1（本轮基线，AA 例外见 LQ-22）", false, "取色失败");
}
if (sidebarBg && devBadgeRgba) {
  const chip = blendOver(devBadgeRgba, sidebarBg);
  const badgeContrast = contrastRatio([255, 255, 255], chip);
  record(
    "对比度：10px「开发中」徽标白字 ≥ 4.5:1（改前 2.71:1）",
    badgeContrast >= 4.5,
    `${badgeContrast.toFixed(2)}:1 chip=rgb(${chip.join(",")})`
  );
} else {
  record("对比度：10px「开发中」徽标白字 ≥ 4.5:1（改前 2.71:1）", false, "取色失败");
}

// ⑨ 脚本入口已注册
requireMatch(packageJson, /lanqi:brand-nav-contract-smoke/, "package.json：已注册 lanqi:brand-nav-contract-smoke");

console.log(`\nlanqi_brand_nav_contract_smoke: ${failures === 0 ? "PASS" : "FAIL"} (${results.length - failures} passed / ${failures} failed)`);
process.exit(failures === 0 ? 0 : 1);
