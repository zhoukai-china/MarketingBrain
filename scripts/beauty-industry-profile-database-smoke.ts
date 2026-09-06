import assert from "node:assert/strict";

const allowedDatabase = "beauty_industry_acceptance_20260821";
if (process.env.BEAUTY_PROFILE_TEST_DATABASE_ALLOWED !== "true" || !process.env.DATABASE_URL?.includes(`/${allowedDatabase}`)) {
  throw new Error(`refusing_non_isolated_database:${allowedDatabase}`);
}

async function main(): Promise<void> {
  const [{ prisma }, profileModule] = await Promise.all([
    import("../packages/db/src/index.js"),
    import("../apps/api/src/products/beauty-industry/profile.js")
  ]);
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tenantA = `beauty_profile_a_${suffix}`;
  const tenantB = `beauty_profile_b_${suffix}`;
  try {
    await prisma.tenant.createMany({
      data: [
        { id: tenantA, name: "Synthetic Beauty Profile A", type: "local_business", industry: "生活美容" },
        { id: tenantB, name: "Synthetic Beauty Profile B", type: "local_business", industry: "生活美容" }
      ]
    });
    await prisma.tenantProfile.createMany({
      data: [
        { tenantId: tenantA, data: { branding: { name: "A" } }, confirmedData: { branding: { name: "A" } }, inferredData: {} },
        { tenantId: tenantB, data: { branding: { name: "B" } }, confirmedData: { branding: { name: "B" } }, inferredData: {} }
      ]
    });

    const savedA = await profileModule.saveBeautyIndustryProfile({
      tenantId: tenantA,
      input: {
        segment: "lifestyle_beauty",
        operationType: "single_store",
        operatingStage: "growth",
        storeName: "青禾皮肤管理",
        city: "烟台",
        services: ["基础清洁"],
        targetCustomers: "附近顾客",
        channels: ["小红书"],
        acquisitionGoal: "提升真实咨询",
        factBoundaries: "无医疗资质，不承诺疗效"
      }
    });
    const savedB = await profileModule.saveBeautyIndustryProfile({
      tenantId: tenantB,
      input: {
        segment: "hairdressing",
        operationType: "single_store",
        operatingStage: "stable",
        storeName: "木棉美发",
        city: "威海",
        services: ["剪发"],
        targetCustomers: "附近居民",
        channels: ["抖音"],
        acquisitionGoal: "提升预约",
        factBoundaries: "不编造价格和案例"
      }
    });
    assert.equal(savedA.version, 1);
    assert.equal(savedB.version, 1);

    const [rowA, rowB] = await Promise.all([
      prisma.tenantProfile.findUniqueOrThrow({ where: { tenantId: tenantA } }),
      prisma.tenantProfile.findUniqueOrThrow({ where: { tenantId: tenantB } })
    ]);
    const profileA = profileModule.readBeautyIndustryProfileFromTenantData(rowA.confirmedData);
    const profileB = profileModule.readBeautyIndustryProfileFromTenantData(rowB.confirmedData);
    assert.equal(profileA?.storeName, "青禾皮肤管理");
    assert.equal(profileB?.storeName, "木棉美发");
    assert.equal(JSON.stringify(rowA.confirmedData).includes("木棉美发"), false);
    assert.equal(JSON.stringify(rowB.confirmedData).includes("青禾皮肤管理"), false);
    assert.equal((rowA.confirmedData as Record<string, unknown>).branding !== undefined, true, "save removed unrelated tenant profile data");

    await profileModule.deleteBeautyIndustryProfile(tenantA);
    const [deletedA, untouchedB] = await Promise.all([
      prisma.tenantProfile.findUniqueOrThrow({ where: { tenantId: tenantA } }),
      prisma.tenantProfile.findUniqueOrThrow({ where: { tenantId: tenantB } })
    ]);
    assert.equal(profileModule.readBeautyIndustryProfileFromTenantData(deletedA.confirmedData), null);
    assert.equal(profileModule.readBeautyIndustryProfileFromTenantData(untouchedB.confirmedData)?.storeName, "木棉美发");
    assert.equal((deletedA.confirmedData as Record<string, unknown>).branding !== undefined, true, "delete removed unrelated tenant profile data");

    console.log("beauty industry profile database isolation and deletion smoke passed");
  } finally {
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : "beauty_profile_database_smoke_failed");
  process.exitCode = 1;
});
