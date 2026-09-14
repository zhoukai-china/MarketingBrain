// 视频复盘智能体（vidrev）真实运行验收：走生产同一路由 + 真实模型 + 真实数据库。
// 验收点：深度复盘 60 积分/次只扣一次、十章齐全、四象限/健康度与后端重算一致、账本恰好一条；
//         快速诊断同样只扣一次；无数据行 → 422 且不扣费；免费重做 charged=0；租户隔离。
//
// 首次验证只用真机深度跑（真实模型可能一次不达 V1–V12）可设：
//   $env:VIDREV_SMOKE_ONLY="deep"; pnpm.cmd marketplace:vidrev-run-smoke
// 打印模型原文：$env:VIDREV_SMOKE_DUMP="scripts/tmp/vidrev-deep.md"
import "dotenv/config";
process.env.SKILL_MCP_REQUIRED = "false";
import { randomUUID } from "node:crypto";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import { prisma } from "../apps/api/node_modules/@baolu/db/dist/index.js";
import { registerMarketplaceRoutes } from "../apps/api/src/routes/marketplace.js";
import { ensureMarketplaceCatalog } from "../apps/api/src/services/marketplace-catalog.js";
import {
  computeVidrevMetrics,
  type VidrevRawRow
} from "../apps/api/src/services/video-review-engine.js";
import { sessionHeaders } from "./lib/db-session-headers.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

const SKU = "ipzone__vidrev";
const PRICE = 60;
const START_BALANCE = 1000;

// 6 条脱敏数据行：覆盖又爆又赚 / 有量无转 / 有转无量 / 没量没转 + 一个空 5 秒完播率 + 一条投流。
const ROWS: VidrevRawRow[] = [
  { video_id: "v1", title: "示例选题一", duration_sec: 68, published_at: "2026-08-12", plays: 124000, likes: 3200, comments: 286, shares: 410, saves: 520, completion_rate: 0.31, completion_5s: 0.62, conversions: 23, is_paid: false, ad_spend: 0, content_type: "人设型" },
  { video_id: "v2", title: "示例选题二", duration_sec: 55, published_at: "2026-08-18", plays: 32000, likes: 900, comments: 60, shares: 120, saves: 200, completion_rate: 0.38, completion_5s: 0.6, conversions: 6, is_paid: false, ad_spend: 0, content_type: "干货教学" },
  { video_id: "v3", title: "示例选题三", duration_sec: 90, published_at: "2026-08-25", plays: 11000, likes: 300, comments: 40, shares: 30, saves: 90, completion_rate: 0.26, completion_5s: 0.44, conversions: 9, is_paid: false, ad_spend: 0, content_type: "引流转化" },
  { video_id: "v4", title: "示例选题四", duration_sec: 22, published_at: "2026-09-01", plays: 8600, likes: 190, comments: 12, shares: 8, saves: 40, completion_rate: 0.22, completion_5s: null, conversions: 2, is_paid: false, ad_spend: 0, content_type: "入企案例" },
  { video_id: "v5", title: "示例选题五", duration_sec: 75, published_at: "2026-09-03", plays: 268000, likes: 7100, comments: 320, shares: 1900, saves: 2600, completion_rate: 0.41, completion_5s: 0.71, conversions: 4, is_paid: false, ad_spend: 0, content_type: "干货教学" },
  { video_id: "v6", title: "示例选题六", duration_sec: 41, published_at: "2026-09-07", plays: 6400, likes: 150, comments: 9, shares: 4, saves: 30, completion_rate: 0.24, completion_5s: 0.5, conversions: 3, is_paid: true, ad_spend: 1200, content_type: "案例拆解" }
];

interface VidrevRunBody {
  state: string;
  answer: string;
  consumedCredits: number;
  freeRedo?: boolean;
  balance: number;
  requestId: string;
  payload?: {
    kind: string;
    mode: string;
    quadrant?: { both: string[]; plays_no_conv: string[]; conv_no_plays: string[]; neither: string[]; notes: string[] };
    content_health?: { health_score: number; verdict: string };
    overview?: { video_count: number; median_plays: number; median_conversions: number };
    videos?: Array<{ video_id: string; plays: number | null; conversions: number | null }>;
  };
}

async function createTenant(label: string): Promise<{ tenantId: string; userId: string; walletId: string }> {
  const tenantId = `mp-vidrev-${label}-${randomUUID()}`;
  const userId = `mp-vidrev-${label}-user-${randomUUID()}`;
  const membershipId = `mp-vidrev-${label}-mem-${randomUUID()}`;
  await prisma.tenant.create({ data: { id: tenantId, name: `Vidrev Smoke ${label}`, type: "local_business" } });
  await prisma.user.create({ data: { id: userId } });
  await prisma.membership.create({ data: { id: membershipId, tenantId, userId, role: "owner", isActive: true } });
  const wallet = await prisma.wallet.create({ data: { userId, paidBalance: START_BALANCE } });
  return { tenantId, userId, walletId: wallet.id };
}

async function main(): Promise<void> {
  const only = process.env.VIDREV_SMOKE_ONLY ?? "";
  const dump = process.env.VIDREV_SMOKE_DUMP ?? "";

  await ensureMarketplaceCatalog();
  // 视频复盘 2026-09-14 已按用户口径下架成「开发中」（ipzone__vidrev / meiye__vidrev = coming_soon）。
  // 冒烟测试仍临时置为 trial 跑验收，结束时还原为进入时的状态，不污染真实开卖状态。
  // 注意：registerMarketplaceRoutes 内部会再调一次 ensureMarketplaceCatalog() 覆盖回种子状态，
  // 所以必须等路由注册完成后才能真正落库为 trial。
  const skuRow = await prisma.marketplaceSku.findUniqueOrThrow({ where: { skuCode: SKU } });
  const tenant = await createTenant("main");
  const other = await createTenant("other");

  const app = Fastify();
  await registerMarketplaceRoutes(app);
  await prisma.marketplaceSku.update({ where: { skuCode: SKU }, data: { status: "trial" } });

  const headers = (t: { tenantId: string; userId: string }): Record<string, string> => ({
    ...sessionHeaders(t.tenantId, t.userId),
    "content-type": "application/json"
  });

  try {
    let deepRequestId = "";

    if (!only || only === "deep") {
      const startedAt = Date.now();
      const run = await app.inject({
        method: "POST",
        url: `/market/skus/${encodeURIComponent(SKU)}/run`,
        headers: headers(tenant),
        payload: {
          mode: "deep",
          platform: "抖音",
          period: { start: "2026-08-01", end: "2026-09-07" },
          has_revenue_data: false,
          rows: ROWS
        }
      });
      const elapsedMs = Date.now() - startedAt;
      if (dump) {
        const { writeFileSync, mkdirSync } = await import("node:fs");
        const { dirname } = await import("node:path");
        mkdirSync(dirname(dump), { recursive: true });
        writeFileSync(dump, run.body, "utf8");
      }
      if (run.statusCode !== 200) {
        console.log("DEEP_RESPONSE", run.statusCode, run.body.slice(0, 6000));
      }
      assert(run.statusCode === 200, `vidrev deep run returns 200 (got ${run.statusCode})`);
      const body = run.json() as VidrevRunBody;
      const rawBody = run.json() as Record<string, unknown>;
      deepRequestId = body.requestId;
      assert(body.state === "completed", "vidrev deep run completes");
      assert(body.consumedCredits === PRICE, `vidrev deep charges exactly ${PRICE} credits (got ${body.consumedCredits})`);
      assert(body.balance === START_BALANCE - PRICE, `vidrev deep settles wallet balance (got ${body.balance})`);
      // PLAT-21：客户侧响应绝不能带内部算力成本；成本只走账本 metadata。
      assert(!("modelCostCny" in rawBody), "客户侧响应不得返回内部算力成本 modelCostCny");
      assert(!("estimatedCredits" in rawBody), "客户侧响应不得返回成本折算 estimatedCredits");
      const answer = body.answer;
      for (const chapter of [
        "零、数据质量审计",
        "一、数据总览",
        "二、视频分层",
        "三、内容结构健康度",
        "四、单条深拆",
        "五、完播率深层归因",
        "六、互动深度分析",
        "七、趋势预警",
        "八、规律总结",
        "九、方法论沉淀",
        "十、下个周期选题建议"
      ]) {
        assert(answer.includes(chapter), `vidrev deep answer contains ${chapter}`);
      }
      const payload = body.payload;
      assert(payload !== undefined, "vidrev deep returns a structured payload");
      assert(payload!.kind === "vidrev", `vidrev payload kind is vidrev (got ${payload!.kind})`);
      assert(payload!.mode === "deep", `vidrev payload mode is deep (got ${payload!.mode})`);

      // 四象限条数之和必须等于总条数，且每条唯一。
      const q = payload!.quadrant!;
      const buckets = [q.both, q.plays_no_conv, q.conv_no_plays, q.neither];
      const allIds = buckets.flat();
      assert(allIds.length === ROWS.length, `quadrant bucket total equals row count (got ${allIds.length} vs ${ROWS.length})`);
      assert(new Set(allIds).size === allIds.length, "each video appears in exactly one quadrant");

      // 明细 videos[] 必须与入参条数一致，且四象限里的 id 都能在明细里找到（前端四象限筛选依赖它）。
      const videos = payload!.videos ?? [];
      assert(videos.length === ROWS.length, `payload.videos row count matches input (got ${videos.length} vs ${ROWS.length})`);
      const videoIds = new Set(videos.map((video) => video.video_id));
      for (const id of allIds) {
        assert(videoIds.has(id), `quadrant id ${id} exists in payload.videos`);
      }
      assert(
        videoIds.size === ROWS.length,
        "payload.videos has one unique row per input video"
      );

      // 健康度档位与分数一致。
      const repMetrics = computeVidrevMetrics(ROWS);
      assert(payload!.overview!.video_count === ROWS.length, "overview video_count matches rows");
      const health = payload!.content_health!;
      const expectedVerdict = health.health_score > 0.5 ? "🟢" : health.health_score >= 0.3 ? "🟡" : "🔴";
      assert(health.verdict.includes(expectedVerdict), `health verdict ${health.verdict} matches score ${health.health_score}`);
      assert(
        Math.abs(payload!.overview!.median_plays - repMetrics.medianPlays) < 1e-6,
        `overview median_plays matches engine (${payload!.overview!.median_plays} vs ${repMetrics.medianPlays})`
      );

      const ledger = await prisma.marketplaceLedgerEntry.findMany({ where: { tenantId: tenant.tenantId } });
      assert(ledger.length === 1, `vidrev deep writes exactly one ledger entry (got ${ledger.length})`);
      assert(ledger[0].amountCredits === PRICE, "vidrev deep ledger records the 60-credit charge");
      const ledgerMetadata = (ledger[0].metadata ?? {}) as Record<string, unknown>;
      assert(typeof ledgerMetadata.modelCostCny === "number", "内部账本 metadata 仍记录 modelCostCny（审计不回退）");

      const walletDebits = await prisma.walletLedger.findMany({ where: { walletId: tenant.walletId, type: "consume" } });
      assert(walletDebits.length === 1, `vidrev deep wallet has exactly one consume row (got ${walletDebits.length})`);

      console.log(
        JSON.stringify({
          phase: "deep",
          elapsedMs,
          consumedCredits: body.consumedCredits,
          costFieldsAbsent: !("modelCostCny" in rawBody) && !("estimatedCredits" in rawBody),
          ledgerModelCostCny: ledgerMetadata.modelCostCny,
          answerChars: answer.length,
          quadrant: { both: q.both.length, playsNoConv: q.plays_no_conv.length, convNoPlays: q.conv_no_plays.length, neither: q.neither.length },
          healthScore: health.health_score,
          healthVerdict: health.verdict
        })
      );
    }

    if (only === "deep") {
      console.log("PASS marketplace-vidrev-run-smoke (deep only)");
      return;
    }

    // 快速诊断：同样只扣一次 60。
    if (!only || only === "quick") {
      const run = await app.inject({
        method: "POST",
        url: `/market/skus/${encodeURIComponent(SKU)}/run`,
        headers: headers(tenant),
        payload: {
          mode: "quick",
          platform: "抖音",
          input: "这条视频播放 3.2 万、点赞 900、评论 60、分享 120，咨询 6 个，帮我快速看看问题在哪。"
        }
      });
      if (run.statusCode !== 200) console.log("QUICK_RESPONSE", run.statusCode, run.body.slice(0, 4000));
      assert(run.statusCode === 200, `vidrev quick run returns 200 (got ${run.statusCode})`);
      const body = run.json() as VidrevRunBody;
      assert(body.consumedCredits === PRICE, `vidrev quick charges exactly ${PRICE} credits (got ${body.consumedCredits})`);
      assert(body.payload?.kind === "vidrev", "vidrev quick returns vidrev payload");
      assert(body.payload?.mode === "quick", `vidrev quick payload mode is quick (got ${body.payload?.mode})`);
      console.log(JSON.stringify({ phase: "quick", consumedCredits: body.consumedCredits, answerChars: body.answer.length }));
    }

    // 无数据行的深度复盘 → 422 且不扣费（V0，模型调用前拦截）。
    if (!only || only === "v0") {
      const before = await prisma.wallet.findUniqueOrThrow({ where: { id: tenant.walletId } });
      const run = await app.inject({
        method: "POST",
        url: `/market/skus/${encodeURIComponent(SKU)}/run`,
        headers: headers(tenant),
        payload: { mode: "deep", input: "帮我复盘一下这个月的数据，谢谢。" }
      });
      assert(run.statusCode === 422, `vidrev deep without rows returns 422 (got ${run.statusCode})`);
      const body = run.json() as { failed_rules?: string[] };
      assert((body.failed_rules ?? []).includes("V0"), "vidrev V0 failure reports the V0 rule");
      const after = await prisma.wallet.findUniqueOrThrow({ where: { id: tenant.walletId } });
      assert(after.paidBalance + after.bonusBalance === before.paidBalance + before.bonusBalance, "V0 failure does not move the wallet");
      console.log(JSON.stringify({ phase: "v0", status: 422, failedRules: body.failed_rules }));
    }

    // 免费重做：带原 requestId 再跑一次，charged=0。
    if ((!only || only === "redo") && deepRequestId) {
      const run = await app.inject({
        method: "POST",
        url: `/market/skus/${encodeURIComponent(SKU)}/run`,
        headers: headers(tenant),
        payload: {
          mode: "deep",
          platform: "抖音",
          redoOf: deepRequestId,
          has_revenue_data: false,
          rows: ROWS
        }
      });
      if (run.statusCode !== 200) console.log("REDO_RESPONSE", run.statusCode, run.body.slice(0, 4000));
      assert(run.statusCode === 200, `vidrev free redo returns 200 (got ${run.statusCode})`);
      const body = run.json() as VidrevRunBody;
      assert(body.consumedCredits === 0, `vidrev free redo charges 0 credits (got ${body.consumedCredits})`);
      assert(body.freeRedo === true, "vidrev free redo flags freeRedo");
      const ledger = await prisma.marketplaceLedgerEntry.findMany({ where: { tenantId: tenant.tenantId } });
      const adjustments = ledger.filter((row) => row.type === "adjustment");
      assert(adjustments.length === 1, `vidrev free redo writes exactly one adjustment row (got ${adjustments.length})`);
      assert(adjustments[0].amountCredits === 0, "redo ledger row is a 0-credit adjustment");
      console.log(JSON.stringify({ phase: "redo", consumedCredits: body.consumedCredits, freeRedo: body.freeRedo }));
    }

    // 租户隔离：另一个租户看不到本次任何账本。
    if (!only || only === "isolation") {
      const foreign = await prisma.marketplaceLedgerEntry.findMany({ where: { tenantId: other.tenantId } });
      assert(foreign.length === 0, "another tenant sees no ledger rows from this run");
      console.log(JSON.stringify({ phase: "isolation", foreignLedger: foreign.length }));
    }

    console.log("PASS marketplace-vidrev-run-smoke");
  } finally {
    await app.close();
    await prisma.marketplaceSku.update({ where: { skuCode: SKU }, data: { status: skuRow.status } });
    for (const t of [tenant, other]) {
      await prisma.marketplaceLedgerEntry.deleteMany({ where: { tenantId: t.tenantId } });
      await prisma.creditReservation.deleteMany({ where: { tenantId: t.tenantId } });
      await prisma.creditTransaction.deleteMany({ where: { tenantId: t.tenantId } });
      await prisma.creditAccount.deleteMany({ where: { tenantId: t.tenantId } });
      await prisma.walletLedger.deleteMany({ where: { userId: t.userId } });
      await prisma.wallet.deleteMany({ where: { userId: t.userId } });
      await prisma.membership.deleteMany({ where: { tenantId: t.tenantId } });
      await prisma.tenant.deleteMany({ where: { id: t.tenantId } });
      await prisma.user.deleteMany({ where: { id: t.userId } });
    }
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
