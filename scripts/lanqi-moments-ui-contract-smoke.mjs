#!/usr/bin/env node
/**
 * 兰琪「私域营销」结果操作 + 顶栏同步 的前端契约 smoke（只读源码：不连网、不调模型、不花钱）。
 *
 * 锁定 WorkBuddy《兰琪私域营销页复测报告》（2026-09-11，stage3）复核成立的两条 P2：
 *  1) 生成结果卡片没有「复制文案 / 重新生成」，老板只能手动框选出稿；
 *  2) 顶栏「多端实时同步」是个纯 <span>，点了没有任何可见反馈。
 *
 * 源码契约只能证明「元素还在、旧写法没回来」，真实可点/出 toast 由
 * `scripts/lanqi-moments-retest.mjs`（真实浏览器）保证。两层一起才成立：
 * 契约层跑得快、能卡住误删，浏览器层证明行为对。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

const friendCircle = read("apps/web/src/pages/LanqiMomentsPage.tsx");
const wechatGroup = read("apps/web/src/pages/LanqiMomentsWechatGroupPage.tsx");
const shell = read("apps/web/src/components/lanqi-brain/LanqiBrainShell.tsx");
const css = read("apps/web/src/styles/lanqi-moments.css");

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

/**
 * 结果面板有两条分支（有正文 / 信息不足），断言必须落在具体那条分支里。
 * 否则「有正文」分支里的按钮会让「信息不足」分支的空缺被误判成通过——
 * 这正是 LQ-24 要修的漏网：2026-09-11 补按钮时只补了有正文那条。
 */
function branchOf(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const alt = source.indexOf(") : (", start);
  return alt < 0 ? source.slice(start, start + 1500) : source.slice(start, alt);
}

// —— 朋友圈结果卡片：复制 / 重新生成 ——
requireMatch(friendCircle, /data-lanqi-moments-tools/, "朋友圈：结果卡片有操作区容器");
requireMatch(friendCircle, /data-lanqi-moments-copy/, "朋友圈：有「复制文案」按钮");
requireMatch(friendCircle, /data-lanqi-moments-regen/, "朋友圈：有「重新生成」按钮");
requireMatch(friendCircle, /navigator\.clipboard/, "朋友圈：复制优先走 clipboard API");
requireMatch(friendCircle, /execCommand\("copy"\)/, "朋友圈：clipboard 被拒时有 execCommand 兜底");
requireMatch(friendCircle, /data-lanqi-moments-toast/, "朋友圈：复制/失败都有可见 toast");
requireMatch(friendCircle, /重新生成中…/, "朋友圈：重新生成时有进行中文案");

// —— 微信群话术结果卡片：同口径 ——
requireMatch(wechatGroup, /data-lanqi-wechat-copy/, "群话术：有「复制文案」按钮");
requireMatch(wechatGroup, /data-lanqi-wechat-regen/, "群话术：有「重新生成」按钮");
requireMatch(wechatGroup, /data-lanqi-wechat-toast/, "群话术：有可见 toast");

// —— 信息不足（needsInput）分支：也要给出「重新生成」，但不要「复制」 ——
// 老板被判定「素材还不够」时，面板原本只剩一句提示，没有任何下一步出口（LQ-24）。
const friendCircleNeeds = branchOf(friendCircle, "result.needsInput ? (");
record("朋友圈：定位到「信息不足」分支代码块", friendCircleNeeds.length > 0, `len=${friendCircleNeeds.length}`);
requireMatch(friendCircleNeeds, /data-lanqi-moments-regen/, "朋友圈：信息不足分支也有「重新生成」按钮");
requireMatch(friendCircleNeeds, /重新生成中…/, "朋友圈：信息不足分支的按钮有进行中文案");
forbidMatch(friendCircleNeeds, /data-lanqi-moments-copy/, "朋友圈：信息不足分支不放「复制文案」（没有正文可复制）");

const wechatNeeds = branchOf(wechatGroup, "result.needsInput ? (");
record("群话术：定位到「信息不足」分支代码块", wechatNeeds.length > 0, `len=${wechatNeeds.length}`);
requireMatch(wechatNeeds, /data-lanqi-wechat-regen/, "群话术：信息不足分支也有「重新生成」按钮");
forbidMatch(wechatNeeds, /data-lanqi-wechat-copy/, "群话术：信息不足分支不放「复制文案」");

// —— 顶栏「多端实时同步」：从纯 span 改成可点按钮 + 反馈 ——
requireMatch(shell, /<button[^>]*className="lq-pd__pts"[^>]*data-lanqi-sync/, "顶栏：同步入口是可点按钮");
requireMatch(shell, /data-lanqi-sync-toast/, "顶栏：同步后有可见 toast");
requireMatch(shell, /正在同步…/, "顶栏：同步中有可见进行态");
requireMatch(shell, /已同步 · \$\{hhmm\}/, "顶栏：同步完成给出时间");
forbidMatch(shell, /<span className="lq-pd__pts">🔄 多端实时同步<\/span>/, "顶栏：旧的「点了没反应」纯 span 写法已移除");

// —— 样式：不复用不存在的类 ——
requireMatch(css, /\.lq-cw__tools\b/, "样式：结果操作区类存在");
requireMatch(css, /\.lq-cw__tool\b/, "样式：结果操作按钮类存在");
requireMatch(css, /\.lq-cw__toast\b/, "样式：toast 类存在");
requireMatch(css, /\.lq-pd__pts\b[^}]*cursor: pointer/, "样式：顶栏同步按钮有 pointer 光标");

console.log(`\nlanqi_moments_ui_contract_smoke: ${failures ? "FAIL" : "PASS"} (${results.length - failures} passed / ${failures} failed)`);
if (failures) process.exitCode = 1;
