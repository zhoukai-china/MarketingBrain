import assert from "node:assert/strict";
import {
  BEAUTY_DAILY_BRIEF_LIVE_LIMITS,
  buildBeautyDailyBriefLivePrompt,
  collectBeautyDailyBriefSources,
  estimateBeautyDailyBriefWorstModelCost,
  parseBeautyDailyBriefArticle,
  parseBeautyDailyBriefLiveReport,
  validateBeautyDailyBriefCandidateDiversity,
  validateBeautyDailyBriefSourceDiversity,
  validateBeautyDailyBriefLiveConfig
} from "../apps/api/src/products/beauty-industry/daily-brief-live.js";

async function main() {
  assert.deepEqual(BEAUTY_DAILY_BRIEF_LIVE_LIMITS.allowedHosts, [
    "www.cac.gov.cn", "www.miit.gov.cn", "www.caict.ac.cn",
    "www.jiqizhixin.com", "www.leiphone.com", "www.tmtpost.com"
  ]);
  assert.equal(BEAUTY_DAILY_BRIEF_LIVE_LIMITS.maxHttpRequestsPerDay, 36);
  assert.equal(BEAUTY_DAILY_BRIEF_LIVE_LIMITS.maxModelCallsPerDay, 1);
  assert.equal(BEAUTY_DAILY_BRIEF_LIVE_LIMITS.initialDetailRequestsPerHost, 5);
  assert.equal(BEAUTY_DAILY_BRIEF_LIVE_LIMITS.maxDetailRequestsPerHost, 10);
  assert.equal(BEAUTY_DAILY_BRIEF_LIVE_LIMITS.maxRedirectHops, 2);
  assert.ok(estimateBeautyDailyBriefWorstModelCost() <= 0.13);
  assert.deepEqual(validateBeautyDailyBriefLiveConfig({ dailyHttp: 36, monthlyHttp: 1116, dailyModels: 1, monthlyModels: 31, dailyCost: 0.13, monthlyCost: 4.1 }), []);
  assert.match(validateBeautyDailyBriefLiveConfig({ dailyHttp: 37, monthlyHttp: 1116, dailyModels: 1, monthlyModels: 31, dailyCost: 0.13, monthlyCost: 4.1 }).join("|"), /daily_http_limit/);

  const cutoffAt = new Date("2026-08-26T01:00:00.000Z");
  assert.ok(parseBeautyDailyBriefArticle(`<html><head><title>AI美容门店智能体产品发布</title><meta property="article:published_time" content="2026-08-26T00:30:00.000Z"></head><body>人工智能帮助美容门店和美甲美睫经营者改善内容与服务流程。</body></html>`, { url: "https://www.cac.gov.cn/a.html", title: "AI美容门店智能体产品发布" }, cutoffAt));
  const genericAi = parseBeautyDailyBriefArticle(`<html><head><title>通用人工智能模型能力更新</title><meta property="article:published_time" content="2026-08-26T00:30:00.000Z"></head><body>新一代大模型发布了更稳定的结构化输出与工具调用能力，并公布了公开技术说明。</body></html>`, { url: "https://www.caict.ac.cn/general-ai.html", title: "通用人工智能模型能力更新" }, cutoffAt);
  assert.ok(genericAi, "真实通用 AI 新闻不应只因原文没有美业词而被来源事实层拒绝");
  assert.equal(genericAi.directBeautyEvidence, false);
  assert.equal(genericAi.sourceIndustry, "AI研究");
  const genericAiBatch = Array.from({ length: 21 }, (_, index) => parseBeautyDailyBriefArticle(`<html><head><title>人工智能模型公开更新${index + 1}</title><meta property="article:published_time" content="2026-08-26T00:30:00.000Z"></head><body>大模型公开了第${index + 1}项结构化输出、工具调用与技术评测说明。</body></html>`, { url: `https://www.caict.ac.cn/general-ai-${index + 1}.html`, title: `人工智能模型公开更新${index + 1}` }, cutoffAt));
  assert.equal(genericAiBatch.filter(Boolean).length, 21, "21条真实AI详情不得再仅因缺少美业词全部被拒绝");
  assert.equal(parseBeautyDailyBriefArticle(`<html><head><title>普通零售门店促销活动</title><meta property="article:published_time" content="2026-08-26T00:30:00.000Z"></head><body>商场发布普通消费促销安排与营业时间通知。</body></html>`, { url: "https://www.tmtpost.com/non-ai.html", title: "普通零售门店促销活动" }, cutoffAt), undefined, "非 AI 新闻必须继续失败关闭");
  const pages = new Map<string, string>();
  for (const [index, url] of BEAUTY_DAILY_BRIEF_LIVE_LIMITS.listUrls.entries()) {
    const host = new URL(url).hostname;
    const candidateCount = index === 0 ? 30 : 5;
    pages.set(url, Array.from({ length: candidateCount }, (_, item) => {
      const id = index * 100 + item;
      return `<a href="https://${host}/article-${id}.html">AI美容门店智能体产品发布${id}</a><time>2026-08-26 08:${String(30 - item).padStart(2, "0")}</time>`;
    }).join(""));
    for (let item = 0; item < candidateCount; item += 1) {
      const id = index * 100 + item;
      pages.set(`https://${host}/article-${id}.html`, `<html><head><title>AI美容门店智能体产品发布${id}</title><meta property="article:published_time" content="2026-08-26T00:30:00.000Z"></head><body>人工智能帮助美容门店、皮肤管理和美甲美睫经营者改善内容与服务流程。这是公开产品发布资料，只用于合成离线测试。</body></html>`);
    }
  }
  let calls = 0;
  const result = await collectBeautyDailyBriefSources({
    cutoffAt,
    fetchImpl: async (url) => {
      calls += 1;
      const body = pages.get(String(url));
      return new Response(body ?? "missing", { status: body ? 200 : 404, headers: { "content-type": "text/html" } });
    }
  });
  assert.equal(calls, 36, "采集必须在6列表+30详情的绝对上限内停止");
  assert.equal(result.requestCount, 36);
  assert.equal(result.candidates.length, 30);
  assert.equal(result.redirectBlockedCount, 0);
  assert.ok(result.candidates.every((item) => BEAUTY_DAILY_BRIEF_LIVE_LIMITS.allowedHosts.includes(new URL(item.sourceUrl).hostname)));
  const livePrompt = buildBeautyDailyBriefLivePrompt({ businessDate: "2026-08-26", cutoffAt, sourceWindowHours: 72, trigger: "manual", candidates: result.candidates });
  assert.match(livePrompt, /至少覆盖4个来源域/);
  assert.match(livePrompt, /来源事实层/);
  assert.match(livePrompt, /inferenceLabel 固定为 beauty_interpretation/);
  assert.match(livePrompt, /不得写成已经在美业、门店或顾客中发生/);
  const detailByHost = Object.fromEntries(BEAUTY_DAILY_BRIEF_LIVE_LIMITS.allowedHosts.map((host) => [
    host,
    result.observations.filter((item) => item.kind === "detail" && item.host === host).length
  ]));
  assert.deepEqual(detailByHost, Object.fromEntries(BEAUTY_DAILY_BRIEF_LIVE_LIMITS.allowedHosts.map((host) => [host, 5])), "首轮必须让六个有候选域各获得5个详情机会，不能由单域吞掉30个预算");
  assert.ok(result.sourceStats.every((item) => item.allocatedDetails === 5 && item.actualDetailRequests === 5));

  for (const [format, feed] of [
    ["rss", `<rss><channel><item><title>人工智能模型发布公开说明</title><link>https://www.cac.gov.cn/rss-ai.html</link><pubDate>2026-08-26 08:30</pubDate></item></channel></rss>`],
    ["atom", `<feed><entry><title>人工智能监管报告正式发布</title><link href="https://www.cac.gov.cn/atom-ai.html"/><published>2026-08-26T00:30:00.000Z</published></entry></feed>`]
  ] as const) {
    let feedCalls = 0;
    const parsedFeed = await collectBeautyDailyBriefSources({
      cutoffAt,
      listUrls: [BEAUTY_DAILY_BRIEF_LIVE_LIMITS.listUrls[0]],
      maxDetailRequests: 1,
      fetchImpl: async () => {
        feedCalls += 1;
        if (feedCalls === 1) return new Response(feed, { status: 200, headers: { "content-type": format === "rss" ? "application/rss+xml" : "application/atom+xml" } });
        return new Response(`<html><head><title>人工智能公开事件</title><meta property="article:published_time" content="2026-08-26T00:30:00.000Z"></head><body>人工智能模型发布了可核验的公开技术与监管说明。</body></html>`, { status: 200 });
      }
    });
    assert.equal(parsedFeed.candidates.length, 1, `${format} item/entry 应进入同一确定性列表解析链`);
    assert.equal(feedCalls, 2, `${format} 解析不得产生隐藏请求`);
  }

  const partialPages = new Map(pages);
  partialPages.set(BEAUTY_DAILY_BRIEF_LIVE_LIMITS.listUrls[1], "");
  partialPages.set(BEAUTY_DAILY_BRIEF_LIVE_LIMITS.listUrls[2], "");
  const partial = await collectBeautyDailyBriefSources({ cutoffAt, fetchImpl: async (url) => {
    const body = partialPages.get(String(url));
    return new Response(body ?? "missing", { status: body === undefined ? 404 : 200 });
  } });
  assert.ok(partial.requestCount <= 36);
  assert.ok(partial.sourceStats.every((item) => item.allocatedDetails <= BEAUTY_DAILY_BRIEF_LIVE_LIMITS.maxDetailRequestsPerHost));
  assert.equal(partial.sourceStats.find((item) => item.host === "www.miit.gov.cn")?.allocatedDetails, 0);
  assert.equal(partial.sourceStats.find((item) => item.host === "www.caict.ac.cn")?.allocatedDetails, 0);

  const redirect = await collectBeautyDailyBriefSources({
    cutoffAt,
    listUrls: [BEAUTY_DAILY_BRIEF_LIVE_LIMITS.listUrls[0]],
    maxDetailRequests: 1,
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://example.com/out" } })
  });
  assert.equal(redirect.redirectBlockedCount, 1);
  assert.equal(redirect.candidates.length, 0);
  assert.equal(redirect.observations[0]?.redirectClass, "external_blocked");
  assert.equal(redirect.observations[0]?.finalHost, "example.com");
  assert.equal(redirect.observations[0]?.retryable, false);
  assert.equal(redirect.observations[0]?.requestBudgetImpact, 1);

  await assertRedirect("same_host", "https://www.cac.gov.cn/canonical", ["https://www.cac.gov.cn/canonical"]);
  await assertRedirect("allowlisted_cross_host", "https://www.miit.gov.cn/canonical", ["https://www.miit.gov.cn/canonical"]);
  const crossHostVisited: string[] = [];
  const crossHostRelative = await collectBeautyDailyBriefSources({
    cutoffAt,
    listUrls: [BEAUTY_DAILY_BRIEF_LIVE_LIMITS.listUrls[0]],
    maxDetailRequests: 1,
    fetchImpl: async (url) => {
      crossHostVisited.push(String(url));
      if (crossHostVisited.length === 1) return new Response(null, { status: 302, headers: { location: "https://www.miit.gov.cn/canonical-list" } });
      if (crossHostVisited.length === 2) return new Response('<a href="/relative-detail">AI美容门店跨域规范链接</a><time>2026-08-26 08:30</time>', { status: 200 });
      return new Response('<html><head><title>AI美容门店跨域规范链接</title><meta property="article:published_time" content="2026-08-26T00:30:00.000Z"></head><body>人工智能帮助美容门店改善经营流程。</body></html>', { status: 200 });
    }
  });
  assert.equal(crossHostVisited[2], "https://www.miit.gov.cn/relative-detail", "白名单跨域后的相对详情链接必须以最终列表URL解析");
  assert.equal(new URL(crossHostRelative.candidates[0]?.sourceUrl ?? "https://invalid.invalid").hostname, "www.miit.gov.cn");

  const loop = await collectBeautyDailyBriefSources({ cutoffAt, listUrls: [BEAUTY_DAILY_BRIEF_LIVE_LIMITS.listUrls[0]], maxDetailRequests: 0, fetchImpl: async (url) => new Response(null, { status: 302, headers: { location: String(url) } }) });
  assert.equal(loop.observations[0]?.redirectClass, "loop_blocked");
  assert.equal(loop.observations[0]?.rejectionReason, "redirect_loop");

  const tooManyRedirects = await collectBeautyDailyBriefSources({ cutoffAt, listUrls: [BEAUTY_DAILY_BRIEF_LIVE_LIMITS.listUrls[0]], maxDetailRequests: 0, fetchImpl: async (url) => {
    const hop = Number(new URL(String(url)).searchParams.get("hop") ?? 0);
    return new Response(null, { status: 302, headers: { location: `https://www.cac.gov.cn/yaowen/wxyw/A093602index_1.htm?hop=${hop + 1}` } });
  } });
  assert.equal(tooManyRedirects.observations.length, 3);
  assert.equal(tooManyRedirects.observations.at(-1)?.redirectClass, "limit_blocked");

  for (const [status, reason, retryable] of [[412, "http_412_adapter_required", false], [404, "http_404", false], [429, "http_429", true], [503, "http_5xx", true]] as const) {
    let classifiedCalls = 0;
    const classified = await collectBeautyDailyBriefSources({ cutoffAt, listUrls: [BEAUTY_DAILY_BRIEF_LIVE_LIMITS.listUrls[0]], maxDetailRequests: 1, fetchImpl: async () => {
      classifiedCalls += 1;
      if (classifiedCalls === 1) return new Response('<a href="https://www.cac.gov.cn/status.html">AI美容门店来源状态测试</a><time>2026-08-26 08:30</time>', { status: 200 });
      return new Response("", { status });
    } });
    assert.equal(classified.observations[1]?.rejectionReason, reason);
    assert.equal(classified.observations[1]?.retryable, retryable);
    assert.equal(classified.observations[1]?.stage, "detail_fetch");
    assert.equal(classified.requestCount, 2, `${status}不得在采集器内隐式重试`);
  }

  const diversityCandidates = result.candidates.slice(0, 5).concat(result.candidates.slice(5, 10), result.candidates.slice(10, 15), result.candidates.slice(15, 20));
  assert.deepEqual(validateBeautyDailyBriefCandidateDiversity(diversityCandidates), []);
  assert.match(validateBeautyDailyBriefCandidateDiversity(result.candidates.filter((item) => new URL(item.sourceUrl).hostname === "www.cac.gov.cn")).join("|"), /domain_count_insufficient|single_domain_exceeded/);
  const diverseSections = Array.from({ length: 5 }, (_, sectionIndex) => ({ name: `section-${sectionIndex}`, items: Array.from({ length: 3 }, (_, itemIndex) => ({ sourceUrl: `https://${BEAUTY_DAILY_BRIEF_LIVE_LIMITS.allowedHosts[(sectionIndex + itemIndex) % 6]}/item-${sectionIndex}-${itemIndex}` })) }));
  assert.deepEqual(validateBeautyDailyBriefSourceDiversity({ sections: diverseSections } as never), []);
  const monopolySections = Array.from({ length: 5 }, (_, sectionIndex) => ({ name: `section-${sectionIndex}`, items: Array.from({ length: 3 }, (_, itemIndex) => ({ sourceUrl: `https://www.leiphone.com/item-${sectionIndex}-${itemIndex}` })) }));
  assert.match(validateBeautyDailyBriefSourceDiversity({ sections: monopolySections } as never).join("|"), /domain_count_insufficient|single_domain_exceeded|regulator_missing|research_missing/);

  const reportCandidates = [genericAi, ...result.candidates.filter((item) => item.sourceUrl !== genericAi.sourceUrl)].slice(0, 15);
  const validReport = buildReport(reportCandidates, cutoffAt);
  assert.doesNotThrow(() => parseBeautyDailyBriefLiveReport(JSON.stringify(validReport), reportCandidates), "通用 AI 来源事实与明确标记的美业推断应通过两层合同");
  const inventedBeautyFact = structuredClone(validReport);
  inventedBeautyFact.sections[0].items[0].summary = "该来源已经证明人工智能在美业门店获得顾客增长并提升成交结果，这一结论来自通用模型更新和结构化输出能力发布，门店可直接作为经营成效引用，无需再核验具体适用条件与实施证据。";
  assert.throws(() => parseBeautyDailyBriefLiveReport(JSON.stringify(inventedBeautyFact), reportCandidates), /beauty_fact_not_in_source/, "通用 AI 新闻不得被改写成已经发生的美业事实");
  const unmarkedInference = structuredClone(validReport);
  delete (unmarkedInference.sections[0].items[0] as { inferenceLabel?: string }).inferenceLabel;
  assert.throws(() => parseBeautyDailyBriefLiveReport(JSON.stringify(unmarkedInference), reportCandidates), /inference_label_missing/, "美业推断未标记必须失败关闭");
  const unsupportedSourceFact = structuredClone(validReport);
  unsupportedSourceFact.sections[0].items[0].sourceFacts = ["该模型已让某门店成交额提升百分之五十"];
  assert.throws(() => parseBeautyDailyBriefLiveReport(JSON.stringify(unsupportedSourceFact), reportCandidates), /source_fact_not_grounded|beauty_fact_not_in_source/, "无来源的美业数字或经营结果必须失败关闭");
  const crossIndustry = parseBeautyDailyBriefArticle(`<html><head><title>零售企业发布人工智能客服改造方案</title><meta property="article:published_time" content="2026-08-26T00:30:00.000Z"></head><body>一家零售企业公开了人工智能客服与业务流程改造方法，原文只描述零售行业实践。</body></html>`, { url: "https://www.tmtpost.com/retail-ai.html", title: "零售企业发布人工智能客服改造方案" }, cutoffAt);
  assert.equal(crossIndustry?.sourceIndustry, "零售");
  assert.equal(crossIndustry?.directBeautyEvidence, false, "跨行业案例只能保留原行业事实，不能冒充美业案例");

  assert.equal(calls, 36, "全部fixture使用注入fetch，不访问真实网络");
  console.log("beauty industry daily brief live P1 smoke passed");

  async function assertRedirect(expectedClass: "same_host" | "allowlisted_cross_host", destination: string, followed: string[]) {
    const visited: string[] = [];
    const redirected = await collectBeautyDailyBriefSources({
      cutoffAt,
      listUrls: [BEAUTY_DAILY_BRIEF_LIVE_LIMITS.listUrls[0]],
      maxDetailRequests: 0,
      fetchImpl: async (url) => {
        visited.push(String(url));
        if (visited.length === 1) return new Response(null, { status: 302, headers: { location: destination } });
        return new Response("", { status: 200 });
      }
    });
    assert.equal(redirected.observations[0]?.redirectClass, expectedClass);
    assert.equal(redirected.observations.length, 2);
    assert.deepEqual(visited.slice(1), followed);
  }
}

function buildReport(candidates: NonNullable<ReturnType<typeof parseBeautyDailyBriefArticle>>[], cutoffAt: Date) {
  const sectionNames = ["模型动态", "产品发布", "行业风云", "企业改造案例", "趋势洞察"] as const;
  return {
    productCode: "beauty-industry",
    capabilityId: "beauty_daily_brief",
    contractVersion: "1.0.0",
    businessDate: "2026-08-26",
    cutoffAt: cutoffAt.toISOString(),
    generatedAt: cutoffAt.toISOString(),
    lastSuccessfulAt: cutoffAt.toISOString(),
    trigger: "manual" as const,
    sourceWindowHours: 72 as const,
    runtimeMode: "live" as const,
    sections: sectionNames.map((name, sectionIndex) => ({
      name,
      items: candidates.slice(sectionIndex * 3, sectionIndex * 3 + 3).map((source) => ({
        section: name,
        source: source.source,
        title: source.title,
        summary: source.directBeautyEvidence
          ? "公开来源说明人工智能帮助美容门店、皮肤管理和美甲美睫经营者改善内容与服务流程；这段摘要只保留来源所述事实，不扩写任何顾客、价格、疗效或经营结果。"
          : "公开来源说明新一代大模型发布了更稳定的结构化输出与工具调用能力，并公布公开技术说明；这段摘要只记录来源所述技术变化，不代表已经在任何具体行业或经营场景落地。",
        sourceFacts: [source.excerpt.slice(0, 80)],
        sourceIndustry: source.sourceIndustry,
        sourceLabel: source.source,
        sitongComment: "若门店准备试用相关能力，建议先选一个低风险流程做小样本验证，记录人工复核时间、错误类型和实际成本，再决定是否扩大使用。",
        inferenceLabel: "beauty_interpretation" as const,
        possibleImpact: "若能力在当前门店数据与权限条件下验证稳定，可能减少部分重复整理工作，但不能直接推定获客或成交提升。",
        applicabilityConditions: ["已确认数据权限、人工复核责任与小范围试用流程"],
        verificationNeeded: ["核验产品能力、当前价格、输出准确率和门店实际节省时间"],
        sourceUrl: source.sourceUrl,
        publishedAt: source.publishedAt,
        verificationStatus: "verified_hotspot" as const,
        beautySegments: ["全美业"],
        sourceWindowHours: 72 as const
      }))
    })),
    trends: [1, 2, 3].map((index) => ({ title: `趋势${index}`, evidence: "来自本报告已核验来源的共同变化。", action: "先做小范围验证，不把趋势当成经营结果。" })),
    todayAction: { title: "建立一项AI工具验证清单", why: "把来源事实与门店推断分开后再决策。", steps: ["核对来源", "记录适用条件", "安排小样本验证"] }
  };
}

void main();
