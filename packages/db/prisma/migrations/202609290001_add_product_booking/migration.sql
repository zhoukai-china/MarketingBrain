-- 商品/专区预约（F3-F7 未上线功能：用户留手机号预约，管理后台可查）
CREATE TABLE IF NOT EXISTS "ProductBooking" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "phone" TEXT NOT NULL,
    "productKey" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'mall',
    "remark" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductBooking_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductBooking_phone_productKey_key" ON "ProductBooking"("phone", "productKey");
CREATE INDEX IF NOT EXISTS "ProductBooking_createdAt_idx" ON "ProductBooking"("createdAt");
