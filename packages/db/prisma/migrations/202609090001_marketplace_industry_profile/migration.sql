-- CreateTable
CREATE TABLE "MarketplaceIndustryProfile" (
    "id" TEXT NOT NULL,
    "zoneKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "who" TEXT,
    "lexicon" JSONB NOT NULL,
    "pains" JSONB NOT NULL,
    "redline" JSONB NOT NULL,
    "ov" JSONB NOT NULL,
    "ready" BOOLEAN NOT NULL DEFAULT true,
    "general" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceIndustryProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceIndustryProfile_zoneKey_key" ON "MarketplaceIndustryProfile"("zoneKey");

-- CreateIndex
CREATE INDEX "MarketplaceIndustryProfile_zoneKey_ready_idx" ON "MarketplaceIndustryProfile"("zoneKey", "ready");
