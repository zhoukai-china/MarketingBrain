import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
  try { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }
  catch { return ""; }
}

const page = read("apps/web/src/pages/LanqiContentStudioPage.tsx");
const packageRoute = read("apps/api/src/routes/lanqi-xhs-package.ts");
const contentRoute = read("apps/api/src/routes/lanqi-content-studio.ts");
/**
 * 2026-09-16 修正过期断言：兰琪路由的装配点已在 commit `0e7053a`
 * 「拆分 server.ts 产品路由装配到 products/register.ts（行为不变）」中搬走，
 * 这里仍查旧文件 → 全网红灯（main 上同样红）。改查真实装配点，并要求它在兰琪作用域内注册。
 */
const registry = read("apps/api/src/products/register.ts");
const styles = read("apps/web/src/styles/lanqi-content-studio.css");

assert.match(page, /生成小红书图文/, "统一页面必须只有一个用户可理解的图文生成主动作");
assert.doesNotMatch(page, /生成小红书文案/, "用户主路径不得继续表现为只生成文案");
assert.doesNotMatch(page, /getAppPath\("\/lanqi\/image-studio"\)/, "用户不得从主导航跳到独立图片工作室");
assert.match(page, /3个标题候选/, "统一结果必须展示三个标题候选");
assert.match(page, /复制全部文字/, "统一结果必须提供无需手动选中的复制动作");
assert.match(page, /下载图片/, "统一结果必须提供租户安全的图片下载动作");
assert.match(page, /fetch\(apiPath\(`\/lanqi\/media\/assets\/\$\{job\.id\}`\)[\s\S]{0,120}headers:\s*headers\(\)/, "受保护图片预览必须带租户授权读取 Blob，不能直接暴露为 img src");
assert.match(page, /高级详情|调整图片/, "提示词只能作为高级详情而非独立用户任务");
assert.match(page, /预计积分/, "主按钮旁必须在点击前展示报价");
assert.match(page, /\/lanqi\/content-studio\/packages/, "页面必须调用统一图文工作流而非手工串接三个页面");

assert.match(packageRoute, /\/lanqi\/content-studio\/package-quote/, "统一工作流缺少点击前报价入口");
assert.match(packageRoute, /\/lanqi\/content-studio\/packages/, "统一工作流缺少创建与恢复接口");
assert.match(packageRoute, /quoteId/, "报价与执行必须绑定 quoteId");
assert.match(packageRoute, /packageId/, "文案、提示词和图片必须绑定稳定 packageId");
assert.match(packageRoute, /requestId/, "重复点击与跨入口调用必须绑定 requestId");
assert.doesNotMatch(packageRoute, /raw\.aborted\s*\|\|\s*request\.raw\.destroyed/, "正常浏览器请求不得因 IncomingMessage.destroyed 被误判为用户取消");
assert.match(packageRoute, /\/lanqi\/content-studio\/drafts/, "统一工作流必须复用已有文案链路");
assert.match(packageRoute, /\/lanqi\/image-studio\/previews/, "统一工作流必须复用专业提示词链路");
assert.match(packageRoute, /\/lanqi\/media\/confirm/, "统一工作流必须复用已有媒体幂等与计费链路");
assert.match(packageRoute, /partial_success|text_ready/, "图片失败时必须保留文案并返回部分成功状态");
assert.match(contentRoute, /content_generation_timed_out/, "文案阶段必须有硬超时终态，不能无限等待");
assert.match(contentRoute, /signal:\s*params\.signal/, "文案阶段必须把取消和超时信号传播到模型调用");
assert.match(contentRoute, /provider_fallback_used[\s\S]{0,180}professional_xiaohongshu_provider_unavailable/, "离题或固定兜底不得冒充专业小红书文案并继续生图");
assert.match(packageRoute, /tenantId|resolveRequestContext/, "统一作品恢复必须保持租户隔离");
assert.match(registry, /registerLanqiXhsPackageRoutes/, "统一图文后端尚未注册到兰琪产品路由（装配点在 products/register.ts）");
assert.match(
  registry,
  /app\.register\(async \(lanqi\) => \{[\s\S]{0,4000}?registerLanqiXhsPackageRoutes\(lanqi, provider\)/,
  "统一图文后端必须挂在兰琪产品作用域（带 lanqi 权益门）内"
);
assert.match(styles, /lanqiPackage/, "统一图文结果缺少专用页面样式");

console.log("Lanqi unified Xiaohongshu package contract smoke passed.");
