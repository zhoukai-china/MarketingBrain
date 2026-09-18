-- AlterTable
ALTER TABLE "DistroCommissionLog" ADD COLUMN "tenantId" TEXT;

-- CreateIndex
CREATE INDEX "DistroCommissionLog_distributorId_tenantId_idx" ON "DistroCommissionLog"("distributorId", "tenantId");
