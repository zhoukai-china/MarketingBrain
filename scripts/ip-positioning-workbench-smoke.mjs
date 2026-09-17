import assert from "node:assert/strict";
import fs from "node:fs";

// 当前 IP 定位已收敛到通用 AgentProductsApp 的能力路由，不再有单独的
// ipPositioningSubject / continueIpPositioningInterview 状态。本脚本同步守护
// 仍然存在的关键安全性质：资料不足先选资料、定位访谈与正式全案分开、每轮只问一个
// 关键问题、抽屉选择的主体 ID 必须显式传给生成请求。
const workbench = fs.readFileSync("apps/web/src/components/acquisition/IpPositioningWorkbench.tsx", "utf8");
const app = fs.readFileSync("apps/web/src/pages/AgentProductsApp.tsx", "utf8");
const routing = fs.readFileSync("apps/web/src/lib/acquisition-routing.ts", "utf8");
const agent = fs.readFileSync("packages/agent/src/index.ts", "utf8");

assert.match(workbench, /knowledgeDocumentCount > 0 \? onGenerate : onOpenKnowledge/, "未选择资料时，一键生成必须先打开资料选择器");
assert.match(workbench, /先选择资料再生成/, "未选择资料时必须给出明确的下一步按钮文案");
assert.match(workbench, /停止本次生成/, "生成期间必须提供停止入口");
assert.match(workbench, /定位访谈 · 还差 1 个关键信息/, "资料不足时必须明确展示定位访谈，而不是展示为完整全案");
assert.match(routing, /IP_POSITIONING_FORMAL_DELIVERY_TERMS/, "正式IP定位全案必须使用严格的结构校验");
assert.match(routing, /isIpPositioningInterviewResponse/, "定位访谈必须和正式全案分开识别");

assert.match(app, /const activeKnowledgeSubject = knowledgeSubjects\.find/, "当前主体必须从知识主体列表解析");
assert.match(app, /const taskKnowledgeSubjectId = knowledgeSubjectIdOverride \?\? activeTask\?\.knowledgeSubjectId;/, "抽屉覆盖的主体 ID 必须优先于任务历史主体");
assert.match(app, /knowledgeSubjectId: taskKnowledgeSubjectId \|\| undefined,/, "生成请求必须实际携带主体 ID");
assert.match(app, /void send\(text, display, knowledgeDrawerAction\.capabilityId, activeKnowledgeDocumentIds, knowledgeSubjectId\);/, "从资料抽屉直接生成时，必须把抽屉当前选择的主体 ID 显式传入请求");
assert.match(app, /disabled=\{\(!selectedIds\.length && !automaticKnowledgeCount\) \|\| !selectedSubjectId \|\| busy\}/, "没有可调用资料或主体时必须禁用知识抽屉的执行按钮");

assert.match(agent, /完整IP定位方案/, "服务端必须拒绝把带有完整全案标题的追问当作访谈");
assert.match(agent, /questionMarks\.length === 1/, "服务端必须限制每轮定位访谈只问一个关键问题");
assert.match(agent, /isIpPositioningDeliveryAnswer/, "完整全案即使包含问题提示也不能被误判为访谈返工");

console.log("IP positioning workbench smoke passed.");
