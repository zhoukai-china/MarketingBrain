import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = (relativePath) => readFile(new URL(relativePath, root), "utf8");

const [page, route] = await Promise.all([
  read("apps/web/src/pages/EnterpriseKnowledgeBasePage.tsx"),
  read("apps/api/src/routes/knowledge-base.ts")
]);

const requiredPageSnippets = [
  'documentQuery.set("subjectId", nextId)',
  "documentPagination.total",
  "当前展示 {visibleDocuments.length} / 共 {documentPagination.total} 条",
  "loadMoreDocuments",
  "documentPagination.hasMore",
  "page: String(documentPagination.page + 1)",
  'if (subjectId) query.set("subjectId", subjectId)'
];

for (const snippet of requiredPageSnippets) {
  if (!page.includes(snippet)) {
    throw new Error(`企业知识库分页回归缺失：${snippet}`);
  }
}

if (!route.includes("limit: z.coerce.number().int().min(1).max(100).default(50)")) {
  throw new Error("知识库资料接口未保留安全的分页上限。");
}

console.log("enterprise knowledge pagination smoke: PASS");
