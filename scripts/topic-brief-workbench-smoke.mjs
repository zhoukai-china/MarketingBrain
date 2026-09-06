import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../apps/web/src/pages/AgentProductsApp.tsx", import.meta.url), "utf8");
const workbench = readFileSync(new URL("../apps/web/src/components/acquisition/TopicSystemWorkbench.tsx", import.meta.url), "utf8");
const definitions = readFileSync(new URL("../apps/api/src/services/agent-definitions.ts", import.meta.url), "utf8");
const acquisitionStart = definitions.indexOf('id: "agent_acquisition"');
const nextAgentStart = definitions.indexOf('\n  {\n    id: "agent_', acquisitionStart + 1);
const acquisitionDefinition = definitions.slice(acquisitionStart, nextAgentStart === -1 ? undefined : nextAgentStart);

assert.match(workbench, /mode: "founder"/, "创始人 IP 选题系统必须有统一四目标模式");
assert.match(workbench, /招商加盟/, "Brief 必须提供招商加盟目标");
assert.match(workbench, /C端团购到店/, "Brief 必须提供团购到店目标");
assert.match(workbench, /学员招募/, "Brief 必须提供学员招募目标");
assert.match(workbench, /合作方招募/, "Brief 必须提供合作方招募目标");
assert.match(workbench, /创始人身份/, "Brief 必须收集创始人身份");
assert.match(workbench, /本轮线索目标/, "Brief 必须收集本轮线索目标");
assert.match(page, /招商加盟边界/, "选题请求必须显式限制招商加盟内容");
assert.match(page, /C端团购到店边界/, "选题请求必须显式限制团购到店内容");
assert.match(page, /学员招募边界/, "选题请求必须显式限制学员招募内容");
assert.match(page, /合作方招募边界/, "选题请求必须显式限制合作方招募内容");
assert.doesNotMatch(page, /IpPositioningWorkbench/, "品牌获客工作台不应再加载 IP 定位页面");
assert.doesNotMatch(acquisitionDefinition, /id: "ip_positioning_system"/, "品牌获客工作地图不应再展示 IP 定位节点");
assert.doesNotMatch(acquisitionDefinition, /key: "ip_positioning"/, "品牌获客能力列表不应再暴露 IP 定位");

assert.match(workbench, /agents\/\$\{agentSlug\}\/latest-video-review/, "Video review data must be isolated by the active agent.");
assert.match(workbench, /const storageSuffix = `\$\{mode\}_\$\{subjectId \|\| "enterprise"\}\$\{isFounderMode \? `_\$\{activeTarget\}` : ""\}`/, "Topic brief cache must be isolated by agent mode, subject and founder target.");

console.log("topic brief workbench smoke passed");
