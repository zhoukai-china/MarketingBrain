import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const page = readFileSync(resolve(root, "apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx"), "utf8");
const execution = readFileSync(resolve(root, "apps/api/src/products/beauty-industry/execution.ts"), "utf8");
const route = readFileSync(resolve(root, "apps/api/src/routes/beauty-industry.ts"), "utf8");
const componentPath = resolve(root, "apps/web/src/components/acquisition/BeautyXhsWorkbench.tsx");
let component = "";
try {
  component = readFileSync(componentPath, "utf8");
} catch {
  assert.fail("xhs_workbench_v2_component_missing");
}

assert.match(page, /isXhsWorkspace\s*\?\s*<BeautyXhsWorkbench/, "XHS route must render its dedicated workbench");
assert.match(page, /activeResult\.structuredDelivery\.preview/, "a persisted formal XHS run must not be reclassified by the current text-runtime mode");
assert.match(execution, /beautyDeliveryModeQualityFlag\(validation\.structuredDelivery\)/, "execution must persist the delivery preview/formal mode with the run");
assert.match(execution, /readBeautyDeliveryPreview\(replay\.qualityFlags\)/, "idempotent replay must restore the persisted delivery mode");
assert.match(route, /qualityFlags:\s*true/, "history must load persisted delivery mode evidence");
assert.match(route, /readBeautyDeliveryPreview\(run\.qualityFlags\)/, "history must prefer the per-run delivery mode over the current runtime mode");
for (const marker of [
  "beauty-xhs-workbench",
  "xhs-title-option",
  "copy-xhs-title",
  "copy-xhs-body",
  "copy-xhs-tags",
  "copy-xhs-package",
  "xhs-image-card",
  "xhs-task-history"
]) {
  assert.match(component, new RegExp(marker), `missing customer journey marker: ${marker}`);
}

assert.match(component, /selectedTitleIndex/, "customer must be able to choose one of the three titles");
assert.match(component, /customerDeliverable\.body/, "customer body must come from the formal structured delivery");
assert.match(component, /customerDeliverable\.tags/, "customer topics must come from the formal structured delivery");
assert.match(component, /onDownloadImage/, "each customer-usable image needs its own download action");
assert.match(component, /data-run-id=\{run\.id\}/, "history restoration must expose the persisted run id for an exact acceptance selection");
assert.match(component, /mediaQuote\.creditCost/, "image cost must be shown from the real quote before confirmation");
assert.match(component, /不会自动重试|不会自动补图/, "paid retry boundary must be visible before confirmation");
assert.doesNotMatch(component, /[>\"`]([^<\"`]*(?:DeepSeek|wan2\.7|百炼|Provider|Skill|capability|prompt|模型参数|源码指纹|controlled_mock)[^<\"`]*)[<\"`]/i, "customer workbench must not expose internal execution details");
assert.doesNotMatch(component, /重新生成这一张|单图重生成/, "the current three-image batch contract must not expose an unapproved fourth paid task");
assert.doesNotMatch(component, /兰琪|爱马仕/i, "shared XHS workbench must not hardcode a tenant brand");
assert.doesNotMatch(component, /WorkBuddy/, "customer workbench must not expose its integration channel");

assert.doesNotMatch(page, /真实文案已启用（DeepSeek V4 Pro）/, "page must not expose the model name");
assert.doesNotMatch(page, />百炼生成中</, "page must not expose the media provider name");

console.log("Beauty XHS workbench V2 P1 smoke passed.");
