import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path) {
  try {
    return readFileSync(resolve(path), "utf8");
  } catch {
    return "";
  }
}

const routeSource = source("apps/api/src/routes/lanqi-image-studio.ts");
const mediaRouteSource = source("apps/api/src/routes/lanqi-media-generation.ts");
const serviceSource = source("apps/api/src/services/lanqi-image-studio.ts");
const pageSource = source("apps/web/src/pages/LanqiImageStudioPage.tsx");
const contentStudioSource = source("apps/web/src/pages/LanqiContentStudioPage.tsx");
const packageRouteSource = source("apps/api/src/routes/lanqi-xhs-package.ts");
const rootSource = source("apps/web/src/main.tsx");
const envSource = source("apps/api/src/config/env.ts");

assert.match(routeSource, /\/lanqi\/image-studio\/previews/, "缺少租户隔离的文生图预览接口");
assert.match(routeSource, /platform:\s*[\"']lanqi_image_preview[\"']/, "数据库恢复必须限定文生图预览类型");
assert.match(routeSource, /tenantId:\s*context\.tenantId/, "保存与恢复必须绑定当前租户");
assert.match(routeSource, /inFlight/, "重复点击必须复用同一在途预览");

assert.match(serviceSource, /media\.image\.generate/, "必须声明供应商无关的图片生成 capability");
assert.match(serviceSource, /preview_only/, "零付费阶段必须保持 preview_only");
assert.match(serviceSource, /billable:\s*false/, "预览不得计费");
assert.doesNotMatch(serviceSource, /aliyun|minimax|dashscope|百炼/i, "产品预览不得暴露或硬编码供应商");

assert.match(pageSource, /生成提示词与费用预览/, "页面主动作必须是预览而非付费生成");
assert.match(pageSource, /确认并生成图片/, "提示词与费用预览下方必须有明确的第二步生成入口");
assert.match(pageSource, /disabled=\{!quote\?\.canConfirm/, "未通过服务端执行闸门时第二步入口必须禁用");
assert.match(pageSource, /AI 对需求的理解/, "用户必须能核对并编辑 AI 对需求的理解");
assert.match(pageSource, /正向视觉提示词/, "页面必须将模型绘图提示词单独展示");
assert.match(pageSource, /负向提示词/, "页面必须将负面约束单独展示");
assert.match(routeSource, /dedupeLanqiImagePreviews/, "历史恢复必须隐藏语义重复的预览记录");
assert.match(pageSource, /我确认.*有权使用/, "页面必须取得素材与品牌使用授权确认");
assert.match(pageSource, /本步骤不生成图片、不扣积分/, "提示词预览步骤必须明确零付费边界");
assert.match(pageSource, /\/lanqi\/media\/quote/, "LQ-14 必须在同页读取费用与执行闸门");
assert.match(pageSource, /confirmed:\s*true/, "创建图片任务前必须提交明确确认");
assert.match(pageSource, /promptVersion:\s*(?:preview|active)\.enhancer\.version/, "媒体任务必须提交当前专业提示词版本");
assert.match(routeSource, /LANQI_MEDIA_EXECUTION_MODE === "mock"/, "受控模拟验收不得等待或调用外部文本模型");
assert.match(mediaRouteSource, /billingStatus:\s*"reserved",\s*status:\s*\{\s*notIn:/, "成功落库必须与取消退款做条件互斥");
assert.match(mediaRouteSource, /claimed\.count === 0\) return current/, "并发退款必须只有一个事务执行返还");
assert.match(mediaRouteSource, /discardLanqiMediaAsset/, "取消或退款竞态产生的孤立文件必须清理");
assert.match(envSource, /oss-accelerate\.aliyuncs\.com/, "百炼真实图片结果的官方 OSS 加速域名必须进入国内出站白名单");
assert.doesNotMatch(contentStudioSource, /getAppPath\("\/lanqi\/image-studio"\)/, "独立图片工作室只能保留内部兼容路由，不得进入用户主导航");
assert.match(packageRouteSource, /\/lanqi\/image-studio\/previews/, "统一图文后端必须复用专业提示词预览能力");
assert.match(rootSource, /\/lanqi\/image-studio/, "缺少独立文生图页面路由");

console.log("Lanqi image preview and controlled-generation contract smoke passed.");
