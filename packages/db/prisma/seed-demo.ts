import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

const prisma = new PrismaClient();

async function seedTenant(params: {
  tenantId: string;
  userId: string;
  name: string;
  type: "local_business" | "chain_brand";
  industry: string;
  city: string;
  planCode: "local_standard" | "local_premium" | "chain_standard" | "chain_premium";
  credits: number;
}) {
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  const tenant = await prisma.tenant.upsert({
    where: { id: params.tenantId },
    update: {
      name: params.name,
      type: params.type,
      industry: params.industry,
      city: params.city
    },
    create: {
      id: params.tenantId,
      name: params.name,
      type: params.type,
      industry: params.industry,
      city: params.city
    }
  });

  const user = await prisma.user.upsert({
    where: { id: params.userId },
    update: {
      nickname: `${params.name}老板`
    },
    create: {
      id: params.userId,
      nickname: `${params.name}老板`,
      phone: params.type === "chain_brand" ? "13900000002" : "13900000001"
    }
  });

  const store = await prisma.store.upsert({
    where: { id: `${params.tenantId}-store-main` },
    update: {
      name: params.type === "chain_brand" ? "总部" : "默认门店",
      city: params.city
    },
    create: {
      id: `${params.tenantId}-store-main`,
      tenantId: tenant.id,
      name: params.type === "chain_brand" ? "总部" : "默认门店",
      city: params.city
    }
  });

  await prisma.membership.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: user.id
      }
    },
    update: {
      role: "owner",
      isActive: true,
      storeId: store.id
    },
    create: {
      tenantId: tenant.id,
      userId: user.id,
      storeId: store.id,
      role: "owner"
    }
  });

  await prisma.tenantProfile.upsert({
    where: { tenantId: tenant.id },
    update: {
      data: {
        customerStage: "demo",
        primaryGoal: params.type === "chain_brand" ? "招商增长" : "本地获客成交",
        channels: ["微信", "抖音", "小红书"]
      }
    },
    create: {
      tenantId: tenant.id,
      data: {
        customerStage: "demo",
        primaryGoal: params.type === "chain_brand" ? "招商增长" : "本地获客成交",
        channels: ["微信", "抖音", "小红书"]
      }
    }
  });

  await prisma.subscription.create({
    data: {
      tenantId: tenant.id,
      planCode: params.planCode,
      status: "active",
      startDate: now,
      endDate: expiresAt
    }
  });

  const creditAccount = await prisma.creditAccount.upsert({
    where: { tenantId: tenant.id },
    update: {
      balance: params.credits
    },
    create: {
      tenantId: tenant.id,
      balance: params.credits
    }
  });

  await prisma.creditTransaction.create({
    data: {
      creditAccountId: creditAccount.id,
      tenantId: tenant.id,
      userId: user.id,
      direction: "grant",
      amount: params.credits,
      reason: "demo_seed"
    }
  });
}

async function main() {
  await seedInviteCode("baolu-inner-test", "默认内测邀请码");

  await seedTenant({
    tenantId: "demo-local-tenant",
    userId: "demo-local-owner",
    name: "演示本地商家",
    type: "local_business",
    industry: "美容美业",
    city: "杭州",
    planCode: "local_premium",
    credits: 3000
  });

  await seedTenant({
    tenantId: "demo-chain-tenant",
    userId: "demo-chain-owner",
    name: "演示连锁品牌",
    type: "chain_brand",
    industry: "餐饮连锁",
    city: "上海",
    planCode: "chain_premium",
    credits: 3000
  });
}

async function seedInviteCode(code: string, label: string) {
  const normalized = code.trim().toLowerCase();
  await prisma.inviteCode.upsert({
    where: {
      codeHash: createHash("sha256").update(normalized).digest("hex")
    },
    update: {
      label,
      isActive: true,
      maxUses: 100
    },
    create: {
      codeHash: createHash("sha256").update(normalized).digest("hex"),
      codePreview:
        normalized.length <= 4 ? "****" : `${normalized.slice(0, 2)}****${normalized.slice(-2)}`,
      label,
      maxUses: 100,
      createdBy: "seed-demo"
    }
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Demo seed completed.");
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
