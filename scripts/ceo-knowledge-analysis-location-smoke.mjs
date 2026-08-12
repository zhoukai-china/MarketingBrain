import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const knowledgePage = await readFile(resolve(root, "apps/web/src/pages/KnowledgeBasePage.tsx"), "utf8");
const ceoPanel = await readFile(resolve(root, "apps/web/src/components/ceo/CeoKnowledgeAnalysisPanel.tsx"), "utf8");
const workspace = await readFile(resolve(root, "apps/web/src/pages/AgentProductsApp.tsx"), "utf8");

if (!knowledgePage.includes("经营分析已移至 CEO 驾驶舱")) throw new Error("knowledge base does not redirect analysis to the CEO cockpit");
if (knowledgePage.includes("选择分析智能体")) throw new Error("knowledge base still renders the analysis-agent selection UI");
if (!ceoPanel.includes('apiPath("/knowledge-base/analyses")')) throw new Error("CEO analysis panel does not use the existing permission-scoped analysis API");
if (!ceoPanel.includes("/knowledge-base/documents?")) throw new Error("CEO analysis panel does not load subject-scoped documents");
if (!workspace.includes("<CeoKnowledgeAnalysisPanel />")) throw new Error("CEO workspace does not render the knowledge analysis panel");

console.log("CEO knowledge analysis location smoke passed.");
