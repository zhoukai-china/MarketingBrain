import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = (relativePath) => readFile(new URL(relativePath, root), "utf8");
const [page, route, crawler] = await Promise.all([
  read("apps/web/src/pages/EnterpriseKnowledgeBasePage.tsx"),
  read("apps/api/src/routes/knowledge-base.ts"),
  read("apps/api/src/services/trend-intelligence.ts")
]);

for (const [source, snippets] of [[page, ["继续扩展抓取", "补充检索关键词", "mode, keywords"]], [route, ["mode: z.enum([\"base\", \"expanded\"])", "keywords: z.array"]], [crawler, ["expanded?: boolean", "keywords?: string[]", "consumed: selected.length"]]]) {
  for (const snippet of snippets) {
    if (!source.includes(snippet)) throw new Error(`行业扩展抓取回归缺失：${snippet}`);
  }
}

console.log("enterprise knowledge expanded crawl smoke: PASS");
