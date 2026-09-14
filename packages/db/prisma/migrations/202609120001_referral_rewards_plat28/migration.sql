-- 推荐有礼（PLAT-28 第①批）：推荐码 + 推荐归因 + 平台运行期配置位。
-- 全部为新增表，不改任何历史表、不删任何历史流水，可安全叠加发布。

-- CreateTable
CREATE TABLE "ReferralCode" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "ownerUnionid" TEXT,
    "ownerOpenid" TEXT,
    "codeHash" TEXT NOT NULL,
    "codePreview" TEXT NOT NULL,
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralBinding" (
    "id" TEXT NOT NULL,
    "referralCodeId" TEXT NOT NULL,
    "referrerUserId" TEXT NOT NULL,
    "referrerUnionid" TEXT,
    "referrerOpenid" TEXT,
    "referredUserId" TEXT NOT NULL,
    "referredUnionid" TEXT,
    "referredOpenid" TEXT,
    "boundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'registration',
    "tenantId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCode_codeHash_key" ON "ReferralCode"("codeHash");
CREATE INDEX "ReferralCode_ownerUserId_isActive_idx" ON "ReferralCode"("ownerUserId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralBinding_referredUserId_key" ON "ReferralBinding"("referredUserId");
CREATE UNIQUE INDEX "ReferralBinding_referredUnionid_key" ON "ReferralBinding"("referredUnionid");
CREATE UNIQUE INDEX "ReferralBinding_referredOpenid_key" ON "ReferralBinding"("referredOpenid");
CREATE INDEX "ReferralBinding_referrerUserId_boundAt_idx" ON "ReferralBinding"("referrerUserId", "boundAt");
CREATE INDEX "ReferralBinding_referralCodeId_boundAt_idx" ON "ReferralBinding"("referralCodeId", "boundAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformSetting_key_key" ON "PlatformSetting"("key");

-- AddForeignKey
ALTER TABLE "ReferralCode" ADD CONSTRAINT "ReferralCode_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralBinding" ADD CONSTRAINT "ReferralBinding_referralCodeId_fkey" FOREIGN KEY ("referralCodeId") REFERENCES "ReferralCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralBinding" ADD CONSTRAINT "ReferralBinding_referrerUserId_fkey" FOREIGN KEY ("referrerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralBinding" ADD CONSTRAINT "ReferralBinding_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
