import assert from "node:assert/strict";
import fs from "node:fs";

const workbench = fs.readFileSync("apps/web/src/components/acquisition/IpPositioningWorkbench.tsx", "utf8");
const app = fs.readFileSync("apps/web/src/pages/AgentProductsApp.tsx", "utf8");
const routing = fs.readFileSync("apps/web/src/lib/acquisition-routing.ts", "utf8");
const agent = fs.readFileSync("packages/agent/src/index.ts", "utf8");

assert.match(workbench, /knowledgeDocumentCount > 0 \? onGenerate : onOpenKnowledge/, "未选择资料时，一键生成必须先打开资料选择器");
assert.match(workbench, /先选择资料再生成/, "未选择资料时必须给出明确的下一步按钮文案");
assert.match(workbench, /停止本次生成/, "生成期间必须提供停止入口");
assert.match(app, /if \(!ipPositioningSubject \|\| ipPositioningAvailableDocumentCount === 0\) \{[\s\S]*?setKnowledgeDrawerOpen\(true\)/, "IP定位请求只在没有当前主体及其可用资料时才打开资料选择器");
assert.match(routing, /IP_POSITIONING_FORMAL_DELIVERY_TERMS/, "正式IP定位全案必须使用严格的结构校验");
assert.match(routing, /isIpPositioningInterviewResponse/, "定位访谈必须和正式全案分开识别");
assert.match(workbench, /定位访谈 · 还差 1 个关键信息/, "资料不足时必须明确展示定位访谈，而不是展示为完整全案");
assert.match(app, /continueIpPositioningInterview/, "访谈阶段提交资料必须继续访谈，不能误走全案修改");
assert.match(agent, /完整IP定位方案/, "服务端必须拒绝把带有完整全案标题的追问当作访谈");
assert.match(agent, /questionMarks\.length === 1/, "服务端必须限制每轮定位访谈只问一个关键问题");
assert.match(agent, /isIpPositioningDeliveryAnswer/, "完整全案即使包含问题提示也不能被误判为访谈返工");
assert.match(app, /defaultKnowledgeSubject/, "IP定位必须能回退到当前企业的默认知识主体");
assert.match(app, /knowledgeSubjectIdOverride/, "自动选定主体后，生成请求必须实际携带主体ID");
assert.match(app, /void send\(text, display, knowledgeDrawerAction\.capabilityId, activeKnowledgeDocumentIds, knowledgeSubjectId\)/, "从资料抽屉直接生成时，必须把抽屉当前选择的主体ID传入请求，不能依赖异步状态更新");
assert.match(app, /autoDocumentCount/, "已确认且自动可用的主体资料必须计入IP定位可用资料数");
assert.match(app, /Math\.min\(effectiveKnowledgeSubject\?\.autoDocumentCount \?\? 0, 20 - activeKnowledgeDocumentIds\.length\)/, "页面显示的自动资料数必须与后端本次最多加载20条的限制一致");

console.log("IP positioning workbench smoke passed.");
