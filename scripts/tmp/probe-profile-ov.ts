// 本地探针：打印当前 DATABASE_URL 指向库里专区 profile 的 ov 与两个视频复盘 SKU 的状态。
// scripts/tmp 不在工作区依赖解析路径上，直接指向 apps/api 解析到的 workspace 包。
import { prisma } from "../../apps/api/node_modules/@baolu/db/dist/index.js";

async function main(): Promise<void> {
  const profiles = await prisma.marketplaceIndustryProfile.findMany({
    select: { zoneKey: true, ov: true }
  });
  for (const row of profiles) {
    const ov = (row.ov ?? {}) as Record<string, Record<string, unknown>>;
    const keys = Object.keys(ov);
    console.log(
      `profile ${row.zoneKey}: keys=[${keys.join(",")}] vidrev.status=${String(ov.vidrev?.status)}`
    );
  }

  const skus = await prisma.marketplaceSku.findMany({
    where: { skuCode: { endsWith: "__vidrev" } },
    select: { skuCode: true, status: true }
  });
  console.log("skus:", skus.map((s) => `${s.skuCode}=${s.status}`).join(", "));

  await prisma.$disconnect();
}

void main();
