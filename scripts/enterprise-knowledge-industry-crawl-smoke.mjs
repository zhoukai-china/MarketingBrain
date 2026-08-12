import { readFile } from "node:fs/promises";

const [page, route] = await Promise.all([
  readFile(new URL("../apps/web/src/pages/EnterpriseKnowledgeBasePage.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/api/src/routes/knowledge-base.ts", import.meta.url), "utf8")
]);

if (!page.includes('"/knowledge-base/industry-research"')) throw new Error("行业知识入口未调用同页抓取接口");
if (/补充行业与企业经验<\/button><\/article>/.test(page)) throw new Error("行业知识按钮仍是无条件跳转入口");
if (!page.includes("请填写所属行业")) throw new Error("行业知识入口缺少行业填写交互");
if (!route.includes('"/knowledge-base/industry-research"')) throw new Error("缺少行业公开资料抓取接口");
if (!route.includes("crawlPublicIndustryKnowledge")) throw new Error("行业公开资料接口未复用受控抓取服务");
if (!route.includes("INDUSTRY_KNOWLEDGE_CAP = 200")) throw new Error("行业知识库未限制首轮最多 200 篇");
if (!route.includes("knowledgeLayer: \"enterprise_industry\"")) throw new Error("行业公开资料没有按行业知识层入库");
if (!route.includes("ownership = `subject:${subject.id}`")) throw new Error("行业公开资料连接未按主体隔离");
if (!route.includes("hasMore")) throw new Error("行业公开资料未提供增量抓取进度");
if (!page.includes("当前累计")) throw new Error("页面未展示行业知识库累计进度");
if (!page.includes("syncingConnectionIds")) throw new Error("不同知识来源仍共用同步状态");
if (page.includes("disabled={syncing}")) throw new Error("同步按钮仍会被其他来源的同步状态禁用");
if (!page.includes("body: JSON.stringify({ subjectId: subjectId || undefined })")) throw new Error("同步请求没有携带当前知识主体");
if (!route.includes("const connectionSyncSchema")) throw new Error("同步接口没有校验当前知识主体");
if (!route.includes("subjects: { create: { subjectId: subject.id } }")) throw new Error("同步资料没有归入当前主体");
if (!route.includes("assignConnectionDocumentsToSubject")) throw new Error("历史同步资料没有回填到当前主体");
if (!page.includes("归入当前主体")) throw new Error("同步完成后没有显示当前主体归属结果");

console.log("Enterprise knowledge industry crawl smoke passed.");
