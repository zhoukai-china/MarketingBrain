// PLAT-49 市场合伙人自助生成专属链接：服务级回归（真实 PostgreSQL，需 DATABASE_URL）。
//
// 覆盖：未授予资格 fail-closed（forbidden）、授予后生成链接、重复读取复用同一链接、
//       regenerate 生成新链接、撤销资格后再次 fail-closed。
import "dotenv/config";
process.env.SKILL_MCP_REQUIRED = "false";
import { randomUUID } from "node:crypto";
import { prisma } from "../apps/api/node_modules/@baolu/db/dist/index.js";
import {
  hasMarketPartnerGrant,
  issueSelfPartnerLink,
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
const createdDistributorIds: string[] = [];

async function cleanup(): Promise<void> {
  try {
    if (createdDistributorIds.length > 0) {
      await prisma.distroCustomer.deleteMany({ where: { distributorId: { in: createdDistributorIds } } });
      await prisma.shareLink.deleteMany({ where: { distributorId: { in: createdDistributorIds } } });
      await prisma.distributor.deleteMany({ where: { id: { in: createdDistributorIds } } });
    }
    for (const tenantId of createdTenantIds) {
      await prisma.membership.deleteMany({ where: { tenantId } });
      await prisma.tenant.deleteMany({ where: { id: tenantId } });
    }
    if (createdUserIds.length > 0) {
      await prisma.marketPartnerGrant.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  } catch (error) {
    console.error("[cleanup] 清理失败：", error instanceof Error ? error.message : String(error));
  }
}

async function main(): Promise<void> {
  const userId = `mp-self-${randomUUID().slice(0, 8)}`;
  await prisma.user.create({ data: { id: userId, nickname: "自助合伙人", phone: `139${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}` } });
  createdUserIds.push(userId);
  const tenant = await prisma.tenant.create({
    data: { id: `mp-self-t-${randomUUID().slice(0, 8)}`, name: "自助合伙人验收租户", type: "local_business" }
  });
  createdTenantIds.push(tenant.id);

  check("未授予资格时没有资格标记", !(await hasMarketPartnerGrant(userId)));
  check("未授予资格读取为 forbidden", (await readSelfPartnerLink({ userId, tenantId: tenant.id })).state === "forbidden");
  check("未授予资格生成仍 forbidden", (await issueSelfPartnerLink({ userId, tenantId: tenant.id })).state === "forbidden");

  await prisma.marketPartnerGrant.create({ data: { userId, grantedBy: "self-service-smoke" } });
  check("授予后读取为 none（还没有链接）", (await readSelfPartnerLink({ userId, tenantId: tenant.id })).state === "none");

  const first = await issueSelfPartnerLink({ userId, tenantId: tenant.id });
  check("首次生成返回 created", first.state === "created", first.state);
  check("首次生成返回专属链接", Boolean(first.link?.includes("/login?partner=")), first.link ?? "none");

  const second = await readSelfPartnerLink({ userId, tenantId: tenant.id });
  check("再次读取复用同一链接", second.state === "existing" && second.link === first.link, second.link ?? "none");

  const third = await issueSelfPartnerLink({ userId, tenantId: tenant.id });
  check("无 regenerate 的 POST 也复用同一链接", third.state === "existing" && third.link === first.link, third.link ?? "none");

  const fourth = await issueSelfPartnerLink({ userId, tenantId: tenant.id, regenerate: true });
  check("regenerate 生成新链接", fourth.state === "created" && fourth.link !== first.link, fourth.link ?? "none");

  await prisma.marketPartnerGrant.deleteMany({ where: { userId } });
  check("撤销资格后读取回到 forbidden", (await readSelfPartnerLink({ userId, tenantId: tenant.id })).state === "forbidden");

  const distributor = await prisma.distributor.findUnique({ where: { tenantId_userId: { tenantId: tenant.id, userId } } });
  if (distributor) createdDistributorIds.push(distributor.id);

  await cleanup();
  if (failures.length > 0) {
    console.error(`market_partner_self_service_smoke: FAIL (${failures.length} failed)`);
    process.exit(1);
  }
  console.log(`market_partner_self_service_smoke: PASS (${pass} passed)`);
}

main().catch(async (error) => {
  console.error(error);
  await cleanup();
  process.exit(1);
});
