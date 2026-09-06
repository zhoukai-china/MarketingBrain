import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const beautyPage = read("apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx");
const contentWorkbench = read("apps/web/src/components/acquisition/BeautyContentTenWorkbench.tsx");
const route = read("apps/api/src/routes/beauty-industry.ts");
const adapter = read("apps/api/src/products/beauty-industry/mcp-adapter.ts");
const execution = read("apps/api/src/products/beauty-industry/execution.ts");
const exportsRoute = read("apps/api/src/routes/exports.ts");

assert.match(beautyPage, /BeautyContentTenWorkbench/, "content-ten must use a dedicated Skill-driven workspace");
assert.match(beautyPage, /isContentTenWorkspace/, "content-ten must not fall through the generic composer");
assert.match(beautyPage, /requestInFlightRef\.current/, "same-tick duplicate clicks need a synchronous in-flight guard");
assert.match(contentWorkbench, /本次内容任务/);
assert.match(contentWorkbench, /需要补充什么/);
assert.match(contentWorkbench, /内容系统/);
assert.match(contentWorkbench, /下载 Word/);
assert.match(contentWorkbench, /复制十件交付|复制预览内容/);
assert.match(contentWorkbench, /任务历史/);
assert.match(contentWorkbench, /splitContentDelivery/);
assert.match(contentWorkbench, /customerOutput/);
assert.match(contentWorkbench, /auditOutput/);
assert.match(contentWorkbench, /质量与合规检查/);
assert.match(contentWorkbench, /流程预览（非正式生成）/);
assert.doesNotMatch(contentWorkbench, /navigator\.clipboard\.writeText\(props\.activeRun\.output\)/, "copy must exclude the folded audit receipt");
assert.match(contentWorkbench, /sourceRunId/);
assert.doesNotMatch(contentWorkbench, /爆款复刻|上传成片|文生视频|图生视频/, "content-ten workspace must not expose other systems");

for (const source of [route, adapter, execution]) {
  assert.match(source, /contentWorkflow/, "web, MCP and execution must share the structured content workflow contract");
}
assert.match(route, /structuredDelivery/);
assert.match(adapter, /BeautyStructuredDelivery/);
assert.match(execution, /tryParseBeautyContentDelivery/);
assert.match(adapter, /CONTENT_WORKFLOW_INPUT/);
assert.match(adapter, /BEAUTY_WORKFLOWS\["content-ten"\][\s\S]*inputSchema: CONTENT_WORKFLOW_INPUT/);
assert.match(execution, /buildBeautyContentWorkflowDirective/);
assert.match(execution, /contentWorkflowContext/);
assert.match(execution, /contentWorkflowVersion:\s*params\.contentWorkflow \? BEAUTY_CONTENT_WORKFLOW_VERSION : null/);
assert.match(contentWorkbench, /未提供时只进入折叠的质量审核，不会污染十件交付/);

for (const heading of [
  "短结论",
  "一、选题",
  "二、口播逐字稿",
  "三、访谈话术",
  "四、拍摄脚本",
  "五、拍摄注意事项",
  "六、剪辑EDL",
  "七、发布标题与话题",
  "八、最佳发布时间",
  "九、评论区引导话术",
  "十、投流建议"
]) {
  assert.match(contentWorkbench, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing V5 heading: ${heading}`);
}

assert.match(exportsRoute, /tenantId:/, "export record must be tenant bound");
assert.match(exportsRoute, /record\.tenantId !== context\.tenantId/, "cross-tenant Word download must fail closed");

process.stdout.write("beauty-industry-content-ten-workbench-p1-smoke: PASS\n");
