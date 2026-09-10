-- 兰琪美业门店 AI 经营大脑 · 私域营销（LQ-18）
-- 新增：朋友圈草稿 / 升级结果 / 配图资产（租户+门店维度，requestKey 幂等）

-- CreateTable
CREATE TABLE "LanqiMomentDraft" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "storeId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "pillar" TEXT,
    "inputs" JSONB NOT NULL,
    "raw" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LanqiMomentDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LanqiMomentDraft_tenantId_storeId_mode_createdAt_idx" ON "LanqiMomentDraft"("tenantId", "storeId", "mode", "createdAt");
CREATE INDEX "LanqiMomentDraft_userId_idx" ON "LanqiMomentDraft"("userId");

-- CreateTable
CREATE TABLE "LanqiMomentUpgrade" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "storeId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "draftId" TEXT,
    "mode" TEXT NOT NULL,
    "pillar" TEXT,
    "goal" TEXT,
    "tone" TEXT,
    "level" TEXT,
    "keepMine" BOOLEAN NOT NULL DEFAULT false,
    "raw" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "core" TEXT,
    "rawLen" INTEGER NOT NULL,
    "newLen" INTEGER NOT NULL,
    "rawScore" INTEGER NOT NULL,
    "newScore" INTEGER NOT NULL,
    "issues" JSONB NOT NULL,
    "ups" JSONB NOT NULL,
    "checks" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "errorMessage" TEXT,
    "traceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LanqiMomentUpgrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LanqiMomentUpgrade_tenantId_requestKey_key" ON "LanqiMomentUpgrade"("tenantId", "requestKey");
CREATE INDEX "LanqiMomentUpgrade_tenantId_storeId_createdAt_idx" ON "LanqiMomentUpgrade"("tenantId", "storeId", "createdAt");
CREATE INDEX "LanqiMomentUpgrade_status_idx" ON "LanqiMomentUpgrade"("status");

-- CreateTable
CREATE TABLE "LanqiMomentAsset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "storeId" TEXT NOT NULL,
    "upgradeId" TEXT,
    "requestKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'image',
    "name" TEXT,
    "url" TEXT NOT NULL,
    "thumbUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LanqiMomentAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LanqiMomentAsset_tenantId_requestKey_key" ON "LanqiMomentAsset"("tenantId", "requestKey");
CREATE INDEX "LanqiMomentAsset_tenantId_storeId_idx" ON "LanqiMomentAsset"("tenantId", "storeId");
