-- 已付费交付物服务端留存 7 天（用户 2026-09-16 拍板）。
--
-- 背景（汽配信息网现场）：客户退出/换手机后，报告正文与他填写的需求只存在于他自己的页面上，
-- 丢失后我们只能退款、无法帮他找回（也查不到他当时填了什么）。
-- 新表只存「已成功交付并已扣费」的输入与产出，带 expiresAt（7 天），由读取路径顺带清理。
-- 纯新增表，不改任何历史表、不迁移历史数据，可安全叠加发布。

-- CreateTable
CREATE TABLE "MarketplaceDeliverable" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "skuName" TEXT,
    "input" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceDeliverable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketplaceDeliverable_tenantId_userId_createdAt_idx" ON "MarketplaceDeliverable"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketplaceDeliverable_userId_skuCode_createdAt_idx" ON "MarketplaceDeliverable"("userId", "skuCode", "createdAt");

-- CreateIndex
CREATE INDEX "MarketplaceDeliverable_expiresAt_idx" ON "MarketplaceDeliverable"("expiresAt");
