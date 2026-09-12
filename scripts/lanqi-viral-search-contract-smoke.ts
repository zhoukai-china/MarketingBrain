// 兰琪「爆款复刻 · 爆款检索源」契约冒烟（LQ-25）
//
// 用户口径（2026-09-12）：「爆款复刻」的检索源 = 抖音 + 视频号两个平台，开闸跑，
// 且暂时只在兰琪用。本冒烟**不联网、不调模型、不花钱**，只用注入的假检索结果验证：
//  ① 只保留真实可点开的平台域内页面（抖音站内页 / 微信生态页），其余站点一律丢弃；
//  ② 账号主页、搜索结果页、开放平台文档页不是「可复刻条目」，必须被拒；
//  ③ 平台筛选（抖音 / 视频号 / 全部）真实生效，不串台；
//  ④ 去重、条数上限、空关键词与空结果都按契约走；
//  ⑤ 没接通 / 上游失败 / 无有效条目一律失败关闭，**绝不编造**条目或热度数据。
import {
  VIRAL_KIND_LABELS,
  VIRAL_PLATFORM_LABELS,
  VIRAL_SEARCH_DEFAULT_LIMIT,
  VIRAL_SEARCH_EMPTY_NOTE,
  VIRAL_SEARCH_KEYWORD_MAX,
  VIRAL_SEARCH_LIMIT_MAX,
  buildViralSearchQuery,
  classifyViralUrl,
  normalizeViralKeyword,
  normalizeViralResults,
  platformsForFilter
} from "../apps/api/src/products/lanqi/viral-search-rules.js";
import {
  VIRAL_SEARCH_ERROR_CODES,
  ViralSearchError,
  searchLanqiViralVideos,
  type ViralSearchHit,
  type ViralSearchProvider
} from "../apps/api/src/products/lanqi/viral-search-service.js";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`ok - ${name}`);
  } else {
    fail++;
    console.error(`FAIL - ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

function makeProvider(hits: ViralSearchHit[] | (() => ViralSearchHit[])): ViralSearchProvider {
  return {
    name: "test_provider",
    async search() {
      return typeof hits === "function" ? hits() : hits;
    }
  };
}

function throwingProvider(message: string): ViralSearchProvider {
  return {
    name: "test_provider",
    async search() {
      throw new Error(message);
    }
  };
}

// ── ① 域名与条目类型判定 ──
const DY = "https://www.douyin.com/video/7612992738514826218";
const DY_NOTE = "https://www.douyin.com/note/7682680195718892852";

const dyVideo = classifyViralUrl(DY);
assert("抖音视频页 → dy/video", dyVideo?.platform === "dy" && dyVideo?.kind === "video", JSON.stringify(dyVideo));
assert(
  "抖音图文页 → dy/note",
  classifyViralUrl(DY_NOTE)?.kind === "note"
);
assert(
  "抖音条目 canonical 去掉 query 与尾斜杠",
  classifyViralUrl(`${DY}?from=search&x=1`)?.canonicalUrl === DY
);
assert("抖音账号主页不是可复刻条目", classifyViralUrl("https://www.douyin.com/user/MS4wLjABAAAAxyz") === null);
assert("抖音搜索结果页不是条目", classifyViralUrl("https://www.douyin.com/search/皮肤管理") === null);
assert("抖音开放平台文档不是条目", classifyViralUrl("https://developer.open-douyin.com/docs") === null);
assert("短链 v.douyin.com 不是可点开的视频页", classifyViralUrl("https://v.douyin.com/abc123/") === null);
assert("第三方站点（搜狐）一律丢弃", classifyViralUrl("https://news.sohu.com/a/732641331_121114698") === null);
assert("第三方站点（知乎）一律丢弃", classifyViralUrl("https://zhuanlan.zhihu.com/p/687229977") === null);

const sphArticle = classifyViralUrl(
  "https://mp.weixin.qq.com/s?__biz=MzI4MjU2MTU3OQ==&mid=2247490658&idx=1&sn=854250e7fb20a1545ef47452b54133dc"
);
assert(
  "微信图文页 → sph/article（真实类型，不冒充视频）",
  sphArticle?.platform === "sph" && sphArticle?.kind === "article",
  JSON.stringify(sphArticle)
);
assert("视频号站内页 → sph/channel", classifyViralUrl("https://channels.weixin.qq.com/web/pages/home")?.kind === "channel");
assert("公众号主页不是条目", classifyViralUrl("https://mp.weixin.qq.com/") === null);
assert("http 明文链接被拒", classifyViralUrl("http://www.douyin.com/video/7612992738514826218") === null);
assert("带账号密码的链接被拒", classifyViralUrl("https://user:pass@www.douyin.com/video/7612992738514826218") === null);

assert("条目类型中文标签齐全", Object.keys(VIRAL_KIND_LABELS).length === 4);
assert("平台中文标签 = 抖音/视频号", `${VIRAL_PLATFORM_LABELS.dy}/${VIRAL_PLATFORM_LABELS.sph}` === "抖音/视频号");

// ── ② 关键词与查询构造 ──
assert("空关键词被拒", normalizeViralKeyword("   ") === null);
assert("非字符串被拒", normalizeViralKeyword(undefined) === null);
assert("关键词首尾空格被裁掉", normalizeViralKeyword("  皮肤管理  ") === "皮肤管理");
assert(
  `关键词超长被拒（>${VIRAL_SEARCH_KEYWORD_MAX}）`,
  normalizeViralKeyword("皮".repeat(VIRAL_SEARCH_KEYWORD_MAX + 1)) === null
);
const dyQuery = buildViralSearchQuery("门店获客", "dy", "skin");
assert("抖音查询限定抖音站内", dyQuery.includes("site:douyin.com"), dyQuery);
assert("抖音查询带行业补充词", dyQuery.includes("皮肤管理"), dyQuery);
assert("抖音查询带关键词", dyQuery.includes("门店获客"), dyQuery);
const sphQuery = buildViralSearchQuery("门店获客", "sph");
assert("视频号查询限定微信生态", sphQuery.includes("mp.weixin.qq.com"), sphQuery);
assert("视频号查询不掺抖音站内限定", !sphQuery.includes("douyin.com"), sphQuery);
assert("平台筛选 全部 = 抖音 + 视频号", platformsForFilter("all").join(",") === "dy,sph");
assert("平台筛选 抖音 = 只有抖音", platformsForFilter("dy").join(",") === "dy");

// ── ③ 结果规范化：过滤 / 去重 / 排序 / 上限 ──
const hits: ViralSearchHit[] = [
  { siteName: "搜狐网", title: "美业门店拓新 500+", url: "https://news.sohu.com/a/732641331_121114698", snippet: "第三方站点" },
  { siteName: "抖音-记录美好生活", title: "美容院拼团获客方案", url: `${DY_NOTE}?from=search`, snippet: "抖音图文" },
  { siteName: "知乎", title: "皮肤管理中心 2 种获客途径", url: "https://zhuanlan.zhihu.com/p/413691886", snippet: "第三方站点" },
  { siteName: "抖音-记录美好生活", title: "美容院拼团获客方案", url: DY_NOTE, snippet: "同一条重复" },
  { siteName: "抖音-记录美好生活", title: "为什么一停护肤品皮肤就会变差#问题肌#新美业 - 抖音", url: `${DY}/`, snippet: "真实视频页" },
  { siteName: "抖音-记录美好生活", title: "伊智科技", url: "https://www.douyin.com/user/MS4wLjABAAAAxyz", snippet: "账号主页" },
  { siteName: "腾讯网", title: "你还不会直播，但她靠抖音流量养 50 家美业店", url: sphArticle ? sphArticle.canonicalUrl : "", snippet: "微信生态" }
];

const normalized = normalizeViralResults(hits, { platform: "all" });
assert("只留下平台域内条目（3 条：抖音视频 / 抖音图文 / 微信图文）", normalized.length === 3, `got ${normalized.length}`);
assert("抖音条目排在前面", normalized[0]?.platform === "dy", JSON.stringify(normalized.map(n => n.platform)));
assert("重复条目按 canonical 去重", normalized.filter(n => n.url === DY_NOTE).length === 1);
assert("标题里的站点尾巴被清掉", !/-\s*抖音$/.test(normalized.find(n => n.title.includes("皮肤"))?.title ?? ""), JSON.stringify(normalized.map(n => n.title)));
assert("条目带真实类型标签", normalized.every(n => n.kindLabel === VIRAL_KIND_LABELS[n.kind]));
assert("条目没有编造的字段（无播放量/点赞）", normalized.every(n => !("heat" in n) && !("playCount" in n)));
assert("条目 id 稳定可复现", normalizeViralResults(hits, { platform: "all" })[0]?.id === normalized[0]?.id);

const dyOnly = normalizeViralResults(hits, { platform: "dy" });
assert("筛选抖音时不出现视频号条目", dyOnly.every(n => n.platform === "dy") && dyOnly.length === 2, JSON.stringify(dyOnly.map(n => n.url)));
const sphOnly = normalizeViralResults(hits, { platform: "sph" });
assert("筛选视频号时不出现抖音条目", sphOnly.every(n => n.platform === "sph") && sphOnly.length === 1, JSON.stringify(sphOnly));

const manyHits: ViralSearchHit[] = Array.from({ length: 20 }, (_, i) => ({
  siteName: "抖音-记录美好生活",
  title: `第 ${i} 条美业门店获客视频`,
  url: `https://www.douyin.com/video/76129927385148${String(1000 + i).padStart(4, "0")}`,
  snippet: "s"
}));
assert(
  `默认条数上限 = ${VIRAL_SEARCH_DEFAULT_LIMIT}`,
  normalizeViralResults(manyHits, { platform: "all" }).length === VIRAL_SEARCH_DEFAULT_LIMIT
);
assert(
  `显式上限生效且不超过 ${VIRAL_SEARCH_LIMIT_MAX}`,
  normalizeViralResults(manyHits, { platform: "all", limit: 99 }).length === VIRAL_SEARCH_LIMIT_MAX
);
assert("没有任何有效条目时返回空数组（不编造）", normalizeViralResults([hits[0], hits[2]], { platform: "all" }).length === 0);

// ── ④ 服务层：失败关闭 / 空结果 / 平台隔离 ──
async function main() {
const ok = await searchLanqiViralVideos(
  { storeId: "store-a", keyword: "门店获客", platform: "all" },
  { provider: makeProvider(hits) }
);
assert("正常检索返回条目", ok.items.length === 3, JSON.stringify(ok.items.length));
assert("返回关键词与检索说明", ok.keyword === "门店获客" && ok.disclosure.length > 10);

let disabledCode = "";
try {
  await searchLanqiViralVideos({ storeId: "store-a", keyword: "门店获客", platform: "all" }, { provider: null });
} catch (error) {
  disabledCode = error instanceof ViralSearchError ? error.code : "not_viral_search_error";
}
assert("检索源未配置 → 失败关闭（unavailable）", disabledCode === VIRAL_SEARCH_ERROR_CODES.unavailable, disabledCode);

let badKeywordCode = "";
try {
  await searchLanqiViralVideos({ storeId: "store-a", keyword: "  ", platform: "all" }, { provider: makeProvider(hits) });
} catch (error) {
  badKeywordCode = error instanceof ViralSearchError ? error.code : "not_viral_search_error";
}
assert("空关键词 → invalid_input", badKeywordCode === VIRAL_SEARCH_ERROR_CODES.invalidInput, badKeywordCode);

let upstreamCode = "";
try {
  await searchLanqiViralVideos({ storeId: "store-a", keyword: "门店获客", platform: "all" }, { provider: throwingProvider("boom") });
} catch (error) {
  upstreamCode = error instanceof ViralSearchError ? error.code : "not_viral_search_error";
}
assert("上游检索失败 → upstream_failed（不返回空壳成功）", upstreamCode === VIRAL_SEARCH_ERROR_CODES.upstreamFailed, upstreamCode);

const empty = await searchLanqiViralVideos(
  { storeId: "store-a", keyword: "门店获客", platform: "all" },
  { provider: makeProvider([hits[0], hits[2]]) }
);
assert("上游全是第三方站点 → 空结果 + 明确说明", empty.items.length === 0 && empty.note === VIRAL_SEARCH_EMPTY_NOTE);

const perPlatform: string[] = [];
await searchLanqiViralVideos(
  { storeId: "store-a", keyword: "门店获客", platform: "dy" },
  {
    provider: {
      name: "test_provider",
      async search(query) {
        perPlatform.push(query);
        return hits;
      }
    }
  }
);
assert("只搜抖音时只发抖音查询", perPlatform.length === 1 && perPlatform[0].includes("douyin.com"), perPlatform.join(" | "));

const allQueries: string[] = [];
await searchLanqiViralVideos(
  { storeId: "store-a", keyword: "门店获客", platform: "all" },
  {
    provider: {
      name: "test_provider",
      async search(query) {
        allQueries.push(query);
        return hits;
      }
    }
  }
);
assert("全部平台时两个平台各发一条查询", allQueries.length === 2 && allQueries.some(q => q.includes("douyin.com")) && allQueries.some(q => q.includes("mp.weixin.qq.com")), allQueries.join(" | "));

// ── ⑤ 来源与租户边界（源码契约，防止绕过租户校验或跑到美业侧）──
const { readFileSync } = await import("node:fs");
const routeSource = readFileSync(new URL("../apps/api/src/routes/lanqi-viral-search.ts", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("../apps/api/src/server.ts", import.meta.url), "utf8");
const webSource = readFileSync(new URL("../apps/web/src/pages/LanqiAcquireVideoPage.tsx", import.meta.url), "utf8");

assert("检索路由先做门店可见性校验（租户隔离）", /assertStoreVisible/.test(routeSource));
assert("检索路由挂在兰琪作用域（/lanqi）", /registerLanqiViralSearchRoutes/.test(serverSource) && /await registerLanqiViralSearchRoutes\(lanqi\)/.test(serverSource));
assert("检索路由没有注册到美业单品作用域", !/registerLanqiViralSearchRoutes\(beautyIndustry/.test(serverSource));
assert(
  "服务不扣费、不写流水（一期免费）",
  !/creditCost|billing|wallet|creditLedger|prisma\.\$transaction/i.test(routeSource)
);
assert("页面接真实检索接口", webSource.includes("/lanqi/acquire/video/viral-search"));
assert("页面不再硬编码「暂未接通真实爆款检索」开关", !/REPLICATE_SEARCH_READY\s*=\s*false/.test(webSource));
assert("页面文案不出现厂商与模型名", !/(百炼|通义|qwen|Qwen|DashScope|达摩院)/.test(webSource));
assert(
  "面向门店的检索文案与条目标签不出现厂商名",
  [...Object.values(VIRAL_KIND_LABELS), ...Object.values(VIRAL_PLATFORM_LABELS), empty.note, ok.disclosure].every(
    text => !/(百炼|通义|qwen|Qwen|DashScope|达摩院)/.test(text)
  )
);

console.log(`\nlanqi viral search contract smoke: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
