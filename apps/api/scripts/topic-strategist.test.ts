// 选题策略官 · 后端已落地能力回归测试（mock 驱动，只测程序逻辑，不依赖真实大模型/外网）
//
// 运行（需放开外网校验，否则 fetch 被 domesticNetworkOnly 拦截、mock 不生效）：
//   cd apps/api && DOMESTIC_NETWORK_ONLY=false npx tsx scripts/topic-strategist.test.ts
// （package.json 的 npm test 已内置该环境变量）
//
// 覆盖的"已有功能"：
//   A. 交付物表格校验器 parseTopicTable（选题生成链路核心闸门）
//   B. 来源② 行业热点真实扫描 searchPublicTopicSources（mock fetch）
//   C. 来源④ 视频复盘指标重算 computeVidrevMetrics（纯函数）
//   D. 来源① 大脑笔记拉取 fetchGetnoteNotes（mock fetch）
//
// 注意：用例串行执行——所有用例共享全局 globalThis.fetch，若并行会在 await 间隙
// 互相覆盖 mock，导致在途请求被污染（这是测试隔离问题，非产品 bug）。

import assert from "node:assert";
import { parseTopicTable, splitRow } from "../src/services/topic-table-parser.js";
import { searchPublicTopicSources } from "../src/services/public-topic-search.js";
import { fetchGetnoteNotes } from "../src/services/getnote.js";
import { computeVidrevMetrics } from "../src/services/video-review-engine.js";

// ---------------- mock fetch 工具 ----------------
type FetchImpl = (url: string, init?: any) => any;
function installFetch(impl: FetchImpl) {
  (globalThis as any).fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input?.url ?? "";
    return impl(url, init);
  }) as any;
}
const okHtml = (body: string) => ({ ok: true, status: 200, text: async () => body, json: async () => ({}) });
const okJson = (data: any) => ({ ok: true, status: 200, text: async () => "", json: async () => data });
const failedResp = (status = 404) => ({ ok: false, status, text: async () => "", json: async () => ({}) });

// ---------------- 串行用例收集 ----------------
const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];
function check(name: string, fn: () => void | Promise<void>) {
  tests.push({ name, fn });
}

// ---------------- A. 交付物表格校验器 ----------------
const VALID_TABLE = `| # | 选题 | 类型 | 来源 | 共识层级 | 客资准度 | 创作建议 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 门店周年庆怎么拍 | 获客型 | 行业热点 | 人性共识 | ★ | 突出老客回馈 |
| 2 | 新客首单引导话术 | 转化型 | 私有知识 | 人性共识 | ★ | 强调零风险 |
| 3 | 春季护肤趋势选题 | 种草型 | 行业热点 | 时代共识 | ★★★ | 结合时令 |
| 4 | 节日礼盒内容策划 | 种草型 | 行业热点 | 时代共识 | ★★★ | 强调仪式感 |
| 5 | 会员复购权益设计 | 转化型 | 私有知识 | 利益共识 | ★★★★ | 算清回本账 |
| 6 | 拼团裂变玩法 | 转化型 | 行业热点 | 利益共识 | ★★★★ | 门槛设计 |
| 7 | 爆款视频拆解角度 | 种草型 | 对标账号 | 热点共识 | ★★★ | 蹭热点不硬凹 |
| 8 | 评论区互动选题 | 互动型 | 数据复盘 | 热点共识 | ★★★ | 引发讨论 |
| 9 | 成分科普专栏 | 专业型 | 私有知识 | 专业共识 | ★★★★★ | 引用文献 |
| 10 | 专家背书内容 | 专业型 | 私有知识 | 专业共识 | ★★★★★ | 真实案例 |

配比校验：人性共识2 / 时代共识2 / 利益共识2 / 热点共识2 / 专业共识2（合计10）`;

console.log("\n==== A. parseTopicTable 交付物表格校验器 ====");
check("A1 完整 10 行 7 列 + 正确星数绑定 + 配比块 → 0 失败", () => {
  const { rows, failures } = parseTopicTable(VALID_TABLE);
  assert.strictEqual(rows.length, 10, `应解析出 10 行，实际 ${rows.length}`);
  assert.strictEqual(failures.length, 0, "不应有失败项: " + failures.join("; "));
});
check("A2 缺表头（无 7 列 #/选题）→ 报未找到主表格", () => {
  const { failures } = parseTopicTable("随便一段文字没有表格");
  assert.ok(failures.some((f) => f.includes("未找到符合 7 列")), "应报未找到主表格，实际: " + failures.join("; "));
});
check("A3 共识层级星数错配（专业共识配 ★）→ 报应绑定 ★★★★★", () => {
  const bad = VALID_TABLE.replace("专业共识 | ★★★★★ | 引用文献", "专业共识 | ★ | 引用文献");
  const { failures } = parseTopicTable(bad);
  assert.ok(failures.some((f) => f.includes("应绑定 ★★★★★")), "应报星数错配，实际: " + failures.join("; "));
});
check("A4 只有 8 行 → 报选题不足 10 条", () => {
  const short = VALID_TABLE.split("\n").slice(0, 10).join("\n") + "\n配比校验：不足";
  const { rows, failures } = parseTopicTable(short);
  assert.ok(rows.length < 10, "行数应 < 10");
  assert.ok(failures.some((f) => f.includes("选题不足 10 条")), "应报不足 10 条，实际: " + failures.join("; "));
});
check("A5 含 CTA 违禁词（私信领取）→ 报违禁词", () => {
  const bad = VALID_TABLE.replace("真实案例", "真实案例。私信领取优惠");
  const { failures } = parseTopicTable(bad);
  assert.ok(failures.some((f) => f.includes("CTA 含违禁词")), "应报违禁词，实际: " + failures.join("; "));
});
check("A6 缺「配比校验」块 → 报缺少块", () => {
  const bad = VALID_TABLE.replace(/配比校验：.*/, "");
  const { failures } = parseTopicTable(bad);
  assert.ok(failures.some((f) => f.includes("缺少「配比校验」块")), "应报缺少块，实际: " + failures.join("; "));
});
check("A7 非法共识层级（神秘共识）→ 报共识层级非法", () => {
  const bad = VALID_TABLE.replace("专业共识 | ★★★★★ | 引用文献", "神秘共识 | ★ | 引用文献");
  const { failures } = parseTopicTable(bad);
  assert.ok(failures.some((f) => f.includes("共识层级非法")), "应报非法层级，实际: " + failures.join("; "));
});
check("A8 splitRow 边界：无管道返回空、有管道正确切分", () => {
  assert.deepStrictEqual(splitRow("plain"), []);
  assert.deepStrictEqual(splitRow("| a | b | c |").map((s) => s.trim()), ["a", "b", "c"]);
});

// ---------------- B. 来源② 行业热点真实扫描 ----------------
console.log("\n==== B. searchPublicTopicSources 来源②扫描（mock fetch）====");
check("B1 搜狗返回 <h3><a> + 对标链接 → 热点/对标均取到", async () => {
  installFetch((url) =>
    url.includes("sogou")
      ? okHtml(`<h3><a href="a">美业门店短视频如何引流获客</a></h3><h3><a href="b">美容院私域运营三大热点</a></h3><h3><a href="c">护肤科普内容趋势分析</a></h3>`)
      : okHtml(`<meta property="og:title" content="对标账号主页标题示例"><title>页面标题</title><div aria-label="某条视频标题示例内容"></div>`)
  );
  const r = await searchPublicTopicSources("美业", "对标账号：https://www.douyin.com/user/abc");
  assert.strictEqual(r.hot.fetched, true, "热点应取到");
  assert.ok(r.hot.items.length >= 1, "热点 items 应非空");
  assert.strictEqual(r.bench.fetched, true, "对标应取到");
  assert.ok(r.bench.items.length >= 1, "对标 items 应非空");
});
check("B2 外网异常（fetch 抛错）→ 优雅降级，不抛异常，fetched=false", async () => {
  installFetch(() => {
    throw new Error("network down");
  });
  const r = await searchPublicTopicSources("美业", "");
  assert.strictEqual(r.hot.fetched, false);
  assert.deepStrictEqual(r.hot.items, []);
  assert.strictEqual(r.bench.fetched, false);
});
check("B3 响应 404（!res.ok）→ 返回空 items，fetched=false", async () => {
  installFetch(() => failedResp(404));
  const r = await searchPublicTopicSources("美业", "");
  assert.strictEqual(r.hot.fetched, false, "404 应视为未取到");
  assert.deepStrictEqual(r.hot.items, []);
});

// ---------------- C. 来源④ 视频复盘指标重算 ----------------
console.log("\n==== C. computeVidrevMetrics 来源④指标重算（纯函数）====");
check("C1 正常两行 → 重算互动/播放占比，短编号 v1/v2", () => {
  const rows = [
    { video_id: "vA", title: "视频A", plays: "1000", likes: "100", comments: "20", shares: "10", content_type: "爆款型", completion_rate: "0.5", conversions: "5", is_paid: "0", ad_spend: "0" },
    { video_id: "vB", title: "视频B", plays: 200, likes: 10, comments: 2, shares: 1, content_type: "人设型", completion_rate: "0.3", conversions: 1, is_paid: "1", ad_spend: 50 }
  ];
  const m = computeVidrevMetrics(rows as any);
  assert.strictEqual(m.videos.length, 2);
  assert.strictEqual(m.videos[0].id, "v1");
  assert.strictEqual(m.videos[0].engagement, 130, "互动=100+20+10");
  const sum = m.videos.reduce((s, v) => s + v.playsShare, 0);
  assert.ok(Math.abs(sum - 1) < 1e-6, "播放占比之和应为 1");
});
check("C2 空输入 → 不崩，videos 为空", () => {
  const m = computeVidrevMetrics([]);
  assert.strictEqual(m.videos.length, 0);
});

// ---------------- D. 来源① 大脑笔记拉取 ----------------
console.log("\n==== D. fetchGetnoteNotes 来源①大脑笔记（mock fetch）====");
check("D1 缺 apiKey/clientId → 直接返回空，不发请求", async () => {
  let called = false;
  installFetch(() => {
    called = true;
    return okJson({});
  });
  const r = await fetchGetnoteNotes("", "x");
  assert.deepStrictEqual(r, []);
  assert.strictEqual(called, false, "缺凭证不应发请求");
});
check("D2 凭证齐全且接口返回 notes → 解析标题/摘要/标签", async () => {
  installFetch(() =>
    okJson({
      data: {
        notes: [
          { title: "笔记一", summary: "摘要一", tags: ["a", "b"] },
          { title: "笔记二", summary: "摘要二", tags: [] }
        ]
      }
    })
  );
  const r = await fetchGetnoteNotes("key", "client");
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].title, "笔记一");
  assert.deepStrictEqual(r[0].tags, ["a", "b"]);
});
check("D3 接口异常 → 优雅返回空，不抛", async () => {
  installFetch(() => {
    throw new Error("getnote down");
  });
  const r = await fetchGetnoteNotes("key", "client");
  assert.deepStrictEqual(r, []);
});

// ---------------- 串行执行 + 汇总 ----------------
(async () => {
  let pass = 0;
  let fail = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ✅ ${t.name}`);
      pass++;
    } catch (e: any) {
      console.log(`  ❌ ${t.name}\n     ${e?.message ?? e}`);
      fail++;
    }
  }
  console.log(`\n==== 选题策略官后端能力测试：通过 ${pass} · 失败 ${fail} ====`);
  process.exitCode = fail > 0 ? 1 : 0;
})();
