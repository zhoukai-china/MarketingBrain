import { crawlPublicIndustryKnowledge, extractTrendCandidates, scanIndustryTrends } from "../apps/api/src/services/trend-intelligence.js";

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL) => {
  const url = String(input);
  if (!url.startsWith("https://")) return new Response("", { status: 400 });
  return new Response(`
    <html><body>
      <a href="https://www.miit.gov.cn/industry-ai-report.html">AI行业 产业报告 发布</a> 2026-08-10
      <article>AI行业公开资料正文。${"经过公开验证的行业资料。".repeat(30)}</article>
    </body></html>
  `, { status: 200, headers: { "content-type": "text/html" } });
}) as typeof fetch;

async function main(): Promise<void> {
  try {
  const scan = await scanIndustryTrends("AI行业", { mode: "industry", limit: 200 });
  const result = await crawlPublicIndustryKnowledge("AI行业", { limit: 50 });
  if (!scan.watchSignals.length) throw new Error(`fixture did not produce discoverable public signals: ${JSON.stringify({ scan, extracted: extractTrendCandidates('<a href="https://www.miit.gov.cn/industry-ai-report.html">AI行业 产业报告 发布</a> 2026-08-10', 'https://www.miit.gov.cn') })}`);
  if (result.documents.length !== 1) throw new Error(`expected one allowlisted public document, got ${result.documents.length}`);
  const [document] = result.documents;
  if (!document.externalId.startsWith("public:")) throw new Error("public document requires a stable external id");
  if (document.url !== "https://www.miit.gov.cn/industry-ai-report.html") throw new Error("unexpected public document source URL");
  if (document.content.length < 160) throw new Error("public document body was not extracted");
  if (result.hasMore) throw new Error("single fixture source should not have more batches");
  console.log("Industry public knowledge crawler smoke passed.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main();
