// PLAT-49 市场合伙人资格管理（后台「按人挑 + 授予 / 撤销」）：服务级回归（真实 PostgreSQL，需 DATABASE_URL）。
//
// 覆盖：候选人列表只读、granted 反映真实资格、精确 userId / 昵称过滤、limit 上下限夹取、
//       撤销后回到未授予（fail-closed 复原）。
//
// 为什么单独一条：资格是**权限开关**，授予/撤销写错方向会让不该拿佣金的人拿佣金，
// 或者让已授权的合伙人突然打不开入口。这块必须有真实库证据，不能只靠源码契约。
import "dotenv/config";
process.env.SKILL_MCP_REQUIRED = "false";
import { randomUUID } from "node:crypto";
import { prisma } from "../apps/api/node_modules/@baolu/db/dist/index.js";
import {
  hasMarketPartnerGrant,
  listMarketPartnerCandidates,
  readSelfPartnerLink
} from "../apps/api/src/services/market-partner-self-service.js";

let pass = 0;
const failures: string[] = [];
function check(name: string, ok: unknown, detail = ""): void {
  if (ok) {
    pass += 1;
    console.log(`PASS  ${name}${detail ? ` :: ${detail}` : ""}`);
  } else {
    failures.push(`${name}${detail ? ` :: ${detail}` : ""}`);
    console.error(`FAIL  ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

async function cleanup(): Promise<void> {
  try {
    if (createdUserIds.length > 0) {
      await prisma.marketPartnerGrant.deleteMany({ where: { userId: { in: createdUserIds } } });
    }
    for (const tenantId of createdTenantIds) {
      await prisma.membership.deleteMany({ where: { tenantId } });
      await prisma.tenant.deleteMany({ where: { id: tenantId } });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  } catch (error) {
    console.error("[cleanup] 清理失败：", error instanceof Error ? error.message : String(error));
  }
}

async function createUser(label: string, nickname: string) {
  const userId = `mp-grant-${label}-${randomUUID().slice(0, 8)}`;
  const suffix = randomUUID().replace(/\D/g, "").slice(0, 8).padEnd(8, "0");
  await prisma.user.create({
    data: { id: userId, nickname, phone: `137${suffix}` }
  });
  createdUserIds.push(userId);
  const tenant = await prisma.tenant.create({
    data: { id: `mp-grant-t-${label}-${randomUUID().slice(0, 8)}`, name: `${nickname}工作区`, type: "local_business" }
  });
  createdTenantIds.push(tenant.id);
  await prisma.membership.create({
    data: { id: `mp-grant-m-${label}-${randomUUID().slice(0, 8)}`, tenantId: tenant.id, userId, role: "owner", isActive: true }
  });
  return { userId, tenantId: tenant.id, nickname };
}

async function main(): Promise<void> {
  const marker = randomUUID().slice(0, 6);
  const partner = await createUser("a", `候选人合伙人${marker}`);
  const other = await createUser("b", `候选人普通用户${marker}`);

  // ① 只读：候选人查询本身不得产生任何资格记录。
  const before = await prisma.marketPartnerGrant.count();
  const initial = await listMarketPartnerCandidates({ query: partner.userId, limit: 10 });
  const after = await prisma.marketPartnerGrant.count();
  check("候选人查询是只读的（不产生资格记录）", before === after, `${before} -> ${after}`);

  const initialRow = initial.find((row) => row.userId === partner.userId);
  check("按精确 userId 能查到候选用户", Boolean(initialRow), initialRow ? "命中" : "没查到");
  check("未授予资格时 granted=false", initialRow?.granted === false);
  check("候选用户带出所属工作区", Boolean(initialRow?.tenantName), initialRow?.tenantName ?? "none");
  check("候选用户带出注册时间", Boolean(initialRow?.createdAt));

  // ② 授予后 granted 立即变 true，并且自服务入口真的打开（fail-closed 反向验证）。
  await prisma.marketPartnerGrant.create({ data: { userId: partner.userId, grantedBy: "grant-admin-smoke" } });
  const grantedRows = await listMarketPartnerCandidates({ query: partner.userId, limit: 10 });
  check("授予后 granted=true", grantedRows.find((row) => row.userId === partner.userId)?.granted === true);
  check("授予后资格校验通过", await hasMarketPartnerGrant(partner.userId));
  check(
    "授予后自服务不再 forbidden",
    (await readSelfPartnerLink({ userId: partner.userId, tenantId: partner.tenantId })).state !== "forbidden"
  );

  // ③ 另一个未授予的人不得被顺带标记成已授予（防止「全表 true」这类越权回归）。
  const otherRow = (await listMarketPartnerCandidates({ query: other.userId, limit: 10 }))
    .find((row) => row.userId === other.userId);
  check("未授予的用户仍是 granted=false", otherRow?.granted === false);
  check("未授予的用户仍是 forbidden", (await readSelfPartnerLink({ userId: other.userId, tenantId: other.tenantId })).state === "forbidden");

  // ④ 昵称模糊查询能命中（后台主要靠它挑人）。
  const byNickname = await listMarketPartnerCandidates({ query: `候选人合伙人${marker}`, limit: 10 });
  check("按昵称能查到候选用户", byNickname.some((row) => row.userId === partner.userId));

  // ⑤ limit 夹取：超上限不许放大，非正数不许变 0。
  const cappedHigh = await listMarketPartnerCandidates({ limit: 999 });
  check("limit 超上限被夹到 50 以内", cappedHigh.length <= 50, `实际 ${cappedHigh.length}`);
  const cappedLow = await listMarketPartnerCandidates({ limit: 0 });
  check("limit 传 0 至少返回 1 条", cappedLow.length >= 1, `实际 ${cappedLow.length}`);

  // ⑥ 撤销后回到未授予：fail-closed 可复原。
  await prisma.marketPartnerGrant.deleteMany({ where: { userId: partner.userId } });
  const revokedRows = await listMarketPartnerCandidates({ query: partner.userId, limit: 10 });
  check("撤销后 granted=false", revokedRows.find((row) => row.userId === partner.userId)?.granted === false);
  check("撤销后自服务回到 forbidden", (await readSelfPartnerLink({ userId: partner.userId, tenantId: partner.tenantId })).state === "forbidden");

  await cleanup();
  if (failures.length > 0) {
    console.error(`market_partner_grant_admin_smoke: FAIL (${failures.length} failed)`);
    process.exit(1);
  }
  console.log(`market_partner_grant_admin_smoke: PASS (${pass} passed)`);
}

main().catch(async (error) => {
  console.error(error);
  await cleanup();
  process.exit(1);
});
