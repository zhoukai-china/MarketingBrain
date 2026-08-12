import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../apps/web/src/pages/AgentProductsApp.tsx", import.meta.url), "utf8");
const workbench = readFileSync(new URL("../apps/web/src/components/acquisition/TopicSystemWorkbench.tsx", import.meta.url), "utf8");
const definitions = readFileSync(new URL("../apps/api/src/services/agent-definitions.ts", import.meta.url), "utf8");
const acquisitionStart = definitions.indexOf('id: "agent_acquisition"');
const nextAgentStart = definitions.indexOf('\n  {\n    id: "agent_', acquisitionStart + 1);
const acquisitionDefinition = definitions.slice(acquisitionStart, nextAgentStart === -1 ? undefined : nextAgentStart);

assert.match(workbench, /品牌\s*\/\s*项目名称/, "招商 Brief 必须要求品牌或项目名称");
assert.match(workbench, /目标加盟商/, "招商 Brief 必须要求目标加盟商");
assert.match(workbench, /本轮\{scopeLabel\}目标/, "Brief 必须提供本轮目标字段");
assert.match(workbench, /招商主推产品\s*\/\s*加盟模型/, "招商 Brief 必须提供加盟模型补充项");
assert.match(workbench, /门店\s*\/\s*项目名称/, "门店 Brief 必须要求门店或项目名称");
assert.match(workbench, /团购下单/, "门店 Brief 必须允许团购目标");
assert.match(page, /品牌招商边界/, "招商选题请求必须显式限制为招商加盟内容");
assert.match(page, /门店获客边界/, "门店选题请求必须显式限制为门店消费者内容");
assert.match(page, /不得生成门店到店、团购券、消费者优惠/, "招商系统必须阻止门店团购输出");
assert.doesNotMatch(page, /IpPositioningWorkbench/, "品牌获客工作台不应再加载 IP 定位页面");
assert.doesNotMatch(acquisitionDefinition, /id: "ip_positioning_system"/, "品牌获客工作地图不应再展示 IP 定位节点");
assert.doesNotMatch(acquisitionDefinition, /key: "ip_positioning"/, "品牌获客能力列表不应再暴露 IP 定位");

assert.match(workbench, /agents\/\$\{agentSlug\}\/latest-video-review/, "Video review data must be isolated by the active agent.");
assert.match(workbench, /const storageSuffix = `\$\{mode\}_\$\{subjectId \|\| "enterprise"\}`/, "Topic brief cache must be isolated by agent mode.");

console.log("topic brief workbench smoke passed");
