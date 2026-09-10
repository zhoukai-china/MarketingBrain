-- 兰琪美业门店 AI 经营大脑 · 经营驾驶舱目标（LQ-20）
-- 驾驶舱唯一的手输数据：本月 4 个目标，按 store_id + 月份各存一条，不覆盖历史。

-- CreateTable
CREATE TABLE "LanqiStoreGoal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "rev" INTEGER,
    "newCount" INTEGER,
    "up" INTEGER,
    "wake" INTEGER,
    "requestKey" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LanqiStoreGoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LanqiStoreGoal_tenantId_storeId_month_key" ON "LanqiStoreGoal"("tenantId", "storeId", "month");
CREATE INDEX "LanqiStoreGoal_tenantId_month_idx" ON "LanqiStoreGoal"("tenantId", "month");

-- AddForeignKey
ALTER TABLE "LanqiStoreGoal" ADD CONSTRAINT "LanqiStoreGoal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
