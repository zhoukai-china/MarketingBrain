// IP 定位智能体（ip-pos）真实运行验收：走生产同一路由 + 真实模型 + 真实数据库。
// 验收点：200 积分/次只扣一次、八章齐全、速览 8 项、四类选题数量达标、账本恰好一条、租户隔离。
import "dotenv/config";
process.env.SKILL_MCP_REQUIRED = "false";
import { randomUUID } from "node:crypto";
import Fastify from "../apps/api/node_modules/fastify/fastify.js";
import { prisma } from "../apps/api/node_modules/@baolu/db/dist/index.js";
import { registerMarketplaceRoutes } from "../apps/api/src/routes/marketplace.js";
import { ensureMarketplaceCatalog } from "../apps/api/src/services/marketplace-catalog.js";
import { sessionHeaders } from "./lib/db-session-headers.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

const SKU = "ipzone__ip-pos";
const PRICE = 200;
const START_BALANCE = 1000;

const INPUT = [
  "请按「IP 定位」方法论，基于下面业务信息生成最终交付。",
  "- 项目基础：兰琪美业，在广州做美容院连锁加盟 + 门店经营陪跑，主要赚加盟费和门店服务费，现在处在 1-10 阶段。",
  "- 目标用户：30-45 岁、二三线城市、做过美容或想开美容院的女性创业者，年收入 20-50 万；最痛的是没客源、员工留不住、不会做线上获客。",
  "- 创始人 + 目标：创始人兰琪，从 1 家店做到 12 家直营店，最擅长门店 SOP 和员工带教，性格关键词是务实、直接、较真；做 IP 的核心目标是招商加盟。",
  "- IP 现状：抖音 1.2 万粉、视频号 3000 粉，团队 3 人，一周能投入 2 天；拍过最满意的一条是「美容院老板最容易踩的 3 个坑」。"
].join("\n");

interface IpPosRunBody {
  state: string;
  answer: string;
  consumedCredits: number;
  estimatedCredits: number;
  modelCostCny: number;
  balance: number;
  requestId: string;
  payload?: {
    validation: { passed: boolean; errors: Array<{ code: string; field: string; message: string }> };
    stats: { topic_total: number; by_type: { trust: number; cognitive: number; connection: number; conversion: number } };
    overview: Record<string, string>;
    topics: { top10: string[]; calendar30: string[] };
  };
}

async function main(): Promise<void> {
  const tenantId = `mp-ippos-${randomUUID()}`;
  const userId = `mp-ippos-user-${randomUUID()}`;
  const membershipId = `mp-ippos-mem-${randomUUID()}`;
  const otherTenantId = `mp-ippos-other-${randomUUID()}`;
  const otherUserId = `mp-ippos-other-user-${randomUUID()}`;

  await ensureMarketplaceCatalog();
  await prisma.tenant.create({ data: { id: tenantId, name: "IP Pos Smoke Tenant", type: "local_business" } });
  await prisma.user.create({ data: { id: userId } });
  await prisma.membership.create({ data: { id: membershipId, tenantId, userId, role: "owner", isActive: true } });
  // 生产 run 路径走统一钱包（Wallet + WalletLedger），不是租户 CreditAccount。
  const wallet = await prisma.wallet.create({ data: { userId, paidBalance: START_BALANCE } });

  await prisma.tenant.create({ data: { id: otherTenantId, name: "IP Pos Smoke Other Tenant", type: "local_business" } });
  await prisma.user.create({ data: { id: otherUserId } });

  const app = Fastify();
  await registerMarketplaceRoutes(app);

  try {
    const headers = sessionHeaders(tenantId, userId);
    const startedAt = Date.now();
    const run = await app.inject({
      method: "POST",
      url: `/market/skus/${encodeURIComponent(SKU)}/run`,
      headers: { ...headers, "content-type": "application/json" },
      payload: { input: INPUT }
    });
    const elapsedMs = Date.now() - startedAt;
    if (process.env.IP_POS_SMOKE_DUMP) {
      const { writeFileSync, mkdirSync } = await import("node:fs");
      const { dirname } = await import("node:path");
      mkdirSync(dirname(process.env.IP_POS_SMOKE_DUMP), { recursive: true });
      writeFileSync(process.env.IP_POS_SMOKE_DUMP, run.body, "utf8");
    }
    if (run.statusCode !== 200) {
      console.log("RUN_RESPONSE", run.statusCode, run.body.slice(0, 4000));
    }
    assert(run.statusCode === 200, `ip-pos run returns 200 (got ${run.statusCode})`);
    const body = run.json() as IpPosRunBody;
    assert(body.state === "completed", "ip-pos run completes");
    assert(body.consumedCredits === PRICE, `ip-pos charges exactly ${PRICE} credits (got ${body.consumedCredits})`);
    assert(body.balance === START_BALANCE - PRICE, `ip-pos settles wallet balance (got ${body.balance})`);

    const answer = body.answer;
    for (const chapter of ["一、项目定位", "二、目标用户", "三、IP人设", "四、内容定位", "五、选题方向", "六、投流建议", "七、IP发展规划", "八、执行建议"]) {
      assert(answer.includes(chapter), `ip-pos answer contains ${chapter}`);
    }
    assert(/1\s*分钟速览/.test(answer), "ip-pos answer contains the 1-minute overview");

    const payload = body.payload;
    assert(payload !== undefined, "ip-pos returns a structured payload");
    assert(payload!.validation.passed, `ip-pos validation passes (${payload!.validation.errors.map((e) => e.message).join(" / ")})`);
    assert(payload!.stats.by_type.trust >= 22, `trust topics >= 22 (got ${payload!.stats.by_type.trust})`);
    assert(payload!.stats.by_type.cognitive >= 22, `cognitive topics >= 22 (got ${payload!.stats.by_type.cognitive})`);
    assert(payload!.stats.by_type.connection >= 22, `connection topics >= 22 (got ${payload!.stats.by_type.connection})`);
    assert(payload!.stats.by_type.conversion >= 14, `conversion topics >= 14 (got ${payload!.stats.by_type.conversion})`);
    assert(payload!.stats.topic_total >= 80, `topic total >= 80 (got ${payload!.stats.topic_total})`);
    assert(payload!.topics.top10.length === 10, `top10 has 10 rows (got ${payload!.topics.top10.length})`);
    assert(payload!.topics.calendar30.length >= 28, `calendar covers >= 28 days (got ${payload!.topics.calendar30.length})`);
    const overviewValues = Object.values(payload!.overview);
    assert(overviewValues.every((value) => value.trim() && value !== "—"), "overview has all 8 fields filled");

    const ledger = await prisma.marketplaceLedgerEntry.findMany({ where: { tenantId } });
    assert(ledger.length === 1, `ip-pos run writes exactly one ledger entry (got ${ledger.length})`);
    assert(ledger[0].amountCredits === PRICE, "ledger records the 200-credit charge");
    assert(ledger[0].status === "completed", "ledger entry is completed");

    const walletDebits = await prisma.walletLedger.findMany({ where: { walletId: wallet.id, type: "consume" } });
    assert(walletDebits.length === 1, `the unified wallet records exactly one consume ledger row (got ${walletDebits.length})`);
    const debited = walletDebits.reduce((sum, row) => sum + Math.abs(row.delta), 0);
    assert(debited === PRICE, `the unified wallet is debited exactly once (got ${debited})`);
    const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    assert(
      walletAfter.paidBalance + walletAfter.bonusBalance === START_BALANCE - PRICE,
      "wallet snapshot matches the settled balance"
    );

    const foreignLedger = await prisma.marketplaceLedgerEntry.findMany({ where: { tenantId: otherTenantId } });
    assert(foreignLedger.length === 0, "another tenant sees no ledger rows from this run");

    console.log(
      JSON.stringify({
        state: body.state,
        elapsedMs,
        estimatedCredits: body.estimatedCredits,
        consumedCredits: body.consumedCredits,
        modelCostCny: body.modelCostCny,
        balance: body.balance,
        answerChars: answer.length,
        topicTotal: payload!.stats.topic_total,
        byType: payload!.stats.by_type
      })
    );
    console.log("PASS marketplace-ip-pos-run-smoke");
  } finally {
    await app.close();
    await prisma.marketplaceLedgerEntry.deleteMany({ where: { tenantId } });
    await prisma.creditReservation.deleteMany({ where: { tenantId } });
    await prisma.creditTransaction.deleteMany({ where: { tenantId } });
    await prisma.creditAccount.deleteMany({ where: { tenantId } });
    await prisma.walletLedger.deleteMany({ where: { userId } });
    await prisma.wallet.deleteMany({ where: { userId } });
    await prisma.membership.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
