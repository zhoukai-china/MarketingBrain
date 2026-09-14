#!/usr/bin/env node
/**
 * 兰琪「公域获客 → 爆款复刻」参考链接识别 smoke（只读源码 + 纯函数执行：不连网、不调模型、不花钱）。
 *
 * 锁定用户 2026-09-14 反馈的真实 Bug：抖音 App「分享 → 复制链接」复制出来的是**分享口令文本**
 * （口令 + 短链 + 「复制此链接，打开抖音搜索」提示混排成一段），旧实现把整段丢进 `new URL()`，
 * 于是真实口令一律被报成「这不像一条完整链接，请粘贴以 https:// 开头的地址。」
 *
 * 做法：从 `apps/web/src/pages/LanqiAcquireVideoPage.tsx` 里**按函数名切出真实源码**，
 * 用仓库自带 TypeScript 编译器擦掉类型注解后直接执行，跑的是生产同一份实现，不是复制品。
 * 设置环境变量 `LANQI_REFERENCE_PAGE_PATH` 可指向历史版本文件（用来复现修复前的红灯）。
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("../apps/web/node_modules/typescript/lib/typescript.js");

const pagePath =
  process.env.LANQI_REFERENCE_PAGE_PATH ?? fileURLToPath(new URL("../apps/web/src/pages/LanqiAcquireVideoPage.tsx", import.meta.url));
const source = readFileSync(pagePath, "utf8");

/**
 * 只切出参考链接解析这几个纯函数，避免把 React 组件整份拖进来执行。
 * 起点优先 `trimReferenceUrl`（LQ-29 之后的主入口），历史版本回退到 `parseReferenceLink`，
 * 这样对修复前的源码也能跑出真实红灯（而不是「找不到函数」）。
 */
const START_CANDIDATES = ["function trimReferenceUrl(", "function parseReferenceLink("];
const END = "function readVideoMeta(";
const startIndex = START_CANDIDATES.map((token) => source.indexOf(token)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? -1;
const endIndex = source.indexOf(END);
if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
  console.log(`[FAIL] 定位参考链接解析函数失败：${pagePath}`);
  console.log(`       期望源码里存在 ${START_CANDIDATES.join(" 或 ")}，并且后面跟着 ${END}。`);
  process.exit(1);
}
const snippet = source.slice(startIndex, endIndex);
const transpiled = ts.transpileModule(snippet, {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
  reportDiagnostics: false
}).outputText;

/** 历史版本可能没有 trimReferenceUrl / extractReferenceUrl：只导出这段源码里真实存在的函数。 */
const exportNames = ["trimReferenceUrl", "extractReferenceUrl", "parseReferenceLink"].filter((name) =>
  new RegExp(`function ${name}\\(`).test(snippet)
);
const factory = new Function(
  "module",
  "exports",
  "require",
  `${transpiled}\nmodule.exports = { ${exportNames.join(", ")} };`
);
const moduleShim = { exports: {} };
factory(moduleShim, moduleShim.exports, require);
const { parseReferenceLink } = moduleShim.exports;
if (typeof parseReferenceLink !== "function") {
  console.log(`[FAIL] 没有从源码里切出 parseReferenceLink：${pagePath}`);
  process.exit(1);
}

const results = [];
let failures = 0;
function record(name, ok, detail) {
  results.push({ name, ok });
  if (!ok) failures += 1;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` :: ${detail}` : ""}`);
}

/** 期望识别成功：断言 host / 登记地址 / 来源口径。 */
function expectOk(name, raw, expected) {
  const parsed = parseReferenceLink(raw);
  if (!parsed.ok) return record(name, false, `被拒了：${parsed.reason}`);
  const problems = [];
  if (expected.url !== undefined && parsed.value.url !== expected.url) problems.push(`url=${parsed.value.url}`);
  if (expected.host !== undefined && parsed.value.host !== expected.host) problems.push(`host=${parsed.value.host}`);
  if (expected.kindLabel !== undefined && parsed.value.kindLabel !== expected.kindLabel) problems.push(`kindLabel=${parsed.value.kindLabel}`);
  if (parsed.value.url.startsWith("http://")) problems.push("登记地址仍是 http 明文");
  record(name, problems.length === 0, problems.length === 0 ? `url=${parsed.value.url} · ${parsed.value.kindLabel}` : problems.join(" / "));
}

/** 期望识别失败：断言拒绝理由里必须出现的关键信息（不能只报「不像链接」）。 */
function expectRejected(name, raw, keywords) {
  const parsed = parseReferenceLink(raw);
  if (parsed.ok) return record(name, false, `不该通过，却登记成了 ${parsed.value.url}`);
  const text = parsed.reason;
  const missing = keywords.filter((word) => !text.includes(word));
  record(name, missing.length === 0, missing.length === 0 ? `理由=${text}` : `理由缺少 ${missing.join("、")}：${text}`);
}

// ① 用户原样粘贴的分享口令：真实文案 = 口令/乱码 × 短链 × 中文提示混排
expectOk(
  "分享口令（文字 + https 短链 + 中文提示混排）能识别出短链",
  "7.32 复制打开抖音，看看【餐饮AI视频案例展示的作品】https://v.douyin.com/iRNBho6u/ 复制此链接，打开抖音搜索，直接观看视频！",
  { host: "v.douyin.com", url: "https://v.douyin.com/iRNBho6u/", kindLabel: "抖音分享短链" }
);

// ② 口令里的短链是 http 明文：按 https 登记（不因为「明文」把用户口令判死）
expectOk(
  "分享口令里的 http:// 短链升级为 https 后登记",
  "4.33 01/29 Ehb:/ 2pm W@Z.ZM 餐饮AI视频案例展示 餐饮门店 http://v.douyin.com/iRNBho6u/ 复制此链接",
  { url: "https://v.douyin.com/iRNBho6u/", host: "v.douyin.com" }
);

// ③ 链接尾部直接粘连中文提示（App 复制时没有空格）：只留链接本身
expectOk(
  "链接尾部粘连中文提示时自动裁掉",
  "https://v.douyin.com/iRNBho6u/复制此链接，打开抖音搜索",
  { url: "https://v.douyin.com/iRNBho6u/" }
);

// ④ 用户只写短链、不带协议头
expectOk("不带协议头的 v.douyin.com 短链也能识别", "v.douyin.com/iRNBho6u/", {
  url: "https://v.douyin.com/iRNBho6u/",
  host: "v.douyin.com"
});

// ⑤ 完整视频页链接，尾部带中文标点
expectOk(
  "视频页链接尾部的中文逗号不进入登记地址",
  "https://www.douyin.com/video/7398765432109876543，复制打开抖音看看",
  { url: "https://www.douyin.com/video/7398765432109876543", host: "www.douyin.com", kindLabel: "抖音视频" }
);

// ⑥ 图文笔记链接
expectOk("图文笔记链接登记为「抖音图文」", "https://www.douyin.com/note/7398765432109876543", {
  kindLabel: "抖音图文"
});

// ⑦ 短链带查询参数时保留参数
expectOk("短链查询参数保留", "https://v.douyin.com/iRNBho6u/?region=CN", {
  url: "https://v.douyin.com/iRNBho6u/?region=CN"
});

// ⑧ 用户截图里那段「只有口令、没有任何链接」的文字：必须说「没有链接」并给出复制链接的步骤
expectRejected(
  "整段没有任何链接时，明说「没有链接」并给出可照做的步骤",
  "4.33 01/29 Ehb:/ 2pm W@Z.ZM 餐饮AI视频案例展示 餐饮门店",
  ["没有链接", "复制链接"]
);

// ⑨ 非抖音平台：照实说明识别到的是哪个域名（不冒充抖音）
expectRejected("非抖音链接被拒且报出实际域名", "https://www.kuaishou.com/short-video/3x7hf8y2", ["kuaishou.com"]);

// ⑩ 抖音账号主页 / 合集这类「不是一个视频」的链接仍然不收
expectRejected("抖音账号主页链接仍然不收", "https://www.douyin.com/user/MS4wLjABAAAAexample", ["单条"]);

// ⑪ 空输入
expectRejected("空输入给出明确提示", "   ", ["粘贴"]);

console.log(`\nlanqi_acquire_reference_link_smoke: ${failures === 0 ? "PASS" : "FAIL"} (${results.length - failures} passed / ${failures} failed)`);
process.exit(failures === 0 ? 0 : 1);
