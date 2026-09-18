// PLAT-48 市场合伙人第①批：服务级归因回归（真实 PostgreSQL，需 DATABASE_URL）。
//
// 覆盖：管理员建合伙人 + 签发链接、有效码注册绑定、重复绑定幂等、自荐拒绝、
//       无效 / 停用链接拒绝归因（且不阻断注册）。
// 本脚本不接 HTTP 路由，只直接调 `market-partner.ts` 服务函数。
import "dotenv/config";
process.env.SKILL_MCP_REQUIRED = "false";
import { randomUUID } from "node:crypto";
import { prisma } from "../apps/api/node_modules/@baolu/db/dist/index.js";
import {
  bindMarketPartnerForNewUser,
  createMarketPartner
} from "../apps/api/src/services/market-partner.js";

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
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  } catch (error) {
    console.error("[cleanup] 清理失败：", error instanceof Error ? error.message : String(error));
  }
}

async function createSyntheticUser(label: string): Promise<{ userId: string }> {
  const userId = `mp-attr-${label}-${randomUUID().slice(0, 8)}`;
  await prisma.user.create({
    data: {
      id: userId,
      nickname: `MarketPartner ${label}`,
      phone: `138${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`
    }
  });
  createdUserIds.push(userId);
  return { userId };
}

async function main(): Promise<void> {
  const partnerUser = await createSyntheticUser("partner");
  const customerUser = await createSyntheticUser("customer");
  const tenant = await prisma.tenant.create({
    data: { id: `mp-attr-t-${randomUUID().slice(0, 8)}`, name: "市场合伙人验收租户", type: "local_business" }
  });
  createdTenantIds.push(tenant.id);

  const created = await createMarketPartner({
    name: "市场合伙人甲",
    userId: partnerUser.userId,
    tenantId: tenant.id,
    createdBy: "market-partner-attribution-smoke"
  });
  createdDistributorIds.push(created.partner.id);
  check("创建合伙人返回专属链接", created.link.includes("/login?partner="), created.link);

  const linkRow = await prisma.shareLink.findFirst({ where: { distributorId: created.partner.id } });
  check("合伙人默认生成一条激活链接", Boolean(linkRow?.isActive));
  if (!linkRow) {
    await cleanup();
    process.exit(1);
  }
  const code = linkRow.code;

  const bound = await bindMarketPartnerForNewUser({
    partnerCode: code,
    referredUserId: customerUser.userId,
    tenantId: tenant.id,
    tenantName: "客户甲"
  });
  check("有效码注册绑定成功", bound.state === "bound", bound.state);

  const customer = await prisma.distroCustomer.findUnique({
    where: {
      distributorId_customerId_customerType: {
        distributorId: created.partner.id,
        customerId: tenant.id,
        customerType: "tenant"
      }
    }
  });
  check("DistroCustomer 落库且 source 正确", customer?.source === "market_partner_link", customer?.source ?? "none");

  const afterFirst = await prisma.shareLink.findUnique({ where: { id: linkRow.id } });
  check("registerCount 递增为 1", afterFirst?.registerCount === 1, String(afterFirst?.registerCount));

  const rebound = await bindMarketPartnerForNewUser({
    partnerCode: code,
    referredUserId: customerUser.userId,
    tenantId: tenant.id,
    tenantName: "客户甲"
  });
  check("重复绑定幂等 already_bound", rebound.state === "already_bound", rebound.state);

  const afterSecond = await prisma.shareLink.findUnique({ where: { id: linkRow.id } });
  check("重复绑定不重复计数", afterSecond?.registerCount === 1, String(afterSecond?.registerCount));

  const self = await bindMarketPartnerForNewUser({
    partnerCode: code,
    referredUserId: partnerUser.userId,
    tenantId: tenant.id,
    tenantName: "自荐"
  });
  check("合伙人自荐被拒", self.state === "self", self.state);

  const invalid = await bindMarketPartnerForNewUser({
    partnerCode: "no-such-partner-code",
    referredUserId: customerUser.userId,
    tenantId: tenant.id
  });
  check("无效码拒绝归因", invalid.state === "invalid_code", invalid.state);

  await prisma.shareLink.update({ where: { id: linkRow.id }, data: { isActive: false } });
  const disabled = await bindMarketPartnerForNewUser({
    partnerCode: code,
    referredUserId: customerUser.userId,
    tenantId: tenant.id
  });
  check("停用链接拒绝归因", disabled.state === "expired" || disabled.state === "invalid_code", disabled.state);

  await cleanup();
  if (failures.length > 0) {
    console.error(`market_partner_attribution_smoke: FAIL (${failures.length} failed)`);
    process.exit(1);
  }
  console.log(`market_partner_attribution_smoke: PASS (${pass} passed)`);
}

main().catch(async (error) => {
  console.error(error);
  await cleanup();
  process.exit(1);
});
