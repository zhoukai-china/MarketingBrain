import fs from "node:fs";

const pagePath = "apps/web/src/pages/IndustryWorkbenchPrototypePage.tsx";
const cssPath = "apps/web/src/styles/industry-workbench-prototype.css";
const main = fs.readFileSync("apps/web/src/main.tsx", "utf8");

if (!fs.existsSync(pagePath)) throw new Error("industry prototype page missing");
if (!fs.existsSync(cssPath)) throw new Error("industry prototype design tokens missing");

const page = fs.readFileSync(pagePath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");
const requiredPageText = [
  "页面原型",
  "美业智能体",
  "工作台首页",
  "美业AI改造日报",
  "美业知识问题",
  "美业获客",
  "美业销售",
  "美业专属交付",
  "美业专属经营诊断",
  "成果与历史",
  "账户与MCP连接",
  "获客目标",
  "视频数据复盘",
  "直播数据复盘",
  "小红书图文",
  "配图数量",
  "封面图",
  "内容图",
  "互动承接图",
  "合成示例",
  "规划中",
  "暂未开放"
];
for (const text of requiredPageText) {
  if (!page.includes(text)) throw new Error(`prototype contract missing: ${text}`);
}

for (const route of ["/industry-prototype", "/industry-prototype/acquisition", "/industry-prototype/xiaohongshu"]) {
  if (!`${main}\n${page}`.includes(route)) throw new Error(`prototype route missing: ${route}`);
}

if (!css.includes("--industry-accent") || !css.includes("--industry-surface")) {
  throw new Error("prototype configurable design tokens missing");
}
if (/\bfetch\s*\(|apiPath\s*\(/.test(page)) throw new Error("static prototype must not call API");
if (/兰琪|验收A店|验收B店|tenantKey|测试租户/.test(page)) throw new Error("brand or internal test data leaked into prototype");
if (/通用美业智能体|行业AI改造日报|行业知识问答|获客板块|销售板块|行业专属交付|行业专属经营诊断/.test(page)) {
  throw new Error("prototype still exposes superseded product labels");
}

console.log("industry workbench prototype smoke passed");
