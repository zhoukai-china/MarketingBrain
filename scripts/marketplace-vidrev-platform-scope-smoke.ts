/**
 * 视频复盘「只做抖音 / 视频号」的行为回归（用户 2026-09-15 口径）。
 *
 * 为什么单独一条：`marketplace:vidrev-contract-smoke` 只能读源码，钉不住「真的上传一张
 * 小红书表格会发生什么」。这条走**生产同一路由** `POST /vidrev/parse-preview`
 * （前端拖拽上传后的预检接口），断言：
 *   ① 抖音 / 视频号表格照常预检（正常路径）；
 *   ② 小红书 / B站 / 快手表格 → `ok:false` + `platform:"其他平台"` + 明确说明只支持抖音/视频号，
 *      `rowCount:0`、`fields:[]`（失败路径：不解析、不假装有数据）；
 *   ③ 前端显式传 `platform:"小红书"` 也照样拒绝（不应发生：绕过识别硬塞平台）；
 *   ④ 全程 0 次 Provider 调用、0 费用（预检不调模型、不消耗积分）。
 *
 * 需要本地数据库：挂载 `registerMarketplaceRoutes` 时会跑一次 `ensureMarketplaceCatalog()`
 * （把代码里的 SKU 目录同步进本地库，和本地起 API 的行为一致）。除此之外不写订单、账本、
 * 客户或任务数据，也不调用任何 Provider。
 */
import "dotenv/config";
import assert from "node:assert/strict";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import { registerMarketplaceRoutes, resolveVidrevPlatform } from "../apps/api/src/routes/marketplace.js";
import { normalizeVidrevPlatform } from "../apps/web/src/marketplace/chat-flows.js";

const DOUYIN_TABLE = [
  "视频标题,发布时间,播放量,点赞量,评论量,分享量,收藏量,5秒完播率",
  "抖音示例,2026-08-12,124000,3200,286,410,520,62%"
].join("\n");

const CHANNELS_TABLE = [
  "标题,发表时间,播放量,点赞量,评论量,转发量,收藏量,完播率",
  "视频号示例,2026-08-14,86000,2100,180,260,300,29%"
].join("\n");

// 历史支持过、2026-09-15 起不再支持的平台：字段名就用各家后台导出的原始列名。
const XHS_TABLE = [
  "笔记标题,发布时间,观看量,点赞数,收藏数,评论数,分享数",
  "小红书示例,2026-08-12,56000,2100,800,120,60"
].join("\n");

const BILIBILI_TABLE = [
  "标题,发布时间,播放量,点赞数,评论数,分享数,收藏数,弹幕数",
  "B站示例,2026-08-12,88000,4300,210,90,600,320"
].join("\n");

const KUAISHOU_TABLE = [
  "作品标题,发布时间,播放量,点赞量,评论量,分享量,磁力消耗",
  "快手示例,2026-08-12,42000,1500,88,40,0"
].join("\n");

async function main(): Promise<void> {
  let providerCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("parse-preview 预检不得调用任何 Provider");
  };

  // 生产就是这么挂的：`server.ts` 里 `registerMarketplaceRoutes(app)` 不带前缀，
  // 预检路由的真实地址是 `/vidrev/parse-preview`（`/market/*` 只包住货架那组）。
  const app = Fastify({ disableRequestLogging: true, logger: false });
  await app.register(registerMarketplaceRoutes);

  const preview = async (body: Record<string, unknown>) => {
    const response = await app.inject({
      method: "POST",
      url: "/vidrev/parse-preview",
      payload: body
    });
    assert.equal(response.statusCode, 200, `parse-preview 返回 200（实得 ${response.statusCode}）`);
    return response.json() as {
      ok: boolean;
      rowCount: number;
      fields: string[];
      platform: string | null;
      notes: string[];
    };
  };

  try {
    // ① 正常路径：抖音 / 视频号照常识别并解析。
    const douyin = await preview({ content: DOUYIN_TABLE });
    assert.equal(douyin.platform, "抖音", "抖音表格必须识别为抖音");
    assert.equal(douyin.ok, true, "抖音表格必须预检通过");
    assert.equal(douyin.rowCount, 1, "抖音表格必须解析出 1 行");

    const channels = await preview({ content: CHANNELS_TABLE });
    assert.equal(channels.platform, "视频号", "视频号表格必须识别为视频号");
    assert.equal(channels.ok, true, "视频号表格必须预检通过");
    assert.equal(channels.rowCount, 1, "视频号表格必须解析出 1 行");

    // ② 失败路径：不再支持的平台必须明确说明，且不得解析出数据行。
    for (const [label, content] of [
      ["小红书", XHS_TABLE],
      ["B站", BILIBILI_TABLE],
      ["快手", KUAISHOU_TABLE]
    ] as const) {
      const rejected = await preview({ content });
      assert.equal(rejected.ok, false, `${label} 表格必须预检失败（不假装有数据）`);
      assert.equal(rejected.platform, "其他平台", `${label} 表格必须判成「其他平台」`);
      assert.equal(rejected.rowCount, 0, `${label} 表格不得解析出数据行`);
      assert.deepEqual(rejected.fields, [], `${label} 表格不得回显字段`);
      const note = rejected.notes.join(" ").replace(/\*/g, "");
      assert.ok(note.includes("抖音") && note.includes("视频号"), `${label} 表格的说明必须点明支持抖音/视频号`);
      assert.ok(note.includes(label), `${label} 表格的说明必须点名该平台不被支持`);
    }

    // ③ 不应发生：前端硬把 platform 传成不支持的平台，也必须被拒（不靠前端自觉）。
    const forced = await preview({ content: XHS_TABLE, platform: "小红书" });
    assert.equal(forced.ok, false, "显式传 platform=小红书 必须被服务端拒绝");
    assert.equal(forced.rowCount, 0, "显式传 platform=小红书 不得解析出数据行");

    // ④ 零成本：预检全程不得有任何 Provider 调用。
    assert.equal(providerCalls, 0, `预检不得调用 Provider（实得 ${providerCalls} 次）`);

    /**
     * ⑤ 2026-09-17 现场（`/agent/meiye__vidrev/chat`）：老板在「平台」那一步没点选项，直接把
     * 「复盘（附件：视频号动态数据明细.csv）」当答案发出来，平台名成了整句话 → 被按「非抖音/视频号」
     * 拒绝，同一份视频号文件连发三次都回「只支持抖音和视频号」。口径：句中点名平台就用它，
     * 认不出来再看数据表本身；明确点名小红书/快手/B站才继续 fail closed。
     */
    const badAnswer = "复盘（附件：视频号动态数据明细.csv）";
    assert.equal(
      resolveVidrevPlatform(badAnswer, CHANNELS_TABLE),
      "视频号",
      "平台那一步被当成答案输入整句时，必须能从这句 / 文件里识别出视频号，而不是判成「其他平台」"
    );
    assert.equal(resolveVidrevPlatform("", CHANNELS_TABLE), "视频号", "平台留空时必须按数据表识别出视频号");
    assert.equal(resolveVidrevPlatform("抖音", CHANNELS_TABLE), "抖音", "句中明确写抖音时以句中为准");
    assert.equal(resolveVidrevPlatform("", DOUYIN_TABLE), "抖音", "平台留空且是抖音表格时识别为抖音");
    assert.equal(resolveVidrevPlatform("小红书", DOUYIN_TABLE), "其他平台", "句中点名小红书仍必须 fail closed");
    assert.equal(resolveVidrevPlatform("", XHS_TABLE), "其他平台", "小红书表格仍必须 fail closed");

    // 前端同口径（把平台这一步的自由输入归一成规范平台名）。
    assert.equal(normalizeVidrevPlatform(badAnswer), "视频号", "前端必须能从整句话里认出视频号");
    assert.equal(normalizeVidrevPlatform("视频号"), "视频号");
    assert.equal(normalizeVidrevPlatform("抖音"), "抖音");
    assert.equal(normalizeVidrevPlatform("小红书"), null, "不支持的平台不得被静默当成抖音/视频号");
    assert.equal(normalizeVidrevPlatform("随便看看"), null, "认不出平台时必须让调用方继续追问");

    // 源码契约：平台这一步认不出平台时不许推进（避免平台名变成整句话）。
    const { readFileSync } = await import("node:fs");
    const chatPage = readFileSync("apps/web/src/marketplace/AgentChatPage.tsx", "utf8");
    assert.ok(
      chatPage.includes('flow.slots[step].key === "platform"'),
      "视频复盘平台步必须有专门的归一 / 追问分支"
    );
    assert.match(chatPage, /normalizeVidrevPlatform\(value\)/, "平台步必须先尝试从用户这句话里归一平台");
    assert.ok(chatPage.includes("这一步只确认"), "平台认不出来时必须停下来追问，而不是把整句当平台往下走");
    assert.ok(chatPage.includes("从文件名认平台"), "追问时必须告诉用户可以拖文件、我会从文件名认平台");
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }

  console.log(
    JSON.stringify({
      result: "VIDREV_PLATFORM_SCOPE_PASS",
      supported: ["抖音", "视频号"],
      rejected: ["小红书", "B站", "快手"],
      forcedPlatformRejected: true,
      providerCalls,
      costYuan: 0
    })
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
