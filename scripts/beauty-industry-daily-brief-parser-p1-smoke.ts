import assert from "node:assert/strict";
import {
  BEAUTY_DAILY_BRIEF_LIVE_LIMITS,
  BEAUTY_DAILY_BRIEF_SOURCE_ADAPTERS,
  collectBeautyDailyBriefSources,
  inspectBeautyDailyBriefArticle,
  parseBeautyDailyBriefArticle
} from "../apps/api/src/products/beauty-industry/daily-brief-live.js";

async function main() {
  const cutoffAt = new Date("2026-08-26T01:00:00.000Z");

  const navigationFalsePositive = parseBeautyDailyBriefArticle(`
    <html><head><title>普通企业会议通知</title></head><body>
      <nav>AI 大模型 人工智能 智能体</nav>
      <main><h1>普通企业会议通知</h1><p>本页面只公布会议时间与会场安排，不包含人工智能新闻事实。</p></main>
      <footer>2026-08-26 08:30</footer>
    </body></html>
  `, { url: "https://www.leiphone.com/not-an-ai-article.html", title: "普通企业会议通知" }, cutoffAt);
  assert.equal(navigationFalsePositive, undefined, "导航 AI 词与页脚日期不得把非 AI 页面冒充文章");

  let calls = 0;
  const missingDate = await collectBeautyDailyBriefSources({
    cutoffAt,
    listUrls: [BEAUTY_DAILY_BRIEF_LIVE_LIMITS.listUrls[0]],
    maxDetailRequests: 1,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response('<a href="/detail.html">人工智能模型正式发布说明</a>', { status: 200 });
      return new Response('<html><head><title>人工智能模型正式发布说明</title></head><body><article><p>该公开说明介绍大模型能力更新与评测边界。</p></article></body></html>', { status: 200 });
    }
  });
  assert.equal(missingDate.candidates.length, 0);
  assert.equal(missingDate.sourceStats[0]?.rejected.article_date_missing, 1, "缺日期必须精准归因，不能折叠成通用合同失败");

  assert.deepEqual(BEAUTY_DAILY_BRIEF_SOURCE_ADAPTERS.map(({ host, listUrl }) => ({ host, listUrl })),
    BEAUTY_DAILY_BRIEF_LIVE_LIMITS.allowedHosts.map((host, index) => ({ host, listUrl: BEAUTY_DAILY_BRIEF_LIVE_LIMITS.listUrls[index] })),
    "六个授权域必须各有显式、版本化的来源 adapter，不得动态猜站点");

  for (const adapter of BEAUTY_DAILY_BRIEF_SOURCE_ADAPTERS) {
    const normal = inspectBeautyDailyBriefArticle(`
      <html><head>
        <title>旧页面标题</title>
        <meta content="人工智能模型公开更新" property="og:title">
        <meta content="2026-08-26T00:30:00.000Z" property="article:published_time">
        <link href="/canonical-ai.html?utm_source=fixture" rel="canonical">
      </head><body><article><h1>人工智能模型公开更新</h1><p>大模型发布了结构化输出能力、公开评测结果与适用边界。</p></article></body></html>
    `, { url: `https://${adapter.host}/detail.html`, title: "人工智能模型公开更新" }, cutoffAt);
    assert.ok(normal.candidate, `${adapter.host} 标准 meta/article 结构必须通过`);
    assert.equal(normal.canonicalClass, "same_host");
    assert.equal(normal.candidate?.sourceUrl, `https://${adapter.host}/canonical-ai.html`);

    const variant = inspectBeautyDailyBriefArticle(`
      <html><head><script type="application/ld+json">{"headline":"生成式人工智能治理报告发布","datePublished":"2026-08-26T00:25:00.000Z","articleBody":"权威机构发布生成式人工智能治理报告，并说明适用范围和核验边界。"}</script></head><body></body></html>
    `, { url: `https://${adapter.host}/variant.html`, title: "生成式人工智能治理报告发布" }, cutoffAt);
    assert.ok(variant.candidate, `${adapter.host} JSON-LD 变体必须走共享标准 parser`);

    const dateMissing = inspectBeautyDailyBriefArticle('<html><head><title>人工智能模型发布</title></head><body><article><p>大模型发布公开能力说明与评测范围。</p></article></body></html>', { url: `https://${adapter.host}/date-missing.html`, title: "人工智能模型发布" }, cutoffAt);
    assert.equal(dateMissing.rejectionReason, "article_date_missing");
    const bodyMissing = inspectBeautyDailyBriefArticle('<html><head><title>人工智能模型发布</title><meta property="article:published_time" content="2026-08-26T00:30:00.000Z"></head><body><nav>人工智能栏目</nav></body></html>', { url: `https://${adapter.host}/body-missing.html`, title: "人工智能模型发布" }, cutoffAt);
    assert.equal(bodyMissing.rejectionReason, "article_body_missing");
  }

  let precedingDateCalls = 0;
  const precedingDate = await collectBeautyDailyBriefSources({
    cutoffAt,
    listUrls: [BEAUTY_DAILY_BRIEF_LIVE_LIMITS.listUrls[0]],
    maxDetailRequests: 1,
    fetchImpl: async () => {
      precedingDateCalls += 1;
      if (precedingDateCalls === 1) return new Response('<section><time>2026-08-26 08:20</time><a href="/preceding-date.html">人工智能模型公开更新</a></section>', { status: 200 });
      return new Response('<html><head><title>人工智能模型公开更新</title></head><body><article><p>大模型发布了结构化输出能力与公开技术说明，并披露了适用范围、评测方法和核验边界。</p></article></body></html>', { status: 200 });
    }
  });
  assert.equal(precedingDate.candidates.length, 1, "列表日期位于链接前方时也必须作为同一条目的日期证据");

  for (const adapter of BEAUTY_DAILY_BRIEF_SOURCE_ADAPTERS) {
    for (const [status, reason] of [[412, "http_412_adapter_required"], [404, "http_404"]] as const) {
      const failure = await collectBeautyDailyBriefSources({
        cutoffAt,
        listUrls: [adapter.listUrl],
        maxDetailRequests: 0,
        fetchImpl: async () => new Response("", { status })
      });
      assert.equal(failure.requestCount, 1);
      assert.equal(failure.sourceStats.find((item) => item.host === adapter.host)?.listStatuses[0], status);
      assert.equal(failure.observations[0]?.rejectionReason, reason);
    }
    const empty = await collectBeautyDailyBriefSources({ cutoffAt, listUrls: [adapter.listUrl], maxDetailRequests: 0, fetchImpl: async () => new Response("", { status: 200 }) });
    assert.equal(empty.sourceStats.find((item) => item.host === adapter.host)?.listCandidates, 0);

    const visited: string[] = [];
    const redirected = await collectBeautyDailyBriefSources({
      cutoffAt,
      listUrls: [adapter.listUrl],
      maxDetailRequests: 0,
      fetchImpl: async (url) => {
        visited.push(String(url));
        if (visited.length === 1) return new Response(null, { status: 302, headers: { location: `https://${adapter.host}/canonical-list` } });
        return new Response("", { status: 200 });
      }
    });
    assert.equal(redirected.observations[0]?.redirectClass, "same_host");
    assert.equal(redirected.requestCount, 2, `${adapter.host} 站内跳转的每个实际HTTP都必须计数`);
  }

  const priorZero = await collectPriorAuditDistribution(0, cutoffAt);
  assert.equal(priorZero.requestCount, 29);
  assert.equal(priorZero.candidates.length, 0);
  assert.equal(priorZero.sourceStats.find((item) => item.host === "www.caict.ac.cn")?.listStatuses[0], 412);
  assert.equal(priorZero.sourceStats.find((item) => item.host === "www.leiphone.com")?.actualDetailRequests, 12);
  assert.equal(priorZero.sourceStats.find((item) => item.host === "www.tmtpost.com")?.rejected.article_ai_fact_missing, 10);
  const priorTwo = await collectPriorAuditDistribution(2, cutoffAt);
  assert.equal(priorTwo.requestCount, 29);
  assert.equal(priorTwo.candidates.length, 2);
  assert.equal(priorTwo.sourceStats.find((item) => item.host === "www.leiphone.com")?.rejected.article_date_missing, 8);
  assert.equal(priorTwo.sourceStats.find((item) => item.host === "www.leiphone.com")?.dateParsed, 2);
  assert.equal(priorTwo.sourceStats.find((item) => item.host === "www.leiphone.com")?.bodyParsed, 10);

  console.log("beauty industry daily brief parser P1 smoke passed; external network/provider calls=0");
}

async function collectPriorAuditDistribution(qualifiedLeiphone: 0 | 2, cutoffAt: Date) {
  const pages = new Map<string, Response | string>();
  const listUrls = BEAUTY_DAILY_BRIEF_LIVE_LIMITS.listUrls;
  pages.set(listUrls[0], "");
  pages.set(listUrls[1], '<a href="/miit-one.html">人工智能模型公开说明</a>');
  pages.set(listUrls[2], new Response("", { status: 412 }));
  pages.set(listUrls[3], "");
  pages.set(listUrls[4], Array.from({ length: 10 }, (_, index) => `<a href="/lei-${index}.html">人工智能模型公开更新${index}</a>`).join(""));
  pages.set(listUrls[5], Array.from({ length: 10 }, (_, index) => `<a href="/tmt-${index}.html">人工智能与普通业务动态${index}</a>`).join(""));
  pages.set("https://www.miit.gov.cn/miit-one.html", '<html><head><title>人工智能模型公开说明</title></head><body><article><p>大模型发布公开能力说明、技术边界与评测范围。</p></article></body></html>');
  for (let index = 0; index < 10; index += 1) {
    const leiUrl = `https://www.leiphone.com/lei-${index}.html`;
    if (index < 2) pages.set(leiUrl, new Response(null, { status: 302, headers: { location: `/lei-${index}-canonical.html` } }));
    const finalLeiUrl = index < 2 ? `https://www.leiphone.com/lei-${index}-canonical.html` : leiUrl;
    pages.set(finalLeiUrl, index < qualifiedLeiphone
      ? `<html><head><title>人工智能模型公开更新${index}</title><meta property="article:published_time" content="2026-08-26T00:30:00.000Z"></head><body><article><p>大模型发布结构化输出能力、公开评测方法与适用边界。</p></article></body></html>`
      : `<html><head><title>人工智能模型公开更新${index}</title></head><body><article><p>大模型发布结构化输出能力、公开评测方法与适用边界。</p></article></body></html>`);
    pages.set(`https://www.tmtpost.com/tmt-${index}.html`, `<html><head><title>普通企业会议安排${index}</title><meta property="article:published_time" content="2026-08-26T00:30:00.000Z"></head><body><article><p>企业公布普通会议安排、会场说明与参会流程，不包含技术发布事件。</p></article></body></html>`);
  }
  return collectBeautyDailyBriefSources({
    cutoffAt,
    fetchImpl: async (url) => {
      const response = pages.get(String(url));
      if (response instanceof Response) return response;
      return new Response(response ?? "", { status: pages.has(String(url)) ? 200 : 404 });
    }
  });
}

void main();
