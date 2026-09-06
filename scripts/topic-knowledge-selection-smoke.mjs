import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workbench = readFileSync(new URL("../apps/web/src/components/acquisition/TopicSystemWorkbench.tsx", import.meta.url), "utf8");
const agentRoute = readFileSync(new URL("../apps/api/src/routes/agents.ts", import.meta.url), "utf8");
const knowledgeRoute = readFileSync(new URL("../apps/api/src/routes/knowledge-base.ts", import.meta.url), "utf8");

assert.match(workbench, /const effectiveSourceSubjectId = sourceSubjectId === undefined \? subjectId : sourceSubjectId \?\? undefined/, "选题录音卡必须默认锁定当前资料夹，并只允许产品工作流显式声明来源范围");
assert.match(workbench, /if \(effectiveSourceSubjectId\) documentQuery\.set\("subjectId", effectiveSourceSubjectId\)/, "选题录音卡查询必须使用已解析的来源资料夹范围");
assert.doesNotMatch(agentRoute, /knowledge_subject_mismatch/, "用户显式选择的同企业资料不应因资料夹不同被智能体运行接口拒绝");
assert.doesNotMatch(knowledgeRoute, /不能加入本次会诊/, "用户显式选择的同企业资料不应因资料夹不同被会诊接口拒绝");

console.log("topic knowledge selection smoke passed");
